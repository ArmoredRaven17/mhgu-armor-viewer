// The image pages the effect host reads for a WEAPON's effects, added to docs/effects/rom-pages.bin -- the Monster
// Viewer's dev/effect-export-rom.mjs soaks a monster's schedule (its `always` / `rage` / `calm` records); this app's
// hunter runs a weapon class's effects from its MOTION CLIPS (docs/effects/<cls>.json `clips`, the .psl bits) and
// from the class's own requests (render/weapon-fx.js: the sword aura, Demon Riot's records, row 13, the bursts),
// and the pages those touch are not the pages a monster touches (2026-09-28: Arts Motion[3]'s cm120_081 record
// 925 read page 0x1782000, which no monster had, and the hunter host refused it).
//
//   node dev/effect-export-rom-w08.mjs <e2e dump dir> <docs/effects/<cls>.json> [--check | --audit]
//
// Runs every clip for its frames plus a tail, then every state record the way weapon-fx.js asks for it (root
// joint 0 on a joint-0 parent of angle order 0x30000; the Art's on the hunter with root joint -1; the bursts placed
// at a point with a colour in the second override word), and keeps the pages of before.bin it touched. --check
// runs the same on the shipped pages, strict, and reports the first refusal or that it ran. A page once shipped is
// never dropped. --audit is --check that does not stop: every clip and shape is tried on the shipped pages, a fresh
// host after each refusal, and every refusal is listed -- the state of a class at a glance, writing nothing.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { EffectHost } from '../docs/render/rom/effect/host.js';
import { EffectSchedule } from '../docs/render/rom/effect/schedule.js';
import '../docs/render/weapon-natives.js';   // 0x43400 / 0x320e00, answered as the page answers them

const audit = process.argv.includes('--audit');
const check = audit || process.argv.includes('--check');
const args = process.argv.slice(2).filter(a => a !== '--check' && a !== '--audit');
const [dir, defPath] = args;
const def = JSON.parse(readFileSync(defPath, 'utf8'));
const docs = dirname(defPath);
const cls = defPath.split(/[\\/]/).pop().replace('.json', '');

function pages(file){
  const b = readFileSync(file), out = [];
  for (let o = 0; o < b.length; ){
    const a = b.readUInt32LE(o), n = b.readUInt32LE(o + 4);
    out.push([a, new Uint8Array(b.subarray(o + 8, o + 8 + n))]);
    o += 8 + n;
  }
  return out;
}
const shipped = join(docs, 'rom-pages.bin'), romJson = join(docs, 'rom.json');
const info = JSON.parse(readFileSync(join(dir, 'e2e.json'), 'utf8'));
const image = check ? pages(shipped) : pages(join(dir, 'before.bin'));
const imageKeys = new Map(image.map(([a, bytes]) => [a / 4096, bytes]));
const hex = h => Uint8Array.from(h.match(/../g) || [], b => parseInt(b, 16));
const res = def.resources;

const touched = new Set();
const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const rot = (a, x, y, z) => [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, x, y, z, 1];
const RED = 0xff0014ff;   // resident pec_001 entry 8, the Power phial
let prims = 0, models = 0, starts = 0, f = 0, where = '';
const refusals = [];
// THE CLASS'S OWN REQUEST SHAPES (used in step 2 below), per class where it has its own -- a record key means nothing across
// classes: the Sword & Shield's 500/501/505 are other records, asked another way than the Switch Axe's
const CLASS_SHAPES = {
  // THE SWORD & SHIELD (render/weapon-fx-w01.js): holder rows 1 / 3 / 4 = w01_000 500 / 501 / 505 on the PLAYER with the
  // root joint 1 (0x116852c, 0x11687d4); rows 0 and 2 = cm002_002 201 and cm001_000 405 through the player's own block
  // (no overrides); Chaos Oil's rows 5..7 = w01_800 1100..1102 on the WEAPON unit, no overrides (the holder's 0x452b88)
  w01: [
    [500, 'parent', { rootJoint: 1 }], [501, 'parent', { rootJoint: 1 }], [505, 'parent', { rootJoint: 1 }],
    [201, 'parent', undefined], [405, 'parent', undefined],
    [1100, 'unit', undefined], [1101, 'unit', undefined], [1102, 'unit', undefined],
  ],
};
// a request that roots its record on a joint needs that joint on the parent, as the page's hunter host adds it
// (render/weapon-fx.js WeaponEffects.useDef requestJoints): the Sword & Shield's joint 1
const requestJoints = (CLASS_SHAPES[cls] || []).filter(([, who, r]) => who === 'parent' && r && r.rootJoint != null && r.rootJoint !== 0xffff)
                                               .map(([, , r]) => r.rootJoint);
