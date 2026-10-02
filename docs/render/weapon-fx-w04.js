// THE HEAVY BOWGUN'S EFFECTS: what uPlayerQuest04's code and its effect holder ask for, and when.
//
// Raven, 2026-09-30: "push, then next weapon" (the Heavy Bowgun, the smallest left by the request-site count: 9 holder
// requests, 10 request blocks, 1 shell creation). Read from the ROM as the Light Bowgun was (build/notes/heavy-bowgun-
// effects.md; efx/player/w04). Every address is exefs/main. The class's motion schedule (docs/effects/w04.json clips) runs
// on the hunter host like every class's; this module is what the schedule does not cover.
//
// THE CLASS: uPlayerQuest04, vtable 0x1744d64, own code 0x117b51c..0x1188d58; the action switch (vtable +0x324 =
// 0x117c1f0, on +0x250a, table 0x117c218, 130 cases) sets r1..r3 and falls through shared blocks into `bl start`, as the
// Light Bowgun's does (efx/player/w04/data/cases.py). Nine holder requests, all 0x281ffc with flag 1 (the slot's
// occupant stops at once first; 0x44c164 keys on the SLOT, so a flag-0 request keeps whatever the slot holds):
//   * ROW 3 = w04_000 10 (w04_002.efl), the shot's effect, slot 0, on the WEAPON unit with root joint 0 (+0x14 bit 5,
//     +0x52 = 0): at the start of Motion[1] (acts 11 / 13 / 15 / 108..110, 0x117dd38; acts 51 / 77 / 78 after
//     Motion[182], 0x117e0a0) and of Motion[121] (acts 58 / 59, 0x1181348). A STANCE IS A MOTION: Motion[1] is the
//     one-frame standing pose the base's idle plays too, so the table keys only Motion[121].
//   * ROW 4 = w04_800 810 (cm120_041), slot 1, weapon root joint 0: act 63 (0x11818b4, Arts Motion[1], repeated by a
//     count from the Art's level) at motion frame 120 of each pass.
//   * ROW 6 = w04_800 940 (cm120_102), slot 3, on the PLAYER with root joint 0: GUNS BLAZING (act 66, 0x1181c4c, Arts
//     Motion[51]; it tests the Art ids 0x3e..0x40) at motion frame 160, where the Art's timer +0x3334 is set.
//   * ROW 20 = w04_800 1100 (cm121_040), slot 0, on the PLAYER (its record's own joint): GUNPOWDER INFUSION (act 65,
//     0x1181eb8, Arts Motion[101]; it tests 0x41..0x43 and adds the level's shots to +0x3330, at most 99) at frame 60;
//     ROW 5 = 820 (cm121_045), slot 2, weapon root joint 0, at frame 160.
//   * ROW 8 = w04_800 901 (cm123_041), slot 4, on the WEAPON with its OFFSET overridden (+0x14 bit 0, +0x20 = (0, y,
//     0) from vtable +0x894 = 0x1184b5c: y 3.0 for gun model 0x84, 3.5 for 0x85, else 0; the records' own offset is 0):
//     act 79 (0x1182164, Arts Motion[151]) at its start; ROWS 10.. = 911.. at the END of each pass of the motion, the
//     pass's index added to the row (the passes counted from the Art's level), the same block.
// THE HOLDER uShellPlEffectW04 (vtable 0x1756800; shell/pleffect/effect_w04, 21 rows): its hook (+0x14c = 0x4536ec)
// every frame asks slot 2 row 5 (flag 0) on the weapon while status lo 0x40 stands (+0x3330 >= 1: Gunpowder
// Infusion's shots, the class's status function 0x117b59c), vtable +0x17c answers, the motion is not 5002, 5130 or 5195
// past frame 105 and the action group is not 0x800 -- not during act 65 itself; it remembers at +0x16a0 whether that
// held. It asks slot 3 row 6 (flag 0) on the player's root joint 0 while status lo 0x80 stands (+0x3334 > 0: Guns
// Blazing). THE POLICY (+0x160 = 0x4538e8): code 3 kept through acts 11..16, 51, 58..62, 77, 78, 108..110, else stopped
// at once; code 4 kept while act 63; code 5: +0x16a0 clear -> 2 (it ends), else kept with the show byte 0 when the gun is
// on the back (its mount index 2 / 0x12, 0x307b30); code 6 kept while status 0x80, else 2; codes 8, 10..14 kept while
// act 79, else 2 (or 3 outside the class's actions); code 20: the byte = NOT Aiming Mode (+0x2716), kept while act 65
// stands below frame 95, else stopped at once. Codes 9 / 15 / 16 (902..904) are act 80's: at its frame 112 the policy
// stops them and creates the Art's projectile shell 0x2c.
// ROW 7 = cm002_002 211 (cm002_007.efl): the base sharpening (0x2d5e74, weapon type 4 -> code 7) at Motion[255] frame 274.
// THE HUNTER ARTS (hunterArtsData_eng.gmd, by the ids the code tests): GUNS BLAZING 0x3e..0x40 (act 66), GUNPOWDER
// INFUSION 0x41..0x43 (act 65). Acts 63 (Arts Motion[1]) and 79 / 80 (Arts Motion[151], [153] / [155]) test no id:
// named by their motions only (the class's other two Arts are Super Nova 0x3b..0x3d and Void Piercer 0x44..0x46).
// THE LISTS: w04_000 is the shared bowgun archive's (player/quest/wbc), as for the Light Bowgun; of its records only the
// shot's (10) is asked -- the rest are the bullets' and the other shells' (not wired), taken out of the class's data.
// NOT WIRED: the bullets (shell 0x2a, act 118 and the shots), the Art's projectile (shell 0x2c = pl_w04_101: 902..904
// with 1001..1003, by act 80 and the policy), Motion[1]'s shot effect (the stance is the idle's too), rows 0 / 2
// (w04_000 0 / 1: nothing asks them).
// NO AIMING MODE in the viewer (Raven, 2026-10-01: "Remove aiming mode for Bowguns as well, that is a First Person camera
// mode"): row 20, whose byte is NOT Aiming Mode, always shows.
import * as THREE from 'three';
import { WeaponEffects } from './weapon-fx.js';

