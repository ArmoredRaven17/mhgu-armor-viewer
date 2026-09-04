// The MHGU material: MeshStandardMaterial plus the onBeforeCompile pigment / matcap shader,
// driven by what the game's own material file (.mrl) says about each material, resolved
// through the shader package into docs/materials.json (Phase 3, 2026-09-03). The shader
// text, the uniform block and the pigment math are what the single script carried, kept
// verbatim; index.html writes `tint` and calls applyTint on armorMats when a pigment changes.
//
// What the ROM decides here, per material (spec.rom, from materials-db.js specFor):
//   blend state  BSSolid opaque; BSBlendAlpha transparent, no depth write, drawn after the
//                opaque parts; BSAddAlpha additive and unlit (the glow parts)
//   cull         RSMesh back -> front faces only; RSMeshCN -> both; RSMeshCF -> back faces
//   depth bias   RSMeshBiasN (-32 N) -> a constant polygon offset of that many depth units
//                toward the camera, no slope term (decal layers such as the Charge Blade 064
//                shield face and the Lecturer's Footwear cuff band). A slope-scaled offset
//                pushed the cuff band through the boot shell at grazing angles (Raven,
//                2026-09-03: "a little bit of the black material ... peek out"); the constant
//                offset at the ROM's value shows none.
//   alpha        the alpha TEST is bit 20 of the material's feature word (with FTransparency
//                Alpha): discard texels at or below fAlphaClipThreshold, 0.0 on every material
//                seen, so only the exact-zero holes go. The Alpha feature without that bit
//                (Nerscylla's mail, 2,819 materials) only feeds alpha to a blend state -- the
//                game draws them whole. AlphaConstant -> the constant transparency
//   albedo tint  fAlbedoColor x fDiffuseColor multiplies the map (greys 0.8..0.95 on some)
//   emission     fEmissionColor, as self-illumination proportional to the map
//   sphere map   FReflect SphereMap -> the tSphereMap binding, scaled by fReflectiveColor
//                (0 switches it off on 31 materials that carry the feature) and the gloss:
//                the map's alpha when tSpecularMap is the albedo, else the separate specular
//                map's luminance (a greyscale mask, alpha 1.0). GlobalCubeMap is the stage's
//                reflection, which the viewer has no stand-in for: no term
//   Fresnel      Schlick with fFresnelSchlickRGB as F0 (1.0 on 246 of 264 globals: no change)
//   pigment      flag 0x20 marks the dyeable region (the `_sym_` materials, 99% of them);
//                flag 0x40 without 0x20 is the colour-override class (skin, fur, face)
// Approximations kept from before: the studio lights, roughness .85 (lowered only where
// fShininess exceeds 16), the screen-blended matcap at envAmount.
import * as THREE from 'three';

// ---- pigment state -----------------------------------------------------------------------
// Owned here so every armour material reads one truth. The picker, the per-slot rows and the
// Deviant stepper in index.html write these and then re-apply the tint.
export const tint = {
  pigment: null,        // null = the armor's own colors, untinted
  useDefaults: false,   // apply each piece's OWN authored pigment instead of one global color
  // One pigment per equipment slot, which is how the game itself stores it:
  // cArmorColorBase is mHeadColorIndex / mTorsoColorIndex / mArmColorIndex /
  // mWaistColorIndex / mLegColorIndex -- five indices, one per piece.
  slotPigment: { helm:null, body:null, arm:null, wst:null, leg:null }
};

// MHGU dyes armor with a pigment. The _bm alpha channel is the mask: bright on the
// metal/cloth trim, dark on monster-part scales -- which matches what the game lets you
// dye. So tint by alpha rather than washing the whole piece.
// matcap strength: the slider is gone, the env contribution stays at this level
export const envAmount = 0.55;

// ---- registries --------------------------------------------------------------------------
// every material the viewer built (the wireframe toggle walks this)
export const allMats = [];
// pigment applies to ARMOUR only -- never the hunter's face or hair
export const armorMats = [];

