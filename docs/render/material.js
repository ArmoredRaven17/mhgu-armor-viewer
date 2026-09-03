// The MHGU material: MeshStandardMaterial plus the onBeforeCompile pigment / matcap shader.
// Moved out of index.html verbatim -- the shader text, the uniform block and the pigment math
// are exactly what the single script carried. index.html writes `tint` and calls applyTint on
// armorMats when a pigment changes.
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
      // Deliberately opt-IN rather than applied everywhere. On most armour the `_bm` alpha
      // is a GLOSS ramp, not opacity, so feeding it to a 0.5 alphaTest would punch holes
      // through every shaded area -- the failure recorded early on as "alphaTest 0.5 culls
      // most of the armour". Widening this needs its own pass and Raven's eyes on it.
      uAlphaCut: { value: 0 }
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
                 ' float gGloss = 0.0; void main() {')
        .replace('#include <map_fragment>',
          `#ifdef USE_MAP
             vec4 texel = texture2D( map, vMapUv );
             gGloss = texel.a;                       // alpha is the GLOSS mask (for env)
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
             // it". uRegion is 1 only on that material.
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
               diffuseColor.rgb *= base;
             }
             // hand the sampled alpha to alphaTest where the map is a real cutout
             diffuseColor.a *= mix( 1.0, texel.a, uAlphaCut );
           #endif`)
        // MHGU shades armor with a 64x64 spherical env map (a matcap) scaled by gloss.
        // Sample it with the view-space normal and add it on top of the lit color.
        .replace('#include <dithering_fragment>',
          `#include <dithering_fragment>
           if ( uEnvAmt > 0.0 ) {
             vec3 vn = normalize( normal );
             vec2 muv = vn.xy * 0.5 + 0.5;
             vec3 env = texture2D( uEnv, muv ).rgb;
             // gloss^2 biases the sheen toward genuinely reflective texels: ~400 pieces
             // have a near-solid gloss mask and a linear term washes them out.
             float g = gGloss * gGloss;
             // SCREEN blend, not additive -- a + b*(1-a) cannot exceed 1, so bright
             // armor keeps its detail instead of clipping to white.
             gl_FragColor.rgb += env * g * uEnvAmt * ( 1.0 - gl_FragColor.rgb );
           }`);
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
  u.uEnvAmt.value = (u.uEnv.value && /env/i.test(mat.name || '')) ? envAmount : 0;
}
export const setTint = applyTint;

// The one MeshStandardMaterial every mesh gets -- armour, character parts, Palico and
// weapons all take this path. `spec` is the name-derived info the callers used to set on
// userData by hand:
//   srcName    the glTF material name (kept as mat.name; /env/ on it enables the matcap)
//   alphaCut   alphaTest threshold (0 = no cutout)
//   noTint     never takes the armour pigment
//   tintClass  'skin' | 'hair' | 'eye' | 'fur' | 'oeye' -- takes the character colour instead
//   dyeRegion  1 on the `_sym_` material that IS the dyeable region
//   slot       the pigment row this material reads ('helm'..'leg', 'cloth', 'ohelm', 'obody')
//   own        the piece's authored default pigment ({i, hex, rgb}) or null
//   wire       the wireframe toggle's current state
export function createMaterial(spec){
  const mat = new THREE.MeshStandardMaterial({
    roughness:.85, metalness:.0, side:THREE.DoubleSide, name:spec.srcName,
    transparent:false, alphaTest: spec.alphaCut || 0 });
  mat.userData.noTint = !!spec.noTint;
  if (spec.tintClass) mat.userData.tintClass = spec.tintClass;
  mat.userData.dyeRegion = !!spec.dyeRegion;
  if (spec.slot !== undefined) mat.userData.slot = spec.slot;
  mat.userData.own = (spec.own !== undefined) ? spec.own : null;
  mat.wireframe = !!spec.wire;
  applyTint(mat);
  return mat;
}

// the env matcap, once its texture has loaded
export function setEnvTexture(mat, t){
  mat.userData.u.uEnv.value = t;
  mat.userData.u.uEnvAmt.value = envAmount;
  mat.needsUpdate = true;
}

// hair / eye / skin / fur colour: a '#rrggbb' string or a THREE.Color, or null for the
// authored map
export function setCharColor(mat, c){
  const u = mat.userData.u;
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
