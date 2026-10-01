// THE HUNTING HORN'S EFFECTS: what uPlayerQuest12's code asks its effect holder for, and when.
//
// Raven, 2026-09-30: "Which weapon is next" (the Hunting Horn, the smallest left by the ROM count), "Keep in mind, Hunting
// Horns have different colored notes.", "Attacks with the Hunting Horn play these notes, along with their effect", "So, we
// have the note effects, the colors, the assignments", "Follow the ROM, no need for guessing". Read from the ROM the way the
// Lance and the Long Sword were (build/notes/hunting-horn-effects.md; efx/player/w12). Every address is exefs/main. The
// class's motion schedule (docs/effects/w12.json clips) runs on the hunter host like every class's; this module is what the
// schedule does not cover: the class's holder requests, their colours, and the Art's state.
//
// THE CLASS: uPlayerQuest12, vtable 0x1748b20, own code 0x11bf6e8..0x11c8360; the action switch (vtable +0x324 = 0x11bfeb4,
// on +0x250a, table 0x11bfed4) has 179 actions, every case `mov r1, #sub; [mov r2, #x;] b start` into 54 start functions
// (efx/player/w12/data/cases.py). Five holder requests (efx/player/holdersites.py), each through a request block built on
// the stack with the PLAYER as parent (vtable +0x130, +0x1c bit 1) -- all but row 11's carry the effect manager's colour
// slot 1 entry (resident pec_001) in the SECOND colour word (+0x94, +0x18 bit 6); no palette entry, no request -- and one
// shell creation (0x37 row 0 = pl_w12_000, a row with no effect: 0x11c1044).
//
// THE NOTES. A horn carries three notes, its note SET per level (table/weapon12LevelData.w12d +14 -> table/fueMusicData.fmt:
// docs/weapons/w12.json `notes`); the class reads note k as player parameter 0x1b + k (vtable +0x15c), a number 1..8 whose
// colour is pec_001 entry n - 1 (docs/weapons/w12-songs.json noteColours).
//   * AN ATTACK'S NOTE (row 1 = w12_000 500, w12_500.efl): an action that plays a note calls 0x11c6228(self, k) right after
//     it sets its motion -- the staff shifts (+0x3325 newest .. +0x3328), the note's sound is queued (0x4eeca4), the HUD is
//     told (0x664adc), and +0x333c = 10.0; the class's state runner (vtable +0x4e8 = 0x11c7b08) counts +0x333c down and
//     asks row 1 when it runs out, coloured by the NEWEST note (+0x3325). So 10 frames into the motion, in its note's
//     colour. Which note each action plays: efx/player/w12/data/notes.py (the game's own help text agrees: "Note 1: Left
//     Swing", "Note 2: Right Swing", "Note 3: Backward Strike"). A STANCE IS A MOTION: five motions are played by actions
//     that play different notes (5106, 5136, 5150, 5175, 5186, by the button); the table takes the lowest action's.
//     0x11c0d2c's note is 1 when vtable +0x168 (equipment byte +0x4d9) is 1, else 2: the viewer has no such state (0).
//   * A RECITAL'S NOTES (row 2 = 505, w12_501.efl; 0x11c1ac0, acts 29 / 30 / 75..77 / 115 on Motion[108] / [109] / [110]):
//     the song (+0x3330) is played back note by note, in play order, from the motion's frame 1 and every 40 / 30 / 25
//     frames (2 / 3 / 4 notes: rodata 0x16a8a10), each in its note's colour. Acts 146..151 / 175 (0x11c5c40) play the
//     same motions and ask nothing: the table takes the lowest action's (the recital).
//   * THE SONG EFFECT (rows 5 / 6 / 7 = 506 / 507 / 508 by the song's length, w12_502.efl; 0x11c69e4 mode 1): at frame 30 of
//     Motion[161] (0x11c41d8) and frame 40 of Motion[160] (0x11c48cc); row 8 = w12_800 806 (mode 0) at frame 20 of
//     Motion[162] (0x11c5370). The tracked, replacing holder slot 0 (vtable +0x3a0 -> 0x44c0c4); the policy (0x457568)
//     keeps codes 5..10 (answer 1: kept, the show byte untouched) -- it runs its own course. Its colour: the song's FIRST
//     note, then every 25 / 20 / 15 frames (rodata 0x16a8e98) the next note's (0x11c6b9c -> the holder's 0x45772c ->
//     the policy's 0x4575cc: the effect's unit +0x2d4, its live mesh particles re-tinted).
//   * EUPHONY (Arts Motion[1..3], acts 82..84; 0x11c2f60, the Art id 0x9b + level it hands 0x11c6e00): on Motion[2], looped
//     by the level, row 3 = 505 at frames 10 / 38 / 66 in the horn's notes 1 / 2 / 3 (+7 cycles 0..2).
// THE SONGS: table/fueMusicScData.fms (cFueMusicScBase mTone[0..3] + mMusicInfType; mTone[0] is the NEWEST note -- the
// matcher 0x11c63bc compares it with +0x3325 -- so a song plays mTone[count - 1] .. mTone[0]); names eng/table/
// fueMusicInfData_eng.gmd (string 3 * type). The class loads with song 0 (White-White) or 1 (Purple-Purple, when note 1
// is Purple): 0x11bf744..0x11bf800. The song is the user's control here: the viewer plays no notes into a staff.
// THE HUNTER ARTS (eng/table/hunterArtsData_eng.gmd): Euphony 0x9b..0x9d, Sonic Smash 0x9e..0xa0, Harmonize 0xa1..0xa3,
// Invigoration 0xa4..0xa6.
//   * INVIGORATION (act 110, Arts Motion[151]; 0x11c3648): +0x3340 = the level's duration (0x282140(self, level + 8), x1.2
//     when 0x2a25f4(self, 0xa4 + level)); status hi 0x400 while it runs (vtable +0x3e0 = 0x11c7e98). The class's per-frame
//     hook (vtable +0x690 = 0x11c60a8) asks row 11 = w12_800 1100 (cm123_122.efl) on the WEAPON unit (part slot 7's
//     handle; 0x281ffc slot 1, flag 0: idempotent) while vtable +0x490 (0x11c7e18) answers: the status, the weapon NOT ON
//     THE BACK (mount index | 0x10 != 0x12), and drawn (vtable +0x178; 0x2a1d28 adds a case only for equipment byte
//     +0x4d9 = 5). The policy keeps code 11 while that holds, else answers 2 (its own end). The state is the checkbox
//     "Invigoration active (Hunter Art)", the user's alone.
//   * HARMONIZE (acts 88..90, Arts Motion[101]; 0x11c34ac) arms +0x3334, which marks notes doubled in the staff
//     (0x11c62bc): nothing it asks. SONIC SMASH's shock wave is its schedule's (sa:51 / sa:52).
// THE HOLDER uShellPlEffectW12 (vtable 0x1757400; shell/pleffect/effect_w12): rows 0 cm002_002 208 | 1 w12_000 500 |
// 2 505 | 3 505 | 4 503 | 5 506 | 6 507 | 7 508 | 8 w12_800 806 | 9 807 | 10 808 | 11 1100. Row 0 is the base sharpening's
// (0x2d5e74: every weapon type above 11 -> row 0) at Motion[255] frame 274. Rows 4, 9 and 10: nothing asks them.
// NOT WIRED: the note Sonic Smash's follow-up (0x11c2bb4) plays at frame 40 by the buttons held (none without input), the
// weapon model's own triggers (the part update 0x3142ec: 0 / 1 / 26 / 27 on channel 8).
import * as THREE from 'three';
import { WeaponEffects } from './weapon-fx.js';

