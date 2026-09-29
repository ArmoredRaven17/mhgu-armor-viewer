// MOTION STATES: a MONSTER'S, so this app has none -- see render/shells.js for the same story.
//
// The Monster Viewer's render/motion-states.js decides when a monster's state effects fire (a part break,
// an ailment) and holds RAGE_PUFF: the shared rage puff the enemy code requests on a countdown while
// enraged, with the joint whose rotation picks which of the two records goes. The effect runtime's
// live.js, taken from that app verbatim (rom/SOURCE.json), reads RAGE_PUFF to arm that countdown.
//
// A hunter does not rage, so the table is empty and the countdown is never armed. Weapon effects reach
// this app by the other route the same runtime supports: `when: 'clip'`, the game's own PSL motion
// schedule, which is what render/weapon-fx.js drives.

export const RAGE_PUFF = {};

export const MOTION_STATES = {};
