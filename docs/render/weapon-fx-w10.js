// THE BOW'S EFFECTS: what uPlayerQuest10's code and its effect holder ask for, and when.
//
// Raven, 2026-09-30: "push, next weapon" (the Bow, the fewest request sites left: seven). Read from the ROM as the Heavy
// Bowgun was (build/notes/bow-effects.md; efx/player/w10). Every address is exefs/main. The class's motion schedule
// (docs/effects/w10.json clips) runs on the hunter host like every class's; this module is what the schedule does not cover.
// Raven, 2026-10-01: "No need for Aiming Mode, Charge Level does not render or if it does it renders during non-charging
// animations" -- the level is no longer a switch but the game's own charge, built by the motions that charge (below), and
// Aiming Mode (and the one row it shows, 510) is not offered for the Bow.
//
// THE CLASS: uPlayerQuest10, vtable 0x1747980, own code 0x11ae730..0x11b6d9c; the action switch (vtable +0x324 = 0x11af8d0,
// on +0x250a, table 0x11af8fc, 69 cases) tail-calls 22 start functions with a sub-index. Seven holder requests, all on the
// player's own request block +0x2550 (its one override: the parent = the player's own handle, 0x27a324), so every row
// below hangs from the HUNTER at its record's own joint.
// THE CHARGE (vtable +0x7e8 = 0x11b5704): the level is the charge TIMER player +0x2b74 (frames) / 60, x 1.25 while status lo
// 0x4000 stands (HASTE RAIN) or with any of four skills, x 0.833 with a fifth; capped at player parameter 28 - 1 -- the
// bow's OPEN CHARGE LEVELS, weapon10LevelData +14 (render/weapons-index.js chargesFor) -- or at 2 (3 under status hi
// 0x40000) in acts 51 / 53 / 55 / 60. THE LEVEL IS 0-BASED: level 0 is the game's first charge level. The timer runs in the
// actions that call the charge step (vtable +0x7f8 = 0x11b5884: 0x2aca98 adds the frame at the rate 1.0, to 2000 at most)
// -- 0x11b0458's acts 2..7, 19, 27, 28, 45, 47, 53, 59, 60, 67, 68 (Motion[105] and its pitch variants, [118], [21], [20],
// [52], [16], [185], [253], [192], [197]), act 13 (Motion[5], 0x11b1768) and act 61 (Arts Motion[152], 0x11b3f98) --
// and the step asks the glow on each RISE of the level. Some actions SET the level: 0x11b44ac(level) gives the timer
// (60 frames a level, x 0.8 rounded up under Haste Rain): acts 28 / 47 (Motion[185] / [253]) set 2 (3 under Haste Rain)
// at their start and ask at frame 24 (0x11b0818 / 0x11b082c, 0x11b0644); acts 56 / 57 / 58 (an Art by its level: Arts
// Motion[154] / [151] / [151]) set 1 / 1 / 2 and ask (0x11b3aa0, 0x11b3c70, 0x11b3c2c); act 27 (Motion[16]) sets 2 and
// asks (0x11b0af4) -- act 59 plays the same motion and does not.
//   * SLOT 0 = the CHARGE LEVEL's glow, 0x281ffc(self, 0, level, block, flag 1) from vtable +0x8b4 = 0x11b6660: row 1..3 =
//     w10_000 500..502 (cm001_500.efl, a held aura at the drawing hand) for the level 1..3, row 0 (nothing) for level 0 or
//     a level of 4 and up.
//   * THE SHOTS, fire and forget (vtable +0x39c = 0x281ef4 -> the holder's +0x150): row 8 / 12 / 13 / 14 = 545 / 546 / 547 /
//     548 (w10_500.efl) by the level 0..3, or with the ALCHEMY COATING loaded (player +0x2b78 = the coating table's index
//     of item 0xfe, itemData_eng.gmd "Alchemy Coating") rows 22..25 = 549..552: at the start of Motion[108] / [115]
//     (acts 0 / 1, 0x11afe50), [134] (acts 51 / 52 there; acts 37 / 50 / 55 of 0x11b1ba0 with the level one higher, the
//     game's POWER SHOT: HN_WeaponControlsMsg "one charge level higher"), [133] (act 36), [129] (acts 22 / 24 / 26 / 64 /
//     66, 0x11b2920: level 1 whatever the charge), and at frame 5 of Arts Motion[153] (act 62, 0x11b3fac). Acts 32 / 33
//     (Arts Motion[4] / [7], 0x11b30a8) fire row 16 = 545 and act 35 (Arts Motion[18]) row 21 = w10_800 850, neither
//     with the Alchemy Coating.
// THE HOLDER uShellPlEffectW10 (vtable 0x1757100; shell/pleffect/effect_w10, 26 rows):
//   * ITS SETUP, vtable +0x148 = 0x455e3c (the player's vtable +0x2bc = 0x289bdc runs it when the holders are reset): it
//     clears every slot (0x44bc1c) and creates, each hidden (show byte +0x1c1 = 0): SLOT 1 = row 4 = 510 (w10_510.efl, a beam
//     model) on the HOLDER SHELL, which the policy moves to the player's joint 8, shown only in AIMING MODE (0x11b4588);
//     SLOT 2 = rows 5..7, the arc shot's mark (a ray at the stage, in Aiming Mode); SLOTS 3..5 = rows 9 / 10 / 15 = 620 /
//     640 / 621, THE NOCKED ARROW (model records the rig draws: render/weapon.js stanceArrow), or 630 / 650 / 631 when the
//     bow model's pl_w10.plweplist mSubParam[0] is 1.
//   * ITS HOOK, +0x14c = 0x456f88, every frame: while status lo 0x4000 stands (HASTE RAIN's timer +0x332c > 0, vtable
//     +0x8b0), the weapon drawn (vtable +0x178) or the action (1, 0x5a), and the action group is not 0x800, it asks SLOT 6
//     = row 11 = w10_800 940 (cm120_102.efl), flag 0, through its own block +0x15c0 (parent the player: 0x44bb04).
//   * ITS POLICY, +0x160 = 0x456094 (the update 0x44bc88 writes the show byte 1, then applies the answer: 3 at once, 2 left
//     to end, 0 kept): codes 0..3 (the charge glow) 0 through group 0x10's acts 2..7, 13, 19, 21, 23, 25, 27, 28, 45, 47,
//     53, 56..61, 67, 68, group 1's 128..130 and group 4's 10; 2 for 32 of group 1's base actions; else 3. Code 11 (940): 0
//     while status lo 0x4000 stands, else 3. (Codes 4..7, 9, 10, 15, 17..19 are the setup's slots.)
// ROW 20 = cm002_002 213 (cm002_007.efl): the base sharpening (0x2d5e74, weapon type 10 -> code 20) at Motion[255] frame 274.
// THE PITCH VARIANTS: after setting its motion an action hands 0x281c18(self, up, down) two more, and the aim's pitch (player
// +0x14b8) blends one of them into the main motion by its size; the main stays the playing motion (+0x4b4), so the action,
// its frames and the motion's flags are the main's (PITCH_MAIN).
// THE HUNTER ARTS (hunterArtsData_eng.gmd, by the ids the code tests): HASTE RAIN 0x86..0x88 (acts 39..41, Arts Motion[51]:
// at motion frame 120 its timer +0x332c = player parameter 8 / 9 / 10 by the Art's level, 0x11b3740) and BLADE WIRE
// 0x89..0x8b (acts 42..44, Arts Motion[101]: the timer +0x3328, status lo 0x2000 -- a parameter of the arrows, no effect
// row). The other Arts' acts (29..35, 56..62: Arts Motion[1..20], [151..154]) test no id: named by their motions only.
// IN THE VIEWER the charge timer runs on the stance's own clock in the charging motions: a charge starts at 0 when one of
// them is entered from a motion that does not keep it (a `_loop` segment counts the frames of its motion before it: the
// draw that led to it), goes on across the motions that keep it, and a motion that keeps the glow without charging holds
// it (Motion[132]), sets it (Arts Motion[151], [154]) or zeroes it (Motion[126], whose act starts the timer at 0 and leaves
// the glow standing). A shot fires at the level the charge reached, and ends the charge. A stance
// plays once and stops on its last frame, and so does the timer: Motion[105]'s draw (2.3 s) shows level 1 at one second
// and level 2 at two. With the page's Loop on, the hold (Motion[105]_loop) goes round and the charge with it, as the held
// button does in the game: level 3 at three seconds, where the bow has it -- player parameter 28: the bow's open levels
// (weapon10LevelData +14), one more with the skill LOAD UP (Raven, 2026-10-01: "we need to have Load Up to access the
// fourth charge state, some bows have 4th charge states already while others need Load Up for 3rd charge level").
// NOT WIRED: 510 and Aiming Mode; the arc shot's mark (the stage's ray); the arrows in flight (shells 0x34 / pl_w10_000 /
// pl_w10_001); the three special bows' 630 / 650 / 631. THE ALCHEMY COATING (Raven, 2026-10-01: "For now, we don't need
// the Alchemy coding effect toggle, I may add that in when we review animations"): the page shoots as the game does with
// no coating loaded -- rows 22..25 (549..552, the same w10_500.efl, a golden release flash) and the Arts' shots it
// silences wait for that review.

