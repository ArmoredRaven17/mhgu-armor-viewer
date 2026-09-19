// The Kinsect's two colours and the Insect Glaive's, as the game computes them. Raven,
// 2026-09-18: "Ambrosia would color the Kinsects, we will need this color logic since Kinsects
// are not dyed currently", and on the glaive's coloured region: "so it is tied with the Kinsect".
//
// Read from the ROM, not chosen:
//   0x0028726c  hands each hunter part its colours. For the weapon, when the weapon-class byte
//               is 13 (Insect Glaive), it calls
//   0x002876a8  k = the Kinsect's model number (weapon part 8, +0x1380; bug/NNN). Colour A goes
//               to channel 5 of the glaive (part 7), colours A and B to channels 5 and 6 of the
//               Kinsect. With no Kinsect it returns before colouring anything.
//   0x000dce70  A = SPECIES[k]. B = ELEMENT[e] when e, the strongest of the Kinsect's five
//               element values (fire, water, thunder, ice, dragon; a tie goes to the earlier
//               one, 0x000dd078), is at least 1; otherwise B = PLAIN[k].
//   0x004814f8  the Kinsect shell class's static setup, which writes the three tables below as
//               constants -- no data file holds them (read byte for byte by emulating it).
// Which materials take them is the MRL's colour channel (materials-db.js `ch`): on a Kinsect
// the `symemi` material is channel 5 and `sym` channel 6; 79 of the 82 glaives carry a
// channel-5 region. How a material uses the colour is material.js setChannelColor.
// Confirmed in game (Raven, 2026-09-18): one Fire Ambrosia on a base form changes its sym region
// and not its symemi region.
//
// Colours are the bytes the game stores, [r, g, b] (alpha 255 on every one). Black rows are
// what the game has for 0 and 23 (no model) and for 30-32, the three Kinsects with no dye
// materials: the DLC Kinsects Rukh of Light, Barrett Hawk and Tora. Raven, 2026-09-18:
// "These are DLC Kinsects that are assigned to just the one IG they come with. I don't think
// have Species color". Their glaives are the three with no channel-5 region at all (Aladdin's
// Wand 069, Conviction Glaive J 070, Spear of the Beast 104), so the game never shows that
// black; kinsectColours treats those rows as no colour.

// A, by Kinsect model (0x0188ac3c)
export const SPECIES = [
  [  0,   0,   0],   //  0 (no model)
  [105, 255,   0],   //  1 Culldrone
  [  0, 155, 175],   //  2 Elscarad
  [  0, 155, 175],   //  3 Alucanid
  [  0, 155, 175],   //  4 Monarch Alucanid
  [  0, 155, 175],   //  5 Empresswing
  [195,   0,  20],   //  6 Rigiprayne
  [255, 100,  40],   //  7 Cancadaman
  [  0, 155, 175],   //  8 Fiddlebrix
  [210,  50, 150],   //  9 Windchopper
  [210,  50, 150],   // 10 Grancathar
  [195,   0,  20],   // 11 Pseudocath
  [105, 255,   0],   // 12 Mauldrone
  [195,   0,  20],   // 13 Arginesse
  [105, 255,   0],   // 14 Foebeetle
  [  0, 155, 175],   // 15 Carnage Beetle
  [105, 255,   0],   // 16 Bonnetfille
  [  0, 155, 175],   // 17 Ladytarge
  [105, 255,   0],   // 18 Ladypavise
  [105, 255,   0],   // 19 Arkmaiden
  [105, 255,   0],   // 20 Gullshad
  [105, 255,   0],   // 21 Bullshroud
  [255, 100,  40],   // 22 Whispervesp
  [  0,   0,   0],   // 23 (no model)
  [255, 163,  25],   // 24 Exalted Alucanid
  [  0, 155, 175],   // 25 Bilbobrix
  [105, 255,   0],   // 26 Foliacath
  [  0, 155, 175],   // 27 Gleambeetle
  [210,  50, 150],   // 28 Ladytower
  [255, 100,  40],   // 29 Fleetflammer
  [  0,   0,   0],   // 30 Rukh of Light
  [  0,   0,   0],   // 31 Barrett Hawk
  [  0,   0,   0],   // 32 Tora
];
// B with no element, by Kinsect model (0x0188abb8)
export const PLAIN = [
  [  0,   0,   0],   //  0 (no model)
  [ 50, 205,  50],   //  1 Culldrone
  [255, 190,   0],   //  2 Elscarad
  [  0, 155, 175],   //  3 Alucanid
  [ 95,  90, 255],   //  4 Monarch Alucanid
  [140,  75, 170],   //  5 Empresswing
  [170,  80,   0],   //  6 Rigiprayne
  [120,  90,  35],   //  7 Cancadaman
  [255, 155, 170],   //  8 Fiddlebrix
  [145,  10, 115],   //  9 Windchopper
  [  0, 170, 255],   // 10 Grancathar
  [100, 190, 170],   // 11 Pseudocath
  [ 50, 205,  50],   // 12 Mauldrone
  [200, 255, 255],   // 13 Arginesse
  [165,   0,  30],   // 14 Foebeetle
  [125,   0,  35],   // 15 Carnage Beetle
  [125,   0,  35],   // 16 Bonnetfille
  [205, 175, 115],   // 17 Ladytarge
  [135,  85,  20],   // 18 Ladypavise
  [255,  30,  30],   // 19 Arkmaiden
  [240, 210, 180],   // 20 Gullshad
  [255, 155,  20],   // 21 Bullshroud
  [  5, 255, 205],   // 22 Whispervesp
  [  0,   0,   0],   // 23 (no model)
  [ 38, 127, 217],   // 24 Exalted Alucanid
  [  0,  51,  51],   // 25 Bilbobrix
  [255, 102,   0],   // 26 Foliacath
  [  0, 102, 255],   // 27 Gleambeetle
  [255, 167, 127],   // 28 Ladytower
  [206, 142,  23],   // 29 Fleetflammer
  [  0,   0,   0],   // 30 Rukh of Light
  [  0,   0,   0],   // 31 Barrett Hawk
  [  0,   0,   0],   // 32 Tora
];
// B by the strongest element (0x0188acc0)
export const ELEMENT = [
  [225,  30,   0],   // fire
  [ 15, 105, 255],   // water
  [255, 155,   5],   // thunder
  [105, 235, 250],   // ice
  [ 30,  30,  80],   // dragon
];
export const ELEMENTS = ['Fire', 'Water', 'Thunder', 'Ice', 'Dragon'];

// kinsectColours(model, element) -> { 5: [r, g, b], 6: [r, g, b] } by channel, or null.
//   model    the Kinsect's model number (1 = bug/001 Culldrone) or its '001' string
//   element  the index of its strongest element in ELEMENTS, or null for none
// null for a Kinsect with no species colour (the black rows above): the viewer lets any
// Kinsect ride any glaive, and a DLC Kinsect on a glaive it never comes with would otherwise
// paint that glaive's region black -- it keeps its own look instead.
export function kinsectColours(model, element){
  const k = parseInt(model, 10);
  if (!(k >= 0 && k < SPECIES.length)) return null;
  if (SPECIES[k].every(v => v === 0)) return null;
  const e = (element === null || element === undefined || element === '') ? -1 : +element;
  return { 5: SPECIES[k], 6: (e >= 0 && e < ELEMENT.length) ? ELEMENT[e] : PLAIN[k] };
}
