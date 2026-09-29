// SHELLS: THE ARMOR VIEWER HAS NONE, and this file says so out loud.
//
// A "shell" is an object a MONSTER's action code spawns -- a breath's body, a thrown rock, tail spikes --
// translated from the ROM in the Monster Viewer's own render/shells.js (4,699 lines of per-monster action
// code). The effect runtime under render/rom/effect/ is shared with that app and taken from it verbatim
// (rom/SOURCE.json), and two of its modules import this file: schedule.js reads SHELL_DATA to decide
// whether a mount has shells to step, live.js reads it to decide whether to hand the shells every mapped
// bone. Rather than edit those two -- which would fork a file we want to keep syncing -- this app supplies
// the module they expect, empty.
//
// Nothing a hunter or a weapon does is a shell. The player's spawned objects (a Bow's arrow, a Gunlance
// shell, a Bowgun's ammo) are PROOF EFFECTS and MODEL records on the effect path, which is the path
// render/weapon-fx.js drives -- the Bow's nocked arrow is already a direct model record (cm100_900), not a
// shell. If player-side shells are ever decoded they belong here, in this app's own words.
//
// SHELL_DATA is keyed by monster id, so an empty object answers "no shells" for every lookup, and the two
// functions are never reached through it. They are exported anyway so the import cannot fail if upstream
// starts calling one unconditionally.

export const SHELL_DATA = {};

export function createShellState(){ return null; }

export function stepShells(){ return { spawned: [], effects: [] }; }

// The Monster Viewer's own helper, kept to the same shape: a joint matrix in the game's convention.
export function gameJointFrom(elements){ return elements ? Array.from(elements, Math.fround) : null; }
