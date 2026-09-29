// THE ROM'S AMBIENT TERM, TRANSLATED.
//
// Every one of the 570 monster materials selects `FAmbientSH`, whose whole body is
//
//     MC.??? = getSHdiffuse( MC.normal ) * MC.ambient_occlusion
//
// and `getSHdiffuse` decodes to the standard L2 spherical-harmonic irradiance evaluation over
// `CBAmbient.fSHCoef`, a float4[7] (27 coefficients + 1 pad) -- the same packing Unity ships as
// ShadeSH9. Read out of AppShaderPackage.mfx; the decode and its evidence are in
// build/notes/chunk5-shaders.md Part 9, and the buffer layout in
// build/notes/tier34-model-motion-scene.md.
//
// The ROM's own statements, operand for operand:
//
//     n4     = float4(normal, 1)
//     L0L1   = VEC3( dot(fSHCoef[0], n4), dot(fSHCoef[1], n4), dot(fSHCoef[2], n4) )
//     q      = normal.xyzz * normal.yzzx
//     L2a    = VEC3( dot(fSHCoef[3], q),  dot(fSHCoef[4], q),  dot(fSHCoef[5], q) )
//     L2b    = fSHCoef[6].rgb * (normal.x*normal.x - normal.y*normal.y)
//     result = L0L1 + L2a + L2b
//
// WHAT IS ROM AND WHAT IS NOT, stated plainly because the difference matters:
//
//   * The EVALUATION above is the ROM's, verbatim. The viewer previously approximated the ambient
//     with a three.js HemisphereLight, which is a two-colour lerp along Y -- a different function,
//     not a tuning of this one. That is the correction this module exists to make.
//   * The COEFFICIENTS are NOT the ROM's, and cannot be. `fSHCoef` is filled per scene from stage
//     state, and no lighting resource ships: censusing all 1,441 stage archives by type hash finds
//     textures, models, materials, sound, grass, effects and collision, and no light data anywhere;
//     `rSky`, `rSceneTexture`, `rMetaSet` and `rScene` all ship ZERO files. A monster carries no
//     lighting of its own. So the coefficient set below is a CHOICE the viewer makes, and is
//     labelled as one -- it is the only part of this file that is not read from the ROM.
import * as THREE from 'three';

// A neutral studio environment projected to L2 SH, in the ROM's own float4[7] packing.
// AUTHORED, not extracted. Chosen to be directionally bland (soft sky above, warm bounce below)
// so the SHAPE of the ROM's evaluation is what shows, rather than a lighting design.
// Replace wholesale if a stage's real coefficients are ever recovered.
export const STUDIO_SH = [
  new THREE.Vector4( 0.00, 0.00, 0.32, 0.44),
  new THREE.Vector4( 0.00, 0.00, 0.34, 0.46),
  new THREE.Vector4( 0.00, 0.00, 0.38, 0.52),
  new THREE.Vector4( 0.00, 0.00, 0.00, 0.00),
  new THREE.Vector4( 0.00, 0.00, 0.00, 0.00),
  new THREE.Vector4( 0.00, 0.00, 0.00, 0.00),
  new THREE.Vector4( 0.02, 0.02, 0.03, 0.00),
];

let COEF = STUDIO_SH.map(v => v.clone());
const live = new Set();

export function setSHCoef(seven){
  if (!Array.isArray(seven) || seven.length !== 7) throw new Error('rom/ambient: need 7 float4');
  COEF = seven.map(v => (v.isVector4 ? v.clone() : new THREE.Vector4().fromArray(v)));
  for (const u of live) for (let i = 0; i < 7; i++) u.value[i].copy(COEF[i]);
}
export function getSHCoef(){ return COEF.map(v => v.clone()); }

