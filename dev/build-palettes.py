"""THE COMBINED COLOUR PICKER'S DATA: docs/base/palettes.json, one tab per game (2026-10-18; the shared viewer base,
C:\\Coding Repos\\VIEWER-BASE-PLAN.md, Raven's Phase 1.2 decision: "one combined picker with a TAB PER GAME, in every
viewer"). The one base file allowed to name games. Built from each game's OWN data, read only:

  MHGU  docs/ui/colorscale.png (the game's colour board, dev/build-colorscale.py), docs/pigments.json
        (equipBaseColorData.ebcd: 125 RGB triples in the game's order), and this page's DEVIANTS
        (the 18 Deviant pigment pairs, their animation) and PALETTES (the eight palette groups the same initialiser
        builds) from docs/index.html
  MH3U  C:/MH3U-Extract/MH3U-Armor-Viewer/docs/armor.json `colors`: the td_color board, the 24 colour presets (the game
        labels them "1".."12" per palette: hair, then the other), the 44 armour pigments, the Skin Tone strip
  MH4U  C:/Coding Repos/mh4u-armor-viewer/docs/armor.json `colors`: the colorscale board, the 70 pigments

NAMES ARE THE GAME'S OR NONE (Raven: never invent one). A colour the game gives no name has `name: null`; the 3U presets
take the game's own numbers; GU's palette groups keep the viewer's placeholder heading ("Group N", a heading, not a
colour name, until each is identified). 4U prints no swatch names: only Default and Rainbow (its agent's read, 2026-10-18). The board images are copied into
docs/base/boards/ so every viewer can show every tab.

    python dev/build-palettes.py            # writes docs/base/palettes.json and docs/base/boards/*.png
"""
import json, os, re, shutil, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(os.path.dirname(HERE), 'docs')
OUT = os.path.join(DOCS, 'base', 'palettes.json')
BOARDS = os.path.join(DOCS, 'base', 'boards')
SRC_3U = r'C:/MH3U-Extract/MH3U-Armor-Viewer/docs'
SRC_4U = r'C:/Coding Repos/mh4u-armor-viewer/docs'

hx = lambda rgb: '#%02x%02x%02x' % tuple(rgb[:3])


def js_array(src, name):
    """a top-level `const NAME = [ ... ];` of the page, single-quoted strings, as JSON"""
    m = re.search(r'^const ' + name + r' = (\[.*?\n\]);', src, re.S | re.M)
    if not m:
        raise SystemExit('no ' + name + ' in index.html')
    txt = re.sub(r'//[^\n]*', '', m.group(1)).replace("'", '"')
    txt = re.sub(r',\s*([\]}])', r'\1', txt)
    return json.loads(txt)


def board(src_docs, b, key):
    os.makedirs(BOARDS, exist_ok=True)
    src = os.path.join(src_docs, b['png'])
    dst = os.path.join(BOARDS, key + '.png')
    shutil.copyfile(src, dst)
    return {'image': 'boards/' + key + '.png', 'w': b['w'], 'h': b['h'], 'region': b['region']}


def main():
    page = open(os.path.join(DOCS, 'index.html'), encoding='utf-8').read()
    gu_pig = json.load(open(os.path.join(DOCS, 'pigments.json'), encoding='utf-8'))
    deviants = js_array(page, 'DEVIANTS')
    groups = js_array(page, 'PALETTES')
    tabs = []
    tabs.append({
        'game': 'MHGU', 'label': 'MHGU',
        # the game's colour board (dev/build-colorscale.py reads it from the ROM into docs/ui/colorscale.png)
        'board': board(DOCS, {'png': 'ui/colorscale.png', 'w': 512, 'h': 128, 'region': [2, 2, 353, 103]}, 'mhgu-colorscale'),
        'pigments': [{'i': p['i'], 'hex': p['hex'].lower(), 'name': None} for p in gu_pig],
        'groups': [{'label': g[0], 'colors': [{'hex': h.lower(), 'name': None} for h in g[2]]} for g in groups],
        'deviants': [{'name': d[0], 'a': d[1].lower(), 'b': d[2].lower(), 'anim': d[3]} for d in deviants],
        'source': 'docs/ui/colorscale.png (eng GUI HD_lby_colorscale); docs/pigments.json (equipBaseColorData.ebcd); index.html DEVIANTS, PALETTES',
    })
    c3 = json.load(open(os.path.join(SRC_3U, 'armor.json'), encoding='utf-8'))['colors']
    pre = c3['presets']
    def preset(k, n):
        p = pre[k]
        return {'hex': hx(p), 'name': str(n), 'board': [p[3], p[4]] if len(p) >= 5 else None}
    tabs.append({
        'game': 'MH3U', 'label': 'MH3U',
        'board': board(SRC_3U, c3['board'], 'mh3u-td_color'),
        'presets': [{'label': 'Hair Color', 'colors': [preset(k, i + 1) for i, k in enumerate(c3['hairPresets'])]},
                    {'label': None, 'colors': [preset(k, i + 1) for i, k in enumerate(c3['otherPresets'])]}],
        'pigments': [{'i': i, 'hex': hx(p), 'name': None} for i, p in enumerate(c3['pigments'])],
        'skin': {'strip': [hx(p) for p in c3['skin']['strip']], 'default': c3['skin'].get('default')},
        'source': 'MH3U-Armor-Viewer docs/armor.json colors',
    })
    c4 = json.load(open(os.path.join(SRC_4U, 'armor.json'), encoding='utf-8'))['colors']
    tabs.append({
        'game': 'MH4U', 'label': 'MH4U',
        'board': board(SRC_4U, c4['board'], 'mh4u-colorscale'),
        'pigments': [{'i': i, 'hex': hx(p), 'name': None} for i, p in enumerate(c4['pigments'])],
        # the only pigment labels the game prints (MH4U Armor Viewer agent's read, 2026-10-18): the board's swatches are
        # unnamed; Default (the piece's own) and the unlockable Rainbow are the named specials
        'specials': [{'name': 'Default', 'hex': None}, {'name': 'Rainbow', 'hex': None}],
        'source': 'mh4u-armor-viewer docs/armor.json colors; labels: the MH4U agent read 2026-10-18',
    })
    out = {'_about': 'The combined colour picker: a tab per game, each from the game\'s own data '
                     '(dev/build-palettes.py). name null = the game gives none. A board pick is a colour like any '
                     'other: the row stores the hex.',
           'tabs': tabs}
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, indent=1)
        f.write('\n')
    for t in tabs:
        print(t['game'], len(t.get('pigments', [])), 'pigments',
              ('board ' + t['board']['image']) if t.get('board') else '',
              ('%d groups' % len(t['groups'])) if t.get('groups') else '',
              ('%d deviants' % len(t['deviants'])) if t.get('deviants') else '',
              ('%d presets' % sum(len(g['colors']) for g in t['presets'])) if t.get('presets') else '')


if __name__ == '__main__':
    main()
