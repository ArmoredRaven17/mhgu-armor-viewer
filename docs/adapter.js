// THIS VIEWER'S DATA, MAPPED FOR THE SHARED BASE (docs/base; the plan: C:\\Coding Repos\\VIEWER-BASE-PLAN.md). The base's
// modules never read GU's data files themselves (manifest.json's pieces, the Palico table, pigments.json): what they
// need from them comes through here, so a 3U or 4U viewer supplies its own adapter over armor.json / weapons.json and the
// base stays the same. Each function reads the app's live objects through `app`, set once by the page (setApp).
let app = null;
export function setApp(a){ app = a; }

// Every armor in the game has a default pigment, so Default RESTORES it rather than
// removing the tint: it reads the equipped piece's own `defaultPig` (mSymbolCol) and puts
// that colour in the row. A piece with no pigment to restore -- an empty slot, one of the
// 28 undyeable pieces, or one of the 42 that join to no series -- falls back to off.
export function defaultPigHex(slot){
  // The Palico's own default. `cOtArmorBase` has no mSymbolCol; its only colour fields are
  // mBaseColHelm / mBaseColBody (otArmorData +31 / +32), and those track the dyeable
  // region closely enough to use -- of the pieces carrying a `_sym_` material, 478 of 480
  // helms and 476 of 478 bodies have a non-zero value, while pieces with no `_sym_` region
  // read zero 45-62% of the time.
  if (slot === 'ohelm' || slot === 'obody'){
    const k = slot.slice(1);
    const e = app.OT && app.OT.pieces['o' + app.otModelOf(k, app.otState[k]) + '_' + k];
    if (!e || e.defaultPig === undefined) return null;
    const p = app.PIGMENTS.find(x => x.i === e.defaultPig);
    return p ? p.hex : null;
  }
  const sel = document.querySelector('select[data-slot="' + slot + '"]');
  const id = sel ? app.modelOf(slot, sel.value) : null;      // the select holds a token
  if (!id) return null;
  const e = app.manifest.pieces[app.gender + id + '_' + slot];
  if (!e || e.undyeable || e.defaultPig === undefined) return null;
  const p = app.PIGMENTS.find(x => x.i === e.defaultPig);
  return p ? p.hex : null;
}

// WHETHER THE PIECE WORN IN A SLOT TAKES A PIGMENT (the pigment rows' disabled state, base/ui/pigment.js paintDyeable):
// { can, reason }. GU: nothing worn (the slot shows the clothing, which has its own Clothing Color row), or one of the
// 28 pieces the game marks undyeable (manifest `undyeable`). The Palico's two rows: nothing worn. The reasons are the
// MH3U Armor Viewer's own wording for the same two cases.
export function dyeable(slot){
  if (slot === 'ohelm' || slot === 'obody'){
    const k = slot.slice(1);
    const worn = app.otState && app.otState[k] && app.otState[k] !== 'none';
    return worn ? { can: true } : { can: false, reason: 'Nothing is worn in this slot' };
  }
  const sel = document.querySelector('select[data-slot="' + slot + '"]');
  const id = sel ? app.modelOf(slot, sel.value) : null;
  if (!id) return { can: false, reason: 'Nothing is worn in this slot' };
  const e = app.manifest.pieces[app.gender + id + '_' + slot];
  if (e && e.undyeable) return { can: false, reason: 'The game does not let this piece be dyed: it keeps its own color' };
  return { can: true };
}

// ---- THE ARMOR LISTS (base/ui/armor-panel.js asks for them): GU's forge order, Uncraftable, Chakra ----
// Slots hold a bare numeric model id; the gender prefix is applied when building the
// piece key, so switching gender re-loads the same ids against the other body.
function pieceKey(id, slot){ return app.gender + id + '_' + slot; }
export function pieceOf(id, slot){ return app.manifest.pieces[pieceKey(id, slot)]; }

function labelFor(id, slot){
  const e = pieceOf(id, slot);
  return (e && e.name) ? e.name : id;
}

