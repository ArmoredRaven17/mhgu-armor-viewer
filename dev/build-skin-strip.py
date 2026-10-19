"""THE GAME'S SKIN TONE STRIP: docs/ui/skin-strip.json, read from the ROM (2026-10-19; Raven: "Skin Tone also uses a
color board that is restricted to natural skin tones").

  romfs/nativeNX/eng/GUI/99_texture/HD_demo_hadairo_NOMIP.tex  (hadairo = skin colour)

TEX v0xA0, 512 x 16, one mip, format 7 (RGBA8), Switch block-linear (GOBs of 64 bytes x 8 rows, a block 2 GOBs high).
The layout that places it is GUI\\03_title\\menu_down (its 'hadairo' instance: pane 3, Size 188 x 40, mTextureRect
2, 0 .. 378, 48; the layout's texture table declares it 512 x 16 at scale 1).

What a position picks, from the code (the character-creation class at 0x6b....):
  - the cursor runs over positions 1 .. 184 (0x6b812c: clamped to [1, 0xb8]); a step moves it one position, the
    "cycle faster" of the help text (CharMakeMsg 35) is L / R held;
  - position i samples the strip pane at its local point (i + 2, 0) (0x6b815c; 0x6b81b0 -> 0x547134, the GUI texel
    picker) and stores that texel as the hunter's skin RGBA (+0x80, the position +0x84);
  - restoring a saved colour searches positions 1 .. 184 for the first whose texel EQUALS it (0x6b7cd0), else 183;
  - a new character starts at position 183 (0x6b5dc4).
The strip is the 3DS one doubled: MH4U's core_title lyt/demo/texture/demo_hadairo (256 x 8, the same strip, colours up
to x = 188) is this texture with every texel twice (3DS x -> HD 2x and 2x + 1).
The picker reads texel = rect origin + (point - M(rect origin)), M the pane's world matrix (0x547134). On the 3DS M has
scale 1 and position i reads 3DS texel i + 2. On the Switch the world matrix carries a screen scale (the matrix build
0xa34374..0xa344f4 multiplies each object's scale by a factor from the table at [obj+0x6c] + 0x1c8, filled at run time,
not in the layout files). Only a factor of 2 keeps the 184 positions inside the strip and reaches its pale end (Raven,
2026-10-19: "it feels like it goes lighter in game"; at 1 they stop half way, at 3 they run off the strip). With it,
texel = 2 + 2 * (i + 2 - 2) = HD texel 2i + 2 = 3DS texel i + 1.
The factor's value itself is the one thing not read from the files (it is computed at start-up). A save made at the
rightmost position settles it: (240, 221, 204) confirms this; (241, 224, 209) would mean 3DS texel i + 2.

    python dev/build-skin-strip.py [out.json]      # default docs/ui/skin-strip.json
"""
import json, os, struct, sys

TEX = r'C:/MHGU-ROM/romfs/nativeNX/eng/GUI/99_texture/HD_demo_hadairo_NOMIP.tex'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(HERE), 'docs', 'ui', 'skin-strip.json')
POSITIONS, DEFAULT = 184, 183


def main():
    d = open(TEX, 'rb').read()
    assert d[:4] == b'TEX\0'
    w1, w2, w3 = struct.unpack_from('<3I', d, 4)
    W, H, fmt = (w2 >> 6) & 0x1fff, (w2 >> 19) & 0x1fff, (w3 >> 8) & 0xff
    assert (w1 & 0xfff, W, H, fmt) == (0xa0, 512, 16, 7), (hex(w1), W, H, fmt)
    src = d[24:]
    wb, bh = W * 4, 2                      # 16 rows: a block 2 GOBs high
    gx = (wb + 63) // 64
    def texel(x, y):
        xb = x * 4
        a = ((y // (8 * bh)) * gx * 512 * bh + (xb // 64) * 512 * bh + ((y % (8 * bh)) // 8) * 512 +
             ((xb % 64) // 32) * 256 + ((y % 8) // 2) * 64 + ((xb % 32) // 16) * 32 + (y % 2) * 16 + (xb % 16))
        return tuple(src[a:a + 4])
    # row 0 is what the code reads (the lower rows differ from it by one step in a few texels)
    cols = [list(texel(2 * i + 2, 0)[:3]) for i in range(1, POSITIONS + 1)]
    out = {
        'source': 'eng/GUI/99_texture/HD_demo_hadairo_NOMIP.tex (GUI 03_title/menu_down, instance hadairo, pane 3)',
        'rule': 'position i (1..184) = HD texel (2i + 2, 0) = the 3DS texel i + 1 (screen scale 2 in the world matrix); a new character starts at position 183',
        'first': 1, 'default': DEFAULT,
        'colours': cols,
    }
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('{\n' + ',\n'.join('  %s: %s' % (json.dumps(k), json.dumps(v)) for k, v in out.items() if k != 'colours') +
                ',\n  "colours": [\n' + ',\n'.join('    ' + json.dumps(c) for c in cols) + '\n  ]\n}\n')
    print('wrote', OUT, len(cols), 'positions;', 'first', cols[0], 'default', cols[DEFAULT - 1], 'last', cols[-1])


if __name__ == '__main__':
    main()