export const ROWS = {
  shot: { key: 10, efl: 'w04_002' },                     // row 3
  art63: { key: 810, efl: 'cm120_041' },                 // row 4
  infusion: { key: 820, efl: 'cm121_045' },              // row 5
  blazing: { key: 940, efl: 'cm120_102' },               // row 6
  load: { key: 901, efl: 'cm123_041' },                  // row 8
  loads: { keys: [911, 912, 913, 914, 915], efl: 'cm123_041' },   // rows 10..14
  infusionStart: { key: 1100, efl: 'cm121_040' },        // row 20
  sharpen: { key: 211, efl: 'cm002_007' },               // row 7
};
const GUN = { rootJoint: 0 };                  // +0x14 bit 5, +0x52 = 0: the weapon unit's root joint
const PLAYER_ROOT = { rootJoint: 0 };          // row 6: the player's root joint 0
const OFFSET_Y = { 0x84: 3.0, 0x85: 3.5 };     // vtable +0x894 by the gun model (weapon unit +0x1380)
// the record keys the hunter host must root on a joint no record names (render/weapon-fx.js WeaponEffects.useDef
// requestJoints): row 6 on the player's joint 0
export const REQUEST_JOINTS = { [ROWS.blazing.key]: 0 };

// The player's requests by stance that no policy of the holder's watches beyond the stance (render/weapon-fx.js
// PlayerRequests on the hunter host)
export const PLAYER_REQUESTS = {
  'draw:255': [{ at: 274, key: ROWS.sharpen.key, efl: ROWS.sharpen.efl }],                       // the sharpening
};
// the class's rows by stance, each asked with flag 1 on the host its parent names; `until` the policy's last frame
const STANCE_ROWS = {
  'draw:121': [{ at: 0, slot: 0, row: ROWS.shot, on: 'gun' }],                                           // acts 58 / 59
  'sa:1': [{ at: 120, slot: 1, row: ROWS.art63, on: 'gun' }],                                            // act 63
  'sa:51': [{ at: 160, slot: 3, row: ROWS.blazing, on: 'player', held: true }],                          // act 66
  'sa:101': [{ at: 60, slot: 0, row: ROWS.infusionStart, on: 'player', until: 95, aim: true },           // act 65
             { at: 160, slot: 2, row: ROWS.infusion, on: 'gun', held: true }],
  'sa:151': [{ at: 0, slot: 4, row: ROWS.load, on: 'gun', offset: true }],                               // act 79
};

