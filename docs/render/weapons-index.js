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
// THE PHIAL A SWITCH AXE FIRES. It is a property of the WEAPON, not of the model, and the viewer picks
// a model -- so a model that several named weapons share can carry more than one. Across the Switch
// Axe's 108 listed weapons on 107 models exactly ONE does: model 136 is Yukumo Switch Axe (Power) and
// Yukumo Pure Axe (Dragon). Both are in the picker, so the NAME settles that one and the model answers
// for every other (Raven, 2026-09-27: "use a model based approach but add an exception that updates the
// phial type based on the name if model 136 is selected"). Nothing is special-cased to 136: the rule is
// "the name decides where the model cannot", which is the same answer without a magic number in it.
//   The data is docs/weapons/w08.json `phial`, from table/weapon08BaseData.w08d byte +18 -- a column
// located against the Collection Tracker's own switch_axe.json and agreeing on all 109 rows
// (C:/MHGU-Extract/add-weapon-phials.py). No other class ships one yet, so this answers null for them.
export function phialFor(cj, modelId, name){
  if (!cj || !modelId) return null;
  const rows = (cj.weapons || []).filter(r => r.named && r.phial && modelIdOf(r.model) === modelId);
  if (!rows.length) return null;
  if (name){ const hit = rows.find(r => r.name === name); if (hit) return hit.phial; }
  return rows[0].phial;
}
// every phial the model can carry, so a caller can tell a settled model from the ambiguous one
export function phialsFor(cj, modelId){
  if (!cj || !modelId) return [];
  return [...new Set((cj.weapons || [])
    .filter(r => r.named && r.phial && modelIdOf(r.model) === modelId).map(r => r.phial))];
}
// THE COLOUR A WEAPON CARRIES: an index into table/equipBaseColorData (docs/pigments.json), or null for none -- a property
// of the WEAPON, so one model shows each of its weapons in its own colour (Raven, 2026-10-06: "Secta weapons, they use the
// same model ... but change color slighty"). The data is docs/weapons/<cls>.json `col`, the byte after the element of
// table/weaponNNBaseData (C:/MHGU-Extract/add-weapon-colours.py); the player's part-colour setter 0x28726c writes it over
// the channel-3 materials' fAlbedoColor (render/material.js setChannelColor).
export function colourFor(cj, modelId, name){
  if (!cj || !modelId) return null;
  const rows = (cj.weapons || []).filter(r => r.named && modelIdOf(r.model) === modelId);
  if (!rows.length) return null;
  const hit = (name && rows.find(r => r.name === name)) || rows[0];
  return hit.col || null;
}
// THE ELEMENT A WEAPON CARRIES ('Fire' | 'Water' | 'Thunder' | 'Dragon' | 'Ice' | 'Poison' | 'Paralysis' | 'Sleep' |
// 'Blast'), or null for none -- a property of the WEAPON like the phial, so the name decides where the model cannot.
// The data is docs/weapons/<cls>.json `element`, from table/weaponNNBaseData byte +17 (0 none, 1 Fire, 2 Water,
// 3 Thunder, 4 Dragon, 5 Ice, 6 Poison, 7 Paralysis, 8 Sleep, 9 Blast): the column was located per class against the
// Collection Tracker's own `ele` and agrees on every row of the twelve classes that have one
// (C:/MHGU-Extract/add-weapon-elements.py; the two Bowguns carry none). The game's code asks for it as player
// parameter 17 -- the Switch Axe's burst shells pick their row by it (render/weapon-fx.js burstRow).
export function elementFor(cj, modelId, name){
  if (!cj || !modelId) return null;
  const rows = (cj.weapons || []).filter(r => r.named && modelIdOf(r.model) === modelId);
  if (!rows.length) return null;
  const hit = (name && rows.find(r => r.name === name)) || rows[0];
  return hit.element || null;
}

// THE HUNTING HORN'S NOTES ([n1, n2, n3], note numbers 1..8), or null -- a property of the WEAPON like the phial, so the
// name decides where the model cannot. docs/weapons/w12.json `notes` is the horn's LAST level's set (table/
// weapon12LevelData.w12d +14 -> table/fueMusicData.fmt; C:/MHGU-Extract/add-weapon-notes.py, every level agreeing with the
// Collection Tracker); `notesFrom` holds every set by the level it starts at. The class reads note k as player parameter
// 0x1b + k (render/weapon-fx-w12.js).
export function notesFor(cj, modelId, name){
  if (!cj || !modelId) return null;
  const rows = (cj.weapons || []).filter(r => r.named && r.notes && modelIdOf(r.model) === modelId);
  if (!rows.length) return null;
  const hit = (name && rows.find(r => r.name === name)) || rows[0];
  return hit.notes;
}

// THE BOW'S OPEN CHARGE LEVELS (2..4), or null -- a property of the WEAPON like the phial, so the name decides where the
// model cannot. docs/weapons/w10.json `charges` is table/weapon10LevelData.w10d +14 (weapon field 0xe, player parameter 28,
// which caps the class's charge level: render/weapon-fx-w10.js), the bow's last level's (C:/MHGU-Extract/add-bow-charges.py,
// every level row agreeing with the Collection Tracker's).
export function chargesFor(cj, modelId, name){
  if (!cj || !modelId) return null;
  const rows = (cj.weapons || []).filter(r => r.named && r.charges && modelIdOf(r.model) === modelId);
  if (!rows.length) return null;
  const hit = (name && rows.find(r => r.name === name)) || rows[0];
  return hit.charges;
}

// THE GUNLANCE'S SHELLING, { type, level } or null -- a property of the WEAPON, by name where the model cannot say.
// docs/weapons/w09.json `shell`: type = weapon09BaseData +18 (0 Normal, 1 Wide, 2 Long; player parameter 27, which picks
// the shelling shell's row and the heat thresholds: render/weapon-fx-w09.js), level = weapon09LevelData +14 of the last
// level (0-based; parameter 28) -- C:/MHGU-Extract/add-gunlance-shells.py, every level row agreeing with the Collection
// Tracker's.
export function shellFor(cj, modelId, name){
  if (!cj || !modelId) return null;
  const rows = (cj.weapons || []).filter(r => r.named && r.shell && modelIdOf(r.model) === modelId);
  if (!rows.length) return null;
  const hit = (name && rows.find(r => r.name === name)) || rows[0];
  return hit.shell;
}

export function rowFor(cj, modelId){
  return (cj.weapons || []).find(r => r.named && modelIdOf(r.model) === modelId) || null;
}
