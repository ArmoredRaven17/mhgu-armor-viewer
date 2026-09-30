// WHICH RECORD OF A CLIP REFUSES: runs one clip of a class's effects on the shipped pages (strict, as the page runs it)
// and, at the first refusal, names the record the schedule had just started and every record alive then.
//   node dev/effect-which-refuses.mjs <docs/effects/<cls>.json> <clip id, e.g. sa:4>
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { EffectHost } from '../docs/render/rom/effect/host.js';
import { EffectSchedule } from '../docs/render/rom/effect/schedule.js';
import '../docs/render/weapon-natives.js';

const [defPath, id] = process.argv.slice(2);
const def = JSON.parse(readFileSync(defPath, 'utf8'));
const docs = dirname(defPath), cls = defPath.split(/[\\/]/).pop().replace('.json', '');
const hex = h => Uint8Array.from(h.match(/../g) || [], b => parseInt(b, 16));
function pages(file){
  const b = readFileSync(file), out = [];
  for (let o = 0; o < b.length; ){ const a = b.readUInt32LE(o), n = b.readUInt32LE(o + 4); out.push([a, new Uint8Array(b.subarray(o + 8, o + 8 + n))]); o += 8 + n; }
  return out;
}
const res = def.resources;
const host = new EffectHost({
  pages: pages(join(docs, 'rom-pages.bin')), heap: JSON.parse(readFileSync(join(docs, 'rom.json'), 'utf8')).heap, strict: true,
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
const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
host.initDraw({ position: [0, 0, 1000], view: [...T, 0, 0, -1000, 1], world: [...T, 0, 0, 1000, 1] });
const owners = def.effects.map(e => host.createEffect(new Uint8Array(readFileSync(join(docs, e.efl)))));
const joints = [...new Set(def.effects.flatMap(e => e.joints))];
const parent = host.createParent(joints);
const rot = (a, x, y, z) => [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, x, y, z, 1];
const pose = f => { const a = f < 60 ? 0 : 0.01 * (f - 60); joints.forEach((j, k) => host.setJointMatrix(parent, j, rot(a, 20 * k, 100 + 40 * (k % 3), -25))); };
host.setParentScale(parent, 1); pose(0);
const schedule = new EffectSchedule(host, parent, owners.map((owner, i) => ({ owner, def: def.effects[i] })), false);
const clip = def.clips[id];
if (!clip) { console.log('no clip', id, Object.keys(def.clips).filter(k => k.startsWith(id.split(':')[0])).join(' ')); process.exit(1); }
console.log(id, 'frames', clip.frames, 'bits', JSON.stringify(clip).slice(0, 400));
let f = 0;
try {
  for (let k = 0; k < (clip.frames || 0) + 90; k++){
    pose(f); schedule.setClip(cls + '|' + id, k, clip, 0); schedule.step(); host.drawFrame(schedule.effects()); f++;
  }
  console.log('ran without a refusal');
} catch (e){
  const alive = schedule.entries.filter(x => x.requests.length).map(x => x.def.record.pel + ':' + x.def.record.array + ':' + x.def.record.key + ' (' + x.def.efl + ')');
  console.log('REFUSED at clip frame', f, ':', e && e.message);
  console.log('last started:', schedule.lastStarted, '; alive:', alive.join(', '));
}