// ---- the ROM's render states ---------------------------------------------------------------
// The rasterizer's cull mode. RSMesh culls BACK faces, so the front faces render: FrontSide.
const SIDE = { back: THREE.FrontSide, none: THREE.DoubleSide, front: THREE.BackSide };
// The game discards a <= fAlphaClipThreshold; three.js discards a < alphaTest, so the
// threshold moves up by less than one 8-bit step: exactly the zero texels go.
const ALPHA_EPS = 1 / 512;
// Raven's comparison knob: null = the ROM threshold on every cutout material, a number
// forces that threshold on all of them (0.5 was the old hunter rule)
let alphaOverride = null;
// The ROM's depth bias (RSMeshBiasN, -32 a step) is in depth-buffer units, whose real size
// depends on the projection: with this viewer's near plane a unit at the model is far larger
// than in the game, so the Shadow Shades (bias -512) drew their arms through the head once
// the camera backed off (Raven, 2026-09-03: "the part that should be hidden by the head
// model is visible"). The page re-expresses a step as a fixed push in metres each frame
// (setBiasUnitsPerStep, from the camera distance and near plane); until it does, a step is
// the raw 32 units.
const biasMats = new Set();
let biasUnitsPerStep = 32;
export function setBiasUnitsPerStep(v){
  if (!(v > 0) || Math.abs(v - biasUnitsPerStep) < biasUnitsPerStep * 0.05) return false;
  biasUnitsPerStep = v;
  for (const m of biasMats) m.polygonOffsetUnits = m.userData.romBias / 32 * v;
  return true;
}
export function setAlphaOverride(v){
  alphaOverride = (v === null || v === undefined || v === '') ? null : +v;
  for (const m of allMats) if (m.userData.cutout) m.alphaTest = alphaOverride === null ? m.userData.romCut : alphaOverride;
  return alphaOverride;
}