// A HOST, built afresh after a refusal: a branch no recording took throws out of the lifted code mid-frame and the
// emulated memory is not to be trusted after it, so the soak drops that clip or record and goes on with a new host.
function build(){
  const host = new EffectHost({
    pages: image,
    heap: check ? JSON.parse(readFileSync(romJson, 'utf8')).heap : info.heapAtSnapshot,
    strict: check,
    records: JSON.parse(readFileSync(join(docs, 'mfx-records.json'), 'utf8')).records,
    drawSystem: hex(JSON.parse(readFileSync(join(docs, 'draw-system.json'), 'utf8')).bytes),
    resources: {
      meshTable: name => ({ count: res[name].meshCount, table: new Uint8Array(readFileSync(join(docs, res[name].mesh))) }),
      textureSize: name => res[name].size,
      anim: name => new Uint8Array(readFileSync(join(docs, res[name].ean))),
      list: name => new Uint8Array(readFileSync(join(docs, res[name].list))),
      material: (name, index) => res[name].materials[index],
    },
  });
  const page = host.m.page.bind(host.m);
  host.m.page = a => { const k = Math.floor(a / 4096); if (imageKeys.has(k)) touched.add(k); return page(a); };
  host.initDraw({ position: [0, 0, 1000], view: [...T, 0, 0, -1000, 1], world: [...T, 0, 0, 1000, 1] });
  // the hunter host as live.js builds it: every effect, one parent with the union of the joints
  const owners = def.effects.map(e => host.createEffect(new Uint8Array(readFileSync(join(docs, e.efl)))));
  const joints = [...new Set([...def.effects.flatMap(e => e.joints), ...requestJoints])];
  const parent = host.createParent(joints);
  const pose = f => { const a = f < 60 ? 0 : 0.01 * (f - 60); joints.forEach((j, k) => host.setJointMatrix(parent, j, rot(a, 20 * k, 100 + 40 * (k % 3), -25))); };
  host.setParentScale(parent, 1); pose(0);
  const entries = owners.map((owner, i) => ({ owner, def: def.effects[i] }));
  const schedule = new EffectSchedule(host, parent, entries, false);
  // the weapon unit's host: joint 0 alone, a player part unit's angle order
  const unit = host.createParent([0], 0x30000);
  host.setParentScale(unit, 1);
  const unitPose = f => host.setJointMatrix(unit, 0, rot(0.02 * f, 10, 120, 0));
  unitPose(0);
  const frame = () => {
    pose(f); unitPose(f);
    schedule.step();
    const d = host.drawFrame(schedule.effects());
    prims += d.prims.length; models += d.models.length;
    f++;
  };
  const stateEntry = key => schedule.entries.find(e => e.def.when === 'state' && e.def.record && e.def.record.key === key);
  const request = (key, par, requester) => {
    const e = stateEntry(key);
    if (!e) return null;
    const r = e.def.record;
    const q = host.requestEffect(e.owner, par, { index: r.index, key: r.key, path: r.path, payload: hex(r.payload) }, undefined, requester);
    e.requests.push(q); starts++;
    return { e, q };
  };
  const release = ({ e, q }) => { try { if (!q.stopped) host.stopRequest(q); host.releaseRequest(q); } catch (_) {} e.requests = e.requests.filter(x => x !== q); };
  return { host, schedule, parent, unit, frame, request, release };
}
let H = build();
const attempt = (label, run) => {
  where = label;
  try { run(H); }
  catch (e){
    refusals.push(label + ' at frame ' + f + ': ' + (e && e.message || e));
    if (check && !audit) throw e;
    H = build();
  }
};
{
  // 1. every motion clip, for its frames and a tail for what it started
  for (const [id, clip] of Object.entries(def.clips || {})){
    attempt('clip ' + id, ({ schedule, frame }) => {
      const n = (clip.frames || 0) + 90;
      for (let k = 0; k < n; k++){ schedule.setClip(cls + '|' + id, k, clip, 0); frame(); }
      schedule.setClip(null, 0, null, 0);
      for (let k = 0; k < 30; k++) frame();
    });
  }
  // 2. the class's own requests, as render/weapon-fx.js makes them: the Switch Axe's, and per class where it has its own
  // (a record key means nothing across classes: the Sword & Shield's 500/501/505 are other records, asked another way)
  const SHAPES = CLASS_SHAPES;
  const shapes = SHAPES[cls] || [
    [500, 'unit', { rootJoint: 0, colour: RED }], [501, 'unit', { rootJoint: 0 }],
    [505, 'unit', { rootJoint: 0, colour: RED }], [506, 'unit', { rootJoint: 0 }],
    [800, 'unit', { rootJoint: 0, colour: RED }], [801, 'unit', { rootJoint: 0 }],
    [502, 'unit', { rootJoint: 0 }],
    [900, 'parent', { rootJoint: 0xffff, colour: RED }], [901, 'parent', { rootJoint: 0xffff }],
    [510, 'parent', { position: [-30, 75, 150], scale: [1, 1, 1], type8: 3, colour2: RED }],
    [511, 'parent', { position: [-30, 75, 150], scale: [1, 1, 1], type8: 3, colour2: RED }],
    [512, 'parent', { position: [-30, 75, 150], scale: [1, 1, 1], type8: 3, colour2: RED }],
    [513, 'parent', { position: [-30, 75, 150], scale: [1, 1, 1], type8: 3, colour2: RED }],
    [510, 'parent', { position: [-30, 75, 150], scale: [1, 1, 1], type8: 3 }],
    [517, 'parent', { position: [0, -105, 0], scale: [1, 1, 1], type8: 3 }],
    [516, 'parent', { position: [0, -105, 0], scale: [1, 1, 1], type8: 3 }],
    // THE ELEMENT ROWS (2026-09-29): an Element-phial axe with one of the five elements takes the shells' element rows and
    // NO colour -- the first shell's 514 / 516 / 518 / 520 / 522, the second's 515 / 517 / 519 / 521 / 523 -- and the
    // second shell's plain and Dragon rows (511, 513) carry no colour either
    ...[514, 516, 518, 520, 522].map(k => [k, 'parent', { position: [-30, 75, 150], scale: [1, 1, 1], type8: 3 }]),
    ...[511, 513, 515, 519, 521, 523].map(k => [k, 'parent', { position: [0, -105, 0], scale: [1, 1, 1], type8: 3 }]),
    [512, 'parent', { position: [-30, 75, 150], scale: [1, 1, 1], type8: 3 }],
    // Tempest Axe's aura, holder code 12: the UNIQUE 1001 of cm123_081 on the hunter through the player's own block
    // (no overrides), as render/weapon-fx.js requestTempest asks it
    [1001, 'parent', undefined],
    // the player's own holder rows (render/weapon-fx.js PLAYER_TIMED_REQUESTS): row 11 on Motion[115] / [116], row 0 on the
    // sharpening Motion[255], both through the player's block with no overrides
    [550, 'parent', undefined], [205, 'parent', undefined],
  ];
  for (const [key, who, requester] of shapes){
    attempt('record ' + key, ({ frame, request, release, parent, unit }) => {
      const h = request(key, who === 'unit' ? unit : parent, requester);
      if (!h) return;
      for (let k = 0; k < 240; k++) frame();
      release(h);
      for (let k = 0; k < 30; k++) frame();
    });
  }
  // 3. the held aura's hide byte, both ways, and a burst cut at 34 frames as its shell cuts it (the Switch Axe's alone)
  if (!SHAPES[cls]) attempt('held 800', ({ host, frame, request, release, unit }) => {
    const h = request(800, unit, { rootJoint: 0, colour: RED });
    if (h){ for (let k = 0; k < 120; k++){ host.m.w8(h.q.core + 0x1c1, k % 40 < 20 ? 1 : 0); frame(); } release(h); for (let k = 0; k < 30; k++) frame(); }
  });
  if (!SHAPES[cls]) attempt('burst cut', ({ frame, request, release, parent }) => {
    const h = request(512, parent, { position: [-30, 75, 150], scale: [1, 1, 1], type8: 3, colour2: RED });
    if (h){ for (let k = 0; k < 34; k++) frame(); release(h); for (let k = 0; k < 60; k++) frame(); }
  });
}
const summary = f + ' frames: ' + prims + ' primitive draws, ' + models + ' model draws; ' + (H.schedule.starts + starts) + ' starts' +
  (refusals.length ? '; REFUSED ' + refusals.length + ': ' + refusals.join(' | ') : '');
