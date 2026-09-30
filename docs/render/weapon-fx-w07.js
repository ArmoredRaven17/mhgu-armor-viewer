// THE LONG SWORD'S EFFECTS: what uPlayerQuest07's code asks its effect holder for, and when.
//
// Raven, 2026-09-30: "Okay, next weapon" (the Long Sword, the board's next by the ROM count; its Spirit Gauge shipped in
// d22aa857). Read from the ROM the way the Lance was (build/notes/long-sword-effects.md; weapon-effects-guide.md). Every
// address is exefs/main. The class's motion schedule (docs/effects/w07.json clips) runs on the hunter host like every
// class's; this module is what the schedule does not cover: the class's holder requests and the Art's state.
//
// THE CLASS: uPlayerQuest07, vtable 0x1745f04, own code 0x11958a8..0x119c9f8; the action switch (vtable +0x324 =
// 0x11966e8, on +0x250a) has 154 actions, every case `mov r1, #sub; [mov r2, #x;] b shared` into a start function
// (efx/player/w07/data/actions.py). Seventeen holder requests in the class (efx/player/holdersites.py), every one through
// the PLAYER's own block (+0x2550, no overrides) but Devouring Demon's two, which build a block on the WEAPON unit:
//   * ROW 0 = w07_000 511 (w07_500.efl) at the start of the action's motion (the motion set, then vt+0x39c code 0),
//     for the subs that ask it -- 0x1197aa0 (subs 0, 2, 4, 6: 5104, 5125, 5126, 5126), 0x1197d8c (0, 1: 5106, 5124),
//     0x1198008 (0..3: 5108, 5119), 0x11981f8 (0, 2: 5130), 0x119894c (0: 5234, 2: 5153), 0x1198c5c (0: 5235, 2:
//     5155), 0x1198fcc variant 0 (5232, 5126 from frame 10, 5152, 5104 from 10), 0x119a794 (0: 5237, 2: 5176),
//     0x119ad40 (all: 5186), 0x119b368 (all: 5185); and 0x1198510 sub 0 at motion frame 12 of 5127 (0x2804ec)
//   * ROW 8 = w07_000 515 (cm001_021) at the start of the actions that arm the timer +0x2528 (0x282140(self, 0x1d)) and
//     the status 0x10 (0x282b08): 0x1198fcc variant 2 (5232, 5126 from 10, 5152, 5104 from 10) and 0x119af48 (5192,
//     5187, 5125)
//   * ROW 9 = w07_000 520 (cm001_520) at the start of 5131 (0x119b208)
//   * ROW 2 = cm002_002 204 (cm002_007): the base sharpening (0x2d5e74, Motion[255]) at frame 274, type 7 -> row 2
//   * ROW 1 = w07_000 510: vtable +0x73c (0x119bcb4), called by the base when the Spirit Gauge (+0x2780) FILLS to 100
//     (0x2a28dc, weapon type 7); it asks once and holds off for +0x3334. NOT WIRED: the viewer lands no hits
//   * ROW 7 = w07_800 910 (cm123_073): nothing in the class, the holder or the base asks it (the policy keeps code 7)
//   * the shell pl_w07_100 (id 0x2d; rows 800..802 = w07_800 by the Art's level): made by Sakura Slash's acts 54 / 62
//     WHEN A SLASH CONNECTS (+0x30d4, the hit target +0x30d0), at the hit's position. NOT WIRED: no hits
//   A STANCE IS A MOTION, NOT AN ACTION: where the actions entering a motion at frame 0 ask different rows -- 5125, 5152
//   and 5232 are each played by a plain action asking row 0 and by the status-0x10 action asking row 8 -- the table
//   fires the plain action's row; a motion only the status actions play (5187, 5192) fires row 8.
// THE HUNTER ARTS (eng/table/hunterArtsData_eng.gmd, 4 strings a tier): Sakura Slash 0x5f..0x61, Unhinged Spirit
// 0x62..0x64, Critical Juncture 0x65..0x67, DEVOURING DEMON 0x68..0x6a.
//   * DEVOURING DEMON (act 90, 0x119a134, Arts Motion[151] = 7151): at its start the action asks holder slot 4 row 6 =
//     w07_800 920 (cm123_074) on the WEAPON unit (a block whose parent +0xe0 is the weapon part's vt+0x130 handle, +0x2c
//     |= 2; 0x281ffc flag 1). At MOTION FRAME 190 it arms the state -- +0x3340 = the level's duration (0x282140(self,
//     0xd + level) x 60, x1.2 when 0x2a25f4(self, 0x68 + level)), +0x3344 = level + 1 -- asks slot 3 row 3 + level =
//     w07_800 900 / 901 / 902 (cm123_070) on the weapon, and stops slot 4 at once (0x282050(self, 4, 1) -> the holder's
//     vt+0x15c). The level is the Art's own (+0x2764, 0..2).
//   * THE HOLDER uShellPlEffectW07 (vtable 0x1756c80): its hook (+0x14c = 0x454bcc) asks slot 3 code 3 + (+0x3344 - 1)
//     on the weapon every frame the player's status 0x100 stands (vtable +0x1b8(self, 0, 0x100)) -- idempotent; its
//     policy (+0x160 = 0x454c8c) keeps codes 3..5 while that status stands, else 2 (they end on their own); code 6 while
//     the player is in action 90 (0x282930(self, 0x10, 0x5a)), else 2; code 7 always; anything else 3. NOTHING TESTS THE
//     WEAPON ON THE BACK: the aura stays on the sheathed sword, as Chaos Oil's does.
//   The viewer has no Art timer: the state is the select "Devouring Demon" in the Weapon panel, the user's alone; the Art's
//   own stance asks its rows by that select's level (level I when off), and never sets it.
// THE HOLDER'S ROWS (shell/pleffect/effect_w07): 0 w07_000 511 | 1 510 | 2 cm002_002 204 | 3..5 w07_800 900..902 | 6 920
// | 7 910 | 8 w07_000 515 | 9 520.
import * as THREE from 'three';
import { WeaponEffects } from './weapon-fx.js';

