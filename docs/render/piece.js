// The mesh + material pipeline for a mounted piece: hunter armour, the default clothing, a
// Palico's parts, and the face and hair. Nothing here reads the DOM -- what the UI decides
// (which hair groups a helm hides, the wireframe toggle, the body toggle, the fur pattern,
// the static pose) arrives through `opt` and `ctx`.
import { loadGlb, getTexture } from './assets.js';
import { skeletonClone, meshGroupId } from './skeleton.js';
import { createMaterial, setEnvTexture, allMats, armorMats } from './material.js';
import { poseObject } from './pose.js';

// A harvested piece IS one slot of one set, so its texture is known from the key --
// no need to parse material names. That matters because the game's own naming is
// inconsistent: "m_heml004_env_" (a typo for helm), "wst045_sym_" (no m_ prefix),
// "f_helm_sym_" (no set number). Guessing from those pulled a DIFFERENT slot's texture
// on 383 materials and fell back on 54% of them.
export function textureForMaterial(name, entry){
  if (/skin/i.test(name) && entry.skin) return entry.skin;
  if (entry.tex) return entry.tex;          // armor: one piece, one texture

  // Character parts are the exception -- a face legitimately ships several maps
  // (face, eye, and the makeup variants), so those do match on the material name.
  const T = entry.textures || {};
  const keys = Object.keys(T).filter(k => !k.endsWith('+a'));
  const pick = re => { const k = keys.find(k => re.test(k)); return k ? T[k] : null; };
  if (/eye/i.test(name))  return pick(/eye/i);
  if (/hair/i.test(name)) return pick(/hair/i);
  if (/face/i.test(name)) return pick(/face\d*_bm$/i) || pick(/face/i);
  return pick(/_bm$/i);
}

// Model 568 arm is Champion's Wraps / Strongman's Wraps, both genders. The wrap is
// modelled AS a bare hand with wrapping on it, so `_envskin_` here is the armor, not skin
// underneath -- but the piece ships that hand TWICE, in Group[1] and Group[2], two
// alternate hand poses the game draws one at a time. Both together give the doubled,
// intersecting hands. Drop the duplicate hand in Group[2] and keep every `_sym_` wrap
// mesh, so no armor is lost. Nothing in the game data marks this: .plpartsdisp ships on
// helms only, so this is an authored entry.
export const HIDE_DUP_HAND = new Set(['568']);

