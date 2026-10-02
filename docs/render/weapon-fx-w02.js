// THE HAMMER'S EFFECTS: what uPlayerQuest02's code and its effect holder ask for, and when.
//
// Raven, 2026-10-01: "Next weapon" (after the Dual Blades). Read from the ROM as the Bow was (build/notes/hammer-effects.md;
// efx/player/w02). Every address is exefs/main. The class's motion schedule (docs/effects/w02.json clips) runs on the
// hunter host like every class's; this module is what the schedule does not cover.
//
// THE CLASS: uPlayerQuest02, vtable 0x1743bc0, own code 0x116b7ec..0x1173b0c; the action switch (vtable +0x324 =
// 0x116c550, table 0x116c57c, 157 cases) tail-calls its start functions with a sub-index. Every holder request goes on
// the player's own block +0x2550, so every row below hangs from the HUNTER, but Impact Press's (on the hammer unit).
// THE CLASS PARAMETERS (0x282120 ints / 0x282140 floats, the object at player +0x263c) are arc/player/quest/w02.arc
// player\param\pl_w02: 5 header words, 8 ints [21, 4, 40, 60, 44, 54, 70, 120], 19 floats [222, 68, 150, 10.5, -0.4375,
// 3, 30, 60, 60, 1.2, 4800, 6000, 7200, 0.2, 30, 32, 10, 0.65, 1.2].
// THE CHARGE: the timer player +0x2b74 (frames). Its step (vtable +0x7f8 = 0x117223c): while the timer is 0 it asks the
// glow first; then adds the frame (0x539d48, rate 1.0, 999 at most) and asks the glow again when the LEVEL changed. The
// level is timer / 0x117239c(): 60 frames, or by the hunting style (style 1: int 2 = 40; Valor, style 5: int 4 = 44 in
// the Valor State, 54 / 70 in the Valor charges' modes +0x3328 & 8 / 0x10, else 120); x 1 / 1.25 with skills 0x98 / 0x10a
// / 0x11c / 0x125, x 1 / 0.833 with 0x99. The level is 0-BASED: level 0 is the game's first charge level, and it shows.
//   * SLOT 0 = THE GLOW, vtable +0x8b0 = 0x11724f4, flag 1: rows 0..2 = w02_000 500 / 501 / 502 (cm001_500.efl) by the
//     level 0..2 (a level of 3 and up asks nothing: the last glow stays); the Valor style caps the level at 1, and in
//     the VALOR STATE (status hi 0x40000) the rows are 17 / 18 = 510 / 511 (cm001_510.efl). The Adept style's charge
//     (+0x4cc: style 3 and +0x3328 bit 0) asks rows 11..13 = 510..512 and the Valor charges' modes 19 / 20 = 521 / 522
//     (& 8) and 21 / 22 = 531 / 532 (& 0x10): not wired, the page has no style.
//   * WHERE IT RUNS: 0x116d6dc's acts 7..10, 22, 23, 28, 29, 39, 40, 71, 86, 96, 99..101, 126, 130, 131, 133..135 (phase 0
//     plays the entry motion and most ZERO the timer; phase 1 runs the step for subs 8 / 9 at once, 10 / 11 past frame
//     32, 13..21 past float 14 = 30 or 15 = 32; phase 2 is the hold, Motion[133], the step every frame), 0x116e330's acts
//     17 / 41 (Motion[131], the charge on the move) and 0x116faf0's acts 70 / 84 (Motion[152] / [234], zeroed first).
//   * THE POLICY (0x452f88) keeps the glow through vtable +0x694's acts (the list above) and stops it at once elsewhere;
//     a release first calls vtable +0x8a8(0) = 0x1172638: the glow stops at once when the level is 1+, ends by itself
//     at level 0.
// THE RELEASES, fire and forget (vtable +0x39c) at their motion's start: the release act comes from the level (0x1171c1c:
// level min 2, by style -- Guild 11 / 12 / 16 standing, 13 / 14 / 18 on the move). Act 12 / 14 (Motion[135]) row 3 =
// 505 (cm001_500), row 23 = 515 (cm001_510) in the Valor State; act 16 (Motion[106]) and 18 (Motion[103]) row 4 = 506;
// act 34 (Motion[157], the spin) 505 / 515 at level 1, 506 at 2+; acts 93 / 125 (Motion[191]) 506; acts 74 / 117 / 119
// (Motion[186]) and 75 ([187]) 516; acts 116 / 118 ([251]) 515; act 64 ([253]) 505. Acts 11 / 13 (Motion[105]) fire
// nothing.
// TYPHOON TRIGGER (hunterArtsData_eng.gmd 0x29..0x2b by its description: "a spinning Hammer attack that takes a few swings
// to get going"; acts 51..53, Arts Motion[101], 0x11707c0): the stage = table 0x16a57e0[level][n], n counted up at motion
// frame 168 and at 198 of each pass of the loop (int 1 - 1 = 3 at most, then the stumble, act 58); slot 1, flag 1, rows 6..8
// = w02_800 900 / 901 / 902 (cm122_020): asked at frame 128 and whenever the stage changes. The uppercut (acts 54..57, Arts
// Motion[102] / [104], 0x1170bac) fires row 16 / 9 / 10 = 905 / 906 / 907 (cm001_500) by the stage, then stops slot 1;
// the policy (codes 6..8) keeps it through acts 51..53 and 58 (Arts Motion[103]) and stops it elsewhere.
// IMPACT PRESS (0x2c..0x2e; act 90, Arts Motion[151], 0x1170f18): at motion frame 250 its timer +0x332c = float 10 / 11 /
// 12 (4800 / 6000 / 7200 frames) by the Art's level and slot 2 is asked, row 28 = w02_800 1000 (cm123_020), on the HAMMER
// unit (+0x23a0); the holder's hook (0x452edc) asks it every frame while status 0x20 stands. The page's switch and the
// stance past frame 250 stand for the timer; the hammer-unit host is render/weapon-fx-w01.js's ChaosOilEffects.
// ROW 5 = cm002_002 202 (cm002_007.efl): the base sharpening (0x2d5e74, weapon type 2) at Motion[255] frame 274.
// IN THE VIEWER the page plays the Guild style, or the Valor style with its Valor State switch (the Dual Blades' switch,
// shown for the Hammer too). A stance whose acts answer differently and the page cannot tell apart fires nothing:
// Motion[185] (73 / 79: 515; 112 / 114: 516) and [190] (92 / 95: 505; 123 / 124: 506). Typhoon Trigger plays at the
// Art's level III (its three stages); the Art's level is no control of the page's.
// NOT WIRED: the Adept and Valor charge modes' rows (510..512, 521 / 522, 531 / 532); the shells pl_w02_000 / 001 / 100 /
// 101 (Spinning Meteor's and the charged attacks' shockwaves); the skills that speed the charge.

