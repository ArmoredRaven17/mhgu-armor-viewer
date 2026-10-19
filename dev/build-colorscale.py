"""THE GAME'S COLOUR BOARD: docs/ui/colorscale.png, read from the ROM (2026-10-18; Raven, on the Pigment Selection
modal: "I want tabs within the modal" -- the first tab shows the pigments with the game's colour board, as 4U does).

  eng/arc/village/common_eng.arc (also eng/arc/title_eng.arc)  eng\\GUI\\99_texture\\HD_lby_colorscale_NOMIP  (rTexture)

TEX v0xA0, 512 x 128, one mip, format 7 (RGBA8), Switch block-linear (GOBs of 64 bytes x 8 rows, a block 16 GOBs
high). The only layouts that place it are GUI\\02_common\\charamake\\chara_s and chara_s01 (their Null_colorScale
pane): the colour screens, which the Item Box's Change Armor Pigment draws -- the Item Box's own layout (GUI\\02_common
\\i_box) holds no board. The board is the texture's top-left box inside a 2-pixel black frame: [2, 2, 353, 103]
(inclusive, as the MH3U / MH4U viewers give their regions), the hue x shade field and the grey strip; the two rainbow bars to the right are the layout's
Tex_nizi ("rainbow"), not the board. 4U's lby_colorscale is the same design at half the size.

    python dev/build-colorscale.py [out.png]      # default docs/ui/colorscale.png
"""
import os, struct, sys, zlib
from PIL import Image

ARC = r'C:/MHGU-ROM/romfs/nativeNX/eng/arc/village/common_eng.arc'
NAME = 'eng\\GUI\\99_texture\\HD_lby_colorscale_NOMIP'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(HERE), 'docs', 'ui', 'colorscale.png')
REGION = [2, 2, 353, 103]          # inclusive


def entry(arc, name):
    d = open(arc, 'rb').read()
    cnt = struct.unpack_from('<H', d, 6)[0]
    for i in range(cnt):
        o = 12 + i * 80
        if d[o:o + 64].split(b'\0')[0].decode('latin1') != name: continue
        t, csz, dsz, off = struct.unpack_from('<4I', d, o + 64)
        return zlib.decompress(d[off:off + csz])
    raise SystemExit('no ' + name + ' in ' + arc)


def main():
    d = entry(ARC, NAME)
    assert d[:4] == b'TEX\0'
    w1, w2, w3 = struct.unpack_from('<3I', d, 4)
    W, H, fmt = (w2 >> 6) & 0x1fff, (w2 >> 19) & 0x1fff, (w3 >> 8) & 0xff
    assert (w1 & 0xfff, W, H, fmt) == (0xa0, 512, 128, 7), (hex(w1), W, H, fmt)
    src = d[24:]
    wb, bh = W * 4, 16
    gx = (wb + 63) // 64
    out = bytearray(W * H * 4)
    for y in range(H):
        for x in range(W):
            xb = x * 4
            a = ((y // (8 * bh)) * gx * 512 * bh + (xb // 64) * 512 * bh + ((y % (8 * bh)) // 8) * 512 +
                 ((xb % 64) // 32) * 256 + ((y % 8) // 2) * 64 + ((xb % 32) // 16) * 32 + (y % 2) * 16 + (xb % 16))
            out[(y * W + x) * 4:(y * W + x) * 4 + 4] = src[a:a + 4]
    img = Image.frombytes('RGBA', (W, H), bytes(out))
    # the frame is where the code expects it
    px = img.load()
    x0, y0, x1, y1 = REGION
    assert all(px[x, 50][:3] == (0, 0, 0) for x in (x0 - 2, x0 - 1, x1 + 1, x1 + 2)), 'frame (x)'
    assert all(px[100, y][:3] == (0, 0, 0) for y in (y0 - 2, y0 - 1, y1 + 1, y1 + 2)), 'frame (y)'
    img.save(OUT)
    print('wrote', OUT, W, 'x', H, 'board', REGION)


if __name__ == '__main__':
    main()
