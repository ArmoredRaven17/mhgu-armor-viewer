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
//     9..11 are not an aura on the hunter: they are the charge drawn around the VIEW while aiming.
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
// it (act 81's start, 0x118fc04). The viewer has no aim: it is the user's switch.
// ROW 4 = cm002_002 212 (cm002_007.efl): the base sharpening (0x2d5e74, weapon type 6 -> code 4) at Motion[255] frame 274.
// Rows 0 / 2 (w04_000 5 / 6): nothing in the class, the holder or the base asks them.
// THE LISTS: the Light Bowgun plays the HEAVY Bowgun's w04_000 as its _000 list, from the shared archive
// player/quest/wbc (its holder names it; every p1 = 2 binding of w06.psl is a w04_000 record) -- the export's 11
// bindings that were unresolved (C:/MHGU-Extract/efx/export_weapon_effects.py OWN_000).
// THE HUNTER ARTS (hunterArtsData_eng.gmd, by the ids the code tests): FULL HOUSE 0x56..0x58 (act 71, Arts Motion[51] /
// [52]: its schedule's), CHARGE SHOT 0x5c..0x5e (act 81 above; the charged shots 0x118fedc). Acts 65 / 66 / 68 (Arts
// Motion[101..106]), 69 (Arts Motion[1]), 70 ([2] / [3]) and 72 ([109]) test no id here: named by their motions only.
// THE HOSTS: one holder, its slots on three hosts by the parent each row names -- the weapon unit (this module's gun
// host), the player (the hunter host: row 13) and the holder shell's own handle (shell +0xfd0: rows 9..11). The shell
// host's one joint is the world origin: the policy writes world coordinates into the units (the eye), which land there
// only in a frame that is the world's. The viewer's camera is the game's: its eye, the direction it looks, and its field
// of view equal to the one it saved (no aim zoom), so the scale is 1.25.
// NOT WIRED: the bullets (shells 0x2a / 0x2b, the charged shots, pl_w04_000's 90 ammo rows in wbc.arc) -- the viewer
// fires nothing; Motion[1]'s shot effect (the stance is the idle's too).
import * as THREE from 'three';
import { WeaponEffects } from './weapon-fx.js';
import { liftedCall } from './rom/effect/bridge.js';

const MT_TO_VIEW = 0.01;   // the runtime's game units to this app's world (rom/effect/live.js)
const TURN = 10430.3779296875, TURN_DEG = 0.0054931640625;   // 0x4549ec, 0x4549f0
const OVERLAY_SCALE = 1.25;                                    // 0x4548a0; the field of view over the one it saved: 1

export const ROWS = {
  shot: { key: 10, efl: 'w04_002' },
  artShot: { key: 800, efl: 'cm120_061' },
  level: { keys: [910, 911, 912, 913], efl: 'cm123_061' },
  levelOverlay: { keys: [1000, 1001, 1002], efl: 'cm123_063' },
  chargeShot: { key: 1010, efl: 'cm123_063' },
  activation: { key: 1100, efl: 'cm121_142' },
  sharpen: { key: 212, efl: 'cm002_007' },
};
const UNIT = { rootJoint: 0 };                  // +0x14 bit 5, +0x52 = 0: the weapon unit's root joint

// The player's requests by stance that no policy of the holder's watches beyond the stance (render/weapon-fx.js
// PlayerRequests on the hunter host); Charge Shot's activation is the holder's below (its policy reads Aiming Mode)
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
// the effect's unit has flag 0x4000 (unit +0xd bit 0x40): the policy's test before it sets +0x16a1
function unitReady(q){
  const m = q && q.m, core = q && q.core;
  if (!m || !core) return false;
  const u = m.u32(core + 0x150);
  return !!u && (m.u8(u + 0xd) & 0x40) !== 0;
}
// the holder's answer for a slot's effect on `host`: 3 at once, 2 the effect's own end (the schedule drops it when done)
function stopOn(host, x, answer){
  const sc = host && host.live && host.live.schedule;
  if (!x || !sc || x.live !== host.live) return;
  try {
    if (!x.q.stopped) sc.host.stopRequest(x.q);
    if (answer === 3){ sc.host.releaseRequest(x.q); for (const e of sc.entries) e.requests = e.requests.filter(q => q !== x.q); }
  } catch (_) {}
}

// THE HOLDER SHELL'S OWN HANDLE, the parent of rows 9..11: a host whose one joint is the world origin
export class HolderShellEffects extends WeaponEffects {
  makeHost(){
    const host = new THREE.Group();
    host.name = 'light-bowgun-holder-shell';
    host.userData.gidBones = [{ gid: 0, node: host, d: 0 }];
    host.userData.joints = [];
    return host;
  }
  useDef(def){
    const keys = new Set(ROWS.levelOverlay.keys);
    return Object.assign({}, def, { clips: {},
      effects: (def.effects || []).filter(e => e.when === 'state' && e.record && e.record.array === 'UNIQUE' && keys.has(e.record.key) &&
                                                !this.refused.has(e.record.key)) });
  }
  async sync(cls, roots, parent){
    if (cls !== 'w06' || !this.on){ if (this.live) this.detach(); this.lastSync = null; return null; }
    this.lastSync = { cls, roots: [], parent };
    if (this.cls === cls && this.live) return this.live;
    return this.attach(cls, [], parent);
  }
  step(time, advance){ this.stepClip(null, time, advance); }
  // 0x4547fc on the emulated memory: unit 0 turned to the camera's angles and moved to its eye (the ROM's own 0x329d04
  // and 0x329c9c, lifted), every unit's scale `s`; `eye` in game units, `dir` the direction the camera looks
  toCamera(q, eye, dir, s){
    const m = q && q.m, core = q && q.core, sc = this.live && this.live.schedule;
    if (!m || !core || !sc) return false;
    const F = Math.fround, turn = a => F(((Math.trunc(F(F(a * TURN) + 0.5)) & 0xffff) >>> 0) * TURN_DEG);
    const [dx, dy, dz] = dir;
    const yaw = turn(Math.atan2(dx, dz)), pitch = turn(Math.atan2(-dy, Math.sqrt(dx * dx + dz * dz)));
    const v = this.cameraVec || (this.cameraVec = sc.host.malloc(0x20));
    m.wf32(v, pitch); m.wf32(v + 4, yaw); m.wf32(v + 8, 0); m.w32(v + 12, 0);
    m.wf32(v + 16, eye[0]); m.wf32(v + 20, eye[1]); m.wf32(v + 24, eye[2]); m.w32(v + 28, 0);
    liftedCall(m, 0x329d04, [core, v, 0]);
    liftedCall(m, 0x329c9c, [core, v + 16, 0]);
    const n = m.u32(core + 0x15c);
    for (let i = 0; i < n; i++){
      const u = m.u32(core + 0x150 + 4 * i);
      if (!u) continue;
      m.wf32(u + 0x60, s); m.wf32(u + 0x64, s); m.wf32(u + 0x68, 1); m.w32(u + 0x6c, 0);
    }
    return true;
  }
  detach(){ this.cameraVec = null; super.detach(); }
}

