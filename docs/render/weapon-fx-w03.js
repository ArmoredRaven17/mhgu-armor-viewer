// THE LANCE'S EFFECTS: what uPlayerQuest03's code asks its effect holder for, and when.
//
// Raven, 2026-09-30: "Do Lance next", and "Lance will have some effects similar to LS and SnS. Enraged Guard has a multi
// level effect, it has Healing Shield as well." Read from the ROM the way the Sword & Shield was (build/notes/
// lance-effects.md; build/notes/weapon-effects-guide.md). Every address is exefs/main. The class's motion schedule
// (docs/effects/w03.json clips) runs on the hunter host like every class's; this module is what the schedule does not
// cover: the class's holder requests, the holder's own hook, and the Art states.
//
// THE CLASS: uPlayerQuest03, vtable 0x1744490, own code 0x1173cfc..0x117b43c, 558 slots (+0x8b0 / +0x8b4 its own); the
// action switch (vtable +0x324 = 0x1174504, on +0x250a) has 125 actions whose cases tail into shared blocks or start
// functions. Nine holder requests (the reads of vtable +0x39c and the calls of 0x281ffc in the range), no request blocks
// (0x40a54), two shell creations (0x48b884). Every request goes through the PLAYER's own block (+0x2550, no overrides):
//   * the charge, acts 110 (0x117533c) and 69 (0x1175924): Motion[101] then the run, Motion[102]; the run's periodic hit
//     timer, and the first time the run comes round its end (0x94dc04: the motion controller's end flag) with the
//     action's flag byte +7 clear, the flag is set, the hit interval becomes 1.2 and row 0 = w03_000 510 is asked
//   * act 17 (0x1176754; acts 122..124 run the same function): at its start row 12 = w03_000 515, for every sub; subs 0
//     and 3 play Motion[120] (sub 3 from frame 4), subs 1 and 2 Motion[136] and then Motion[120] from frame 4. Its first
//     frame on Motion[120] calls vtable +0x8b0 (0x117a8f0): holder slot 0, row 1 = w03_000 500 before motion frame 42,
//     row 2 = 501 from it (0x281ffc, flag 1); called again when the motion crosses frame 48, which puts 501 in. The
//     holder's policy (0x453340) keeps codes 1 / 2 while the action is 17 or 122..124, else answers 3: at once
//   * act 18 (0x1176a10), Motion[121]: row 3 = w03_000 505 at its start
//   * act 121 (0x1176c70), subs 1..3: row 16 = w03_000 650 at its start; the subs play Motion[119], [117], [117] (table
//     0x181eb70; sub 0, Motion[118], asks nothing). ACT 39 (0x1176b70) ALSO PLAYS Motion[117] FROM ITS FIRST FRAME and asks
//     nothing: the stance cannot say which, and this table fires act 121's row
//   * the class's guard-hit handler (vtable +0x590 = 0x117aabc), a blocked hit of tier 0 / 1 in acts 17 / 122..124: row 4
//     = w03_000 520 as it moves on to acts 20 / 33 / 34 / 21. NOT WIRED: the viewer blocks no hits
//   * the base sharpening (0x2d5e74, Motion[255]) at frame 274 asks the row its jump table gives type 3: row 11 =
//     cm002_002 203 (cm002_007.efl)
// THE HUNTER ARTS (eng/table/hunterArtsData_eng.gmd, by the ids the code tests): Shield Assault 0x2f..0x31, Corkscrew Jab
// 0x32..0x34, ENRAGED GUARD 0x35..0x37, HEALING SHIELD 0x38..0x3a.
//   * ENRAGED GUARD. The stance: acts 74..79 (Arts Motion[52], [101], [102], [103]); act 74 (0x1179538) creates the shell
//     uShellPlw03_100 (id 0x28) with the Art's LEVEL (+0x2764, 0..2) as its row -- pl_w03_100 rows 0..2 = w03_800
//     800..802 -- standing at the player's position (its init 0x46a640; it lives while the player's byte +0x13ad holds).
//     A hit blocked in the stance (vtable +0x590's branch for acts 75..78) goes to act 80 / 81 / 82 by the hit's TIER 0 /
//     1 / 2 (a hit of kind 1 or 8 caps at 81); the three run 0x11799e4 with that sub: Arts Motion[104] / [105] / [106],
//     +0x332c = the tier, and at motion frame 64 +0x3330 = the level's duration (0x282140(self, level + 9), x1.2 when
//     0x2a25f4(self, level + 0x35)) and holder slot 1 row 8 + tier = w03_800 900 / 901 / 902 (0x281ffc, flag 1). So the
//     three auras are the power ABSORBED, by how hard the blocked hit was; the Art's level only sets how long it lasts.
//     While +0x3330 runs, vtable +0x3e0 raises status lo 0x10, and the HOLDER'S OWN HOOK (vtable +0x14c = 0x453430)
//     asks slot 1 code 8 + tier every other frame while that status stands, the weapon is DRAWN (vtable +0x178) and
//     +0x2506 is not 0x800. Its policy for codes 8..10 writes the effect's byte +0x1c1 (0 = hidden) every frame: 0 while
//     the weapon's mount index is 2 or 0x12 -- ON THE BACK -- or the player is in common action 90, else 1; and keeps the
//     effect while the status stands, else answers 2 (it ends on its own).
//   * HEALING SHIELD. Act 99 (0x1179bf4), Arts Motion[151] for every level: at motion frame 190 +0x3338 = the level's
//     duration (0x282140(self, level + 0x10)); status lo 0x80000000 while it runs. The coat is the SHIELD's own look
//     (render/weapon-state.js LANCE_UP, render/weapon.js setShieldCoat). A hit blocked while it runs (vtable +0x880 =
//     0x117b330, the hit's byte +0x6d == 2) asks row 13 + level = w03_800 1000..1002 through vtable +0x8b4 (by the
//     level equipped in any Art slot) and the class's update creates the shell uShellPlw03_101 (id 0x29: dummy rows,
//     the heal's area). NOT WIRED: the viewer blocks no hits.
//   The viewer has no Art timer: the two states are controls in the Weapon panel, the user's alone (the Arts' stances do
//   not set them, as Chaos Oil's and Demon Riot's do not).
// THE HOLDER, uShellPlEffectW03 (vtable 0x1756680; shell/pleffect/effect_w03): rows 0 w03_000 510 | 1 500 | 2 501 |
// 3 505 | 4 520 | 5 (none) | 8..10 w03_800 900..902 | 11 cm002_002 203 | 12 w03_000 515 | 13..15 w03_800 1000..1002 |
// 16 w03_000 650. Its per-frame hook 0x453430, its stop policy 0x453340 (+0x160), its tracked request 0x44c164 (+0x158).