// The list is the SMITHY's, 1:1 -- `armorCreateA00..A04.acrd`, one file per slot, whose
// row order is the order the game shows. So Jaggi Helm and Jaggi Helm S are two entries
// even though both render model 003, because that is what a player sees in the forge.
// (The old list was one row per MODEL with the ranks collapsed into "(Base/S/X)" -- fewer
// rows, but nothing a player could match against the game.)
// Non-forgeable armour -- event, collab, Criminal, Hylian -- is in no forge list at all,
// so it follows in its own group rather than becoming unreachable.
// read when asked: the page hands the adapter its objects (setApp) after this module loads
const smithy = () => (app.manifest && app.manifest.smithy) || {};
export function armorOptions(slot, type){
  const out = [], seen = new Set();
  const forge = [];
  for (const r of (smithy()[slot] || [])){
    if (!r.g.includes(app.gender) || !pieceOf(r.model, slot)) continue;
    // "Uncraftable" means absent from the FORGE, not absent from the current view -- so
    // seen is filled before the type filter, or picking Gunner would dump every
    // Blademaster-only model into the uncraftable pile
    seen.add(r.model);
    // hunter_type 2 is Blademaster/Gunner -- the shared sets and the mask-type head
    // pieces -- and those stay in the list whichever type is picked
    const ty = type;
    if (ty !== 'all' && r.t !== 2 && r.t !== (ty === 'b' ? 0 : 1)) continue;
    forge.push({ value: 's' + r.series, label: r.name, model: r.model,
                 group: 'Rarity ' + r.r });
  }
  // Pure forge order -- NOT sorted by rarity. The Smithy is rarity-ascending for the first
  // ~1000 rows and then appends a block of collab and special gear (Varia Suit, Hero's,
  // Lodestar, Rage, Hiryu, Criminal, Garo, Hylian) at lower rarities. Sorting by rarity
  // scatters that block through the middle, where the game keeps it together at the end.
  // The rarity labels still appear -- groups break wherever the rarity changes, giving 11
  // clean runs plus the small tail ones, so a repeated "Rarity 7" late in the list is the
  // special block and not a mistake.
  out.push(...forge);
  for (const id of (app.manifest.ids || [])){
    if (seen.has(id) || !pieceOf(id, slot)) continue;
    // the default clothing is not armor -- it has its own control in the Hunter panel,
    // and it is unnamed, so leaving it here would list bare model ids under Uncraftable
    if (app.CLOTHING.indexOf(id) >= 0) continue;
    out.push({ value: 'u' + id, label: labelFor(id, slot), model: id, group: 'Uncraftable' });
  }
  return out;
}
// Chakra is series 512 with MODEL ID 0 -- it has no armor geometry at all, which is why
// the game falls through to the default clothing when you wear it. So it is offered as a
// real choice in every slot, and picking it mounts the clothing for that slot. Its five
// names come from the game's own series table, in slot order.
// `— none —` stays, and means exactly that: nothing on this slot.
export const CHAKRA = 'chakra';
export const CHAKRA_LABEL = { helm:'Chakra Earring', body:'Chakra Necklace', arm:'Chakra Bracelet',
                       wst:'Chakra Waistlet', leg:'Chakra Anklet' };
export function isChakra(slot){
  const sel = document.querySelector('select[data-slot="' + slot + '"]');
  return !!sel && sel.value === CHAKRA;
}
// the entries above a slot's list: Chakra
export function armorSpecials(slot){ return [{ value: CHAKRA, label: CHAKRA_LABEL[slot] }]; }
// the model an older save's token meant: a bare model id (pre-Smithy) when it is a piece; with `anyToken`, also a
// 'u<model>' from a build where the model was not yet in the forge list and an 's<series>' through the Smithy row
export function legacyModel(slot, v, anyToken){
  if (!anyToken) return pieceOf(v, slot) ? v : null;
  if (v[0] === 'u') return v.slice(1);
  if (v[0] === 's'){ const row = (smithy()[slot] || []).find(r => 's' + r.series === v); return row ? row.model : null; }
  return v;
}

// ---- THE WEAPON CLASSES' CANONICAL NAMES (base/ui/weapon-panel.js orders the Class list by them): GU's manifest names
// its classes as the Guild Card does already ----
export function weaponClassName(w){ return w.class; }

// ---- THE HUNTER PANEL'S LISTS (base/ui/hunter-panel.js asks for them): GU's manifest ----
// the face or hair styles of the gender shown, in file order (manifest.chars: [{ id, label, textures }])
export function charStyles(part){ return ((app.manifest.chars && app.manifest.chars[app.gender]) || {})[part] || []; }
// How many paints this face ships: one `_make###` texture per paint layer (fourteen on every
// face of both genders, but counted rather than assumed). They have no names in game, so they
// are Type 1..N here as the faces and hairs are (Raven, 2026-09-24).
export function paintCount(){
  const list = charStyles('face');
  const e = list[+document.getElementById('faceStyle').value] || list[0];
  return Object.keys((e && e.textures) || {}).filter(k => /_make\d+/.test(k)).length;
}
// the clothing models, labelled "Type N" in file order -- the same convention the face and hair lists use, and the
// game's own `Type %d` string; they have no real names to use
export function clothingOptions(){ return app.CLOTHING.map((id, i) => ({ value: id, label: 'Type ' + (i + 1) })); }
// THE GAME'S LOOP FLAG per clip (base/render/pose.js clipLoop): an LMT motion's loopFrame (+12, s32; -1 plays once and
// holds, >= 0 loops back to that frame). revil's lmt_to_gltf carries it in the clip names: a looping motion is
// `Motion[n]_loop` (from frame 0), or, looping from a later frame, `Motion[n]_start` (the frames before it, played once)
// and `Motion[n]_loop` (the looped rest); every other `Motion[n]` plays once. Checked against the LMT headers: 306 of
// 306 motions agree (w00 / w03 / w08), 233 of the 1,494 weapon motions loop
export function clipLoop(entry){
  const c = entry && entry.clip;
  if (typeof c !== 'string' || !/^Motion\[\d+\]/.test(c)) return null;
  return /_loop$/.test(c);
}
// the game's held poses (manifest.poses: [{ label, group, src, clip, dur }])
export function poseOptions(){ return app.manifest.poses || []; }
