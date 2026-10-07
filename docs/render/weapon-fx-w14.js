// THE CHARGE BLADE'S EFFECTS: what uPlayerQuest14's code and its effect holder ask for -- FIRST PASS.
//
// Raven, 2026-10-03: "Next weapon" (the last class). Read from the ROM (build/notes/charge-blade-effects.md; efx/player/w14).
// Every address is exefs/main. The class's motion schedule (docs/effects/w14.json clips) runs on the hunter host like every
// class's; this module is the code's requests and the shield's coat.
//
// THE CLASS: uPlayerQuest14, vtable 0x1749cc0, own code 0x11d0d34..0x11dd498; the action switch vtable +0x324 = 0x11d2a88
// (table 0x11d2ab4, 170 cases through tail-call heads). The holder uShellPlEffectW14 (vtable 0x1757700): its own update
// (slot +0x24 = 0x457e8c), the policy +0x160 = 0x457fd4. THE MODE word +0x3328 (vtable +0x84c sets it, +0x35c reads 1 =
// sword): every start function declares one (efx/player/w14/data/modes.json, by the motions each plays); the stances no
// action declares are the base player's, its picks by mode for type 14 the Switch Axe's pairs the other way round (the
// drawn idle Motion[1] sword / [20] axe).
//   * THE CHARGE GAUGE (the game's own name, HN_WeaponControlsMsg 301: "When the gauge is yellow or red, you can charge
//     the phials") is +0x2780 (vtable +0x478), filled by hits; its level is vtable +0x858 = 0x11dc73c: 3 above 71, 2 above
//     45, 1 above 29, else 0. The class's hook (vtable +0x690 = 0x11da328 -> 0x11da3f8) fires on a RISE, fire and forget on
//     the BLADE (+0x23a0) at root joint 0: level 1 row 1 = w14_000 620, level 2 row 2 = 621 (w14_006.efl). Level 3 is the
//     holder's: its update asks slot 0 ROW 3 = 622 (w14_003.efl) on the blade at root joint 0 once (byte +0x16a0) while
//     the level is 3 and the weapon is drawn in sword mode, or in the sharpening's Motion[255] frames [20, 324); the
//     policy (code 3) lets it end otherwise and clears the byte. The gauge is hit-driven: a select, as the Long Sword's
//     Spirit Gauge is. The gauge also colours the PHIALS on the weapon -- the sword part's channel-30 triggers, the rig's
//     (render/weapon-state.js cbPhialTriggers; weapon.setCbGauge).
//   * SHIELD CHARGE (HN_WeaponControlsMsg 301: "Performing an Elem Up Roundslash while you have more than one charged
//     phial will charge your shield"): the state +0x3344 (vtable +0x85c; set only through +0x860) = 1 YELLOW or 2 RED while
//     its timer +0x332c runs. The guard function 0x11d4da8 pends it by sub (each after spending phials): yellow from acts
//     79 / 104 (0x11d56a0, rows 14 / 17 = 631 / 636 on the shield), red from acts 57, 86..88, 91..94, 103, 105..107,
//     154..159; neither when it is red already. Those acts share the Motion[127] family, so the colour is the select's. Its look is a PART MATERIAL, as the Lance's Healing Shield's is: every frame the class's update (vtable
//     +0x24 -> 0x11d0df4) posts 0x2896d4(player, part, 4, mask 0x40000400, 1000) for the shield (part 1) and, in axe mode,
//     the blade too (part 0) -- index 4 = weapon/common/gaxe_sld_power_up_red.mrl (registered by the load hook +0x148 =
//     0x11d0f94), laid over every material outside colour channels 10 and 30; state 1 index 5 = gaxe_sld_time_up_yellow. Not with the shield on the back in a base
//     action. The user's switch, as every state the player brings is.
//   * VALOR STATE (the Shield Charge select's Valor (blue); "Shield Charge While In Valor State: As you enter Valor State, your shield will gain a
//     Valor element boost"): in the Valor style with status 0x40000 (the second word) the update arms +0x335c = the common
//     parameters' float 89 (60) + 60 frames, once; the state runner (+0x4e8 = 0x11da568) counts it down and at 0 fires row
//     19 = 640 (w14_007.efl) on the SHIELD (+0x23a4) at root joint 0 when drawn, and raises +0x3340 bit 6: the part
//     material index 6 = gaxe_sld_power_up_blue.mrl, as above. Leaving the state clears the bit.
//     IN THE PAGE the select's Valor (blue) is the state standing already: blue at once, nothing fired (Raven, 2026-10-04:
//     "We will need that for animations, but when manually selected bypass it"); the countdown and 640 stay for a stance
//     that begins Valor State, at the animation review.
//   * THE CHARGED SLASH (acts 10 / 52 / 53 / 56, 0x11d4928, sword mode): at its start slot 1 ROW 4 = 500 on the player's
//     block (cm001_500.efl, the player's joint 2); the hold is Motion[106] (acts 52 / 53 lead in with [112] / [113] and
//     enter it at frame 28, act 56 at frame 10); once a motion's end flag has risen (phase 2) slot 2 ROW 5 = 501
//     (cm001_502.efl, tracked, flag 1) when the motion crosses frame 40 (0x2804ec is a crossing test), and a timer past 90
//     frames releases it (act 51). Motion[106] loops from frame 50, so only the lead-ins' acts reach 501: played on its
//     own (act 10) the hold shows 500 alone. The policy keeps 500 through those acts and 501 through them and act 109
//     (Motion[111]); else 3.
//   * ROW 6 = 505 (cm001_500.efl) at the start of Motion[111] (acts 34 / 54 and, after their lead-in, 109 / 132), fire and
//     forget on the player's block.
//   * ARTS: act 84 (Arts Motion[51]) at frame 170 sets the Art's own state (0x11d278c by the level) and fires ROW 18 =
//     w14_800 800 (cm121_140.efl) on the SHIELD, the unit itself (root joint 0xffff). Act 102 (Arts Motion[151]) at frame
//     50 asks slot 3 ROW 20 + level = 900..902 (cm123_140.efl) and at frame 94 slot 4 ROW 23 + level = 910..912
//     (cm123_141.efl) on the shield; the policy keeps them below frames 179 / 164 of that motion, then lets them end. The
//     Art's level is no control of the page's: III.
//   * ROW 0 = cm002_002 210 (cm002_007.efl): the base sharpening at Motion[255] frame 274.
// NOT WIRED (first pass): the Ultra Element Discharge's burst (shell 0x43 = pl_w14_003, rows 540..567 by phial type,
//   element and the phial count +0x3354; 0x11db61c from acts 45 / 46 / 59 / 60 / 62 / 63 / 128..131 and 81 / 82) and row
//   7 = 570 at a placed point from the same acts; the Elem Up Roundslash's 630 / 635 on the shield (by phial type, when
//   charged phials are spent); the hit-made bursts (shell 0x42 = pl_w14_002 from the hit block); shell 0x41 (pl_w14_001)
//   every 20 frames while +0x3340 bit 2 stands (vtable +0x850 from +0x880); shell 0x44 row 1 (pl_w14_100, w14_800 811) in
//   the guard function; the Striker / Adept rows 650;
//   the remote player's Valor path.