export const ROWS = {
  charge: { keys: [500, 501, 502], efl: 'cm001_500' },   // rows 1..3: the level 1..3
  shot: { keys: [545, 546, 547, 548], efl: 'w10_500' },  // rows 8, 12..14: the level 0..3
  artShot: { key: 545, efl: 'w10_500' },                 // row 16 (acts 32 / 33)
  artShot2: { key: 850, efl: 'cm122_100' },              // row 21 (act 35)
  haste: { key: 940, efl: 'cm120_102' },                 // row 11, slot 6
  sharpen: { key: 213, efl: 'cm002_007' },               // row 20
};

// The player's requests by stance that no policy of the holder's watches beyond the stance (render/weapon-fx.js
// PlayerRequests on the hunter host)
export const PLAYER_REQUESTS = {
  'draw:255': [{ at: 274, key: ROWS.sharpen.key, efl: ROWS.sharpen.efl }],                       // the sharpening
};
// THE PITCH VARIANTS (0x281c18's pairs, main -> up / down: every call in 0x11ae730..0x11b6d9c). The viewer plays a variant as
// a stance of its own: it is keyed as its main.
export const PITCH_MAIN = {
  draw: { 102: 101, 103: 101, 106: 105, 107: 105, 109: 108, 110: 108, 116: 115, 117: 115, 119: 118, 120: 118, 124: 123,
          125: 123, 127: 126, 128: 126, 130: 129, 131: 129, 135: 134, 136: 134, 190: 189, 191: 189, 193: 192, 194: 192,
          198: 197, 199: 197 },
  sa: { 5: 4, 6: 4, 8: 7, 9: 7, 16: 15, 17: 15, 19: 18, 20: 18 },
};
// the stances whose actions run the charge step (vtable +0x7f8: the timer advances, a rise asks the glow). Motion[16] is
// acts 27 and 59: played as act 59, the charge alone (act 27 would set the level to 2 at once)
const CHARGE = new Set(['draw:105', 'draw:118', 'draw:20', 'draw:21', 'draw:52', 'draw:16', 'draw:185', 'draw:253',
                        'draw:192', 'draw:197', 'draw:5', 'sa:152']);
