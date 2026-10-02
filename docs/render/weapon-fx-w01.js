// THE SWORD & SHIELD'S EFFECTS: what uPlayerQuest01's code asks its effect holder for, and when.
//
// Raven, 2026-09-29: "Do SnS next". Read from the ROM the way the Switch Axe was (build/notes/weapon-effects-guide.md;
// the class's notes: build/notes/sword-and-shield-effects.md). Every address is exefs/main. The class's own motion
// schedule (docs/effects/w01.json clips) runs on the hunter host like every class's (render/weapon-fx.js
// WeaponEffects); this module is the part the schedule does not cover: the class's holder requests.
//
// THE CLASS: uPlayerQuest01, vtable 0x17432f4, own code 0x1165d54..0x116b62c; the action switch (vtable +0x324,
// 0x11668b4) has 69 actions whose cases hold their code inline or branch to a start function. Three functions make
// holder requests, and only three (the calls of 0x40a54 / 0x281ffc and the reads of vtable +0x39c in the range):
//   * 0x116852c, act 25 alone (case 0x1166c9c), Motion[110] (5110, table 0x181d328): at the start (phase 0) 0x281ffc(self,
//     slot 0, code 1, block, 1); at MOTION FRAME 50 (phase 1, 0x2804ec with 50.0 at 0x11687c8) 0x281ffc(self, slot 0,
//     code 3, block, 1). The block: the PLAYER's own handle (vtable +0x130) and the ROOT JOINT 1 (+0x52, mask +0x14
//     bit 5); both skipped when vtable +0x168 answers 3. Past motion frame 88 (0x28071c) the action goes on to 28 or 26
//     (0x282ab0, by 0x27eff8(self, 0x10000)); until then Motion[110] plays its start and then loops.
//   * 0x11687d4, acts 26 (sub 0) and 28 (sub 1), Motion[112] (5112, table 0x181d340) FROM FRAME 0: at the start, vtable
//     +0x39c(self, code 4, block, 1), the same block (the player, root joint 1): fire and forget. The other actions that
//     play Motion[112] enter it at frame 44 or 50 (0x281268 at 0x1167bcc / 0x1167c58 / 0x1169258 / 0x11692a4: acts 16,
//     22, 50 and 34, 35, 48) and ask nothing, so the stance from its top is acts 26/28's.
//   * 0x116ad48, the class's vtable +0x794 (base 0x2e04dc): the base's common action 194 calls it with sub 4
//     (0x2cc8fc -> 0x2ccf38), and for sub 4 the class plays its own Motion[114] (0x281268 with 5114 at 0x116addc) and
//     asks vtable +0x39c(self, code 2, self+0x2550, 1): the player's own block, no overrides. Subs 0..3, 5, 6 go to
//     the base. Nothing else plays Motion[114] (no table of the class or the base holds 5114).
// And the base player asks one for every class: the sharpening (0x2d5e74, Motion[255]) at motion frame 274 asks the
// code its jump table gives the weapon type (0x2d61f0): type 1 -> code 0.
//
// THE HOLDER, uShellPlEffectW01 (vtable 0x1756380; shell/pl/w01.arc effect_w01, efx/player/plshells.py w01):
//   row 0 cm002_002 201 (cm002_007.efl) | 1 w01_000 500 | 2 cm001_000 405 (cm001_011.efl) | 3 w01_000 501 |
//   4 w01_000 505 (500 / 501 / 505: cm001_500.efl, row masks 1 / 2 / 0x800) | 5..7 w01_800 1100..1102 (cm123_013.efl).
// ITS STOP POLICY (vtable +0x160 = 0x452c68) for the tracked slots: codes 1 and 3 are kept while the action is 25
// (+0x2506 == 0x10 and +0x250a == 25), then code 1 answers 2 (the effect ends on its own) and code 3 answers 3 (at
// once); codes 5..7 are kept while the status high word's 0xe stands (below). Fire-and-forget codes have no slot and no
// policy.
import * as THREE from 'three';
import { WeaponEffects } from './weapon-fx.js';