export const ROWS = {
  glow: { keys: [500, 501, 502], efl: 'cm001_500' },       // rows 0..2
  valorGlow: { keys: [510, 511], efl: 'cm001_510' },       // rows 17 / 18
  r505: { key: 505, efl: 'cm001_500' },                    // row 3
  r506: { key: 506, efl: 'cm001_500' },                    // row 4
  r515: { key: 515, efl: 'cm001_510' },                    // rows 14 / 23 / 24 / 26
  r516: { key: 516, efl: 'cm001_510' },                    // rows 15 / 25 / 27
  stage: { keys: [900, 901, 902], efl: 'cm122_020' },      // rows 6..8
  uppercut: { keys: [905, 906, 907], efl: 'cm001_500' },   // rows 16 / 9 / 10
  impact: { keys: [1000], efl: 'cm123_020' },              // row 28 (the hammer unit)
  sharpen: { key: 202, efl: 'cm002_007' },                 // row 5 (cm002_002)
};

// the releases whose row does not depend on anything the page holds (render/weapon-fx.js PlayerRequests)
const at0 = r => [{ at: 0, key: r.key, efl: r.efl }];
export const PLAYER_REQUESTS = {
  'draw:106': at0(ROWS.r506),          // act 16 (0x116e150)
  'draw:103': at0(ROWS.r506),          // act 18 (0x116e544)
  'draw:191': at0(ROWS.r506),          // acts 93 / 125 (0x11713b0)
  'draw:186': at0(ROWS.r516),          // acts 74 / 117 / 119
  'draw:187': at0(ROWS.r516),          // act 75
  'draw:251': at0(ROWS.r515),          // acts 116 / 118 (0x1171580)
  'draw:253': at0(ROWS.r505),          // act 64 (0x116dd0c)
  'draw:255': [{ at: 274, key: ROWS.sharpen.key, efl: ROWS.sharpen.efl }],   // the base sharpening (weapon type 2)
};

// the stances whose action runs the charge step, from motion frame `from`
const CHARGE = { 'draw:133': 0, 'draw:131': 0, 'draw:158': 0, 'draw:254': 32, 'draw:138': 32, 'draw:147': 30,
                 'draw:148': 32, 'draw:152': 0, 'draw:234': 0 };
