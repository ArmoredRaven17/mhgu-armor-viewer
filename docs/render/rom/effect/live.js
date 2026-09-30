// LIVE EFFECTS: a monster's effects running on the ROM-translated runtime, drawn by three.js.
//
// docs/effects/<monster>.json names the effect files and the joints their nodes bind to
// (C:\MHGU-Extract\efx\export_effects.py). For each, the host (host.js) loads the list with the game's
// loader; every effect hangs from one PARENT UNIT whose joint matrices are the monster's bones, and is
// started the way the monster's request starts it (proof.js) in the state its `when` names (schedule.js:
// always, while enraged, or once as rage turns on or off) -- and every 1/60 s -- the rate the .efl header
// declares, and the step the emulator harness verified -- moves it.
// Every rendered frame draws it: the effect draw and the engine's primitive draw run on the host, and
// each primitive GPU draw they produce becomes a mesh here, with the ROM's own vertices, index strips,
// shader program (primshader.js), constant buffers, textures and blend / depth / rasterizer state.
//
// MODEL PARTICLES are drawn with the effect model's own material program (TMaterialStd, translated the
// same way: modelshader.js, whose header lists what the viewer supplies that the ROM's build did) under
// the engine's model draw (modeldraw.js: world matrix, CBMaterial, fPrimColor, global transparency,
// blend by the generator's mode, depth by its flags).
//
// UNITS: the viewer's world is game units / 100 (build-hitzones.py), and a monster's skeleton is posed in
// viewer units: a bone's world matrix with its translation scaled by 100 is the joint's matrix in the
// game's space, and the shaders' view-projection carries that 0.01 back.
//
// WHAT THE RENDERER SUPPLIES, as the game's does around the effect draw:
//   * the view's constant buffers (CBViewProjection, CBScreen) from this render's camera -- in the game the
//     renderer fills them per view; the draws the host records carry the harness's camera block, whose
//     view-projection is empty, so those two buffers are never taken from a draw (cameraMatrices below)
//   * the scene depth both programs' soft edges read (sceneDepth below)
//   * textures sampled as stored: the effect textures are MT format 7, NVN RGBA8 UNORM (0xb07e48), no decode
//   * a GROUND to draw against (groundPlane below): the game's effects meet its terrain, the viewer has none
//   * the colour written as the programs return it (primshader.js, OUTPUT: RGBA8 UNORM targets)
// Interfaces the draws never select (FFogVTF, FAlphaTest, ...) run their own bodies (no fog, no alpha test).
import * as THREE from 'three';
import { EffectHost } from './host.js';
import { linkPrimitive, linkProgram, GPU_PARTICLE, alphaTestOf, cbUniforms, FORMATS } from './primshader.js';
import { linkMaterial } from './modelshader.js';
import { EffectSchedule } from './schedule.js';
import { SHELL_DATA } from '../../shells.js';
import { rank as rankFilters, constants as filterConstants, FilterPass } from './filter.js';
import { loadJson, getTexture, loadGlb } from '../../assets.js';
import { gidBonesOf } from '../../skeleton.js';
import { RAGE_PUFF } from '../../motion-states.js';
import { getSHCoef } from '../ambient.js';

const MT_TO_VIEW = 0.01;
const STEP = 1 / 60;
const MAX_STEPS = 4;

let shared = null;           // the host's data, loaded once
async function bytes(url){ return new Uint8Array(await (await fetch(url + '?v=' + Date.now())).arrayBuffer()); }
function pages(b){
  const out = [], dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let o = 0; o < b.length; ){ const a = dv.getUint32(o, true), n = dv.getUint32(o + 4, true); out.push([a, b.subarray(o + 8, o + 8 + n)]); o += 8 + n; }
  return out;
}
async function loadShared(){
  if (shared) return shared;
  const [rom, records, drawSystem, shaders, modelShaders, gpuShaders, romPages] = await Promise.all([
    loadJson('effects/rom.json'), loadJson('effects/mfx-records.json'), loadJson('effects/draw-system.json'),
    loadJson('effects/prim-shaders.json'), loadJson('effects/model-shaders.json'), loadJson('effects/gpu-shaders.json'),
    bytes('effects/rom-pages.bin')]);
  shared = { rom, records: records.records, drawSystem: Uint8Array.from(drawSystem.bytes.match(/../g), h => parseInt(h, 16)),
             shaders, modelShaders, gpuShaders, romPages: pages(romPages) };
  return shared;
}

export async function liveEffectsFor(monsterId){
  const r = await fetch('effects/' + monsterId + '.json?v=' + Date.now());
  return r.ok ? r.json() : null;
}

// ---- render state, decoded from the records' words the way ../state.js reads them -------------------
// The blend-factor enum, read off the package's own BS* state names: 0 Zero (BSMul src), 1 One (BSAdd),
// 4 SrcAlpha (BSBlendAlpha), 5 InvSrcAlpha (BSBlendInvAlpha), 8 DstColor -- named directly by
// BSBlendAddDestColor (w 0x21002: src 8, dst One, Add), Soulseer em082_04's eye flame. Factors no effect
// has selected yet (2 SrcColor, 3 InvSrcColor, 6 DstAlpha, 7 InvDstAlpha, ...) are added when one hits them.
const FACTOR = { 0: THREE.ZeroFactor, 1: THREE.OneFactor, 4: THREE.SrcAlphaFactor,
                 5: THREE.OneMinusSrcAlphaFactor, 8: THREE.DstColorFactor };
const EQUATION = { 0: THREE.AddEquation, 2: THREE.ReverseSubtractEquation };
function applyState(mat, shaders, bs, ds, rs){
  const b = shaders.states[bs], d = shaders.states[ds], r = shaders.states[rs];
  if (!b || !d || !r) throw new Error('live effects: state record missing (' + [bs, ds, rs] + ')');
  const w6 = b[1];
  if ((w6 >>> 1) & 0xff){
    const src = FACTOR[(w6 >>> 9) & 0xff], dst = FACTOR[(w6 >>> 17) & 0xff], eq = EQUATION[w6 >>> 25];
    if (src === undefined || dst === undefined || eq === undefined) throw new Error('live effects: blend word 0x' + w6.toString(16) + ' (' + bs + ')');
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = src; mat.blendDst = dst; mat.blendEquation = eq;
    // alpha: coverage "over", the viewer's canvas policy (../state.js explains why it is not the ROM's)
    mat.blendSrcAlpha = THREE.OneFactor; mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor; mat.blendEquationAlpha = THREE.AddEquation;
    mat.transparent = true;
  } else { mat.blending = THREE.NoBlending; mat.transparent = false; }
  mat.depthTest = !!(d[1] & 1);
  mat.depthWrite = !!((d[1] >>> 1) & 1);
  // the compare function only counts while the depth test is on: DSDefault (0x7fff9c, test and write off, compare 7)
  // is the state Rathian's cm202_014 model draws with, and draws with no depth test at all
  if ((d[1] & 1) && ((d[1] >>> 2) & 0xf) !== 3) throw new Error('live effects: depth compare ' + ((d[1] >>> 2) & 0xf) + ' (' + ds + ')');
  const cull = (r[1] >>> 3) & 7;
  mat.side = cull === 0 ? THREE.DoubleSide : cull === 1 ? THREE.BackSide : THREE.FrontSide;
}

// one strip per record, 0xffff between: triangles, alternating winding as a strip does
function stripsToTriangles(indices){
  const out = [];
  let start = 0;
  for (let i = 0; i <= indices.length; i++){
    if (i === indices.length || indices[i] === 0xffff){
      for (let k = start; k + 2 < i; k++){
        if ((k - start) & 1) out.push(indices[k + 1], indices[k], indices[k + 2]);
        else out.push(indices[k], indices[k + 1], indices[k + 2]);
      }
      start = i + 1;
    }
  }
  return out;
}

