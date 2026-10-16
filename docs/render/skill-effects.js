// THE SKILL EFFECTS: Peak Performance, Challenger, Latent Power and Trump Card (read 2026-10-14, wired 2026-10-15;
// build/notes/skill-effects.md). Raven: "Can you look into Player Effects such as Challenger, Peak Performance and Trump
// card's effects", then "Hunter Tab" for the switches.
//
// WHO: uShellPlEffectCom, the hunter's COMMON effect holder (vtable 0x1755c00), not a weapon class's: its hook 0x44c5f4
// runs 0x44de3c every frame, which tests the player's state word (+0x2840 lo / +0x2844 hi, vt+0x1b0) for skill k:
//   1 Peak Performance  lo 0x8000000   (HP full and Challenger not up; Fleet Feet raises it too)
//   2 Challenger        lo 0x4000000   (a large monster in the area enraged for 180 units)
//   3 Latent Power      lo 0x2000000   (its timer running, and neither of the two above)
//   4 Trump Card        hi 0x1000      (its window running)
// The viewer has no monster, HP or window, so each state is the user's switch (Hunter panel). The ROM's own exclusions
// (Peak Performance not while Challenger, Latent Power not while either) are applied to the switches here, since they
// decide the state bits the holder reads.
//
// WHAT IT ASKS (0x44eb9c and 0x44e4ec), every frame, in this order:
//   1. for each k: its bit up, and k neither shown (+0x16cc) nor pending (+0x16c8): if NOTHING is pending or shown the
//      delay (+0x16c0) is set to 45 units; the FLASH row is asked untracked (vt+0x150, flag 1); k becomes pending.
//      Its bit down: k stops being shown (bfc +0x16cc).
//   2. the delay steps (0x539d5c answers 1 every frame once it is at 0): at 0, every pending k becomes shown.
//   3. the pulse timer (+0x16c4) steps: at 0 with any k shown, the next shown k after the last (+0x16d0, cycling 0..4)
//      is asked in slot 17 (vt+0x154, flag 1: the slot's last request is killed, 0x329c40(core, 1)) and the timer is
//      set to 60 units.
// The rows are effect_com 115..122: cm100_010 flash 530..533 / pulse 610..613, all effect/cm/cm010_000.efl (each record
// builds its own rows of it, payload +0x48). The block: on the PLAYER, ROOT JOINT (block +0x52) 8, or 12 when the
// weapon type is 4 / 5 / 6 / 10 (0x27c324(player, 1): the gunners).
// Units: 1/60 s (sMain mFps 60); the clock is the effects' clock (the animation's, so they pause with it).

export const EFL = 'cm010_000';
export const SKILLS = [
  null,                                                    // k 0: in the holder's switch, asked by nothing here
  { id: 'peak', flash: 530, pulse: 610 },                  // rows 115 / 116
  { id: 'challenger', flash: 531, pulse: 611 },            // rows 117 / 118
  { id: 'latent', flash: 532, pulse: 612 },                // rows 119 / 120
  { id: 'trump', flash: 533, pulse: 613 },                 // rows 121 / 122
];
const DELAY = 45;       // 0x44e6c8
const PERIOD = 60;      // 0x44e5a0: 0x42700000
const GUNNERS = new Set(['w04', 'w06', 'w10']);          // weapon types 4 / 6 / 10 (5 is no class)
export const JOINTS = [8, 12];
// { record key: [joints] } for the hunter host's parent (WeaponEffects.useDef requestJoints)
export const REQUEST_JOINTS = Object.fromEntries(SKILLS.filter(Boolean).flatMap(s => [[s.flash, JOINTS], [s.pulse, JOINTS]]));

export class SkillEffects {
  constructor(){
    this.hunter = null;            // the hunter host (WeaponEffects on docs/effects/co.json)
    this.cls = null;               // the weapon class in the hand: picks the joint
    this.want = { peak: false, challenger: false, latent: false, trump: false };   // the switches
    this.pending = 0; this.shown = 0;   // +0x16c8 / +0x16cc, bit k
    this.delay = 0; this.pulse = 0;     // +0x16c0 / +0x16c4
    this.last = 0;                       // +0x16d0
    this.slot = null;                    // slot 17's request: { q, host, live }
    this.asked = [];                     // the keys asked, newest last (the harness)
    this.wall = null;
  }
  set(id, on){ if (id in this.want) this.want[id] = !!on; return this.want[id]; }
  // the state bits the switches stand for, with the state builder's exclusions (0x29ed48, 0x29ed8c)
  bits(){
    const w = this.want;
    const challenger = w.challenger, peak = w.peak && !challenger, latent = w.latent && !challenger && !peak;
    return [false, peak, challenger, latent, w.trump];
  }
  joint(){ return GUNNERS.has(this.cls) ? 12 : 8; }
  ask(key){
    const h = this.hunter;
    if (!h || !h.live || h.refused.has(key)) return null;
    const q = h.startState(key, EFL, { rootJoint: this.joint() });
    if (q){ this.asked.push(key); if (this.asked.length > 16) this.asked.shift(); }
    return q;
  }
  askSlot(key){
    const x = this.slot, h = this.hunter;
    this.slot = null;
    if (x && x.live === (h && h.live)){ try { x.live.schedule.host.killRequest(x.q); } catch (_) {} }
    const q = this.ask(key);
    if (q) this.slot = { q, host: h, live: h.live };
  }
  // every frame: `advance` the effects' clock in seconds, null for a still pose (the wall clock then)
  step(advance){
    const now = performance.now() / 1000;
    const dt = advance != null ? advance : (this.wall != null ? Math.min(now - this.wall, 0.25) : 0);
    this.wall = now;
    const u = dt * 60;
    const on = this.bits();
    for (let k = 1; k <= 4; k++){
      const b = 1 << k;
      if (!on[k]){ this.shown &= ~b; continue; }
      if (this.shown & b) continue;
      if (!((this.pending | this.shown) & 0x1f)) this.delay = DELAY;
      if (this.pending & b) continue;
      this.ask(SKILLS[k].flash);
      this.pending |= b;
    }
    if (tick(this, 'delay', u) && this.pending){ this.shown |= this.pending; this.pending = 0; }
    if (tick(this, 'pulse', u) && this.shown){
      let k = this.last;
      for (let n = 0; n < 5; n++){
        k = k + 1 > 4 ? 0 : k + 1;
        if (this.shown & (1 << k)) break;
      }
      this.last = k; this.pulse = PERIOD;
      if (SKILLS[k]) this.askSlot(SKILLS[k].pulse);
    }
  }
  // the hunter host went away (another figure, a rebuild): nothing it held is ours any more
  detach(){ this.slot = null; this.pending = 0; this.shown = 0; this.delay = 0; this.pulse = 0; this.wall = null; }
  stats(){ return { want: Object.assign({}, this.want), pending: this.pending, shown: this.shown, delay: this.delay,
                    pulse: this.pulse, last: this.last, joint: this.joint(), asked: this.asked.slice() }; }
}
// 0x539d5c: at or below 0 it answers 1 (and stays 0); else it steps down and answers 1 when it reaches 0
function tick(o, f, u){
  if (o[f] <= 0){ o[f] = 0; return true; }
  o[f] -= u;
  if (o[f] <= 0){ o[f] = 0; return true; }
  return false;
}