function stanceKey(stance){
  const m = /Motion\[(\d+)\]/.exec((stance && stance.clip) || '');
  return m ? (/_sa\./.test(stance.file || '') ? 'sa:' : 'draw:') + (+m[1]) : null;
}
const running = x => !(x.q.finished && x.q.finished());
function showByte(q, on){ if (q && q.m && q.core) q.m.w8(q.core + 0x1c1, on ? 1 : 0); }
// the holder's answer for a slot's effect on `host`: 3 at once (0x329c40(core, 1), the core's own kill), 2 the effect's
// own end (0x329c40(core, 0)); either way the schedule drops the request once it has run out (proof.js killRequest)
function stopOn(host, x, answer){
  const sc = host && host.live && host.live.schedule;
  if (!x || !sc || x.live !== host.live) return;
  try {
    if (answer === 3) sc.host.killRequest(x.q);
    else if (!x.q.stopped) sc.host.stopRequest(x.q);
  } catch (_) {}
}

// THE GUN: a weapon-unit host on the gun's bone 0 (as the Light Bowgun's). It keeps the holder's slots for both hosts:
// `hunter` (the player's) is the page's
export class HeavyBowgunEffects extends WeaponEffects {
  constructor(){
    super();
    this.unitRoot = null; this.lastSync = null;
    this.held = new Map();        // holder slot -> { q, key, host, live, stance, until, aim }
    this.blazing = false;         // Guns Blazing (status lo 0x80; the checkbox)
    this.infusion = false;        // Gunpowder Infusion's shots (status lo 0x40; the checkbox)
    this.held5 = false;           // the holder's +0x16a0
    this.stance = null;           // { key, f, passes }
    this.hunter = null;           // the hunter host
    this.model = null;            // the gun's model id (weapon unit +0x1380), for the offset of act 79's rows
  }
  makeHost(roots){
    const part = roots && roots[0];
    const node = part ? (part.userData.bone || part) : null;
    const host = new THREE.Group();
    host.name = 'heavy-bowgun-fx-host';
    host.userData.gidBones = node ? [{ gid: 0, node, d: 0 }] : [];
    host.userData.joints = [];
    return host;
  }
  useDef(def){
    const keys = new Set([ROWS.shot.key, ROWS.art63.key, ROWS.infusion.key, ROWS.load.key, ...ROWS.loads.keys]);
    return Object.assign({}, def, { clips: {}, parentOrder: 0x30000, unitFromOrigin: true,
      effects: (def.effects || []).filter(e => e.when === 'state' && e.record && e.record.array === 'UNIQUE' && keys.has(e.record.key) &&
                                                e.record.pel !== 'cm002_002' && !this.refused.has(e.record.key))
                                  .map(e => Object.assign({}, e, { joints: [0] })) });
  }
  async sync(cls, roots, parent){
    const part = (roots && roots[0]) || null;
    if (cls !== 'w04' || !part || !this.on){ if (this.live || this.unitRoot) this.detach(); this.unitRoot = null; this.lastSync = null; return null; }
    this.lastSync = { cls, roots: [part], parent };
    if (this.cls === cls && this.live && this.unitRoot === part) return this.live;
    this.unitRoot = part;
    return this.attach(cls, [part], parent);
  }
  // the holder goes with the class: every slot on both hosts
  detach(){ for (const s of [...this.held.keys()]) this.release(s, 3); this.held5 = false; super.detach(); }
  hostOf(on){ return on === 'player' ? this.hunter : this; }
  alive(x){ return !!x.host && x.live === x.host.live && running(x); }
  release(slot, answer){ const x = this.held.get(slot); this.held.delete(slot); if (x) stopOn(x.host, x, answer); }
  // 0x281ffc -> 0x44c164: flag 1 stops the slot's occupant at once and asks the row; flag 0 keeps an occupied slot's
  // effect, whatever row is asked
  ask(slot, row, key, flag, on = 'gun', requester = null){
    const x = this.held.get(slot);
    if (x && this.alive(x) && !flag) return x;
    if (x) this.release(slot, 3);
    const host = this.hostOf(on);
    if (!host || !host.live || host.refused.has(key)) return null;
    if (host === this) this.lastRequested = key;
    const q = host.startState(key, row.efl, requester);
    if (!q) return null;
    const y = { q, key, host, live: host.live };
    this.held.set(slot, y);
    return y;
  }
  offset(){ return [0, OFFSET_Y[this.model] || 0, 0]; }
  setBlazing(on){ this.blazing = !!on; return this.blazing; }
  setInfusion(on){ this.infusion = !!on; return this.infusion; }
  // every frame: `cls` the class in the hand (null otherwise), `stance` / `time` the weapon stance, `drawn` the rig's fact,
  // `onBack` the gun on the hunter's back (render/weapon.js onBack: the mount index the policy tests)
  step(cls, stance, time, advance, drawn, onBack){
    if (this.live && this.live.failed){
      if (this.lastRequested != null) this.refused.add(this.lastRequested);
      console.warn('heavy bowgun: record ' + this.lastRequested + ' refused, dropped for this session');
      this.detach(); this.unitRoot = null;
      if (this.lastSync) this.sync(this.lastSync.cls, this.lastSync.roots, this.lastSync.parent);
      return;
    }
    for (const [s, x] of this.held) if (!this.alive(x)) this.held.delete(s);
    if (!this.live) return;
    this.stepClip(null, time, advance);
    const on = cls === 'w04';
    const key = on && drawn && stance ? stanceKey(stance) : null;
    // the motion frame, as the ROM counts it (whole steps of 1.0: the seconds' float noise off)
    const f = key ? Math.round(((time || 0) + (stance.t0 || 0)) * 60 * 1000) / 1000 : 0;
    const same = this.stance && this.stance.key === key;
    const from = same && f >= this.stance.f ? this.stance.f : -1;
    // a pass of act 79's motion ends where the clip comes round (a wrap) or stands at its last frame
    const dur = stance && stance.dur ? stance.dur * 60 : 0;
    const passEnd = key === 'sa:151' && dur > 0 && ((same && f < this.stance.f) || (from >= 0 && from < dur - 1 && f >= dur - 1));
    const passes = same ? this.stance.passes : 0;
    this.stance = key ? { key, f, passes: passes + (passEnd ? 1 : 0) } : null;
    // THE CLASS'S ROWS: asked at their motion frame (flag 1); the stance's own rows go with it (codes 3 / 4 at once,
    // 8 / 10..14 left to end), the held ones (5, 6) stay for the hook and the policy
    for (const [s, x] of [...this.held]) if (x.stance && x.stance !== key) this.release(s, x.stance === 'sa:151' ? 2 : 3);
    for (const r of STANCE_ROWS[key] || []) if (from < r.at && f >= r.at){
      const y = this.ask(r.slot, r.row, r.row.key, true, r.on, r.on === 'player' ? (r.row === ROWS.blazing ? PLAYER_ROOT : null)
                                                                          : (r.offset ? { offset: this.offset() } : GUN));
      if (y && !r.held){ y.stance = key; y.until = r.until; y.aim = r.aim; }
    }
    // act 79: the end of each pass asks row 10 + the pass's index (911..915), the same block
    if (passEnd){
      const n = Math.min(passes, ROWS.loads.keys.length - 1);
      const y = this.ask(4, ROWS.loads, ROWS.loads.keys[n], true, 'gun', { offset: this.offset() });
      if (y) y.stance = key;
    }
    // row 20's policy (code 20): the byte = NOT Aiming Mode, which the viewer never enters; kept while act 65 stands
    // below frame 95
    for (const [s, x] of [...this.held]) if (x.until != null){
      if (key !== x.stance || f >= x.until) this.release(s, 3);
      else if (x.aim) showByte(x.q, true);
    }
    // THE HOLDER'S HOOK, every frame the class is in the hand
    const motion = stance && /Motion\[(\d+)\]/.exec(stance.clip || '');
    const mid = motion && !/_sa\./.test(stance.file || '') ? +motion[1] : null;
    const out = mid === 2 || mid === 130 || (mid === 195 && f > 105);
    let h5 = false;
    if (key === 'sa:101') h5 = true;
    else if (on && this.infusion && drawn && !out){
      h5 = true;
      this.ask(2, ROWS.infusion, ROWS.infusion.key, false, 'gun', GUN);
    }
    this.held5 = h5;
    if (on && this.blazing) this.ask(3, ROWS.blazing, ROWS.blazing.key, false, 'player', PLAYER_ROOT);
    // the policy, codes 5 / 6: 5 ends (2) when the hook's conditions fail, else hidden with the gun on its back; 6 ends
    // when Guns Blazing does
    const g = this.held.get(2);
    if (g && g.key === ROWS.infusion.key){
      if (!this.held5) this.release(2, 2);
      else showByte(g.q, !onBack);
    }
    const b = this.held.get(3);
    if (b && b.key === ROWS.blazing.key && !(on && this.blazing)) this.release(3, 2);
  }
  stats(){
    const held = {};
    for (const [k, x] of this.held) held[k] = { key: x.key, on: x.host === this ? 'gun' : 'player', running: running(x),
                                                shown: x.q && x.q.m && x.q.core ? x.q.m.u8(x.q.core + 0x1c1) : null };
    return Object.assign(super.stats(), { unit: !!this.unitRoot, blazing: this.blazing, infusion: this.infusion,
      held5: this.held5, held, stance: this.stance && this.stance.key, model: this.model });
  }
}
