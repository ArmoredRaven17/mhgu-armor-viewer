"""ADD THE NPCs' MATERIALS TO docs/materials.json without moving anything that ships (2026-10-23, the NPC tab).

    python dev/merge-npc-materials.py <built.json> [--write]

<built.json> is a full `build-materials.py --npcs --out <built.json>` run (it stages the NPC maps into docs/tex). The
shipped database also carries what build-matanim.py adds afterwards (`anim`), so it is not rebuilt; instead:
  - every shared table (state, feat, cbm, glob, samp, globFields) of the build must START with the shipped table, row
    for row -- the NPC rows come after, so every index an existing entry holds still means what it meant;
  - every piece and weapon the shipped file has must come out of the build equal to it, `anim` aside;
  - then the shipped file gets the build's (longer) tables and the `npcMMM` pieces, and nothing else changes.
Refuses, and writes nothing, if either check fails. Without --write it only reports.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SHIPPED = os.path.join(os.path.dirname(HERE), 'docs', 'materials.json')
TABLES = ('state', 'feat', 'cbm', 'glob', 'samp', 'globFields')


def strip_anim(e):
    if not isinstance(e, dict) or 'mats' not in e: return e
    return dict(e, mats={k: {f: v for f, v in m.items() if f != 'anim'} for k, m in e['mats'].items()})


def main():
    built = json.load(open(sys.argv[1], encoding='utf-8'))
    ship = json.load(open(SHIPPED, encoding='utf-8'))
    bad = []
    for t in TABLES:
        a, b = ship.get(t), built.get(t)
        if not isinstance(a, list) or not isinstance(b, list) or b[:len(a)] != a:
            bad.append('table %s: shipped %d rows, built %d, prefix %s' % (t, len(a or []), len(b or []),
                                                                            'differs' if b else 'missing'))
    for grp in ('pieces', 'weapons'):
        for k, e in ship.get(grp, {}).items():
            if strip_anim(e) != strip_anim(built.get(grp, {}).get(k)):
                bad.append('%s %s changed' % (grp, k))
    npc = {k: v for k, v in built.get('pieces', {}).items() if k.startswith('npc') and k not in ship['pieces']}
    grow = {t: len(built[t]) - len(ship[t]) for t in TABLES}
    print('npc entries', len(npc), 'table rows added', grow, 'problems', len(bad))
    for b in bad[:20]: print('  ', b)
    if bad:
        print('NOT WRITTEN'); return 1
    if '--write' in sys.argv:
        for t in TABLES: ship[t] = built[t]
        ship['pieces'].update(npc)
        tmp = SHIPPED + '.part'
        with open(tmp, 'w', encoding='utf-8', newline='\n') as f: json.dump(ship, f, separators=(',', ':'))
        os.replace(tmp, SHIPPED)
        print('written', SHIPPED)
    return 0


if __name__ == '__main__':
    sys.exit(main())
