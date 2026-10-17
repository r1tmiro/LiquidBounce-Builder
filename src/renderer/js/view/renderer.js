/**
 * Renderer: three.js setup, camera rig, post-processing and the horror look.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Final grade: vignette, grain, scanlines, chromatic aberration, dread warp. */
const HorrorShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uDread: { value: 0 },
    uGrain: { value: 1 },
    uAberration: { value: 1 },
    uVignette: { value: 1 },
    uFlash: { value: 0 },
    uTint: { value: new THREE.Color(0.02, 0.0, 0.0) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uDread, uGrain, uAberration, uVignette, uFlash;
    uniform vec3 uTint;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;
      vec2 center = uv - 0.5;
      float dist = length(center);

      // barrel warp grows with dread
      float warp = 0.02 + uDread * 0.10;
      uv = 0.5 + center * (1.0 + warp * dist * dist);

      // chromatic aberration
      float ab = (0.0016 + uDread * 0.008) * uAberration;
      vec2 dir = normalize(center + 1e-5);
      float r = texture2D(tDiffuse, uv + dir * ab).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - dir * ab).b;
      vec3 col = vec3(r, g, b);

      // cold shadows / warm highlights
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col * vec3(0.86, 0.95, 1.12), col * vec3(1.06, 1.0, 0.92), smoothstep(0.15, 0.75, luma));

      // dread desaturation + red pulse
      float pulse = 0.5 + 0.5 * sin(uTime * 3.4);
      col = mix(col, vec3(luma) * vec3(1.15, 0.72, 0.72), uDread * 0.35);
      col += uTint * uDread * pulse * 0.35;

      // scanlines
      float scan = 0.965 + 0.035 * sin(uv.y * 900.0);
      col *= mix(1.0, scan, uGrain);

      // film grain
      float grain = hash(uv * vec2(1024.0, 768.0) + fract(uTime) * 91.7) - 0.5;
      col += grain * 0.009 * uGrain * (1.0 + uDread);

      // vignette
      float vig = smoothstep(0.92, 0.28, dist);
      col *= mix(1.0, vig, uVignette * (0.75 + uDread * 0.25));

      // damage / flash
      col = mix(col, vec3(1.0, 0.15, 0.12), uFlash);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance', stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05070b');

    this.camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.08, 220);
    this.camera.position.set(0, 1.6, 0);

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.4, 1.0
    );
    this.composer.addPass(this.bloom);

    this.horror = new ShaderPass(HorrorShader);
    this.composer.addPass(this.horror);

    this.output = new OutputPass();
    this.composer.addPass(this.output);

    // flashlight
    this.flashlight = new THREE.SpotLight(0xfff0d8, 0, 26, Math.PI / 7.5, 0.55, 1.2);
    this.flashlight.position.set(0, 0, 0);
    this.flashlightTarget = new THREE.Object3D();
    this.scene.add(this.flashlight);
    this.scene.add(this.flashlightTarget);
    this.flashlight.target = this.flashlightTarget;

    this.shake = 0;
    this.dread = 0;
    this.time = 0;
    this.fov = 78;
    this.menuMode = true;
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  setQuality(level) {
    const dpr = { low: 1, medium: Math.min(window.devicePixelRatio, 1.5), high: Math.min(window.devicePixelRatio, 2) }[level] || 1.5;
    this.renderer.setPixelRatio(dpr);
    this.bloom.enabled = level !== 'low';
    this.renderer.shadowMap.enabled = level === 'high';
    this.scene.traverse(o => { if (o.isMesh) o.material.needsUpdate = true; });
    this.resize();
  }

  setGrain(on) { this.horror.uniforms.uGrain.value = on ? 1 : 0; }
  setAberration(on) { this.horror.uniforms.uAberration.value = on ? 1 : 0; }

  addShake(amount) { this.shake = Math.min(1.2, this.shake + amount); }

  /** Camera rig for the first person view. */
  updateCamera(dt, { pos, yaw, pitch, running, bobPhase }) {
    const speedBob = running ? 0.055 : 0.028;
    const bobY = Math.sin(bobPhase) * speedBob;
    const bobX = Math.cos(bobPhase * 0.5) * speedBob * 0.6;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const sh = this.shake * this.shake;
    const sx = (Math.random() - 0.5) * sh * 0.16;
    const sy = (Math.random() - 0.5) * sh * 0.16;

    this.camera.position.set(
      pos.x + bobX * Math.cos(yaw) + sx,
      pos.y + bobY + sy,
      pos.z - bobX * Math.sin(yaw)
    );
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(yaw);
    this.camera.rotateX(pitch);
    this.camera.rotateZ(sy * 0.6);

    const targetFov = this.fov + (running ? 5 : 0);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 5);
    this.camera.updateProjectionMatrix();
  }

  updateDread(dt, value) {
    this.dread += (value - this.dread) * Math.min(1, dt * 2.2);
    this.horror.uniforms.uDread.value = this.dread;
  }

  setFlash(v) { this.horror.uniforms.uFlash.value = v; }

  render(dt) {
    this.time += dt;
    this.horror.uniforms.uTime.value = this.time;
    this.renderer.info.reset();
    this.composer.render();
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}