export const ROWS = {
  note: { key: 500, efl: 'w12_500' },            // row 1: an attack's note
  tune: { key: 505, efl: 'w12_501' },            // rows 2 / 3: a recital's notes, Euphony's
  song: { keys: [506, 507, 508], efl: 'w12_502' },   // rows 5..7 by the song's length (2 / 3 / 4)
  songAlt: { key: 806, efl: 'w12_502' },         // row 8: 0x11c69e4 mode 0
  sharpen: { key: 208, efl: 'cm002_007' },       // row 0: the base sharpening
  invigoration: { key: 1100, efl: 'cm123_122' }, // row 11, on the weapon unit
};
export const NOTE_DELAY = 10;                    // +0x333c = 10.0 (0x11c62ec..0x11c6304), counted down by 0x11c7b08

// THE NOTE AN ATTACK PLAYS, by stance: the horn's note index k (0 / 1 / 2). efx/player/w12/data/notes.py, one entry per
// motion; the five motions shared by actions of different notes take the lowest action's (the comment names them)
export const ATTACK_NOTES = {
  'draw:6': 0, 'draw:8': 1, 'draw:101': 1, 'draw:102': 0, 'draw:103': 2, 'draw:104': 1, 'draw:105': 1,
  'draw:106': 0,                   // acts 0 (note 1), 98 (none), 99 (1), 100 (2), 101 (3)
  'draw:107': 2, 'draw:130': 1, 'draw:131': 1, 'draw:132': 0, 'draw:133': 1, 'draw:134': 0, 'draw:135': 2,
  'draw:136': 2,                   // acts 17 (note 3), 52 (1), 53 (2), 54 (2), 55 (3), 71 (2)
  'draw:145': 1,
  'draw:150': 0,                   // acts 56 (note 1), 68 (2), 69 (3), 102 (1)
  'draw:151': 0, 'draw:155': 0, 'draw:157': 1, 'draw:158': 0, 'draw:159': 2,
  'draw:175': 0,                   // acts 78 (note 1), 79 (2), 80 (3), 105 (1)
  // 'draw:186': acts 94 (none), 95 (1), 96 (2), 97 (3) -> none
};
export const RECITAL_STANCES = ['draw:108', 'draw:109', 'draw:110'];
export const SONG_STANCES = { 'draw:161': { at: 30, alt: false }, 'draw:160': { at: 40, alt: false }, 'draw:162': { at: 20, alt: true } };
export const EUPHONY = { stance: 'sa:2', at: [10, 38, 66] };