import * as THREE from 'three';
import { WeaponEffects } from './weapon-fx.js';
import { gidBonesOf } from './skeleton.js';

export const ROWS = {
  rise1: { key: 620, efl: 'w14_006' },        // row 1
  rise2: { key: 621, efl: 'w14_006' },        // row 2
  red: { key: 622, efl: 'w14_003' },          // row 3: the gauge at level 3
  charge: { key: 500, efl: 'cm001_500' },     // row 4
  full: { key: 501, efl: 'cm001_502' },       // row 5
  r505: { key: 505, efl: 'cm001_500' },       // row 6
  valor: { key: 640, efl: 'w14_007' },        // row 19
  art51: { key: 800, efl: 'cm121_140' },      // row 18 (w14_800)
  art151a: { keys: [900, 901, 902], efl: 'cm123_140' },   // rows 20..22 (w14_800)
  art151b: { keys: [910, 911, 912], efl: 'cm123_141' },   // rows 23..25 (w14_800)
  sharpen: { key: 210, efl: 'cm002_007' },    // row 0 (cm002_002)
};
export const PLAYER_REQUESTS = {
  'draw:255': [{ at: 274, key: ROWS.sharpen.key, efl: ROWS.sharpen.efl }],   // the sharpening (weapon type 14)
  'draw:111': [{ at: 0, key: ROWS.r505.key, efl: ROWS.r505.efl }],           // acts 34 / 54 / 109 / 132
};
// the gauge's levels (0x11dc73c): the values of +0x2780 a level stands above
export const GAUGE = [29, 45, 71];
const ART_LEVEL = 2;                          // III
// the mode each motion's actions declare (vtable +0x84c; efx/player/w14/data/modes.json), and the base's idle picks
const SWORD = new Set([53, 104, 105, 106, 107, 109, 110, 111, 112, 113, 115, 116, 118, 120, 121, 122, 126, 127, 149, 150, 151,
  152, 153, 155, 156, 157, 158, 166, 187, 232, 233, 235, 296, 1]);