const R0 = { at: 0, key: 511, efl: 'w07_500' };
const R8 = { at: 0, key: 515, efl: 'cm001_021' };
// The player's requests by stance (render/weapon-fx.js PlayerRequests runs them on the hunter host).
export const PLAYER_REQUESTS = {
  'draw:104': [R0], 'draw:106': [R0], 'draw:108': [R0], 'draw:119': [R0], 'draw:124': [R0],
  'draw:125': [R0],                                   // act 18 (row 0); act 132 plays it too, asking row 8
  'draw:126': [R0], 'draw:130': [R0],
  'draw:152': [R0],                                   // act 76 (row 0); act 151 plays it too, asking row 8
  'draw:153': [R0], 'draw:155': [R0], 'draw:176': [R0], 'draw:185': [R0], 'draw:186': [R0],
  'draw:232': [R0],                                   // act 42 (row 0); act 148 plays it too, asking row 8
  'draw:234': [R0], 'draw:235': [R0], 'draw:237': [R0],
  'draw:127': [{ at: 12, key: 511, efl: 'w07_500' }],  // act 30, at motion frame 12 (0x1198510)
  'draw:187': [R8], 'draw:192': [R8],
  'draw:131': [{ at: 0, key: 520, efl: 'cm001_520' }],
  'draw:255': [{ at: 274, key: 204, efl: 'cm002_007' }],   // the sharpening, type 7 -> row 2
};

export const DEVOURING_DEMON = { keys: [900, 901, 902], efl: 'cm123_070', start: { key: 920, efl: 'cm123_074' }, arm: 190 };
const ART_STANCE = 'Motion[151]';

