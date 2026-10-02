// THE DUAL BLADES' EFFECTS: what uPlayerQuest11's code and its effect holder ask for, and when.
//
// Raven, 2026-10-01: "Dual Blades like Long Sword has Demon and Valor effects, it also has Wolf's Maw that is akin to
// Savage's effects where it has an aura with eye effect." Read from the ROM (build/notes/dual-blades-effects.md;
// efx/player/w11). Every address is exefs/main. The class's motion schedule (docs/effects/w11.json clips) runs on the hunter
// host like every class's; the blades' own glow is their part code (render/weapon-state.js dbFlags); this module is the rest.
//
// THE CLASS: uPlayerQuest11, vtable 0x1748254, own code 0x11b6d9c..0x11bf608; the action switch (vtable +0x324 = 0x11b7f30,
// on +0x250a, table 0x11b7f5c, 95 cases) tail-calls its start functions with a sub-index. Every request goes on the
// player's own block +0x2550 (or the holder's +0x15c0, parent the player): every row hangs from the HUNTER.
// THE MODES (named by the game's text, HN_WeaponControlsMsg_eng.gmd): DEMON MODE = +0x3370 bit 0 (vtable +0x4c4; status lo
// 0x8000), entered by vtable +0x734(1) and left by +0x738(1); ARCHDEMON MODE = bit 1 (vtable +0x4c8; 0x10000), entered by
// +0x734(2) from the Demon Gauge's code (0x11be3f4: left when the gauge runs out), which fires row 0 = 510 on entry. Neither
// is entered while the style byte (vtable +0x168) is 5 (Valor), and Archdemon not for style 1 either.
// THE HOLDER uShellPlEffectW11 (vtable 0x1757280): no setup slots, NO HOOK (0x44c38c is a bare return); its policy
// 0x457208: codes 4 / 5 kept while lo 0x20000 (WOLF'S MAW) stands, else left to end; codes 1 / 9 stopped at once in Demon
// Mode, kept in Archdemon Mode with the blades drawn (1) / sheathed (9) -- the policy asks the other row itself when they
// change -- else stopped. Rows: 0 w11_000 510 | 1 511 | 2 cm002_002 207 | 3 cm001_000 405 | 4 w11_800 820 | 5 1020 | 6
// w11_000 600 | 7 500 | 8 501 | 9 512 | 10 515 | 11 520 | 12 551.
//   * DEMON MODE's flashes, fire and forget: row 7 = 500 (w11_500.efl) at frame 20 of Motion[241] / [18] (acts 13 / 14 / 68,
//     0x11b92b4) and at the start of Motion[27] (0x11b9e3c, the aerial landing); row 8 = 501 at frame 6 of Motion[19] (act
//     15, 0x11b93dc: the exit) and at the start of Motion[25] (0x11b9ec8).
//   * ARCHDEMON's aura, slot 0, flag 0, asked every frame by vtable +0x690 (0x11be204): row 1 = 511 (w11_501.efl) with the
//     blades drawn, row 9 = 512 sheathed, while Archdemon Mode stands; 0x11be1a4 fires row 12 = 551 beside it on +0x3372
//     bit 1.
//   * WOLF'S MAW (hunterArtsData_eng.gmd 0x95..0x97; act 54, Arts Motion[101]): at the motion's start its timer +0x3358 =
//     a parameter by the Art's level, and slot 1 is asked, flag held: row 4 = 820 (cm122_110.efl), or row 5 = 1020 when
//     0x287780 answers 0 (the hunter's part 4 model = the table at 0x1621cc8 for its index: not read yet, so 820). The
//     status lo 0x20000 stands while the timer runs; the policy keeps the aura that long.
//   * row 10 = 515 (cm001_021.efl) at the start of Motion[198] (acts 77..80, 0x11bb518); row 6 = 600 (cm103_120.efl) at the
//     start of act 82's second motion, Motion[154] (after [155] ends, 0x11bbad8) -- act 57 plays Motion[154] too.
// IN THE VIEWER Demon Mode, Archdemon Mode, Valor State and Wolf's Maw are the user's switches (the Long Sword's Devouring
// Demon and the Switch Axe's Demon Riot are their precedent): the viewer has no button, no gauge, no timer. Wolf's Maw's
// own stance also holds its aura while it plays. A switch turned on fires nothing (Archdemon's entry flash 510 belongs to
// the gauge filling).
// NOT WIRED: act 76's rows 7 / 12 at frames 30 / 126 of Motion[122] / [111] (each behind a byte condition not read); the
// aerial branch's row 7 at frame 14 (a parameter flag); row 3 (405, the common-action hook +0x794) and row 11 (520: no
// site found); 1020's armour test; the pl_w11_100 shell (810..812).

export const ROWS = {
  enter: { key: 500, efl: 'w11_500' },                 // row 7
  leave: { key: 501, efl: 'w11_500' },                 // row 8
  archEnter: { key: 510, efl: 'w11_501' },             // row 0
  archDrawn: { key: 511, efl: 'w11_501' },             // row 1
  archSheathed: { key: 512, efl: 'w11_501' },          // row 9
  r515: { key: 515, efl: 'cm001_021' },                // row 10
  r551: { key: 551, efl: 'w11_510' },                  // row 12
  r600: { key: 600, efl: 'cm103_120' },                // row 6
  maw: { key: 820, efl: 'cm122_110' },                 // row 4
  mawAlt: { key: 1020, efl: 'cm122_110' },             // row 5
  sharpen: { key: 207, efl: 'cm002_007' },             // row 2 (cm002_002; added to docs/effects/w11.json)
};