const AXE = new Set([119, 125, 128, 130, 131, 133, 134, 135, 136, 137, 138, 142, 143, 145, 146, 147, 148, 159, 160, 161, 162,
  163, 164, 165, 179, 183, 190, 231, 234, 253, 20]);
const SA_SWORD = new Set([1, 51, 101, 151]);  // the Arts' motions 7001 / 7051 / 7101 / 7151: sword
const CHARGED = new Set(['draw:106', 'draw:112', 'draw:113']);   // acts 10 / 52 / 53 / 56
const FULL_KEEP = new Set(['draw:106', 'draw:112', 'draw:113', 'draw:111']);   // + act 109
const HOLD = 'draw:106', FULL_FRAME = 40;
const SHARPEN = 'draw:255', SHARPEN_FROM = 20, SHARPEN_TO = 324;
const VALOR_DELAY = 120;                      // the common parameters' float 89 (60) + 60
// the coats (part-state materials 4 / 6): pl_lance_up's constants (byte for byte the same) and each file's own clip
const coat = (name, emis, refl) => ({
  diffuse: [0.8, 0.8, 0.8], reflective: [0, 0, 0], specular: [0.4, 0.4, 0.4], emission: [0, 0, 0],
  anim: { frames: 9, loop: 1, auto: 1, name, tracks: [
    { target: 'fEmissionColor', kind: 1, interp: 1, cols: 3, keys: [[0, ...emis[0], 1], [5, ...emis[1], 1], [10, ...emis[0], 1]] },
    { target: 'fReflectiveColor', kind: 1, interp: 1, cols: 3, keys: [[0, ...refl[0], 1], [5, ...refl[1], 1], [10, ...refl[0], 1]] },
  ] },
});
export const CB_COATS = {
  yellow: coat('yellow', [[0.45, 0.15, 0.15], [1.0, 0.76, 0.2]], [[0.375, 0.125, 0.125], [1.0, 0.45, 0.0]]),   // gaxe_sld_time_up_yellow
  red: coat('red', [[0.45, 0.15, 0.15], [1.0, 0.28, 0.2]], [[0.375, 0.125, 0.125], [1.0, 0.0, 0.0]]),     // gaxe_sld_power_up_red
  blue: coat('blue', [[0.15, 0.15, 0.45], [0.2, 0.28, 1.0]], [[0.125, 0.125, 0.375], [0.0, 0.0, 1.0]]),   // gaxe_sld_power_up_blue
};
export const COAT_KEEP = new Set([10, 30]);   // the mask 0x40000400: these channels keep their own

function stanceKey(stance){
  const m = /Motion\[(\d+)\]/.exec((stance && stance.clip) || '');
  return m ? (/_sa\./.test(stance.file || '') ? 'sa:' : 'draw:') + (+m[1]) : null;
}
export function levelOf(gauge){ let n = 0; for (const v of GAUGE) if (gauge > v) n++; return n; }
const running = x => !(x.q.finished && x.q.finished());
function stopOn(x, answer){
  const host = x && x.host, sc = host && host.live && host.live.schedule;
  if (!sc || x.live !== host.live) return;
  try {
    if (answer === 3) sc.host.killRequest(x.q);
    else if (!x.q.stopped) sc.host.stopRequest(x.q);
  } catch (_) {}
}