let SONGS = null, songsLoad = null;
// docs/weapons/w12-songs.json (C:/MHGU-Extract/add-horn-songs.py): songs in play order, the note colours, the timings
export function loadSongs(){
  if (SONGS) return Promise.resolve(SONGS);
  if (!songsLoad) songsLoad = fetch('weapons/w12-songs.json?v=' + Date.now()).then(r => r.ok ? r.json() : null)
    .then(d => (SONGS = d)).catch(() => (SONGS = null));
  return songsLoad;
}
export function songs(){ return SONGS; }
// note number 1..8 -> the palette word (u32, bytes R G B A); undefined when the table has none (the ROM then asks nothing)
export function noteColour(n){
  const hex = SONGS && SONGS.noteColours[n - 1];
  return hex && /^[0-9a-f]{8}$/i.test(hex) ? parseInt(hex, 16) >>> 0 : undefined;
}
// the songs a horn can play: every song whose notes are all the horn's (the staff only ever holds the horn's notes)
export function playableSongs(notes){
  if (!SONGS || !notes) return [];
  return SONGS.songs.filter(s => s.notes.every(n => notes.includes(n)));
}
// the song the class loads with (0x11bf744: song 1 when note 1 is Purple (2), else 0)
export function defaultSong(notes){ return notes && notes[0] === 2 ? 1 : 0; }

// THE PLAYER'S REQUESTS BY STANCE for one horn and one song (render/weapon-fx.js PlayerRequests runs them on the hunter
// host): the attack notes, a recital's notes, Euphony's, the sharpening. Rebuilt when the horn or the song changes.
export function hornRequests(notes, songId){
  const t = {};
  const colour = n => { const c = noteColour(n); return c === undefined ? null : { colour2: c }; };
  if (notes){
    for (const [stance, k] of Object.entries(ATTACK_NOTES)){
      const r = colour(notes[k]);
      if (r) t[stance] = [{ at: NOTE_DELAY, key: ROWS.note.key, efl: ROWS.note.efl, requester: r }];
    }
    const eu = EUPHONY.at.map((at, k) => ({ at, k })).map(({ at, k }) => ({ at, r: colour(notes[k]) })).filter(x => x.r);
    t[EUPHONY.stance] = eu.map(({ at, r }) => ({ at, key: ROWS.tune.key, efl: ROWS.tune.efl, requester: r }));
  }
  const song = SONGS && SONGS.songs[songId];
  if (song){
    const count = song.notes.length, every = SONGS.noteInterval[count - 2];
    const list = song.notes.map((n, c) => ({ at: Math.max(1, c * every), r: colour(n) })).filter(x => x.r)
                           .map(({ at, r }) => ({ at, key: ROWS.tune.key, efl: ROWS.tune.efl, requester: r }));
    for (const s of RECITAL_STANCES) t[s] = list;
  }
  t['draw:255'] = [{ at: 274, key: ROWS.sharpen.key, efl: ROWS.sharpen.efl }];
  return t;
}

