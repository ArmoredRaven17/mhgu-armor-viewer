// THE GUNLANCE'S EFFECTS: what uPlayerQuest09's code, its effect holder and its shelling shell ask for, and when.
//
// Raven, 2026-10-01: "next weapon" (after the Hammer). Read from the ROM (build/notes/gunlance-effects.md; efx/player/w09).
// Every address is exefs/main. The class's motion schedule (docs/effects/w09.json clips) runs on the hunter host like every
// class's; this module is the holder's rows on the gunlance and the shelling shells.
//
// THE CLASS: uPlayerQuest09, vtable 0x17470b0, own code 0x11a6828..0x11ae618; the action switch (vtable +0x324 =
// 0x11a7708, table 0x11a7728, 163 cases: `mov r1, #sub; b start`). Acts 111..162 are the VALOR STATE's (vtable +0x2f8 =
// 0x11adf64 tests the Valor style and status hi 0x40000 for them).
// THE SHELLING: 0x11ad37c(kind, sub) queues a shell whose row is a table by (kind, sub) and the SHELLING TYPE (player
// parameter 27 = weapon09BaseData +18: 0 Normal, 1 Wide, 2 Long; render/weapons-index.js shellFor); the update (vtable
// +0x28 = 0x11a688c) creates it as uShellPlw09_000 (id 0x30; init 0x475fa0), which stands at the PLAYER'S POSITION (its
// row's offset reference has no vector: the fallback zero, 0x1728004) with the player's angles and requests SPEC 0 of its
// row: 503 / 504 / 505 (w09_500..502.efl) by the type for the plain shells (rows 0..5, 33..38), 603 / 604 / 605
// (w09_550..552) for kind 3 (rows 15..17, 24..26, 39..41: the Valor State's shelling and Blast Dash's), 550 (w09_506) for
// the Wyvern's Fire blast (0x11ad6a4: rows 9..14, 21..23, 30..32). Kind 2's rows (6..8, 27..29: Full Burst, AA Flare)
// are EMPTY. Each shelling motion fires once at its start: Motion[101] / [102] / [103] (acts 5..11, 32, 34, 36, 43, 56,
// 128, 146, 159..161; the Valor State's 111..119, 123, 125, 129, 133, 134, 147), Motion[153] (Blast Dash's dashes),
// Motion[108] (the Wyvern's Fire blast, acts 86 / 106 / 109).
// THE HOLDER uShellPlEffectW09 (vtable 0x1756f80): its rows on the GUNLANCE unit (+0x23a0, its vtable +0x130 handle), at
// an offset from the gun model's plweplist mSubParam (0x13f404(mgr, 9, model, k) -> the class's tables, filled at
// start-up: read from the e2e snapshot): k 0 the MUZZLE (0x1888cf0), k 2 the muzzle flash's (0x18890b0), k 1 the hook's
// joint and offset (0x1888d70, 32-byte rows: +0 the root joint, +0x10 the offset).
//   * row 0 = 510 (w09_510.efl): the CHARGED SHELL's charge (0x11aa400: acts 31 / 33 / 35 / 37, Motion[132] / [133] /
//     [134]) at motion frame 25, slot 0, flag 1, at the muzzle; the policy (code 0) keeps it through those acts.
//   * row 1 = 511 (w09_510): WYVERN'S FIRE's flame (0x11a939c: acts 17 / 42 ..., Motion[107] / [135]) at motion frame 40,
//     slot 0, flag 1, at the muzzle (row 11 = 611 for acts 104 / 105); kept (code 1) through Motion[107], [118] (the hold),
//     [135] and Arts Motion[152]; DRAGON BLAST's charge (acts 98..100, Arts Motion[152]) asks it at its start.
//   * row 7 = 801 (cm122_093): DRAGON BREATH (acts 77..79, Arts Motion[101]) at its start (vtable +0x3a0, slot 2), at
//     the muzzle; kept (code 7) through the Art. At motion frame 205 it sets its timer +0x3370 and the overheat timer
//     +0x3328 (float 5 + level: 60 / 120 / 180 s), fills the heat and fires row 6 = 802 (cm122_094) at the muzzle flash's
//     offset.
//   * THE HOOK (0x45524c), every frame: while status hi 0x1000 stands (+0x3328 > 0: OVERHEAT -- the Heat Gauge at its cap,
//     60 s; the Wyvern's Fire blast's cooldown, float 0 x 60 = 7200 frames, 90 s with a skill; Dragon Breath), the
//     gunlance drawn and present, it asks slot 1 = row 2 = 520 (w09_511.efl), flag 0, at the hook table's joint and
//     offset; the policy (code 2) ends it when the hook stops asking.
//   * row 8 = cm002_002 206 (cm002_007): the base sharpening (weapon type 9) at Motion[255] frame 274.
// THE GUNLANCE'S OWN STATE (part kind 12, 0x311f68): weapon clips on its animation layers -- 0xf0 on Motion[118], 0xee
// while overheated, else 0xef (bone 2:2 turning) -- the viewer has no weapon animation layers (not wired).
// IN THE VIEWER the overheat is the user's switch, or the Wyvern's Fire blast's cooldown (from Motion[108], counted on
// the animation's clock), or Dragon Breath (its switch, or its stance's frame 205, which runs the timer at the Art's
// level III: 180 s; the Art's level is no control of the page's). The Valor State is the shared
// switch (the Valor style's moves: the shelling's 603..605). The Heat Gauge's level is not modelled (no row reads it).
// NOT WIRED: Arts Motion[151] (AA Flare's acts 95..97 and acts 135..137's second motion share it: 900 / 901, 650, the
// muzzle flashes 521 / 522 / 523, Dragon Blast's 550 at its start); the muzzle flash rows of the other moves (0x11ada70's
// eight callers); the guard's 650 (Valor State acts 138..145); rows 611 / 650 elsewhere; the Heat Gauge.

