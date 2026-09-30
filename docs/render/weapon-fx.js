// THE WEAPON'S EFFECTS: the game's own particle effects, fired where the game fires them.
//
// Raven, 2026-09-27: "Implement effects". The Bow's charge glow, a Switch Axe's phial burst, the dust a
// footfall kicks up -- MHGU draws all of it through one effect system, and the Monster Viewer has that
// system translated from the ROM (render/rom/effect/, 37 modules, taken here verbatim: see
// render/rom/SOURCE.json). This module is the small part that is THIS app's: it says which effects a
// weapon has and when they run, and hands the runtime the hunter's skeleton to hang them from.
//
// WHAT DECIDES WHEN. Nothing here picks an effect. Every weapon class ships two .psl -- a per-motion
// schedule, one run-length track per motion slot saying which effect keys are alive over which frames --
// and those two are the very split this app already keeps its weapon motions in:
//     <cls>.psl      the main list   ->  the viewer's `_draw` set
//     <cls>_sa.psl   the Arts list   ->  the viewer's `_sa` set
// efx/export_weapon_effects.py decodes them into docs/effects/<cls>.json `clips`, keyed "<set>:<slot>",
// and the runtime's own PSL walker (rom/effect/schedule.js, a translation of cMhEffectSequence) does the
// rest: this module only tells it which clip is playing and where in it we are. So the timing is the
// game's, frame for frame, and a clip the viewer cannot play simply never fires.
//
// WHAT IT HANGS FROM. In the game every effect hangs off a PARENT UNIT whose joint matrices it reads; for
// a weapon effect that unit is the HUNTER, and the joints are the player's own bone ids -- 12 is the hand
// the nocked arrow already mounts to, 16 and 19 the feet the footfall dust comes off. This app's bones are
// spread over several mounted roots (each armour piece is skinned to the same shared skeleton), so the
// host below is a group carrying the UNION of their gid tables: gidBonesOf reads a cached
// `userData.gidBones` if one is there, which is exactly what this sets.
//
// UNITS. The runtime works in game units; this app's world is game units / 100, and live.js carries that
// 0.01 both ways (it was written for a monster viewer whose world has the same scale).
//
// THE CLOCK IS THE ANIMATION, not the wall. live.js steps its effects by `advance`, the seconds of
// ANIMATION time the stance moved since the last draw -- so a paused pose freezes the effects with it and
// a scrub does not run them. That is the Monster Viewer's lesson (Raven there, 2026-09-22: a paused clip
// left the eyes and the trail running on a frozen monster), and this app pauses and scrubs far more.
import * as THREE from 'three';
import { LiveEffects } from './rom/effect/live.js';
import { gidBonesOf } from './skeleton.js';
const hex = h => Uint8Array.from(h.match(/../g) || [], b => parseInt(b, 16));   // a record payload, as schedule.js reads it
const MT_TO_VIEW = 0.01;   // the runtime's game units to this app's world (rom/effect/live.js)

// TWO ROM ROUTINES THE LIFTER CANNOT REACH are answered natively in render/weapon-natives.js (imported for that alone;
// the page exporter dev/effect-export-rom-w08.mjs imports it too).
import './weapon-natives.js';

// the effects a class has, once per class per page
const defs = new Map();
export async function weaponEffectDef(cls){
  if (!cls || cls === 'none') return null;
  if (defs.has(cls)) return defs.get(cls);
  let doc = null;
  try {
    const r = await fetch('effects/' + cls + '.json?v=' + Date.now());
    doc = r.ok ? await r.json() : null;
  } catch (_) { doc = null; }
  defs.set(cls, doc);
  return doc;
}
// which classes this app ships effects for (the harness and the UI ask)
export function weaponEffectClasses(){ return [...defs.keys()].filter(k => defs.get(k)); }

// The motion slot a stance names. The weapon's clips pair with the hunter's BY NUMBER (render/weapon.js),
// and the PSL's slot is that same number, so "Motion[14]_loop" is slot 14.
export function slotOf(clipName){
  const m = /Motion\[(\d+)\]/.exec(clipName || '');
  return m ? parseInt(m[1], 10) : null;
}
// `_sa` stances take the Arts list, everything else the main one -- render/weapon.js's own rule
export function setOf(stanceFile){ return /_sa\.glb$/.test(stanceFile || '') ? 'sa' : 'draw'; }

export class WeaponEffects {
  constructor(){
    this.cls = null;
    this.live = null;
    this.host = null;
    this.parent = null;          // the scene group the host is added to
    this.on = true;
    // THE STATE LAYER IS BUILT AT ATTACH but nothing starts a state record on its own. It was off by
    // default while every record's load ran the game's loader afresh (41 s for a Charge Blade's 165);
    // with the list shared per .efl (rom/effect/host.js createEffect) a mount is cheap again, so the
    // records are there for a caller (startState) and the harness. Which caller is the open question:
    // see the phial section below for what the ROM says about the Switch Axe's.
    this.stateLayer = true;
    this.lastKey = null;
    this.auraKey = null;
    this.pending = 0;            // the load generation, so a fast weapon switch cannot land out of order
    this.refused = new Set();    // records whose code took a branch no recording covers: left out of the rebuilt host
    this.floor = null;            // () => the height the hunter stands on, in viewer units (the player's position y)
    this.lastSync = null;        // what sync was last given, for the rebuild
    this.suppressed = false;     // held without being taken down (setSuppressed): the page is showing the Palico
  }

  // The union of every mounted root's gid table, as one host object the runtime can treat as the unit.
  // Rebuilt on every attach: the roots change with every armour piece.
  makeHost(roots){
    const seen = new Map();
    for (const root of roots){
      if (!root) continue;
      for (const b of gidBonesOf(root)) if (!seen.has(b.gid)) seen.set(b.gid, b);
    }
    const host = new THREE.Group();
    host.name = 'weapon-fx-host';
    host.userData.gidBones = [...seen.values()].sort((a, b) => a.d - b.d);
    host.userData.joints = [];
    return host;
  }

  // Show `cls`'s effects, hanging from `roots`, in `parent`. Called on every weapon change and whenever
  // the armour changes under it (the bones are new objects then, and a stale table would drive nothing).
  async attach(cls, roots, parent){
    this.detach();                     // (bumps the generation itself, so the one taken here is after it)
    const gen = ++this.pending;
    const def = await weaponEffectDef(cls);
    if (gen !== this.pending || !def || !this.on) return null;
    const host = this.makeHost(roots);
    if (!host.userData.gidBones.length) return null;      // no hunter on screen yet
    parent.add(host);
    try {
      const use = this.useDef(def);
      const live = new LiveEffects(use);
      live.suppressed = this.suppressed;
      // the unit's height: the floor the hunter stands on (index.html figureFloor), the player's position (rom/effect/live.js
      // unitMatrix); a weapon-unit host leaves it unset, its unit is the weapon's own bone 0
      live.unitFloor = this.floor ? () => this.floor() : null;
      await live.attach(host);
      if (gen !== this.pending){ live.detach(); parent.remove(host); return null; }
      this.cls = cls; this.live = live; this.host = host; this.parent = parent;
      this.lastKey = null;
      return live;
    } catch (e){
      parent.remove(host);
      console.warn('weapon effects: ' + (e && e.message));
      return null;
    }
  }

  // The effects this host builds from the class's definition: all of them, or all but the state records
  // while the state layer is off. The weapon-unit host below narrows it to the records it hangs.
  useDef(def){
    const keep = e => (this.stateLayer || e.when !== 'state') && !(e.record && this.refused.has(e.record.key));
    // THE JOINTS A REQUESTER ROOTS A RECORD ON (the block's +0x52, mask +0x14 bit 5): the parent unit carries only the joints
    // the effects name, and a request that overrides its record's root joint names one no record does -- the Sword &
    // Shield's rows 1 / 3 / 4 hang from the player's joint 1 (render/weapon-fx-w01.js). `requestJoints(cls)` answers
    // { record key: joint } for the class (PlayerRequests.rootJoints); those joints join their records' lists.
    const extra = this.requestJoints ? this.requestJoints(def.weapon) : null;
    const add = e => {
      const j = extra && e.when === 'state' && e.record ? extra[e.record.key] : undefined;
      return j != null && !(e.joints || []).includes(j) ? Object.assign({}, e, { joints: [...(e.joints || []), j] }) : e;
    };
    return Object.assign({}, def, { effects: (def.effects || []).filter(keep).map(add) });
  }

  // Attach only when something that matters has changed: the class, or the BONES under it. Every armour
  // change remounts the pieces, so the gid table points at objects that are no longer in the scene and
  // the effects would follow a skeleton nobody poses -- but a stance change must not pay for a reload,
  // and stances change constantly. The gid-0 bone's identity is the cheap test for both.
  async sync(cls, roots, parent){
    const first = (() => { for (const r of roots || []) { const b = gidBonesOf(r)[0]; if (b) return b.node; } return null; })();
    this.lastSync = { cls, roots, parent };
    if (this.cls === cls && this.live && this.boneSample === first) return this.live;
    this.boneSample = first;
    return this.attach(cls, roots, parent);
  }

  detach(){
    // AN ATTACH IN FLIGHT IS CANCELLED TOO: it is for a host nobody wants any more, and landing after this it would
    // undo the detach. Measured 2026-09-29: the weapon-unit host takes about 3.2 s to build, and sheathing inside that
    // window left it attached to a weapon on the back, asking for effects as if it were drawn.
    this.pending++;
    if (this.live){ try { this.live.detach(); } catch (_) {} }
    if (this.host && this.parent) this.parent.remove(this.host);
    this.live = null; this.host = null; this.cls = null; this.lastKey = null; this.auraKey = null;
  }

  // Every frame, before the render. `stance` is the weapon's current { file, clip }, `time` the stance
  // action's time in seconds and `advance` the animation seconds since the last frame (0 while paused).
  step(stance, time, advance){
    const slot = stance ? slotOf(stance.clip) : null;
    const set = stance ? setOf(stance.file) : null;
    this.stepClip(slot === null ? null : set + ':' + slot, time, advance);
  }