// THE GUN: a weapon-unit host on the gun's bone 0 (as Devouring Demon's, render/weapon-fx-w07.js). It keeps the holder's
// slots for all three hosts: `hunter` (the player's) and `shell` (the holder shell's) are the page's
export class LightBowgunEffects extends WeaponEffects {
  constructor(){
    super();
    this.unitRoot = null; this.lastSync = null;
    this.held = new Map();        // holder slot -> { q, key, host, live, while }
    this.chargeShot = false;      // the Art's state (the checkbox)
    this.level = 0;               // the charge level (the select), 0..4
    this.aiming = false;          // Aiming Mode, player +0x2716 (the checkbox)
    this.lastLevel = 0;           // the holder's +0x16a0
    this.ready = false;           // the holder's +0x16a1
    this.stance = null;           // { key, f }
    this.hunter = null;           // the hunter host (row 13)
    this.shell = null;            // the holder shell's host (rows 9..11)
    this.camera = null;           // the viewer's camera: the game's current camera for the overlay
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
  detach(){ for (const s of [...this.held.keys()]) this.release(s, 3); this.lastLevel = 0; this.ready = false; super.detach(); }
  hostOf(on){ return on === 'player' ? this.hunter : on === 'shell' ? this.shell : this; }
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
  setAiming(on){ this.aiming = !!on; return this.aiming; }
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
    // row 13's policy (code 13): kept while act 81 stands below frame 110, else stopped at once; shown outside Aiming Mode
    const act = this.held.get(0);
    if (act && act.key === ROWS.activation.key){
      if (key !== 'sa:151' || f >= ACTIVATION_UNTIL) this.release(0, 3);
      else showByte(act.q, !this.aiming);
    }
    // THE HOLDER'S HOOK, every frame the class is in the hand: the level's rows, flag 1 only when the level rose
    const level = on ? this.level : 0;
    const rose = this.lastLevel < level;
    if (rose) this.ready = false;
    this.lastLevel = level;
    if (level){
      this.ask(2, ROWS.level, ROWS.level.keys[level - 1], rose);
      if (level >= 2) this.ask(3, ROWS.levelOverlay, ROWS.levelOverlay.keys[level - 2], rose, 'shell');
    }
    // the policy, codes 5..11: kept while the level stands, else left to end (2); the overlay shown by +0x16a1 and
    // Aiming Mode, and put at the camera while shown
    if (!level){
      if (this.held.has(2)) this.release(2, 2);
      if (this.held.has(3)) this.release(3, 2);
      this.ready = false;
    }
    const overlay = this.held.get(3);
    if (overlay && level){
      const show = this.ready && this.aiming;
      showByte(overlay.q, show);
      if (show) this.placeOverlay(overlay.q);
      if (unitReady(overlay.q)) this.ready = true;
    }
    // Charge Shot's rounds (the status function 0x11891dc, flag 0; the policy's code 12 stops them at once)
    const hold = key === 'sa:151' && f < 46;
    const stop = key === 'draw:197' && f > 15;
    if (on && this.chargeShot && drawn && !stop){ if (!hold) this.ask(4, ROWS.chargeShot, ROWS.chargeShot.key, false); }
    else if (this.held.has(4)) this.release(4, 3);
  }
  // the viewer's camera as the game's current one: its eye in game units and the direction it looks
  placeOverlay(q){
    const cam = this.camera, shell = this.shell;
    if (!cam || !shell) return false;
    cam.updateWorldMatrix(true, false);
    const p = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld), d = cam.getWorldDirection(new THREE.Vector3());
    return shell.toCamera(q, [p.x / MT_TO_VIEW, p.y / MT_TO_VIEW, p.z / MT_TO_VIEW], [d.x, d.y, d.z], OVERLAY_SCALE);
  }
  stats(){
    const held = {};
    for (const [k, x] of this.held) held[k] = { key: x.key, on: x.host === this ? 'gun' : x.host === this.hunter ? 'player' : 'shell',
                                                running: running(x), shown: x.q && x.q.m && x.q.core ? x.q.m.u8(x.q.core + 0x1c1) : null };
    return Object.assign(super.stats(), { unit: !!this.unitRoot, chargeShot: this.chargeShot, level: this.level, aiming: this.aiming,
      ready: this.ready, held, stance: this.stance && this.stance.key });
  }
}
