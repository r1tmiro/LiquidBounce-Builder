/**
 * Actors: crewmate / impostor avatars, corpses and name tags.
 */
import * as THREE from 'three';

const COL = {
  cyan: new THREE.Color('#8ec8ff'),
};

export class ActorManager {
  constructor(scene, assets) {
    this.scene = scene;
    this.assets = assets;
    this.group = new THREE.Group();
    this.group.name = 'actors';
    scene.add(this.group);
    this.actors = new Map();   // playerId -> actor
    this.bodies = new Map();   // bodyId -> object
    this.time = 0;
  }

  makeLabel(text, color) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = '600 30px Inter, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: true, depthWrite: false, opacity: 0.9,
    }));
    spr.scale.set(1.3, 0.33, 1);
    return spr;
  }

  /** Create (or refresh) the avatar for a player. */
  ensure(player, opts = {}) {
    let actor = this.actors.get(player.id);
    const isImpostor = opts.impostor;
    const key = player.id;
    if (actor && actor.isImpostor !== isImpostor) {
      this.group.remove(actor.root);
      actor = null;
      this.actors.delete(key);
    }
    if (!actor) {
      const root = new THREE.Group();
      const model = (isImpostor ? this.assets.impostor : this.assets.crew);
      const body = model ? model.clone(true) : new THREE.Group();
      body.traverse(o => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.material = o.material.clone();
        }
      });
      body.scale.setScalar(1.65);
      root.add(body);
      const label = this.makeLabel(player.name, player.color);
      label.position.y = isImpostor ? 1.55 : 1.25;
      root.add(label);
      this.group.add(root);
      actor = {
        id: player.id, root, body, label, isImpostor,
        phase: Math.random() * 10, speed: 0, dead: false, target: { x: player.x, z: player.z },
        yaw: player.yaw || 0, bob: 0, lastStep: 0,
      };
      this.actors.set(key, actor);
    }
    // tint
    const col = new THREE.Color(player.color);
    actor.body.traverse(o => {
      if (!o.isMesh) return;
      const m = o.material;
      if (!m || !m.name) return;
      if (m.name === 'Body' || m.name === 'Flesh') {
        if (isImpostor) {
          m.color.set('#1b1d22');
          m.emissive = new THREE.Color('#120000');
          m.emissiveIntensity = 0.4;
        } else {
          m.color.copy(col);
          m.emissive = new THREE.Color(player.color).multiplyScalar(0.12);
          m.emissiveIntensity = 0.7;
        }
      }
    });
    return actor;
  }

  update(dt, players, snapshotPlayers) {
    this.time += dt;
    for (const p of players) {
      const actor = this.actors.get(p.id);
      if (!actor) continue;
      const target = snapshotPlayers?.get(p.id);
      const tx = target ? target.x : p.x;
      const tz = target ? target.z : p.z;
      const tyaw = target ? target.yaw : p.yaw;

      // smooth interpolation towards the authoritative position
      const k = 1 - Math.pow(0.0008, dt);
      actor.root.position.x += (tx - actor.root.position.x) * k;
      actor.root.position.z += (tz - actor.root.position.z) * k;

      let dy = tyaw - actor.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      actor.yaw += dy * Math.min(1, dt * 12);
      actor.root.rotation.y = actor.yaw;

      const speed = target ? target.speed : p.speed;
      actor.speed += (speed - actor.speed) * Math.min(1, dt * 8);

      // walk bob + lean
      const moving = actor.speed > 0.4;
      actor.phase += dt * (moving ? actor.speed * 4.4 : 1.4);
      const bob = moving ? Math.abs(Math.sin(actor.phase)) * 0.075 : Math.sin(this.time * 1.6) * 0.012;
      actor.body.position.y = bob;
      actor.body.rotation.z = moving ? Math.sin(actor.phase) * 0.045 : 0;
      actor.body.rotation.x = moving ? 0.05 : Math.sin(this.time * 0.9) * 0.012;
      actor.body.scale.y = 1.65 * (1 + (moving ? Math.abs(Math.sin(actor.phase)) * 0.02 : 0));
      actor.label.position.y = 1.9;
      actor.label.visible = actor.root.visible && (target?.alive || p.alive);

      // step events
      if (moving) {
        const step = Math.floor(actor.phase / Math.PI);
        if (step !== actor.lastStep) {
          actor.lastStep = step;
          actor.onStep && actor.onStep(p);
        }
      }
    }
  }

  /** Spawn a corpse for a reported body. */
  ensureBody(body) {
    if (this.bodies.has(body.id)) return this.bodies.get(body.id);
    const root = new THREE.Group();
    const model = this.assets.husk;
    const m = model ? model.clone(true) : new THREE.Group();
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    root.add(m);
    root.position.set(body.x, 0, body.z);
    root.rotation.y = Math.random() * Math.PI * 2;
    this.group.add(root);
    this.bodies.set(body.id, root);
    return root;
  }

  removeBody(id) {
    const b = this.bodies.get(id);
    if (b) { this.group.remove(b); this.bodies.delete(id); }
  }

  clear() {
    for (const a of this.actors.values()) this.group.remove(a.root);
    for (const b of this.bodies.values()) this.group.remove(b);
    this.actors.clear();
    this.bodies.clear();
  }

  /** World position of an actor (for kill effects). */
  positionOf(id) {
    const a = this.actors.get(id);
    return a ? a.root.position.clone() : new THREE.Vector3();
  }
}
