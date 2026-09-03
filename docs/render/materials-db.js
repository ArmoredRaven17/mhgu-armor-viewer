// docs/materials.json: what the game's own material files (.mrl) say about every material,
// resolved through the shader package (build-materials.py + mfx.py). This module loads it
// once and answers lookups. Phase 2 uses only the texture bindings (which map is the albedo,
// which is the sphere map); Phase 3 drives the whole material from it.
//
// Keys: armour/Palico/char pieces by manifest key ('m001_body'), weapons by
// 'wNN/<model>' with parts as 'wNN/<model>/<sld|ya|sou_l|saya>' and kinsects as 'bug/NNN'.
// An entry is { tex: [pool paths in the MRL's texture-table order], mats: { name: {...,
// t: { albedo, spec, sphere } } } } where the t indices are 1-based into tex.
import { loadJson } from './assets.js';

let DB = null;

export async function loadMaterialsDb(){
  if (!DB) DB = await loadJson('materials.json');
  return DB;
}
export function materialsDb(){ return DB; }

export function entryFor(ref){
  if (!DB || !ref) return null;
  return (DB.weapons && DB.weapons[ref]) || (DB.pieces && DB.pieces[ref]) || null;
}
// the entry a shipped glb belongs to (materials.json carries the map for the weapon glbs)
export function refForGlb(glbPath){
  return (DB && DB.glb && DB.glb[glbPath]) || null;
}

// the render state of a material spec (materials.json `state` table): { bs, ds, rs, bias,
// cull, blend } with blend 'opaque' | 'alpha' | 'add' from the MRL's blend-state record
export function stateFor(m){
  return (DB && m && DB.state && m.s !== undefined) ? (DB.state[m.s] || null) : null;
}

// texturesFor(ref, materialName) -> { albedo, mask, sphere, mat, entry } (pool paths or null)
// A material the MRL does not name (the exporter's placeholder, or a hash-keyed orphan)
// falls back to the table's first map, which is the piece's own _BM in every file seen.
export function texturesFor(ref, name){
  const e = entryFor(ref);
  if (!e) return null;
  const tex = e.tex || [];
  const pick = i => (i && tex[i - 1]) || null;
  const m = (e.mats && e.mats[name]) || null;
  if (m && m.t) return { albedo: pick(m.t.albedo), mask: pick(m.t.spec), sphere: pick(m.t.sphere), mat: m, entry: e };
  return { albedo: tex[0] || null, mask: null, sphere: null, mat: null, entry: e };
}
