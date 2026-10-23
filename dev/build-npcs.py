"""THE NPCs (2026-10-23; Raven: "An NPC tab in the Armor Viewer"): every NPC the game's own table names, its model and its
motion lists, read from the ROM.

    python dev/build-npcs.py [--out DIR] [--only npc001,npc101]     # default DIR: docs/

THE TABLE: arc/npc/com.arc  npc\\tables\\baseData\\npcID  (f32 62.5, u32 count 188, then 47-byte records):
    +0  u32  the NPC number (npc_NNN, the talk scripts' table/npc/script/npc_NNN_*)
    +7  u16  the MODEL number (npc\\mod\\npcMMM\\npcMMM.mod; 0 = none -- Hunters for Hire, Palico Scout)
    +9..+28  ten (motion, value) byte pairs: the NPC's OWN motions, motion numbers of its +29 list (0xff = empty slot);
             515 of 545 named motions are in that list (the rest belong to placeholder records). Only these ship
             (Raven, 2026-10-23: "Restrict the poses, since some poses end up looking odd with some NPCs")
    +29 u16  its motion list, an index into arc/npc/mot.arc's lists in archive order (0 mtp_0 ... 28 multi_03)
    +37 u16  a second list, the same index (Bherna's NPCs: com_0, the shared set); 255 = none
  THE NAMES: eng/table/NpcName_eng.gmd, one string per record in record order (190 strings, 188 records; Bherna Chief,
  Bherna Gal, ...). A record whose string is a placeholder ("-", "@") or whose model is 0 is left out.
  Read and checked: every village's own NPCs name that village's lists (Bherna bln, Kokoto cct, Pokke pck, Yukumo ykm,
  ...; Poogie lpet_p, Moofy lpet_y), and a list built on its NPC's model binds every animated bone (npc001: bln_0 29
  clips, com_0 56, 21 bones, none missing).
  The same model can stand for several records (Bherna Chief also visits the Soaratorium: record 724, model 1, lab_1);
  records with the same NAME and MODEL are one NPC here, their lists together.

OUTPUT (into DIR):
    models/npcs/npcMMM.glb            the model (buildlib.mod_to_gltf, the armour pipeline's fixes)
    poses/npcs/npcMMM_<list>.glb      a list built on that model, keeping only the motions its NPCs are given: nodes +
                                      animations only, keys reduced, one buffer view per accessor (the whole lists stay
                                      in the scratch cache, C:/MHGU-Extract/scratch-npc/lists)
    npcs.json                         { npcs: [{ name, ids, model, lists, poses: [[list key, clip] ...] }],
                                        models: { npcMMM: { glb, arc, joints } },
                                        lists: { "npcMMM_<list>": { file, list, clips: [{ clip, dur }] } } }
    and C:/MHGU-Extract/build/frag/npcs.json: the models' .mrl / .glb for build-materials.py --npcs
"""
import argparse, collections, importlib.util, json, os, re, shutil, struct, sys, time

sys.path.insert(0, r'C:\MHGU-Extract')
import buildlib as B   # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(os.path.dirname(HERE), 'docs')
WORK = os.path.join(B.ROOT, 'scratch-npc')
LMT, MOD = 0x76820d81, 0x58a15856
PLACEHOLDER = {'', '-', '@'}


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(B.ROOT, file))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


HM = _load('harvest_monsters', 'harvest-monsters.py')   # strip_to_animation, clip_list, reduce_keys


def arc_entries(path):
    d = open(path, 'rb').read(); cnt = struct.unpack_from('<H', d, 6)[0]; out = []
    for i in range(cnt):
        o = 12 + i * 80
        out.append((d[o:o + 64].split(b'\0')[0].decode('latin1'), struct.unpack_from('<I', d, o + 64)[0]))
    return out


def extracted(arc_rel):
    dst = os.path.join(WORK, 'arc', arc_rel.replace('\\', '_').replace('/', '_'))
    if not os.path.isdir(dst):
        B.extract_arc(os.path.join(B.ARC, arc_rel), dst)
    return dst


def read_table():
    com = extracted(os.path.join('npc', 'com.arc'))
    d = open(os.path.join(com, 'npc', 'tables', 'baseData', 'npcID.npcid'), 'rb').read() \
        if os.path.isfile(os.path.join(com, 'npc', 'tables', 'baseData', 'npcID.npcid')) else None
    if d is None:   # the toolset names it by its type; find it
        for dp, dn, fn in os.walk(os.path.join(com, 'npc', 'tables', 'baseData')):
            for f in fn:
                if f.lower().startswith('npcid'): d = open(os.path.join(dp, f), 'rb').read()
    n = struct.unpack_from('<I', d, 4)[0]
    assert len(d) == 8 + 47 * n, (len(d), n)
    recs = []
    for i in range(n):
        r = d[8 + 47 * i:8 + 47 * (i + 1)]
        recs.append({'id': struct.unpack_from('<I', r, 0)[0], 'model': struct.unpack_from('<H', r, 7)[0],
                     'l1': struct.unpack_from('<H', r, 29)[0], 'l2': struct.unpack_from('<H', r, 37)[0],
                     # the NPC's OWN motions, in the table's slot order: motion numbers of its list (+29)
                     'slots': [r[9 + 2 * k] for k in range(10) if r[9 + 2 * k] != 0xff]})
    names = B.gmd_strings(os.path.join(B.ENG_TABLE, 'NpcName_eng.gmd'))
    mot = [n.split('\\')[-1] for n, t in arc_entries(os.path.join(B.ARC, 'npc', 'mot.arc')) if t == LMT]
    return recs, names, mot


