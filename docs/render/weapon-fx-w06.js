// THE LIGHT BOWGUN'S EFFECTS: what uPlayerQuest06's code and its effect holder ask for, and when.
//
// Raven, 2026-09-30: "Next weapon" (the Light Bowgun, next by the request-site count after the Hunting Horn). Read from
// the ROM the way the Hunting Horn was (build/notes/light-bowgun-effects.md; efx/player/w06). Every address is exefs/main.
// The class's motion schedule (docs/effects/w06.json clips) runs on the hunter host like every class's; this module is
// what the schedule does not cover.
//
// THE CLASS: uPlayerQuest06, vtable 0x1745634, own code 0x118915c..0x11958a8; the action switch (vtable +0x324 =
// 0x118a16c, on +0x250a, table 0x118a194) has 110 cases that set r1..r3 and fall through shared blocks into `bl start`
// (efx/player/w06/data/cases.py). Six holder requests, all 0x281ffc (tracked; flag 1 = the slot's occupant stops at once
// first, flag 0 = an occupied slot keeps its effect whatever row is asked: 0x44c164), five on the WEAPON unit with root
// joint 0 (+0x14 bit 5, +0x52 = 0): part slot 7's vtable +0x130 handle.
//   * ROW 3 = w04_000 10 (w04_002.efl), the shot's effect on the gun, slot 0, flag 1: at the start of Motion[1] (acts 11
//     / 21 / 23 with r2 = 0, 0x118be38; acts 52 / 79 / 80 after Motion[182], 0x118c124) and of Motion[121] (acts 60 / 61,
//     0x118e444). A STANCE IS A MOTION: Motion[1] is the one-frame standing pose the base's idle plays too, so the table
//     keys only Motion[121], which only those actions play.
//   * ROW 1 = w06_800 800 (cm120_061), slot 1, flag 1: 0x118f420 (acts 66 / 68, Arts Motion[106] then [103] repeated)
//     fires at motion frame 4 of each -- a count at +0x3344 down by one, the bullet (shell 0x2a) -- and asks row 1 on the
//     gun while byte 3 of its state word is 0: the table keys the first, Arts Motion[106] frame 4.
//   * ROW 13 = w06_800 1100 (cm121_142), slot 0, flag 1, on the PLAYER: Charge Shot's activation (act 81, 0x118fb30,
//     Arts Motion[151]; it tests the Art ids 0x5c / 0x5d) at motion frame 17. Slot 0 is row 3's too: one holder slot.
//   * ROW 12 = w06_800 1010 (cm123_063), slot 4, flag 0: the class's status function (vtable +0x3e0 = 0x11891dc) asks it
//     every frame Charge Shot's rounds stand (+0x3351 > 0: status hi 0x10), the weapon drawn, the loaded ammo 0x2f and
//     +0x2b82 set -- not before frame 46 of Arts Motion[151].
// THE HOLDER uShellPlEffectW06 (vtable 0x1756b00; shell/pleffect/effect_w06) asks rows itself: its hook (+0x14c =
// 0x454058) reads the CHARGE LEVEL (vtable +0x7e8 = the base's 0x2694f8: player +0x2b72 & 7, which the class raises with
// the hold time, 0x1189fec: level 2 / 3 / 4 at player parameters 0x11 / 0x12 / 0x13), remembers it at +0x16a0 and every
// frame holds rows 5..8 = w06_800 910..913 (cm123_061) on the WEAPON (slot 2, level 1..4) and, for levels 2..4, rows
// 9..11 = 1000..1002 (cm123_063) on the holder shell's own handle (slot 3) -- with flag 1 only when the level ROSE
// since the last frame (and then +0x16a1 = 0), else flag 0: a level that falls keeps the higher level's effects.
// THE POLICY (+0x160 = 0x454458, every frame each slot's effect lives; the update 0x44bc88 first writes the effect's
// show byte +0x1c1 = 1, then applies the answer: 3 stop at once, 2 let it end, 0 keep but hide unless the parent unit's
// flags & 0x4807 are 0x4802, 1 keep as the policy left the byte):
//   * codes 5..8 (the level's glow): 0 while the level stands, else 2.
//   * codes 9..11 (the level's overlay): the byte = +0x16a1 AND player +0x2716 (AIMING MODE, below), then +0x16a1 = 1
//     once the effect's unit has flag 0x4000 (unit +0xd bit 0x40); 1 while the level stands, else +0x16a1 = 0 and 2.
//     While shown, 0x4547fc PUTS THE EFFECT AT THE CAMERA every frame: the current camera (sFestaCamera +0x54) gives
//     its eye (+0x40) and its target (+0x60); the angles are pitch atan2(-dy, horizontal) and yaw atan2(dx, dz), each
//     taken to a u16 turn (x 10430.378 + 0.5, truncated) and back to degrees (x 360 / 65536); 0x329d04 turns unit 0 to
//     them (0x8a4dfc, in the unit's own rotation order), 0x329c9c moves unit 0 to the eye, and every unit's scale
//     (+0x60 / +0x64) becomes the camera's +0x3c (its field of view) x 1.25 / k, +0x68 = 1 -- k the camera's +0xabc
//     when it is a uQuestCamera (the field of view it saved at its last transition, 0xbe37cc), else 1. So rows
//     9..11 are not an aura on the hunter: they are the charge drawn around the VIEW while aiming. NOT WIRED since
//     2026-10-01 (no Aiming Mode in the viewer, below); the page drew them so from 2026-09-30.
//   * code 12 (the rounds): 3 unless the weapon is drawn, the status and the ammo stand, and not past frame 15 of
//     Motion[197] (motion 5197); else 0.
//   * code 13 (the activation): the byte = NOT Aiming Mode; 0 while action 81 stands and its motion frame is below 110,
//     else 3.
//   * code 1 (row 1): 0 while action group 0x10 plays act 66 / 68, else 3. Code 3 (row 3): 0 through acts 11, 12, 21..24,
//     52, 60..64, 79, 80, else 3 -- here, while its stance stands (the viewer plays motions, not actions).
// AIMING MODE (the game's name: StartMenuMsg_eng.gmd, "the R Button to enter Aiming Mode"; HN_WeaponControlsMsg: "Press:
// Scope - Hold: Quick Aim") is player +0x2716: the base's 0x29f3cc sets it while the aim buttons are held (0x282930 0x61
// / 0x62) or toggles it on a press (0x2856fc 0x29), handing the camera singleton (sFestaCamera) the aim mode each time
// (0x1baa4); vtable +0x1c8 reads it, the class picks its command table by it (2000 / 2040, 0x1189588) and its Arts clear
// it (act 81's start, 0x118fc04). THE VIEWER HAS NO AIMING MODE (Raven, 2026-10-01: "Remove aiming mode for Bowguns as
// well, that is a First Person camera mode"): row 13 always shows, as it does outside Aiming Mode, and rows 9..11, shown
// only in it, are not asked.
// ROW 4 = cm002_002 212 (cm002_007.efl): the base sharpening (0x2d5e74, weapon type 6 -> code 4) at Motion[255] frame 274.
// Rows 0 / 2 (w04_000 5 / 6): nothing in the class, the holder or the base asks them.
// THE LISTS: the Light Bowgun plays the HEAVY Bowgun's w04_000 as its _000 list, from the shared archive
// player/quest/wbc (its holder names it; every p1 = 2 binding of w06.psl is a w04_000 record) -- the export's 11
// bindings that were unresolved (C:/MHGU-Extract/efx/export_weapon_effects.py OWN_000).
// THE HUNTER ARTS (hunterArtsData_eng.gmd, by the ids the code tests): FULL HOUSE 0x56..0x58 (act 71, Arts Motion[51] /
// [52]: its schedule's), CHARGE SHOT 0x5c..0x5e (act 81 above; the charged shots 0x118fedc). Acts 65 / 66 / 68 (Arts
// Motion[101..106]), 69 (Arts Motion[1]), 70 ([2] / [3]) and 72 ([109]) test no id here: named by their motions only.
// THE HOSTS: one holder, its slots on the hosts its rows' parents name -- the weapon unit (this module's gun host) and
// the player (the hunter host: row 13). Rows 9..11's parent, the holder shell's own handle (shell +0xfd0), would be a
// third at the world origin (the policy writes the camera's eye into the units): with Aiming Mode it went (the page held
// it as a host of its own from 2026-09-30 to 2026-10-01, at the game's scale 1.25 -- 0x4548a0 -- for the viewer's camera).
// NOT WIRED: the bullets (shells 0x2a / 0x2b, the charged shots, pl_w04_000's 90 ammo rows in wbc.arc) -- the viewer
// fires nothing; Motion[1]'s shot effect (the stance is the idle's too); rows 9..11 (1000..1002, cm123_063: Aiming Mode).
import * as THREE from 'three';
import { WeaponEffects } from './weapon-fx.js';