// The player's requests by stance (render/weapon-fx.js PlayerRequests runs them on the hunter host).
export const PLAYER_REQUESTS = {
  // act 25: row 1 from the start, row 3 at frame 50 in its place (flag 1: the slot's effect stopped at once first);
  // both live while the action is 25 -- Motion[110], its start and its loop -- and end by the policy's answers
  'draw:110': [
    { at: 0, key: 500, efl: 'cm001_500', requester: { rootJoint: 1 }, slot: 0, stop: 2 },
    { at: 50, key: 501, efl: 'cm001_500', requester: { rootJoint: 1 }, slot: 0, stop: 3 },
  ],
  'draw:112': [{ at: 0, key: 505, efl: 'cm001_500', requester: { rootJoint: 1 } }],   // acts 26 / 28
  'draw:114': [{ at: 0, key: 405, efl: 'cm001_011' }],                                 // common action 194, sub 4
  'draw:255': [{ at: 274, key: 201, efl: 'cm002_007' }],                               // the sharpening, type 1 -> row 0
};

// CHAOS OIL (the name from eng/table/hunterArtsData_eng.gmd, tied by mechanics: the class's one Art with a lasting state,
// "coats your blade", tier II "Lasts longer than Tier I"). Acts 52 / 53 / 54 (subs 0 / 1 / 2, the Art's levels I..III)
// run 0x116a440 on Arts Motion[151] (7151, table 0x181d400); at MOTION FRAME 80 (0x116a62c), when 0x27b808 allows, they
// arm the state: +0x332c = 5 + level and +0x3334 = the level's duration (0x282140(self, 5 + level), x1.2 when
// 0x2a25f4(self, level + 0x20) answers 1). The state runner (vtable +0x4e8 = 0x116b310) counts +0x3334 down by 1.0 a
// frame, drawn or not, and zeroes +0x332c at the end; vtable +0x3e0 = 0x1165d74 raises status hi 2 / 4 / 8 (by
// +0x332c = 5 / 6 / 7) while +0x3334 > 0.
//   THE EFFECT IS THE HOLDER'S OWN: its per-frame hook (vtable +0x14c = 0x452b88) tests the player's status hi 0xe
// (vtable +0x1b8(player, 0, 0xe)); when it stands and the holder has not asked yet (byte +0x16a0), it builds a block on
// the WEAPON unit (player+0x23a0, part slot 7, its own vtable +0x130 handle; no root joint, no colour) and asks
// 0x281ffc(player, slot 1, code 5 + level, block, 0) -- level = +0x2764, 0..2 -> rows 5 / 6 / 7 = w01_800 1100 /
// 1101 / 1102 -- then marks +0x16a0. When the status drops, the byte clears and the policy (0x452c68) answers 2.
//   NOTHING TESTS THE WEAPON ON THE BACK: not the hook, not the policy, not the timer. The oil stays on the sword when it
// is sheathed, for as long as the state lasts; this host hangs from the sword part wherever the rig puts it.
//   The viewer has no timer, so the state is a control in the Weapon panel, the user's alone (the Art's stance does not
// set it). A level picked while the state stands is a new state here; in the game the holder keeps the first ask.
export const CHAOS_OIL = { keys: [1100, 1101, 1102], efl: 'cm123_013' };

