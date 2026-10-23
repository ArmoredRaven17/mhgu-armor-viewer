// THIS VIEWER'S GAME, for the shared viewer base (docs/base; the plan: C:\\Coding Repos\\VIEWER-BASE-PLAN.md). Every value
// the base needs that differs between viewers lives here or in docs/adapter.js, never in a base file. A CLASSIC script,
// loaded before docs/base/ui/shell.js, so the theme and the saved view preferences apply before the first paint; the
// page's modules read the same object (window.VIEWER_GAME).
window.VIEWER_GAME = {
  id: 'mhgu',
  // every localStorage key the base writes is this prefix + '-' + a name: -theme, -stage, -ui, -tab, ...
  storagePrefix: 'mhgu-armor-viewer',
  // the side panels start shut and stay locked until the model is in (Raven, 2026-10-19; base/ui/shell.js)
  panelsUntilReady: true,
  // THE THEMES: the MH apps family's palette (white text clears every swatch; see the shell's note before adding one)
  themes: [
    { name: "Teostra", hex: "#570B0B" },
    { name: "Rathalos", hex: "#b51717" },
    { name: "Tetsucabra", hex: "#783E0F" },
    { name: "Agnaktor", hex: "#C7620E" },
    { name: "Tigrex", hex: "#74631D" },
    { name: "Rajang", hex: "#9C8328" },
    { name: "Najarala", hex: "#436713" },
    { name: "Gendrome", hex: "#67922E" },
    { name: "Deviljho", hex: "#0B570F" },
    { name: "Rathian", hex: "#39993E" },
    { name: "Astalos", hex: "#14503d" },
    { name: "Zinogre", hex: "#279773" },
    { name: "Zamtrios", hex: "#0C5D68" },
    { name: "Kirin", hex: "#118898" },
    { name: "S. Ceanataur", hex: "#005984", icon: "Shogun Ceanataur" },
    { name: "Plesioth", hex: "#0080c1" },
    { name: "Brachydios", hex: "#0B2757" },
    { name: "Lagiacrus", hex: "#0b3f97" },
    { name: "G. Magala", hex: "#1F0B57", icon: "Gore Magala" },
    { name: "Nerscylla", hex: "#4e2fa2" },
    { name: "Y. Garuga", hex: "#62008f", icon: "Yian Garuga" },
    { name: "Chameleos", hex: "#8e50ab" },
    { name: "Mizutsune", hex: "#D4358C" },
    { name: "Congalala", hex: "#C8679D" },
    { name: "Duramboros", hex: "#5a411f" },
    { name: "Diablos", hex: "#997c54" },
    { name: "Barroth", hex: "#835A32" },
    { name: "Bulldrome", hex: "#B17A47" },
    { name: "K. Daora", hex: "#505358", icon: "Kushala Daora" },
    { name: "Valstrax", hex: "#7C879B" },
    { name: "Forbidden", hex: "#1E2025", icon: "Question Mark" },
  ],
  themeDefault: '#1E2025',             // Forbidden, the family default
  themeIcon: function (name) { return 'assets/MonsterIcons/MHGU-' + name.replace(/ /g, '_') + '_Icon.webp'; },
  themeIconFallback: 'assets/MonsterIcons/MHGU-Question_Mark_Icon.webp',
  // the sidebar's pane tabs, [tab id, pane id], the first the default
  paneTabs: [['tabHunter', 'paneHunter'], ['tabPalico', 'panePalico'], ['tabNpc', 'paneNpc']],
  // the joints the camera's aim takes (the depth of field's focus follow, the first-person face lock), by gid
  aimJoints: { head: 4, chest: 2 },
  // Save / Save As / Open: the default file name and the file type the picker shows
  setFileName: 'mhgu-armor-set.json',
  setFileLabel: 'MHGU armor set',
  // THE CHARACTER COLOUR ROWS (docs/base/ui/colour-rows.js). The names are the game's own (CharMakeMsg_eng.gmd); the
  // hex values are the viewer's (the palette RGB lives in the executable). null = Rainbow, which cycles.
  colourNames: [
      ['Red','#c8322d'], ['Orange','#e8792a'], ['Yellow','#efc93b'],
      ['Yellow-Green','#a8c23c'], ['Matcha','#8ca04a'], ['Pine Green','#2f5d3a'],
      ['Green','#3e8c4e'], ['Blue-Green','#2e8c86'], ['Water','#7fc5d8'],
      ['Blue','#2e6fbf'], ['Ultramarine','#2b3f8c'], ['Wisteria','#8e8fc8'],
      ['Light Purple','#a98cc8'], ['Purple','#6b3f8f'], ['Dark Purple','#43305c'],
      ['Cherry','#e58aa8'], ['Peach','#f2b8a0'], ['Ocher','#b98a3c'],
      ['Gold','#c9a13b'], ['Brown','#6b4426'], ['Gray','#8c8c90'],
      ['White','#f2f0ea'], ['Black','#232326'], ['Rainbow', null]
  ],
  // [select id, colour part]: the hunter's rows and the Palico's
  // THE WEAPON PANEL'S CLASS ROWS (base/ui/weapon-panel.js), in panel order: what each class adds beside Class, Weapon,
  // Carry, Stance and the Attachment / Form row. Moved from index.html's markup and its show-per-class block
  // (2026-10-18); the ids, labels and titles are GU's, each row's effect is wired by id in index.html. The Arrow row has
  // no class: hidden for every class (Raven, 2026-09-03: "hide effect options for now").
  weaponRows: [
    { field: "chargeField", kind: "check", input: "chargeChk", label: "Demon Riot active", classes: ["w08"] },
    { field: "tempestField", kind: "check", input: "tempestChk", label: "Tempest Axe active", classes: ["w08"] },
    { field: "chaosOilField", kind: "select", input: "chaosOil", label: "Chaos Oil", options: [["0", "Off"], ["1", "I"], ["2", "II"], ["3", "III"]], classes: ["w01"] },
    { field: "weaponOilField", kind: "select", input: "weaponOil", label: "Oil", options: [["0", "None"], ["1", "Affinity Oil"], ["2", "Destroyer Oil"], ["3", "Stamina Oil"], ["4", "Mind's Eye Oil"]], classes: ["w01"] },
    { field: "enragedGuardField", kind: "select", input: "enragedGuard", label: "Enraged Guard", options: [["0", "Off"], ["1", "Power I"], ["2", "Power II"], ["3", "Power III"]], classes: ["w03"] },
    { field: "healShieldField", kind: "check", input: "healShieldChk", label: "Healing Shield active", classes: ["w03"] },
    { field: "devouringDemonField", kind: "select", input: "devouringDemon", label: "Devouring Demon", options: [["0", "Off"], ["1", "I"], ["2", "II"], ["3", "III"]], classes: ["w07"] },
    { field: "hornSongField", kind: "select", input: "hornSong", label: "Song", after: "<span id=\"hornSongNotes\" aria-hidden=\"true\"></span>", classes: ["w12"] },
    { field: "invigorationField", kind: "check", input: "invigorationChk", label: "Invigoration active", classes: ["w12"] },
    { field: "chargeShotField", kind: "check", input: "chargeShotChk", label: "Charge Shot active", classes: ["w06"] },
    { field: "chargeLevelField", kind: "select", input: "chargeLevel", label: "Charge level", options: [["0", "Off"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]], classes: ["w06"] },
    { field: "gunsBlazingField", kind: "check", input: "gunsBlazingChk", label: "Guns Blazing active", classes: ["w04"] },
    { field: "gunpowderField", kind: "check", input: "gunpowderChk", label: "Gunpowder Infusion active", classes: ["w04"] },
    { field: "hasteRainField", kind: "check", input: "hasteRainChk", label: "Haste Rain active", classes: ["w10"] },
    { field: "loadUpField", kind: "check", input: "loadUpChk", label: "Load Up (skill)", classes: ["w10"] },
    { field: "demonModeField", kind: "check", input: "demonModeChk", label: "Demon Mode", classes: ["w11"] },
    { field: "archdemonField", kind: "check", input: "archdemonChk", label: "Archdemon Mode", classes: ["w11"] },
    { field: "valorStateField", kind: "check", input: "valorStateChk", label: "Valor State (Valor style)", classes: ["w02", "w09", "w11"] },
    { field: "wolfsMawField", kind: "check", input: "wolfsMawChk", label: "Wolf's Maw active", classes: ["w11"] },
    { field: "impactPressField", kind: "check", input: "impactPressChk", label: "Impact Press active", classes: ["w02"] },
    { field: "overheatField", kind: "check", input: "overheatChk", label: "Overheated", classes: ["w09"] },
    { field: "dragonBreathField", kind: "check", input: "dragonBreathChk", label: "Dragon Breath active", classes: ["w09"] },
    { field: "spiritField", kind: "select", input: "spiritGauge", label: "Spirit Gauge", options: [["0", "Empty"], ["1", "Level 1 (white)"], ["2", "Level 2 (yellow)"], ["3", "Level 3 (red)"], ["4", "Valor (blue)"]], classes: ["w07"] },
    { field: "cbGaugeField", kind: "select", input: "cbGauge", label: "Charge Gauge", title: "The Charge Blade's gauge (+0x2780), filled by hits: its level is above 29, 45 or 71 (0x11dc73c)", options: [["0", "Empty"], ["1", "Level 1"], ["2", "Level 2"], ["3", "Level 3"]], classes: ["w14"] },
    { field: "shieldChargeField", kind: "select", input: "shieldCharge", label: "Shield Charge", title: "The shield's charge (+0x3344): yellow or red, or Valor State's blue", options: [["0", "Off"], ["1", "Yellow"], ["2", "Red"], ["3", "Valor (blue)"]], classes: ["w14"] },
    { field: "artLevels", kind: "box", cls: "art-levels" },
    { field: "cbPhialsField", kind: "select", input: "cbPhials", label: "Phials", title: "The charged phials (+0x2b82): up to 5, or 7 / 9 / 10 under the Limit Breaker Art (the cap +0x2b84). The Ultra Element Discharge's burst (Stance 51, with the shield charged) and the Energy Blade read it", options: [["0", "0"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6 (Limit Breaker)"], ["7", "7 (Limit Breaker)"], ["8", "8 (Limit Breaker)"], ["9", "9 (Limit Breaker)"], ["10", "10 (Limit Breaker)"]], classes: ["w14"] },
    { field: "arrowField", kind: "select", input: "arrow", label: "Arrow", classes: [] },
    { field: "kinsectField", kind: "select", input: "kinsect", label: "Kinsect", classes: ["w13"] },
    { field: "kinsectElField", kind: "select", input: "kinsectEl", label: "Element", title: "The Kinsect's strongest element, which colours it", classes: ["w13"] },
    { field: "kinsectMotField", kind: "select", input: "kinsectMot", label: "Kinsect motion", title: "Perched on the arm, or one of the Kinsect's own motions in free flight", classes: ["w13"] },
  ],
  // THE HUNTER PANEL'S ROWS (base/ui/hunter-tab.js builds them; base/ui/hunter-panel.js and colour-rows.js wire them),
  // in panel order; GU's markup and ids. The four skill switches are the hunter's skill effects (render/skill-effects.js)
  hunterRows: [
    { kind: 'select', input: 'genderSel', label: 'Gender', options: [['f', 'Female'], ['m', 'Male']] },
    // the Face / Hair / Body show-toggles are hidden and always on (Raven, 2026-10-18: "Since we worked on handling the
    // armors better, hide the Face, Hair, Body toggles and keep them enabled at all times"): the armour's own masks decide
    // what shows, as in game. The style selects carry the game's own menu words instead (CharMakeMsg 2 "Face", 7
    // "Hairstyle"; Raven: "add text labels to indicate what the drop down is for")
    { kind: 'check', input: 'face', label: 'Face', checked: true, hidden: true, always: true },
    { kind: 'select', input: 'faceStyle', label: 'Face' },
    // the game's words (Raven, 2026-10-19): CharMakeMsg 5 "Features", 12 "Feature Color"
    { kind: 'select', input: 'facePaint', label: 'Features', title: 'The features the game paints on this face: fourteen per gender, the same set on every face of that gender. In game they are Type 1 to Type 14' },
    { kind: 'colour', input: 'paintColor', label: 'Feature Color', title: "The features' own colour. The game gives them one, as it does hair and skin; Default leaves them as drawn" },
    { kind: 'colour', input: 'eyeColor', label: 'Eye Color' },
    { kind: 'check', input: 'hair', label: 'Hair', checked: true, hidden: true, always: true },
    { kind: 'select', input: 'hairStyle', label: 'Hairstyle' },
    { kind: 'colour', input: 'hairColor', label: 'Hair Color' },
    { kind: 'check', input: 'body', label: 'Body', checked: true, hidden: true, always: true },
    { kind: 'colour', input: 'skinColor', label: 'Skin Tone' },
    { kind: 'select', input: 'clothing', label: 'Clothing' },
    { kind: 'box', id: 'clothPig' },
    { kind: 'select', input: 'pose', label: 'Pose' },
    { kind: 'check', input: 'skillPeak', label: 'Peak Performance' },
    { kind: 'check', input: 'skillChallenger', label: 'Challenger' },
    { kind: 'check', input: 'skillLatent', label: 'Latent Power' },
    { kind: 'check', input: 'skillTrump', label: 'Trump Card' },
  ],
  // the Weapon panel's closing note (base/ui/hunter-tab.js)
  weaponHint: 'Effects pause with animations. This ensures most effects stay in sync.',
  // what Hunter Slots' New makes (its tooltip)
  hunterNewTitle: 'A new hunter in the Chakra armour, every Hunter option on its default',
  // GUILD INFO (base/ui/hunter-tab.js builds the panel, base/ui/guild-panel.js runs it, base/render/plate.js draws the
  // name plate): the game's own data. Raven, 2026-10-18: "Which will need to look into each game's guild card titles,
  // the colors for HR ranges".
  guildInfo: {
    // The rank bands and colours of sUI's rank-to-colour method (.text 0x0055FA18): the compare chain 3 / 8 / 12 / 99 /
    // 998 picks an entry of the palette the sUI initialiser builds (0x00560F40; palette words 0xFFE6E6E6, 0xFFFF8400,
    // 0xFF00FF00, 0xFFFF0000, 0xFFF011EE, 0xFF6FE8ED). Those words keep RED in the LOW byte, as every colour that
    // initialiser writes does: the RGB565 converter at 0x5daad4 puts red in bits 7-3 and blue in 23-19, and the Deviant
    // pigment pairs it builds only match the game read that way (index.html DEVIANTS). The first read of this table
    // took them as 0xAARRGGBB, which swapped red and blue (Raven, 2026-09-05: "HR Rank Colors, two are incorrect").
    // `hr` is the band's first rank, the value the Hunter Rank select stores.
    hrBands: [
      { hr: 1,   max: 3,   color: '#e6e6e6', label: 'HR 1–3' },
      { hr: 4,   max: 8,   color: '#ff8400', label: 'HR 4–8' },
      { hr: 9,   max: 12,  color: '#00ff00', label: 'HR 9–12' },
      { hr: 13,  max: 99,  color: '#ff0000', label: 'HR 13–99' },
      { hr: 100, max: 998, color: '#f011ee', label: 'HR 100–998' },
      { hr: 999, max: 999, color: '#6fe8ed', label: 'HR 999' }
    ],
    // the Guild Card's title words: the game's own pools (GC_Title_1 / GC_Title_2, build-guild-card-titles.py), each
    // with its unlock text; null = a game without titles (no Shows / Title / Unlock Requirements rows)
    titles: 'guild-card-titles.json?v=20260906',
    // the title menu's entries to a page (Raven, 2026-09-09: GU's is a 4 x 2 grid, eight to a page)
    titlePage: 8,
    // the weapon glyph in front of the name: the game's icon font cut into a strip (build-plate-icons.py), its cell
    // size, and weapon folder -> cell (the game's weapon enum; w05 was removed)
    icons: 'ui/plate-icons.png?v=20260905', iconCell: 24,
    iconCells: { w00: 0, w01: 1, w02: 2, w03: 3, w04: 4, w06: 6, w07: 7, w08: 8, w09: 9, w10: 10, w11: 11, w12: 12, w13: 13, w14: 14 },
    font: "'MHFU', 'Segoe UI', system-ui, sans-serif",
  },
  // The hunter's four rows offer NO named presets (Raven, 2026-10-18: "In Game they are simply types, we don't need to
  // name them" / "Hide the named colours"): the names were the game's but their hex values the viewer's own, and the
  // game's preset RGB is not read (build/notes/character-colours.md, parked). Each row keeps Default, RGB... and its
  // palette button (the board and every in-game pigment). The Palico's two rows keep colourNames for now.
  colourParts: [
      ['skinColor','skin',{ names: [] }], ['eyeColor','eye',{ names: [] }], ['hairColor','hair',{ names: [] }],
      ['paintColor','paint',{ names: [] }]
  ],
  // THE SKIN TONE STRIP (Raven, 2026-10-18: "Skin Tone also uses a color board that is restricted to natural skin
  // tones"; consistency with the MH3U viewer's strip): the game's own, read from the ROM by dev/build-skin-strip.py --
  // eng GUI HD_demo_hadairo ("hadairo", skin colour), the character creation's strip of 184 positions (0x6b812c; a new
  // character starts at 183). The texture is the 3DS strip with every texel doubled; the picker reads it through the
  // pane's world matrix, which carries the Switch's screen scale (2), so position i is HD texel 2i + 2 = the 3DS texel
  // i + 1 and the positions run to the pale end as in game (Raven, 2026-10-19). A range in the row and the same strip
  // first in the selector; Default, the hex field and RGB stay
  // Default is the game's own new-character skin (default: true): position 183, the strip file's `default` (0x6b5dc4);
  // no untinted state, as in game
  colourRows: { skin: { strip: 'ui/skin-strip.json', default: true } },
  // the Palico's two rows are colour rows like the hunter's (Raven, 2026-10-19: "Update the Palico Eye Color and Fur
  // Color to use the same pigment selector"): the field, the palette button, Default at the selector's top; no named
  // list (an old named choice loads as Default)
  colourPartsPalico: [
      ['otFurColor','fur',{ names: [] }], ['otEyeColor','oeye',{ names: [] }]
  ],
  // the colour part a material's colour CHANNEL takes (setChannelColor's multiply): GU's face paint is channel 4
  // and the skin: channel 2 -- the game writes the hunter's skin colour (appearance +0x4e0, the save's first of skin /
  // hair / features / clothing) to colour channel 2 on every path (0x2834f4..0x28360c -> 0x53a0e4), a plain multiply over
  // fAlbedoColor (Raven, 2026-10-19: the luminance tint drew the pale end too pale). The Palico's fur is channel 2 as well:
  // its materials (slots 'o...') are left out
  colourChannel: [{ channel: 4, part: 'paint' }, { channel: 2, part: 'skin', exceptSlot: '^(o|npc)' }],
  // PIGMENT (docs/base/ui/pigment.js): the dyeable slots' labels, and the rows GU adds -- the Clothing Color row (Hunter
  // panel) and the Palico's two with their All (Palico tab)
  pigmentSlotLabels: { helm: 'Head', body: 'Chest', arm: 'Arms', wst: 'Waist', leg: 'Legs' },
  pigmentCloth: true,
  pigmentPalico: true,
  // the game's colour board, at the bottom of the Pigment modal's first tab (dev/build-colorscale.py: eng GUI HD_lby_colorscale, inside its frame)
  pigmentBoard: { image: 'boards/mhgu-colorscale.png', region: [2, 2, 353, 103] },   // inclusive
  // the armour Rainbow (pigment id 1), read from the game's code: the per-frame pigment animator 0x274904 builds these
  // eight colours (0x274d84, stored 0xAABBGGRR) and, for id 1, blends colour (t >> 4) & 7 into the next by
  // fmod(t, 16) / 16, truncated to bytes; t (+0x9c7c) gains the frame delta (1/60 s units) each frame and resets past
  // 1e7. One timer, so every Rainbow piece shows the same colour at once. The same table and blend as MH4U's.
  pigmentRainbow: { name: 'Rainbow', unitsPerColour: 16, unitsPerSecond: 60,
    table: [[227, 126, 237], [193, 159, 255], [154, 204, 241], [121, 229, 133], [189, 243, 102], [245, 236, 99],
            [240, 141, 92], [232, 120, 161]] },
  // the Deviant pigments, tab two of the Pigment modal (Raven, 2026-10-18: "I want tabs within the modal"; GU only)
  pigmentDeviants: true,
  pigmentTabLabels: ['Pigments', 'Deviant pigments'],
};