  // THE GENERIC CLIP DRIVER. `id` is the schedule's own key into def.clips ("draw:14" for a weapon,
  // "co_0:16" for one of the hunter's common motions) or null for a clip with no schedule.
  stepClip(id, time, advance){
    const live = this.live;
    if (live && live.failed){
      // ONE REFUSAL STOPS THE WHOLE HOST (a branch no recording took: rom/effect/live.js fail). As the weapon-unit host
      // below does for its own records: remember the record the schedule had just started, and rebuild the host without
      // it, so one unrecorded effect does not take every other effect of the class with it for the session.
      const key = live.schedule ? live.schedule.lastStarted : null;
      if (key != null) this.refused.add(key);
      console.warn('weapon effects: ' + live.failed + (key != null ? ' -- record ' + key + ' dropped for this session' : ''));
      this.detach();
      if (this.lastSync) this.sync(this.lastSync.cls, this.lastSync.roots, this.lastSync.parent);
      return;
    }
    if (!live || !live.schedule) return;
    live.advance = advance;
    const def = live.def;
    const key = id === null ? null : (this.cls + '|' + id);
    const motion = id === null ? null : def.clips[id];
    // A clip with no schedule still has to be NAMED: handing the walker a null key while a clip plays
    // would read as "no motion", and the next real clip would look like a continuation of it.
    live.schedule.setClip(key, key ? (time || 0) * 60 : 0, motion || null, 0);
    this.lastKey = key;
  }

  // ---- the STATE layer ------------------------------------------------------------------------
  // The records the motion schedule never names: the weapon's code requests these from game state.
  // On the Switch Axe that is the sword-mode aura, one .efl of 30 rows whose seven ROW-MASK variants
  // are the phial (docs/effects/w08.json `when: 'state'`; efx/export_weapon_effects.py). The runtime
  // never starts them on its own -- schedule.js only auto-starts 'always' / 'rage' / 'calm' -- so
  // they are started from here, and they stay up until something takes them off.
  //   WHICH VARIANT A PHIAL PICKS IS NOT READ YET, so nothing here maps one: `startState` takes the
  // record key and the caller says which. When the mapping is read it belongs beside the phial, not
  // buried in here.
  stateEntries(){
    const sc = this.live && this.live.schedule;
    return sc ? sc.entries.filter(e => e.when === 'state' && e.def.record) : [];
  }
  // every state record this class ships, for a caller choosing one
  stateRecords(){
    return this.stateEntries().map(e => ({ key: e.def.record.key, pel: e.def.record.pel,
                                           array: e.def.record.array, efl: (e.def.efl || '').split('/').pop(),
                                           running: e.requests.length }));
  }
  // `requester`, when given, is the request block's overrides (rom/effect/proof.js ProofRequest): the sword aura's
  // root joint and colour. Without one the record is requested as the schedule requests its own.
  startState(key, efl, requester = null){
    const sc = this.live && this.live.schedule;
    if (!sc) return null;
    if (!this.stateLayer){ console.warn('weapon effects: the state layer is not loaded (setStateLayer(true))'); return null; }
    // (pel, key) is not a record's identity: a key can sit in the SEQUENCE and the UNIQUE array of one .pel as two
    // records (different joint and offset; export_weapon_effects.py ships both, each with its `array`). Code requests
    // search array 2, UNIQUE (vtable +0x138), so of two state records with this key the UNIQUE one is the game's; the
    // schedule's clip records are SEQUENCE by construction (schedule.js setClip). The Monster Viewer session found the
    // eight same-key same-efl pairs among the weapon pels (w04 901, w11 500/501, w14 600/601/610/611; w08 550 is
    // identical in both) -- a class that ships two must not be picked by whichever comes first.
    const hits = this.stateEntries().filter(x => x.def.record.key === key &&
                                                 (!efl || (x.def.efl || '').indexOf(efl) >= 0));
    const e = hits.find(x => x.def.record.array === 'UNIQUE') || hits[0];
    if (!e) return null;
    try {
      if (requester){
        const r = e.def.record;
        e.requests.push(sc.host.requestEffect(e.owner, sc.parent, { index: r.index, key: r.key, path: r.path, payload: hex(r.payload) }, undefined, requester));
        sc.starts++;
      } else sc.start(e);
    } catch (err){ console.warn('weapon effects: state start ' + key + ': ' + err.message); return null; }
    return e.requests[e.requests.length - 1];
  }
  // take a state record off (all of its requests), or every one when no key is given
  stopState(key){
    const sc = this.live && this.live.schedule;
    if (!sc) return 0;
    let n = 0;
    for (const e of this.stateEntries()){
      if (key != null && e.def.record.key !== key) continue;
      for (const q of e.requests){ try { sc.host.releaseRequest(q); n++; } catch (_) {} }
      e.requests.length = 0;
    }
    return n;
  }

  // ---- the Switch Axe's PHIAL EFFECTS: the ROM's own requests, and where they are made from ----
  // Read 2026-09-28 (uPlayerQuest08, the requests followed to their end; docs/effects/w08-shells.json carries the data,
  // built by C:/MHGU-Extract/efx/tools/w08shells.py) and WIRED the same day, below in WeaponUnitEffects:
  //   * THE SWORD AURA is w08_000.efl 500/501 and w08_001.efl 505/506: MODEL rows drawing effect/base/cm153_000 (an
  //     animated blade model, 45 frames) on the weapon. uPlayerQuest08's requester 0x11a40f4(self, mode) hangs the request
  //     from the player's part slot 7 (+0x23a0: the first WEAPON unit), overrides the ROOT JOINT to 0 (request +0x52, mask
  //     +0x14 bit 5), reads the phial (vtable +0x15c query 27 = weapon08BaseData mBinType) and asks the effect-holder shell
  //     (uShellPlEffectW08 at +0x2634, vtable +0x150, through the player's vtable +0x39c = 0x281ef4) for holder ROW `code`:
  //     Dragon takes the even code ([2,4,6,10][mode] -> 501 / 506 / 801 / 801) with no colour, every other phial the odd
  //     one ([1,3,5,9][mode] -> 500 / 505 / 800 / 800) plus a COLOUR (request +0x80, bit 17): entry [8,9,10,0,12,11][phial]
  //     (rodata 0x16a76b0) of the effect manager's colour-control slot 1 -- resident.arc effect/pec/pec_001, the FIXED
  //     phial colours (see PHIAL COLOURS below) -- and when the table has no such entry, NO request at all (0x11a4220).
  //     Mode 4 is row 13 (502) with no colour.
  //   * WHO ASKS: the class's action-start functions (the switch on player+0x250a at 0x119d718, 157 actions; each case
  //     hands a sub-index to one of 42 start functions). Eleven of them call the requester on their phase-0 (start) path,
  //     right after draining the sword gauge (vtable +0x8b8 = 0x11a47a0 with a negative amount) -- the sword-mode
  //     actions -- unless vtable +0x838 (0x2b46f8: player+0x3340 set, the Demon Riot state 1..3, see DEMON_RIOT
  //     below) says to skip.
  //     Each action's motion is its start table's entry (24-byte rows, +0 the motion id: .data 0x1820370, 0x18206d0,
  //     0x1820aa8, 0x1820c10, 0x1820df0, 0x1820eb0, rodata 0x16a74f0, indexed by the sub-index; 0x11a0a90 / 0x11a0e74
  //     / 0x119fdd4 / 0x11a2590 name theirs as immediates). SWORD_REQUESTS lists the result: mode 0 on 29 motions of the
  //     main list, mode 1 on Motion[3] (the morph, 505/506), mode 3 on Arts Motion[91] (800/801).
  //   * THE BURSTS are w08_002.efl 510..523: the effects the burst shells uShellPlw08_000 / _001 request in their own
  //     init (vtable +0x13c = 0x474330 / 0x474c54: spec 0 of the shell's row, the row the creating action names in the
  //     shell's setup word +8, by phial and element), placed from the player's position. Only two sites of the class
  //     create them (0x48b884: Motion[125] frame 12, Motion[137] frame 2 -- see THE BURSTS below); the class's many
  //     0x2b6a80 sites register attack hitboxes, not shells (WeaponUnitEffects.burst fires the two).
  //   * The ids the class hands 0x2e93bc (2000..2082) are ACTION rows of player/cmd/w08/plcmd_w08_<style>
  //     (rPlCmdTblList: timed transitions on a condition), not shells; 0x2e9594 is the action interpreter.
  // WHAT IT TOOK TO DRAW (2026-09-28): the five model records recorded through a player parent and re-lifted
  // (rom/effect/lifted-request.js now covers the model row's colour-mode-0 branch 0x441cc); 0x43400 and 0x320e00
  // answered natively above; the effect models shipped (docs/models/effects); and a harness that YIELDS between frames,
  // because the model's glb and every texture load asynchronously and a mesh stays hidden until its albedo is in.
  // `aura()` / `setAura()` stay as the harness's way to start a burst record by hand on the hunter host.
  aura(row){ return BURST_RECORDS[0][row] || null; }   // a burst record by its shell row (pl_w08_000 rows 0..3)
  // Start record `key` by hand (the harness), or stop it for null. Idempotent: the same key twice keeps what is running.
  setAura(key){
    if (key === this.auraKey) return false;
    if (this.auraKey != null){ this.stopState(this.auraKey); this.stopState(this.auraKey + 1); }
    this.auraKey = key;
    if (key == null) return true;
    this.startState(key);
    return true;
  }

  // A seek takes the clip's effects off, as the Monster Viewer's does: running a particle system
  // backwards would have to be invented, and clearing is the honest answer (schedule.js explains).
  seek(frame){
    if (this.live && this.live.schedule) this.live.schedule.clearClipEffects(frame || 0);
  }