import * as THREE from 'three';
import { WeaponEffects } from './weapon-fx.js';
import { gidBonesOf } from './skeleton.js';

export const ROWS = {
  charged: { key: 510, efl: 'w09_510' },          // row 0
  flame: { key: 511, efl: 'w09_510' },            // row 1
  overheat: { key: 520, efl: 'w09_511' },         // row 2
  breathStart: { key: 801, efl: 'cm122_093' },    // row 7
  breathFire: { key: 802, efl: 'cm122_094' },     // row 6
  sharpen: { key: 206, efl: 'cm002_007' },        // row 8 (cm002_002)
};
// the shelling shell's spec-0 records by the shelling type (0 Normal, 1 Wide, 2 Long)
export const SHELLS = {
  plain: [{ key: 503, efl: 'w09_500' }, { key: 504, efl: 'w09_501' }, { key: 505, efl: 'w09_502' }],
  kind3: [{ key: 603, efl: 'w09_550' }, { key: 604, efl: 'w09_551' }, { key: 605, efl: 'w09_552' }],
  blast: { key: 550, efl: 'w09_506' },
};
// the class's tables by the gun model's mSubParam (read from the e2e snapshot C:/MHGU-Extract/efx/e2e/unit02406k160,
// game units in the gun's frame)
const MUZZLE = [[0, 0, 203], [0, 5, 170], [0, 0, 244], [0, 0, 160], [7, -3, 163], [0, 0, 110], [0, 0, 173], [0, 0, 173]];  // k 0
const FLASH = [[0, 0, 107], [0, 0, 75], [0, 0, 134], [7, -5, 73]];                                                       // k 2
const HOOK = [[0, 0, 0.5, 50], [0, 0, 0, 93], [1, 4, 25.8, 50.5], [1, 4.3, 26.3, 41.3], [1, 0, 32, 64.5], [1, 0, 30.5, 29.5],
  [1, 10.5, 26, 55], [1, 7, 31, 18], [1, 0, 32, 79], [1, 0, 29, 121], [1, 7, 25, 4], [1, 9, 26, 124], [1, 0, 25, -35],
  [1, 0, 26, 49], [3, 0, 0, 75], [0, 7, 33, 27], [0, 0, 0, 25], [1, 0, 14, 0], [1, 23, 33, 32], [1, 0, 21, 35],
  [1, 0, 33, 56], [0, 0, 0, 55], [1, 0, 14, 140], [1, 0, 64, 37], [1, 0, 25, 20], [1, 5, 24, 33]];               // k 1