// The player's requests by stance that no policy of the holder's watches beyond the stance (render/weapon-fx.js
// PlayerRequests on the hunter host): every fire-and-forget row, at its motion frame
export const PLAYER_REQUESTS = {
  'draw:241': [{ at: 20, key: ROWS.enter.key, efl: ROWS.enter.efl }],      // act 13
  'draw:18': [{ at: 20, key: ROWS.enter.key, efl: ROWS.enter.efl }],       // acts 14 / 68
  'draw:27': [{ at: 0, key: ROWS.enter.key, efl: ROWS.enter.efl }],        // 0x11b9e3c
  'draw:19': [{ at: 6, key: ROWS.leave.key, efl: ROWS.leave.efl }],        // act 15
  'draw:25': [{ at: 0, key: ROWS.leave.key, efl: ROWS.leave.efl }],        // 0x11b9ec8
  'draw:198': [{ at: 0, key: ROWS.r515.key, efl: ROWS.r515.efl }],         // acts 77..80
  'draw:154': [{ at: 0, key: ROWS.r600.key, efl: ROWS.r600.efl }],         // act 82's second motion (act 57 plays it too)
  'draw:255': [{ at: 274, key: ROWS.sharpen.key, efl: ROWS.sharpen.efl }], // row 2: the base sharpening (weapon type 11)
};

const MAW_STANCE = 'sa:101';
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

// THE HOLDER's two held slots on the hunter host (`hunter`, the page's)
export class DualBladesEffects {
  constructor(){
    this.held = new Map();        // holder slot -> { q, key, host, live }
    this.demon = false;           // Demon Mode (the checkbox)
    this.archdemon = false;       // Archdemon Mode (the checkbox)
    this.valor = false;           // Valor State (the checkbox): style 5 enters neither mode
    this.maw = false;             // Wolf's Maw active (the checkbox)
    this.hunter = null;
  }
  detach(){ for (const s of [...this.held.keys()]) this.release(s, 3); }
  alive(x){ return !!x.host && x.live === x.host.live && running(x); }
  release(slot, answer){ const x = this.held.get(slot); this.held.delete(slot); if (x) stopOn(x, answer); }
  // 0x281ffc -> 0x44c164: flag 1 stops the slot's occupant at once and asks the row; flag 0 keeps an occupied slot's
  // effect, whatever row is asked
  ask(slot, row, flag){
    const x = this.held.get(slot);
    if (x && this.alive(x) && (!flag || x.key === row.key)) return x;
    if (x) this.release(slot, 3);
    const host = this.hunter;
    if (!host || !host.live || host.refused.has(row.key)) return null;
    const q = host.startState(row.key, row.efl, null);
    if (!q) return null;
    const y = { q, key: row.key, host, live: host.live };
    this.held.set(slot, y);
    return y;
  }
  setDemon(on){ this.demon = !!on; return this.demon; }
  setArchdemon(on){ this.archdemon = !!on; return this.archdemon; }
  setValor(on){ this.valor = !!on; return this.valor; }
  setMaw(on){ this.maw = !!on; return this.maw; }
  // every frame: `cls` the class in the hand (null otherwise), the weapon stance, `drawn` the rig's fact
  step(cls, stance, drawn){
    for (const [s, x] of this.held) if (!this.alive(x)) this.held.delete(s);
    if (cls !== 'w11'){ if (this.held.size) this.detach(); return; }
    // the modes as the class has them: Valor (style 5) enters neither
    const demon = this.demon && !this.valor, arch = this.archdemon && !this.valor;
    // ARCHDEMON's aura (vtable +0x690 asks it with flag 0, the policy swaps the row with the carry and stops it in Demon
    // Mode): 511 drawn, 512 sheathed
    if (arch && !demon){
      const want = drawn ? ROWS.archDrawn : ROWS.archSheathed;
      const x = this.held.get(0);
      if (x && x.key !== want.key) this.release(0, 3);
      this.ask(0, want, false);
    } else if (this.held.has(0)) this.release(0, 3);
    // WOLF'S MAW: its stance asks the aura at its start; the switch stands for the timer that keeps it (lo 0x20000); the
    // policy lets it end when the status falls
    const key = drawn && stance ? stanceKey(stance) : null;
    if (this.maw || key === MAW_STANCE) this.ask(1, ROWS.maw, false);
    else if (this.held.has(1)) this.release(1, 2);
  }
  stats(){
    const held = {};
    for (const [k, x] of this.held) held[k] = { key: x.key, running: running(x),
                                                shown: x.q && x.q.m && x.q.core ? x.q.m.u8(x.q.core + 0x1c1) : null };
    return { demon: this.demon, archdemon: this.archdemon, valor: this.valor, maw: this.maw, held };
  }
}
