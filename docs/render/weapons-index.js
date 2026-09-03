// The per-class weapon indexes: docs/weapons/wNN.json (every model of the class, its parts,
// the Smithy-ordered name list, and the class's shared stances, motion sets and gimmick
// tables) and docs/weapons/bug.json (the kinsects). Loaded lazily, once per class, so the
// manifest only carries a stub per class.
import { loadJson } from './assets.js';

const cache = new Map();

// the class stubs the manifest carries: [{ key, class, index }]
export function classes(manifest){
  return (manifest.weapons || []).filter(w => w && w.index);
}

export async function loadClass(cls){
  if (!cache.has(cls)) cache.set(cls, loadJson('weapons/' + cls + '.json'));
  return cache.get(cls);
}

export async function loadKinsects(){
  if (!cache.has('bug')) cache.set('bug', loadJson('weapons/bug.json'));
  return cache.get('bug');
}

// model ids are 3-digit strings in the indexes; the name rows carry them as numbers
export function modelIdOf(n){ return String(n).padStart(3, '0'); }

// the model to show when none is chosen: the first named row in Smithy order that ships a
// model -- the class's Petrified weapon, which is what the viewer used to ship
export function defaultModel(cj){
  for (const r of cj.weapons || []){
    const id = modelIdOf(r.model);
    if (r.named && cj.models[id]) return id;
  }
  const ids = Object.keys(cj.models || {});
  return ids.length ? ids[0] : null;
}

// the Smithy row shown for a model (the first named row that uses it)
export function rowFor(cj, modelId){
  return (cj.weapons || []).find(r => r.named && modelIdOf(r.model) === modelId) || null;
}
