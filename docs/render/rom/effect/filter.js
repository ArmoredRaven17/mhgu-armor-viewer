// AN EFFECT'S SCREEN FILTER (generator type 9, cParticleGeneratorFilter), drawn the way the game draws it
// (E:\offline\decode\notes\effects-filter.md, the Filter Agent's decode of 2026-09-21).
//
// The effect's own code runs lifted: every frame its post (0xa8262c -> 0xa826bc) turns each live particle into a
// 0xf0-byte request and submits it (0xb8f05c), which proof.js takes into the request state's `filters`. What
// follows is sEffect's side, which is not effect code: its per-view uMultiBlurFilter unit ranks the frame's
// requests and draws the best one with uRadialBlurFilter's draw 0x8b60cc in render pass 0x16 -- after the scene
// and the effects (pass 0x11) -- as a radial (zoom) blur of the frame toward the particle's screen point.
//
//   rank(requests, camera)              0xc60540 (+ weight 0xc60f90, depth key 0xc6125c): the one drawn, and s0
//   constants(entry, s0, camera, W, H)  0x8b60cc's CPU half: centre, width, fade, colour, UV limits (5.2 / 5.4)
//   FilterPass                          the draw: the frame copied (0x87d9d0), one full-viewport quad (0x8accc8)
//                                       with VS/PS_RadialBlurFilter (5.5), blending off, no depth, no culling
//
// camera: { position, dir, view, viewProj } in GAME units (live.js cameraMatrices; dir is the camera's forward).
// Only what the shipped data reaches is taken: kind 0, types 0-5, byte2 0 (BSDefault, pass 0), no mask, no
// occlusion, no cone or screen-edge factor (every shipped row: effects-filter.md section 8). Anything else is
// refused (Unverified), not approximated.
import * as THREE from 'three';
import { Unverified } from './mem.js';

const F = Math.fround;
const view8 = b => new DataView(b.buffer, b.byteOffset, b.byteLength);
const K = [1, 1, 1, 1];                                   // [0x1917610]: the colour the fade lerps from

// The per-view weight (0xc60f90) for view 0, the viewer's one view. entry: the 0xf0 bytes.
function weight(d, cam){
  if (!(d.getUint32(0x00, true) & 1)) return 0;                                  // the unit's view bit & entry+0 & 0x3ff
  const a = d.getFloat32(0x20, true);                                           // entry+0x20[view 0]
  const type = d.getUint8(0x80);
  if (type > 5) return 0;
  const flags = d.getUint32(0xcc, true);
  if (flags & 0xff) throw new Unverified('0x8ad018 filter cone factor (flags byte 0)');
  if (flags & 0x1000000) throw new Unverified('0x8ad200 filter screen-edge factor (flags bit 24)');
  if (type === 0 || type === 3) return screenFade(d, a);
  const px = d.getFloat32(0x50, true), py = d.getFloat32(0x54, true), pz = d.getFloat32(0x58, true);
  return distanceFade(a, Math.hypot(px - cam.position[0], py - cam.position[1], pz - cam.position[2]),
                      d.getFloat32(0x90, true), d.getFloat32(0x94, true));
}
// D: 0 beyond far; s at or inside near; 0 when far <= near; else s x (far - d) / (far - near)
function distanceFade(s, dist, near, far){
  if (dist > far) return 0;
  if (dist <= near) return s;
  if (far <= near) return 0;
  return F(s * F(F(far - dist) / F(far - near)));
}
// types 0/3: the screen fade of 5.2, from the request's centre (p+0x00/+0x04) and fades (p+0x58..+0x64)
function screenFade(d, s){
  const cx = d.getFloat32(0x40, true), cy = d.getFloat32(0x44, true);
  const ax = Math.abs(F(0.5 - cx)), ay = Math.abs(F(0.5 - cy));
  const y0 = d.getFloat32(0x98, true), y1 = d.getFloat32(0x9c, true), x0 = d.getFloat32(0xa0, true), x1 = d.getFloat32(0xa4, true);
  if (ax > x1 || ay > y1) return 0;
  if (ax > x0) s = x1 > x0 ? F(s * F(F(x1 - ax) / F(x1 - x0))) : 0;
  if (ay > y0) s = y1 > y0 ? F(s * F(F(y1 - ay) / F(y1 - y0))) : 0;
  return s;
}
// the depth key (0xc6125c): types 0/3 none; else |the view-space depth| as an int
function depthKey(d, cam){
  const type = d.getUint8(0x80);
  if (type === 0 || type === 3) return 0;
  const e = cam.view.elements, x = d.getFloat32(0x50, true), y = d.getFloat32(0x54, true), z = d.getFloat32(0x58, true);
  return Math.trunc(Math.abs(e[2] * x + e[6] * y + e[10] * z + e[14]));
}