// A draw's vertices and strips into a mesh's geometry: each layout element as its own attribute over the draw's bytes.
// The buffers are kept and rewritten in place, and grow by replacing the whole geometry: an attribute replaced on its
// own keeps its GPU buffer until the geometry is disposed.
function writeGeometry(mesh, p, d){
  const n = d.vertices;
  const triangles = stripsToTriangles(d.indexList);
  let g = mesh.geometry;
  const fits = mesh.userData.layoutKey === p && g.index && g.index.count >= triangles.length &&
               p.attributes.every(a => { const at = g.getAttribute(a.name); return at && at.count >= n; });
  if (!fits){
    g.dispose();
    g = mesh.geometry = new THREE.BufferGeometry();
    const capacity = c => Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(c, 1))));
    for (const a of p.attributes){
      const f = FORMATS[a.format];
      g.setAttribute(a.name, new THREE.BufferAttribute(new f.array(capacity(n) * a.count), a.count, f.normalized).setUsage(THREE.DynamicDrawUsage));
    }
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(capacity(triangles.length)), 1).setUsage(THREE.DynamicDrawUsage));
    mesh.userData.layoutKey = p;
  }
  for (const a of p.attributes){
    const f = FORMATS[a.format];
    const width = f.size * a.count;
    const at = g.getAttribute(a.name);
    const out = new Uint8Array(at.array.buffer, at.array.byteOffset, n * width);
    const src = d.vertexBytes;
    for (let v = 0; v < n; v++) out.set(src.subarray(v * d.stride + a.offset, v * d.stride + a.offset + width), v * width);
    at.needsUpdate = true;
  }
  g.index.array.set(triangles);
  g.index.needsUpdate = true;
  g.setDrawRange(0, triangles.length);
}

// THE ORDER THE GAME EXECUTES A FRAME'S DRAWS IN. A draw call does not draw: 0x890ce0 / 0x881584 each append an entry
// {key, command} to the context's list (0x890db4..0x890df4, 0x881820..0x881860), key = pass (ctx+0x164 bits 0..4) << 27 |
// ((ctx+0x164 >> 5) + (ctx+0x178 >> 5)) & 0x7ffffff; once a frame each section's list is merge-sorted, ascending,
// unsigned, stable (0x87f410 -> 0x87eea8, the left element winning ties), and the executor walks it in that order
// (0xbbba00). The effects' draws are all in the viewport's 'Scene' section (0x878e0c pushes it; sUnit's draw pushes
// none between the unit draws and the primitive draw 0xbad790):
//   pass 0x11 -- a cParticleNode's draws, key its depth key << 12 | its record's address bits 8..19 (0xb91ba8..0xb91bc4),
//     and the primitive batches, key their layer depth key << 12 | their part number (0xbac744..0xbac758): far first;
//   pass 0x15 -- a model particle's mesh draws, which keep the scene's pass (host.js drawMesh): after every 0x11 one,
//     in their own depth / bias order -- unless a node drew before them in the frame and left 0x11.
// Ties fall to submission order (host.js seq): the unit draws (nodes, models) before the primitive draw. The node
// record's heap address is the viewer's heap's, not the game's: two node draws with the SAME depth key order by it.
// (Pass 0x15 renders into the game's post target, pass 0x11 into its main target -- see host.js drawFrame; the viewer
// draws both into its one target, in this order.)
export const commandKey = d => (((d.key & 0x1f) << 27) | ((((d.key >>> 5) + ((d.w178 || 0) >>> 5)) & 0x7ffffff))) >>> 0;

const T_NEAR_IS_ZERO = new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const VIEW_BUFFER = /^(CBViewProjection|CBScreen)_/;

// TEMPORARY flash suppression (2026-09-15). cm100_000 is Khezu's discharge flash: a ROM-faithful but
// screen-filling burst -- its ±190 model mesh drawn at the ROM's own CBWorld scale 60->120 (confirmed
// with efx/engdraw.py). The "hard blob" look was the FLASH MATERIAL PATH: these burst meshes are
// IANonSkinBC and carry a soft per-vertex VertexAlpha the ROM routes to mc.transparency, which the
// viewer was stubbing to 1 (fully opaque). That is now bound in modelshader.js. BUT binding it changed
// nothing on screen (Raven, 2026-09-19: "still looks the same") -- so fragColor.a is not reaching these
// draws: either the 'color' attribute is not binding or the flash blend ignores src alpha. Under
// investigation; cm101_000 (em023_00) and cm100_000 (em003_00) both stay hidden meanwhile. Keyed by
// monster so Teostra (em027) and Savage (em043), which also use cm100_000, are untouched.
// See memory effect-model-particles-no-node-scale.
const HIDE_MODELS = { em003_00: new Set(['cm100_000']), em023_00: new Set(['cm101_000']) };

export class LiveEffects {
  constructor(def){
    this.def = def;
    this.hideModels = HIDE_MODELS[def.monster] || null;   // per-monster flash suppression (see HIDE_MODELS)
    this.group = new THREE.Group();              // in the viewer's scene: the frame driver
    this.group.name = 'live-effects';
    this.scene = new THREE.Scene();              // the effect meshes, rendered by the frame driver
    this.meshes = [];
    this.modelMeshes = [];
    this.gpuMeshes = [];
    this.glbs = new Map();
    this.programs = new Map();
    this.textures = new Map();
    this.last = null;
    this.acc = 0;
    this.stats = { frames: 0, steps: 0, prims: 0, models: 0, gpu: 0 };
    this.gameJoints = new Map();                 // joint -> the game's 16-float matrix this step (writeJoints)
    this.unitFloor = null;                       // () => the unit's height in viewer units, when the owner stands it on a floor (unitMatrix)
    this.groundOn = groundDefault;
  }