// DEVOURING DEMON on the WEAPON unit (the sword's bone 0, as Chaos Oil's host: render/weapon-fx-w01.js ChaosOilEffects).
// `level` is the state (the select): 0 off, 1..3. Slot 3 holds the level's aura while the state stands; the Art's stance
// asks slot 4 (920) at its start and slot 3 at frame 190, and gives them up when it ends (the policy's 2).
export class DevouringDemonEffects extends WeaponEffects {
  constructor(){
    super();
    this.unitRoot = null;
    this.level = 0;
    this.slots = new Map();       // holder slot -> { q, key, live, by: 'state' | 'stance' }
    this.lastSync = null;
    this.art = null;              // the Art's stance playing: { t, from } (motion frames), else null
  }
  makeHost(roots){
    const part = roots && roots[0];
    const node = part ? (part.userData.bone || part) : null;
    const host = new THREE.Group();
    host.name = 'devouring-demon-fx-host';
    host.userData.gidBones = node ? [{ gid: 0, node, d: 0 }] : [];
    host.userData.joints = [];
    return host;
  }
  // rows 3..6, each on joint 0 (the only bone): records at joint -1 on the unit itself (rom/effect/live.js unitFromOrigin)
  useDef(def){
    const keys = new Set([...DEVOURING_DEMON.keys, DEVOURING_DEMON.start.key]);
    return Object.assign({}, def, { clips: {}, parentOrder: 0x30000, unitFromOrigin: true,
      effects: (def.effects || []).filter(e => e.when === 'state' && e.record && e.record.array === 'UNIQUE' && keys.has(e.record.key) &&
                                                !this.refused.has(e.record.key))
                                  .map(e => Object.assign({}, e, { joints: [0] })) });
  }
  // the sword part, drawn or on the back
  async sync(cls, roots, parent){
    const part = (roots && roots[0]) || null;
    if (cls !== 'w07' || !part || !this.on){ if (this.live || this.unitRoot) this.detach(); this.unitRoot = null; this.lastSync = null; return null; }
    this.lastSync = { cls, roots: [part], parent };
    if (this.cls === cls && this.live && this.unitRoot === part) return this.live;
    this.unitRoot = part;
    return this.attach(cls, [part], parent);
  }
  detach(){ this.slots.clear(); super.detach(); }
  setLevel(level){
    level = Math.max(0, Math.min(3, level | 0));
    if (level === this.level) return this.level;
    this.level = level;
    const x = this.slots.get(3);
    if (x && x.by === 'state') this.release(3, 2);   // the state dropped or changed: its aura ends on its own
    this.stepState();
    return this.level;
  }
  // the holder's answer for a slot: 3 at once, 2 the effect's own end
  release(slot, answer){
    const x = this.slots.get(slot), sc = this.live && this.live.schedule;
    this.slots.delete(slot);
    if (!x || !sc || x.live !== this.live) return;
    try {
      if (!x.q.stopped) sc.host.stopRequest(x.q);
      if (answer === 3){ sc.host.releaseRequest(x.q); for (const e of sc.entries) e.requests = e.requests.filter(q => q !== x.q); }
    } catch (_) {}
  }
  // 0x281ffc with flag 1: an occupied slot's effect goes at once, then the row is asked
  ask(slot, key, efl, by){
    const x = this.slots.get(slot);
    if (x && x.key === key && x.live === this.live && !(x.q.finished && x.q.finished())){ x.by = by; return x.q; }   // the same code: nothing
    if (x) this.release(slot, 3);
    if (this.refused.has(key)) return null;
    this.lastRequested = key;
    const q = this.startState(key, efl, null);
    if (q) this.slots.set(slot, { q, key, live: this.live, by });
    return q;
  }
  // the hook: while the state stands, slot 3 holds the level's row (idempotent)
  stepState(){
    for (const [s, x] of this.slots) if (x.live !== this.live || (x.q.finished && x.q.finished())) this.slots.delete(s);
    if (!this.level || !this.live) return;
    this.ask(3, DEVOURING_DEMON.keys[this.level - 1], DEVOURING_DEMON.efl, 'state');
  }
  // the Art's own stance (Arts Motion[151]) on the class in the hand: `stance` { file, clip, t0 }, `time` in seconds
  stepArt(cls, stance, time){
    const on = cls === 'w07' && stance && /_sa\./.test(stance.file || '') && stance.clip === ART_STANCE;
    if (!on){
      if (this.art){
        this.art = null;
        const s4 = this.slots.get(4); if (s4) this.release(4, 2);                    // code 6: not in action 90 -> 2
        const s3 = this.slots.get(3); if (s3 && s3.by === 'stance'){ this.release(3, 2); this.stepState(); }
      }
      return;
    }
    const f = ((time || 0) + (stance.t0 || 0)) * 60;
    const from = this.art && f >= this.art.f ? this.art.f : -1;                     // a new action (or a wrap) starts over
    this.art = { f };
    if (!this.live) return;
    if (from < 0 && f >= 0){
      this.ask(4, DEVOURING_DEMON.start.key, DEVOURING_DEMON.start.efl, 'stance');
    }
    if (from < DEVOURING_DEMON.arm && f >= DEVOURING_DEMON.arm){
      const lv = Math.max(1, this.level || 1);
      this.ask(3, DEVOURING_DEMON.keys[lv - 1], DEVOURING_DEMON.efl, this.level ? 'state' : 'stance');
      const s4 = this.slots.get(4); if (s4) this.release(4, 3);                    // 0x282050(self, 4, 1): at once
    }
  }
  // every frame: the host's clock is the animation's
  step(time, advance){
    if (this.live && this.live.failed){
      if (this.lastRequested != null) this.refused.add(this.lastRequested);
      console.warn('devouring demon: record ' + this.lastRequested + ' refused, dropped for this session');
      this.detach(); this.unitRoot = null;
      if (this.lastSync) this.sync(this.lastSync.cls, this.lastSync.roots, this.lastSync.parent);
      return;
    }
    if (!this.live) return;
    this.stepClip(null, time, advance);
    this.stepState();
  }
  stats(){
    const s = {};
    for (const [k, x] of this.slots) s[k] = { key: x.key, by: x.by, running: !(x.q.finished && x.q.finished()) };
    return Object.assign(super.stats(), { unit: !!this.unitRoot, level: this.level, slots: s, art: this.art ? Math.round(this.art.f) : null });
  }
}