def model_sources():
    """npcMMM -> the archive that ships its .mod (npcFakeArc first, then the village / event archives)"""
    order = [os.path.join('npc', 'npcFakeArc.arc')]
    for sub in ('npc', 'ev'):
        for f in sorted(os.listdir(os.path.join(B.ARC, sub))):
            if f.endswith('.arc') and os.path.join(sub, f) not in order: order.append(os.path.join(sub, f))
    src = {}
    for rel in order:
        for nm, t in arc_entries(os.path.join(B.ARC, rel)):
            low = nm.lower()
            if t == MOD and low.startswith('npc\\mod\\npc'):
                stem = low.split('\\')[-1]
                src.setdefault(stem, rel)
    return src


COMP = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def compact(path):
    """one buffer view per accessor, holding only that accessor's bytes: lmt_to_gltf packs a whole list into ONE view,
    which strip_to_animation copies whole, so a file keeping 3 clips still carried all 29 (npc001_bln_0: 278 KB for 25)"""
    js, bin_ = HM.glb_split(path)
    out, views = bytearray(), []
    for acc in js['accessors']:
        if acc.get('bufferView') is None: continue
        bv = js['bufferViews'][acc['bufferView']]
        size = COMP[acc['componentType']] * NCOMP[acc['type']]
        stride = bv.get('byteStride') or size
        start = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
        data = b''.join(bin_[start + i * stride:start + i * stride + size] for i in range(acc['count']))             if stride != size else bin_[start:start + size * acc['count']]
        while len(out) % 4: out.append(0)
        views.append({'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)})
        out += data
        acc['bufferView'] = len(views) - 1; acc.pop('byteOffset', None)
    js['bufferViews'] = views; js['buffers'] = [{'byteLength': len(out)}]
    HM.glb_write(path, js, bytes(out))


def motion_no(clip):
    m = re.match(r'Motion\[(\d+)\]', clip)
    return int(m.group(1)) if m else -1


def skin_joints(glb):
    """the model's joint list in skin order, as the armour manifest carries it: [{gid, leaf}] from the converter's node
    names "<index>:<gid>" -- a "_s" suffix is the leaf twin the vertices bind to (base/render/skeleton.js bonesByGid)"""
    j = B.glb_json(glb)
    if not j.get('skins'): return []
    out = []
    for n in j['skins'][0]['joints']:
        nm = j['nodes'][n].get('name', '')
        g = nm.split(':', 1)[1] if ':' in nm else ''
        leaf = g.endswith('_s'); g = g[:-2] if leaf else g
        out.append({'gid': int(g) if g.isdigit() else None, 'leaf': leaf})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=DOCS)
    ap.add_argument('--only', default='')
    ap.add_argument('--force', action='store_true', help='rebuild lists already in DIR (default: reuse them)')
    a = ap.parse_args()
    only = set(x for x in a.only.split(',') if x)
    os.makedirs(WORK, exist_ok=True)
    recs, names, mot = read_table()
    src = model_sources()
    # one NPC per (name, model), its lists in record order
    npcs = collections.OrderedDict(); skipped = []
    for i, r in enumerate(recs):
        name = names[i] if i < len(names) else ''
        model = 'npc%03d' % r['model'] if r['model'] else None
        if name in PLACEHOLDER or not model:
            skipped.append((r['id'], name, model, 'no name' if name in PLACEHOLDER else 'no model')); continue
        if model not in src:
            skipped.append((r['id'], name, model, 'model not in the ROM')); continue
        if only and model not in only: continue
        e = npcs.setdefault((name, model), {'name': name, 'ids': [], 'model': model, 'own': [], 'poses': []})
        e['ids'].append(r['id'])
        if r['l1'] < len(mot) and r['slots']:
            e['own'].append((r['id'], mot[r['l1']], r['slots']))
    motd = extracted(os.path.join('npc', 'mot.arc'))
    out_models = os.path.join(a.out, 'models', 'npcs'); out_poses = os.path.join(a.out, 'poses', 'npcs')
    os.makedirs(out_models, exist_ok=True); os.makedirs(out_poses, exist_ok=True)
    res = {'npcs': [], 'models': {}, 'lists': {}}
    frag = {'models': {}}
    built = {}
    notes = []
    CACHE = os.path.join(WORK, 'lists'); os.makedirs(CACHE, exist_ok=True)
    want = {}               # list key -> the clips some NPC is given
    shipped_once = set()
    for (name, model), e in npcs.items():
        if model not in built:
            ad = extracted(src[model])
            mod = os.path.join(ad, 'npc', 'mod', model, model + '.mod')
            glb = mod[:-4] + '.glb'
            if a.force or not os.path.isfile(glb):
                glb = B.mod_to_gltf(mod)
            if not glb:
                notes.append('%s: mod_to_gltf failed' % model); built[model] = None; continue
            dst = os.path.join(out_models, model + '.glb'); shutil.copy2(glb, dst)
            mrl = mod[:-4] + '.mrl'
            built[model] = {'glb': glb, 'nodes': {n.get('name') for n in B.glb_json(glb)['nodes']}}
            res['models'][model] = {'glb': 'models/npcs/%s.glb' % model, 'arc': src[model].replace('\\', '/'),
                                    'joints': skin_joints(glb)}
            frag['models'][model] = {'mrl': mrl if os.path.isfile(mrl) else None, 'glb': 'models/npcs/%s.glb' % model}
        if not built[model]: continue
        for nid, lst, slots in e['own']:
            key = '%s_%s' % (model, lst)
            full = os.path.join(CACHE, key + '.glb')
            # the first run shipped every list whole into docs/poses/npcs: those are the cache now
            old = os.path.join(out_poses, key + '.glb')
            if not os.path.isfile(full) and os.path.isfile(old) and key not in shipped_once:
                shutil.move(old, full)
            if not os.path.isfile(full) or a.force:
                lmt = os.path.join(motd, 'npc', 'mot', lst + '.lmt')
                if not os.path.isfile(lmt) or os.path.getsize(lmt) <= 8:
                    notes.append('%s: %s is empty' % (key, lst)); continue
                bd = os.path.join(WORK, 'batch'); shutil.rmtree(bd, ignore_errors=True); os.makedirs(bd)
                shutil.copy2(lmt, os.path.join(bd, key + '.lmt')); shutil.copy2(built[model]['glb'], os.path.join(bd, key + '.glb'))
                json.dump([[key + '.glb', key + '.lmt']], open(os.path.join(bd, 'batch.json'), 'w'))
                B.run_tool('lmt_to_gltf', os.path.join(bd, 'batch.json'))
                srcg = os.path.join(bd, key + '_out.glb')
                if not os.path.isfile(srcg):
                    notes.append('%s: lmt_to_gltf produced nothing' % key); continue
                anims, dropped = HM.strip_to_animation(srcg, full, built[model]['nodes'])
                for attempt in range(6):          # Windows can hold the fresh file a moment (WinError 5 on replace)
                    try:
                        HM.reduce_keys(full); break
                    except PermissionError:
                        time.sleep(1 + attempt)
                if dropped: notes.append('%s: dropped channels %s' % (key, dict(dropped)))
            names_in = [c for c, _d in HM.clip_list(B.glb_json(full))]
            for m in slots:
                for c in names_in:
                    if motion_no(c) == m and [key, c] not in e['poses']:
                        e['poses'].append([key, c])
                if not any(motion_no(c) == m for c in names_in):
                    notes.append('%s (%s): motion %d is not in %s' % (name, nid, m, lst))
            want.setdefault(key, set()).update(c for k, c in e['poses'] if k == key)
        res['npcs'].append({'name': name, 'ids': e['ids'], 'model': model,
                            'lists': [k for k in dict.fromkeys(k for k, _c in e['poses'])], 'poses': e['poses']})
    # ship each list with only the clips some NPC is given (their own, from the table), nothing else
    for key, clips in want.items():
        full = os.path.join(CACHE, key + '.glb'); dst = os.path.join(out_poses, key + '.glb')
        js, bin_ = HM.glb_split(full)
        js['animations'] = [an for an in js.get('animations', []) if an.get('name') in clips]
        tmp = os.path.join(WORK, 'filter.glb'); HM.glb_write(tmp, js, bin_)
        HM.strip_to_animation(tmp, dst, {n.get('name') for n in js['nodes']})
        compact(dst)
        res['lists'][key] = {'file': 'poses/npcs/%s.glb' % key, 'list': key.split('_', 1)[1],
                             'clips': [{'clip': c, 'dur': d} for c, d in HM.clip_list(B.glb_json(dst))]}
        shipped_once.add(key)
    # a list no NPC draws from any more leaves the docs (it stays in the cache)
    for f in os.listdir(out_poses):
        if f.endswith('.glb') and f[:-4] not in want:
            os.remove(os.path.join(out_poses, f))
    with open(os.path.join(a.out, 'npcs.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(res, f, indent=1); f.write('\n')
    B.write_frag('npcs', frag)
    print('npcs', len(res['npcs']), 'models', len(res['models']), 'lists', len(res['lists']),
          'clips', sum(len(v['clips']) for v in res['lists'].values()),
          'npcs with no pose', [n['name'] for n in res['npcs'] if not n['poses']])
    print('skipped', len(skipped), skipped[:12])
    print('\n'.join(notes[:40]))


if __name__ == '__main__':
    main()