  setEnabled(on){
    this.on = !!on;
    if (!this.on) this.detach();
  }
  // HOLD THE EFFECTS WITHOUT TAKING THEM DOWN: the page is showing the Palico, and the hunter with everything on it is
  // hidden. The runtime's own switch (rom/effect/live.js frame(): `suppressed`, which the Monster Viewer's heat map
  // uses) skips the frame whole -- nothing steps, nothing draws -- and what was running carries on when it is lifted.
  // Taking the hosts down instead cost 9 s of rebuilding on the way back (measured 2026-09-29).
  setSuppressed(on){
    this.suppressed = !!on;
    if (this.live) this.live.suppressed = this.suppressed;
  }
  // Build the state records too, at the cost of loading them. Re-attaches, because the runtime is
  // handed its effects once at attach. Returns nothing; the caller re-syncs.
  setStateLayer(on){
    const want = !!on;
    if (want === this.stateLayer) return false;
    this.stateLayer = want;
    this.detach();
    return true;
  }

  // WHERE THE EFFECTS ACTUALLY ARE, for checking a mount against the joint it should be on: the world
  // bounds of every mesh the runtime drew this frame. They live in the runtime's own scene, which is
  // rendered inside the viewer's render, so nothing in the viewer's graph can be measured instead.
  bounds(){
    const l = this.live;
    if (!l || !l.scene) return [];
    const out = [];
    // the runtime's three mesh pools, not a traverse: they are sparse and mostly hidden between draws
    for (const o of [...(l.meshes || []), ...(l.modelMeshes || []), ...(l.gpuMeshes || [])]){
      if (!o || !o.isMesh || !o.visible || !o.geometry) continue;
      const g = o.geometry;
      // the ROM's own vertex layout names its attributes (primshader.js), so 'position' may not be one
      const at = g.attributes.position || g.attributes[Object.keys(g.attributes)[0]];
      if (!at || at.itemSize < 3) continue;
      const b = new THREE.Box3().setFromBufferAttribute(at);
      if (!isFinite(b.min.x)) continue;
      b.applyMatrix4(o.matrixWorld);
      const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
      out.push({ name: o.name || o.type, centre: c.toArray().map(n => +n.toFixed(3)),
                 size: s.toArray().map(n => +n.toFixed(3)) });
    }
    return out;
  }

  stats(){
    const l = this.live;
    if (!l) return { on: this.on, cls: null, running: 0 };
    const pool = a => (a || []).filter(Boolean);
    const st = this.stateEntries();
    return { on: this.on, cls: this.cls, clip: this.lastKey, failed: !!l.failed, refused: [...this.refused],
             state: st.length, stateRunning: st.reduce((n, e) => n + e.requests.length, 0),
             aura: this.auraKey,
             failure: l.failed ? String(l.failure || l.failed) : null,
             meshes: pool(l.meshes).length, models: pool(l.modelMeshes).length, gpu: pool(l.gpuMeshes).length,
             shown: pool(l.meshes).filter(m => m.visible).length + pool(l.modelMeshes).filter(m => m.visible).length
                    + pool(l.gpuMeshes).filter(m => m.visible).length,
             running: l.schedule ? l.schedule.running : 0,
             starts: l.schedule ? l.schedule.starts : 0,
             steps: l.stats ? l.stats.steps : 0,
             effects: l.schedule ? l.schedule.effects().length : 0 };
  }
}

