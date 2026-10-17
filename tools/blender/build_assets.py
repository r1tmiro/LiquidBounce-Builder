"""
AMONG US: NIGHT SHIFT - procedural asset pipeline (Blender 4.2, headless).

Builds every 3D model used by the game from scratch (no external references),
then exports optimised GLB files into assets/models/.

Run with:
    LD_LIBRARY_PATH=/home/user/xstubs /home/user/bpyenv/bin/python tools/blender/build_assets.py
"""
import bpy
import bmesh
import math
import os
import sys
import json
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_DIR = os.path.join(ROOT, 'assets', 'models')
PREVIEW_DIR = os.path.join(ROOT, 'assets', 'previews')

# --------------------------------------------------------------------------- #
# scene helpers
# --------------------------------------------------------------------------- #

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def collection(name):
    if name in bpy.data.collections:
        return bpy.data.collections[name]
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def link(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)
    return obj


def material(name, color, metallic=0.0, roughness=0.5, emission=None, emission_strength=0.0,
             alpha=1.0, transmission=0.0):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    inp = bsdf.inputs
    inp['Base Color'].default_value = (color[0], color[1], color[2], 1.0)
    inp['Metallic'].default_value = metallic
    inp['Roughness'].default_value = roughness
    if 'Alpha' in inp:
        inp['Alpha'].default_value = alpha
    if transmission and 'Transmission Weight' in inp:
        inp['Transmission Weight'].default_value = transmission
    if emission is not None:
        if 'Emission Color' in inp:
            inp['Emission Color'].default_value = (emission[0], emission[1], emission[2], 1.0)
        if 'Emission Strength' in inp:
            inp['Emission Strength'].default_value = emission_strength
    if alpha < 1.0:
        mat.blend_method = 'BLEND'
    return mat


def new_object(name, verts, faces, mat=None, smooth=True, col=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    mesh.validate(verbose=False)
    mesh.update()
    if smooth:
        for poly in mesh.polygons:
            poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    link(obj, col or collection('Assets'))
    if mat:
        obj.data.materials.append(mat)
    return obj


def join_objects(objs, name, col=None):
    """Merge meshes into a single object (keeps material slots)."""
    objs = [o for o in objs if o]
    if not objs:
        return None
    # Bake each object's modifiers before joining. Blender only preserves the
    # active object's modifiers when joining, so skipping this loses bevels and
    # subdivides unrelated pieces such as teeth and visor frames.
    for o in objs:
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        if o.type == 'CURVE': bpy.ops.object.convert(target='MESH')
        for mod in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    if col:
        link(obj, col)
    return obj


def add_bevel(obj, width=0.02, segments=2, angle=50.0):
    mod = obj.modifiers.new('Bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(angle)
    mod.harden_normals = False
    return mod


def add_subsurf(obj, levels=2, render_levels=2):
    mod = obj.modifiers.new('Subdivision', 'SUBSURF')
    mod.levels = levels
    mod.render_levels = render_levels
    return mod


def shade_auto_smooth(obj, angle=35.0):
    try:
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle))
    except Exception:
        for poly in obj.data.polygons:
            poly.use_smooth = True


def transform(obj, loc=None, rot=None, scale=None):
    if loc:
        obj.location = loc
    if rot:
        obj.rotation_euler = rot
    if scale:
        obj.scale = scale
    return obj


# --------------------------------------------------------------------------- #
# geometry generators (pure data api -> deterministic results)
# --------------------------------------------------------------------------- #

def revolve(profile, segments=32, name='lathe', mat=None, smooth=True, col=None, arc=math.tau):
    """Revolve a 2D profile [(radius, height), ...] around the Z axis."""
    verts, faces = [], []
    n = len(profile)
    closed = abs(arc - math.tau) < 1e-6
    steps = segments if closed else segments + 1
    for s in range(steps):
        ang = arc * (s / segments)
        ca, sa = math.cos(ang), math.sin(ang)
        for (r, h) in profile:
            verts.append((r * ca, r * sa, h))
    for s in range(steps if closed else steps - 1):
        s2 = (s + 1) % steps
        for i in range(n - 1):
            a = s * n + i
            b = s * n + i + 1
            c = s2 * n + i + 1
            d = s2 * n + i
            faces.append((a, b, c, d))
    # cap bottom / top when profile does not touch the axis
    if profile[0][0] > 1e-5:
        verts.append((0, 0, profile[0][1]))
        ci = len(verts) - 1
        for s in range(steps if closed else steps - 1):
            s2 = (s + 1) % steps
            faces.append((ci, s2 * n, s * n))
    if profile[-1][0] > 1e-5:
        verts.append((0, 0, profile[-1][1]))
        ci = len(verts) - 1
        base = (n - 1)
        for s in range(steps if closed else steps - 1):
            s2 = (s + 1) % steps
            faces.append((ci, s * n + base, s2 * n + base))
    return new_object(name, verts, faces, mat, smooth, col)