// The mesh + material pipeline, shared by hunter armor, clothing and Palicos. A Palico is
// built from the same MT Framework parts and needs every rule in here -- the Group[100]
// proxy layer, the two meanings of the `_bm` alpha, the `_sym_` dye region, the env
// matcap -- so it takes this path instead of a second copy that would drift from it.
// `opt.otomo` changes only which materials count as fur/eye and where their maps come from.
//
// opt: { key, slot, hideDupHand, otomo }
// ctx: { pigments, wire, showBody, poseName, furTex } -- read as the piece is built, so the
//      caller may hand over live getters
export async function loadEntry(entry, opt, ctx){
  const key = opt.key, slot = opt.slot;
  const hideDupHand = !!opt.hideDupHand, otomo = !!opt.otomo;
  const gltf = await loadGlb(entry.glb, key);
  // Object3D.clone() does NOT rebind skeletons: every clone keeps pointing at the
  // ORIGINAL glb's bones, which live outside the scene graph and never get their world
  // matrices updated - so posing one piece silently desyncs it from the others.
  const root = skeletonClone(gltf.scene);
  // A hide entry is [material, verts] or, for an alternate mesh group, [material, verts,
  // group]. The group form is needed because two alternates can share BOTH name and vertex
  // count -- o210_helm ships its 20-vert trim twice -- so a name+count key would hide the
  // copy meant to stay. Two sets rather than one so the 2-element form stays exact.
  const hideSet = new Set(), hideGrp = new Set();
  for (const h of (entry.hide || []))
    (h.length > 2 ? hideGrp : hideSet).add(h[0] + '#' + h[1] + (h.length > 2 ? '#' + h[2] : ''));
  const jobs = [];
  root.traverse(o => {
    if (o.isMesh || o.isSkinnedMesh) {
      const srcName = (o.material && o.material.name) || '';
      // Two different things, previously conflated:
      //   BLOB  - the Group[100] layer: a ~191-vert full-figure proxy that renders as a
      //           blocky slab over everything. Never drawn.
      //   SKIN  - real exposed flesh inside Group[0] (hands, midriff, thighs). Part of
      //           the armor as authored, so it renders, but it needs the SKIN map --
      //           not every set names it "_skin_", and those were getting the armor map.
      const verts = o.geometry.attributes.position.count;
      // LOD filter: `lod0` is the set of vertex counts at level 0, from the MOD mesh table
      // (+4 field). Pieces carry extra layers at higher levels -- Gore's cape is one --
      // and drawing them all is what makes those sets read wrong.
      const isLod = entry.lod0 && entry.lod0.length && entry.lod0.indexOf(verts) < 0;
      // The proxy layer is Group[100], not "any group but 0". Treating every non-zero group
      // as the proxy hid real armour: Champion's Wraps keeps its forearm and hand meshes in
      // Group[1] and Group[2], so its hands never rendered. Across 2,500 pieces only 7 use
      // a group outside {0,100} at all -- 13 primitives -- so this is a narrow correction.
      const isBlob = isLod || meshGroupId(o) >= 100 || hideSet.has(srcName + '#' + verts)
                  || hideGrp.has(srcName + '#' + verts + '#' + meshGroupId(o))
                  || (hideDupHand && meshGroupId(o) === 2 && /envskin/i.test(srcName));
      // A Palico's flesh is its FUR, and it is spread across four material names --
      // o_skin (the body, shipped inside body.arc), o_face (shipped inside the HELM),
      // o_ear and o_tail. All four take whichever of the 7 fur patterns is selected,
      // which is why the pattern is a texture swap and not a mesh swap.
      const isFur = otomo && /o_(skin|face|ear|tail)/i.test(srcName);
      // the eye's own map; `_light` is the glint, not the iris, so it takes no eye colour
      const isOtEye = otomo && /o_eye/i.test(srcName);
      const isSkin = otomo ? isFur : (!isBlob && /skin/i.test(srcName));
      const file = otomo ? (isFur ? ctx.furTex : entry.tex)
                 : (isBlob || isSkin) ? (entry.skin || entry.tex)
                                      : textureForMaterial(srcName, entry);
      // The `_bm` alpha means two different things depending on the material variant,
      // which is why a global alphaTest once culled most of the armour:
      //   XfB*   the alpha is a smooth GLOSS ramp for the env matcap (Yukumo: 23% of
      //          texels sit mid-range) -- thresholding it deletes the piece
      //   XfBA*  the alpha is a binary CUTOUT mask (Gore: 55% near 0, 43% near 255,
      //          only 1.4% between) -- rendering it opaque leaves solid slabs where
      //          the armour should be cut away
      //
      // But the XfBA prefix alone does NOT mean the alpha is opacity. Lecturer's Footwear
      // is XfBA with 36% of its texels mid-band -- a gloss ramp -- and a 0.5 cut punched
      // holes through a third of the boot. Across the 2,360 pieces with an XfBA material
      // the mid-band fraction is a smooth spread from 0 to 1, so there is no threshold
      // that separates the two kinds; anything picking one would be a guess.
      // What IS safe either way: discard only what is essentially transparent. A real
      // cutout goes to zero in the regions it removes, and a gloss ramp never does.
      const isAlphaMat = /^XfBA/.test(srcName);
      // A Palico's XfBA alpha is a GLOSS RAMP far more often than a cutout, so the
      // hunter's 0.5 erases the armour. Measured over the 117 Palico pieces that carry an
      // XfBA material: the mid-band averages 33.6% of texels (a real cutout is bimodal --
      // Gore sits at 1.4%), and 53 of them keep under 5% of their texture above a 0.5 cut,
      // which is exactly "a lot of Palico equipment does not render".
      //
      // What the alpha DOES separate cleanly is zero from everything else: a==0 averages
      // 16.5% of texels but a<=8 only 21.3%, so the authored holes sit at exactly zero and
      // everything above 8 is ramp. Cutting just above zero drops 4% of a texture; cutting
      // at 0.5 drops 40%. This is the rule the comment above already argued for -- discard
      // only what is essentially transparent -- applied where it is measurable.
      // Left at 0.5 for the hunter, whose armour is not what was measured here.
      const alphaCut = isAlphaMat ? (otomo ? 0.03 : 0.5) : 0;
      // the hunter's flesh is not dyeable by pigment -- it takes the skin-tone selector.
      // `undyeable` is the game's own flag: armorSeriesData byte +113, which is 0 on
      // exactly two armour lines library-wide (Criminal and Hylian), both confirmed
      // undyeable in game, and 1 on every set confirmed dyeable -- Garo included, which
      // is what separates it from the three earlier guesses that a positive broke.
      let tintClass;
      if (isSkin) tintClass = otomo ? 'fur' : 'skin';
      // the glint keeps its authored white; only the iris takes the eye colour
      if (isOtEye && !/_light/i.test(srcName)) tintClass = 'oeye';
      const mat = createMaterial({
        srcName, alphaCut,
        noTint: isSkin || isBlob || isOtEye || !!entry.undyeable,
        tintClass,
        // `_sym_` names the dyeable region; skin and the proxy never qualify
        dyeRegion: !isSkin && !isBlob && /_sym/i.test(srcName),
        slot: otomo ? 'o' + slot : slot,
        // `defaultPig` is the armor's own default pigment -- mSymbolCol from
        // armorSeriesData (+116 male / +119 female), a direct index into the 125-colour
        // palette. It replaced `defaultPigment`, which read ArmorColorData's five bytes as
        // per-slot dye colours; those are per-slot BASE colours and gave Yukumo an orange
        // hat with blue legs when the real set dyes to one dark red.
        own: (entry.defaultPig !== undefined)
          ? ctx.pigments.find(x => x.i === entry.defaultPig) : null,
        wire: ctx.wire });
      // three.js frustum-culls a skinned mesh by its BIND-pose bounding sphere, which is
      // wrong the moment a bone moves -- pieces pop out of existence when the camera gets
      // close or a pose swings them outside the T-pose bounds. Skinning here is cheap and
      // the piece count is small, so just never cull.
      o.frustumCulled = false;
      o.material = mat; allMats.push(mat); armorMats.push(mat);
      // Only materials whose NAME carries an env token are env-lit. The prefix also holds
      // an E<n> on many materials and treating THAT as the marker is wrong: it hands the
      // matcap to 340 materials that should not have one, and on Gore GX -- black armour
      // with a 32-45% gloss mask -- it turned the membrane magenta instead of deep red.
      const em = /env(?:a)?(\d*)/i.exec(srcName);
      if (em && entry.env && entry.env.length){
        // NN indexes this piece's ordered env list where the name carries it. For the
        // 1,701 pieces binding 2+ maps the selector is NOT reliably known -- `mNN` fits
        // only 682 of 1,658, and m088 uses env00/env01 suffixes while m048 uses env/enva
        // -- so anything without an explicit NN takes the first map rather than a guess.
        const ei = Math.min(parseInt(em[1] || '0', 10) || 0, entry.env.length - 1);
        jobs.push(getTexture(entry.env[ei]).then(t => setEnvTexture(mat, t)));
      }
      // The eye quads are OVERSIZED on purpose -- one mesh has to cover every eye option
      // -- so the surround is authored transparent and only its ALPHA keeps it off screen.
      if (isOtEye) mat.userData.u.uAlphaCut.value = 1;
      if (isBlob) { o.visible = false; }
      else if (isSkin) { o.userData.isBody = true; o.visible = ctx.showBody; }
      if (file) jobs.push(getTexture(file).then(t => { mat.map = t; mat.needsUpdate = true; }));
    }
  });
  await Promise.all(jobs);
  root.userData.joints = entry.joints || [];
  // POSES is keyed by the HUNTER's global bone ids; a Palico's gids address different
  // bones entirely, so it stays at its bind pose rather than being posed by a table that
  // does not describe it.
  if (!otomo) poseObject(root, root.userData.joints, ctx.poseName);
  return root;
}

