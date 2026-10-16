// THE HUNTER ARTS' LEVELS: which Arts change their EFFECTS with the Art's level, and the schedule word a level gives.
//
// Raven, 2026-10-08: "review which Hunter Arts impact effects when their levels change", then "A select per Art". The review
// is build/notes/hunter-arts-levels.md. The level is the player's +0x2764 (0..2 = I..III). It reaches an effect three ways:
//   * THE SCHEDULE WORD (every class): the base per-motion hook 0x2a15d0 sets each Arts motion's word (player +0x254c) by the
//     level -- I 0xff, II 0x0f0f, III 0xf00f -- and the PSL walker fires only the word's bits (the walker's hook 0x40780 ->
//     the unit's vtable +0xf0 = 0x281e78; render/weapon-fx.js clipMask). Bits 0..3 play at every level, 4..7 at I, 8..11 at
//     II, 12..15 at III.
//   * A CLASS HOOK replacing the word for one of its Arts motions: the Great Sword's 7103 (0x115d11c: 0x110000 << the
//     charge level), the Hammer's 7102 / 7104 (0x1172dd8: 1 | 0x10000000 << Typhoon Trigger's stage), the Bow's 7001..7101
//     (0x11b63ec: by a per-bow index), the Charge Blade's 7001 (0x11d1420: the phials' tier). The other classes' hooks name
//     no Arts motion (read 2026-10-08).
//   * CODE choosing a row by the level (the class modules: Chaos Oil, Devouring Demon, Typhoon Trigger, the Lance's shell
//     0x28, the Charge Blade's Arts).
// An Art listed here gets a level select (I / II / III, III by default) while its class is in the hand.

export const ARTS_WORD = [0xff, 0x0f0f, 0xf00f];
export const LEVEL_DEFAULT = 2;

// cls -> [{ key, name, motions: ['sa:N', ...], why, from? }]: the Arts whose effects change with their level IN THE VIEWER.
// `motions` are the Arts motions (Arts Motion[N] = 7000 + N) the Art plays -- each Art's own command file names its act
// (Art id k -> resource k + 0x77 = player\cmd\wNN\sa\plcmd_wNN_saXXXX_lvYY.plbasecmd: act_st / act_no, read at 0x2ac3a0) and
// the act's function its motions (2026-10-08). `from` names a page control that already holds the Art's level (Chaos Oil).
// Not listed until their level-chosen effects are wired: Ground Slash (shell 0x23 row = level), Brimstone Slash (7103 by its
// own charge), Sakura Slash (shell 0x2d on a hit), Triple Volley (shell 0x34 rows), Haste Rain / Blade Wire (the Bow's hook
// takes a per-bow index), Aerial Slam (shell 0x36 row = level).
export const ARTS_LEVELS = {
  w00: [
    { key: 'lionsMaw', name: "Lion's Maw", motions: ['sa:51'], why: "its effects 830..833 play at level III only" },
    { key: 'moonbreaker', name: 'Moonbreaker', motions: ['sa:152'], why: "its effect 1112 plays at level III only" },
  ],
  w01: [
    { key: 'roundForce', name: 'Round Force', motions: ['sa:51', 'sa:52'], why: "level I plays Arts Motion[51] (840 / 843), II and III [52] (841 / 844 at II only)" },
    { key: 'chaosOil', name: 'Chaos Oil', motions: ['sa:151'], from: 'chaosOil', why: "the Chaos Oil select: its aura 1100..1102 and the stance's 1111 (level II only)" },
  ],
  w02: [
    { key: 'typhoonTrigger', name: 'Typhoon Trigger', motions: ['sa:101', 'sa:102', 'sa:104'], why: "the stage by level and count: the held 900..902, the uppercut's 905..907 and 830..832" },
  ],
  w03: [
    { key: 'corkscrewJab', name: 'Corkscrew Jab', motions: ['sa:51', 'sa:52'], why: "its shell 0x28 row = level (800..802)" },
  ],
  w04: [
    { key: 'gunsBlazing', name: 'Guns Blazing', motions: ['sa:51'], why: "one effect per level: 810 / 811 / 812" },
  ],
  w07: [
    { key: 'unhingedSpirit', name: 'Unhinged Spirit', motions: ['sa:51', 'sa:56'], why: "its effect 101 plays at level I only" },
  ],
  w08: [
    { key: 'tranceSlash', name: 'Trance Slash', motions: ['sa:1', 'sa:2', 'sa:3', 'sa:4', 'sa:5', 'sa:6'], why: "level I 900..902 and 1100..1102, II 1110..1112, III 1120..1122, 923..925" },
    { key: 'tempestAxe', name: 'Tempest Axe', motions: ['sa:151'], why: "its effect 1001 plays at level III only" },
  ],
  w11: [
    { key: 'spiralSlice', name: 'Spiral Slice', motions: ['sa:152', 'sa:153', 'sa:154', 'sa:155', 'sa:156', 'sa:157'], why: "its effects 1012 / 1022 play at level III only" },
  ],
  w13: [
    { key: 'extractHunter', name: 'Extract Hunter', motions: ['sa:1', 'sa:2'], why: "its effect 901 plays at level I only" },
    { key: 'swarm', name: 'Swarm', motions: ['sa:51', 'sa:52'], why: "one effect per level: 800 / 801 / 802" },
  ],
  w14: [
    { key: 'energyBlade', name: 'Energy Blade', motions: ['sa:1'], why: "the level's effects and, with the phials, the blade's length layers" },
    { key: 'ripperShield', name: 'Ripper Shield', motions: ['sa:151'], why: "its stages 1120.. and the shield's 900..902 / 910..912 by level" },
  ],
};

// the Art of a class that plays this Arts motion, or null
export function artOf(cls, id){
  for (const a of ARTS_LEVELS[cls] || []) if (a.motions.includes(id)) return a;
  return null;
}