// the entry motions whose phase 0 zeroes the timer (Motion[137] is acts 29 / 126, which zero it, and 133, which does not)
const ZERO = new Set(['draw:132', 'draw:110', 'draw:140', 'draw:144', 'draw:137', 'draw:254', 'draw:138', 'draw:147',
                      'draw:154', 'draw:152', 'draw:234']);
// vtable +0x694: the policy keeps the glow through these
const KEEP = new Set([...Object.keys(CHARGE), ...ZERO]);
// the actions that call vtable +0x8a8(0) at their start (a release: the glow ends by itself at level 0)
const RELEASES = new Set(['draw:105', 'draw:135', 'draw:106', 'draw:103', 'draw:157', 'draw:145', 'draw:155',
                          'draw:185', 'draw:186', 'draw:187', 'draw:189', 'draw:190', 'draw:191', 'draw:251', 'draw:253']);
const TIMER_MAX = 999;                   // 0x117223c: the literal 999.0
const SPIN = 'draw:157';                 // act 34
const TYPHOON = 'sa:101', STUMBLE = 'sa:103', UPPERCUT = new Set(['sa:102', 'sa:104']);
const STAGES = [[0, 0, 0, 0], [0, 0, 1, 1], [0, 1, 1, 2]];   // 0x16a57e0: [Art level][count]
const STAGE_CAP = 3;                     // byte +6 = int 1 - 1
const IMPACT = 'sa:151', IMPACT_FRAME = 250;

function stanceKey(stance){
  const m = /Motion\[(\d+)\]/.exec((stance && stance.clip) || '');
  return m ? (/_sa\./.test(stance.file || '') ? 'sa:' : 'draw:') + (+m[1]) : null;
}
const running = x => !(x.q.finished && x.q.finished());
// the holder's answer for a slot's effect: 3 at once (the core's own kill), 2 the effect's own end
function stopOn(x, answer){
  const host = x && x.host, sc = host && host.live && host.live.schedule;
  if (!sc || x.live !== host.live) return;
  try {
    if (answer === 3) sc.host.killRequest(x.q);
    else if (!x.q.stopped) sc.host.stopRequest(x.q);
  } catch (_) {}
}

