// THE ENGINE'S MODEL DRAW, AS AN EFFECT'S MODEL PARTICLE REACHES IT.
//
// A Model generator draws each particle through two engine entry points (see draw.js): 0xc8cf1c,
// begin a model, and 0xc8d208 -> 0xc8d9d8, draw one of its meshes. They are not effect code -- they are
// the renderer, and they turn what the particle hands over (a mesh index, a world matrix, an RGBA8
// colour, an intensity, a flags object, a volume, uv offsets, a reflect scale in s0) into the state the
// GPU draw uses: shader-feature choices, constant-buffer values, blend and depth state, a sort key. This
// file is a translation of that turning, returning it as data for a renderer to apply.
//
// Read from the code and checked against the code: C:\MHGU-Extract\efx\engdraw.py runs the game's own
// 0xc8cf1c / 0xc8d9d8 under the effect draw and snapshots the draw context at the GPU mesh draw
// (0x890ce0); dev/effect-modeldraw-check.mjs replays every snapshot through this file. Paths no
// snapshot reached throw Unverified. Decode notes: E:\offline\decode\notes\effects-draw.md.
//
// The material: 0xc8d9d8 asks it three things, answered here from its .mrl (`mat` below) --
//   emission  its FEmission choice key (0xb0d00c with the FEmission interface key 0x870175e8)
//   diffuse   its FDiffuse choice key  (the same, 0xfdb6f5a7)
//   cbm       its CBMaterial, 32 floats; the first four are what vfn +0x28 (0xb0abc8) returns
// A key is an .mrl feature entry's word b, (hash << 12) | record index, as the package stores it.
import { Unverified, F, bitsf32 } from './mem.js';
import { toS32 } from './cpu.js';

// The draw system's primitive blend modes: its constructor (0xbab040 -> 0xc77254) copies these 34
// blend-state record keys from the ROM at 0x169b2c8 to +0x6c; 0xafd834 picks one per draw.
export const BLEND_MODES = [
  'BSBlendAddAlpha', 'BSBlendBlendAlpha', 'BSBlendAddColor', 'BSBlendBlendColor', 'BSBlendAdd',
  'BSBlendRevSubAlpha', 'BSBlendRevSubBlendAlpha', 'BSBlendRevSubColor', 'BSBlendRevSubBlendColor',
  'BSBlendRevSub', 'BSBlendMinAlpha', 'BSBlendMaxAlpha', 'BSBlendAddDestColor', 'BSBlendBlendAddDestColor',
  'BSBlendAddDestColor', 'BSBlendBlendAddDestAlpha', 'BSBlendNoBlend',
  'BSBlendAddAlphaRGB', 'BSBlendBlendAlphaRGB', 'BSBlendAddColorRGB', 'BSBlendBlendColorRGB', 'BSBlendAddRGB',
  'BSBlendRevSubAlphaRGB', 'BSBlendRevSubBlendAlphaRGB', 'BSBlendRevSubColorRGB', 'BSBlendRevSubBlendColorRGB',
  'BSBlendRevSubRGB', 'BSBlendMinAlphaRGB', 'BSBlendMaxAlphaRGB', 'BSBlendAddDestColorRGB',
  'BSBlendBlendAddDestColorRGB', 'BSBlendAddDestColorRGB', 'BSBlendBlendAddDestAlphaRGB', 'BSBlendNoBlendRGB',
];
// FBlendFog per blend mode, the ROM table at 0x169b350 (0xc8f67c); '' leaves the slot as it was.
const A = 'FBlendFogPrimAlpha', B = 'FBlendFogPrimBlend';
const BLEND_FOG = [A, '', B, B, B, A, A, B, B, B, '', '', B, B, B, B, '', A, '', B, B, B, A, A, B, B, B, '', '', B, B, B, B, ''];
const DEPTH = { 0x1b8: 'DSDefault', 0x1b9: 'DSZTestWrite', 0x1bb: 'DSZTest', 0x1bc: 'DSZWrite' };
const SMOOTH_ALPHA = ['FPrimitiveModelSmoothAlphaDefault', 'FPrimitiveModelSmoothAlphaInverse',
  'FPrimitiveModelSmoothAlphaVertexNormal', 'FPrimitiveModelSmoothAlphaVertexNormalInverse'];

