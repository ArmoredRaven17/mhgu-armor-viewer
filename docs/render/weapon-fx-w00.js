// THE GREAT SWORD'S EFFECTS: what uPlayerQuest00's code asks its effect holder for, and when -- FIRST PASS.
//
// Raven, 2026-10-01: "Next weapon" (the Insect Glaive was read and parked: most of what it shows is the kinsect's;
// build/notes/insect-glaive-effects.md). Read from the ROM (build/notes/great-sword-effects.md; efx/player/w00). Every
// address is exefs/main. The class's motion schedule (docs/effects/w00.json clips) runs on the hunter host like every
// class's; this module is the charge's glow and the releases' flashes.
//
// THE CLASS: uPlayerQuest00, vtable 0x1742a28, own code 0x115cb20..0x1165c74; the switch vtable +0x324 = 0x115d88c (table
// 0x115d8b8, 104 cases). Every request goes on the player's own block +0x2550 (the HUNTER).
// THE CHARGE: the timer player +0x2b74 (frames) and the level +0x2b70 bits 16..18 (vtable +0x7e8; set by +0x7e4). THE STEP
// 0x1164e74(kind): adds the frame (0x2aca98, 2000 at most), counts the thresholds the timer has passed -- class
// parameters (player\param\pl_w00 floats) from index 1 for most kinds: 50 / 100 / 140 frames; kind 0 has a FOURTH, 160,
// past which the level drops back to 2 (THE OVERCHARGE; not in the Striker style, vtable +0x168 == 1), kind 5 four from
// index 46 (50 / 90 / 120 / 140), kind 10 (an Art) by the Art's level -- each scaled by vtable +0x7fc (the charge
// skills) -- and on a RISE asks the glow 0x1164ce8(kind): slot 0, flag 1, rows 0..2 = w00_000 500 / 501 / 502
// (cm001_500.efl) for the level 0..2, level 3 row 3 = 503 for kinds 0 / 5 (row 4 = 504 in the Striker style), row 4 =
// 504 for kinds 1..4; kind 6 rows 30..33 (510..512, 514: cm001_510), kind 10 rows 14..16 (w00_800 900..902).
// KIND 0 is act 58 (0x115e624: its subs play a per-sub motion, then Motion[101]): the charge runs while the button is held
// from motion frame 34 (Motion[101]), 0 (Motion[118], sub 3) or 2 (Motion[124], sub 5); the first time the timer stands
// at float 0 = 25 frames it asks the glow by the level (row 0 = 500), then the step's rises. Released, it goes to act 27 /
// 28 / 29 (Motion[128] / [129] / [130]: the sub's hold 101 / 118 / 124).
// THE RELEASES (0x115ed04, acts 27..29): at their start vtable +0x8a8(0) ends the glow (0x1165758: by itself unless the
// level is 1 and +0x2b72 & 0x38 stands) and fire and forget by the level: 1 row 6 = 505, 2 row 29 = 506, 3 row 7 = 507, the
// overcharge's 4th entry 506, level 0 nothing.
// ROW 5 = cm002_002 200 (cm002_007): the base sharpening (weapon type 0) at Motion[255] frame 274.
// NOT WIRED (first pass): kinds 1 / 3 / 4 / 5 / 6 / 10 (acts 80 / 70 / 71, 89 / 73 / 76, 86 / 63: the other charges, the
// Strong / True Charged Slashes' families, an Art); the other releases' fires by level (acts 60, 61, 74, 87, 88, 93, 94,
// 103: Motion[135] / [150] / [190] ...); the Arts' rows (w00_800 810..823, 903, 910..933, 1010..1022); the shell
// pl_w00_100; the charge skills; the Striker style's 504.

export const ROWS = {
  glow: { keys: [500, 501, 502, 503], efl: 'cm001_500' },     // rows 0..3
  release: { 1: 505, 2: 506, 3: 507, efl: 'cm001_500' },      // rows 6 / 29 / 7
  sharpen: { key: 200, efl: 'cm002_007' },                     // row 5 (cm002_002)
};
export const PLAYER_REQUESTS = {
  'draw:255': [{ at: 274, key: ROWS.sharpen.key, efl: ROWS.sharpen.efl }],   // the sharpening (weapon type 0)
};
// kind 0's holds, from the motion frame the charge runs
const CHARGE = { 'draw:101': 34, 'draw:118': 0, 'draw:124': 2 };
const THRESHOLDS = [50, 100, 140];      // pl_w00 floats 1..3
const OVERCHARGE = 160;                 // float 4: kind 0's fourth, the level back to 2
const FIRST_GLOW = 25;                  // float 0: the first ask (level 0)
const TIMER_MAX = 2000;                 // 0x2aca98
const RELEASES = new Set(['draw:128', 'draw:129', 'draw:130']);   // acts 27 / 28 / 29