// A WEAPON-UNIT HOST on one part's bones: the blade (+0x23a0) or the shield (+0x23a4)
class PartHost extends WeaponEffects {
  constructor(name, keys){ super(); this.name = name; this.keys = keys; this.unitRoot = null; this.lastSync = null; }
  makeHost(roots){
    const part = roots && roots[0];
    const host = new THREE.Group();
    host.name = 'charge-blade-' + this.name + '-fx-host';
    let bones = part ? gidBonesOf(part) : [];
    if (!bones.length && part) bones = [{ gid: 0, node: part.userData.bone || part, d: 0 }];
    host.userData.gidBones = bones;
    host.userData.joints = [];
    return host;
  }
  useDef(def){
    return Object.assign({}, def, { clips: {}, parentOrder: 0x30000, unitFromOrigin: true,
      effects: (def.effects || []).filter(e => e.when === 'state' && e.record && e.record.array === 'UNIQUE' &&
                                               this.keys.some(([pel, k]) => e.record.pel === pel && e.record.key === k) &&
                                               !this.refused.has(e.record.key))
                                  .map(e => Object.assign({}, e, { joints: [0] })) });
  }
  async sync(cls, part, parent){
    if (cls !== 'w14' || !part || !this.on){ if (this.live || this.unitRoot) this.detach(); this.unitRoot = null; this.lastSync = null; return null; }
    this.lastSync = { cls, part, parent };
    if (this.cls === cls && this.live && this.unitRoot === part) return this.live;
    this.unitRoot = part;
    return this.attach(cls, [part], parent);
  }
  // a refusal takes this host down: drop the record it had just asked and build it again without
  heal(){
    if (!(this.live && this.live.failed)) return false;
    if (this.lastRequested != null) this.refused.add(this.lastRequested);
    console.warn('charge blade (' + this.name + '): record ' + this.lastRequested + ' refused, dropped for this session');
    const s = this.lastSync;
    this.detach(); this.unitRoot = null;
    if (s) this.sync(s.cls, s.part, s.parent);
    return true;
  }
}