// 0xc60540 for view 0: the candidates (weight > 0) sorted -- priority, remaining life larger first, depth key
// smaller, weight larger, then effect id, row, particle larger -- and draw max 1 (mMBFDrawMax): the first is drawn.
// s0 is the per-view alpha of the LAST entry the loop fetched (0xc60854 / 0xc60894), not the drawn one's.
export function rank(requests, cam){
  if (!requests.length) return null;
  const c = [];
  for (const r of requests){
    if (r.param) throw new Unverified('0xa826bc filter request with a mask texture (param)');
    const d = view8(r.bytes);
    const w = weight(d, cam);
    if (w > 0) c.push({ r, d, w, key: depthKey(d, cam) });
  }
  const s0 = view8(requests[requests.length - 1].bytes).getFloat32(0x20, true);
  if (!c.length) return null;
  const u = (d, o) => d.getUint32(o, true);
  c.sort((a, b) => (u(b.d, 0x04) & 0xffff) - (u(a.d, 0x04) & 0xffff) || u(b.d, 0x08) - u(a.d, 0x08) || a.key - b.key ||
                   b.w - a.w || u(b.d, 0x0c) - u(a.d, 0x0c) || (u(b.d, 0x10) & 0xffff) - (u(a.d, 0x10) & 0xffff) ||
                   (u(b.d, 0x14) & 0xffff) - (u(a.d, 0x14) & 0xffff));
  return { entry: c[0].r.bytes, s0 };
}