// THE SONG EFFECT on the hunter host (the player's parent): asked at its stance's frame, held in holder slot 0 (a new one
// stops the old at once), its colour stepped through the song's notes. `host` is the hunter host's WeaponEffects.
export class HornSong {
  constructor(){
    this.host = null;
    this.q = null; this.live = null;     // the song effect standing (slot 0)
    this.song = null; this.index = 0; this.timer = 0;
    this.stance = null;                  // { key, f } of the song-effect stance playing
    this.steps = 0;
  }
  release(answer){
    const q = this.q, h = this.host, sc = h && h.live && h.live.schedule;
    this.q = null;
    if (!q || !sc || this.live !== h.live) return;
    try {
      if (!q.stopped) sc.host.stopRequest(q);
      if (answer === 3){ sc.host.releaseRequest(q); for (const e of sc.entries) e.requests = e.requests.filter(x => x !== q); }
    } catch (_) {}
  }
  // `cls` the class in the hand (null otherwise), `stance` { file, clip, t0 }, `time` seconds, `songId` the user's song
  step(cls, stance, time, songId, advance){
    const h = this.host, live = (h && h.live) || null;
    if (this.q && (this.live !== live || (this.q.finished && this.q.finished()))){ this.q = null; }
    // the colour step (0x11c6b9c), every frame the effect stands: +0x2528 counted down, the next note's colour on expiry
    if (this.q && this.song && this.index < this.song.notes.length){
      this.timer -= advance == null ? 0 : advance * 60;          // frames of the animation's clock (none when it stands)
      if (this.timer <= 0){
        const c = noteColour(this.song.notes[this.index]);
        if (c !== undefined) this.recolour(this.q, c);
        this.index++;
        this.timer += SONGS.colourStep[this.song.notes.length - 2];
      }
    }
    const key = cls === 'w12' && stance ? stanceKey(stance) : null;
    const at = key && SONG_STANCES[key];
    if (!at){ this.stance = null; return; }
    const f = ((time || 0) + (stance.t0 || 0)) * 60;
    const from = this.stance && this.stance.key === key && f >= this.stance.f ? this.stance.f : -1;
    this.stance = { key, f };
    if (!live || !(from < at.at && f >= at.at)) return;
    const song = SONGS && SONGS.songs[songId];
    if (!song) return;
    const c = noteColour(song.notes[0]);
    if (c === undefined) return;                                  // 0x11c69e4: no palette entry, no request
    const key2 = at.alt ? ROWS.songAlt.key : ROWS.song.keys[song.notes.length - 2];
    if (h.refused.has(key2)) return;
    if (this.q) this.release(3);                                  // 0x44c0c4: the slot's occupant goes at once
    const q = h.startState(key2, ROWS.song.efl, { colour2: c });
    if (!q) return;
    this.q = q; this.live = live; this.song = song; this.index = 1;
    this.timer = SONGS.colourStep[song.notes.length - 2];
  }
  // THE HOLDER'S COLOUR STEP (the policy's 0x4575cc): the effect's unit +0x258 |= 0x40, +0x2d4 = the colour (recolourUnit)
  recolour(q, colour){ this.steps++; recolourUnit(q, colour); }
  stopAll(){ this.release(3); this.stance = null; }
  stats(){
    return { song: this.song ? this.song.id : null, running: !!(this.q && !(this.q.finished && this.q.finished())),
             index: this.index, timer: Math.round(this.timer), steps: this.steps, stance: this.stance && this.stance.key };
  }
}
function stanceKey(stance){
  const m = /Motion\[(\d+)\]/.exec(stance.clip || '');
  if (!m) return null;
  return (/_sa\./.test(stance.file || '') ? 'sa:' : 'draw:') + (+m[1]);
}
// 0x4575cc on the emulated memory: the slot's effect handle is the request's core (its +0x1c1 is the show byte the
// holders write); +0x150 its unit. The unit's +0x2d4 holds the request's second colour from the start (the lifted
// request code copies the block's +0x94 there: 0x88bb24 / 0x88be88) and the page's draw takes the colour from it -- a
// write shows at once (checked 2026-09-30: Attack Boost (S)'s song effect goes white -> red at its first step). NOT
// REPLICATED: the policy's second half, which re-tints each live mesh particle of the unit's model generators through
// the unit's vtable +0x8c (their +0xf0 / +0xf4 / +0x104); the page shows the same change without it.
export function recolourUnit(q, colour){
  const m = q && q.m, core = q && q.core;
  if (!m || !core) return false;
  const u = m.u32(core + 0x150);
  if (!u) return false;
  m.w32(u + 0x258, (m.u32(u + 0x258) | 0x40) >>> 0);
  m.w32(u + 0x2d4, colour >>> 0);
  return true;
}