const EMISSION_EFL_EMU = 0x5bbc25ea;           // FEmissionConstantEflEmu, compared at 0xc8e4f4
const DIFFUSE_MD = 0x241aa5bf;                 // FDiffuseMD, compared at 0xc8e508
const INV256 = 0.00390625;                     // literal 0x3b800000
const INV255 = bitsf32(0x3b808081);            // literal 0x3b808081
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const word = v => { f32[0] = v; return u32[0]; };

// 0xc8cf1c on the normal path (the view's flags clear of 0x2080000): what it leaves on PRIM for the
// mesh draws that follow. 0xc8cff4 also runs two light setups on the render singleton (0xbcdc30,
// 0xbcf960) and rebinds the model's buffers on the view (+0x14c) -- the renderer's, not the particle's.
export function beginModel(m, prim, view, model, position, stack){
  if (m.u32(view + 0x168) & 0x2080000) throw new Unverified('0xc8cf34 begin model on a special pass');
  const lod = stack[3];
  m.w32(prim + 0x25c, m.u32(lod));
  m.w32(prim + 0x260, m.u32(lod + 4));
  m.w32(prim + 0x264, m.u32(lod + 8));
  if (m.u32(prim + 0x70) !== (model >>> 0)){
    m.w32(prim + 0x70, model);
    m.w32(prim + 0x90, 0xffffffff);
  }
  if (m.u32(prim + 0x25c)) throw new Unverified('0xc8d0b8 begin model with CBPrimitiveModel');
  let bias = stack[2] | 0;                      // 0xc8cfb8: clamped to +-0x7fff0000
  if (bias > 0x7fff0000) bias = 0x7fff0000;
  else if (bias < -0x7fff0000) bias = -0x7fff0000;
  m.w32(prim + 0x9c, bias >>> 0);
}