// The player character's face and hair: face000 + hair000 are standalone assets (the BODY
// is not -- it ships inside every armor body.arc, and is what loadEntry's `isSkin` shows).
//
// opt: { key, part ('face' | 'hair'), superseded() -> bool, hideGroups() -> Set | null }
//   `superseded` is checked once the GLB is in, so a stale request drops its result;
//   `hideGroups` is read after that, so it sees the helm worn at build time -- both exactly
//   as the inline code did. hairHideSet / faceHideSet read the DOM and stay in index.html.
export async function loadCharPart(entry, opt, ctx){
  const gltf = await loadGlb(entry.glb, opt.key);
  if (opt.superseded && opt.superseded()) return null;   // superseded while loading
  const root = skeletonClone(gltf.scene);
  const hideSet = new Set((entry.hide || []).map(h => h[0] + '#' + h[1]));
  // NB: for armor, a non-zero mesh group means the proxy blob and is hidden outright.
  // Character parts are the opposite -- their groups are REAL geometry, and which ones
  // to drop is decided by the helm, not by the group number.
  const hideGroups = opt.hideGroups ? opt.hideGroups() : null;
  const jobs = [];
  root.traverse(o => {
    if (!(o.isMesh || o.isSkinnedMesh)) return;
    const srcName = (o.material && o.material.name) || '';
    const verts = o.geometry.attributes.position.count;
    if (hideSet.has(srcName + '#' + verts)) { o.visible = false; return; }
    if (hideGroups && hideGroups.has(meshGroupId(o))) { o.visible = false; return; }
    const file = textureForMaterial(srcName, entry);
    const mat = createMaterial({
      srcName, alphaCut: 0,
      // never dyed by armor pigment, but it does take the hair/eye/skin selectors
      noTint: true,
      tintClass: opt.part === 'hair' ? 'hair'
               : /eye/i.test(srcName) ? 'eye' : 'skin',
      wire: ctx.wire });
    o.frustumCulled = false;     // same bind-pose culling problem as the armour
    o.material = mat; allMats.push(mat);
    if (file) jobs.push(getTexture(file).then(t => { mat.map = t; mat.needsUpdate = true; }));
  });
  await Promise.all(jobs);
  root.userData.joints = entry.joints || [];
  poseObject(root, root.userData.joints, ctx.poseName);
  return root;
}