function stanceKey(stance){
  const m = /Motion\[(\d+)\]/.exec((stance && stance.clip) || '');
  return m ? (/_sa\./.test(stance.file || '') ? 'sa:' : 'draw:') + (+m[1]) : null;
}
const running = x => !(x.q.finished && x.q.finished());
function stopOn(x, answer){
  const host = x && x.host, sc = host && host.live && host.live.schedule;
  if (!sc || x.live !== host.live) return;
  try {
    if (answer === 3) sc.host.killRequest(x.q);
    else if (!x.q.stopped) sc.host.stopRequest(x.q);
  } catch (_) {}
}

// THE HOLDER's slot 0 on the hunter host (`hunter`, the page's)
export class GreatSwordEffects {
  constructor(){
    this.held = new Map();        // holder slot -> { q, key, host, live }
    this.timer = 0;               // +0x2b74 (frames)
    this.level = 0;               // the level bits (+0x2b70 16..18)
    this.asked = false;           // the first ask made (the phase word's top byte)
    this.shotLevel = 0;           // the level when a stance that does not charge was entered
    this.stance = null;           // { key, f }
    this.fired = [];
    this.hunter = null;
  }
  detach(){ for (const s of [...this.held.keys()]) this.release(s, 3); this.timer = 0; this.level = 0; this.asked = false; this.stance = null; }
  alive(x){ return !!x.host && x.live === x.host.live && running(x); }
  release(slot, answer){ const x = this.held.get(slot); this.held.delete(slot); if (x) stopOn(x, answer); }
  ask(slot, key, efl){
    if (this.held.has(slot)) this.release(slot, 3);
    const host = this.hunter;
    if (!host || !host.live || host.refused.has(key)) return null;
    const q = host.startState(key, efl, null);
    if (!q) return null;
    const y = { q, key, host, live: host.live };
    this.held.set(slot, y);
    return y;
  }
  fire(key, efl){
    const h = this.hunter;
    if (!h || !h.live || h.refused.has(key)) return null;
    const q = h.startState(key, efl, null);
    if (q){ this.fired.push(key); if (this.fired.length > 12) this.fired.shift(); }
    return q;
  }
  // the step's count of thresholds passed (kind 0: the fourth drops it back to 2)
  levelOf(t){
    let n = 0;
    for (const v of THRESHOLDS) if (t >= v) n++;
    if (n === 3 && t >= OVERCHARGE) n = 2;
    return n;
  }
  askGlow(){ const l = Math.min(this.level, 3); return this.ask(0, ROWS.glow.keys[l], ROWS.glow.efl); }
  // every frame: `cls` the class in the hand (null otherwise), `stance` / `time` the weapon stance, `advance` the seconds of
  // animation since the last frame, `drawn` the rig's fact
  step(cls, stance, time, advance, drawn){
    for (const [s, x] of this.held) if (!this.alive(x)) this.held.delete(s);
    if (cls !== 'w00'){ if (this.held.size || this.timer) this.detach(); return; }
    const key = drawn && stance ? stanceKey(stance) : null;
    const f0 = key ? Math.round((stance.t0 || 0) * 60) : 0;
    const f = key ? f0 + Math.round((time || 0) * 60 * 1000) / 1000 : 0;
    const prev = this.stance;
    const entered = !(prev && prev.key === key && f >= prev.f);
    const wrapped = entered && !!prev && prev.key === key && (advance || 0) > 0;
    const from = !entered ? prev.f : wrapped ? f0 - 1e-6 : -1;
    this.stance = key ? { key, f } : null;
    const fresh = entered && !wrapped;
    const start = CHARGE[key];
    if (fresh){
      if (start == null){
        // leaving the charge: the level is the release's; a release ends the glow by itself, anything else at once
        this.shotLevel = this.level;
        if (this.held.has(0)) this.release(0, RELEASES.has(key) ? 2 : 3);
        this.timer = 0; this.level = 0; this.asked = false;
      } else if (!(prev && CHARGE[prev.key] != null)){ this.timer = 0; this.level = 0; this.asked = false; }
    }
    // THE CHARGE (kind 0), from its frame: the first ask at 25 frames, then a rise asks
    if (start != null && f >= start){
      this.timer = Math.min(TIMER_MAX, this.timer + Math.max(0, f - Math.max(from, start)));
      const l = this.levelOf(this.timer);
      if (!this.asked && this.timer >= FIRST_GLOW){ this.asked = true; this.level = l; this.askGlow(); }
      else if (this.asked && l > this.level){ this.level = l; this.askGlow(); }
      else this.level = l;
    }
    // THE RELEASES at their start, by the level the charge had
    if (RELEASES.has(key) && fresh && f0 === 0){
      const k = ROWS.release[this.shotLevel];
      if (k) this.fire(k, ROWS.release.efl);
    }
  }
  stats(){
    const held = {};
    for (const [k, x] of this.held) held[k] = { key: x.key, running: running(x),
                                                shown: x.q && x.q.m && x.q.core ? x.q.m.u8(x.q.core + 0x1c1) : null };
    return { timer: +this.timer.toFixed(2), level: this.level, shotLevel: this.shotLevel, asked: this.asked,
             fired: this.fired.slice(), held, stance: this.stance && this.stance.key };
  }
}