// The player's requests by stance that no policy of the holder's watches (render/weapon-fx.js PlayerRequests)
export const PLAYER_REQUESTS = {
  'draw:255': [{ at: 274, key: ROWS.sharpen.key, efl: ROWS.sharpen.efl }],      // the sharpening (weapon type 9)
};
// the holder's rows asked by stance on the gunlance: slot, row, motion frame, the table its offset comes from
const STANCE_ROWS = {
  'draw:132': [{ at: 25, slot: 0, row: ROWS.charged, k: 0 }],     // act 31
  'draw:133': [{ at: 25, slot: 0, row: ROWS.charged, k: 0 }],     // act 33
  'draw:134': [{ at: 25, slot: 0, row: ROWS.charged, k: 0 }],     // acts 35 / 37
  'draw:107': [{ at: 40, slot: 0, row: ROWS.flame, k: 0 }],       // acts 17 / 107 ... (Wyvern's Fire's wind-up)
  'draw:135': [{ at: 40, slot: 0, row: ROWS.flame, k: 0 }],       // act 42 ...
  'sa:152': [{ at: 0, slot: 0, row: ROWS.flame, k: 0 }],          // acts 98..100 (Dragon Blast's charge)
  'sa:101': [{ at: 0, slot: 2, row: ROWS.breathStart, k: 0 }],    // acts 77..79 (Dragon Breath)
};
// the policy: the stances that keep a slot's row (codes 0 / 1 / 7); anything else stops it at once (3)
const KEEP = { 510: new Set(['draw:132', 'draw:133', 'draw:134']),
               511: new Set(['draw:107', 'draw:118', 'draw:135', 'sa:152']),
               801: new Set(['sa:101']) };
const SHELLING = new Set(['draw:101', 'draw:102', 'draw:103']);
const DASH = 'draw:153', BLAST = 'draw:108', BREATH = 'sa:101', BREATH_FRAME = 205;
const COOLDOWN = 7200;          // the blast's overheat: float 0 (120) x 60 frames (0x11ad848)
const BREATH_TIME = 10800;      // Dragon Breath's +0x3328 / +0x3370: float 5 + level, at the Art's level III
const MT_TO_VIEW = 0.01;

function stanceKey(stance){
  const m = /Motion\[(\d+)\]/.exec((stance && stance.clip) || '');
  return m ? (/_sa\./.test(stance.file || '') ? 'sa:' : 'draw:') + (+m[1]) : null;
}
const running = x => !(x.q.finished && x.q.finished());
function stopOn(host, x, answer){
  const sc = host && host.live && host.live.schedule;
  if (!x || !sc || x.live !== host.live) return;
  try {
    if (answer === 3) sc.host.killRequest(x.q);
    else if (!x.q.stopped) sc.host.stopRequest(x.q);
  } catch (_) {}
}

