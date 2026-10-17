"""Render preview images for every exported GLB so the assets can be visually verified."""
import bpy
import os
import math
import sys
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MODEL_DIR = os.path.join(ROOT, 'assets', 'models')
OUT_DIR = os.path.join(ROOT, 'assets', 'previews')

SAMPLES = int(os.environ.get('PREVIEW_SAMPLES', '24'))
RES = int(os.environ.get('PREVIEW_RES', '420'))


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def setup_world(strength=0.05, color=(0.05, 0.06, 0.08)):
    world = bpy.data.worlds.new('World')
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (color[0], color[1], color[2], 1.0)
    bg.inputs[1].default_value = strength


def add_area(name, loc, energy, size, rot=(0, 0, 0), color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = energy
    ld.size = size
    ld.color = color
    obj = bpy.data.objects.new(name, ld)
    obj.location = loc
    obj.rotation_euler = rot
    bpy.context.scene.collection.objects.link(obj)
    return obj


def add_point(name, loc, energy, color=(1, 1, 1), radius=0.3):
    ld = bpy.data.lights.new(name, 'POINT')
    ld.energy = energy
    ld.color = color
    ld.shadow_soft_size = radius
    obj = bpy.data.objects.new(name, ld)
    obj.location = loc
    bpy.context.scene.collection.objects.link(obj)
    return obj


def setup_floor(z=0.0, size=20):
    me = bpy.data.meshes.new('Floor')
    me.from_pydata([(-size, -size, z), (size, -size, z), (size, size, z), (-size, size, z)],
                   [], [(0, 1, 2, 3)])
    me.update()
    mat = bpy.data.materials.new('FloorMat')
    mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.07, 0.08, 0.10, 1)
    b.inputs['Roughness'].default_value = 0.7
    me.materials.append(mat)
    obj = bpy.data.objects.new('Floor', me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def frame_camera(objects, cam_obj, direction=(1.0, -1.35, 0.72), margin=1.35):
    """Place camera so that all objects fit, looking at their bbox centre."""
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    deps = bpy.context.evaluated_depsgraph_get()
    for o in objects:
        if o.type != 'MESH':
            continue
        ev = o.evaluated_get(deps)
        for corner in ev.bound_box:
            w = ev.matrix_world @ Vector(corner)
            mins = Vector((min(mins[i], w[i]) for i in range(3)))
            maxs = Vector((max(maxs[i], w[i]) for i in range(3)))
    centre = (mins + maxs) / 2
    radius = max((maxs - mins).length / 2, 0.35)
    d = Vector(direction).normalized()
    cam_obj.location = centre + d * (radius * margin * 2.6)
    look = (centre - cam_obj.location).normalized()
    cam_obj.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
    cam_obj.data.lens = 55


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    files = sorted(f for f in os.listdir(MODEL_DIR) if f.endswith('.glb'))
    only = sys.argv[1:] if len(sys.argv) > 1 else None
    for f in files:
        name = f[:-4]
        if only and name not in only:
            continue
        clear()
        setup_world()
        bpy.ops.import_scene.gltf(filepath=os.path.join(MODEL_DIR, f))
        objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
        if not objs:
            print('EMPTY', f)
            continue
        # normalise: put the model on the floor, centred at origin
        deps = bpy.context.evaluated_depsgraph_get()
        mins = Vector((1e9, 1e9, 1e9))
        maxs = Vector((-1e9, -1e9, -1e9))
        for o in objs:
            ev = o.evaluated_get(deps)
            for corner in ev.bound_box:
                w = ev.matrix_world @ Vector(corner)
                mins = Vector((min(mins[i], w[i]) for i in range(3)))
                maxs = Vector((max(maxs[i], w[i]) for i in range(3)))
        centre = (mins + maxs) / 2
        height = maxs.z - mins.z
        for o in objs:
            o.location.z -= mins.z
        setup_floor(0.0, max(6, height * 3))

        cam_data = bpy.data.cameras.new('Cam')
        cam = bpy.data.objects.new('Cam', cam_data)
        bpy.context.scene.collection.objects.link(cam)
        bpy.context.scene.camera = cam
        frame_camera(objs, cam)

        key = add_area('Key', (3.2, -3.4, 4.2), 900, 3.0, rot=(math.radians(40), 0, math.radians(40)),
                       color=(1.0, 0.95, 0.88))
        fill = add_area('Fill', (-3.6, -2.2, 2.2), 260, 4.0, rot=(math.radians(65), 0, math.radians(-55)),
                        color=(0.55, 0.70, 1.0))
        rim = add_area('Rim', (-1.2, 3.6, 3.0), 700, 2.5, rot=(math.radians(125), 0, math.radians(200)),
                       color=(0.9, 0.5, 1.0))
        add_point('Amb', (0, 0, 2.4), 120, (0.7, 0.78, 1.0), 1.2)

        scene = bpy.context.scene
        scene.render.engine = 'CYCLES'
        scene.cycles.device = 'CPU'
        scene.cycles.samples = SAMPLES
        scene.cycles.use_denoising = True
        scene.render.resolution_x = RES
        scene.render.resolution_y = RES
        scene.render.film_transparent = False
        scene.view_settings.view_transform = 'Filmic' if 'Filmic' in [
            v.name for v in scene.view_settings.bl_rna.properties['view_transform'].enum_items
        ] else 'Standard'
        scene.view_settings.look = 'None'
        path = os.path.join(OUT_DIR, name + '.png')
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print('PREVIEW', name, '->', path)


if __name__ == '__main__':
    main()