export function applyTint(mat){
  // Own the uniform OBJECTS up front and hand the same ones to onBeforeCompile, so
  // changing pigment or sheen is just a .value write -- no recompile.
  if (!mat.userData.u){
    mat.userData.u = {
      uTint: { value: new THREE.Color(1,1,1) },
      uAmt:  { value: 0 },
      uEnv:  { value: null },
      uEnvAmt: { value: 0 },
      uDbg: { value: 0 },
      uKey: { value: new THREE.Color(1,1,1) },          // the armor's AUTHORED color
      uHasKey: { value: 0 },
      uKeyTol: { value: 0.15 },
      uSatBoost: { value: 1.0 },   // debug: exaggerate color so neutral areas stand out
      // Cut at the VALLEY between the two populations, not inside one of them.
      // An armour texture is bimodal in saturation: the neutral (dyeable) lobe runs
      // 0..~0.45 and the coloured armour sits at 0.5+, with a clear trough between.
      // The old 0.06-0.30 window ended mid-lobe, so it selected the whitest part of a
      // dyeable band and dropped the rest -- "correct area, but not the full area".
      uSat: { value: new THREE.Vector2(0.20, 0.45) },   // saturation window
      uVal: { value: new THREE.Vector2(0.15, 0.35) },   // brightness gate
      uChar: { value: new THREE.Color(1,1,1) },  // hair / eye / skin color
      uCharAmt: { value: 0 },
      uRegion: { value: 0 },  // 1 on the material that IS the dyeable region
      // 1 where the texture's ALPHA is a real cutout and must reach alphaTest.
      //
      // This shader replaces <map_fragment> wholesale, and the replacement only ever
      // multiplied diffuseColor.RGB -- so the sampled alpha was dropped on the floor and
      // `alphaTest` compared against a diffuseColor.a that was always 1. Nothing was ever
      // discarded. It shows up on the Palico's eyes, whose quads are deliberately
      // oversized so one mesh covers every eye option: the surround is authored fully
      // transparent (92-95% of those texels sit at alpha exactly 0) and was drawing solid.
      //
      // Opt-IN: on most armour the `_bm` alpha is a GLOSS ramp, not opacity. The ROM's
      // FTransparency feature is what turns it on now (createMaterial), the name prefix
      // only where the database has no entry.
      uAlphaCut: { value: 0 },
      // the separate specular map (tSpecularMap when it is not the albedo): its luminance
      // is the gloss that scales the sphere map
      uSpec: { value: null },
      uSpecOn: { value: 0 },
      // the albedo sampled by the view-space normal (uvAlbedoMap UVViewNormal, the glow
      // materials) instead of the mesh's UVs
      uViewUv: { value: 0 },
      // Schlick's F0 for the sphere map (fFresnelSchlickRGB)
      uF0: { value: 1 },
      // 0..1: how far the dye region (and the material's glow) is pulled toward black.
      // The Esurient animation drives it (setRegionDark); nothing else touches it.
      uDark: { value: 0 }
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, mat.userData.u);
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {',
                 'uniform vec3 uTint; uniform float uAmt;' +
                 ' uniform sampler2D uEnv; uniform float uEnvAmt; uniform float uDbg;' +
                 ' uniform vec2 uSat; uniform vec2 uVal;' +
                 ' uniform vec3 uKey; uniform float uHasKey; uniform float uKeyTol;' +
                 ' uniform float uSatBoost;' +
                 ' uniform vec3 uChar; uniform float uCharAmt; uniform float uRegion;' +
                 ' uniform float uAlphaCut;' +
                 ' uniform sampler2D uSpec; uniform float uSpecOn; uniform float uViewUv; uniform float uF0;' +
                 ' uniform float uDark;' +
                 ' float gGloss = 0.0; vec3 gBase = vec3( 1.0 );' +
                 ' vec3 mhguSrgbOetf( vec3 c ){ c = max( c, vec3( 0.0 ) ); return mix( pow( c, vec3( 1.0 / 2.4 ) ) * 1.055 - 0.055, c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) ); }' +
                 ' vec3 mhguSrgbEotf( vec3 c ){ c = max( c, vec3( 0.0 ) ); return mix( pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), c / 12.92, vec3( lessThanEqual( c, vec3( 0.04045 ) ) ) ); }' +
                 ' void main() {')
        .replace('#include <map_fragment>',
          `#ifdef USE_MAP
             vec2 mapUv = vMapUv;
             if ( uViewUv > 0.5 ) { vec3 vnm = normalize( vNormal ); mapUv = vnm.xy * 0.5 + 0.5; }
             vec4 texel = texture2D( map, mapUv );
             // the gloss that scales the sphere map: the map's own alpha, or the separate
             // specular map's luminance where the material binds one
             gGloss = uSpecOn > 0.5 ? dot( texture2D( uSpec, vMapUv ).rgb, vec3( 0.299, 0.587, 0.114 ) ) : texel.a;
             // MHGU authors the dyeable part of a texture as DESATURATED white/grey so a
             // pigment can be multiplied into it -- undyed, those areas read as the white
             // sashes and boots you see. So the mask is low saturation, not the alpha:
             // colorful areas (monster hide, painted trim) keep their own color, and
             // near-black is skipped so shadowed cloth does not light up.
             float mxC = max( texel.r, max( texel.g, texel.b ) );
             float mnC = min( texel.r, min( texel.g, texel.b ) );
             float sat = mxC > 0.0 ? ( mxC - mnC ) / mxC : 0.0;
             // THE REGION IS THE MATERIAL. Rendering the Yukumo kasa with one hue per
             // material shows the _sym_ material is exactly the band that dyes -- the
             // texel heuristics were approximating a shape the model already states
             // outright, which is why they always caught "the right area but not all of
             // it". uRegion is 1 only on that material (the ROM's flag 0x20 now).
             //
             // The saturation window is kept as a fallback for the handful of pieces
             // whose dye area is not a separate material.
             float dye = uRegion > 0.5 ? 1.0
                       : ( 1.0 - smoothstep( uSat.x, uSat.y, sat ) )
                         * smoothstep( uVal.x, uVal.y, mxC ) * 0.0;
             float luma = dot( texel.rgb, vec3(0.299, 0.587, 0.114) );
             if ( uDbg > 0.5 ) {
               // magenta = what the mask selects, greyscale = left alone
               diffuseColor.rgb *= mix( vec3(luma * 0.55), vec3(1.0, 0.0, 0.85), dye );
             } else {
               // A plain multiply can only DARKEN, so a dark piece barely moves when
               // dyed -- Astalos reads as unchanged -- while in game it visibly takes the
               // colour. Recolour by luminance instead, the same treatment the hair and
               // skin tints use, so the pigment's hue survives on dark armour while the
               // weave and shading still come through the luma term.
               vec3 dyed = uTint * ( 0.30 + luma * 1.35 );
               vec3 base = mix( texel.rgb, dyed, uAmt * dye );
               // Debug: push saturation so COLOURED areas go vivid and the neutral
               // (dyeable) ones stay grey -- greying the rest out, as the mask view does,
               // makes those two indistinguishable.
               base = clamp( vec3(luma) + ( base - vec3(luma) ) * uSatBoost, 0.0, 1.0 );
             // Hair / eye / skin color. Recolor by LUMINANCE rather than multiplying:
             // a multiply can only ever darken, so a dark brown hair texture could never
             // reach blonde. Scaling the chosen color by luma (x2, so mid-grey lands on
             // the color itself) keeps the strand and shading detail while actually
             // changing the hue.
             if ( uCharAmt > 0.0 ) {
               base = mix( base, uChar * luma * 2.0, uCharAmt );
             }
               gBase = base;           // the dyed albedo, for the glow below
               diffuseColor.rgb *= base;
             }
             // the region fades toward black by uDark (the Esurient animation); on a region
             // material dye is 1 everywhere, so the whole material goes with it
             diffuseColor.rgb *= 1.0 - uDark * dye;
             // hand the sampled alpha to alphaTest / blending where the map is a real cutout
             diffuseColor.a *= mix( 1.0, texel.a, uAlphaCut );
           #endif`)
        // The glow is the emission constant times the DYED albedo, not the raw map. With the
        // raw map the dye region -- authored whitish so a pigment can be multiplied in --
        // glowed grey over whatever pigment was on it and washed it out (Raven, 2026-09-04:
        // "The female Esurient armors seem to wash out the pigment"; green read as
        // (119,162,114) with the glow and (15,117,16) without). Undyed materials are
        // unchanged: gBase is then the map texel, which is what the stock chunk sampled.
        // And the glow goes to black with the region.
        .replace('#include <emissivemap_fragment>',
          `#ifdef USE_EMISSIVEMAP
             totalEmissiveRadiance *= gBase;
           #endif
           totalEmissiveRadiance *= 1.0 - uDark;`)
        // MHGU shades armor with a 64x64 spherical env map (a matcap) scaled by gloss.
        // Sample it with the view-space normal and screen it over the lit colour. The screen
        // has always run on the sRGB-ENCODED colour -- it sat after <colorspace_fragment>,
        // on the canvas -- so it runs here on an explicit encode and is decoded again: the
        // same pixels on the canvas, and right in a linear render target too, where three's
        // own <colorspace_fragment> is the identity (Raven, 2026-09-04: post-processing).
        .replace('#include <colorspace_fragment>',
          `if ( uEnvAmt > 0.0 ) {
             vec3 vn = normalize( normal );
             vec2 muv = vn.xy * 0.5 + 0.5;
             vec3 env = texture2D( uEnv, muv ).rgb;
             // gloss^2 biases the sheen toward genuinely reflective texels: ~400 pieces
             // have a near-solid gloss mask and a linear term washes them out.
             float g = gGloss * gGloss;
             // Schlick: F0 + (1 - F0)(1 - N.V)^5, with F0 = fFresnelSchlickRGB (1.0 on nearly
             // every material, which leaves the term at 1)
             float fres = uF0 + ( 1.0 - uF0 ) * pow( 1.0 - clamp( vn.z, 0.0, 1.0 ), 5.0 );
             // SCREEN blend, not additive -- a + b*(1-a) cannot exceed 1, so bright
             // armor keeps its detail instead of clipping to white.
             vec3 enc = mhguSrgbOetf( gl_FragColor.rgb );
             enc += env * g * uEnvAmt * fres * ( 1.0 - enc );
             gl_FragColor.rgb = mhguSrgbEotf( enc );
           }
           #include <colorspace_fragment>`);
    };
    mat.needsUpdate = true;
  }
  const u = mat.userData.u;
  u.uRegion.value = mat.userData.dyeRegion ? 1 : 0;
  const own = tint.useDefaults && mat.userData.own ? mat.userData.own.rgb : null;
  const slotCol = tint.slotPigment[mat.userData.slot] || null;
  const use = own || slotCol || (tint.useDefaults ? null : tint.pigment);
  const key = mat.userData.own;                 // authored color = the region key
  u.uHasKey.value = key ? 1 : 0;
  if (key) u.uKey.value.setRGB(key.rgb[0]/255, key.rgb[1]/255, key.rgb[2]/255);
  if (use && !mat.userData.noTint){
    u.uTint.value.setRGB(use[0]/255, use[1]/255, use[2]/255);
    u.uAmt.value = 1;
  } else {
    u.uAmt.value = 0;
  }
  u.uEnvAmt.value = envStrength(mat);
}
export const setTint = applyTint;

