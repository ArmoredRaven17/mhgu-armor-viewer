// THE INSECT GLAIVE'S EFFECTS: the hunter-side rows uPlayerQuest13's code and its effect holder ask for -- FIRST PASS.
//
// Raven, 2026-10-02: "Move onto IG" (read 2026-10-01 and parked: most of what the class shows is the KINSECT's -- its
// flight, the extracts it brings back, its combo strikes -- and the viewer has no flying kinsect; this module is the
// rest). Read from the ROM (build/notes/insect-glaive-effects.md; efx/player/w13). Every address is exefs/main.
//
// THE CLASS: uPlayerQuest13, vtable 0x17493f0, own code 0x11c8360..0x11d0c54; the holder uShellPlEffectW13 (vtable
// 0x1757580). Rows on the GLAIVE unit (+0x23a0) take an offset by the glaive model's plweplist mSubParam
// (0x13f404(mgr, 13, model, k) -> the class's tables, filled at start-up, read from the e2e snapshot): k 0 the blade end
// (0x1889320), k 1 the other end (0x18893a0).
//   * THE EXTRACT CHARGE (the game's "Extract (Charge)": holding Kinsect: Harvest Extract charges it, a full charge a
//     Kinsect Spin Attack): the input handler (vtable +0x22c = 0x11c8bc4) adds a frame to +0x334c while the button is held
//     in acts 117 / 118 / 141 / 142 (Motion[102] / [115]) -- nothing in the Alchemy style -- and zeroes it outside them.
//     THE HOLDER'S HOOK (0x457930) every frame takes the state 0x11d08e4 = 0 none, 1 charging, 2 at 180 frames (126 with
//     skill 0xc) and, through 0x11d080c, asks slot 0 ROW 10 = w13_000 50 / ROW 11 = 51 (cm001_500.efl) on the glaive at the
//     k 1 offset, flag 1 when the state rose; the policy keeps it while the state stands.
//   * row 5 = 30 (w13_006, k 0) and row 6 = 31 (w13_007, k 1) at the start of Motion[104] (acts 41 / 106) and Motion[105]
//     (acts 43 / 107), with the kinsect's shell uShellPlw13_001 (0x11cf5a0, fire and forget); row 7 = 35 (w13_007, k 1) at
//     the start of Motion[112] (acts 11 / 98) and Motion[141] (acts 48 / 99).
//   * EXTRACT HUNTER (acts 114..116, Arts Motion[151], 0x11ced78): at its start slot 1 ROW 17 = w13_800 1103
//     (cm123_134) on the glaive (no offset); the catch (act 137, Arts Motion[152], 0x11cefc0) at motion frame 90 asks slot 1
//     ROW 18 = 1104 on the HUNTER; the policy keeps them through acts 114..116 and 137 and lets them end elsewhere.
//   * row 0 = cm002_002 209 (cm002_007): the base sharpening (weapon type 13) at Motion[255] frame 274.
// IN THE VIEWER Motion[102] and [115] play as the held versions (acts 117 / 118, the charge running on the stance's own
// clock, as the Bow's draw does); acts 1 / 16 play the same motions unheld.
// NOT WIRED: the kinsect (its flight, pl_w13_000 / 001 / 003, the extracts' colours), the Kinsect Combo Strikes (rows 15 / 16
// = 420 / 421, gated on the kinsect's resource +0x3340), rows 8 / 9 (20 / 21, after the kinsect's launch, per-sub
// motions), the cm100_010 rows, Swarm / Bug Blow / Bug Majeure's own sites, acts 141 / 142's motions.

import * as THREE from 'three';
import { WeaponEffects } from './weapon-fx.js';
import { gidBonesOf } from './skeleton.js';

