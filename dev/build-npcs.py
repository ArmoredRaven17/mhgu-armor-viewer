"""THE NPCs (2026-10-23; Raven: "An NPC tab in the Armor Viewer"): every NPC the game's own table names, its model and its
motion lists, read from the ROM.

    python dev/build-npcs.py [--out DIR] [--only npc001,npc101]     # default DIR: docs/

THE TABLE: arc/npc/com.arc  npc\\tables\\baseData\\npcID  (f32 62.5, u32 count 188, then 47-byte records):
    +0  u32  the NPC number (npc_NNN, the talk scripts' table/npc/script/npc_NNN_*)
    +7  u16  the MODEL number (npc\\mod\\npcMMM\\npcMMM.mod; 0 = none -- Hunters for Hire, Palico Scout)
    +9..+28  ten (motion, blend) byte pairs: the NPC's OWN motions, motion numbers of its +29 list (0xff = empty slot);
             the game's field names (cNpcBaseData_ID, rodata 0x15599a3): mMotNo_Footwork[0..2], mMotNo_Talk[0..2],
             mMotNo_Walk, mMotNo_Run, mAccentFw[0..1], each followed by its mHokan (the blend into it, frames);
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
    npcs.json                         { npcs: [{ name, ids, model, lists, poses: [[list key, clip] ...], colours,
                                                 parts?: [[0 hide | 2 show, group] ...], partsByMotion?: true | [motion] }],
                                        models: { npcMMM: { glb, arc, joints } },
                                        lists: { "npcMMM_<list>": { file, list,
                                                 clips: [{ clip, dur, parts?: { at, groups, spans } }] } } }
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


def palettes():
    """npc number -> (its palette, its parts): arc/npc/sub.arc npc/tables/subData/sub_modNNN_p01 (NNN = the NPC NUMBER,
    not the model; Raven, 2026-10-23: "Some NPCs are the same, but pallete swapped"): f32 7.3, u32 count, then 5-byte
    entries (cNpcSubData: mCmd, then a byte and mCol[3]), applied in order by uLobbyNpc 0x6bf26c:
      mCmd 1  a colour for the model's materials of that colour channel (3 = the _sym region, 1 and 2 as the player's).
              Red Hell Hunter (129) ch3 = 153,65,49, Black Hell Hunter (130) ch3 = 80,75,27 -- the same model, npc129.
      mCmd 0  HIDES mesh group <byte>: clears its bit of the model's parts-display set (uModel +0x110, the "PartsDisp"
      mCmd 2  SHOWS it    property; the constructor 0x88baa0 starts with every group shown). Raven, 2026-10-23: "Argosy
              Captain has a second sword model rendering" -- his (52) one record is (0, 1): the copy in his hand,
              Group[1] (skinned to it), is hidden and the one on his back, Group[2], stays -- both are the sword in its
              sheath. 17 NPCs carry such records."""
    out = {}
    sub = extracted(os.path.join('npc', 'sub.arc'))
    for dp, dn, fn in os.walk(sub):
        for f in fn:
            m = re.match(r'sub_mod(\d+)_p(\d+)', f)
            if not m or m.group(2) != '01': continue
            d = open(os.path.join(dp, f), 'rb').read()
            n = struct.unpack_from('<I', d, 4)[0]
            cols, parts = [], []
            for k in range(n):
                t, ch, r, g, b = d[8 + 5 * k:13 + 5 * k]
                if t == 1: cols.append([ch, [r, g, b]])
                elif t in (0, 2): parts.append([t, ch])
            out[int(m.group(1))] = (cols, parts)
    return out


# PARTS BY MOTION: uLobbyNpc 0x6beb38 runs each frame for these NPC numbers only (a switch on the number, +0x16c0) and
# sets the model's mesh groups from the PLAYING motion's LMT event group 1 (anim +0x34, group base +0x48): 32 u16 group
# numbers, then (bits, frames) spans; at the current frame (one less once the motion has ended), a set bit k HIDES group
# slot k and a clear one shows it; a span of no bits, or no span, shows every group (0x13ecd58 over the whole set). The
# Argosy Captain (52) runs it only while his motion is 124 or 125 (his routine 0x6c73c0 plays them; Raven: when you finish
# his quest line he gives you the sword -- 124 lifts it, sheathed, off his back at frame 91, and in 125 it is gone: both
# copies hidden); every other NPC not named here never touches its groups after the subData above.
# MOTIONS THE CODE PLAYS: the NPC's routine plays these itself, outside the table's ten slots -- the Captain's 0x6c73c0
# (`mov r1, #0x7c` / `#0x7d` into the motion setter 0x53943c). Shipped as his poses (Raven, 2026-10-23: "Yes").
ROUTINE_MOTIONS = {52: [124, 125]}
PARTS_BY_MOTION = {8: True, 46: True, 52: [124, 125], 129: True, 130: True, 323: True, 333: True, 424: True, 521: True,
                   524: True, 621: True, 701: True, 702: True, 801: True, 802: True, 805: True, 812: True}


def motion_parts(lmt):
    """motion number -> (loop frame, [group per slot], [[bits, frames] ...]) from an LMT's event group 1 (see above)"""
    d = open(lmt, 'rb').read()
    n = struct.unpack_from('<H', d, 6)[0]
    out = {}
    for m in range(n):
        o = struct.unpack_from('<I', d, 8 + 4 * m)[0]
        if not o: continue
        loop = struct.unpack_from('<i', d, o + 12)[0]
        ev = struct.unpack_from('<I', d, o + 0x34)[0]
        groups, spans = [], []
        if ev:
            b = ev + 0x48
            groups = list(struct.unpack_from('<32H', d, b))
            while groups and not groups[-1]: groups.pop()
            nf, fp = struct.unpack_from('<II', d, b + 64)
            spans = [list(struct.unpack_from('<II', d, fp + 8 * k)) for k in range(nf)]
        out[m] = (loop, groups, spans)
    return out


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
    pal = palettes()
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
        cols, parts = pal.get(r['id'], ([], []))
        pbm = PARTS_BY_MOTION.get(r['id'])
        # one NPC per name, model, palette AND parts: two records that colour or cut the same model differently stay apart
        e = npcs.setdefault((name, model, json.dumps(cols), json.dumps(parts), json.dumps(pbm)),
                            {'name': name, 'ids': [], 'model': model, 'own': [], 'poses': [], 'colours': cols,
                             'parts': parts, 'partsByMotion': pbm})
        e['ids'].append(r['id'])
        if r['l1'] < len(mot) and r['slots']:
            e['own'].append((r['id'], mot[r['l1']], r['slots'] + ROUTINE_MOTIONS.get(r['id'], [])))
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
    for (name, model, *_k), e in npcs.items():
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
        row = {'name': name, 'ids': e['ids'], 'model': model,
               'lists': [k for k in dict.fromkeys(k for k, _c in e['poses'])], 'poses': e['poses'],
               'colours': e['colours']}
        if e['parts']: row['parts'] = e['parts']
        if e['partsByMotion']: row['partsByMotion'] = e['partsByMotion']
        res['npcs'].append(row)
    # ship each list with only the clips some NPC is given (their own, from the table), nothing else
    for key, clips in want.items():
        full = os.path.join(CACHE, key + '.glb'); dst = os.path.join(out_poses, key + '.glb')
        js, bin_ = HM.glb_split(full)
        js['animations'] = [an for an in js.get('animations', []) if an.get('name') in clips]
        tmp = os.path.join(WORK, 'filter.glb'); HM.glb_write(tmp, js, bin_)
        HM.strip_to_animation(tmp, dst, {n.get('name') for n in js['nodes']})
        compact(dst)
        lst = key.split('_', 1)[1]
        mp = motion_parts(os.path.join(motd, 'npc', 'mot', lst + '.lmt'))
        clips = []
        for c, dur in HM.clip_list(B.glb_json(dst)):
            row = {'clip': c, 'dur': dur}
            loop, groups, spans = mp.get(motion_no(c), (-1, [], []))
            # a clip's parts track, where it has one: the converter splits a looping motion at its loop frame into
            # "_start" (0..) and "_loop" (loop..), so `at` is the LMT frame the clip's first frame is
            if any(bits for bits, _n in spans):
                row['parts'] = {'at': loop if c.endswith('_loop') and loop > 0 else 0, 'groups': groups, 'spans': spans}
            clips.append(row)
        res['lists'][key] = {'file': 'poses/npcs/%s.glb' % key, 'list': lst, 'clips': clips}
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