// ---- THE WEAPON UNIT'S EFFECTS: the Switch Axe's sword aura, hung from the weapon as the game hangs it ----
// The requests above name the WEAPON unit as their parent and joint 0 as their root, so they cannot hang from the
// hunter host: this is a second host whose one "bone", gid 0, is the weapon's own bone 0 (`part.userData.bone`): the
// node render/weapon.js placePart sets every frame to hand joint x mount record x the weapon clip's bone-0 track --
// the weapon model's placement in the world, which is what the game's weapon unit answers for joint 0. (The part's
// root object stays at the origin: the weapon is skinned, so it is the wrong node.) The runtime reads the bone's
// matrixWorld as the joint (rom/effect/live.js writeJoints) and as the unit's origin (originBone).
export const PHIALS = ['Power', 'Element', 'Paralysis', 'Dragon', 'Exhaust', 'Poison'];   // weapon08BaseData mBinType
// THE WEAPON'S ELEMENT as the ROM numbers it (weaponNNBaseData byte +17 = player parameter 17, vtable +0x15c(self, 0x11)).
// The burst code tests 1..5, the five elements; 6..9 are the statuses and count as no element there.
export const ELEMENTS = [null, 'Fire', 'Water', 'Thunder', 'Dragon', 'Ice', 'Poison', 'Paralysis', 'Sleep', 'Blast'];
export function elementId(name){ const i = name ? ELEMENTS.indexOf(name) : 0; return i > 0 ? i : 0; }
const PHIAL_PALETTE_ENTRY = [8, 9, 10, 0, 12, 11];                                         // rodata 0x16a76b0, by phial
// MOTION IDS ARE DECIMAL (read 2026-09-28; the player's vtable +0xbc = 0x27c1d8 resolves an id as bank * 1000 + slot,
// umull by 0x10624dd3): the u32 an action table hands 0x2a8550 / 0x281268 is 5xxx for w08.lmt (this app's
// poses/weapons/w08.glb, 'draw') and 7xxx for w08_sa.lmt (w08_sa.glb, 'sa') -- 5125 is Motion[125], 7101 the Arts
// stance Motion[101]. An earlier reading split the id as a hex list byte and a slot byte ('draw:5', 'sa:189') and keyed
// every table below to motions the app never plays; scratchpad w08_paths2.py is the walker with the right decode (it
// resolves each start function's table entry along its own path, declares the mode, notes the requester call).
// The requester's modes, by the motion an action plays at its start. `odd` is every phial's record, `even` Dragon's.
// WHICH ACTIONS ARE SWORD MODE is the ROM's own word, not a reading of the animation: every action start declares its
// mode through vtable +0x84c = 0x11a602c (`[player+0x3328] = r1`; the class's "is sword mode" query, vtable +0x35c =
// 0x11a6018, reads it back), and the aura is asked only by starts that declare 1 (Raven, 2026-09-28: "Phial Effects
// on Axe Attacks" -- checked action by action). MODES below is that declaration per motion, and the rig's weapon form
// follows it (render/weapon.js bindMotion through the page's idleClipsFor: a sword-mode stance the weapon's list has no
// clip for holds the sword idle, Motion[20]_loop, instead of the axe idle Motion[1]_loop).
// Mixed motions: Motion[122] (acts 9/20/36/68 declare sword and ask; acts 23/43/60 play it declaring nothing) and
// Motion[155] (act 58 asks; act 74 is a continuation) -- fired, since the declared actions ask; Motion[157] declares
// nothing on its path (acts 67/71/113/114 declare sword on their Motion[162] path) and asks -- fired, a sword stance.
export const SWORD_REQUESTS = {
  0: { set: 'draw', slots: [120, 121, 122, 124, 126, 127, 128, 129, 130, 131, 132, 133, 134, 142, 145, 146, 152, 155, 157, 160, 161, 164, 174, 183, 232, 234, 249, 251, 254], odd: 500, even: 501 },
  1: { set: 'draw', slots: [123], odd: 505, even: 506 },   // acts 22/46: the sheathe from sword mode
  2: { held: true, odd: 800, even: 801 },
  3: { set: 'sa', slots: [3], odd: 800, even: 801 },       // act 103
};
// THE MODE EVERY STANCE PLAYS IN, from that declaration: 'sword' (1), 'axe' (0), or nothing where the start writes
// nothing and the previous action's mode carries (Motion[51], 104..107, 221, 223). A motion two actions declare
// differently takes the one that asks the aura, else the weapon's own clip: Motion[101] (the unsheathe: acts 0/2 axe,
// act 1 sword) and 113 (acts 1/17 axe, 1 sword) are axe; 137 (act 140 axe, 141 sword) is sword, its weapon clip the
// sword pose. The weapon's forms, read off its own clips (wg08_02.lmt): AXE has bone 33 at z 1.33 unturned (every
// mode-0 morph ends there, Motion[125] 143/147), SWORD has it at z 1.13 turned half round (every mode-1 morph ends
// there, Motion[142]/145/164; Demon Riot's own weapon clip holds it throughout); Motion[1]_loop is the axe idle,
// Motion[20]_loop the sword idle.
// FIVE START FUNCTIONS BRANCH ON THE SUB-INDEX THROUGH A JUMP TABLE (`add pc, r0, r1`), which the path walker did not
// follow; read by hand 2026-09-28 (evening; Raven: "I see instances of Sword mode animations without Demon Riot effects
// when the toggle is turned on"): 0x11a0764 (acts 56/65/108/115/116) declares AXE and plays 233 / 159 / 158 / 159 / 159,
// then Motion[150] as that ends (or 149 when the combo goes on) and 101; 0x11a0a90 (acts 57/63/109/111/112) declares
// SWORD and plays 234 / 161 / 160 / 160 / 160 -- every one asking the aura -- then 154 (or 153) and 120; 0x11a0e74 (acts
// 67/71/113/114) declares sword and plays 162 / 163 / 162 / 162, then 157; 0x11a11f8 (act 61) plays 115; 0x11a38d0 (acts
// 140/141) 137 / 125. A later phase's motion keeps its action's declaration, as player+0x3328 does. From the phase walk
// (scratchpad w08_paths3.py): 51 (acts 79/100) sword, 141 (act 35) axe, 252 (acts 126/133/148/149) sword.
export const MODES = {
  draw: {
    1: 'axe', 4: 'axe', 20: 'sword', 24: 'sword', 51: 'sword', 101: 'axe', 102: 'axe', 103: 'axe', 109: 'axe', 110: 'axe', 111: 'axe', 112: 'axe', 113: 'axe', 114: 'axe',
    115: 'axe', 117: 'axe', 118: 'sword', 120: 'sword', 121: 'sword', 122: 'sword', 123: 'sword', 124: 'sword', 125: 'axe',
    126: 'sword', 127: 'sword', 128: 'sword', 129: 'sword', 130: 'sword', 131: 'sword', 132: 'sword', 133: 'sword', 134: 'sword',
    135: 'axe', 136: 'axe', 137: 'sword', 139: 'axe', 141: 'axe', 142: 'sword', 143: 'axe', 144: 'axe', 145: 'sword', 146: 'sword',
    147: 'axe', 148: 'axe', 149: 'axe', 150: 'axe', 151: 'axe', 152: 'sword', 153: 'sword', 154: 'sword', 155: 'sword', 157: 'sword',
    158: 'axe', 159: 'axe', 160: 'sword', 161: 'sword', 162: 'sword', 163: 'sword', 164: 'sword', 165: 'axe', 174: 'sword',
    183: 'sword', 184: 'axe', 190: 'axe', 191: 'axe', 192: 'axe', 193: 'axe', 197: 'axe', 198: 'axe', 201: 'axe', 202: 'sword', 231: 'axe', 232: 'sword',
    233: 'axe', 234: 'sword', 249: 'sword', 250: 'axe', 251: 'sword', 252: 'sword', 253: 'axe', 254: 'sword',
  },
  sa: { 1: 'axe', 2: 'sword', 3: 'axe', 4: 'sword', 5: 'axe', 6: 'axe', 51: 'sword', 101: 'sword', 151: 'axe' },
};
export function modeOf(set, slot){ const t = MODES[set]; return (t && t[slot]) || null; }
// STANCES NO ACTION START DECLARES -- the drawn idles, the runs, the steps, the hit reactions, the style sheathes (46 of
// the 130 the weapon's lists hold) -- are the BASE player's states, and the base picks their motion by asking the class
// the question the aura's stop policy asks, vtable +0x35c, gated on the weapon type byte ([player+0x13c4]+0x4d4: 8 =
// Switch Axe, 14 = Charge Blade, whose pairs run the other way). Read 2026-09-28 (Raven: "I suspect the ROM does in fact
// track which state the weapon is in because the effect is not active in Axe Mode"):
//   * the drawn idle, 0x2dde58: on the type-8 branch `movwne r1, #5020` -- sword -> Motion[20], else Motion[1];
//   * the run, 0x2e521c (a jump table by type; type 8 -> 0x2e5438): sword -> Motion[24], else Motion[4];
//   * 0x2b9cc0: sword -> Motion[202], else Motion[201] (the Charge Blade takes 201/202 the other way round);
//   * the class's own base-state hooks (vtable +0x620, +0x638, +0x650..+0x680 = 0x119cc40..) route each state to a command
//     ROW by the mode -- the idle to row 2001 in sword mode, 2000 in axe (0x2e93bc only swaps the input table; a row's
//     commands map the buttons to acts) -- so the acts reachable from the sword idle are the sword ones.
// The steps (0x2df774's table: 13/12/14), the draw and sheathe (2, 3), 9, the mount loop 51 (0x2c7c64 plays it for type 8
// in either mode), 80 (0x2cae9c) and the hit reactions are picked with no mode question: the state CARRIES, as
// player+0x3328 does, and the viewer keeps the last mode a stance set (render/weapon.js modeWord, which also picks the
// weapon's own clip: the part unit's update 0x30837c plays the weapon's clip N when its list has it (0x950b48), else
// the idle clip of the MODE -- 20 in sword mode, 1 otherwise, on the type-8 branch). With none set yet the aura stays hidden, the stop
// policy's own answer (its byte is 1 only when the word reads 1). An earlier fix read the form off the weapon clip's blade
// bone instead (turned = sword); dropped, the ROM's pairs are the word.
// THE CHARGE STATE (player+0x3340, read 2026-09-28) is DEMON RIOT, not Energy Charge -- Raven caught the mislabel ("Energy
// Charge Toggle doesn't make sense"). The ROM does not name its Arts; the four three-level Arts are acts 85/86/87, 88/89/90,
// 97/98/99 and 119/120/121, and their mechanics tell them apart: 85/86/87 set a SUSTAINED state with a per-level duration
// (0x282140) and a gauge drain per interval (0x282120) that ends when the gauge is empty (vtable +0x824), and the game's own
// help text says Trance Slash "gains the effects of Demon Riot, if it is active" -- a state you can be in; 88/89/90 hand the
// gauge a per-level amount and start the +0x334c countdown (status flag 0x800): Energy Charge, the instant fill; 97/98/99
// end in bursts at frames 140/161/182/203 of Arts Motion[4]: Trance Slash; 119/120/121 declare axe mode and touch no gauge:
// Tempest Axe. Demon Riot's three actions (85/86/87, levels I..III, all Arts Motion[101], id 7101) run one start
// function, 0x11a1bc4: at frame 70 it calls 0x11a4d94, a second requester of the same shape as the aura's but parented to
// the PLAYER unit itself (its own vtable +0x130 handle) with the ROOT JOINT -1 and holder row 7 (record 900; Dragon row 8,
// 901, no colour) through vtable +0x3a0 = 0x281f14 -> holder vtable +0x154 = 0x44c0c4 (tracked slot 2, replacing what it
// held) -- the charge gathering on the hunter (cm122_080, joints 8/11/7); at frame 220 it writes the level into +0x3340
// (and zeroes the timer +0x3348 when the state was off). From then on, every frame:
//   * 0x11a4430 runs the state: the timer counts down and, at zero, reloads the level's duration (0x282140), drains the
//     gauge by the level's cost (0x282120, vtable +0x8b8) and sets +0x3344; when the gauge is empty (vtable +0x824 =
//     0x2b46bc: +0x332c < 1) the state ends: +0x3344 = 0, +0x3340 = 0.
//   * 0x11a5e6c sets status flag 0x400 (+0x2860) while +0x3340 != 0 and +0x3344 != 0 (and, regardless, during actions
//     94, 99, 103 and 121, its jump table's four odd cases).
//   * the base update calls vtable +0x690 = 0x11a407c every frame (0x29b6f0): with flag 0x400 set it asks the requester
//     for MODE 2 -- holder rows 5/6, records 800/801, the same root joint 0 and phial colour -- into the holder's tracked
//     SLOT 0 (0x281ffc -> holder vtable +0x158 = 0x44c164, flag 0: a slot already holding an effect returns it, so the
//     request is idempotent and the aura is HELD), and the holder's stop policy (vtable +0x160 = 0x454ed4, codes 5/6)
//     ends it once flag 0x400 is gone.
//   * the per-action aura is gated: vtable +0x838 = 0x2b46f8 answers +0x3340 != 0 and every mode-0 handler skips its
//     request on that answer.
// The viewer has no gauge, so the state is a switch in the Weapon panel, the user's alone: the Art's stance does not turn
// it on at frame 220 as the game does (Raven, 2026-09-29). The level changes only the duration and the drain, never the effect. The code keeps
// the field name `charge` (the ROM's own word for +0x3340 is a charge counter); the effect it holds is Demon Riot's blade.
export const DEMON_RIOT = { set: 'sa', slot: 101, effectFrame: 70, stateFrame: 220, odd: 900, even: 901 };
// TEMPEST AXE (read 2026-09-29; Raven: "We also are lacking the Tempest Axe effect, which appears in Axe Mode animations
// only"). The Art's held aura is HOLDER CODE 12 -- row 12 of the effect holder's list (docs/effects/w08-shells.json
// holder.rows: w08_800 key 1001, the UNIQUE record of cm123_081.efl, root joint 1, nodes at joints 0 and 2). It is not
// asked by the class's requester 0x11a40f4 but by the base player's per-frame hook: vtable +0x690 = 0x11a407c calls
// vtable +0x494 = 0x11a5db0, and when that answers 1 it calls 0x281ffc(self, slot 4, code 0xc, self+0x2550, 0) =
// the holder's vtable +0x158 = 0x44c164, which requests spec 0 of row 12 through the PLAYER'S OWN requester block at
// +0x2550 (the ctor 0x279f34 builds it with 0x40a54; 0x27a334..0x27a34c set +0x1c bit 1 and the handle +0xd0 = the
// player's own, vtable +0x130; no root joint, no colour) and keeps it in the holder's slot 4 (idempotent: an existing
// request in the slot is returned). 0x11a5db0 answers 1 when the status high word's bit 0x40 stands (vtable +0x1b8(self,
// 0, 0x40): the Art's state, armed by the Art -- 0x11a4748 loads the timer +0x3330 from 0x282140(self, 0xf) -- and
// counted down at 0x11a46b4 only while the mode word reads 0, i.e. in AXE mode), the mode word reads 0 (vtable +0x35c:
// AXE), the weapon unit +0x23a0 exists and its state +0x13d4 | 0x10 is not 0x12 (drawn, not on the back), the action
// is not 276..280 with bits {0, 1, 4} while +0x2506 == 1, and vtable +0x178 (byte +0x2749 bit 0) answers 1. The stop
// policy 0x454ed4 answers 0 (keep) for code 12 while 0x11a5db0 still answers 1, else 2 (stop): the aura goes as the
// sword comes out and returns with the axe. This viewer has no gauge or timer: a switch, like Demon Riot's.
export const TEMPEST_AXE = { key: 1001, efl: 'cm123_081' };
// THE BURSTS, RE-READ 2026-09-29 (Raven: "in game we don't see things like the shell bursts"). The reading this block
// carried took 0x2b6a80(self, slot, hitRow, kind) for a shell spawn. It is not one: it registers an ATTACK HIT BLOCK, the
// box at player+0x3020 + slot*0xb8 that 0x1684f4 fills from the hit row (frames +0x5c/+0x60, power +0x38, and at +0x88
// the row's byte +0x20 -- the SHAPE-SET INDEX the collision pass 0x16bc54 resolves through the shape resource at +0x84
// (vt+0x44): a hitbox, no shell, no effect). The only shell that pass creates is the generic id 0x13d for blocks marked
// +0x6d = 2 (0x16bb70..0x16bc28). So every hit-row site the old table listed (Motion[105] at 34/72, [123] every 20,
// [148], [150]..[157], [190], [101], the Arts) draws NOTHING in the game, which is what Raven sees. THE BURST SHELLS are
// created by exactly two sites in the class, the 0x48b884 calls whose setup word +4 is the shell id and +8 the ROW of
// the shell's own list (the .sep spec 0 record of that row, BURST_RECORDS):
//   * uShellPlw08_000 (id 0x2e, list pl_w08_000): acts 10 (sub 0) and 42 (sub 1), the function 0x119eecc, Motion[125],
//     at MOTION FRAME 12 (0x2804ec with 12.0 at 0x119efd0). The row by the phial (vt+0x15c(self, 0x1b), PHIALS' order):
//     Dragon -> 2 (sub 1: 3); Element -> by the weapon's element (vt+0x15c(self, 0x11), 1..5) through the jump tables
//     0x119f1ec (sub 0: 16, 18, 20, 24, 22) / 0x119f10c (sub 1: 17, 19, 21, 25, 23), except that while the status 0x300
//     stands the element row needs 0x285d94(0xb9) and element 4, and an element outside 1..5 falls to the plain row;
//     every other phial -> 0 (sub 1: 1). Rows 16..25 are records 514..523, rows 0..3 are 510..513.
//   * uShellPlw08_001 (id 0x2f, list pl_w08_001): acts 140/141, the function 0x11a38d0, Motion[137]: phase 0 arms the
//     countdown player+0x2528 = 2.0 (0x11a3a88), phase 1 spawns ONCE when 0x539d5c(&+0x2528, 1.0) says it ran out --
//     frame 2. The row: Dragon -> 1; Element -> by element through 0x11a3b50 (2, 3, 4, 6, 5) under the same status gate;
//     every other phial -> 0. The list's row r carries specs (511 + 2r, 510 + 2r); the spawn picks spec 1 while bit 12
//     of the status word +0x2860 stands (the class's timer +0x3330, a state this viewer has no source for), else spec 0.
//   The shell's own init (vtable +0x13c: 0x474330 for _000) asks for the effect at ITS spawn, gated by 0x47ba54 (0x4a188c
//   binds the row; the owner's unit-kind byte +0x1052 must be 0 or 2 -- the base ctor 0x538b34 stores the kind, a
//   player's is 0), places itself at the player's position plus (-30, 180, 150) turned by the player's angles
//   (0x474374..0x474480), spawns the child hit 0x2b6d60, requests spec 0 (0x474550: 0x4a22f0(self, 0, -1); the phial's
//   colour in the second override word, none for Dragon nor for an Element phial on a weapon with an element), lives
//   34 frames (+0x1378) and cuts the effect at the end (0x4746b8). uShellPlw08_001 (0x474c54) stays at the player's
//   position, no colour.
//   THE ELEMENT IS THE WEAPON'S (2026-09-29): docs/weapons/w08.json `element`, handed to stepStance each frame. 1 Fire,
//   2 Water, 3 Thunder, 4 Dragon, 5 Ice take the element rows -- first shell 16 / 18 / 20 / 24 / 22 = records 514 /
//   516 / 518 / 522 / 520 (row masks 0x400 / 0x800 / 0x1000 / 0x4000 / 0x2000 of w08_002.efl), second shell 2 / 3 /
//   4 / 6 / 5 -- and NO colour; a status (6..9) or no element takes the plain row with the phial's colour. 25 of
//   the 34 Element-phial axes carry one of the five. The seven row masks of the .efl are therefore the plain burst,
//   the Dragon phial's and the five elements -- not seven phials, the reading this file began with.
//   THE STATUS GATE the viewer has no state for: with vtable +0x1b4(self, 0x300) standing, the element row is taken
//   only when 0x285d94(self, 0xb9) answers 1 AND the element is 4; otherwise the plain row.
//   Which act plays Motion[125] (10 or 42) the viewer cannot tell: it fires act 10's rows (sub 0); act 42's are
//   the odd ones beside them.
// HOLDER ROW 13 (502, w08_000.efl, the third model row of cm153_000): asked by the start function 0x11a30c4 (acts
// 124/125/129/146/147) in its running phase, once, when its own countdown at player+0x2528 -- set to 12 frames at the
// start, 1 frame for sub 4 (act 147) -- runs out (0x539d5c): a request built on the WEAPON unit with root joint 0 and
// no colour, vtable +0x39c code 13 (0x11a320c..0x11a3274). No mode, no phial: the same record for every phial.
export const TIMED_REQUESTS = {
  'draw:250': [{ at: 12, key: 502 }],     // acts 124/125
  'draw:197': [{ at: 12, key: 502 }],     // act 129
  'draw:193': [{ at: 12, key: 502 }],     // act 146
  'draw:192': [{ at: 1, key: 502 }],      // act 147, sub 4
};
// HOLDER ROWS ASKED ON THE PLAYER at a motion frame (read 2026-09-29), through the player's OWN request block +0x2550 --
// the handle is the player, no root joint, no colour -- and fire and forget (vtable +0x39c -> holder +0x150 = 0x44bfcc:
// no tracked slot, so no stop policy; the effect runs its course):
//   * row 11 (the UNIQUE 550 of w08_003.efl): act 61's start function 0x11a11f8 plays Motion[115], then Motion[116], and in
//     each of the two phases asks code 11 ONCE when the motion frame (+0x14d0) reaches 20 (0x11a12e0..0x11a1324,
//     0x11a1384..0x11a13c8; the byte +6 of the action word marks it asked).
//   * row 0 (the UNIQUE 205 of the common list cm002_002 = effect/cm/cm002_007.efl, joint 8, mask 1): the BASE player's
//     sharpening state (0x2d5e74, Motion[255] = 5255 -- the whetstone: its schedule strikes cm002_007 at 100, 144, 192
//     and 238) asks, at motion frame 274 (0x2d60f8: 0x2804ec with 274.0), the code a jump table gives the weapon type
//     byte: types 0 and 2 -> 5, 3 -> 11, 4 -> 7, 6 -> 4, 7 and 11 -> 2, 9 -> 8, 10 -> 20, and 1, 5, 8 and 12+ -> 0. The
//     Switch Axe (8) takes row 0. The same state serves every class (docs: weapon-effects-guide.md).
export const PLAYER_TIMED_REQUESTS = {
  'draw:115': [{ at: 20, key: 550, efl: 'w08_003' }],
  'draw:116': [{ at: 20, key: 550, efl: 'w08_003' }],
  'draw:255': [{ at: 274, key: 205, efl: 'cm002_007' }],
};