// The player's requests by stance (render/weapon-fx.js PlayerRequests runs them on the hunter host).
export const PLAYER_REQUESTS = {
  // act 17: row 12 at its start; slot 0 holds row 1 from the first frame of Motion[120] and row 2 from frame 48 (the
  // second call of +0x8b0), both ended at once when the action moves on (the policy's 3)
  'draw:120': [
    { at: 0, key: 515, efl: 'cm001_021' },
    { at: 1, key: 500, efl: 'cm001_500', slot: 0, stop: 3 },
    { at: 48, key: 501, efl: 'cm001_500', slot: 0, stop: 3 },
  ],
  'draw:136': [{ at: 0, key: 515, efl: 'cm001_021' }],            // act 17, subs 1 / 2: its start on Motion[136]
  'draw:121': [{ at: 0, key: 505, efl: 'cm001_500' }],            // act 18
  'draw:119': [{ at: 0, key: 650, efl: 'cm001_020' }],            // act 121, sub 1
  'draw:117': [{ at: 0, key: 650, efl: 'cm001_020' }],            // act 121, subs 2 / 3 (act 39 plays it too, asking nothing)
  'draw:102': [{ atEnd: true, once: true, key: 510, efl: 'w03_500' }],   // the charge's run, the first time it comes round
  'draw:255': [{ at: 274, key: 203, efl: 'cm002_007' }],          // the sharpening, type 3 -> row 11
  // ENRAGED GUARD: the stance's shell, its row by the Art's level; the absorb, its row by the tier, at frame 64 in holder
  // slot 1, left to end on its own when the stance changes (the policy's 2 with the state not standing -- the control's
  // held aura takes the slot back when it is on: EnragedGuard)
  'sa:52': [{ at: 0, keys: [800, 801, 802], efl: 'cm121_032' }],
  'sa:104': [{ at: 64, key: 900, efl: 'cm120_032', slot: 1, stop: 2 }],
  'sa:105': [{ at: 64, key: 901, efl: 'cm120_032', slot: 1, stop: 2 }],
  'sa:106': [{ at: 64, key: 902, efl: 'cm120_032', slot: 1, stop: 2 }],
};