// THE HOLDER's slots on the hunter host (`hunter`, the page's)
export class HammerEffects {
  constructor(){
    this.held = new Map();        // holder slot -> { q, key, host, live }
    this.valor = false;           // the Valor State (the shared switch): style 5 and status hi 0x40000
    this.impact = false;          // Impact Press active (the checkbox)
    this.impactNow = false;       // the status this frame: the switch, or the Art's stance past frame 250
    this.artLevel = 2;            // Typhoon Trigger's level (0-based): III
    this.timer = 0;               // the charge, player +0x2b74 (frames)
    this.bits = 0;                // the level the step last wrote (+0x2b70 bits 16..18)
    this.shotLevel = 0;           // the level when a stance that does not charge was entered
    this.count = 0;               // Typhoon Trigger's count, +0x3326
    this.seen = 0;                // its stage as last asked, +0x3325
    this.stance = null;           // { key, f }
    this.hunter = null;
  }
  detach(){ for (const s of [...this.held.keys()]) this.release(s, 3); this.timer = 0; this.bits = 0; this.stance = null; }
  alive(x){ return !!x.host && x.live === x.host.live && running(x); }
  release(slot, answer){ const x = this.held.get(slot); this.held.delete(slot); if (x) stopOn(x, answer); }
  // 0x281ffc -> 0x44c164: flag 1 stops the slot's occupant at once and asks the row
  ask(slot, row, key){
    if (this.held.has(slot)) this.release(slot, 3);
    const host = this.hunter;
    if (!host || !host.live || host.refused.has(key)) return null;
    const q = host.startState(key, row.efl, null);
    if (!q) return null;
    const y = { q, key, host, live: host.live };
    this.held.set(slot, y);
    return y;
  }
  fire(row, key){
    const h = this.hunter;
    if (!h || !h.live || h.refused.has(key)) return null;
    return h.startState(key, row.efl, null);
  }
  setValor(on){ this.valor = !!on; return this.valor; }
  setImpact(on){ this.impact = !!on; return this.impact; }
  // 0x117239c: the frames a level takes (the Valor State's int 4, else 60)
  perLevel(){ return this.valor ? 44 : 60; }
  // the step's level bits: timer / frames, at most 3; the Valor style keeps it at 1
  levelOf(){ const l = Math.min(3, Math.floor(this.timer / this.perLevel() + 1e-6)); return this.valor ? Math.min(l, 1) : l; }
  // vtable +0x8b0: the glow's row by the level, nothing above 2
  askGlow(){
    const l = this.levelOf();
    if (l > 2) return null;
    const row = this.valor ? ROWS.valorGlow : ROWS.glow;
    return this.ask(0, row, row.keys[l]);
  }
  // every frame: `cls` the class in the hand (null otherwise), `stance` / `time` the weapon stance, `advance` the seconds of
  // animation since the last frame, `drawn` the rig's fact
  step(cls, stance, time, advance, drawn){
    for (const [s, x] of this.held) if (!this.alive(x)) this.held.delete(s);
    if (cls !== 'w02'){ if (this.held.size || this.timer) this.detach(); this.impactNow = false; return; }
    const key = drawn && stance ? stanceKey(stance) : null;
    const f0 = key ? Math.round((stance.t0 || 0) * 60) : 0;
    const f = key ? f0 + Math.round((time || 0) * 60 * 1000) / 1000 : 0;
    const prev = this.stance;
    const entered = !(prev && prev.key === key && f >= prev.f);
    const wrapped = entered && !!prev && prev.key === key && (advance || 0) > 0;   // the page's Loop came round
    const from = !entered ? prev.f : wrapped ? f0 - 1e-6 : -1;
    this.stance = key ? { key, f } : null;
    const crossed = at => from < at && f >= at;
    const fresh = entered && !wrapped;

    // THE CHARGE
    const keep = KEEP.has(key);
    if (fresh && !keep){
      this.shotLevel = this.levelOf();
      // a release (vtable +0x8a8(0)) lets a level-0 glow end; the policy stops it at once anywhere else
      if (this.held.has(0)) this.release(0, RELEASES.has(key) && this.shotLevel === 0 ? 2 : 3);
      this.timer = 0; this.bits = 0;
    }
    if (fresh && keep && (ZERO.has(key) || !(prev && KEEP.has(prev.key)))){ this.timer = 0; this.bits = 0; }
    const start = CHARGE[key];
    if (start != null && f >= start){
      if (this.timer <= 0) this.askGlow();
      const played = Math.max(0, f - Math.max(from, start));
      this.timer = Math.min(TIMER_MAX, this.timer + played);
      const l = this.levelOf();
      if (l !== this.bits){ this.bits = l; this.askGlow(); }
    }
    // THE SPIN (act 34) fires at its start by the level the charge reached
    if (key === SPIN && fresh && f0 === 0){
      const l = this.shotLevel;
      if (l === 1) this.fire(this.valor ? ROWS.r515 : ROWS.r505, this.valor ? 515 : 505);
      else if (l >= 2) this.fire(ROWS.r506, 506);
    }
    // acts 12 / 14
    if (key === 'draw:135' && crossed(0)) this.fire(this.valor ? ROWS.r515 : ROWS.r505, this.valor ? 515 : 505);

    // TYPHOON TRIGGER
    if (key === TYPHOON){
      if (fresh && !(prev && prev.key === TYPHOON)){ this.count = 0; this.seen = 0; if (this.held.has(1)) this.release(1, 3); }
      const stageNow = () => STAGES[this.artLevel][Math.min(this.count, 3)];
      const s = stageNow();
      if (s !== this.seen){ this.seen = s; this.ask(1, ROWS.stage, ROWS.stage.keys[s]); }      // 0x1172694
      if (crossed(128)) this.ask(1, ROWS.stage, ROWS.stage.keys[stageNow()]);
      if (crossed(168)) this.count++;
      if (crossed(198) && this.count < STAGE_CAP) this.count++;    // at the cap the act becomes the stumble (act 58)
    } else if (UPPERCUT.has(key)){
      if (fresh){
        const s = STAGES[this.artLevel][Math.min(this.count, 3)];
        this.fire(ROWS.uppercut, ROWS.uppercut.keys[s]);
        if (this.held.has(1)) this.release(1, 3);
      }
    } else if (key !== STUMBLE && this.held.has(1)) this.release(1, 3);

    // IMPACT PRESS: the status stands with the switch, or from its stance's frame 250
    this.impactNow = this.impact || (key === IMPACT && f >= IMPACT_FRAME);
  }
  stats(){
    const held = {};
    for (const [k, x] of this.held) held[k] = { key: x.key, running: running(x),
                                                shown: x.q && x.q.m && x.q.core ? x.q.m.u8(x.q.core + 0x1c1) : null };
    return { timer: +this.timer.toFixed(2), level: this.levelOf(), shotLevel: this.shotLevel, valor: this.valor,
             impact: this.impact, impactNow: this.impactNow, count: this.count, stage: this.seen,
             held, stance: this.stance && this.stance.key };
  }
}