// getSHdiffuse, statement for statement. `n` is the shading normal in the same space the
// coefficients were authored in -- WORLD space here, which is what MC.normal holds at this point in
// the ROM's chain (FBumpNormalMap writes MC.normal from the TBN frame, and MATERIAL_CONTEXT's
// `wposition` sits beside it).
const GLSL_SHADE_SH9 = [
  'vec3 romShadeSH9( vec3 n ) {',
  '  vec4 n4 = vec4( n, 1.0 );',
  '  vec3 r  = vec3( dot( uSHCoef[0], n4 ), dot( uSHCoef[1], n4 ), dot( uSHCoef[2], n4 ) );',
  '  vec4 q  = vec4( n.x*n.y, n.y*n.z, n.z*n.z, n.z*n.x );',
  '  r += vec3( dot( uSHCoef[3], q ), dot( uSHCoef[4], q ), dot( uSHCoef[5], q ) );',
  '  r += uSHCoef[6].rgb * ( n.x*n.x - n.y*n.y );',
  '  return r;',
  '}',
].join('\n');

function chain(mat, fn){
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => { if (prev) prev(sh, r); fn(sh, r); };
  mat.needsUpdate = true;
}
// An onBeforeCompile edit is invisible to three.js's program cache key, so two materials with
// matching parameters share one compiled program and the first to compile decides whose injected
// GLSL everyone runs. See the full note in rom/shader.js. Every injection must tag the material.
function tagProgram(mat, tag){
  const tags = (mat.userData.progTags || '') + '|' + tag;
  mat.userData.progTags = tags;
  mat.customProgramCacheKey = () => tags;
  mat.needsUpdate = true;
}


// Install on a LIT (MeshStandardMaterial) ROM-core material. The term lands in indirectDiffuse,
// which is where an irradiance probe belongs in three.js's accumulation -- the same slot its own
// LightProbe writes to.
//
// `MC.ambient_occlusion` is the second factor in the ROM's expression. The viewer has no occlusion
// map bound on monsters, and `feat.ambient` is `SH` on all 570 with no occlusion feature alongside,
// so it is 1.0 here; the multiply is written out anyway so the statement matches the ROM and gains
// a destination the moment an occlusion source exists.
// DEFAULT OFF, deliberately. This term is additive into indirectDiffuse, and the scene still
// carries stage.js's HemisphereLight + AmbientLight, which occupy the same slot. Switching it on
// without zeroing those double-counts the ambient and makes every monster brighter, not more
// correct. `stage.js` is one of the six modules SHARED with the Armor Viewer (dev/sync-render.py),
// so this module cannot zero them itself -- the app owns that, and must do both together.
let enabled = false;
export function enableRomAmbient(on){ enabled = !!on; }
export function romAmbientEnabled(){ return enabled; }

export function installRomAmbient(mat){
  if (!enabled) return mat;
  if (!mat || !mat.isMeshStandardMaterial) return mat;
  const u = mat.userData.u || (mat.userData.u = {});
  if (u.uSHCoef) return mat;
  u.uSHCoef = { value: COEF.map(v => v.clone()) };
  u.uSHAmount = u.uSHAmount || { value: 1 };
  live.add(u.uSHCoef);
  tagProgram(mat, 'shAmbient');
  chain(mat, sh => {
    Object.assign(sh.uniforms, { uSHCoef: u.uSHCoef, uSHAmount: u.uSHAmount });
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {',
        'uniform vec4 uSHCoef[7];\nuniform float uSHAmount;\n' + GLSL_SHADE_SH9 + '\nvoid main() {')
      .replace('#include <lights_fragment_end>',
        '#include <lights_fragment_end>\n' +
        '\t{ float romAO = 1.0;\n' +
        '\t  vec3 romAmb = romShadeSH9( normalize( vNormal ) ) * romAO;\n' +
        '\t  reflectedLight.indirectDiffuse += uSHAmount * max( romAmb, vec3( 0.0 ) ) * diffuseColor.rgb; }');
  });
  mat.userData.romAmbient = true;
  return mat;
}

export function releaseRomAmbient(mat){
  if (mat && mat.userData && mat.userData.u) live.delete(mat.userData.u.uSHCoef);
}

// Amount is a review knob, not a ROM value: 0 disables the term so the old rig can be compared
// against it without a rebuild.
export function setSHAmount(a){
  for (const m of allRomAmbientMats) if (m.userData.u && m.userData.u.uSHAmount) m.userData.u.uSHAmount.value = a;
}
const allRomAmbientMats = new Set();
export function trackRomAmbient(mat){ allRomAmbientMats.add(mat); }