export class ChargeBladeEffects {
  constructor(){
    this.blade = new PartHost('blade', [['w14_000', 620], ['w14_000', 621], ['w14_000', 622]]);
    this.shield = new PartHost('shield', [['w14_000', 640], ['w14_800', 800], ...[900, 901, 902, 910, 911, 912].map(k => ['w14_800', k])]);
    this.hunter = null;           // the page's hunter host
    this.held = new Map();        // holder slot -> { q, key, host, live }
    this.gauge = 0;               // the select: the level 0..3
    this.prevLevel = 0;           // +0x3338, the level the hook last saw
    this.asked = false;           // the holder's byte +0x16a0
    this.shieldCharge = 0;        // the select: +0x3344 = 0 none, 1 yellow, 2 red
    this.wall = null;             // the wall clock's last reading (the state runner's timers)
    this.valor = false;           // the shared Valor State switch
    this.valorTimer = 0;          // +0x335c
    this.valorBlue = false;       // +0x3340 bit 6
    this.mode = 'sword';          // +0x3328 as the last declaring stance left it
    this.stance = null;           // { key, f }
    this.phase2 = false;          // the charged slash's phase: the hold's end flag has risen
    this.fired = [];
    this.coat = null;             // { kind: 'red' | 'blue', both } the rig is asked for, or null
    this.onCoat = null;           // (coat) => the rig lays it (index.html)
    this.on = true;
  }
  setEnabled(on){ this.on = !!on; this.blade.on = this.shield.on = this.on; if (!this.on) this.detach(); }
  setSuppressed(v){ this.blade.setSuppressed && this.blade.setSuppressed(v); this.shield.setSuppressed && this.shield.setSuppressed(v); }
  // `quiet`: a level restored with the page is where the gauge stands, not a rise
  setGauge(n, quiet){ n = +n; this.gauge = n >= 0 && n <= 3 ? n : 0; if (quiet) this.prevLevel = this.gauge; }
  // ONE SELECT, as the Long Sword's Spirit Gauge (Raven, 2026-10-03: "Sheild Charge colors can be a single drop down", "Like
  // LS"): 1 yellow, 2 red, 3 Valor (blue) -- the Valor style's state, which holds +0x3344 at 3 and brings the blue in
  // Valor picked BY HAND is blue at once (Raven, 2026-10-04: "We will need that for animations, but when manually selected
  // bypass it"): the ROM's 120-frame countdown and its 640 belong to Valor State BEGINNING, which a stance will drive once
  // the animation review wires the entry (setValor(true) without `now` runs them)
  setShieldCharge(n){ n = n === true ? 2 : +n; this.shieldCharge = n === 1 || n === 2 ? n : 0; this.setValor(n === 3, true); }
  // `now`: the state stands already (picked by hand), so the bit is up and nothing fires; without it Valor State begins and
  // the runner's countdown leads to 640 and the blue, as the ROM does
  setValor(on, now){ on = !!on; if (on !== this.valor){ this.valor = on; this.valorTimer = 0; this.valorBlue = on && !!now; } }
  get live(){ return this.blade.live; }
  sync(cls, main, second, parent){
    return Promise.all([this.blade.sync(cls, main, parent), this.shield.sync(cls, second, parent)]);
  }
  detach(){
    for (const s of [...this.held.keys()]) this.release(s, 3);
    this.blade.detach(); this.shield.detach(); this.blade.unitRoot = this.shield.unitRoot = null;
    this.asked = false; this.stance = null;
  }
  alive(x){ return !!x.host && x.live === x.host.live && running(x); }
  release(slot, answer){ const x = this.held.get(slot); this.held.delete(slot); if (x) stopOn(x, answer); }
  // 0x281ffc -> 0x44c164: an occupied slot keeps its effect unless the flag is 1
  ask(slot, key, efl, flag, host, requester = null){
    const x = this.held.get(slot);
    if (x && this.alive(x) && !flag) return x;
    if (x) this.release(slot, 3);
    if (!host || !host.live || host.refused.has(key)) return null;
    host.lastRequested = key;
    const q = host.startState(key, efl, requester);
    if (!q) return null;
    const y = { q, key, host, live: host.live };
    this.held.set(slot, y);
    return y;
  }
  fire(host, key, efl, requester){
    if (!host || !host.live || host.refused.has(key)) return null;
    host.lastRequested = key;
    const q = host.startState(key, efl, requester);
    if (q){ this.fired.push(key); if (this.fired.length > 12) this.fired.shift(); }
    return q;
  }
  // every frame: `cls` the class in the hand (null otherwise), `stance` / `time` the weapon stance, `advance` the seconds of
  // animation since the last frame, `drawn` the rig's fact
  step(cls, stance, time, advance, drawn){
    if (this.blade.heal() || this.shield.heal()) return;
    for (const [s, x] of this.held) if (!this.alive(x)){
      // a host rebuilt (a class switch, new armour) took the holder's effect with it: the holder is asked afresh, as a new
      // player's would be; an effect that ran its course keeps the byte, as the ROM's does
      if (s === 0 && x.live !== x.host.live) this.asked = false;
      this.held.delete(s);
    }
    const on = cls === 'w14';
    if (!on){ if (this.held.size) for (const s of [...this.held.keys()]) this.release(s, 3); this.asked = false; this.setCoat(null); this.stance = null; return; }
    if (this.blade.live) this.blade.stepClip(null, time, advance);
    if (this.shield.live) this.shield.stepClip(null, time, advance);
    const key = drawn && stance ? stanceKey(stance) : null;
    const f0 = key ? Math.round((stance.t0 || 0) * 60) : 0;
    const f = key ? f0 + Math.round((time || 0) * 60 * 1000) / 1000 : 0;
    const prev = this.stance;
    const entered = !(prev && prev.key === key && f >= prev.f);
    const wrapped = entered && !!prev && prev.key === key && (advance || 0) > 0;
    const from = !entered ? prev.f : wrapped ? f0 - 1e-6 : -1;
    this.stance = key ? { key, f } : null;
    const crossed = at => from < at && f >= at;
    // THE STATE RUNNER COUNTS GAME FRAMES, whatever the motion does: a play-once stance held at its end still runs them
    const now = performance.now(), frames = this.wall == null ? 0 : Math.min(6, Math.max(0, (now - this.wall) / 1000 * 60));
    this.wall = now;
    // THE MODE: the declaring stance's word; the rest keep it
    if (key){
      const n = +key.slice(key.indexOf(':') + 1);
      if (key[0] === 's' ? SA_SWORD.has(n) : SWORD.has(n)) this.mode = 'sword';
      else if (key[0] === 'd' && AXE.has(n)) this.mode = 'axe';
    }
    const sword = this.mode === 'sword';
    // THE CHARGE GAUGE: a rise fires on the blade (0x11da3f8); level 3 is the holder's 622 (its update and code 3's policy)
    const level = this.gauge;
    if (level > this.prevLevel && this.blade.live){
      if (level === 1) this.fire(this.blade, ROWS.rise1.key, ROWS.rise1.efl, { rootJoint: 0 });
      else if (level === 2) this.fire(this.blade, ROWS.rise2.key, ROWS.rise2.efl, { rootJoint: 0 });
    }
    this.prevLevel = level;
    const sharpening = key === SHARPEN && f >= SHARPEN_FROM && f < SHARPEN_TO;
    const keepRed = level === 3 && ((drawn && sword) || sharpening);
    if (keepRed && !this.asked && this.blade.live){ if (this.ask(0, ROWS.red.key, ROWS.red.efl, false, this.blade, { rootJoint: 0 })) this.asked = true; }
    else if (!keepRed){ if (this.held.has(0)) this.release(0, 2); this.asked = false; }
    // THE CHARGED SLASH on the hunter: 500 from the start; 501 at the hold's frame 40 once its end flag has risen
    if (key && CHARGED.has(key) && entered && !wrapped && !(prev && CHARGED.has(prev.key))){
      this.phase2 = false;
      this.ask(1, ROWS.charge.key, ROWS.charge.efl, false, this.hunter);
    }
    // a lead-in's end flag puts the hold in phase 2 (acts 52 / 53 enter Motion[106] at frame 28); played on its own (act
    // 10) the hold is phase 1 until its end flag, and its loop (from frame 50) never crosses 40 again: 500 alone
    if (key === HOLD && entered && !wrapped && prev && (prev.key === 'draw:112' || prev.key === 'draw:113')) this.phase2 = true;
    if (key === HOLD && this.phase2 && crossed(FULL_FRAME)) this.ask(2, ROWS.full.key, ROWS.full.efl, true, this.hunter);
    if (this.held.has(1) && !CHARGED.has(key)) this.release(1, 3);
    if (this.held.has(2) && !FULL_KEEP.has(key)) this.release(2, 3);
    // THE ARTS on the shield
    if (key === 'sa:51' && crossed(170)) this.fire(this.shield, ROWS.art51.key, ROWS.art51.efl, { rootJoint: 0xffff });
    if (key === 'sa:151'){
      if (crossed(50)) this.ask(3, ROWS.art151a.keys[ART_LEVEL], ROWS.art151a.efl, false, this.shield);
      if (crossed(94)) this.ask(4, ROWS.art151b.keys[ART_LEVEL], ROWS.art151b.efl, false, this.shield);
    }
    if (this.held.has(3) && !(key === 'sa:151' && f < 179)) this.release(3, 2);
    if (this.held.has(4) && !(key === 'sa:151' && f < 164)) this.release(4, 2);
    // VALOR STATE: armed once, counted down by the runner; at 0 the shield's 640 and the blue coat
    if (this.valor && !this.valorBlue){
      if (this.valorTimer <= 0) this.valorTimer = VALOR_DELAY;
      this.valorTimer -= frames;
      if (this.valorTimer <= 0){
        if (drawn) this.fire(this.shield, ROWS.valor.key, ROWS.valor.efl, { rootJoint: 0 });
        this.valorBlue = true;
      }
    }
    // THE COAT (0x11d0df4): the state 2's red unless Valor State holds the state at 3; the Valor bit's blue; not with the
    // weapon on the back in a base action (here: not drawn); in axe mode the blade too
    const kind = this.valor ? (this.valorBlue ? 'blue' : null) : ([null, 'yellow', 'red'][this.shieldCharge]);
    this.setCoat(kind && drawn ? { kind, both: !sword } : null);
  }
  setCoat(c){
    const a = this.coat, same = (!a && !c) || (a && c && a.kind === c.kind && a.both === c.both);
    if (same) return;
    this.coat = c;
    if (this.onCoat) this.onCoat(c);
  }
  stats(){
    const held = {};
    for (const [k, x] of this.held) held[k] = { key: x.key, on: x.host === this.hunter ? 'hunter' : x.host.name, running: running(x),
                                                shown: x.q && x.q.m && x.q.core ? x.q.m.u8(x.q.core + 0x1c1) : null };
    return { blade: this.blade.live ? this.blade.live.stats : null, shield: this.shield.live ? this.shield.live.stats : null,
             failed: !!((this.blade.live && this.blade.live.failed) || (this.shield.live && this.shield.live.failed)),
             refused: [...this.blade.refused, ...this.shield.refused], mode: this.mode, gauge: this.gauge, asked: this.asked,
             valorTimer: Math.round(this.valorTimer), valorBlue: this.valorBlue, coat: this.coat, phase2: this.phase2,
             fired: this.fired.slice(), held, stance: this.stance && this.stance.key };
  }
}