// INVIGORATION on the WEAPON unit (the horn's bone 0, as Devouring Demon's host: render/weapon-fx-w07.js): row 11 held
// while the state stands, the weapon drawn and not on the back; ended on its own (the policy's 2) when that stops.
export class InvigorationEffects extends WeaponEffects {
  constructor(){
    super();
    this.unitRoot = null;
    this.active = false;           // the user's state (the checkbox); `on` is the base class's enabled flag
    this.held = null;              // { q, live }
    this.lastSync = null;
    this.gate = false;
  }
  makeHost(roots){
    const part = roots && roots[0];
    const node = part ? (part.userData.bone || part) : null;
    const host = new THREE.Group();
    host.name = 'invigoration-fx-host';
    host.userData.gidBones = node ? [{ gid: 0, node, d: 0 }] : [];
    host.userData.joints = [];
    return host;
  }
  useDef(def){
    return Object.assign({}, def, { clips: {}, parentOrder: 0x30000, unitFromOrigin: true,
      effects: (def.effects || []).filter(e => e.when === 'state' && e.record && e.record.array === 'UNIQUE' &&
                                                e.record.key === ROWS.invigoration.key && !this.refused.has(e.record.key))
                                  .map(e => Object.assign({}, e, { joints: [0] })) });
  }
  async sync(cls, roots, parent){
    const part = (roots && roots[0]) || null;
    if (cls !== 'w12' || !part || !this.on){ if (this.live || this.unitRoot) this.detach(); this.unitRoot = null; this.lastSync = null; return null; }
    this.lastSync = { cls, roots: [part], parent };
    if (this.cls === cls && this.live && this.unitRoot === part) return this.live;
    this.unitRoot = part;
    return this.attach(cls, [part], parent);
  }
  detach(){ this.held = null; super.detach(); }
  release(answer){
    const x = this.held, sc = this.live && this.live.schedule;
    this.held = null;
    if (!x || !sc || x.live !== this.live) return;
    try {
      if (!x.q.stopped) sc.host.stopRequest(x.q);
      if (answer === 3){ sc.host.releaseRequest(x.q); for (const e of sc.entries) e.requests = e.requests.filter(q => q !== x.q); }
    } catch (_) {}
  }
  setActive(on){
    this.active = !!on;
    if (!this.active) this.release(2);
    return this.active;
  }
  // the hook (0x11c60a8) and the policy (0x457568, code 11), every frame: `drawn` / `onBack` the rig's facts
  stepState(drawn, onBack){
    if (this.held && (this.held.live !== this.live || (this.held.q.finished && this.held.q.finished()))) this.held = null;
    this.gate = this.active && !!drawn && !onBack;                   // vtable +0x490 (0x11c7e18) with equipment byte +0x4d9 = 0
    if (!this.gate){ if (this.held) this.release(2); return; }
    if (this.held || !this.live || this.refused.has(ROWS.invigoration.key)) return;   // 0x281ffc flag 0: idempotent
    this.lastRequested = ROWS.invigoration.key;
    const q = this.startState(ROWS.invigoration.key, ROWS.invigoration.efl, null);
    if (q) this.held = { q, live: this.live };
  }
  step(time, advance, drawn, onBack){
    if (this.live && this.live.failed){
      if (this.lastRequested != null) this.refused.add(this.lastRequested);
      console.warn('invigoration: record ' + this.lastRequested + ' refused, dropped for this session');
      this.detach(); this.unitRoot = null;
      if (this.lastSync) this.sync(this.lastSync.cls, this.lastSync.roots, this.lastSync.parent);
      return;
    }
    if (!this.live) return;
    this.stepClip(null, time, advance);
    this.stepState(drawn, onBack);
  }
  stats(){
    return Object.assign(super.stats(), { unit: !!this.unitRoot, active: this.active, gate: this.gate,
      held: this.held ? { key: ROWS.invigoration.key, running: !(this.held.q.finished && this.held.q.finished()) } : null });
  }
}