// 0xc8d208 -> 0xc8d9d8. `stack` is the five stack words, `s0` the reflect scale (a float), `mat` the
// material's answers. Returns the draw: every value the ROM computes for it, named.
export function drawMesh(m, prim, view, meshIndex, matrix, stack, s0, materialOf){
  if (m.u32(view + 0x168) & 0x2080000) throw new Unverified('0xc8d21c mesh draw on a special pass');
  const colour = stack[0], intensity = stack[1] >>> 0, flags = stack[2], volume = stack[3] >>> 0, uv = stack[4];
  const W = m.u32(flags + 4);
  const out = { meshIndex, features: {
    FShadowReceiveFaceAttn: 'FShadowReceiveFaceAttnCut', FSkinning: 'FSkinningNone', FLightMask: 'FLightMask' } };

  // CBWorld: the matrix's first three columns, as rows (0xc8dc74)
  const w = k => m.u32(matrix + k);
  out.world = [w(0), w(0x10), w(0x20), w(0x30), w(4), w(0x14), w(0x24), w(0x34), w(8), w(0x18), w(0x28), w(0x38)].map(bitsf32);

  const col = m.u32(colour);
  if (W & 0x1200001) out.mode = 0x15;                                        // 0xc8dd8c
  else if (volume !== 0 || col < 0xff000000) out.mode = 0x11;
  else out.mode = ((W & 0x62000000) | m.u32(prim + 0x25c)) ? 0x11 : 0x19;

  const model = m.u32(prim + 0x70);
  const mesh = (m.u32(model + 0x74) + 48 * meshIndex) >>> 0;
  out.material = (m.u32(mesh + 4) >>> 12) & 0xfff;
  const mat = materialOf(model, out.material);

  out.globalTransparency = F(m.u8(colour + 3) / 255);                        // 0xc8df88 -> 0x883bec
  if (!mat.cbm) throw new Unverified('0xc8e0e4 material without CBMaterial');
  const cbm = Float32Array.from(mat.cbm);                                    // 0xc8e0e4: a copy
  const eflEmu = (mat.emission >>> 0) === EMISSION_EFL_EMU;
  if (W & 0x3200001) throw new Unverified('0xc8e134 distortion model draw');
  const r = col & 0xff, g = (col >>> 8) & 0xff, b = (col >>> 16) & 0xff;
  if (!eflEmu){                                                              // 0xc8e2e0
    const k = F(intensity * INV256);
    const cr = F(r * INV255), cg = F(g * INV255), cb = F(b * INV255);
    cbm[0] = F(k * cr); cbm[1] = F(k * cg); cbm[2] = F(k * cb);
  }
  const n = m.u32(uv + 0x20);                                                // 0xc8e364
  if (n !== 0){
    cbm[11] = bitsf32(m.u32(uv)); cbm[15] = bitsf32(m.u32(uv + 4));
    if (n >= 2){
      cbm[19] = bitsf32(m.u32(uv + 8)); cbm[23] = bitsf32(m.u32(uv + 0xc));
      if (n >= 3){ cbm[27] = bitsf32(m.u32(uv + 0x10)); cbm[31] = bitsf32(m.u32(uv + 0x14)); }
    }
  }
  if (eflEmu){                                                               // 0xc8e4fc
    if ((mat.diffuse >>> 0) === DIFFUSE_MD) out.features.FDiffuse = 'FDiffuseNone';
    const k = F(intensity * INV256);                                         // 1.0 on the distortion path, refused above
    let pr = F(r * INV255); pr = F(k * pr); pr = F(mat.cbm[0] * pr);
    let pg = F(g * INV255); pg = F(k * pg); pg = F(mat.cbm[1] * pg);
    let pb = F(b * INV255); pb = F(k * pb); pb = F(pb * mat.cbm[2]);
    out.primColor = [pr, pg, pb, 1];
    out.features.FPrimitiveModifierEmu = 'FPrimitiveModifierEflEmu';
  } else out.features.FPrimitiveModifierEmu = 'FPrimitiveModifierEmu';

  const lod = m.u32(prim + 0x25c);                                           // 0xc8e924
  if ((W & 0x1200001) === 0 && (volume | (W & 0x62000000) | lod) === 0){
    if (eflEmu) out.features.FColorModifier = 'FPrimiteveColorModifierEmu';
  } else out.features.FColorModifier = 'FPrimiteveColorModifier';

  // THE UNSORTED EMIT (0xc8ea1c -> 0xc8ef98 -> 0xc8f2a4). A mesh with no volume, an opaque colour (alpha
  // 0xff), W clear of 0x1200001 and of 0x62000000 and no LOD skips the depth sort (0xc8ea78) -- unless the
  // context's current pass is 0x11 (0xc8ea44), the pass the primitive list draw sets for itself (0xbab5fc)
  // after every unit has drawn. It keeps that current pass and orders by the prim's bias alone (0xc8f2a4 ->
  // 0xc8f2cc), and its depth state is the context's slot 0x1b9 (ctx+0xfcc, 0xc8f2dc -> 0xc8f2f8) instead of the
  // one the flags name (0xc8eb10). Everything else is the sorted emit's: both join at 0xc8f658, so the fog
  // and the blend picker (0xafd834, called at 0xc8f774) run for it exactly as for any other mesh -- the
  // material's blend stands. Pass 0xf takes a third emit (0xc8efa8) that no recording has reached.
  const pass = m.u32(view + 0x164) & 0x1f;
  const unsorted = (volume === 0 && col >= 0xff000000 && (W & 0x1200001) === 0
      && pass !== 0x11 && ((W & 0x62000000) | lod) === 0);
  if (unsorted && pass === 0xf) throw new Unverified('0xc8efa8 unsorted emit in pass 0xf');

  // the sort key, from the depth of the world translation in the camera's view matrix (0xc8ea78)
  const vm = (m.u32(view + 0xd7c) & ~0xf) + 0x70;                            // 0x88283c
  const tx = m.f32(matrix + 0x30), ty = m.f32(matrix + 0x34), tz = m.f32(matrix + 0x38);
  let z = F(ty * m.f32(vm + 0x18));
  z = F(z + F(tx * m.f32(vm + 8)));
  z = F(z + F(tz * m.f32(vm + 0x28)));
  const depth = toS32(-F(m.f32(vm + 0x38) + z));
  const near = 0x7fff - (depth < 0x7fff ? depth : 0x7fff);
  let key = ((depth > 0 ? (near << 12) : 0x7fff000) + (m.u32(prim + 0x9c) | 0)) | 0;
  out.sortKey = key <= 0 ? 0 : (key < 0x7fff000 ? key : 0x7fff000);
  out.order = ((out.sortKey | (m.u32(prim + 0x8c) & 0xfff)) << 5) >>> 0;     // ctx+0x164 above its low 5 bits

  const wd = m.u32(flags + 4);                                               // 0xc8eb10
  let ds = 0x1b8 | ((wd >>> 2) & 4);
  if (!(wd & 8)) ds = 0x1bb;
  if ((wd & 0x18) === 0x10) ds = 0x1b9;
  out.depth = DEPTH[ds];

  if (W & 0x200000) throw new Unverified('0xc8ec0c scene-sampler model draw');
  if (W & 1) throw new Unverified('0xc8ed14 scene-sampler model draw');
  if (W & 0x1000000) throw new Unverified('0xc8eeb0 scene-sampler model draw');
  if (W & 0x2000000) throw new Unverified('0xc8f210 scene-sampler model draw');
  out.features.FPrimitiveModelSceneSampler = 'FPrimitiveModelSceneSampler';

  const bm = (m.u32(flags) >>> 5) & 0x7ff;
  out.blend = BLEND_MODES[bm > 0x22 ? 1 : bm];                               // 0xafd834
  out.fog = !(W & 0x1000);                                                   // 0xbd0ab0's flag
  if (out.fog){
    if (bm > 33) throw new Unverified('0xc8f68c blend fog past the table');
    if (BLEND_FOG[bm]) out.features.FBlendFog = BLEND_FOG[bm];
  }

  if (volume !== 0){                                                         // 0xc8f7d0
    out.depthMap = m.u32(view + 0x1e0) !== 0;
    out.features.FPrimitiveTransparency = 'FPrimitiveTransparencyVolume';
    cbm[7] = volume;
  } else {
    out.depthMap = false;
    out.features.FPrimitiveTransparency = 'FPrimitiveTransparency';
  }
  out.features.FPrimitiveModelSmoothAlpha = (lod >= 1 && lod <= 4) ? SMOOTH_ALPHA[lod - 1] : 'FPrimitiveModelSmoothAlpha';
  cbm[4] = F(cbm[4] * s0); cbm[5] = F(cbm[5] * s0); cbm[6] = F(cbm[6] * s0); // 0xc8ff68
  if ((W & 0x60000000) && m.u32(prim + 0xb8)) throw new Unverified('0xc8ffa0 level-corrected model draw');
  out.features.FPrimitiveLevelCorrection = 'FPrimitiveLevelCorrection';
  if (W & 0x20) throw new Unverified('0xc90640 symmetric model draw');
  out.features.FWorldCoordinate = 'FWorldCoordinate';
  out.cbMaterial = cbm;
  out.range = [m.u32(mesh + 0x1c), m.u32(mesh + 0x18), m.u32(mesh + 0x20)];    // 0x890ce0's r1, r2, r3 (0xc90758)
  if (unsorted){
    out.depth = DEPTH[0x1b9];                                                  // ctx+0xfcc (0xc8f2dc)
    // 0xc8f2a4: prim+0x8c's low 12 bits (kept at sp+0x24 since 0xc8ea14), else its fields at bits 4, 8, 12
    const b8c = m.u32(prim + 0x8c);
    let bias = b8c & 0xfff;
    if (!bias) bias = (b8c >>> 4) & 0xfff;
    if (!bias) bias = (b8c >>> 8) & 0xfff;
    if (!bias) bias = (b8c >>> 12) & 0xfff;
    out.sortKey = 0; out.order = (bias << 5) >>> 0;                            // ctx+0x164 above the kept pass
    out.unsorted = true;
  }
  return out;
}

export const internals = { word };