if (check){ console.log(cls + ': ran ' + summary); process.exit(refusals.length ? 1 : 0); }

const keep = new Map();
if (existsSync(shipped)) for (const [a, bytes] of pages(shipped)) keep.set(a / 4096, bytes);
let added = 0;
for (const k of touched) if (!keep.has(k)){ keep.set(k, imageKeys.get(k)); added++; }
const parts = [];
for (const k of [...keep.keys()].sort((a, b) => a - b)){
  const head = Buffer.alloc(8);
  head.writeUInt32LE(k * 4096, 0); head.writeUInt32LE(4096, 4);
  parts.push(head, Buffer.from(keep.get(k)));
}
writeFileSync(shipped, Buffer.concat(parts));
const rom = existsSync(romJson) ? JSON.parse(readFileSync(romJson, 'utf8')) : {};
rom.heap = Math.max(rom.heap || 0, info.heapAtSnapshot);
rom.source = 'efx/e2e_dump.py before.bin: the image data sections after the static initialisers and the effect manager, pages the host touched (dev/effect-export-rom.mjs; the hunter\'s clips and requests, dev/effect-export-rom-w08.mjs)';
writeFileSync(romJson, JSON.stringify(rom, null, 1));
console.log(summary + '; ' + touched.size + ' pages touched, ' + added + ' added, ' + keep.size + ' kept (' + (keep.size * 4104 / 1024 | 0) + ' KB)');