// the actions that SET the level (the timer = 0x11b44ac(level)) at frame `at` and ask the glow at `ask`; 'act' = 2, or 3
// under Haste Rain (0x11b0b28)
const SETS = {
  'draw:185': { level: 'act', at: 0, ask: 24 },   // act 28
  'draw:253': { level: 'act', at: 0, ask: 24 },   // act 47
  'sa:154': { level: 1, at: 0, ask: 0 },          // act 56 (the Art at level I)
  'sa:151': { level: 2, at: 0, ask: 0 },          // act 58 (level III; act 57, level II, sets 1)
};
// the policy's codes 0..3 keep the glow through these stances' actions; the charge stands still where they do not charge
const KEEP = new Set([...CHARGE, ...Object.keys(SETS), 'draw:126', 'draw:132']);
// acts 21 / 23 / 25 / 63 / 65 (0x11b2618: Motion[126], the vault the downward shot [129] follows) zero the timer at their
// start (0x11b2850); the policy keeps the glow through acts 21 / 23 / 25 (63 / 65 stop it: the viewer reads the first)
const ZERO = new Set(['draw:126']);
// acts 53 / 60 (the charge in Aiming Mode) cap the level at 2 (3 under status hi 0x40000, which nothing here raises)
const CAP2 = new Set(['draw:192', 'draw:197']);
const TIMER_MAX = 2000;                        // 0x2aca98: the timer stops there (the literal 2000.0)
// the shots, fire and forget: `at` the motion frame; `by` how the row is picked
const SHOTS = {
  'draw:108': { at: 0, by: 'level' },           // act 0
  'draw:115': { at: 0, by: 'level' },           // act 1
  'draw:134': { at: 0, by: 'power' },           // acts 37 / 50 / 55: the level one higher (acts 51 / 52: the level)
  'draw:133': { at: 0, by: 'level' },           // act 36
  'draw:129': { at: 0, level: 1 },              // acts 22 / 24 / 26 / 64 / 66
  'sa:153': { at: 5, by: 'level' },             // act 62
  'sa:4': { at: 0, row: ROWS.artShot },         // act 32
  'sa:7': { at: 0, row: ROWS.artShot },         // act 33
  'sa:18': { at: 0, row: ROWS.artShot2 },       // act 35
};
const HASTE_STANCE = 'sa:51', HASTE_FRAME = 120;   // Haste Rain's timer set (0x11b3740, the literal 120.0)