export const ROWS = {
  shot: { key: 10, efl: 'w04_002' },
  artShot: { key: 800, efl: 'cm120_061' },
  level: { keys: [910, 911, 912, 913], efl: 'cm123_061' },
  chargeShot: { key: 1010, efl: 'cm123_063' },
  activation: { key: 1100, efl: 'cm121_142' },
  sharpen: { key: 212, efl: 'cm002_007' },
};
const UNIT = { rootJoint: 0 };                  // +0x14 bit 5, +0x52 = 0: the weapon unit's root joint

// The player's requests by stance that no policy of the holder's watches beyond the stance (render/weapon-fx.js
// PlayerRequests on the hunter host); Charge Shot's activation is the holder's below (its policy keeps it to a frame)
export const PLAYER_REQUESTS = {
  'draw:255': [{ at: 274, key: ROWS.sharpen.key, efl: ROWS.sharpen.efl }],                       // the sharpening
};
// the class's rows by stance, each asked with flag 1 on the host its parent names
const STANCE_ROWS = {
  'draw:121': [{ at: 0, slot: 0, row: ROWS.shot, on: 'gun' }],                                           // acts 60 / 61
  'sa:106': [{ at: 4, slot: 1, row: ROWS.artShot, on: 'gun', while: ['sa:106', 'sa:103'] }],             // 0x118f420's first
  'sa:151': [{ at: 17, slot: 0, row: ROWS.activation, on: 'player' }],                                   // act 81
};
const ACTIVATION_UNTIL = 110;                   // code 13: kept below this motion frame (the literal at 0x4547f8)