export const ENRAGED_GUARD = { keys: [900, 901, 902], efl: 'cm120_032' };

// ENRAGED GUARD'S ABSORBED POWER, the holder's hook and policy, on the hunter host. `tier` is the control: 0 off, 1..3
// the power absorbed (rows 8..10). The hook asks only while the weapon is drawn; once asked, the effect lives while the
// state stands and the policy's byte hides it while the weapon is on the back. The absorb stances ask the same slot
// (PlayerRequests slot 1): while one of theirs holds it, this asks nothing and only writes the byte.
export class EnragedGuard {
  constructor(){
    this.host = null;          // the hunter host (render/weapon-fx.js WeaponEffects)
    this.requests = null;      // the page's PlayerRequests, for slot 1
    this.tier = 0;
    this.held = null;          // { q, key, live }
  }
  setTier(tier){
    tier = Math.max(0, Math.min(3, tier | 0));
    if (tier === this.tier) return tier;
    this.tier = tier;
    this.release(3);           // a new state here: the old aura goes at once (the hook's flag 1 on a new tier)
    return tier;
  }
  release(answer){
    const x = this.held, h = this.host, sc = h && h.live && h.live.schedule;
    this.held = null;
    if (!x || !sc || x.live !== h.live) return;
    try {
      if (!x.q.stopped) sc.host.stopRequest(x.q);
      if (answer === 3){ sc.host.releaseRequest(x.q); for (const e of sc.entries) e.requests = e.requests.filter(q => q !== x.q); }
    } catch (_) {}
  }
  // every frame: `cls` the class in the hand (null off it), `drawn` the player's drawn flag, `onBack` the weapon unit's
  // mount index test (render/weapon.js onBack)
  step(cls, drawn, onBack){
    const h = this.host, live = (h && h.live) || null;
    if (this.held && (this.held.live !== live || (this.held.q.finished && this.held.q.finished()))) this.held = null;
    const slot = cls === 'w03' && this.requests ? this.requests.slots.get(1) : null;
    const theirs = slot && slot.live === live && !(slot.q.finished && slot.q.finished()) ? slot.q : null;
    if (cls !== 'w03' || !this.tier){ if (this.held) this.release(2); }
    else {
      if (theirs && this.held) this.release(3);          // an absorb's 0x281ffc, flag 1: the slot's occupant goes at once
      if (!theirs && !this.held && drawn && live){
        const key = ENRAGED_GUARD.keys[this.tier - 1];
        if (!h.refused.has(key)){
          const q = h.startState(key, ENRAGED_GUARD.efl, null);
          if (q) this.held = { q, key, live };
        }
      }
    }
    // the policy's byte, every frame, on whichever effect holds slot 1 (codes 8..10)
    const q = theirs || (this.held && this.held.q);
    if (q && q.m && q.core) q.m.w8(q.core + 0x1c1, onBack ? 0 : 1);
  }
  stats(){
    return { tier: this.tier, held: this.held ? this.held.key : null,
             running: !!(this.held && !(this.held.q.finished && this.held.q.finished())) };
  }
}