// a stance's motion as the game plays it: a pitch variant is its main's (PITCH_MAIN)
export function bowMotion(set, n){ return (PITCH_MAIN[set] && PITCH_MAIN[set][n]) || +n; }
function stanceKey(stance){
  const m = /Motion\[(\d+)\]/.exec((stance && stance.clip) || '');
  if (!m) return null;
  const set = /_sa\./.test(stance.file || '') ? 'sa' : 'draw';
  return set + ':' + bowMotion(set, +m[1]);
}
const running = x => !(x.q.finished && x.q.finished());
// the holder's answer for a slot's effect on `host`: 3 at once (0x329c40(core, 1), the core's own kill), 2 the effect's own
// end (0x329c40(core, 0)); either way the schedule drops the request once it has run out (proof.js killRequest)
function stopOn(host, x, answer){
  const sc = host && host.live && host.live.schedule;
  if (!x || !sc || x.live !== host.live) return;
  try {
    if (answer === 3) sc.host.killRequest(x.q);
    else if (!x.q.stopped) sc.host.stopRequest(x.q);
  } catch (_) {}
}

// THE HOLDER, its slots on the hunter host (`hunter`, the page's)
export class BowEffects {
  constructor(){
    this.held = new Map();        // holder slot -> { q, key, host, live, level }
    this.haste = false;           // Haste Rain active (status lo 0x4000; the checkbox)
    this.hasteNow = false;        // the status this frame: the switch, or the Art's stance past its frame
    this.loadUp = false;          // the skill Load Up (the checkbox): player parameter 28 one higher
    this.charges = 3;             // the bow's open charge levels (weapon field 0xe)
    this.timer = 0;               // the charge, player +0x2b74 (frames)
    this.shotLevel = 0;           // the level the charge had when the stance that fires was entered
    this.stance = null;           // { key, f }
    this.hunter = null;           // the hunter host
  }
  // the holder goes with the class: every slot
  detach(){ for (const s of [...this.held.keys()]) this.release(s, 3); this.timer = 0; this.stance = null; }
  alive(x){ return !!x.host && x.live === x.host.live && running(x); }
  release(slot, answer){ const x = this.held.get(slot); this.held.delete(slot); if (x) stopOn(x.host, x, answer); }
  // 0x281ffc -> 0x44c164: flag 1 stops the slot's occupant at once and asks the row; flag 0 keeps an occupied slot's
  // effect, whatever row is asked
  ask(slot, row, key, flag){
    const x = this.held.get(slot);
    if (x && this.alive(x) && !flag) return x;
    if (x) this.release(slot, 3);
    const host = this.hunter;
    if (!host || !host.live || host.refused.has(key)) return null;
    const q = host.startState(key, row.efl, null);
    if (!q) return null;
    const y = { q, key, host, live: host.live };
    this.held.set(slot, y);
    return y;
  }
  // fire and forget (vtable +0x39c): the holder keeps nothing
  fire(row, key){
    const h = this.hunter;
    if (!h || !h.live || h.refused.has(key)) return null;
    return h.startState(key, row.efl, null);
  }
  setHaste(on){ this.haste = !!on; return this.haste; }
  setLoadUp(on){ this.loadUp = !!on; return this.loadUp; }
  // player parameter 28 (the parameter filler's case 0xe5f70): weapon field 0xe, one more with LOAD UP (skill effect 0x89,
  // skillData_eng.gmd "Load Up": "Bow charge levels") or 0x134 (Clandestine), at most 4
  levels(){ return Math.min((this.charges || 3) + (this.loadUp ? 1 : 0), 4); }
  // vtable +0x7e8: the level the timer gives, capped (player parameter 28 - 1; 2 in the charge of Aiming Mode, acts 53 / 60)
  cap(key){ return CAP2.has(key) ? 2 : Math.max(0, this.levels() - 1); }
  levelOf(key){ return Math.min(Math.floor(this.timer * (this.hasteNow ? 1.25 : 1) / 60 + 1e-6), this.cap(key)); }
  // 0x11b44ac: the timer that gives a level (60 frames a level; x 0.8, rounded up, under Haste Rain)
  timerFor(level){ return this.hasteNow ? Math.ceil(Math.fround(60 * level * 0.8)) : 60 * level; }
  // slot 0 asked with flag 1 for the level 1..3 (row 0, level 0, is nothing)
  askGlow(lv){
    if (lv < 1 || lv > 3){ this.release(0, 3); return null; }
    const y = this.ask(0, ROWS.charge, ROWS.charge.keys[lv - 1], true);
    if (y) y.level = lv;
    return y;
  }
  // every frame: `cls` the class in the hand (null otherwise), `stance` / `time` the weapon stance, `advance` the seconds of
  // animation since the last frame, `drawn` the rig's fact
  step(cls, stance, time, advance, drawn){
    for (const [s, x] of this.held) if (!this.alive(x)) this.held.delete(s);
    if (cls !== 'w10'){ if (this.held.size || this.timer) this.detach(); return; }
    const key = drawn && stance ? stanceKey(stance) : null;
    // the motion frame, as the ROM counts it (whole steps of 1.0: the seconds' float noise off); a segment starts on a whole
    // frame of its motion, which its t0 holds rounded to 1e-4 s (Motion[105]_loop's 2.3333 is frame 140)
    const f0 = key ? Math.round((stance.t0 || 0) * 60) : 0;
    const f = key ? f0 + Math.round((time || 0) * 60 * 1000) / 1000 : 0;
    const prev = this.stance;
    const entered = !(prev && prev.key === key && f >= prev.f);
    // a stance the page LOOPS (its Loop button) comes round with time still passing: the action goes on (a hold keeps
    // charging), where a stance played again starts with none
    const wrapped = entered && !!prev && prev.key === key && (advance || 0) > 0;
    // the frames of the motion this frame played: the clock's step across a loop's wrap, else the motion frame's own move
    // (the page's clock reads 0 across a clip change -- a `_start` into its `_loop`, one stance into another)
    const played = !entered ? f - prev.f : wrapped ? (advance || 0) * 60 : f - f0;
    const from = entered ? -1 : prev.f;
    this.stance = key ? { key, f } : null;
    const crossed = at => from < at && f >= at;
    // HASTE RAIN's status: the switch, or its Art's own stance past the frame its timer is set
    this.hasteNow = this.haste || (key === HASTE_STANCE && f >= HASTE_FRAME);
    const keep = KEEP.has(key);
    // a stance that does not keep the charge ends it: the level it had is the shot's (and the policy stops the glow at once)
    if (entered && !keep){ this.shotLevel = this.levelOf(prev && prev.key); this.timer = 0; }
    if (this.held.has(0) && !keep) this.release(0, 3);
    // THE CHARGE: a charge starts when its motion is entered from one that does not keep it -- a `_loop` segment's motion
    // frames before it are the draw that led to it -- and runs on the stance's own clock where the action charges: the
    // timer is the frames charged, so the level rises at motion frame 60 / 120 / 180 of a draw (the order of the motion's
    // frame and the action's step inside one game frame is not read: one frame either way). The same stance played again
    // is a new draw too: the last charge's glow goes with it
    const set = SETS[key];
    const fresh = entered && keep && (!prev || !KEEP.has(prev.key) || (prev.key === key && !wrapped));
    if (fresh){ this.release(0, 3); this.timer = CHARGE.has(key) && !set ? Math.min(TIMER_MAX, f) : 0; }
    else if (entered && !wrapped && ZERO.has(key)) this.timer = 0;
    // vtable +0x7f8, as the ROM orders it: the level before this frame's step (a fresh charge rose from 0 -- a segment's
    // earlier frames included), the action's own level set first and no rise in itself, then the step and the level after.
    // A timer just set (a fresh charge, a level set) already stands at this frame
    let old = fresh ? 0 : this.levelOf(key), counted = fresh;
    if (set && crossed(set.at)){
      this.timer = Math.min(TIMER_MAX, this.timerFor(set.level === 'act' ? (this.hasteNow ? 3 : 2) : set.level) +
                                       (CHARGE.has(key) ? Math.max(0, f - set.at) : 0));
      old = this.levelOf(key); counted = true;
    }
    if (CHARGE.has(key) && !counted) this.timer = Math.min(TIMER_MAX, this.timer + played);
    if (keep){
      const lv = this.levelOf(key);
      if (set && crossed(set.ask)) this.askGlow(lv);                // the action's own ask
      else if (CHARGE.has(key) && lv > old) this.askGlow(lv);       // a rise
    }
    // THE SHOTS, fire and forget at their motion frame, at the level the charge reached
    const s = SHOTS[key];
    if (s && crossed(s.at)){
      if (s.row) this.fire(s.row, s.row.key);
      else {
        let lv = s.level != null ? s.level : this.shotLevel;
        if (s.by === 'power') lv = Math.min(lv + 1, this.cap(key), 3);
        if (lv >= 0 && lv <= 3) this.fire(ROWS.shot, ROWS.shot.keys[lv]);
      }
    }
    // THE HOOK: Haste Rain's aura (flag 0) while its status stands and the bow is drawn; the policy's code 11 ends it at once
    // when the status falls
    if (this.hasteNow && drawn) this.ask(6, ROWS.haste, ROWS.haste.key, false);
    if (this.held.has(6) && !this.hasteNow) this.release(6, 3);
  }
  stats(){
    const held = {};
    for (const [k, x] of this.held) held[k] = { key: x.key, running: running(x), level: x.level,
                                                shown: x.q && x.q.m && x.q.core ? x.q.m.u8(x.q.core + 0x1c1) : null };
    const key = this.stance && this.stance.key;
    return { timer: +this.timer.toFixed(2), level: this.levelOf(key), shotLevel: this.shotLevel, charges: this.charges,
             loadUp: this.loadUp, levels: this.levels(), haste: this.haste, hasteNow: this.hasteNow,
             held, stance: key };
  }
}