// 0x8b60cc's CPU half for entry (p = entry + 0x40) and s16 = s0, over a W x H viewport at (0, 0).
export function constants(entry, s16, cam, W, H){
  const d = view8(entry);
  const type = d.getUint8(0x80), samples = d.getUint8(0x81), byte2 = d.getUint8(0x82);
  if (byte2 !== 0) throw new Unverified('0x8b7fb0 filter blend ' + byte2 + ' (pass 1)');
  if (type > 5) throw new Unverified('0x8b7c08 filter type ' + type);
  if (d.getUint8(0xcf) & 6) throw new Unverified('0x8b694c filter occlusion pre-pass');
  let k = d.getFloat32(0x88, true);
  let sx, sy;
  if (type === 0 || type === 3){
    sx = d.getFloat32(0x40, true); sy = d.getFloat32(0x44, true);
    s16 = screenFade(d, s16);
  } else {
    const pos = [d.getFloat32(0x50, true), d.getFloat32(0x54, true), d.getFloat32(0x58, true)];
    const camP = cam.position, camD = cam.dir;
    const dist = Math.hypot(pos[0] - camP[0], pos[1] - camP[1], pos[2] - camP[2]);
    const D = distanceFade(s16, dist, d.getFloat32(0x90, true), d.getFloat32(0x94, true));
    let dir = [F(camP[0] - pos[0]), F(camP[1] - pos[1]), F(camP[2] - pos[2])];
    const len2 = F(F(dir[0] * dir[0]) + F(dir[1] * dir[1]) + F(dir[2] * dir[2]));
    if (len2 === 0) dir = [-camD[0], -camD[1], -camD[2]];
    else if (len2 >= 1.1920929e-7){ const l = F(Math.sqrt(len2)); dir = dir.map(v => F(v / l)); }
    const cos = F(F(F(dir[0] * -camD[0]) + F(dir[1] * -camD[1])) + F(dir[2] * -camD[2]));
    k = F(k * F(F(Math.abs(cos) + 1) * 0.5));
    const along = dist === 0 || cos === 0;
    const q = along ? [pos[0] + camD[0], pos[1] + camD[1], pos[2] + camD[2]] : pos;
    const v = new THREE.Vector4(q[0], q[1], q[2], 1).applyMatrix4(cam.viewProj);
    const iw = v.w === 0 ? 0 : 1 / v.w;
    const uu = v.x * iw, vv = v.y * iw;
    if (cos < 0 && !along){ sx = (-uu + 1) / 2; sy = (1 + vv) / 2; } else { sx = (uu + 1) / 2; sy = (1 - vv) / 2; }
    sx = Math.min(2, Math.max(-1, sx)); sy = Math.min(2, Math.max(-1, sy));
    if (type === 2 || type === 5) k = F(k * D);
    s16 = D;
  }
  const n = Math.min(samples, 15);
  const c = [d.getFloat32(0x60, true), d.getFloat32(0x64, true), d.getFloat32(0x68, true), d.getFloat32(0x6c, true)];
  const lerp = i => F(F(s16 * c[i]) + F(F(1 - s16) * K[i]));
  const C = type >= 3 ? [F(lerp(0) / n), F(lerp(1) / n), F(lerp(2) / n), c[3]] : [lerp(0), lerp(1), lerp(2), c[3]];
  return {
    n, scaleFade: type < 3,
    center: [sx, sy],                                                             // (vx0 + s(vx1 - vx0)) / W with vx0 = 0
    start: d.getFloat32(0x84, true), width: k, color: C, threshold: d.getFloat32(0x8c, true),
    widthScale: d.getFloat32(0xe4, true), widthOffset: d.getFloat32(0xe0, true),
    uvMin: [0.5 / W, 0.5 / H], uvMax: [(W - 0.5) / W, (H - 0.5) / H],
  };
}