export const ROWS = {
  charge: { key: 50, efl: 'cm001_500' },      // row 10
  full: { key: 51, efl: 'cm001_500' },        // row 11
  r30: { key: 30, efl: 'w13_006' },           // row 5
  r31: { key: 31, efl: 'w13_007' },           // row 6
  r35: { key: 35, efl: 'w13_007' },           // row 7
  hunt: { key: 1103, efl: 'cm123_134' },      // row 17
  catch: { key: 1104, efl: 'cm123_134' },     // row 18
  sharpen: { key: 209, efl: 'cm002_007' },    // row 0 (cm002_002)
};
export const PLAYER_REQUESTS = {
  'draw:255': [{ at: 274, key: ROWS.sharpen.key, efl: ROWS.sharpen.efl }],   // the sharpening (weapon type 13)
};
// the class's tables by the glaive model's mSubParam (game units in the glaive's frame; the e2e snapshot)
const BLADE = [[0, 0, 100], [0, 0, 142], [0, 0, 160], [0, 0, 190], [0, 0, 75], [0, -5, 45], [0, 0, 160], [-12, 13, 170]];  // k 0
const BUTT = [[0, 0, -155], [0, 0, -140], [0, 3, -130], [0, 0, -100], [0, 0, -120], [0, 0, -200], [5, -14, -70],
  [0, 0, 55], [0, 7, -140], [0, 0, -65], [0, 0, 150], [0, -20, -175], [24, -16, 0], [26, 0, -120]];                   // k 1
const CHARGE = new Set(['draw:102', 'draw:115']);    // acts 117 / 118, held
const FULL = 180;                                    // the full charge (126 with skill 0xc)
const FIRES = {
  'draw:104': [[ROWS.r30, 0], [ROWS.r31, 1]],        // acts 41 / 106
  'draw:105': [[ROWS.r30, 0], [ROWS.r31, 1]],        // acts 43 / 107
  'draw:112': [[ROWS.r35, 1]],                       // acts 11 / 98
  'draw:141': [[ROWS.r35, 1]],                       // acts 48 / 99
};
const HUNT = 'sa:151', CATCH = 'sa:152', CATCH_FRAME = 90;
const HUNT_KEEP = new Set([HUNT, CATCH]);
// asked by the ROM but NOT RECORDED YET: 1103 on the glaive refuses ("0xa727a8 falls into unrecorded code", 2026-10-02) and
// would take the glaive's host down for the session; held back until record + lift (the board)
const UNRECORDED = new Set([ROWS.hunt.key]);

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