def box(name, size, loc=(0, 0, 0), rot=None, mat=None, bevel=0.0, bevel_seg=2, smooth=False, col=None):
    sx, sy, sz = size
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    verts = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
             (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    obj = new_object(name, verts, faces, mat, smooth, col)
    transform(obj, loc, rot)
    if bevel > 0:
        add_bevel(obj, bevel, bevel_seg)
    return obj


def sphere(name, radius, loc=(0, 0, 0), scale=(1, 1, 1), segments=32, rings=16, mat=None, col=None,
           smooth=True):
    verts, faces = [], []
    for i in range(rings + 1):
        v = i / rings
        phi = v * math.pi
        for j in range(segments):
            u = j / segments
            theta = u * math.tau
            x = math.sin(phi) * math.cos(theta)
            y = math.sin(phi) * math.sin(theta)
            z = math.cos(phi)
            verts.append((x * radius * scale[0], y * radius * scale[1], z * radius * scale[2]))
    for i in range(rings):
        for j in range(segments):
            j2 = (j + 1) % segments
            a = i * segments + j
            b = i * segments + j2
            c = (i + 1) * segments + j2
            d = (i + 1) * segments + j
            faces.append((a, b, c, d))
    obj = new_object(name, verts, faces, mat, smooth, col)
    transform(obj, loc)
    return obj


def cylinder(name, radius, depth, loc=(0, 0, 0), rot=None, verts_n=32, mat=None, bevel=0.0,
             smooth=True, col=None, cap=True):
    verts, faces = [], []
    for i in range(verts_n):
        a = math.tau * i / verts_n
        verts.append((radius * math.cos(a), radius * math.sin(a), -depth / 2))
    for i in range(verts_n):
        a = math.tau * i / verts_n
        verts.append((radius * math.cos(a), radius * math.sin(a), depth / 2))
    for i in range(verts_n):
        j = (i + 1) % verts_n
        faces.append((i, j, j + verts_n, i + verts_n))
    if cap:
        verts.append((0, 0, -depth / 2))
        c0 = len(verts) - 1
        verts.append((0, 0, depth / 2))
        c1 = len(verts) - 1
        for i in range(verts_n):
            j = (i + 1) % verts_n
            faces.append((c0, j, i))
            faces.append((c1, i + verts_n, j + verts_n))
    obj = new_object(name, verts, faces, mat, smooth, col)
    transform(obj, loc, rot)
    if bevel > 0:
        add_bevel(obj, bevel, 2)
    return obj


def torus(name, major, minor, loc=(0, 0, 0), rot=None, seg=32, ring=12, mat=None, col=None):
    verts, faces = [], []
    for i in range(seg):
        u = math.tau * i / seg
        cu, su = math.cos(u), math.sin(u)
        for j in range(ring):
            v = math.tau * j / ring
            cv, sv = math.cos(v), math.sin(v)
            r = major + minor * cv
            verts.append((r * cu, r * su, minor * sv))
    for i in range(seg):
        i2 = (i + 1) % seg
        for j in range(ring):
            j2 = (j + 1) % ring
            a = i * ring + j
            b = i2 * ring + j
            c = i2 * ring + j2
            d = i * ring + j2
            faces.append((a, b, c, d))
    obj = new_object(name, verts, faces, mat, True, col)
    transform(obj, loc, rot)
    return obj


def cone(name, radius, depth, loc=(0, 0, 0), rot=None, verts_n=24, mat=None, col=None):
    verts, faces = [], []
    for i in range(verts_n):
        a = math.tau * i / verts_n
        verts.append((radius * math.cos(a), radius * math.sin(a), -depth / 2))
    verts.append((0, 0, depth / 2))
    tip = len(verts) - 1
    for i in range(verts_n):
        j = (i + 1) % verts_n
        faces.append((i, j, tip))
    faces.append(tuple(range(verts_n - 1, -1, -1)))
    obj = new_object(name, verts, faces, mat, True, col)
    transform(obj, loc, rot)
    return obj


def pipe(name, points, radius, mat=None, col=None, segments=12):
    """Tube along a polyline using a curve object with bevel depth."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = max(1, segments // 6)
    cu.resolution_u = 6
    spline = cu.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for i, p in enumerate(points):
        spline.points[i].co = (p[0], p[1], p[2], 1.0)
    obj = bpy.data.objects.new(name, cu)
    link(obj, col or collection('Assets'))
    if mat:
        obj.data.materials.append(mat)
    return obj


def mirror_x(obj, name):
    """Duplicate an object mirrored across X (for symmetric props)."""
    new = obj.copy()
    new.data = obj.data.copy()
    new.name = name
    new.scale = (-obj.scale.x, obj.scale.y, obj.scale.z)
    link(new, obj.users_collection[0])
    bpy.ops.object.select_all(action='DESELECT')
    new.select_set(True)
    bpy.context.view_layer.objects.active = new
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    return new


# --------------------------------------------------------------------------- #
# export helpers
# --------------------------------------------------------------------------- #

def export_glb(name, objects, col):
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    path = os.path.join(OUT_DIR, name + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_materials='EXPORT',
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
    )
    size = os.path.getsize(path)
    print(f'  [export] {name}.glb  {size/1024:.1f} KB  objects={len(objects)}')
    return path


def cleanup(objects):
    for o in objects:
        if o and o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)


# --------------------------------------------------------------------------- #
# character: crewmate "bean"
# --------------------------------------------------------------------------- #

def build_crew(name='crew'):
    col = collection('Characters')
    body_mat = material('Body', (0.88, 0.88, 0.90), 0.0, 0.42)
    visor_mat = material('Visor', (0.05, 0.09, 0.14), 0.85, 0.12)
    pack_mat = material('Pack', (0.16, 0.18, 0.22), 0.6, 0.45)
    trim_mat = material('Trim', (0.95, 0.62, 0.12), 0.2, 0.35)

    # --- body: lathe profile (classic bean silhouette) ---
    profile = [
        (0.00, 0.00), (0.30, 0.00), (0.40, 0.035), (0.44, 0.12), (0.455, 0.24),
        (0.45, 0.38), (0.425, 0.50), (0.38, 0.60), (0.31, 0.685), (0.22, 0.745),
        (0.12, 0.775), (0.0, 0.78),
    ]
    body = revolve(profile, 40, 'Body', body_mat, True, col)
    add_subsurf(body, 2, 2)

    # --- visor: flattened ellipsoid, pushed into the front of the body ---
    visor = sphere('Visor', 0.30, loc=(0, -0.30, 0.47), scale=(1.0, 0.55, 0.78),
                   segments=36, rings=20, mat=visor_mat, col=col)
    # --- visor frame ring ---
    frame = torus('VisorFrame', 0.285, 0.035, loc=(0, -0.245, 0.47), rot=(math.pi / 2, 0, 0),
                  seg=36, ring=10, mat=pack_mat, col=col)
    frame.scale = (1.0, 0.78, 1.0)

    # --- backpack ---
    pack = box('Pack', (0.46, 0.24, 0.52), loc=(0, 0.40, 0.42), mat=pack_mat, bevel=0.06,
               bevel_seg=3, smooth=True, col=col)
    tank = cylinder('Tank', 0.085, 0.42, loc=(0, 0.545, 0.44), mat=trim_mat, verts_n=16, col=col)
    nozzle = cylinder('Nozzle', 0.05, 0.14, loc=(0, 0.545, 0.70), mat=pack_mat, verts_n=12, col=col)

    # --- feet ---
    foot_l = box('FootL', (0.20, 0.30, 0.10), loc=(-0.17, -0.05, 0.05), mat=pack_mat, bevel=0.035,
                 bevel_seg=2, smooth=True, col=col)
    foot_r = box('FootR', (0.20, 0.30, 0.10), loc=(0.17, -0.05, 0.05), mat=pack_mat, bevel=0.035,
                 bevel_seg=2, smooth=True, col=col)

    # --- antenna/comm nub on top (reads as a crewmate detail) ---
    nub = cylinder('Nub', 0.055, 0.10, loc=(0, 0.02, 0.80), mat=pack_mat, verts_n=12, col=col)
    nub_light = sphere('NubLight', 0.045, loc=(0, 0.02, 0.87), segments=16, rings=8,
                        mat=material('NubGlow', (0.2, 1.0, 0.6), 0.0, 0.2, (0.1, 1.0, 0.5), 6.0),
                        col=col)

    objs = [body, visor, frame, pack, tank, nozzle, foot_l, foot_r, nub, nub_light]
    for o in objs:
        if o not in (foot_l, foot_r): o.location.z += 0.14
    merged = join_objects(objs, name, col)
    shade_auto_smooth(merged, 40)
    return [merged], col


def build_impostor(name='impostor'):
    """The horror variant: a hunched, spined creature with a bone muzzle and claws."""
    col = collection('Characters')
    flesh = material('Flesh', (0.085, 0.095, 0.115), 0.18, 0.52)
    bone = material('Bone', (0.74, 0.71, 0.60), 0.12, 0.42)
    claw = material('Claw', (0.90, 0.86, 0.76), 0.35, 0.22)
    bone_dark = material('BoneDark', (0.40, 0.38, 0.33), 0.12, 0.48)
    eye = material('Eye', (1.0, 0.16, 0.08), 0.0, 0.12, (1.0, 0.10, 0.04), 16.0)
    socket = material('Socket', (0.03, 0.02, 0.03), 0.0, 0.9)

    # --- hunched torso: wide ribcage, pinched neck, narrow skull ---
    profile = [
        (0.00, 0.00), (0.30, 0.00), (0.40, 0.06), (0.44, 0.20), (0.45, 0.36),
        (0.43, 0.52), (0.38, 0.66), (0.30, 0.78), (0.22, 0.86), (0.17, 0.95),
        (0.15, 1.04), (0.0, 1.07),
    ]
    body = revolve(profile, 40, 'Torso', flesh, True, col)
    add_subsurf(body, 2, 2)

    parts = [body]

    # --- spine ridge along the back ---
    for i in range(8):
        t = i / 7.0
        z = 0.30 + t * 0.60
        r = 0.45 - t * 0.30
        parts.append(cone('Spine', 0.06 - t * 0.022, 0.26 - t * 0.10,
                          loc=(0, r * 0.86, z), rot=(-0.85, 0, 0), verts_n=12, mat=bone, col=col))

    # --- skull + bone muzzle ---
    parts.append(sphere('Muzzle', 0.145, loc=(0, -0.175, 0.925), scale=(0.85, 1.35, 0.75),
                        segments=24, rings=14, mat=bone_dark, col=col))
    parts.append(box('Jaw', (0.20, 0.22, 0.075), loc=(0, -0.245, 0.815), rot=(math.radians(-8), 0, 0),
                     mat=bone_dark, bevel=0.02, bevel_seg=2, smooth=True, col=col))
    # teeth hanging from the upper jaw
    for i in range(7):
        x = -0.078 + i * 0.026
        parts.append(cone('Tooth', 0.013, 0.070, loc=(x, -0.285, 0.862), rot=(math.pi, 0, 0),
                          verts_n=8, mat=claw, col=col))
    # lower fangs pointing up
    for i in range(5):
        x = -0.062 + i * 0.031
        parts.append(cone('Fang', 0.011, 0.052, loc=(x, -0.255, 0.790), rot=(0, 0, 0),
                          verts_n=8, mat=claw, col=col))

    # --- eye sockets + glowing eyes ---
    for side in (-1, 1):
        parts.append(sphere('Socket', 0.062, loc=(side * 0.098, -0.215, 1.005),
                            scale=(1.0, 0.55, 1.0), segments=16, rings=10, mat=socket, col=col))
        parts.append(sphere('Eye', 0.046, loc=(side * 0.098, -0.255, 1.005),
                            segments=16, rings=10, mat=eye, col=col))

    # --- long arms with claws ---
    for side in (-1, 1):
        parts.append(cylinder('Shoulder', 0.085, 0.22, loc=(side * 0.33, -0.02, 0.80),
                              rot=(0, side * 0.45, 0), verts_n=12, mat=flesh, col=col))
        parts.append(cylinder('UpperArm', 0.062, 0.40, loc=(side * 0.44, -0.03, 0.60),
                              rot=(0.15, side * 0.22, 0), verts_n=12, mat=flesh, col=col))
        parts.append(cylinder('Forearm', 0.052, 0.42, loc=(side * 0.50, -0.16, 0.36),
                              rot=(0.60, side * 0.10, 0), verts_n=12, mat=flesh, col=col))
        parts.append(sphere('Elbow', 0.062, loc=(side * 0.47, -0.09, 0.48), segments=12, rings=8,
                            mat=flesh, col=col))
        for c in range(3):
            parts.append(cone('Claw', 0.020, 0.26,
                              loc=(side * 0.50 + (c - 1) * 0.045, -0.36, 0.17),
                              rot=(-2.1, 0, 0), verts_n=8, mat=claw, col=col))

    # --- digitigrade legs ---
    for side in (-1, 1):
        parts.append(cylinder('Thigh', 0.095, 0.34, loc=(side * 0.17, 0.02, 0.24),
                              rot=(0.18, side * 0.16, 0), verts_n=12, mat=flesh, col=col))
        parts.append(cylinder('Shin', 0.072, 0.32, loc=(side * 0.21, -0.06, 0.09),
                              rot=(-0.22, 0, 0), verts_n=12, mat=flesh, col=col))
        parts.append(box('Foot', (0.17, 0.34, 0.075), loc=(side * 0.21, -0.12, 0.04),
                         mat=bone, bevel=0.025, bevel_seg=2, smooth=True, col=col))

    merged = join_objects(parts, name, col)
    merged.scale = (1.0, 1.0, 1.14)
    shade_auto_smooth(merged, 38)
    return [merged], col


def build_husk(name='husk'):
    """A drained crewmate corpse (slumped on its back) used for bodies / reports."""
    col = collection('Characters')
    skin = material('HuskSkin', (0.20, 0.185, 0.20), 0.0, 0.82)
    dark = material('HuskDark', (0.05, 0.05, 0.06), 0.2, 0.45)
    pool = material('Pool', (0.055, 0.004, 0.008), 0.0, 0.28)

    profile = [
        (0.00, 0.00), (0.30, 0.00), (0.40, 0.035), (0.44, 0.12), (0.455, 0.24),
        (0.45, 0.38), (0.425, 0.50), (0.38, 0.60), (0.31, 0.685), (0.22, 0.745),
        (0.12, 0.775), (0.0, 0.78),
    ]
    body = revolve(profile, 32, 'Husk', skin, True, col)
    # lay the bean on its back: (x,y,z) -> (x, z, -y), then flatten it a little
    body.data.transform(Matrix.Rotation(-math.pi / 2, 4, 'X'))
    body.location = (0, 0.10, 0.36)
    body.scale = (1.0, 1.0, 0.82)
    add_subsurf(body, 2, 2)

    # hollow visor staring up, cracked
    visor = sphere('HuskVisor', 0.30, loc=(0, 0.40, 0.60), scale=(1.0, 0.72, 0.42),
                   segments=26, rings=16, mat=dark, col=col)
    crack = box('Crack', (0.05, 0.42, 0.34), loc=(0.05, 0.40, 0.66), rot=(0, 0.2, 0.25),
                mat=material('Crack', (0.02, 0.02, 0.02), 0.0, 0.95), col=col)
    pack = box('HuskPack', (0.40, 0.42, 0.18), loc=(0, -0.30, 0.22), mat=dark, bevel=0.04,
               bevel_seg=2, smooth=True, col=col)
    foot_l = box('FootL', (0.17, 0.24, 0.075), loc=(-0.17, 0.76, 0.26), rot=(math.radians(-28), 0, 0.2),
                 mat=dark, bevel=0.022, bevel_seg=2, smooth=True, col=col)
    foot_r = box('FootR', (0.17, 0.24, 0.075), loc=(0.17, 0.76, 0.26), rot=(math.radians(-28), 0, -0.2),
                 mat=dark, bevel=0.022, bevel_seg=2, smooth=True, col=col)
    # irregular blood pool: several overlapping flattened blobs
    pool_parts = [
        cylinder('Pool0', 0.46, 0.010, loc=(0, 0.14, 0.012), verts_n=24, mat=pool, col=col),
        sphere('Pool1', 0.26, loc=(-0.38, 0.02, 0.010), scale=(1.0, 0.8, 0.03), segments=14,
               rings=8, mat=pool, col=col),
        sphere('Pool2', 0.22, loc=(0.40, 0.28, 0.010), scale=(1.0, 0.8, 0.03), segments=14,
               rings=8, mat=pool, col=col),
    ]
    pool_parts[0].scale = (1.0, 0.80, 1.0)

    merged = join_objects([body, visor, crack, pack, foot_l, foot_r] + pool_parts, name, col)
    shade_auto_smooth(merged, 40)
    return [merged], col


# --------------------------------------------------------------------------- #
# props
# --------------------------------------------------------------------------- #

def build_console(name='console'):
    """Wall task console: angled housing, glowing screen, physical buttons."""
    col = collection('Props')
    shell = material('ConsoleShell', (0.20, 0.22, 0.25), 0.55, 0.42)
    trim = material('ConsoleTrim', (0.85, 0.55, 0.10), 0.35, 0.3)
    screen = material('ConsoleScreen', (0.05, 0.20, 0.24), 0.1, 0.12, (0.15, 0.95, 0.85), 3.2)

    base = box('Base', (0.62, 0.26, 0.09), loc=(0, 0, 0.045), mat=shell, bevel=0.02, bevel_seg=2,
               smooth=True, col=col)
    neck = box('Neck', (0.34, 0.10, 0.26), loc=(0, 0.06, 0.19), mat=shell, bevel=0.02, bevel_seg=2,
               smooth=True, col=col)
    head = box('Head', (0.68, 0.20, 0.46), loc=(0, -0.03, 0.47), rot=(math.radians(-14), 0, 0),
               mat=shell, bevel=0.03, bevel_seg=3, smooth=True, col=col)
    glass = box('Screen', (0.54, 0.03, 0.32), loc=(0, -0.135, 0.48), rot=(math.radians(-14), 0, 0),
                mat=screen, bevel=0.012, bevel_seg=2, smooth=True, col=col)
    buttons = []
    for i in range(3):
        b = box('Btn', (0.10, 0.05, 0.045), loc=(-0.18 + i * 0.18, -0.12, 0.235),
                rot=(math.radians(-14), 0, 0), mat=trim, bevel=0.012, bevel_seg=2, smooth=True, col=col)
        buttons.append(b)
    light = box('Strip', (0.56, 0.02, 0.03), loc=(0, -0.14, 0.68), rot=(math.radians(-14), 0, 0),
                mat=screen, bevel=0.006, bevel_seg=1, smooth=True, col=col)

    merged = join_objects([base, neck, head, glass, light] + buttons, name, col)
    shade_auto_smooth(merged, 32)
    return [merged], col


def build_vent(name='vent'):
    col = collection('Props')
    frame_mat = material('VentFrame', (0.26, 0.27, 0.29), 0.7, 0.42)
    slat_mat = material('VentSlat', (0.14, 0.15, 0.17), 0.75, 0.38)
    hole = material('VentHole', (0.02, 0.02, 0.03), 0.0, 0.95)

    parts = []
    # frame as four bars
    parts.append(box('F1', (0.96, 0.10, 0.10), loc=(0, 0.43, 0.05), mat=frame_mat, bevel=0.02,
                     bevel_seg=2, smooth=True, col=col))
    parts.append(box('F2', (0.96, 0.10, 0.10), loc=(0, -0.43, 0.05), mat=frame_mat, bevel=0.02,
                     bevel_seg=2, smooth=True, col=col))
    parts.append(box('F3', (0.10, 0.86, 0.10), loc=(0.43, 0, 0.05), mat=frame_mat, bevel=0.02,
                     bevel_seg=2, smooth=True, col=col))
    parts.append(box('F4', (0.10, 0.86, 0.10), loc=(-0.43, 0, 0.05), mat=frame_mat, bevel=0.02,
                     bevel_seg=2, smooth=True, col=col))
    parts.append(box('Well', (0.84, 0.84, 0.06), loc=(0, 0, 0.015), mat=hole, col=col))
    for i in range(6):
        parts.append(box('Slat', (0.80, 0.055, 0.035), loc=(0, -0.30 + i * 0.12, 0.075),
                         mat=slat_mat, bevel=0.008, bevel_seg=1, smooth=True, col=col))
    merged = join_objects(parts, name, col)
    shade_auto_smooth(merged, 30)
    return [merged], col


def build_reactor(name='reactor'):
    """Open cage reactor so the glowing core stays visible."""
    col = collection('Props')
    steel = material('ReactorSteel', (0.22, 0.24, 0.27), 0.85, 0.34)
    dark = material('ReactorDark', (0.09, 0.10, 0.12), 0.6, 0.5)
    core = material('ReactorCore', (0.95, 0.30, 0.06), 0.0, 0.25, (1.0, 0.38, 0.08), 14.0)
    coil = material('ReactorCoil', (0.85, 0.45, 0.12), 0.3, 0.3, (1.0, 0.45, 0.10), 4.0)

    parts = [
        cylinder('Base', 1.30, 0.26, loc=(0, 0, 0.13), verts_n=28, mat=dark, col=col),
        cylinder('BaseRim', 1.34, 0.06, loc=(0, 0, 0.27), verts_n=28, mat=steel, col=col),
    ]
    # vertical cage pillars
    for i in range(6):
        a = math.tau * i / 6
        parts.append(cylinder('Pillar', 0.075, 2.10, loc=(math.cos(a) * 0.86, math.sin(a) * 0.86, 1.32),
                              verts_n=12, mat=steel, col=col))
    # horizontal rings
    for z in (0.55, 1.15, 1.75, 2.25):
        parts.append(torus('Ring', 0.88, 0.055, loc=(0, 0, z), seg=28, ring=8, mat=dark, col=col))
    # glowing core + coils
    parts.append(cylinder('Core', 0.46, 1.86, loc=(0, 0, 1.30), verts_n=24, mat=core, col=col))
    for z in (0.75, 1.25, 1.75):
        parts.append(torus('Coil', 0.56, 0.045, loc=(0, 0, z), seg=26, ring=8, mat=coil, col=col))
    # cap + exhaust
    parts.append(cylinder('Cap', 1.14, 0.22, loc=(0, 0, 2.48), verts_n=28, mat=dark, col=col))
    parts.append(cylinder('CapRim', 1.18, 0.05, loc=(0, 0, 2.60), verts_n=28, mat=steel, col=col))
    parts.append(cylinder('Stack', 0.30, 0.80, loc=(0, 0, 2.95), verts_n=16, mat=steel, col=col))
    parts.append(cylinder('StackCap', 0.36, 0.07, loc=(0, 0, 3.37), verts_n=16, mat=dark, col=col))
    # feed pipes from the floor
    for i in range(4):
        a = math.tau * i / 4 + math.pi / 4
        parts.append(pipe('Feed', [(math.cos(a) * 1.45, math.sin(a) * 1.45, 0.10),
                                    (math.cos(a) * 1.55, math.sin(a) * 1.55, 0.70),
                                    (math.cos(a) * 1.05, math.sin(a) * 1.05, 1.05)],
                           0.075, mat=dark, col=col))
    merged = join_objects(parts, name, col)
    shade_auto_smooth(merged, 32)
    return [merged], col


def build_crate(name='crate'):
    col = collection('Props')
    body = material('CrateBody', (0.30, 0.29, 0.26), 0.3, 0.65)
    edge = material('CrateEdge', (0.62, 0.55, 0.18), 0.7, 0.4)
    parts = [
        box('Crate', (0.78, 0.60, 0.56), loc=(0, 0, 0.28), mat=body, bevel=0.03, bevel_seg=2,
            smooth=True, col=col),
        box('Band1', (0.82, 0.08, 0.10), loc=(0, 0, 0.42), mat=edge, bevel=0.01, bevel_seg=1,
            smooth=True, col=col),
        box('Band2', (0.08, 0.64, 0.10), loc=(0, 0, 0.42), mat=edge, bevel=0.01, bevel_seg=1,
            smooth=True, col=col),
    ]
    merged = join_objects(parts, name, col)
    shade_auto_smooth(merged, 30)
    return [merged], col


def build_barrel(name='barrel'):
    col = collection('Props')
    metal = material('BarrelMetal', (0.35, 0.30, 0.22), 0.8, 0.4)
    band = material('BarrelBand', (0.55, 0.18, 0.10), 0.5, 0.45)
    parts = [
        cylinder('Body', 0.26, 0.78, loc=(0, 0, 0.39), verts_n=20, mat=metal, col=col),
        torus('Band1', 0.265, 0.028, loc=(0, 0, 0.20), seg=20, ring=8, mat=band, col=col),
        torus('Band2', 0.265, 0.028, loc=(0, 0, 0.58), seg=20, ring=8, mat=band, col=col),
        cylinder('Cap', 0.24, 0.05, loc=(0, 0, 0.79), verts_n=20, mat=band, col=col),
    ]
    merged = join_objects(parts, name, col)
    shade_auto_smooth(merged, 30)
    return [merged], col


def build_table(name='table'):
    col = collection('Props')
    wood = material('TableTop', (0.42, 0.30, 0.20), 0.05, 0.6)
    metal = material('TableLeg', (0.30, 0.32, 0.35), 0.8, 0.35)
    parts = [
        cylinder('Top', 0.95, 0.07, loc=(0, 0, 0.74), verts_n=28, mat=wood, col=col),
        cylinder('Stem', 0.09, 0.70, loc=(0, 0, 0.37), verts_n=14, mat=metal, col=col),
        cylinder('Foot', 0.42, 0.05, loc=(0, 0, 0.03), verts_n=20, mat=metal, col=col),
    ]
    merged = join_objects(parts, name, col)
    shade_auto_smooth(merged, 30)
    return [merged], col


def build_chair(name='chair'):
    col = collection('Props')
    seat = material('ChairSeat', (0.20, 0.35, 0.42), 0.1, 0.55)
    metal = material('ChairLeg', (0.32, 0.33, 0.35), 0.8, 0.35)
    parts = [
        box('Seat', (0.42, 0.40, 0.07), loc=(0, 0, 0.45), mat=seat, bevel=0.03, bevel_seg=2,
            smooth=True, col=col),
        box('Back', (0.42, 0.07, 0.42), loc=(0, 0.18, 0.68), mat=seat, bevel=0.03, bevel_seg=2,
            smooth=True, col=col),
        cylinder('Post', 0.045, 0.42, loc=(0, 0, 0.24), verts_n=10, mat=metal, col=col),
        cylinder('Base', 0.22, 0.04, loc=(0, 0, 0.03), verts_n=14, mat=metal, col=col),
    ]
    merged = join_objects(parts, name, col)
    shade_auto_smooth(merged, 30)
    return [merged], col


def build_light_fixture(name='light_fixture'):
    col = collection('Props')
    housing = material('LightHousing', (0.18, 0.19, 0.21), 0.6, 0.4)
    tube = material('LightTube', (1.0, 0.95, 0.85), 0.0, 0.2, (1.0, 0.92, 0.78), 5.0)
    parts = [
        box('Housing', (0.90, 0.26, 0.10), loc=(0, 0, 0), mat=housing, bevel=0.02, bevel_seg=2,
            smooth=True, col=col),
        box('Tube', (0.80, 0.18, 0.04), loc=(0, 0, -0.06), mat=tube, bevel=0.01, bevel_seg=1,
            smooth=True, col=col),
    ]
    merged = join_objects(parts, name, col)
    shade_auto_smooth(merged, 30)
    return [merged], col


def build_pipe_set(name='pipe_set'):
    col = collection('Props')
    mat_a = material('PipeSteel', (0.28, 0.30, 0.33), 0.85, 0.38)
    mat_b = material('PipeRust', (0.36, 0.20, 0.12), 0.6, 0.62)
    parts = [
        pipe('P1', [(-1.6, 0, 0), (-0.6, 0, 0), (0.4, 0, 0.06), (1.6, 0, 0)], 0.11, mat_a, col),
        pipe('P2', [(-1.6, 0.34, -0.05), (-0.2, 0.34, -0.05), (0.9, 0.34, 0.12), (1.6, 0.34, 0.12)],
             0.07, mat_b, col),
        torus('FlangeA', 0.14, 0.03, loc=(-0.9, 0, 0), rot=(0, math.pi / 2, 0), seg=14, ring=6,
              mat=mat_b, col=col),
        torus('FlangeB', 0.14, 0.03, loc=(0.7, 0, 0.05), rot=(0, math.pi / 2, 0), seg=14, ring=6,
              mat=mat_b, col=col),
    ]
    merged = join_objects(parts, name, col)
    shade_auto_smooth(merged, 30)
    return [merged], col


def build_plant(name='plant'):
    col = collection('Props')
    pot = material('Pot', (0.38, 0.24, 0.18), 0.0, 0.75)
    leaf = material('Leaf', (0.18, 0.30, 0.16), 0.0, 0.8)
    stem = material('Stem', (0.22, 0.26, 0.16), 0.0, 0.75)
    parts = [
        cone('Pot', 0.20, 0.30, loc=(0, 0, 0.15), verts_n=18, mat=pot, col=col),
        cylinder('Soil', 0.17, 0.03, loc=(0, 0, 0.30), verts_n=18, mat=pot, col=col),
    ]
    for i in range(6):
        a = math.tau * i / 6
        lean = 0.35 + 0.1 * (i % 3)
        parts.append(pipe('LeafStem', [(0, 0, 0.30),
                                       (math.cos(a) * 0.12, math.sin(a) * 0.12, 0.55),
                                       (math.cos(a) * lean, math.sin(a) * lean, 0.78)],
                          0.018, stem, col))
        parts.append(sphere('Leaf', 0.13, loc=(math.cos(a) * lean, math.sin(a) * lean, 0.80),
                            scale=(1.5, 0.7, 0.35), segments=12, rings=8, mat=leaf, col=col))
    merged = join_objects(parts, name, col)
    shade_auto_smooth(merged, 35)
    return [merged], col


def build_medkit(name='medkit'):
    col = collection('Props')
    shell = material('MedShell', (0.80, 0.82, 0.84), 0.2, 0.4)
    cross = material('MedCross', (0.85, 0.12, 0.15), 0.1, 0.45, (0.7, 0.05, 0.05), 0.6)
    parts = [
        box('Shell', (0.52, 0.38, 0.30), loc=(0, 0, 0.15), mat=shell, bevel=0.03, bevel_seg=3,
            smooth=True, col=col),
        box('CrossV', (0.08, 0.02, 0.22), loc=(0, -0.195, 0.15), mat=cross, bevel=0.004,
            bevel_seg=1, smooth=True, col=col),
        box('CrossH', (0.24, 0.02, 0.08), loc=(0, -0.195, 0.15), mat=cross, bevel=0.004,
            bevel_seg=1, smooth=True, col=col),
        box('Handle', (0.16, 0.05, 0.04), loc=(0, 0, 0.32), mat=shell, bevel=0.01, bevel_seg=2,
            smooth=True, col=col),
    ]
    merged = join_objects(parts, name, col)
    shade_auto_smooth(merged, 30)
    return [merged], col


def build_server_rack(name='server_rack'):
    col = collection('Props')
    frame = material('RackFrame', (0.16, 0.17, 0.19), 0.7, 0.42)
    led = material('RackLed', (0.2, 1.0, 0.5), 0.0, 0.2, (0.1, 1.0, 0.4), 5.0)
    parts = [
        box('Frame', (0.80, 0.55, 1.80), loc=(0, 0, 0.90), mat=frame, bevel=0.02, bevel_seg=2,
            smooth=True, col=col),
    ]
    for i in range(8):
        parts.append(box('Slot', (0.66, 0.03, 0.14), loc=(0, -0.285, 0.28 + i * 0.18),
                         mat=frame, bevel=0.006, bevel_seg=1, smooth=True, col=col))
        parts.append(box('LED', (0.05, 0.02, 0.03), loc=(0.22, -0.30, 0.28 + i * 0.18),
                         mat=led, bevel=0.003, bevel_seg=1, smooth=True, col=col))
    merged = join_objects(parts, name, col)
    shade_auto_smooth(merged, 30)
    return [merged], col


def build_sign(name='sign'):
    """Emissive directional sign (used for room signage)."""
    col = collection('Props')
    body = material('SignBody', (0.10, 0.11, 0.13), 0.5, 0.4)
    glow = material('SignGlow', (0.15, 0.85, 1.0), 0.0, 0.25, (0.2, 0.9, 1.0), 4.0)
    parts = [
        box('Plate', (1.10, 0.06, 0.30), loc=(0, 0, 0), mat=body, bevel=0.015, bevel_seg=2,
            smooth=True, col=col),
        box('GlowBar', (0.95, 0.02, 0.10), loc=(0, -0.04, 0.02), mat=glow, bevel=0.005,
            bevel_seg=1, smooth=True, col=col),
    ]
    merged = join_objects(parts, name, col)
    shade_auto_smooth(merged, 30)
    return [merged], col


import os as _os
_ONLY = _os.environ.get('ONLY_MODELS')
_ALL = [
    ('crew', build_crew),
    ('impostor', build_impostor),
    ('husk', build_husk),
    ('console', build_console),
    ('vent', build_vent),
    ('reactor', build_reactor),
    ('crate', build_crate),
    ('barrel', build_barrel),
    ('table', build_table),
    ('chair', build_chair),
    ('light_fixture', build_light_fixture),
    ('pipe_set', build_pipe_set),
    ('plant', build_plant),
    ('medkit', build_medkit),
    ('server_rack', build_server_rack),
    ('sign', build_sign),
]
BUILDERS = [b for b in _ALL if (not _ONLY or b[0] in _ONLY.split(','))]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    manifest_path = os.path.join(OUT_DIR, 'manifest.json')
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    for name, builder in BUILDERS:
        print(f'[build] {name}')
        reset_scene()
        objs, col = builder(name)
        path = export_glb(name, objs, col)
        manifest[name] = {
            'file': f'models/{name}.glb',
            'bytes': os.path.getsize(path),
        }
        cleanup(objs)
    for fn in os.listdir(OUT_DIR):
        if fn.endswith('.glb'): manifest[fn[:-4]] = {'file':'models/'+fn, 'bytes':os.path.getsize(os.path.join(OUT_DIR,fn))}
    with open(os.path.join(OUT_DIR, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
    print('DONE: %d models' % len(manifest))


if __name__ == '__main__':
    main()
