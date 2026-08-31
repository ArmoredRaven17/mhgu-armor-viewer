# MHGU Armor Viewer

A fan-made 3D viewer for Monster Hunter Generations Ultimate armor. Pick a piece for each
slot from any set, on either gender, and see the result on a posed hunter.

**Live:** https://armoredraven17.github.io/mhgu-armor-viewer/

## What it does

- Every armor piece in the game, both genders, mixed freely across sets
- In-game names, grouped by rank variant, and sorted by rarity
- Face and hair styles, with skin / eye / hair colour
- Per-piece pigment, applied to the region the game itself dyes
- The game's own held poses, taken from its lobby motion lists
- Save, Save As and Open, so a set can be kept and shared as a small JSON file

## Running it

No build step. Serve `docs/` with any static file server:

    python -m http.server 5584 --directory docs

## Contents

    docs/index.html      the whole app -- markup, styles and logic
    docs/manifest.json   piece -> model, texture, name, rarity, joints, dye flags
    docs/models/         armor and character meshes (.glb)
    docs/tex/            textures, deduplicated by content hash
    docs/poses/          motion lists merged onto the player skeleton
    docs/assets/         icons and UI textures shared with the sibling MHGU apps

## Credits

See NOTICE.md, and the About dialog in the app.

Monster Hunter Generations Ultimate is © CAPCOM CO., LTD. This is an unofficial fan
project and is not affiliated with or endorsed by Capcom.