function stanceKey(stance){
  const m = /Motion\[(\d+)\]/.exec((stance && stance.clip) || '');
  return m ? (/_sa\./.test(stance.file || '') ? 'sa:' : 'draw:') + (+m[1]) : null;
}
const running = x => !(x.q.finished && x.q.finished());
// the show byte the holder's update and policy write (+0x1c1 of the slot's effect: the request's core)
function showByte(q, on){ if (q && q.m && q.core) q.m.w8(q.core + 0x1c1, on ? 1 : 0); }
// the holder's answer for a slot's effect on `host`: 3 at once, 2 the effect's own end (the schedule drops it when done)
function stopOn(host, x, answer){
  const sc = host && host.live && host.live.schedule;
  if (!x || !sc || x.live !== host.live) return;
  try {
    if (!x.q.stopped) sc.host.stopRequest(x.q);
    if (answer === 3){ sc.host.releaseRequest(x.q); for (const e of sc.entries) e.requests = e.requests.filter(q => q !== x.q); }
  } catch (_) {}
}

// THE GUN: a weapon-unit host on the gun's bone 0 (as Devouring Demon's, render/weapon-fx-w07.js). It keeps the holder's
// slots for both hosts: `hunter` (the player's) is the page's
export class LightBowgunEffects extends WeaponEffects {
  constructor(){
    super();
    this.unitRoot = null; this.lastSync = null;
    this.held = new Map();        // holder slot -> { q, key, host, live, while }
    this.chargeShot = false;      // the Art's state (the checkbox)
    this.level = 0;               // the charge level (the select), 0..4
    this.lastLevel = 0;           // the holder's +0x16a0
    this.stance = null;           // { key, f }
    this.hunter = null;           // the hunter host (row 13)
  }
  makeHost(roots){
    const part = roots && roots[0];
    const node = part ? (part.userData.bone || part) : null;
    const host = new THREE.Group();
    host.name = 'light-bowgun-fx-host';
    host.userData.gidBones = node ? [{ gid: 0, node, d: 0 }] : [];
    host.userData.joints = [];
    return host;
  }
  useDef(def){
    const keys = new Set([ROWS.shot.key, ROWS.artShot.key, ...ROWS.level.keys, ROWS.chargeShot.key]);
    return Object.assign({}, def, { clips: {}, parentOrder: 0x30000, unitFromOrigin: true,
      effects: (def.effects || []).filter(e => e.when === 'state' && e.record && e.record.array === 'UNIQUE' && keys.has(e.record.key) &&
                                                !this.refused.has(e.record.key))
                                  .map(e => Object.assign({}, e, { joints: [0] })) });
  }
  async sync(cls, roots, parent){
    const part = (roots && roots[0]) || null;
    if (cls !== 'w06' || !part || !this.on){ if (this.live || this.unitRoot) this.detach(); this.unitRoot = null; this.lastSync = null; return null; }
    this.lastSync = { cls, roots: [part], parent };
    if (this.cls === cls && this.live && this.unitRoot === part) return this.live;
    this.unitRoot = part;
    return this.attach(cls, [part], parent);
  }
  // the holder goes with the class: every slot on every host
  detach(){ for (const s of [...this.held.keys()]) this.release(s, 3); this.lastLevel = 0; super.detach(); }
  hostOf(on){ return on === 'player' ? this.hunter : this; }
  alive(x){ return !!x.host && x.live === x.host.live && running(x); }
  release(slot, answer){ const x = this.held.get(slot); this.held.delete(slot); if (x) stopOn(x.host, x, answer); }
  // 0x281ffc -> 0x44c164: flag 1 stops the slot's occupant at once and asks the row; flag 0 keeps an occupied slot's
  // effect, whatever row is asked. `on` names the host of the row's parent.
  ask(slot, row, key, flag, on = 'gun'){
    const x = this.held.get(slot);
    if (x && this.alive(x) && !flag) return x.q;
    if (x) this.release(slot, 3);
    const host = this.hostOf(on);
    if (!host || !host.live || host.refused.has(key)) return null;
    if (host === this) this.lastRequested = key;
    const q = host.startState(key, row.efl, on === 'gun' ? UNIT : null);
    if (q) this.held.set(slot, { q, key, host, live: host.live });
    return q;
  }
  setChargeShot(on){ this.chargeShot = !!on; if (!this.chargeShot && this.held.has(4)) this.release(4, 3); return this.chargeShot; }
  setLevel(level){ this.level = Math.max(0, Math.min(4, level | 0)); return this.level; }
  // every frame: `cls` the class in the hand (null otherwise), `stance` / `time` the weapon stance, `drawn` the rig's fact
  step(cls, stance, time, advance, drawn){
    if (this.live && this.live.failed){
      if (this.lastRequested != null) this.refused.add(this.lastRequested);
      console.warn('light bowgun: record ' + this.lastRequested + ' refused, dropped for this session');
      this.detach(); this.unitRoot = null;
      if (this.lastSync) this.sync(this.lastSync.cls, this.lastSync.roots, this.lastSync.parent);
      return;
    }
    for (const [s, x] of this.held) if (!this.alive(x)) this.held.delete(s);
    if (!this.live) return;
    this.stepClip(null, time, advance);
    const on = cls === 'w06';
    const key = on && drawn && stance ? stanceKey(stance) : null;
    // the motion frame, as the ROM counts it (whole steps of 1.0: the seconds' float noise off, so 110 / 60 s is 110)
    const f = key ? Math.round(((time || 0) + (stance.t0 || 0)) * 60 * 1000) / 1000 : 0;
    const from = this.stance && this.stance.key === key && f >= this.stance.f ? this.stance.f : -1;
    this.stance = key ? { key, f } : null;
    // THE CLASS'S ROWS: asked at their motion frame (flag 1); the policy stops rows 1 / 3 at once when their action ends
    for (const [s, x] of [...this.held]) if (x.while && !x.while.includes(key)) this.release(s, 3);
    for (const r of STANCE_ROWS[key] || []) if (from < r.at && f >= r.at && this.ask(r.slot, r.row, r.row.key, true, r.on)){
      const x = this.held.get(r.slot);
      if (r.on === 'gun') x.while = r.while || [key];
    }
    // row 13's policy (code 13): kept while act 81 stands below frame 110, else stopped at once; its byte = NOT Aiming
    // Mode, which the viewer never enters
    const act = this.held.get(0);
    if (act && act.key === ROWS.activation.key){
      if (key !== 'sa:151' || f >= ACTIVATION_UNTIL) this.release(0, 3);
      else showByte(act.q, true);
    }
    // THE HOLDER'S HOOK, every frame the class is in the hand: the level's glow, flag 1 only when the level rose (its
    // overlay, rows 9..11, shows only in Aiming Mode: not asked)
    const level = on ? this.level : 0;
    const rose = this.lastLevel < level;
    this.lastLevel = level;
    if (level) this.ask(2, ROWS.level, ROWS.level.keys[level - 1], rose);
    // the policy, codes 5..8: kept while the level stands, else left to end (2)
    if (!level && this.held.has(2)) this.release(2, 2);
    // Charge Shot's rounds (the status function 0x11891dc, flag 0; the policy's code 12 stops them at once)
    const hold = key === 'sa:151' && f < 46;
    const stop = key === 'draw:197' && f > 15;
    if (on && this.chargeShot && drawn && !stop){ if (!hold) this.ask(4, ROWS.chargeShot, ROWS.chargeShot.key, false); }
    else if (this.held.has(4)) this.release(4, 3);
  }
  stats(){
    const held = {};
    for (const [k, x] of this.held) held[k] = { key: x.key, on: x.host === this ? 'gun' : 'player',
                                                running: running(x), shown: x.q && x.q.m && x.q.core ? x.q.m.u8(x.q.core + 0x1c1) : null };
    return Object.assign(super.stats(), { unit: !!this.unitRoot, chargeShot: this.chargeShot, level: this.level,
      held, stance: this.stance && this.stance.key });
  }
}