// The sword unit's host: its one "bone", gid 0, is the part's bone 0 (render/weapon.js placePart), as the Switch Axe's
// weapon-unit host (render/weapon-fx.js WeaponUnitEffects), with a player part unit's angle order 0.
// The same host serves another class's held aura on its weapon unit (`opts`: the class, the rows by level, a name): the
// Hammer's Impact Press (render/weapon-fx-w02.js), whose holder hangs it from the hammer unit the same way.
export class ChaosOilEffects extends WeaponEffects {
  constructor(opts){
    super();
    this.opts = Object.assign({ cls: 'w01', rows: CHAOS_OIL, name: 'chaos oil' }, opts || {});
    this.unitRoot = null;
    this.level = 0;               // 0 off, 1..3 the Art's level (the state's +0x332c - 4)
    this.held = null;             // the holder's slot 1: { q, key, live }
    this.lastSync = null;
  }
  makeHost(roots){
    const part = roots && roots[0];
    const node = part ? (part.userData.bone || part) : null;
    const host = new THREE.Group();
    host.name = this.opts.name.replace(/ /g, '-') + '-fx-host';
    host.userData.gidBones = node ? [{ gid: 0, node, d: 0 }] : [];
    host.userData.joints = [];
    return host;
  }
  // the records rows 5..7 name, each on joint 0 (the only bone); the unit is the sword's bone 0, rotation included --
  // these records sit on the unit itself (payload joint -1, space 0, no root-joint override: rom/effect/live.js
  // unitFromOrigin), where the Switch Axe's weapon records all ride joint 0's matrix through their requester's override
  useDef(def){
    const keys = new Set(this.opts.rows.keys);
    return Object.assign({}, def, { clips: {}, parentOrder: 0x30000, unitFromOrigin: true,
      effects: (def.effects || []).filter(e => e.when === 'state' && e.record && e.record.array === 'UNIQUE' && keys.has(e.record.key) &&
                                                !this.refused.has(e.record.key))
                                  .map(e => Object.assign({}, e, { joints: [0] })) });
  }
  // the sword part, drawn or on the back: re-attach when the part changes, not on every stance
  async sync(cls, roots, parent){
    const part = (roots && roots[0]) || null;
    if (cls !== this.opts.cls || !part || !this.on){ if (this.live || this.unitRoot) this.detach(); this.unitRoot = null; this.lastSync = null; return null; }
    this.lastSync = { cls, roots: [part], parent };
    if (this.cls === cls && this.live && this.unitRoot === part) return this.live;
    this.unitRoot = part;
    return this.attach(cls, [part], parent);
  }
  detach(){ this.held = null; super.detach(); }
  setLevel(level){
    level = Math.max(0, Math.min(3, level | 0));
    if (level === this.level) return this.level;
    this.level = level;
    this.releaseHeld();           // the policy's answer 2 when the state drops; a new level is a new state here
    this.stepHeld();
    return this.level;
  }
  releaseHeld(){
    const x = this.held, sc = this.live && this.live.schedule;
    this.held = null;
    if (!x || !sc || x.live !== this.live) return;
    try { if (!x.q.stopped) sc.host.stopRequest(x.q); } catch (_) {}
  }
  // the hook: ask the level's row once while the state stands (the byte +0x16a0 keeps it from asking again)
  stepHeld(){
    if (this.held && this.held.live !== this.live) this.held = null;   // gone with a rebuilt host
    if (!this.level || !this.live || this.held) return;
    const key = this.opts.rows.keys[Math.min(this.level, this.opts.rows.keys.length) - 1];
    if (this.refused.has(key)) return;
    this.lastRequested = key;
    const q = this.startState(key, this.opts.rows.efl, null);
    if (q) this.held = { q, key, live: this.live };
  }
  // every frame: the host's clock is the animation's, as every host's
  step(time, advance){
    if (this.live && this.live.failed){
      if (this.lastRequested != null) this.refused.add(this.lastRequested);
      console.warn(this.opts.name + ': record ' + this.lastRequested + ' refused, dropped for this session');
      this.detach(); this.unitRoot = null;
      if (this.lastSync) this.sync(this.lastSync.cls, this.lastSync.roots, this.lastSync.parent);
      return;
    }
    if (!this.live) return;
    this.stepClip(null, time, advance);
    this.stepHeld();
  }
  stats(){
    return Object.assign(super.stats(), { unit: !!this.unitRoot, level: this.level, held: this.held ? this.held.key : null,
                                          running: !!(this.held && !(this.held.q.finished && this.held.q.finished())) });
  }
}