  // rage: the viewer's Enraged state as the effects start (setRage follows it from then on)
  async attach(root, { rage = false } = {}){
    const s = await loadShared();
    const def = this.def, res = def.resources;
    // EACH FILE ONCE, AND ALL AT ONCE. This was one awaited fetch per effect ENTRY, in series -- so a
    // file named by several entries was fetched again for each, and every round trip waited for the
    // last. A monster hardly notices (its entries are nearly one per file), but a weapon class names
    // far more RECORDS than FILES: the Switch Axe's 128 entries resolve to 18 .efl, and the serial
    // fetches measured 20.6 s for the lists and 8.9 s for the resources -- the whole of a 25-second
    // weapon mount, none of it the runtime's own work.
    //   bytes() cache-busts every request, so the browser cannot save us: deduplicating is the fix and
    // Promise.all takes the rest.
    const files = {};
    const want = new Set(def.effects.map(e => e.efl));
    for (const r of Object.values(res)){
      if (r.ean) want.add(r.ean);
      if (r.mesh) want.add(r.mesh);
      if (r.list) want.add(r.list);                                    // a child list (host.js loadPending)
    }
    await Promise.all([...want].map(async f => { files[f] = await bytes('effects/' + f); }));
    this.shaders = s.shaders;
    this.modelShaders = s.modelShaders;
    this.gpuShaders = s.gpuShaders;
    this.files = files;
    const host = this.host = new EffectHost({
      pages: s.romPages, heap: s.rom.heap, records: s.records, drawSystem: s.drawSystem, strict: true,
      resources: {
        meshTable: name => ({ count: res[name].meshCount, table: files[res[name].mesh] }),
        textureSize: name => res[name].size,
        anim: name => files[res[name].ean],
        list: name => files[res[name].list],
        material: (name, index) => res[name].materials[index],
      },
    });
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
    host.initDraw({ position: [0, 0, 0], view: [...I, 0, 0, 0, 1], world: [...I, 0, 0, 0, 1] });
    this.root = root;
    const bones = gidBonesOf(root);
    // One parent for every effect, as in the game: they all hang from the monster (the request's parent is
    // the enemy itself), whose bones answer every joint any of their nodes names, and whose own placement a
    // request placed at the unit reads (writeJoints).
    // A record's ROOT joint (payload +0x32, signed): the ROM places the effect's root at this joint every frame
    // (proof.js -> uMHProofEffect move 0x327188 -> jointMatrix 0x939278). It must be in the parent's joint table,
    // or jointMatrix returns the model root (+0xb0) for the unmapped number and the effect draws at the body
    // origin instead of the joint -- which is exactly why Soulseer's soul flame (record joint 2, the head centre)
    // drew at the throat. -1 is the unit itself, which the model-root anchor already stands in for, so only real
    // joints are added. (Decoded 2026-09-16; the export intentionally dropped this after an em003 test whose
    // effect happened to have root joint -1, so it never exercised the joint path.)
    const rootJointOf = hex => { const b = parseInt(hex.substr(100, 2), 16) | (parseInt(hex.substr(102, 2), 16) << 8); return (b << 16) >> 16; };
    const rootJoints = def.effects.map(e => (e.record && e.record.payload) ? rootJointOf(e.record.payload) : -1).filter(j => j >= 0);
    const named = [...new Set([...def.effects.flatMap(e => e.joints), ...rootJoints])];
    // ONLY THE MODEL'S OWN JOINTS ARE MAPPED. The parent's joint table (+0x498) is the model's joint-number
    // remap: a number the model has no bone for stays 0xff, and 0x939278 then answers the model's world matrix
    // (+0xb0). Savage's cm202_002 k4 names joint 81, which em043_05.mod does not have (its remap maps 36 joints,
    // 81 -> 0xff); mapping it anyway left a ZERO matrix in the slot and collapsed the node to a point.
    const joints = named.filter(j => bones.some(b => b.gid === j));
    this.effects = def.effects.map(e => ({ owner: host.createEffect(files[e.efl]), def: e }));
    const parent = this.parent = (named.length || def.effects.some(e => e.record)) ? host.createParent(joints, def.parentOrder) : null;   // def.parentOrder: a player part unit's 0x30000 (host.js createParent)
    this.joints = joints.map(j => ({ j, bone: (bones.find(b => b.gid === j) || {}).node || null }));
    // every mapped bone, for a monster whose shells are decoded (writeJoints: a shell's joint comes from its params)
    this.shellBones = SHELL_DATA[def.monster] ? bones.filter(b => b.gid != null && b.node) : null;
    // ANCHOR (joint -1 = model+0xb0, the model's world-matrix ORIGIN, per the joint getter 0x939278). The
    // mounted group's origin sits on the FLOOR, but the ROM places the model's world matrix at the model's
    // authored root = the skeleton root bone (gid 0). The aura's own nodes are authored well BELOW that
    // origin (mass ~130 units under it, measured from the ROM effect data), so anchoring at the floor drops
    // the fire underground; the model root (gid 0) is where the ROM origin is, and lands it on the body.
    // `originJoint` OVERRIDES that anchor for an effect the ROM places on a specific bone that is NOT its record's
    // root joint (which the joint-table path above already replays): a labelled viewer placement, the gid chosen
    // against the skeleton. None currently sets it -- Soulseer Mizutsune's soul flame (em082_04_000) is placed on
    // the head by its record root joint 2, decoded and handled above, not here.
    const originGid = def.originJoint == null ? 0 : def.originJoint;
    this.originBone = (bones.find(b => b.gid === originGid) || {}).node || null;
    // A PLAYER PART UNIT (the Armor Viewer, 2026-09-29): the weapon in the hand is a unit of its own, and its whole
    // placement -- rotation too -- is where the rig puts the weapon's bone 0 (render/weapon.js placePart). A record at
    // joint -1 with no root-joint override hangs from that unit (the Sword & Shield's Chaos Oil, w01_800 1100..1102,
    // space 0), so it turns with the blade; the hunter's unit keeps the host's facing (unitMatrix).
    this.unitFromOrigin = !!def.unitFromOrigin;
    root.updateMatrixWorld(true);
    this.writeJoints();
    // a record: the monster's request, whole (proof.js ProofRequest) -- the core makes the effect the game
    // draws, a uMHProofEffect, which the unit passes run every frame -- made when schedule.js says
    this.schedule = new EffectSchedule(host, parent, this.effects, rage);
    // the monster's SHELLS (render/shells.js), when its shells are decoded: stepped by the schedule, from this
    // step's joints in the game's convention (writeJoints keeps them in gameJoints)
    this.schedule.useShells(this.def.monster, gid => this.gameJoints.get(gid) || null);
    // the monster's RAGE PUFF (render/motion-states.js RAGE_PUFF): its pick reads a joint's rotation as the motion leaves it
    // -- the bone's own quaternion, relative to its parent, the joint record's +0x60 (0x539e60)
    const puff = RAGE_PUFF[def.monster];
    if (puff){
      const node = (bones.find(b => b.gid === puff.joint) || {}).node || null;
      this.schedule.setRagePuff({ period: puff.period, records: puff.records,
                                  pick: () => puff.pick(node ? [node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w] : null) });
    }
    // the heap after the mount's own allocations (draw system, effects, parent, any auto-started effect) -- kept to
    // read the growth since the mount (frame() no longer rewinds to it: see there)
    this.heapBase = host.heap;
    // The frame driver: an empty mesh at the end of the viewer's render list (transparent, last). Its hook
    // steps the effects, draws them on the host and renders their meshes right there, into the target the
    // viewer's render is drawing into, over everything it has drawn. They are rendered by a render of their
    // own because three.js uploads a mesh's vertex buffers while it builds the render list: vertices written
    // in a hook of the same render draw from buffers that were never uploaded -- the primitives never drew.
    const anchor = this.anchor = new THREE.Mesh(new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, transparent: true }));
    anchor.frustumCulled = false;
    anchor.renderOrder = 1e9;
    anchor.onBeforeRender = (renderer, scene, camera) => this.frame(renderer, scene, camera);
    this.group.add(anchor);
    root.add(this.group);
    this.groundPlane();
    return this;
  }

  // THE GROUND, OFF BY DEFAULT -- a debug/terrain-test stand-in, not a ROM value. The game draws its effects
  // against its terrain (their DSZTest hides what lies under it), which the viewer has none of. It was added
  // when the aura hung from the clip's reference node, below the feet, and half its fire drew under the body;
  // anchoring to the model's world matrix (unitMatrix) fixed that placement, so with nothing below the feet
  // to hide the ground occludes nothing. Kept behind __view.effectGround(true) to test terrain occlusion for
  // an effect that does reach below the feet. A depth-only plane at the lowest bone (groundY): it writes
  // depth and no colour, in front of the effect meshes and into the scene depth, and faces up.
  groundPlane(){
    const geometry = new THREE.PlaneGeometry(2000, 2000);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true, side: THREE.FrontSide });
    const make = () => { const p = new THREE.Mesh(geometry, material); p.frustumCulled = false; p.renderOrder = -1e9; return p; };
    this.ground = make();
    this.scene.add(this.ground);
    this.groundScene = new THREE.Scene();
    this.groundDepth = make();
    this.groundScene.add(this.groundDepth);
  }

  writeJoints(){
    const m = new THREE.Matrix4();
    if (this.parent){
      // THE PARENT UNIT'S OWN PLACEMENT (uCoord +0x40 position, +0x50 quaternion, +0x60 scale), its translation
      // in game units. Its scale is the monster's size (the viewer scales the world group by the game's size
      // multiplier, index.html sizeScale), which a request's effect multiplies its record's scale by
      // (0x31d16c), so the unit's scale and its joints' linear parts agree as they do in the game. A request
      // placed at the unit (joint -1: Teostra's aura) takes the position and the quaternion's angles
      // (0x31f788, 0x8a4b88).
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      this.unitMatrix(m).decompose(p, q, s);
      this.host.setParentPose(this.parent, { position: [p.x / MT_TO_VIEW, p.y / MT_TO_VIEW, p.z / MT_TO_VIEW],
                                             quaternion: [q.x, q.y, q.z, q.w], scale: s.x });
      if (this.ground){ const g = this.groundY(p); this.ground.position.set(p.x, g, p.z); this.groundDepth.position.set(p.x, g, p.z); }
      for (const { j, bone } of this.joints){
        if (!bone) continue;
        m.copy(bone.matrixWorld);
        const el = m.elements;
        // the skeleton is in viewer units (game units / 100) with the monster's size in its linear part:
        // the game's joint matrix is S^-1 * J * S -- the translation in game units, the rotation and
        // scale as they are, so an offset the effect gives in game units lands scaled like the body
        el[12] /= MT_TO_VIEW; el[13] /= MT_TO_VIEW; el[14] /= MT_TO_VIEW;
        // three.js stores columns; the game's rows in memory order are exactly that array
        this.host.setJointMatrix(this.parent, j, Array.from(el));
        this.gameJoints.set(j, Array.from(el, Math.fround));   // the shells read the same matrices (shells.js)
      }
      // A SHELL reads the monster's joints by the numbers its own params give (a rock launches from joint 4, the .shl's
      // common int 0: shells-em043.md 9.3), not only the ones the effects name -- so for a monster with shells every
      // bone the model maps goes into the shells' joints too, the same matrices (the parent's joint table is unchanged)
      if (this.shellBones) for (const { gid, node } of this.shellBones){
        if (this.gameJoints.has(gid) && this.joints.some(x => x.j === gid)) continue;
        m.copy(node.matrixWorld);
        const el = m.elements;
        el[12] /= MT_TO_VIEW; el[13] /= MT_TO_VIEW; el[14] /= MT_TO_VIEW;
        this.gameJoints.set(gid, Array.from(el, Math.fround));
      }
    }
  }

  // The viewer's Enraged state: the effects that start or stop with it (schedule.js).
  setRage(on){
    if (this.failed || !this.schedule) return;
    try { this.schedule.setRage(on); }
    catch (e){ this.fail(e); }
  }
  // rage entered again while shown -- a rage-entry motion started over (schedule.js restartRage)
  restartRage(){
    if (this.failed || !this.schedule) return;
    try { this.schedule.restartRage(); }
    catch (e){ this.fail(e); }
  }
  // an event's effect -- a part break, an ailment (schedule.js fire; render/motion-states.js says when)
  fire(pel, key){
    if (this.failed || !this.schedule) return;
    try { this.schedule.fire(pel, key); }
    catch (e){ this.fail(e); }
  }
  // an event's effect requested at a point (schedule.js fireAt: the cut tail's landing)
  fireAt(pel, key, position){
    if (this.failed || !this.schedule) return;
    try { this.schedule.fireAt(pel, key, position); }
    catch (e){ this.fail(e); }
  }
  // the rage puff's gates, as the motion shows them (schedule.js puffGates)
  puffGates(paused, tired){
    if (this.failed || !this.schedule) return;
    try { this.schedule.puffGates(paused, tired); }
    catch (e){ this.fail(e); }
  }
  // an event's effect held while its state lasts / a rage record held off (schedule.js holdEvent / holdRage)
  holdEvent(pel, key, on){
    if (this.failed || !this.schedule) return;
    try { this.schedule.holdEvent(pel, key, on); }
    catch (e){ this.fail(e); }
  }
  holdRage(pel, key, off){
    if (this.failed || !this.schedule) return;
    try { this.schedule.holdRage(pel, key, off); }
    catch (e){ this.fail(e); }
  }

  // WHERE THE UNIT IS. Joint -1 -- the root of a request's effect, and the aura's nodes -- resolves through
  // the parent's joint getter (0x939278): a bone the table maps, else the MODEL'S OWN WORLD MATRIX (+0xb0).
  // We use this.root.matrixWorld as that model matrix. UNRESOLVED (Raven, 2026-09-13): with the hollow stand-in
  // this origin is the model's placement (feet-level in the viewer), and the aura drew low there. The correct
  // in-body position must come from the ROM -- the effect's authored node transforms and where the ENEMY builds
  // its +0xb0 origin -- not from picking a bone by eye. Being decoded; do not re-guess.
  unitMatrix(out){
    this.unitOnGround = true;
    out.copy(this.root.matrixWorld);
    if (this.originBone && this.unitFromOrigin){            // a part unit: the bone's whole placement (attach)
      this.originBone.updateWorldMatrix(true, false);
      out.copy(this.originBone.matrixWorld);
    } else if (this.originBone){                            // position from the model root (gid 0); rotation/scale stay the unit's
      this.originBone.updateWorldMatrix(true, false);
      const e = this.originBone.matrixWorld.elements, o = out.elements;
      o[12] = e[12]; o[13] = e[13]; o[14] = e[14];
    }
    // THE PLAYER'S POSITION IS THE SOLES (the Armor Viewer, 2026-09-28): a hunter's uCoord +0x40 is where it stands on
    // the terrain, not its joint 0 (the pelvis, ~95 game units up and bobbing with the motion), and 108 of the Switch
    // Axe's 128 records are placed at the unit (joint -1: cm001_000's ground rings at y 0, w08_500's slashes at y 60..160,
    // the Arts' charge at y 100..140 -- offsets from the feet). `unitFloor`, when the owner sets it, answers that height
    // in viewer units; the x/z stay the origin bone's (the pelvis carries the motion's travel). Raven: "I still see
    // effects that not in the correct positions".
    if (this.unitFloor){ const y = this.unitFloor(); if (y != null && isFinite(y)) out.elements[13] = y; }
    return out;
  }
  // the floor the ground stand-in sits on: the lowest drawn bone (the monster's feet), in the unit's frame
  groundY(unitPos){
    let lo = unitPos.y;
    for (const { bone } of this.joints || []) if (bone) lo = Math.min(lo, bone.matrixWorld.elements[13]);
    if (this.root) this.root.traverse(o => { if (o.isBone) lo = Math.min(lo, o.matrixWorld.elements[13]); });
    return lo;
  }

  // A refusal (a branch of the ROM's code no recorded run reached: Unverified) or any other fault stops
  // this effect and says where, once; the viewer's render loop must not die with it.
  frame(renderer, scene, camera){
    this.filterDraw = null;
    // `suppressed` (effect-mounts setEffectsSuppressed): the hit-zone HEAT MAP is up. The effects draw into this
    // runtime's own scene here, over the body, so the heat map -- which repaints only the mounted body meshes --
    // would otherwise leave them on screen over the coloured body. Skipping the frame draws nothing.
    if (this.failed || this.suppressed) return;
    this.hookAfterRender(scene);
    try { this.frameUnsafe(renderer, scene, camera); }
    catch (e){ this.fail(e); }
  }
  // THE SCREEN FILTER'S PASS (filter.js): the game draws it in render pass 0x16, after the scene and the effects
  // (pass 0x11). The effects draw from a hook inside the viewer's render; the filter waits for that render to
  // end -- the scene's onAfterRender, chained to whatever the scene had -- and draws only into the canvas (a
  // render into a target, like sceneDepth's, is not the frame).
  hookAfterRender(scene){
    if (this.hookedScene === scene) return;
    this.unhookAfterRender();
    const prev = scene.onAfterRender;
    this.hookedScene = scene; this.hookedPrev = prev;
    scene.onAfterRender = (renderer, s, camera, target) => {
      if (prev) prev.call(scene, renderer, s, camera, target);
      const k = this.filterDraw;
      if (!k || renderer.getRenderTarget() !== null) return;
      this.filterDraw = null;
      try { (this.filterPass || (this.filterPass = new FilterPass())).draw(renderer, k); }
      catch (e){ this.fail(e); }
    };
  }
  unhookAfterRender(){
    if (this.hookedScene){ this.hookedScene.onAfterRender = this.hookedPrev; this.hookedScene = null; this.hookedPrev = null; }
  }
  // THE ERROR HANDLER MUST NOT THROW. `gpuMeshes` is assigned BY INDEX (`this.gpuMeshes[k] = mesh` in the draw
  // loop), so a draw the loop skips leaves a HOLE while length still counts it -- a sparse array. Holes are
  // already known behaviour one level down, where the ordering pass filters them out (`.filter(x => x.mesh)`),
  // but this handler dereferenced every slot. On Valstrax (em086_00) L1 Motion[4] that threw
  // `Cannot set properties of undefined (setting 'visible')` out of fail() itself, which propagated through
  // frame() and onBeforeRender into three's render loop and killed the page: the live soak reported
  // "23 motions played, 0 refused" for a 100-motion monster -- the refusal that started it never recorded, and
  // the other 77 motions never ran. A handler that hides the meshes has nothing to hide for a slot with no mesh.
  // (2026-09-26.)
  fail(e){
    this.failed = String(e && e.message || e);
    this.stats.failed = this.failed;
    for (const mesh of this.meshes) if (mesh) mesh.visible = false;
    for (const mesh of this.modelMeshes) if (mesh) mesh.visible = false;
    for (const mesh of this.gpuMeshes) if (mesh) mesh.visible = false;
    console.warn('live effects stopped: ' + this.failed);
  }

  frameUnsafe(renderer, scene, camera){
    const now = performance.now() / 1000;
    if (this.last === null) this.last = now;
    // THE ANIMATION IS THE CLOCK. The game steps an effect once per game frame, in the same pass that
    // advances the monster's motion, so the two never drift apart: a frame of animation is a frame of
    // effect. The viewer can pause and scrub, which the game cannot, and this runtime used to keep its
    // own wall clock -- so a paused clip left Nargacuga's eyes and its motion trail running on a frozen
    // monster (Raven, 2026-09-22). `advance` is the seconds of ANIMATION time the clip moved since the
    // last draw (index.html animAdvance): 0 while paused, 0 across a scrub or a clip change, and scaled
    // with the playback speed. It is null when no clip is playing at all -- a rage aura on a still pose
    // has no animation to follow, so the wall clock still drives that.
    const dt = typeof this.advance === 'number' ? this.advance : now - this.last;
    this.acc = Math.min(this.acc + dt, MAX_STEPS * STEP);
    this.last = now;
    if (this.acc >= STEP) this.writeJoints();
    while (this.acc >= STEP){
      this.schedule.step();                                    // every request's core and effect
      this.acc -= STEP;
      this.stats.steps++;
    }
    const effects = this.schedule.effects();
    this.stats.running = this.schedule.running;
    // this frame's screen-filter requests (proof.js, submitted during the last step's move): the one sEffect's
    // unit draws (filter.js rank) and its constants, drawn when the viewer's render ends (hookAfterRender)
    const filters = this.host.requests ? this.host.requests.filters : null;
    if (filters && filters.length){
      const cam = this.cameraMatrices(camera);
      const c = { position: cam.position.toArray(), dir: camera.getWorldDirection(new THREE.Vector3()).toArray(), view: cam.view, viewProj: cam.viewProj };
      const best = rankFilters(filters, c);
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      if (best) this.filterDraw = filterConstants(best.entry, best.s0, c, size.x, size.y);
    }
    this.stats.filters = filters ? filters.length : 0;
    if (!effects.length){                                      // nothing running: no draw, no depth pass
      // NO HEAP RESET HERE ANY MORE. This used to rewind the bump heap to the mount baseline whenever no request ran
      // (host.js heapReset, 2026-09-15: before free() returned blocks, a looping clip grew the heap ~40 KB a loop). Its
      // premise -- nothing running, so nothing references anything above the baseline -- is false: the ROM's own
      // objects and a shell's parent and handles outlive "no request running", and the rewind handed their memory out
      // again. Rathian's landing dust found it (2026-09-22): a new request's parent handle (core +0x140) was allocated
      // inside a block still in use, overwritten, and 0x43168 called address 0 from 0x4319c -- after 24 motions, never
      // alone. With the rewind off (free() still recycling blocks) the same run is clean and the heap grows ~33 KB a
      // play (6.9 MB over Rathian's 103 motions twice); the effect memory is sparse pages and nothing sits above it.
      for (const mesh of this.meshes) if (mesh) mesh.visible = false;
      for (const mesh of this.modelMeshes) if (mesh) mesh.visible = false;
      for (const mesh of this.gpuMeshes) if (mesh) mesh.visible = false;   // sparse: see fail()
      this.stats.prims = this.stats.models = this.stats.gpu = 0;
      return;
    }
    // the camera the effect draw sorts by (and the model draw's sort key reads): this render's camera,
    // in the game's units, into the camera block (+0x40 position, +0x70 view, +0xb0 its inverse)
    const cam = this.cameraMatrices(camera);
    this.host.setCamera({ position: cam.position.toArray(), view: Array.from(cam.view.elements), world: Array.from(cam.viewI.elements) });
    const { prims, models, gpu } = this.host.drawFrame(effects);
    this.stats.frames++; this.stats.prims = prims.length; this.stats.models = models.length; this.stats.gpu = gpu.length;
    const ground = !!(this.groundOn && this.unitOnGround);
    if (this.ground) this.ground.visible = ground;
    this.depth = this.sceneDepth(renderer, scene, camera);
    this.syncModels(models, renderer, cam);
    this.sync(prims, renderer, cam);
    this.syncGpu(gpu, renderer, cam);
    this.order(gpu, prims, models);
    // into the same target, over what is there: no clear
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try { renderer.render(this.scene, camera); }
    finally { renderer.autoClear = autoClear; }
  }

  // THE SCENE DEPTH. Both programs fade a draw where it nears what is behind it: a primitive by
  // FPrimitiveCalcVolumeBlendPSVolume (tPrimDepthMap), a model particle by FPrimitiveTransparencyVolume
  // (tDepthMap), each turning the depth value at the pixel back into a view distance. The game binds the
  // same texture to both slots, [[context +0x1e0] +0x280] (0xbab65c for the primitive batch, 0xc8f7e0 for
  // the model draw): a render surface set's depth-stencil texture -- MT format 15, D24S8, made at 0xb02680
  // into +0x270 and copied to +0x274 and then +0x280 (0xb03374) when the set is built with flag 0x10. It is
  // the depth buffer the effects are drawn against, read while they test it without writing (DSZTest).
  // WebGL cannot sample the buffer it is drawing into, so each frame the scene is drawn once more, without
  // the effects, into a depth texture from this render's camera: the depth what the scene wrote leaves for
  // the effects to read. (The game's buffer at that moment also holds its terrain and whatever else wrote
  // depth before the effect layer; the viewer's scene is the monster.)
  sceneDepth(renderer, scene, camera){
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    let t = this.depthTarget;
    if (!t || t.width !== size.x || t.height !== size.y){
      if (t) t.dispose();
      t = this.depthTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
        depthBuffer: true, stencilBuffer: false, depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.FloatType) });
    }
    // a render inside a render, as three.js's Reflector does it: this group (the frame driver) hidden, the
    // render target swapped and put back
    const target = renderer.getRenderTarget(), xr = renderer.xr.enabled, shadows = renderer.shadowMap.autoUpdate;
    this.group.visible = false;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    try {
      renderer.setRenderTarget(t);
      renderer.state.buffers.depth.setMask(true);
      if (!renderer.autoClear) renderer.clear();
      renderer.render(scene, camera);
      if (this.groundScene && this.groundOn && this.unitOnGround){
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;
        try { renderer.render(this.groundScene, camera); }
        finally { renderer.autoClear = autoClear; }
      }
    } finally {
      renderer.setRenderTarget(target);
      renderer.xr.enabled = xr;
      renderer.shadowMap.autoUpdate = shadows;
      this.group.visible = true;
    }
    return t.depthTexture;
  }

  // ---- Model particles -----------------------------------------------------------------------------
  // The effect model's mesh (docs/models/effects/<model>.glb, positions in game units under the node's 0.01; which
  // node is meshOf's) drawn with the program modelshader.js links for the material's selection under the model
  // draw's, and modeldraw.js's constant buffers and states.
  glb(model){
    let g = this.glbs.get(model);
    if (!g){
      g = { scene: null };
      loadGlb('models/effects/' + model + '.glb', 'effect:' + model).then(gltf => { g.scene = gltf.scene; }).catch(() => { g.failed = true; });
      this.glbs.set(model, g);
    }
    return g.scene;
  }

  layoutOf(model, meshIndex){
    const r = this.def.resources[model];
    const table = this.files[r.mesh];
    const ia = table[48 * meshIndex + 0x14];                     // mesh +0x14: (hash24 << 8) | layout record
    const shaders = this.modelShaders;
    return Object.keys(shaders.layouts).find(n => shaders.layouts[n].index === ia);
  }

  // THE MESH A DRAW NAMES. The ROM draws mesh k of the model: its 48-byte record in the .mod's mesh table (the
  // resource's .mesh file). The glb does not keep that order: the converter names its nodes by each mesh's GROUP --
  // record +4, low 12 bits -- as Group[g], the meshes of one group being that node's primitives in mesh order. In 25 of
  // the 48 effect models a mesh sits in a group of another number (cm202_014's mesh 7 is Group[0], its Group[7] is
  // mesh 9), so node Group<k> is not mesh k; every model checked follows the group rule (vertex counts per group, in
  // order). The vertex count the record gives (+2) is checked against the geometry found: another mesh's shape would
  // draw where the ROM draws this one, so a mismatch skips the draw and says so once.
  meshOf(scene, model, meshIndex){
    const t = this.files[this.def.resources[model].mesh];
    const group = k => (t[48 * k + 4] | (t[48 * k + 5] << 8)) & 0xfff;
    const g = group(meshIndex);
    let pos = 0;
    for (let j = 0; j < meshIndex; j++) if (group(j) === g) pos++;
    if (g !== meshIndex || pos) this.stats.regrouped = (this.stats.regrouped || 0) + 1;   // draws not on node Group<k>
    const node = scene.getObjectByName('Group' + g);             // GLTFLoader drops the brackets of 'Group[g]'
    const prims = !node ? [] : node.isMesh ? [node] : node.children.filter(c => c.isMesh);
    const src = prims[pos] || null;
    const count = t[48 * meshIndex + 2] | (t[48 * meshIndex + 3] << 8);
    if (!src || src.geometry.attributes.position.count !== count){
      const key = model + '#' + meshIndex;
      if (!(this.meshWarned || (this.meshWarned = new Set())).has(key)){
        this.meshWarned.add(key);
        console.error('live effects: ' + model + ' mesh ' + meshIndex + ' (group ' + g + ', ' + count + ' vertices) is not in its glb' +
                      (src ? ' -- the geometry found has ' + src.geometry.attributes.position.count : ''));
      }
      return null;
    }
    return src;
  }

  standIns(){
    if (this.black) return;
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); this.black.needsUpdate = true;
    const face = () => { const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 1, 1); return c; };
    this.blackCube = new THREE.CubeTexture([face(), face(), face(), face(), face(), face()]);
    this.blackCube.needsUpdate = true;
    // the engine's default environment cube, as the monster materials sample it (render/monster.js)
    this.envCube = new THREE.CubeTextureLoader().setPath('env/DefaultCube_CM/').load(['px.png', 'nx.png', 'py.png', 'ny.png', 'pz.png', 'nz.png']);
    this.envCube.colorSpace = THREE.SRGBColorSpace;
  }

  syncModels(models, renderer, cam){
    this.standIns();
    const shaders = this.modelShaders;
    const common = this.commonUniforms(renderer, cam);
    let k = 0;
    for (const d of models){
      const short = String(d.model).split('\\').pop();
      if (this.hideModels && this.hideModels.has(short)) continue;   // TEMPORARY: hide Khezu's flash (HIDE_MODELS)
      const scene = this.glb(short);
      if (!scene) continue;
      const src = this.meshOf(scene, d.model, d.meshIndex);
      if (!src) continue;
      const res = this.def.resources[d.model];
      const material = res.materials[d.material];
      const features = Object.assign({}, material.features, d.features);
      const layout = this.layoutOf(d.model, d.meshIndex);
      const attrs = Object.keys(src.geometry.attributes);
      const key = 'model|' + layout + '|' + attrs.join(',') + '|' + Object.keys(features).sort().map(f => features[f]).join(',');
      let p = this.programs.get(key);
      if (!p){ p = linkMaterial(shaders, layout, features, attrs); p.label = 'model ' + short + ' mesh ' + d.meshIndex + ' ' + layout; this.programs.set(key, p); }
      let mesh = this.modelMeshes[k];
      if (!mesh){
        mesh = new THREE.Mesh(src.geometry, null);
        mesh.frustumCulled = false;
        this.modelMeshes[k] = mesh;
        this.scene.add(mesh);
      }
      mesh.geometry = src.geometry;
      if (!mesh.material || mesh.userData.programKey !== p){
        mesh.material = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: p.vertexShader, fragmentShader: p.fragmentShader, uniforms: {} });
        mesh.userData.programKey = p;
      }
      const u = mesh.material.uniforms;
      for (const [name, value] of Object.entries(common)) u[name] = { value };
      // CBWorld: the three stored rows of the particle's matrix (modeldraw's `world`)
      for (let r = 0; r < 3; r++) u['CBWorld_fWorld_r' + r] = { value: new THREE.Vector4(...d.world.slice(4 * r, 4 * r + 4)) };
      const put = (id, members, floats) => {
        for (const [name, type, offset, count] of members){
          const v = floats.slice(offset, offset + count);
          const mm = /^mat(\d)x(\d)$/.exec(type);
          if (mm) for (let r = 0; r < +mm[1]; r++) u[id + '_' + name + '_r' + r] = { value: new THREE.Vector4(...v.slice(r * 4, r * 4 + 4)) };
          else if (type === 'float') u[id + '_' + name] = { value: v[0] };
          else if (type === 'vec2') u[id + '_' + name] = { value: new THREE.Vector2(...v) };
          else if (type === 'vec3') u[id + '_' + name] = { value: new THREE.Vector3(...v) };
          else if (type === 'vec4') u[id + '_' + name] = { value: new THREE.Vector4(...v) };
          else if (type === 'mat4') u[id + '_' + name] = { value: new THREE.Matrix4().fromArray(v) };
        }
      };
      put('CBMaterial', shaders.cbs.CBMaterial, Array.from(d.cbMaterial));
      put('Globals', shaders.cbs.$Globals, material.cbs.$Globals || []);
      u.CBROPTest_fGlobalTransparency = { value: d.globalTransparency };
      u.CBPrimEflEmu_fPrimColor = { value: new THREE.Vector4(...(d.primColor || [1, 1, 1, 1])) };
      u.CBAmbient_fEnvMapMask = { value: 0 };                 // scene ambient: not bound (see the header)
      // FAmbientSH (6 of the 263 effect materials, the opaque lit rocks among them -- Savage's cm202_020_g in c 15 /
      // c 41) evaluates CBAmbient.fSHCoef, which the game fills per scene from stage state and which no stage archive
      // carries. Left unset it read 0: no ambient at all, the rocks black. It takes the coefficients the monster's own
      // FAmbientSH takes (render/rom/ambient.js -- the viewer's authored studio set, a CHOICE, labelled there), so an
      // effect model and the body it flies off are lit by the same ambient. fLightMapMask stays 0: no light map.
      u.CBAmbient_fSHCoef = { value: getSHCoef() };
      const tex = material.textures || {};
      u.tAlbedoMap = { value: tex.tAlbedoMap ? this.fileTexture(tex.tAlbedoMap) : this.black };
      u.tSpecularMap = { value: tex.tSpecularMap ? this.fileTexture(tex.tSpecularMap) : this.black };
      u.tDepthMap = { value: this.depth };
      u.tGlobalEnvMap = { value: this.envCube };
      u.tSpotLightTextures = { value: this.black };
      u.tPointLightTextures = { value: this.blackCube };
      applyState(mesh.material, shaders, d.blend, d.depth, material.state[2]);
      mesh.renderOrder = 900 + k;                      // order() places it among the other draws
      mesh.visible = !!u.tAlbedoMap.value;
      d.mesh = mesh;
      k++;
    }
    for (let i = k; i < this.modelMeshes.length; i++) this.modelMeshes[i].visible = false;
  }

  fileTexture(file){
    let t = this.textures.get(file);
    if (!t){ t = { value: null }; getTexture(file, { linear: true }).then(tex => { t.value = tex; }); this.textures.set(file, t); }
    return t.value;
  }

  commonUniforms(renderer, cam){
    const { view, proj, viewProj, viewI } = cam;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    return {
      CBViewProjection_fViewProj: viewProj, CBViewProjection_fView: view, CBViewProjection_fViewI: viewI,
      CBViewProjection_fProj: proj, CBViewProjection_fProjI: proj.clone().invert(), CBViewProjection_fViewProjI: viewProj.clone().invert(),
      CBViewProjection_fCameraPos: cam.position,
      CBScreen_fScreenSize: new THREE.Vector2(size.x, size.y), CBScreen_fScreenInverseSize: new THREE.Vector2(1 / size.x, 1 / size.y),
    };
  }

  // The game's camera lives in game units. Its view space must be too: every effect routine that takes an
  // axis or a distance off the camera -- the camera block's matrices the CPU draw reads, fViewI that turns a
  // sprite's corner offsets into world space (FPrimitiveCalcPosParticle), calcZOffset's camera Z -- expects
  // unit-length axes and game-unit translations. So the view is S^-1 V S (a pure rotation and a translation
  // in game units) and the projection takes game-unit view space, T P S; their product is still T P V S.
  // (Folding S into the view alone left fViewI's axes 100 long: sprites and camera-facing model particles
  // came out a hundred times their size.)
  // The projection is that times 100, a homogeneous scale: the same window position and depth, but clip w is
  // the view distance in game units, as the game's is. The programs depend on it: calcScreenZtoViewDepth,
  // calcScreenUVtoViewDepth and calcViewDepth turn a window depth z back into a distance as
  // fProj[3][2] / (z + fProj[2][2]), which is the distance only for a projection whose w is -z_view exactly,
  // and FPrimitiveTransparencyVolume compares that with SV_Position.w.
  cameraMatrices(camera){
    const S = new THREE.Matrix4().makeScale(MT_TO_VIEW, MT_TO_VIEW, MT_TO_VIEW);
    const Sinv = new THREE.Matrix4().makeScale(1 / MT_TO_VIEW, 1 / MT_TO_VIEW, 1 / MT_TO_VIEW);
    const view = new THREE.Matrix4().multiplyMatrices(Sinv, camera.matrixWorldInverse).multiply(S);
    const proj = new THREE.Matrix4().multiplyMatrices(T_NEAR_IS_ZERO, camera.projectionMatrix).multiply(S).multiplyScalar(1 / MT_TO_VIEW);
    const viewProj = new THREE.Matrix4().multiplyMatrices(proj, view);
    return { view, proj, viewProj, viewI: view.clone().invert(),
             position: new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld).multiplyScalar(1 / MT_TO_VIEW) };
  }

  program(layout, features){
    const key = layout + '|' + Object.keys(features).sort().map(k => features[k]).join(',');
    let p = this.programs.get(key);
    if (!p){ p = linkPrimitive(this.shaders, layout, features); p.label = 'batch ' + layout + ' ' + Object.values(features).join(','); this.programs.set(key, p); }
    return p;
  }

  texture(name){
    if (!name) return null;
    let t = this.textures.get(name);
    if (!t){
      const r = this.def.resources[name];
      t = { value: null };
      if (r && r.file) getTexture(r.file, { linear: true }).then(tex => { t.value = tex; });
      this.textures.set(name, t);
    }
    return t.value;
  }

  sync(prims, renderer, cam){
    const common = this.commonUniforms(renderer, cam);
    for (let k = 0; k < prims.length; k++){
      const d = prims[k];
      const p = this.program(d.inputLayout, d.features);
      let mesh = this.meshes[k];
      if (!mesh){
        mesh = new THREE.Mesh(new THREE.BufferGeometry(), null);
        mesh.frustumCulled = false;
        this.meshes[k] = mesh;
        this.scene.add(mesh);
      }
      writeGeometry(mesh, p, d);
      // material: one per program and draw slot; uniforms are this draw's
      if (!mesh.material || mesh.userData.programKey !== p){
        mesh.material = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: p.vertexShader, fragmentShader: p.fragmentShader, uniforms: {} });
        mesh.userData.programKey = p;
      }
      const mat = mesh.material;
      const u = mat.uniforms;
      for (const [name, { type, value }] of Object.entries(cbUniforms(this.shaders, d.cb))){
        if (VIEW_BUFFER.test(name)) continue;                      // the renderer's (the header)
        const v = type === 'float' ? value[0] : type === 'vec2' ? new THREE.Vector2(...value) : type === 'vec3' ? new THREE.Vector3(...value)
                : type === 'vec4' ? new THREE.Vector4(...value) : type === 'mat4' ? new THREE.Matrix4().fromArray(value) : null;
        if (v !== null) u[name] = { value: v };
      }
      for (const [name, value] of Object.entries(common)) u[name] = { value };
      u.tBaseMap = { value: this.texture(d.textures.tBaseMap) };
      u.tPrimDepthMap = { value: this.depth };
      applyState(mat, this.shaders, d.blend, d.depth, d.raster);
      mesh.renderOrder = 1000 + k;                     // the order the ROM's sorted primitive layer drew in
      mesh.visible = !!(u.tBaseMap.value || !/BaseMap/.test(d.features.FPrimitiveSample || ''));
    }
    for (let k = prims.length; k < this.meshes.length; k++) this.meshes[k].visible = false;
  }

  // ---- sGpuParticle draws: a cParticleNode's particles ------------------------------------------------------
  // Each is record A's GPU draw as the host read it at 0x890ce0 (host.gpuMeshDraw): TGPUParticle pass 0 linked for the
  // draw's feature slots (docs/effects/gpu-shaders.json, efx/shader/glsl.py --gpu), its IAGPUParticle vertices -- four
  // 32-byte corners a particle (position, colour, scale, pattern index, intensity, rotation, corner) -- and u16 strips
  // with 0xffff between (topology code 4, which the command executor draws as NVN primitive 5 with restart 0xffff,
  // 0xbbbae8 / 0xbbba7c), its CBGPUParticleTex / CBGPUParticleEx, its texture, blend / depth / rasterizer states, and the
  // fixed-function alpha test its +0x154 carries (primshader.js alphaTestOf). The view's buffers are this render's.
  syncGpu(draws, renderer, cam){
    const common = this.commonUniforms(renderer, cam);
    for (let k = 0; k < draws.length; k++){
      const d = draws[k];
      // A TECHNIQUE THE VIEWER CANNOT LINK YET is skipped and counted, not thrown -- the same choice construct.js makes
      // for an undecoded generator, and for the same reason: failing here stops EVERY effect of the monster, so one
      // layer we cannot draw would take the whole monster dark. cParticleNodeInfinite's draws come through as
      // TInfParticle: its ROM side is translated and runs (it builds, updates and submits), but the viewer's GL side
      // still lacks three things the decode named -- glsl.py has no op37 (`%`, which FInfParticleTexturePattern uses),
      // primshader.js names attributes `a_` + semantic so the layout's two Attribute elements collide, and
      // gpu-shaders.json carries no InfParticle programs. Until those land the node runs and draws nothing.
      if (d.technique !== 'TGPUParticle'){
        this.stats.skippedTechnique = (this.stats.skippedTechnique || 0) + 1;
        (this.skippedTechniques || (this.skippedTechniques = new Set())).add(d.technique);
        const hide = this.gpuMeshes[k];
        if (hide) hide.visible = false;
        continue;
      }
      const topology = (d.layout >>> 21) & 0xff;
      if (topology !== 4) throw new Error('live effects: GPU draw topology code ' + topology);
      const alphaTest = alphaTestOf(d.layout);
      const key = 'gpu|' + d.inputLayout + '|' + Object.keys(d.features).sort().map(f => d.features[f]).join(',') + '|' +
                  (alphaTest ? alphaTest.func + ':' + alphaTest.ref : 'none');
      let p = this.programs.get(key);
      if (!p){ p = linkProgram(this.gpuShaders, d.inputLayout, d.features, GPU_PARTICLE, alphaTest); p.label = 'node ' + d.inputLayout; this.programs.set(key, p); }
      let mesh = this.gpuMeshes[k];
      if (!mesh){
        mesh = new THREE.Mesh(new THREE.BufferGeometry(), null);
        mesh.frustumCulled = false;
        this.gpuMeshes[k] = mesh;
        this.scene.add(mesh);
      }
      writeGeometry(mesh, p, d);
      if (!mesh.material || mesh.userData.programKey !== p){
        if (mesh.material) mesh.material.dispose();
        mesh.material = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: p.vertexShader, fragmentShader: p.fragmentShader, uniforms: {} });
        mesh.userData.programKey = p;
      }
      const mat = mesh.material;
      const u = mat.uniforms;
      for (const [name, { type, value }] of Object.entries(cbUniforms(this.gpuShaders, d.cb))){
        if (VIEW_BUFFER.test(name)) continue;                      // the renderer's (the header)
        const v = type === 'float' ? value[0] : type === 'vec2' ? new THREE.Vector2(...value) : type === 'vec3' ? new THREE.Vector3(...value)
                : type === 'vec4' ? new THREE.Vector4(...value) : type === 'mat4' ? new THREE.Matrix4().fromArray(value) : null;
        if (v !== null) u[name] = { value: v };
      }
      for (const [name, value] of Object.entries(common)) u[name] = { value };
      u.tBaseMap = { value: this.texture(d.textures.tBaseMap) };
      applyState(mat, this.gpuShaders, d.blend, d.depth, d.raster);
      mesh.renderOrder = 1000 + k;                     // until order() places it among the batches
      mesh.visible = !!(u.tBaseMap.value || !/BaseMap/.test(d.features.FGPUParticleSample || ''));
    }
    for (let k = draws.length; k < this.gpuMeshes.length; k++) if (this.gpuMeshes[k]) this.gpuMeshes[k].visible = false;
  }

  // every effect draw in the order the game's sorted command list runs them (commandKey above), ties by submission
  // (stats.reordered counts batches the sort moves relative to one another: the primitive layer draws its batches in its
  // own depth order (0xc8cc58), which the keys are expected to agree with)
  order(gpu, prims, models){
    // a node draw whose technique syncGpu could not link has no mesh (skippedTechnique): it takes no place in the order
    const all = [...gpu.map((d, k) => ({ d, mesh: this.gpuMeshes[k] })).filter(x => x.mesh), ...prims.map((d, k) => ({ d, mesh: this.meshes[k], prim: k })),
                 ...models.filter(d => d.mesh && d.key !== undefined).map(d => ({ d, mesh: d.mesh }))];
    // a batch's pass is its own: the primitive list's batch draw 0xbac62c sets 0x15 for a record whose word +4 has a bit
    // of 0x200001 (0xbac688..0xbac698; Rathian's u 231 billboard), else 0x11 -- the key sorts it after the 0x11 draws,
    // as the game's list runs it (pass 0x15 renders into mpRTPostTarget, the model draws' target: not read). A pass the
    // viewer has not seen a draw take (0x16..0x18) stops the effects.
    for (const d of [...gpu, ...prims]){
      const pass = d.key & 0x1f;
      if (pass !== 0x11 && pass !== 0x15) throw new Error('live effects: a node or batch draw in pass 0x' + pass.toString(16));
    }
    const sorted = all.map(e => [commandKey(e.d), e.d.seq, e]).sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    let last = -1, moved = 0;
    sorted.forEach(([, , e], rank) => {
      e.mesh.renderOrder = 1000 + rank;
      if (e.prim !== undefined){ if (e.prim < last) moved++; last = Math.max(last, e.prim); }
    });
    this.stats.reordered = moved;
  }

  detach(){
    if (this.group.parent) this.group.parent.remove(this.group);
    for (const mesh of this.meshes){ mesh.geometry.dispose(); if (mesh.material) mesh.material.dispose(); this.scene.remove(mesh); }
    for (const mesh of this.gpuMeshes){ if (!mesh) continue; mesh.geometry.dispose(); if (mesh.material) mesh.material.dispose(); this.scene.remove(mesh); }
    this.gpuMeshes.length = 0;
    for (const mesh of this.modelMeshes){ if (mesh.material) mesh.material.dispose(); this.scene.remove(mesh); }   // the geometry is the glb's
    this.meshes.length = 0;
    this.modelMeshes.length = 0;
    if (this.depthTarget){ this.depthTarget.depthTexture.dispose(); this.depthTarget.dispose(); this.depthTarget = null; }
    if (this.ground){ this.ground.geometry.dispose(); this.ground.material.dispose(); this.scene.remove(this.ground); this.ground = null; }
    this.unhookAfterRender();
    if (this.filterPass){ this.filterPass.dispose(); this.filterPass = null; }
  }
}
// the ground stand-in's switch, for every runtime from now on (__view.effectGround)
let groundDefault = false;
export function setEffectGround(on){ groundDefault = !!on; }