// How far a material's dye region and glow sit toward black, 0 (its colour) to 1 (black).
// Written every frame by the Esurient animation in index.html.
export function setRegionDark(mat, k){
  const u = mat.userData.u;
  if (u) u.uDark.value = k;
}

// The sphere map's weight: nothing without a map; with the ROM's material, the reflective
// colour scales it (fReflectiveColor); without one, the old rule -- an env token in the name.
function envStrength(mat){
  const u = mat.userData.u;
  if (!u.uEnv.value) return 0;
  if (mat.userData.rom) return envAmount * (mat.userData.reflective === undefined ? 1 : mat.userData.reflective);
  return /env/i.test(mat.name || '') ? envAmount : 0;
}

// The one material every mesh gets -- armour, character parts, Palico and weapons all take
// this path. `spec`:
//   srcName    the glTF material name (kept as mat.name)
//   rom        the material's entry from materials.json (materials-db.js specFor), or null
//              for the exporter's placeholders; decides everything listed at the top
//   alphaCut   fallback alphaTest threshold when there is no rom entry (0 = no cutout)
//   noTint     never takes the armour pigment
//   tintClass  'skin' | 'hair' | 'eye' | 'fur' | 'oeye' -- takes the character colour instead
//   dyeRegion  fallback: 1 on the `_sym_` material when there is no rom entry
//   slot       the pigment row this material reads ('helm'..'leg', 'cloth', 'ohelm', 'obody')
//   own        the piece's authored default pigment ({i, hex, rgb}) or null
//   wire       the wireframe toggle's current state
// The result carries userData.renderOrder (10 blended, 20 additive) for the mesh, and
// userData.emissiveFromMap when the caller should hand the loaded map to emissiveMap too.
export function createMaterial(spec){
  const rom = spec.rom || null;
  const st = rom && rom.state, ft = rom && rom.feat, cb = rom && rom.cbm, gl = rom && rom.glob;
  const side = (st && st.cull in SIDE) ? SIDE[st.cull] : THREE.DoubleSide;   // FrontSide is 0: no || here
  if (st && st.blend === 'add'){
    // Additive materials are the glow parts, drawn unlit and added over what is behind:
    // the Charge Blade's phial box (part 24, XfB_0__m30_gaxe064_add_) is a 12-vertex box
    // whose texel is black, so it adds nothing until its material animation lights it
    // (triggers 28/29). Lit and opaque it was the "black mass" on the drawn sword, and lit
    // with the matcap it still left a grey box (Raven, 2026-09-03). No matcap, no lights.
    // An additive material that binds NO albedo map (the Sword & Shield 134 "one134_add_"
    // binds only a sphere map) draws nothing here: the game samples an unbound albedo as
    // black, so the overlay adds nothing until a material animation lights it -- the same
    // story as the Charge Blade's phial box. Drawn unlit and mapless it was a flat white
    // shield and a white blade; the Phase 2 fallback (the table's first map, added over
    // itself) doubled the blade's brightness instead. Its sphere map is kept on userData
    // for the day the material animations are read.
    const mat = new THREE.MeshBasicMaterial({ name: spec.srcName, side, blending: THREE.AdditiveBlending,
                                              transparent: true, depthWrite: false, wireframe: !!spec.wire });
    if (rom && !rom.albedo){ mat.visible = false; mat.userData.maplessOverlay = true; }
    if (cb && ft && ft.transp === 'AlphaConstant') mat.opacity = cb.transparency;
    mat.userData.rom = rom; mat.userData.unlit = true; mat.userData.noTint = true;
    mat.userData.renderOrder = 20;
    return mat;
  }
  const mat = new THREE.MeshStandardMaterial({
    roughness:.85, metalness:.0, side, name:spec.srcName, transparent:false, alphaTest: 0 });
  mat.userData.rom = rom;
  // alpha: the ROM's transparency feature, else the caller's name rule
  let cut = 0, texAlpha = false;
  if (ft){
    if (ft.transp === 'Alpha' && rom.alphaTest){ cut = Math.max(0, gl ? gl.clip : 0) + ALPHA_EPS; texAlpha = true; }
  } else if (spec.alphaCut){ cut = spec.alphaCut; texAlpha = true; }
  mat.userData.cutout = texAlpha; mat.userData.romCut = cut;
  mat.alphaTest = (texAlpha && alphaOverride !== null) ? alphaOverride : cut;
  // blend state
  if (st && st.blend === 'blend'){
    mat.transparent = true; mat.depthWrite = false; mat.userData.renderOrder = 10;
    if (cb) mat.opacity = cb.transparency;
    if (ft && ft.transp) texAlpha = true;
  }
  // depth bias: RSMeshBiasN pulls the layer toward the camera, constant only (no slope
  // term: that put a black sliver on the Lecturer's boots), scaled per step as above
  if (st && st.bias){
    mat.polygonOffset = true; mat.polygonOffsetFactor = 0;
    mat.userData.romBias = st.bias;
    mat.polygonOffsetUnits = st.bias / 32 * biasUnitsPerStep;
    biasMats.add(mat);
    mat.addEventListener('dispose', () => biasMats.delete(mat));
  }
  // albedo tint, emission, shininess
  if (gl && cb) mat.color.setRGB(gl.albedo[0] * cb.diffuse[0], gl.albedo[1] * cb.diffuse[1], gl.albedo[2] * cb.diffuse[2]);
  if (gl && (gl.emission[0] + gl.emission[1] + gl.emission[2]) > 0){
    mat.emissive.setRGB(gl.emission[0], gl.emission[1], gl.emission[2]);
    mat.userData.emissiveFromMap = true;
  }
  if (gl && gl.shininess > 16) mat.roughness = Math.min(0.85, Math.max(0.4, 0.85 - Math.log2(gl.shininess / 16) * 0.15));
  mat.userData.reflective = cb ? (cb.reflective[0] + cb.reflective[1] + cb.reflective[2]) / 3 : 1;
  mat.userData.f0 = gl ? (gl.fresnelSchlickRGB[0] + gl.fresnelSchlickRGB[1] + gl.fresnelSchlickRGB[2]) / 3 : 1;
  mat.userData.viewUv = !!(ft && ft.uvAlbedoMap === 'UVViewNormal');
  // pigment and colour override
  mat.userData.noTint = !!spec.noTint;
  if (spec.tintClass) mat.userData.tintClass = spec.tintClass;
  mat.userData.dyeRegion = rom ? rom.pigment : !!spec.dyeRegion;
  if (spec.slot !== undefined) mat.userData.slot = spec.slot;
  mat.userData.own = (spec.own !== undefined) ? spec.own : null;
  mat.wireframe = !!spec.wire;
  applyTint(mat);
  const u = mat.userData.u;
  u.uAlphaCut.value = texAlpha ? 1 : 0;
  u.uViewUv.value = mat.userData.viewUv ? 1 : 0;
  u.uF0.value = mat.userData.f0;
  return mat;
}

