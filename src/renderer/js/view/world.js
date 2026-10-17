/**
 * World construction: turns the level definition into three.js geometry,
 * materials, lights and props.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROOMS, CORRIDORS, DOORS, PROPS, TASKS, VENTS, EMERGENCY_BUTTON, LIGHTS, AMBIENT, WALL_HEIGHT, PALETTE } from '../../../shared/map/definition.js';
import { wallMaps, floorMaps, ceilingMaps, metalMaps } from './textures.js';

const ACCENT = new THREE.Color('#c47a20');
const DARK = new THREE.Color('#141a24');

function makeWallMaterial() {
  const maps = wallMaps(512);
  const mat = new THREE.MeshStandardMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    roughnessMap: maps.roughnessMap,
    normalScale: new THREE.Vector2(0.8, 0.8),
    color: 0xffffff,
    roughness: 0.82,
    metalness: 0.25,
  });
  return mat;
}

export function buildWorld(scene, grid) {
  const group = new THREE.Group();
  group.name = 'world';
  scene.add(group);

  const wallMat = makeWallMaterial();
  const floorTex = floorMaps(512);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex.map, normalMap: floorTex.normalMap, roughnessMap: floorTex.roughnessMap,
    color: 0xb9c2d0, roughness: 0.72, metalness: 0.32,
  });
  const ceilMat = new THREE.MeshStandardMaterial({
    map: ceilingMaps(256).map, color: 0x8f98a8, roughness: 0.9, metalness: 0.1,
  });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x2b3240, roughness: 0.55, metalness: 0.6 });
  const accentMat = new THREE.MeshStandardMaterial({
    color: ACCENT, roughness: 0.42, metalness: 0.35,
    emissive: new THREE.Color(0x3a1f05), emissiveIntensity: 0.6,
  });
  const metalTex = metalMaps(256);
  const propMat = new THREE.MeshStandardMaterial({
    map: metalTex.map, roughnessMap: metalTex.roughnessMap, roughness: 0.55, metalness: 0.72,
    color: 0xcfd6e2,
  });

  // ---------------------------------------------------------------- floors
  const floorGeos = [];
  const ceilGeos = [];
  const allRects = [
    ...ROOMS.map(r => ({ ...r, h: WALL_HEIGHT })),
    ...CORRIDORS.map(c => ({ ...c, h: 3.0, name: c.id })),
  ];
  for (const r of allRects) {
    const g = new THREE.PlaneGeometry(r.rect[2], r.rect[3]);
    g.rotateX(-Math.PI / 2);
    g.translate(r.rect[0] + r.rect[2] / 2, 0, r.rect[1] + r.rect[3] / 2);
    floorGeos.push(g);

    const c = new THREE.PlaneGeometry(r.rect[2], r.rect[3]);
    c.rotateX(Math.PI / 2);
    c.translate(r.rect[0] + r.rect[2] / 2, r.h, r.rect[1] + r.rect[3] / 2);
    ceilGeos.push(c);
  }
  const floors = new THREE.Mesh(mergeGeometries(floorGeos, false), floorMat);
  floors.receiveShadow = true;
  group.add(floors);

  const ceilings = new THREE.Mesh(mergeGeometries(ceilGeos, false), ceilMat);
  group.add(ceilings);

  // floor UV scaling so the texture keeps a constant world size
  const uv = floors.geometry.attributes.uv;
  const pos = floors.geometry.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, pos.getX(i) / 4, pos.getZ(i) / 4);
  }
  uv.needsUpdate = true;

  // ----------------------------------------------------------------- walls
  const wallGeos = [];
  const trimGeos = [];
  for (const w of grid.walls) {
    const dx = w.x2 - w.x1, dz = w.z2 - w.z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const ang = Math.atan2(dz, dx);
    const g = new THREE.BoxGeometry(len, WALL_HEIGHT, 0.26);
    g.rotateY(-ang);
    g.translate((w.x1 + w.x2) / 2, WALL_HEIGHT / 2, (w.z1 + w.z2) / 2);
    wallGeos.push(g);

    const t = new THREE.BoxGeometry(len, 0.16, 0.34);
    t.rotateY(-ang);
    t.translate((w.x1 + w.x2) / 2, 0.08, (w.z1 + w.z2) / 2);
    trimGeos.push(t);

    const t2 = new THREE.BoxGeometry(len, 0.1, 0.32);
    t2.rotateY(-ang);
    t2.translate((w.x1 + w.x2) / 2, WALL_HEIGHT - 0.22, (w.z1 + w.z2) / 2);
    trimGeos.push(t2);
  }
  if (wallGeos.length) {
    const walls = new THREE.Mesh(mergeGeometries(wallGeos, false), wallMat);
    walls.castShadow = true;
    walls.receiveShadow = true;
    group.add(walls);
  }
  if (trimGeos.length) {
    const trim = new THREE.Mesh(mergeGeometries(trimGeos, false), trimMat);
    group.add(trim);
  }

  // ------------------------------------------------------------ door frames
  const frameGeos = [];
  for (const d of DOORS) {
    const room = ROOMS.find(r => r.id === d.room);
    if (!room) continue;
    const hw = d.width / 2;
    const h = 2.55;
    let cx, cz, rotY;
    if (d.side === 'north') { cx = d.at; cz = room.rect[1]; rotY = 0; }
    else if (d.side === 'south') { cx = d.at; cz = room.rect[1] + room.rect[3]; rotY = 0; }
    else if (d.side === 'west') { cx = room.rect[0]; cz = d.at; rotY = Math.PI / 2; }
    else { cx = room.rect[0] + room.rect[2]; cz = d.at; rotY = Math.PI / 2; }

    for (const s of [-1, 1]) {
      const post = new THREE.BoxGeometry(0.22, h, 0.42);
      post.translate(s * (hw + 0.11), h / 2, 0);
      post.rotateY(rotY);
      post.translate(cx, 0, cz);
      frameGeos.push(post);
    }
    const lintel = new THREE.BoxGeometry(d.width + 0.44, 0.26, 0.42);
    lintel.translate(0, h + 0.13, 0);
    lintel.rotateY(rotY);
    lintel.translate(cx, 0, cz);
    frameGeos.push(lintel);

    // hazard stripe plate above the door
    const plate = new THREE.BoxGeometry(d.width, 0.12, 0.30);
    plate.translate(0, h + 0.32, 0);
    plate.rotateY(rotY);
    plate.translate(cx, 0, cz);
    frameGeos.push(plate);
  }
  if (frameGeos.length) {
    const frames = new THREE.Mesh(mergeGeometries(frameGeos, false), accentMat);
    group.add(frames);
  }

  // ---------------------------------------------------------------- lights
  const lightRig = [];
  for (const l of LIGHTS) {
    const light = new THREE.PointLight(l.color, l.intensity * 18, l.range, 1.6);
    light.position.set(l.pos[0], l.pos[1], l.pos[2]);
    light.castShadow = false;
    group.add(light);

    const bulb = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, 0.05, 0.2),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: new THREE.Color(l.color), emissiveIntensity: 2.4,
        roughness: 0.4, metalness: 0,
      })
    );
    bulb.position.set(l.pos[0], l.pos[1] - 0.04, l.pos[2]);
    group.add(bulb);

    lightRig.push({ light, bulb, base: l.intensity * 18, flicker: l.flicker, pos: l.pos, seed: Math.random() * 100 });
  }

  // ambient + fog
  scene.fog = new THREE.Fog(AMBIENT.fog, AMBIENT.fogNear, AMBIENT.fogFar);
  const ambient = new THREE.HemisphereLight(AMBIENT.color, 0x05070b, AMBIENT.intensity);
  scene.add(ambient);

  // --------------------------------------------------------------- room tint
  // subtle coloured floor patches so each room reads differently
  for (const r of ROOMS) {
    const col = new THREE.Color(r.accent);
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(r.rect[2] - 0.4, r.rect[3] - 0.4),
      new THREE.MeshBasicMaterial({
        color: col, transparent: true, opacity: 0.055, depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(r.rect[0] + r.rect[2] / 2, 0.012, r.rect[1] + r.rect[3] / 2);
    group.add(patch);
  }

  const api = {
    group,
    lights: lightRig,
    ambient,
    update(dt, t, cameraPos, activeCount = 10) {
      // keep only the closest lights enabled (forward renderer limit)
      const sorted = lightRig
        .map(l => ({ l, d: (l.pos[0] - cameraPos.x) ** 2 + (l.pos[2] - cameraPos.z) ** 2 }))
        .sort((a, b) => a.d - b.d);
      for (let i = 0; i < sorted.length; i++) {
        const { l } = sorted[i];
        const on = i < activeCount;
        l.light.visible = on;
        l.bulb.visible = on;
        if (!on) continue;
        let f = 1;
        if (l.flicker > 0) {
          const n = Math.sin(t * 11 + l.seed) * Math.sin(t * 3.3 + l.seed * 1.7) * Math.sin(t * 27.1 + l.seed);
          const spike = Math.sin(t * 0.7 + l.seed) > 0.985 ? 0.25 : 1;
          f = 1 - l.flicker * (0.5 + 0.5 * n) * spike;
        }
        l.light.intensity = l.base * f;
        l.bulb.material.emissiveIntensity = 2.4 * f;
      }
    },
  };
  return api;
}

/** Place the GLB props and task consoles. */
export function buildProps(scene, assets, grid) {
  const group = new THREE.Group();
  group.name = 'props';
  scene.add(group);
  const placements = [
    ...VENTS.map(v => ({model:'vent', pos:v.pos, rotY:0, scale:1})),
    ...PROPS.map(p => ({ model: p.model, pos: p.pos, rotY: p.rotY || 0, scale: p.scale || 1 })),
    ...TASKS.map(t => ({ model: 'console', pos: t.console, rotY: consoleFacing(t), scale: 1 })),
  ];
  for (const p of placements) {
    const src = assets[p.model];
    if (!src) continue;
    const obj = src.clone(true);
    obj.position.set(p.pos[0], p.pos[1], p.pos[2]);
    obj.rotation.y = p.rotY;
    obj.name = p.model;
    if (p.scale !== 1) obj.scale.setScalar(p.scale);
    obj.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    group.add(obj);
  }
  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 20), new THREE.MeshStandardMaterial({color:0xdd2020, emissive:0x6a0000}));
  button.position.set(EMERGENCY_BUTTON.pos[0], 0.95, EMERGENCY_BUTTON.pos[2]); group.add(button);
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.85, 12), new THREE.MeshStandardMaterial({color:0x353c48, metalness:0.7, roughness:0.4}));
  pedestal.position.copy(button.position); pedestal.position.y = 0.425; group.add(pedestal);
  return group;
}

function consoleFacing(task) {
  // consoles stand against the wall of their room: point them towards the room centre
  const room = ROOMS.find(r => r.id === task.room);
  if (!room) return 0;
  const cx = room.rect[0] + room.rect[2] / 2;
  const cz = room.rect[1] + room.rect[3] / 2;
  const dx = cx - task.console[0];
  const dz = cz - task.console[2];
  return Math.atan2(dx, dz);
}