// ---- THE PLAYER'S OWN HOLDER REQUESTS, BY STANCE: every class's, on the hunter host ----
// A class's action code asks its effect holder for a row at a MOTION FRAME of the action it runs, on the PLAYER unit
// (its own vtable +0x130 handle, the block at +0x2550 or one it builds with 0x40a54). These are the player's requests,
// so they run on the hunter host and are gated on player facts alone -- the class equipped, the weapon drawn, the
// stance playing -- never on a weapon-unit host being up (weapon-effects-guide.md section 7; the Switch Axe's table
// above ran from its weapon-unit host until 2026-09-29, so it waited out that host's 3 s build after every draw).
// A class's table maps a stance key ("draw:110") to its requests: { at: the motion frame, key, efl, requester: the
// block's overrides (null: the player's own block, none), slot: the holder's tracked slot (0x281ffc) when it has one }.
//   * NO SLOT: fire and forget (vtable +0x39c -> holder +0x150); the effect runs its course.
//   * A SLOT (0x281ffc -> holder +0x158 = 0x44c164 with flag 1, read 2026-09-29): a request into an occupied slot first
//     stops the occupant AT ONCE (holder vtable +0x15c = 0x44c210: 0x329c40(effect, 1)), then asks its own row. The
//     holder's stop policy (vtable +0x160) keeps the slot's effect while its test holds; here that test is the stance:
//     `while` (default: the stance that asked). Leaving it, `stop` is the policy's answer as the holder's update applies
//     it (0x44bef0..0x44bfb0): 3 stops at once, 2 lets a running effect end on its own (0x329c40(effect, 0)).
// FRAMES COUNT THE MOTION: a `_loop` stance is the tail of one motion (its t0 is where it starts), so a loop's wrap is
// the motion going on -- frames below t0 are not crossed again, as the ROM's frame test (0x2804ec) does not cross them
// -- while a stance that begins partway (a `_loop` picked on its own) catches up on every frame before it at once, the
// last request per slot winning. A stance whose clip plays again from the top (another pick, a harness loop) is the
// action again.
export class PlayerRequests {
  constructor(tables){
    this.tables = tables || {};  // class -> { stance key -> [request] }
    this.host = null;            // the hunter host's WeaponEffects
    this.key = null; this.file = null; this.clip = null; this.mtime = null;
    this.slots = new Map();      // holder slot -> { q, live, stop, while }
    this.fired = 0;
  }
  // every frame: `cls` is the class whose code runs (null when no weapon stance plays: sheathed, a Hunter Pose, another
  // class), `stance` the weapon's { file, clip, t0 }, `time` the stance action's time in seconds
  step(cls, stance, time){
    const h = this.host, live = (h && h.live) || null;
    for (const [s, x] of this.slots) if (x.live !== live || (x.q.finished && x.q.finished())) this.slots.delete(s);  // gone with a rebuilt host
    const table = cls ? this.tables[cls] : null;
    const slot = stance ? slotOf(stance.clip) : null;
    const key = table && slot !== null ? setOf(stance.file) + ':' + slot : null;
    const t0 = stance && stance.t0 ? stance.t0 : 0;
    const mtime = key ? (time || 0) + t0 : null;
    let from = -1;                               // the motion frame the last step reached, -1 for a new action
    if (key !== null && key === this.key){
      const loop = /_loop$/.test(stance.clip || '');
      if (stance.clip === this.clip && stance.file === this.file && mtime < this.mtime) from = loop ? t0 - 1e-6 : -1;  // a wrap
      else if (mtime >= this.mtime) from = this.mtime;
    }
    // the stop policy: a slot's effect lives while its stance does
    for (const [s, x] of this.slots) if (!x.while.includes(key)) this.release(s, x.stop);
    this.key = key; this.file = stance ? stance.file : null; this.clip = stance ? stance.clip : null; this.mtime = mtime;
    if (key === null || !live) return;
    const due = (table[key] || []).filter(r => from < r.at / 60 && mtime >= r.at / 60);
    const last = new Map();
    for (const r of due) if (r.slot != null) last.set(r.slot, r);   // caught up at once: the last per slot is what stands
    for (const r of due){
      if (r.slot != null && last.get(r.slot) !== r) continue;
      if (h.refused.has(r.key)) continue;
      if (r.slot != null){ const x = this.slots.get(r.slot); if (x) this.release(r.slot, 3); }   // 0x44c210: at once
      const q = h.startState(r.key, r.efl, r.requester || null);
      this.fired++;
      if (q && r.slot != null) this.slots.set(r.slot, { q, key: r.key, live, stop: r.stop || 3, while: r.while || [key] });
    }
  }
  // the holder's answer for a slot's effect: 3 at once, 2 the effect's own end (the schedule drops it when finished)
  release(s, answer){
    const x = this.slots.get(s), h = this.host, sc = h && h.live && h.live.schedule;
    this.slots.delete(s);
    if (!x || !sc || x.live !== h.live) return;
    try {
      if (!x.q.stopped) sc.host.stopRequest(x.q);
      if (answer === 3){ sc.host.releaseRequest(x.q); for (const e of sc.entries) e.requests = e.requests.filter(q => q !== x.q); }
    } catch (_) {}
  }
  stopAll(){ for (const [s] of this.slots) this.release(s, 3); this.key = null; this.mtime = null; }
  // { record key: joint } for every request of the class that roots its record on a joint (not -1, the unit itself):
  // the hunter host adds those joints to its parent (WeaponEffects.useDef requestJoints)
  rootJoints(cls){
    const out = {}, t = this.tables[cls];
    for (const list of Object.values(t || {}))
      for (const r of list) if (r.requester && r.requester.rootJoint != null && r.requester.rootJoint !== 0xffff) out[r.key] = r.requester.rootJoint;
    return out;
  }
  stats(){ return { key: this.key, frame: this.mtime == null ? null : Math.round(this.mtime * 60), fired: this.fired,
                    slots: [...this.slots].map(([s, x]) => ({ slot: s, key: x.key, stop: x.stop })) }; }
}
export const BURST_RECORDS = {
  0: { 0: 510, 1: 511, 2: 512, 3: 513, 16: 514, 17: 515, 18: 516, 19: 517, 20: 518, 21: 519, 22: 520, 23: 521, 24: 522, 25: 523 },   // pl_w08_000 rows: spec 0 (w08_002.efl)
  1: { 0: [511, 510], 1: [513, 512], 2: [515, 514], 3: [517, 516], 4: [519, 518], 5: [521, 520], 6: [523, 522] },              // pl_w08_001 row r: specs 0 / 1
};
export const BURST_OFFSET = [-30, 180, 150];   // game units in the player's frame (0x4743dc..: X -30, Y 180, Z 150), slot 0
export const BURSTS = {
  'draw:125': [{ at: 12, slot: 0, sub: 0 }],   // acts 10 (sub 0) / 42 (sub 1), 0x119eecc: uShellPlw08_000 at motion frame 12
  'draw:137': [{ at: 2, slot: 1, sub: 0 }],    // acts 140/141, 0x11a38d0: uShellPlw08_001 as the 2-frame countdown +0x2528 runs out
};
// The shell row the action passes in its setup word +8, by phial and element, as 0x119eecc (slot 0) and 0x11a38d0 (slot 1)
// choose it; `element` is the weapon's element 1..5 or null (unknown here: the plain row, as the ROM's out-of-range case).
export function burstRow(slot, phial, element, sub = 0){
  const p = PHIALS.indexOf(phial), e = element == null ? 0 : element;
  if (slot === 0){
    if (p === 3) return sub ? 3 : 2;
    if (p === 1 && e >= 1 && e <= 5) return (sub ? [17, 19, 21, 25, 23] : [16, 18, 20, 24, 22])[e - 1];
    return sub ? 1 : 0;
  }
  if (p === 3) return 1;
  if (p === 1 && e >= 1 && e <= 5) return [2, 3, 4, 6, 5][e - 1];
  return 0;
}
// THE PHIAL COLOURS ARE FIXED (read 2026-09-28; Raven: "the Phial colors don't shift, they are assigned per Switch Axe
// via the Phial Type"). The requesters read the effect manager's colour-control SLOT 1 ([[0x1831b10]+0x40]+4, its +0x74
// entry table, entry -> colour at +8: 0x11a4e04, 0x11a41c8, the burst shells 0x4740a0/0x474630, the Charge Blade's
// 0x11c7b74) -- and slot 1 is loc/arc/resident.arc effect/pec/pec_001, thirteen entries with one vivid hue per phial at
// 8..12 (Power red, Element green, Paralysis yellow, Poison purple, Exhaust blue), the same wherever the hunt is. The
// stage arcs' tables (effect/pec/pec_<stage>) are slot 0's, read by other effects (0x44d594), and an earlier reading of
// this file took them for the phial's: the colours shifted with the stage and were dull. w08-shells.json ships both.