// the env matcap, once its texture has loaded
export function setEnvTexture(mat, t){
  if (mat.isMeshMatcapMaterial){ mat.matcap = t; mat.needsUpdate = true; return; }
  if (!mat.userData.u) return;                 // an unlit additive material takes none
  mat.userData.u.uEnv.value = t;
  mat.userData.u.uEnvAmt.value = envStrength(mat);
  mat.needsUpdate = true;
}
// the separate specular map, once loaded: its luminance is the gloss
export function setSpecTexture(mat, t){
  if (!mat.userData.u) return;
  mat.userData.u.uSpec.value = t;
  mat.userData.u.uSpecOn.value = 1;
  mat.needsUpdate = true;
}

// hair / eye / skin / fur colour: a '#rrggbb' string or a THREE.Color, or null for the
// authored map
export function setCharColor(mat, c){
  const u = mat.userData.u;
  if (!u) return;
  if (!c) { u.uCharAmt.value = 0; return; }
  u.uCharAmt.value = 1;
  u.uChar.value.set(c);
}

export function setWire(mats, on){
  mats.forEach(m => m.wireframe = on);
}

// the dye-mask debug view (magenta = selected)
export function setDebug(mats, v){
  mats.forEach(m => { if (m.userData.u) m.userData.u.uDbg.value = v; });
}

// the saturation / value window the fallback mask uses, plus the debug boost
export function setMaskWindow(mats, s0, s1, v0, kt, sb){
  mats.forEach(m => { const u = m.userData.u; if (!u) return;
    u.uSat.value.set(s0, s1); u.uVal.value.set(v0, v0 + 0.20);
    u.uKeyTol.value = kt; u.uSatBoost.value = sb; });
}