// THE GLAIVE: a weapon-unit host on the glaive's bones keeping the holder's slots; `hunter` is the page's hunter host
export class InsectGlaiveEffects extends WeaponEffects {
  constructor(){
    super();
    this.unitRoot = null; this.lastSync = null;
    this.held = new Map();        // holder slot -> { q, key, host, live }
    this.sub = [0, 0, 0, 0];      // the glaive model's mSubParam
    this.timer = 0;               // the Extract Charge +0x334c (frames)
    this.state = 0;               // the hook's +0x16a0
    this.stance = null;
    this.fired = [];
    this.hunter = null;
  }
  makeHost(roots){
    const part = roots && roots[0];
    const host = new THREE.Group();
    host.name = 'insect-glaive-fx-host';
    let bones = part ? gidBonesOf(part) : [];
    if (!bones.length && part) bones = [{ gid: 0, node: part.userData.bone || part, d: 0 }];
    host.userData.gidBones = bones;
    host.userData.joints = [];
    return host;
  }
  useDef(def){
    const keys = new Set([ROWS.charge.key, ROWS.full.key, ROWS.r30.key, ROWS.r31.key, ROWS.r35.key, ROWS.hunt.key]);
    return Object.assign({}, def, { clips: {}, parentOrder: 0x30000, unitFromOrigin: true,
      effects: (def.effects || []).filter(e => e.when === 'state' && e.record && e.record.array === 'UNIQUE' && keys.has(e.record.key) &&
                                                e.record.pel === (e.record.key >= 800 ? 'w13_800' : 'w13_000') && !this.refused.has(e.record.key))
                                  .map(e => Object.assign({}, e, { joints: [0] })) });
  }
  async sync(cls, roots, parent){
    const part = (roots && roots[0]) || null;
    if (cls !== 'w13' || !part || !this.on){ if (this.live || this.unitRoot) this.detach(); this.unitRoot = null; this.lastSync = null; return null; }
    this.lastSync = { cls, roots: [part], parent };
    if (this.cls === cls && this.live && this.unitRoot === part) return this.live;
    this.unitRoot = part;
    return this.attach(cls, [part], parent);
  }
  detach(){ for (const s of [...this.held.keys()]) this.release(s, 3); this.timer = 0; this.state = 0; super.detach(); }
  alive(x){ return !!x.host && x.live === x.host.live && running(x); }
  release(slot, answer){ const x = this.held.get(slot); this.held.delete(slot); if (x) stopOn(x.host, x, answer); }
  setModel(sub){ this.sub = sub || [0, 0, 0, 0]; }
  offsetOf(k){ const t = k === 0 ? BLADE : BUTT, r = t[this.sub[k] | 0] || t[0]; return [r[0], r[1], r[2]]; }
  // 0x281ffc -> 0x44c164 on the glaive (this) or the hunter
  ask(slot, row, flag, requester, host = this){
    const x = this.held.get(slot);
    if (x && this.alive(x) && !flag) return x;
    if (x) this.release(slot, 3);
    if (!host || !host.live || host.refused.has(row.key)) return null;
    if (host === this) this.lastRequested = row.key;
    const q = host.startState(row.key, row.efl, requester);
    if (!q) return null;
    const y = { q, key: row.key, host, live: host.live };
    this.held.set(slot, y);
    return y;
  }
  fire(row, k){
    if (!this.live || this.refused.has(row.key)) return null;
    this.lastRequested = row.key;
    const q = this.startState(row.key, row.efl, { offset: this.offsetOf(k) });
    if (q){ this.fired.push(row.key); if (this.fired.length > 12) this.fired.shift(); }
    return q;
  }
  // every frame: `cls` the class in the hand (null otherwise), `stance` / `time` the weapon stance, `advance` the seconds of
  // animation since the last frame, `drawn` the rig's fact
  step(cls, stance, time, advance, drawn){
    if (this.live && this.live.failed){
      if (this.lastRequested != null) this.refused.add(this.lastRequested);
      console.warn('insect glaive: record ' + this.lastRequested + ' refused, dropped for this session');
      this.detach(); this.unitRoot = null;
      if (this.lastSync) this.sync(this.lastSync.cls, this.lastSync.roots, this.lastSync.parent);
      return;
    }
    for (const [s, x] of this.held) if (!this.alive(x)) this.held.delete(s);
    const on = cls === 'w13';
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
    // THE EXTRACT CHARGE: a frame a frame while held (the charging stances), zeroed outside them
    if (CHARGE.has(key)){
      if (entered && !wrapped && !(prev && CHARGE.has(prev.key))) this.timer = 0;
      this.timer += entered && !wrapped ? Math.max(0, f - f0) + 1 : Math.max(0, f - from);
    } else this.timer = 0;
    // THE HOOK: the state, asked again when it rose; the policy (codes 10 / 11) keeps it while it stands
    const st = this.timer > 0 ? (this.timer >= FULL ? 2 : 1) : 0;
    if (st > 0){
      const row = st === 2 ? ROWS.full : ROWS.charge;
      this.ask(0, row, st > this.state, { offset: this.offsetOf(1) });
    } else if (this.held.has(0)) this.release(0, 3);
    this.state = st;
    // the rows on the glaive at their motion's start
    if (key && crossed(0) && f0 === 0) for (const [row, k] of FIRES[key] || []) this.fire(row, k);
    // EXTRACT HUNTER: 1103 on the glaive at its start, 1104 on the hunter at the catch's frame 90; ended elsewhere
    if (key === HUNT && crossed(0) && !UNRECORDED.has(ROWS.hunt.key)) this.ask(1, ROWS.hunt, true, null);
    if (key === CATCH && crossed(CATCH_FRAME)) this.ask(1, ROWS.catch, true, null, this.hunter);
    const h = this.held.get(1);
    if (h && !HUNT_KEEP.has(key)) this.release(1, 2);
  }
  stats(){
    const held = {};
    for (const [k, x] of this.held) held[k] = { key: x.key, on: x.host === this ? 'glaive' : 'hunter', running: running(x),
                                                shown: x.q && x.q.m && x.q.core ? x.q.m.u8(x.q.core + 0x1c1) : null };
    return Object.assign(super.stats(), { unit: !!this.unitRoot, sub: this.sub, timer: Math.round(this.timer),
      state: this.state, fired: this.fired.slice(), held, stance: this.stance && this.stance.key });
  }
}