// VS/PS_RadialBlurFilter (mfxprog.py, effects-filter.md 5.5), FRadialBlurWidth / FRadialBlurAlpha without
// occlusion and FRadialFilterMaskDisable, FRadialFilterAlphaColor with alpha 1. The uvs are the game's (v down,
// the quad's corner (-1, 1) at uv (0, 0)); the copy is GL's, so a sample reads row 1 - v.
// THE ALPHA, a viewer adaptation and not the ROM: the game writes C.a into an opaque frame that holds the stage
// as well, blending off. The viewer's canvas is transparent over a CSS backdrop, so C.a = 1 written everywhere
// would paint black where nothing is drawn. The canvas holds premultiplied colour, so the layer is blurred as
// premultiplied RGBA: each sample's alpha is averaged with the weights the colour gets, normalised (C.a x the
// mean coverage). The backdrop, which the game would blur too, is not in the canvas and stays sharp.
const VS = `
precision highp float;
precision highp int;
in vec2 position; in vec2 uv;
uniform vec2 uCenter, uUVMin, uUVMax;
uniform float uStart, uWidth;
uniform int uN;
out vec4 vTex[8];
void main(){
  gl_Position = vec4(position, 0.0, 1.0);
  float n = 1.0 / float(uN - 1);
  vec2 t = uv - uCenter;
  vec2 s[16];
  for (int i = 0; i < 16; i++){
    float scale = uStart + uWidth * (float(i) * n);
    s[i] = i < uN ? clamp(t * scale + uCenter, uUVMin, uUVMax) : vec2(0.0);
  }
  vTex[0] = vec4(s[0], s[1]);   vTex[1] = vec4(s[2], s[3]);   vTex[2] = vec4(s[4], s[5]);   vTex[3] = vec4(s[6], s[7]);
  vTex[4] = vec4(s[8], s[9]);   vTex[5] = vec4(s[10], s[11]); vTex[6] = vec4(s[12], s[13]); vTex[7] = vec4(s[14], s[15]);
}`;
const FS = `
precision highp float;
precision highp int;
uniform sampler2D tBase;
uniform vec4 uColor;
uniform float uThreshold;
uniform int uN;
uniform bool uScaleFade;
in vec4 vTex[8];
out vec4 outColor;
void main(){
  vec2 s[16] = vec2[16](vTex[0].xy, vTex[0].zw, vTex[1].xy, vTex[1].zw, vTex[2].xy, vTex[2].zw, vTex[3].xy, vTex[3].zw,
                        vTex[4].xy, vTex[4].zw, vTex[5].xy, vTex[5].zw, vTex[6].xy, vTex[6].zw, vTex[7].xy, vTex[7].zw);
  vec3 color = vec3(0.0);
  float cover = 0.0, wsum = 0.0;
  for (int i = 0; i < 16; i++){
    if (i >= uN) break;
    vec4 c = texture(tBase, vec2(s[i].x, 1.0 - s[i].y));
    float w = uScaleFade ? (float(uN) - float(i)) / float(uN) : 1.0;
    color += max(c.rgb - uThreshold, 0.0) * w;
    cover += c.a * w; wsum += w;
  }
  outColor = vec4(color * uColor.rgb, uColor.a * cover / wsum);
}`;

export class FilterPass {
  constructor(){
    const g = new THREE.BufferGeometry();
    // 0x8acde8..0x8ace40: IAFilter2, a strip of (position, uv) -- drawn here as its two triangles
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 1, -1, -1, 1, 1, 1, 1, -1, -1, 1, -1], 2));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1], 2));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);   // three.js would compute it from xyz; these are xy
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS,
      uniforms: { tBase: { value: null }, uCenter: { value: new THREE.Vector2() }, uUVMin: { value: new THREE.Vector2() },
                  uUVMax: { value: new THREE.Vector2() }, uStart: { value: 1 }, uWidth: { value: 0 }, uN: { value: 15 },
                  uColor: { value: new THREE.Vector4() }, uThreshold: { value: 0 }, uScaleFade: { value: false } },
      blending: THREE.NoBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.copy = null;
  }
  // after everything the frame draws before pass 0x16: copy the canvas (0x87d9d0), then the one quad over it
  draw(renderer, k){
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (!this.copy || this.copy.image.width !== size.x || this.copy.image.height !== size.y){
      if (this.copy) this.copy.dispose();
      this.copy = new THREE.FramebufferTexture(size.x, size.y);
      this.copy.minFilter = this.copy.magFilter = THREE.NearestFilter;    // SSBorderPoint; the uv clamp keeps inside
    }
    renderer.copyFramebufferToTexture(this.copy, new THREE.Vector2(0, 0));
    const u = this.material.uniforms;
    u.tBase.value = this.copy;
    u.uCenter.value.set(k.center[0], k.center[1]);
    u.uUVMin.value.set(k.uvMin[0], k.uvMin[1]); u.uUVMax.value.set(k.uvMax[0], k.uvMax[1]);
    u.uStart.value = k.start; u.uWidth.value = k.width; u.uN.value = k.n;
    u.uColor.value.set(k.color[0], k.color[1], k.color[2], k.color[3]);
    u.uThreshold.value = k.threshold; u.uScaleFade.value = k.scaleFade;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try { renderer.render(this.scene, this.camera); }
    finally { renderer.autoClear = autoClear; }
  }
  dispose(){ this.mesh.geometry.dispose(); this.material.dispose(); if (this.copy) this.copy.dispose(); }
}