export class WeaponUnitEffects extends WeaponEffects {
  constructor(){
    super();
    this.unitRoot = null;
    this.palette = null;          // resident pec_001, the phial colours (loadPalettes)
    this.lastStance = null;
    this.lastTime = null;
    this.refused = new Set();     // records whose request stopped the host: not asked for again this session
    this.lastRequested = null;
    this.lastSync = null;
    this.charge = false;          // the charge state (player+0x3340 != 0): Demon Riot on
    this.held = null;             // the mode-2 request held in the holder's slot 0 while the charge is on
    this.tempest = false;         // Tempest Axe's state (status bit 0x40 of the high word): the Art is active
    this.tempestReq = null;       // holder code 12 (TEMPEST_AXE) on the hunter host while the state holds in axe mode
    this.tempestLive = null;      // the hunter host's runtime that request was made on (a rebuilt host has none of it)
    this.lastDrawn = false;       // the Switch Axe drawn, as the page says each frame (stepStance): this host exists only then
    this.lastOnBack = false;      // the weapon on the back this frame, the game's own test (render/weapon.js onBack)
    this.onTempest = null;        // told when the state changes, so the page's switch can mirror a harness call
    this.hunterHost = null;       // the hunter's WeaponEffects, for the Art's own effect (root joint -1, the player unit)
    this.onCharge = null;         // told when the state changes, so the page's switch can mirror a harness call
    this.lastPhial = null;        // the phial of the last step, for a request made between steps (setCharge)
    this.lastElement = 0;         // the weapon's element of the last step, as the ROM numbers it (ELEMENTS)
    this.lastMode = null;         // the mode the last declaring stance set (player+0x3328 keeps it through silent ones)
    this.artRequest = null;       // the Art's 900/901 on the hunter (codes 7/8), stopped when the motion leaves Arts 101
    this.slot1 = null;            // mode 3's request (codes 9/10), stopped when the motion leaves Arts 4 / 3
    this.floor = null;            // () => the height the hunter stands on, in viewer units (the player's position y)
    this.bursts = [];             // the burst shells alive: { q, slot, frames } -- slot 0's effect is cut at 34 frames
  }
  // The charge state, by hand (the page's switch or the harness). Off releases the held aura the way the stop policy does when
  // flag 0x400 is gone: the core's own stop, then off the unit passes.
  setCharge(on){
    on = !!on;
    if (on === this.charge) return this.charge;
    this.charge = on;
    if (!on) this.releaseHeld();
    // on: the game's per-frame hook asks mode 2 at once; the next step would too, but a paused stance never steps
    // (with the weapon in the hand: this host is the weapon's, and a sheathed one has none -- stepStance)
    else if (this.live && this.lastDrawn && !this.held && this.lastPhial) this.held = this.request(2, this.lastPhial);
    if (this.onCharge) this.onCharge(on);
    return this.charge;
  }
  // Tempest Axe's state, by hand (the page's switch or the harness). Off stops the aura as the policy does (answer 2);
  // on asks it at once when the gate holds (stepTempest) -- the next step would too; this is the same test, a frame early.
  setTempest(on){
    on = !!on;
    if (on === this.tempest) return this.tempest;
    this.tempest = on;
    this.stepTempest();
    if (this.onTempest) this.onTempest(on);
    return this.tempest;
  }
  // THE GATE, every frame as vtable +0x690 asks (0x11a407c -> vtable +0x494 = 0x11a5db0): code 12 while the state holds
  // (the switch), the mode word is AXE and the weapon is DRAWN -- 0x11a5db0 answers 0 for a weapon unit whose state
  // +0x13d4 | 0x10 is 0x12, the weapon on the back, and the stop policy (0x455024) then ends code 12 with answer 2.
  // THESE ARE THE PLAYER'S FACTS, NOT THIS HOST'S: the request is the player's own (0x281ffc on the block at +0x2550)
  // and runs on the hunter host, so whether the weapon-unit host is up has no say. It was the test until 2026-09-29, and
  // it lagged the truth both ways: the host takes ~3.2 s to build after a draw (no aura until then), and an attach
  // landing after a sheathe kept it "drawn" on the hunter's back.
  stepTempest(){
    const h = this.hunterHost, live = (h && h.live) || null;
    // a request made on a hunter host that has since been rebuilt (new armour, a refusal) or taken down went with it
    if (this.tempestReq && this.tempestLive !== live){ this.tempestReq = null; this.tempestLive = null; }
    if (this.tempest && this.lastDrawn && !this.lastOnBack && this.lastMode === 'axe'){
      if (this.tempestReq && this.tempestReq.finished && this.tempestReq.finished()) this.tempestReq = null;
      if (!this.tempestReq) this.tempestReq = this.requestTempest();
    } else if (this.tempestReq) this.stopTempest();
  }
  // holder code 12 = the UNIQUE 1001 of cm123_081.efl on the HUNTER (the player's own requester block: no overrides)
  requestTempest(){
    const h = this.hunterHost;
    if (!h || !h.live || this.refused.has(TEMPEST_AXE.key)) return null;
    this.lastRequested = TEMPEST_AXE.key;
    const q = h.startState(TEMPEST_AXE.key, TEMPEST_AXE.efl, null);
    this.tempestLive = q ? h.live : null;
    return q;
  }
  stopTempest(){
    if (!this.tempestReq) return;
    this.stopOne(this.tempestReq); this.tempestReq = null; this.tempestLive = null;
  }
  // the ROM's mode for the stance playing: 'sword', 'axe' or null (MODES)
  mode(){
    const k = this.lastStance;
    if (!k) return null;
    const [set, slot] = k.split(':');
    return modeOf(set, +slot);
  }
  releaseHeld(){
    const q = this.held, sc = this.live && this.live.schedule;
    this.held = null;
    if (!q || !sc) return;
    try { if (!q.stopped) sc.host.stopRequest(q); sc.host.releaseRequest(q); } catch (_) {}
    for (const e of this.stateEntries()) e.requests = e.requests.filter(x => x !== q);
  }
  makeHost(roots){
    const part = roots && roots[0];
    const node = part ? (part.userData.bone || part) : null;
    const host = new THREE.Group();
    host.name = 'weapon-unit-fx-host';
    host.userData.gidBones = node ? [{ gid: 0, node, d: 0 }] : [];
    host.userData.joints = [];
    return host;
  }
  // only the records the requester can ask for, each rooted at joint 0
  useDef(def){
    const keys = new Set([...Object.values(SWORD_REQUESTS).flatMap(r => [r.odd, r.even]),
                          ...Object.values(TIMED_REQUESTS).flatMap(l => l.map(t => t.key))]);
    // THE PARENT'S ANGLE ORDER IS 0: the weapon in the hand is a player PART unit, whose class init clears the low half
    // of the uCoord order word (0x306da8..0x306db0), and the placement composer picks its joint-to-angles routine by
    // that order (rom/effect/host.js createParent). With the hunter's order 4 here the flames left the blade once the
    // Demon Riot swing became a compound rotation.
    return Object.assign({}, def, { clips: {}, parentOrder: 0x30000,
      effects: (def.effects || []).filter(e => e.when === 'state' && e.record && keys.has(e.record.key) && !this.refused.has(e.record.key))
                                  .map(e => Object.assign({}, e, { joints: [0] })) });
  }
  async attach(cls, roots, parent){
    const gen = ++this.pending;
    await this.loadPalettes();
    if (gen !== this.pending) return null;      // detached, or asked again, while the palettes loaded
    return super.attach(cls, roots, parent);
  }
  // re-attach when the weapon PART changes (a new weapon is a new object), not on every stance
  async sync(cls, roots, parent){
    const part = (roots && roots[0]) || null;
    if (cls !== 'w08' || !part || !this.on){ if (this.live || this.unitRoot) this.detach(); this.unitRoot = null; this.lastSync = null; return null; }
    this.lastSync = { cls, roots: [part], parent };
    if (this.cls === cls && this.live && this.unitRoot === part) return this.live;
    this.unitRoot = part;
    return this.attach(cls, [part], parent);
  }
  // WHAT THIS HOST ASKED OF THE HUNTER HOST OUTLIVES IT THERE (Tempest Axe's aura, the Art's 900/901, the burst shells'
  // effects): stop those, do not just forget them. Sheathing detaches this host (Raven, 2026-09-29: "Tempest Axe effect
  // should not render when Switch Axe is sheathed"), and the stance those effects belong to ends with it -- the stop
  // policy's own answer for codes 7/8 once the motion is no longer Arts Motion[101] (stopPolicy).
  detach(){
    this.stopTempest();
    if (this.artRequest){ this.stopOne(this.artRequest); this.artRequest = null; }
    for (const b of this.bursts) this.stopOne(b.q);
    this.held = null; this.slot1 = null; this.bursts = [];
    super.detach();
    this.lastStance = null; this.lastTime = null;
  }
  async loadPalettes(){
    if (this.palette) return this.palette;
    try {
      const r = await fetch('effects/w08-shells.json?v=' + Date.now());
      const d = r.ok ? await r.json() : null;
      this.palette = (d && d.palettes && d.palettes.player) || [];
    } catch (_) { this.palette = []; }
    return this.palette;
  }
  // The phial's colour as the table stores it (a u32, bytes R G B A). null for Dragon (the ROM skips the colour),
  // undefined when the table has no entry for it (the ROM then makes no request at all).
  colourFor(phial){
    const i = PHIALS.indexOf(phial);
    if (i < 0 || i === 3) return null;
    const hex = this.palette && this.palette[PHIAL_PALETTE_ENTRY[i]];
    if (!hex || !/^[0-9a-f]{8}$/i.test(hex)) return undefined;
    return parseInt(hex, 16) >>> 0;
  }
  // Ask for mode `mode`'s record for `phial`, the way 0x11a40f4 does. Returns the request, or null.
  request(mode, phial){
    const r = SWORD_REQUESTS[mode];
    if (!r || !this.live) return null;
    const dragon = phial === 'Dragon';
    const key = dragon ? r.even : r.odd;
    if (this.refused.has(key)) return null;
    const requester = { rootJoint: 0 };
    if (!dragon){
      const c = this.colourFor(phial);
      if (c === undefined) return null;
      requester.colour = c;
    }
    this.lastRequested = key;
    // holder slot 1 (mode 3, codes 9/10) is a TRACKED slot: the holder's +0x154 = 0x44c0c4 replaces what it held
    if (mode === 3 && this.slot1){ this.stopOne(this.slot1); this.slot1 = null; }
    const q = this.startState(key, null, requester);
    if (q && mode === 3) this.slot1 = q;     // stopped when the motion leaves Arts 3 / 4 (stopPolicy)
    return q;
  }
  // stop one request wherever it runs (this host or the hunter's) and drop it from its entry
  stopOne(q){
    const sc = this.live && this.live.schedule, h = this.hunterHost && this.hunterHost.live && this.hunterHost.live.schedule;
    for (const s of [sc, h]){
      if (!s || !q) continue;
      try { if (!q.stopped) s.host.stopRequest(q); s.host.releaseRequest(q); } catch (_) {}
      for (const e of s.entries) e.requests = e.requests.filter(x => x !== q);
    }
  }
  // The stop policy for the effects this host asks beyond the held one (holder vtable +0x160 = 0x454ed4), applied when
  // the stance changes: codes 7/8 (the Art's 900/901) live only while the motion is Arts Motion[101] (id 7101,
  // 0x454fc8); codes 9/10 (mode 3's 800/801 in slot 1) only while it is Arts Motion[4] (7004, +0x14d8) or Motion[3]
  // (7003 through 0x2809b8, 0x454fec). Any other motion returns 3: the holder stops the effect.
  stopPolicy(key, changed = true){
    const stop = q => this.stopOne(q);
    if (this.artRequest && key !== DEMON_RIOT.set + ':' + DEMON_RIOT.slot){ stop(this.artRequest); this.artRequest = null; }
    if (this.slot1 && key !== 'sa:4' && key !== 'sa:3'){ stop(this.slot1); this.slot1 = null; }
    // the burst shells: a stance CHANGE is this app's, not a game path -- a shell would live on into the next motion; the
    // viewer plays motions one at a time, so their effects go with the stance they belong to. A looping stance's wrap is
    // not a change: the shell's 34 frames run on across it, as they would into the game's next motion.
    if (changed){ for (const b of this.bursts) stop(b.q); this.bursts.length = 0; }
  }
  // every frame: the shells' countdowns (0x539d5c by the frame delta: animation frames, so a paused stance holds them)
  stepBursts(advance){
    if (!this.bursts.length) return;
    const dt = (advance || 0) * 60;
    for (const b of this.bursts){
      b.frames += dt;
      if (b.slot === 0 && b.frames >= 34 && !b.cut){ b.cut = true; this.stopOne(b.q); }
    }
    this.bursts = this.bursts.filter(b => !b.cut && !(b.q.finished && b.q.finished()));
  }
  // Every frame (`element`: the weapon's, a name or the ROM's number; `modeWord`: the rig's player+0x3328, 'sword' / 'axe' / null before any stance set it; `drawn`: the
  // Switch Axe is in the hand, false on the back or with another class equipped -- left out, this host being up stands
  // in for it). A request is made when a stance STARTS -- a new clip, or the loop point of a looping one -- if its
  // motion is one the action code asks on. The stance's own clock drives the effects (stepClip with no clip).
  stepStance(stance, time, advance, phial, modeWord, drawn, element, onBack){
    if (this.live && this.live.failed){
      // one refusal stops the whole host: remember the record and rebuild the host without it
      if (this.lastRequested != null) this.refused.add(this.lastRequested);
      console.warn('sword aura: record ' + this.lastRequested + ' refused, dropped for this session');
      this.detach(); this.unitRoot = null;
      if (this.lastSync) this.sync(this.lastSync.cls, this.lastSync.roots, this.lastSync.parent);
      return;
    }
    const slot = stance ? slotOf(stance.clip) : null, set = stance ? setOf(stance.file) : null;
    const key = slot === null ? null : set + ':' + slot;
    // THE MODE WORD (player+0x3328): the rig's (render/weapon.js modeWord -- the same word picks the weapon's own clip),
    // handed in each frame; on its own this host keeps it from the stance's declaration (MODES) and carries it, as
    // the word does, whether or not the aura is up. With THE DRAWN FLAG it is read before anything that needs this
    // host: Tempest Axe's gate is the player's (stepTempest) and must hold while this host is down or still building.
    const declared = key ? modeOf(set, slot) : null;
    this.lastMode = modeWord !== undefined ? modeWord : (declared || this.lastMode);
    this.lastDrawn = drawn === undefined ? !!this.live : !!drawn;
    this.lastOnBack = !!onBack;
    this.stepTempest();
    // THE WEAPON ON THE BACK ENDS WHAT HANGS FROM IT (Raven, 2026-09-29: "Demon Riot effect appears during Hunter Poses
    // when those should be Sheathed"). This host is the weapon IN THE HAND, and the page took it down only where it
    // remembered to sync: the Pose select sheathes without one, so the host lived on with its gid 0 on the hunter's
    // back and the held flames drew round the sheathed weapon. The drawn flag is handed in every frame, so the host ends
    // itself -- the next frame, whoever sheathed. (The ROM keeps the held request and hides it: the stop policy's byte
    // below is 0 for a weapon on the back. On screen that is the same; the page's next sync builds the host again.)
    if (this.live && !this.lastDrawn){ this.detach(); this.unitRoot = null; this.lastSync = null; return; }
    if (!this.live) return;
    this.stepClip(null, time, advance);
    this.stepBursts(advance);
    this.lastPhial = phial || null;
    this.lastElement = typeof element === 'number' ? element : elementId(element);
    const wrapped = key === this.lastStance && this.lastTime !== null && time < this.lastTime && time < 0.1;
    const changed = key !== this.lastStance, started = changed || wrapped;
    const before = started ? -1 : this.lastTime;
    const prev = this.lastStance;
    this.lastStance = key; this.lastTime = time;
    if (started) this.stopPolicy(key, changed);
    // the ROM's frames count the MOTION: a `_loop` stance is the second half of one motion (entry.t0 is where it starts)
    const t0 = stance && stance.t0 ? stance.t0 : 0;
    const mtime = time + t0, mbefore = before < 0 ? -1 : before + t0;
    const crossed = f => mbefore < f / 60 && mtime >= f / 60;
    // THE HELD AURA: with the charge on, mode 2 sits in the holder's slot 0 -- asked for every frame, kept while it runs
    if (this.charge){
      if (this.held && this.held.finished && this.held.finished()) this.held = null;
      if (!this.held) this.held = this.request(2, phial);
    }
    // THE STOP POLICY'S BYTE (holder vtable +0x160 = 0x454ed4, codes 5/6, every frame the effect lives; re-read
    // 2026-09-28 night): the held aura is kept while status flag 0x400 stands (vtable +0x1b8(0x400), else the policy
    // answers 3: stop); then, with the weapon unit at player+0x23a0 present, the byte +0x1c1 is written 1 when the
    // class's sword-mode query (vtable +0x35c: player+0x3328 == 1) answers yes AND the weapon unit's state word +0x13d4
    // ORed with 0x10 is NOT 0x12 -- state 2 / 0x12 is the weapon on the hunter's back (the part unit plays its rest
    // clip 0 there, 0x30837c) -- and 0 otherwise, with one exception: while the motion is 5255 (main-list Motion[255])
    // and its frame is in [20, 324) the byte is 1 in either mode. The core's per-frame 0x43370 copies +0x1c1 into
    // +0x18c, and each node takes that into bit 11 of its flags (0x327214), the bit the draw-state choice 0x41c74
    // reads. As the code has it (0x454f54..0x45504c): sword mode AND the weapon not on the back -> 1; anything else ->
    // 0, unless the motion is 5255 with its frame in [20, 324) (324.0 is the literal at 0x455060) -> 1. THE WEAPON'S
    // STATE is the game's own test on the weapon unit's mount index (render/weapon.js onBack), read from the mount the
    // rig placed this frame -- so a sheathe stance hides the aura at the frame its clip moves the weapon to the back --
    // and a Hunter Pose, where the page has sheathed the weapon, has no weapon-unit host at all.
    if (this.held && this.held.core && this.held.m){
      const sword = this.lastMode === 'sword';
      const show = (sword && this.lastDrawn && !this.lastOnBack) || (key === 'draw:255' && mtime >= 20 / 60 && mtime < 324 / 60);
      this.held.m.w8(this.held.core + 0x1c1, show ? 1 : 0);
    }
    // DEMON RIOT'S OWN FRAMES: Arts Motion[101] gathers the charge on the hunter at frame 70 and sets the state at 220
    // (0x11a1bc4: the level into +0x3340, the timer +0x3348 zeroed when the state was off). The start function writes
    // THE DEMON RIOT SWITCH IS THE USER'S ALONE (Raven, 2026-09-29: "Do not have the Demon Riot animation turn on the
    // toggle"): the Art's stance plays its own effect at frame 70 (900/901 on the hunter) and leaves the switch as it is,
    // whether it starts, loops or is left mid-way. (In the game frame 220 writes the level into +0x3340, DEMON_RIOT.stateFrame.)
    if (key === DEMON_RIOT.set + ':' + DEMON_RIOT.slot && before !== null){
      if (crossed(DEMON_RIOT.effectFrame)) this.requestArt(phial);
    }
    // THE BURSTS: at the motion frames the action code creates the burst shells (BURSTS; the row by phial and element,
    // burstRow), as the shell's own init requests its effect at its spawn
    const bursts = key ? BURSTS[key] : null;
    if (bursts && before !== null){
      for (const b of bursts){
        let fire = false;
        if (b.every) fire = mbefore >= 0 && Math.floor(mtime * 60 / b.every + 1e-6) > Math.floor(mbefore * 60 / b.every + 1e-6);
        else if (b.at === 'start') fire = started;
        else fire = crossed(b.at);
        if (fire) this.burst(b.slot, burstRow(b.slot, phial, this.lastElement, b.sub || 0), phial, this.lastElement);
      }
    }
    // THE TIMED ROWS: row 13 on the weapon, at the frame the action's own countdown runs out
    const timed = key ? TIMED_REQUESTS[key] : null;
    if (timed && before !== null)
      for (const t of timed) if (crossed(t.at) && !this.refused.has(t.key)){ this.lastRequested = t.key; this.startState(t.key, null, { rootJoint: 0 }); }
    // (the player's own holder rows, PLAYER_TIMED_REQUESTS, are the page's PlayerRequests on the hunter host: player facts, not this host)
    if (!started || key === null) return;
    for (const [mode, r] of Object.entries(SWORD_REQUESTS)){
      if (r.held || r.set !== set || !r.slots.includes(slot)) continue;
      if (+mode === 0 && this.charge) continue;       // the gate: vtable +0x838 answers the charge state
      this.request(+mode, phial);
    }
  }
  // One burst shell's effect, as the shell's init requests it (0x474550 / 0x4752d4): spec 0 of the shell's ROW (the row
  // the action's setup word +8 names, burstRow; BURST_RECORDS) on the HUNTER unit, placed at the player's position plus, for uShellPlw08_000, the
  // vector (-30, 180, 150) turned by the player's angles (0x474374..0x474480) -- uShellPlw08_001 stays at the player's
  // position -- with the row's ShellScale 1 and, for _000 alone, the phial's colour in the second override word. The
  // parent is the shell itself in the game (its own handle, carrying the player's angles); here the hunter host stands in,
  // and the request's position (+0x1c bit 0, +0xc0) places the effect as the ROM's does. Returns the request or null.
  burst(slot, row, phial, element = 0){
    const h = this.hunterHost;
    if (!h || !h.live || !h.live.unitMatrix) return null;
    const key = slot === 1 ? (BURST_RECORDS[1][row] || [])[0] : BURST_RECORDS[0][row];
    if (!key) return null;
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    h.live.unitMatrix(m).decompose(p, q, sc);
    // the player's position: the hunter's pelvis (the host's unit origin, pinned in X/Z at rest) over the floor it stands on
    const ground = this.floor ? this.floor() : p.y;
    const off = slot === 0 ? new THREE.Vector3(...BURST_OFFSET).applyQuaternion(q) : new THREE.Vector3();
    const position = [p.x / MT_TO_VIEW + off.x, ground / MT_TO_VIEW + off.y, p.z / MT_TO_VIEW + off.z];
    const requester = { position, scale: [1, 1, 1], type8: 3 };
    // the colour (slot 0 only): not for Dragon, and not for the Element phial on a weapon WITH an element -- one of the
    // five, 1..5 (0x4740a0..0x4740f8); a status or no element keeps the phial's colour
    const elemental = phial === 'Element' && element >= 1 && element <= 5;
    if (slot === 0 && phial !== 'Dragon' && !elemental){
      const c = this.colourFor(phial);
      if (c === undefined) return null;
      requester.colour2 = c;
    }
    const q2 = h.startState(key, null, requester);
    if (q2) this.bursts.push({ q: q2, slot, frames: 0 });
    return q2;
  }
  // 0x11a4d94: holder row 7 (900; Dragon 8, 901) on the HUNTER unit, root joint -1, the phial's colour
  requestArt(phial){
    const h = this.hunterHost;
    if (!h || !h.live) return null;
    const dragon = phial === 'Dragon';
    const key = dragon ? DEMON_RIOT.even : DEMON_RIOT.odd;
    const requester = { rootJoint: 0xffff };
    if (!dragon){
      const c = this.colourFor(phial);
      if (c === undefined) return null;
      requester.colour = c;
    }
    if (this.artRequest){ this.stopOne(this.artRequest); this.artRequest = null; }   // holder slot 2 replaces what it held
    const q = h.startState(key, null, requester);
    if (q) this.artRequest = q;
    return q;
  }
  stats(){
    return Object.assign(super.stats(), { unit: !!this.unitRoot, stance: this.lastStance, mode: this.mode(),
                                          refused: [...this.refused], lastRequested: this.lastRequested,
                                          charge: this.charge, tempest: this.tempest, tempestRunning: !!this.tempestReq, held: !!(this.held && !(this.held.finished && this.held.finished())) });
  }
}