// THE GUNLANCE: a weapon-unit host on the gun's bones (its own joint table, for the hook's root joint), keeping the
// holder's slots; the shelling shells go to `hunter` (the page's hunter host)
export class GunlanceEffects extends WeaponEffects {
  constructor(){
    super();
    this.unitRoot = null; this.lastSync = null;
    this.held = new Map();        // holder slot -> { q, key, host, live }
    this.overheat = false;        // the Overheat switch (status hi 0x1000)
    this.breath = false;          // Dragon Breath active (status lo 0x1000, and its overheat timer)
    this.valor = false;           // the Valor State (the shared switch)
    this.cool = 0;                // the blast's cooldown left (frames)
    this.status = false;          // status hi 0x1000 this frame
    this.sub = [0, 0, 0, 0];      // the gun model's mSubParam
    this.shellType = 0;           // player parameter 27
    this.stance = null;           // { key, f }
    this.fired = [];              // the last shells fired (for the harness)
    this.hunter = null;
  }
  makeHost(roots){
    const part = roots && roots[0];
    const host = new THREE.Group();
    host.name = 'gunlance-fx-host';
    let bones = part ? gidBonesOf(part) : [];
    if (!bones.length && part) bones = [{ gid: 0, node: part.userData.bone || part, d: 0 }];
    host.userData.gidBones = bones;
    host.userData.joints = [];
    return host;
  }
  useDef(def){
    const keys = new Set([ROWS.charged.key, ROWS.flame.key, ROWS.overheat.key, ROWS.breathStart.key, ROWS.breathFire.key]);
    return Object.assign({}, def, { clips: {}, parentOrder: 0x30000, unitFromOrigin: true,
      effects: (def.effects || []).filter(e => e.when === 'state' && e.record && e.record.array === 'UNIQUE' && keys.has(e.record.key) &&
                                                e.record.pel === (e.record.key >= 800 ? 'w09_800' : 'w09_000') && !this.refused.has(e.record.key))
                                  .map(e => Object.assign({}, e, { joints: [0] })) });
  }
  async sync(cls, roots, parent){
    const part = (roots && roots[0]) || null;
    if (cls !== 'w09' || !part || !this.on){ if (this.live || this.unitRoot) this.detach(); this.unitRoot = null; this.lastSync = null; return null; }
    this.lastSync = { cls, roots: [part], parent };
    if (this.cls === cls && this.live && this.unitRoot === part) return this.live;
    this.unitRoot = part;
    return this.attach(cls, [part], parent);
  }
  detach(){ for (const s of [...this.held.keys()]) this.release(s, 3); super.detach(); }
  alive(x){ return !!x.host && x.live === x.host.live && running(x); }
  release(slot, answer){ const x = this.held.get(slot); this.held.delete(slot); if (x) stopOn(x.host, x, answer); }
  setOverheat(on){ this.overheat = !!on; return this.overheat; }
  setBreath(on){ this.breath = !!on; return this.breath; }
  setValor(on){ this.valor = !!on; return this.valor; }
  setModel(sub, shell){ this.sub = sub || [0, 0, 0, 0]; this.shellType = shell && shell.type != null ? shell.type : 0; }
  offsetOf(k){
    const t = k === 2 ? FLASH : MUZZLE, r = t[this.sub[k] | 0] || t[0];
    return [r[0], r[1], r[2]];
  }
  // 0x281ffc -> 0x44c164: flag 1 stops the slot's occupant at once and asks the row
  ask(slot, row, flag, requester){
    const x = this.held.get(slot);
    if (x && this.alive(x) && !flag) return x;
    if (x) this.release(slot, 3);
    if (!this.live || this.refused.has(row.key)) return null;
    this.lastRequested = row.key;
    const q = this.startState(row.key, row.efl, requester);
    if (!q) return null;
    const y = { q, key: row.key, host: this, live: this.live };
    this.held.set(slot, y);
    return y;
  }
  // a shelling shell (uShellPlw09_000's init): spec 0 of its row on the hunter host at the player's position (the
  // soles) with the player's angles -- the row's own offset is the zero fallback
  shell(rec){
    const h = this.hunter;
    if (!h || !h.live || !h.live.unitMatrix || h.refused.has(rec.key)) return null;
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    h.live.unitMatrix(m).decompose(p, q, sc);
    const ground = h.floor ? h.floor() : p.y;
    const requester = { position: [p.x / MT_TO_VIEW, ground / MT_TO_VIEW, p.z / MT_TO_VIEW], scale: [1, 1, 1], type8: 3 };
    const r = h.startState(rec.key, rec.efl, requester);
    if (r){ this.fired.push(rec.key); if (this.fired.length > 12) this.fired.shift(); }
    return r;
  }
  // every frame: `cls` the class in the hand (null otherwise), `stance` / `time` the weapon stance, `advance` the seconds of
  // animation since the last frame, `drawn` the rig's fact
  step(cls, stance, time, advance, drawn){
    if (this.live && this.live.failed){
      if (this.lastRequested != null) this.refused.add(this.lastRequested);
      console.warn('gunlance: record ' + this.lastRequested + ' refused, dropped for this session');
      this.detach(); this.unitRoot = null;
      if (this.lastSync) this.sync(this.lastSync.cls, this.lastSync.roots, this.lastSync.parent);
      return;
    }
    for (const [s, x] of this.held) if (!this.alive(x)) this.held.delete(s);
    const on = cls === 'w09';
    if (!on){ this.cool = 0; this.stance = null; this.status = false; }
    if (this.live) this.stepClip(null, time, advance);
    const key = on && drawn && stance ? stanceKey(stance) : null;
    const f0 = key ? Math.round((stance.t0 || 0) * 60) : 0;
    const f = key ? f0 + Math.round((time || 0) * 60 * 1000) / 1000 : 0;
    const prev = this.stance;
    const entered = !(prev && prev.key === key && f >= prev.f);
    const wrapped = entered && !!prev && prev.key === key && (advance || 0) > 0;
    const from = !entered ? prev.f : wrapped ? f0 - 1e-6 : -1;
    this.stance = key ? { key, f } : null;
    const crossed = at => from < at && f >= at;
    // the cooldown runs on the animation's clock
    if (this.cool > 0) this.cool = Math.max(0, this.cool - (advance || 0) * 60);
    // THE POLICY: a slot's row stops at once outside the stances that keep it
    for (const [s, x] of [...this.held]) if (KEEP[x.key] && !KEEP[x.key].has(key)) this.release(s, 3);
    // THE HOLDER'S ROWS by stance, on the gunlance at their table's offset
    for (const r of STANCE_ROWS[key] || []) if (crossed(r.at)) this.ask(r.slot, r.row, true, { offset: this.offsetOf(r.k) });
    if (key === BREATH && crossed(BREATH_FRAME) && this.live && !this.refused.has(ROWS.breathFire.key)){
      this.lastRequested = ROWS.breathFire.key;
      this.startState(ROWS.breathFire.key, ROWS.breathFire.efl, { offset: this.offsetOf(2) });
      this.cool = Math.max(this.cool, BREATH_TIME);     // the overheat timer runs on after the Art
    }
    // THE SHELLS (fire and forget on the hunter host)
    const type = this.shellType | 0;
    if (on && key && crossed(0)){
      if (SHELLING.has(key)) this.shell((this.valor ? SHELLS.kind3 : SHELLS.plain)[type] || SHELLS.plain[0]);
      else if (key === DASH) this.shell(SHELLS.kind3[type] || SHELLS.kind3[0]);
      else if (key === BLAST){ this.shell(SHELLS.blast); this.cool = COOLDOWN; }
    }
    // THE HOOK: status hi 0x1000 (the switch, the cooldown, Dragon Breath), the gunlance drawn
    this.status = on && (this.overheat || this.cool > 0 || this.breath || (key === BREATH && f >= BREATH_FRAME));
    if (this.status && drawn){
      const h = HOOK[this.sub[1] | 0] || HOOK[0];
      this.ask(1, ROWS.overheat, false, { rootJoint: h[0], offset: [h[1], h[2], h[3]] });
    } else if (this.held.has(1)) this.release(1, 3);
  }
  stats(){
    const held = {};
    for (const [k, x] of this.held) held[k] = { key: x.key, running: running(x),
                                                shown: x.q && x.q.m && x.q.core ? x.q.m.u8(x.q.core + 0x1c1) : null };
    return Object.assign(super.stats(), { unit: !!this.unitRoot, overheat: this.overheat, breath: this.breath,
      valor: this.valor, cool: Math.round(this.cool), status: this.status, sub: this.sub, shellType: this.shellType,
      fired: this.fired.slice(), held, stance: this.stance && this.stance.key });
  }
}
