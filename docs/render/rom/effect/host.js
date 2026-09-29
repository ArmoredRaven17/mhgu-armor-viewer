// THE EFFECT HOST: what the engine around an effect provides, laid out where the ROM's code reads it.
//
// The effect runtime (construct.js, load.js, owner.js and the particle layers) and the draws
// (lifted-draw.js, lifted-prim.js, modeldraw.js) are translations of MHGU's routines over flat memory.
// They reach the engine through a handful of objects and services, and this file supplies them the way
// the emulator harness that verified them does (C:\MHGU-Extract\efx: efx_emu.py, efx_load.py,
// efx_draw.py, engdraw.py, engprim.py, parent.py) -- so a check can run the same frames here and
// compare what comes out with what the ROM produced there.
//
//   the heap              0x189f148 +0x20 -> an allocator object; vtable +0x1c alloc, +0x34 free
//                         (bridge.js natives at 0x7e000000 / 0x7e000104, the harness's stub entries)
//   resources             rEffectList / rEffectAnim / rModel / rTexture handles for the loader
//   a parent unit         +0x54 uModel's joint matrix 0x939278 over +0x494 joints / +0x498 table,
//                         +0x14 its class (bridge.js PARENT_GETDTI) for a start on a parent, and its own
//                         coordinates (+0x38 order, +0x40 position, +0x50 quaternion, +0x60 scale, +0x70 /
//                         +0xb0 the matrices composed from them), which a request placed at the unit reads
//   a proof start         a monster's effect request built from its record (proof.js)
//   the draw context      VIEW: the package table (one object per shader record), the constant
//                         buffer descriptors, a per-frame buffer, the camera block
//   the draw system       *0x211f8b4: its constructor's fields (docs/effects/draw-system.json),
//                         one worker PRIM with its primitive list, dynamic vertex buffer and
//                         texture-set registry
//
// The engine's own draw submission is where the host's output is: every Model particle mesh draw
// (modeldraw.js's answer) and every primitive GPU draw (the context's selected shader records,
// constant buffers, blend / depth / rasterizer states, textures, and the vertex and index bytes).
import { Mem, bitsf32, Unverified } from './mem.js';
import { newEffect, startEffect } from './construct.js';
import { loadEffectList, loadEffectAnim, DTI } from './load.js';
import { move } from './owner.js';
import { drawEffect } from './draw.js';
import { invoke } from './cpu.js';
import * as modeldraw from './modeldraw.js';
import './prim.js';
import { proofStart, installRequests, ProofRequest, unitFrame, pruneUnits, releaseRequest, stopRequest, AREA } from './proof.js';
import { PARENT_GETDTI, PARENT_ADD_EFFECT, RESMGR_RELEASE, MATERIAL_VM, liftedCall } from './bridge.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const u32bytes = v => new Uint8Array(new Uint32Array([v >>> 0]).buffer);

export class EffectHost {
  // pages: [[address, Uint8Array], ...] -- the image the runtime reads (data sections after the static
  //        initialisers and the effect manager, as the emulator leaves them)
  // heap: the first free address; records: docs/effects/mfx-records.json .records;
  // drawSystem: docs/effects/draw-system.json's bytes; resources: { meshTable(name) -> { count, table },
  //        textureSize(name) -> [w, h, depth] as the loader reads the .tex header (0xb4e49c: word 2 bits 6..18
  //        and 19..31, word 3 bits 16..28, each shifted left by word 1 bits 24..27), anim(name) -> .ean bytes,
  //        material(name, index) -> modeldraw's answers }
  // strict: an image page the pages do not carry is refused instead of read as zeros -- the viewer ships
  // only the pages the checks touched (docs/effects/rom-pages.bin), and a branch reaching another one
  // must be exported, not guessed at
  constructor({ pages, heap, records, drawSystem, resources, allocator = 0x600f0000, strict = false }){
    const m = this.m = new Mem();
    for (const [a, bytes] of pages) m.load(a, bytes);
    if (strict){
      const known = new Set(m.pages.keys());
      const page = m.page.bind(m);
      const imageLo = 0x13ef000 / 4096, imageHi = 0x2140000 / 4096, heapLo = 0x50400000 / 4096, heapHi = Math.floor(heap / 4096);
      m.page = a => {
        const k = Math.floor(a / 4096);
        if (!known.has(k) && ((k >= imageLo && k < imageHi) || (k >= heapLo && k < heapHi)) && !m.pages.has(k)){
          throw new Error('effect host: image page 0x' + (k * 4096).toString(16) + ' is not exported (dev/effect-export-rom.mjs)');
        }
        return page(a);
      };
    }
    this.heap = heap >>> 0;
    // ONE LOADED LIST PER .efl, shared by every effect built from it (createEffect).
    this.effectLists = new Map();
    this.freeBlocks = new Map();               // rounded size -> [freed addresses], for allocator reuse
    this.allocSizes = new Map();               // live allocation address -> its rounded size
    this.records = records;
    this.drawSystem = drawSystem;
    this.resources = resources;
    this.streams = new Map();
    this.pendingAnims = [];
    this.pendingLists = [];
    this.handles = new Map();                 // resource handle -> { dti, name }
    this.ids = 0;
    this.modelDraws = [];
    this.materialObjs = new Map();
    this.materialVT = 0;
    this.primDraws = [];
    this.gpuDraws = [];
    this.drawSeq = 0;
    const host = this;
    m.svc = {
      alloc: (size) => host.malloc(size),
      // materialAt: a stand-in material object per (model, mesh-material index). The ROM only needs an
      // object with a vtable here -- the real material values come from the .mrl at draw time
      // (modeldraw.js / host.material). Its vtable slots are all MATERIAL_VM, which leaves r0 alone.
      materialAt: (model, index) => {
        const key = (model >>> 0) + ':' + (index >>> 0);
        let obj = host.materialObjs.get(key);
        if (obj === undefined){
          if (host.materialVT === 0){
            host.materialVT = host.malloc(0x100);
            for (let off = 0; off < 0x100; off += 4) m.w32(host.materialVT + off, MATERIAL_VM);
          }
          obj = host.malloc(0x200);
          m.w32(obj, host.materialVT);
          host.materialObjs.set(key, obj);
        }
        return obj;
      },
      free: (p) => host.free(p),
      nextId: () => ++host.ids,
      streamSize: s => host.streams.get(s).length,
      streamRead(s, buf, n){ const d = host.streams.get(s); m.load(buf, d.subarray(0, n)); return Math.min(n, d.length); },
      loadResource: (dti, path, flags) => host.loadResource(dti, path, flags),
      beginModel: (args, stack) => modeldraw.beginModel(m, args[0], args[1], args[2], args[3], stack),
      // a model mesh's draw: its COMMAND KEY is the context's pass, kept -- neither emit path sets one -- with the draw's
      // order bits above it, written into +0x164 before the GPU draw (sorted path 0xc8f608..0xc8f620, unsorted 0xc8f2a4..
      // 0xc8f2d4); modeldraw.js computes the bits (`order`), the key and the write are the ROM's
      drawMesh: (args, stack, c) => {
        const view = args[1] >>> 0;
        const d = modeldraw.drawMesh(m, args[0], args[1], args[2], args[3], stack, c.sf[0], (model, index) => host.material(model, index));
        d.key = ((m.u32(view + 0x164) & 0x1f) | d.order) >>> 0;
        d.w178 = m.u32(view + 0x178);
        // the drawing node's flag word (+0xc) and its effect core's visibility byte (+0x18c, copied each frame from
        // +0x1c1 by 0x43370; the node's per-frame move folds it into bit 11 of +0xc at 0x327214 / 0x3273ac) -- the
        // stop policy of a player's held effect writes that byte (0x454ed4), so the viewer can honour it (live.js)
        d.nodeFlags = m.u32(args[0] + 0xc) >>> 0;
        { const core = m.u32(args[0] + 0x210) >>> 0; d.coreVisible = core ? m.u8(core + 0x18c) : null; }
        m.w32(view + 0x164, d.key);
        host.modelDraws.push(Object.assign(d, { model: (host.handles.get(args[0] && m.u32(args[0] + 0x70)) || {}).name, seq: host.drawSeq++ }));
      },
      drawBegin(){},
      renderSetup(){},
      primDraw: (args, stack) => host.primDraw(args, stack),
      drawEnd: () => host.primDrawEnd(),
      gpuMeshDraw: args => host.gpuMeshDraw(args),
    };
    this.allocator = allocator;
  }

  malloc(n){
    const size = (Math.max(n, 4) + 31) & ~31;
    let a;
    const bucket = this.freeBlocks.get(size);
    if (bucket && bucket.length) a = bucket.pop();           // reuse a freed block of the same rounded size
    else { a = this.heap; this.heap = (this.heap + size) >>> 0; }
    this.allocSizes.set(a, size);
    this.m.load(a, new Uint8Array(size));                    // hand back zeroed memory, reused or fresh
    return a;
  }
  // The ROM's allocator FREES through its free vtable +0x34 -- the 0x7e000104 native, which reaches here
  // with the exact pointer alloc returned (bridge.js). free() used to be a no-op, so the bump heap only
  // ever climbed; a long-running effect frees its per-frame scratch constantly, so the heap grew without
  // bound. Return each freed block to a size-bucketed free list and the next same-size alloc reuses it,
  // holding the heap flat in steady state. A pointer we did not hand out (or already freed) is ignored.
  free(p){
    p = p >>> 0;
    const size = this.allocSizes.get(p);
    if (size === undefined) return;
    this.allocSizes.delete(p);
    let bucket = this.freeBlocks.get(size);
    if (!bucket){ bucket = []; this.freeBlocks.set(size, bucket); }
    bucket.push(p);
  }
  // A belt-and-suspenders rewind for when NOTHING is running (live.js): everything above the mount baseline
  // is unreferenced, so drop it and the reuse bookkeeping for it. The free list above keeps the heap bounded
  // during a continuous loop, where running never reaches 0 and this never fires.
  heapReset(mark){
    this.heap = mark >>> 0; this.requests = null;
    this.freeBlocks.clear();
    for (const a of this.allocSizes.keys()) if (a >= this.heap) this.allocSizes.delete(a);
  }
  cstr(a){ let s = ''; for (let c; (c = this.m.rawByte(a)) !== 0; a++) s += String.fromCharCode(c); return s; }
  stream(bytes){ const s = this.malloc(0x40); this.streams.set(s, bytes); return s; }

  // The resource manager's load (vtable +0x30). A handle is a blank object except for what the
  // effect code and the draws read of it: rModel +0x74 / +0x78 the .mod's 48-byte mesh table and count
  // (0xb460c8), rTexture +0xd0 a texture object with the .tex size at +0x1e / +0x20 (nDraw::Texture);
  // an rEffectAnim is loaded from its .ean after the list (load.js). An rTexture also carries what its own
  // loader (rTexture vtable +0x2c, 0xb4e49c) leaves: the size at +0xdc / +0xe0 / +0xe4 and 1/width,
  // 1/height at +0xd4 / +0xd8, which the primitive draw copies into CBPrimitiveCoord (0xbb2194) -- a
  // texel-coordinate sprite's uv is its texel coordinate times them.
  loadResource(dti, path){
    const m = this.m, name = this.cstr(path);
    const handle = this.malloc(0x200);
    this.handles.set(handle, { dti, name });
    if (dti === DTI.rEffectAnim) this.pendingAnims.push([handle, name]);
    // A CHILD LIST: rEffectList::load's tail (0xb59a08) asks for the list named in the list's extension block (header
    // +0x2c -> block +0xa) and keeps the handle at list +0x80. The game loads it as it loads any list; loaded after
    // the list that asked (loadPending), in the order the recorder does (efx_load.py load_pending).
    if (dti === DTI.rEffectList) this.pendingLists.push([handle, name]);
    if (dti === DTI.rModel){
      const { count, table } = this.resources.meshTable(name);
      const t = this.malloc(48 * count);
      m.load(t, table);
      m.load(handle + 0x74, new Uint8Array(new Uint32Array([t, count]).buffer));
    }
    if (dti === DTI.rTexture){
      const [w, h, d = 1] = this.resources.textureSize(name);
      const tex = this.malloc(0x100);
      m.load(tex + 0x1e, new Uint8Array(new Uint16Array([w, h]).buffer));
      m.load(handle + 0xd0, u32bytes(tex));
      m.load(handle + 0xd4, new Uint8Array(new Float32Array([1 / w, 1 / h]).buffer));
      m.load(handle + 0xdc, new Uint8Array(new Uint32Array([w, h, d]).buffer));
      this.handles.set(tex, { dti, name, texture: true });
    }
    return handle;
  }
  material(model, index){ return this.resources.material(this.handles.get(model).name, index); }

  // An effect from its .efl bytes: uEffect::newInstance, the list loaded onto it. Not started.
  createEffect(efl){
    const m = this.m;
    const owner = newEffect(m);
    if (!this.setupDone){
      // the allocator object where the harness keeps it (efx_emu.ALLOC_OBJ, its vtable at +0x1000):
      // lifted code calls through vtable +0x1c (alloc) and +0x34 (free)
      m.w32(this.allocator, this.allocator + 0x1000);
      m.w32(this.allocator + 0x1000 + 0x1c, 0x7e000000);
      m.w32(this.allocator + 0x1000 + 0x20, 0x7e000000);    // +0x20: the same alloc (a DTI's newInstance)
      m.w32(this.allocator + 0x1000 + 0x34, 0x7e000104);
      m.load(0x189f168, u32bytes(this.allocator));        // heap table +0x20 -> the allocator object
      const resmgr = this.malloc(0x100), resmgrVt = this.malloc(0x400);
      m.load(0x211fa64, u32bytes(resmgr));
      m.w32(resmgr, resmgrVt); m.w32(resmgrVt + 0x3c, RESMGR_RELEASE);   // release: a proof start's reset reaches it
      this.malloc(0x400);                                  // the streams' vtable
      this.setupDone = true;
    }
    // AN rEffectList IS A LOADED RESOURCE, NOT PER-EFFECT STATE, so one load serves every effect
    // built from the same file -- which is what the game does: a .efl is a resource handle and its
    // records are many. Reloading it per effect was costing this app whole seconds: a weapon class
    // names far more RECORDS than FILES (the Switch Axe's 83 clip records resolve to 18 .efl, the
    // Bow's 34 to 16), and each reload re-runs the game's loader on the translated ROM at 300-500 ms
    // plus loadPending's resources. Mounting a Switch Axe took 25 s and a Charge Blade 41; with the
    // list shared it is a fraction of that.
    //   The monsters never felt it -- a monster's effects are nearly one record per file -- which is
    // why the file arrived here without it. Nothing else changes: a request reads the list through
    // its owner (+0xf4) and sets its own bit on it, effects keep their own uEffect, and the ROM's own
    // reload guard (listRelease) is untouched because a cached list is never loaded twice.
    let list = this.effectLists.get(efl);
    if (list === undefined){
      list = this.malloc(0x98 + 0x100);
      if (loadEffectList(m, list, this.stream(efl)) !== 1) throw new Error('effect list load failed');
      this.loadPending();
      this.effectLists.set(efl, list);
    }
    m.w32(owner + 0xf4, list);
    return owner;
  }
  // what a load asked for, loaded after it returns: every child list pending, then every .ean pending, until none is
  loadPending(){
    const m = this.m;
    while (this.pendingLists.length || this.pendingAnims.length){
      for (const [h, name] of this.pendingLists.splice(0)){
        if (loadEffectList(m, h, this.stream(this.resources.list(name))) !== 1) throw new Error('child effect list load failed: ' + name);
      }
      for (const [h, name] of this.pendingAnims.splice(0)){
        if (loadEffectAnim(m, h, this.stream(this.resources.anim(name))) !== 1) throw new Error('effect anim load failed: ' + name);
      }
    }
  }
  // STILL THROWS HERE, and deliberately, now that startEffect can return 0 for an effect that builds no
  // generators. This path is the host's own -- a PLAIN effect, not a monster's record -- and it has no ROM caller
  // to handle a 0: the record path goes through requestEffect into lifted ROM code, where 0x9baad0 tests the
  // return and 0x9bab88 tears the effect down, which is the handling that makes a 0 safe there. Returning false
  // here would leave a torn-down effect in the schedule's entries for the step to walk, which is the corpse
  // shape we already have one of. If a plain effect ever legitimately builds nothing, drop its entry here rather
  // than pass the 0 up.
  start(owner){ if (startEffect(this.m, owner) !== 1) throw new Error('effect start failed'); }
  // An effect started the way a monster's request starts it, from its record's 160 payload bytes, hung
  // from parent (placement states 0..2): parent mode 3, root joint, row masks, the list set -- which starts
  // it, so start() must not follow. Returns { state, mask1, mask2, joint }.
  proofStart(owner, parent, payload){
    return proofStart(this.m, owner, this.m.u32(owner + 0xf4), parent.object, payload, n => this.malloc(n));
  }
  move(owner){ move(this.m, owner); }
  // A monster's effect request, whole (proof.js ProofRequest): the core and the uMHProofEffect it makes, from
  // the record ({ index, key, path, payload }) whose list createEffect loaded (owner +0xf4), hung from
  // parent. The first request builds the boot objects. Every frame: unitFrame(), then draw request.effects().
  requestEffect(owner, parent, record, area = AREA, requester = null){
    if (!this.requests) this.requests = installRequests(this.m, n => this.malloc(n));
    return new ProofRequest(this.m, this.requests, { list: this.m.u32(owner + 0xf4), parent: parent.object, record, area, requester });
  }
  // between: called after the update pass, before the move pass (proof.js unitFrame) -- where a shell places its effect.
  // With no effect running the passes have nothing to run, but a monster's shells are units of their own and move
  // every frame all the same (Nargacuga's spikes spawn on a motion with no effect of its own); the first effect one
  // starts then takes this frame's move pass alone, as units added between the passes do.
  unitFrame(between){
    if (this.requests) return unitFrame(this.m, this.requests, between);
    if (!between) return;
    between();
    if (this.requests) unitFrame(this.m, this.requests, null, 'move');
  }
  // A SHELL'S per-frame placement of its effect (E:/offline/decode/notes/shells-em043.md section 1): 0x329c9c(h, pos,
  // 0) writes the position into the core's effects (+0x40, w 0) and 0x329d04(h, rotDeg, 0) their rotation (degrees x
  // pi/180 through 0x8a4dfc) -- the ROM's own routines, lifted.
  placeRequest(q, position, rotationDeg){
    const m = this.m, v = this.malloc(0x20);
    for (let k = 0; k < 3; k++){ m.wf32(v + 4 * k, position[k]); m.wf32(v + 0x10 + 4 * k, rotationDeg[k]); }
    m.w32(v + 12, 0); m.w32(v + 0x1c, 0);
    liftedCall(m, 0x329c9c, [q.core, v, 0]);
    liftedCall(m, 0x329d04, [q.core, v + 0x10, 0]);
  }
  // units the passes no longer act on (state 3) off the list; a request off the passes altogether (proof.js)
  pruneUnits(){ if (this.requests) pruneUnits(this.m, this.requests); }
  // Take a request off the unit passes (proof.js). Called on a request that has already been stopped and
  // stepped to death (schedule.js), so its particles are gone and their pool slots freed -- releasing it
  // outright while still emitting is what filled the slot pool and hit 0x418d4 (see stopClip).
  releaseRequest(request){ releaseRequest(this.requests, request); }
  stopRequest(request){ stopRequest(this.m, request); }

  // A parent unit for joint-bound nodes: 0x939278 at vtable +0x54, a live unit's +0xc, the joint
  // number -> index table at +0x498 and the joint array at +0x494 (0xa0 bytes each, the world matrix
  // at +0x10, row-major with the translation in the last row), and the unit's own coordinates as the
  // monster's constructor leaves them (uEm027_00's 0xe0f988; uCoord's part 0x8a46a0): no parent (+0x30 0,
  // +0x34 -1), the order word +0x38 0x30004 (a request turns the quaternion into angles in order 4:
  // 0x8a4b88 -> 0x7c3a38), position zero, identity quaternion, unit scale, the matrices composed from
  // those. +0xf0 stays 0 as the constructor leaves it: a request's placement then takes the position,
  // not the world matrix (0x31f6b4). efx/parent.py builds the same object.
  // `order` is the unit's uCoord order word: 0x30004 (order 4) for a monster and the hunter; 0x30000 (ORDER 0) for
  // a player PART unit -- the weapon in the hand -- whose class init clears the low half of the word it inherits
  // (0x306da8..0x306db0: `ldr r0, [r4, #0x38]; bfc r0, #0, #0x10; str`). The placement composer 0x31d16c picks the
  // joint-to-angles routine by this order (0x31dd90: 1..5 through a table, order 0 and above 5 to 0x7c3638 at
  // 0x31e160; order 4 is 0x7c3a38), so an effect hung on a weapon joint with order 4 here sat off the blade once the
  // swing became a compound rotation (Raven, 2026-09-28: "aligned until a certain point in the Demon Riot animation").
  createParent(jointNumbers, order = 0x30004){
    const m = this.m;
    const P = this.malloc(0x32b4), VT = this.malloc(0x400), TABLE = this.malloc(0x100);   // P: the real cUnit size
    const ARRAY = this.malloc(0xa0 * jointNumbers.length);
    m.w32(VT + 0x54, 0x939278);
    m.w32(VT + 0x14, PARENT_GETDTI);
    m.w32(VT + 0x10c, PARENT_ADD_EFFECT);                  // a request's effect hands itself to its parent (0x43cac)
    m.w32(P, VT);
    m.w32(P + 0xc, 0xf4ff9);
    m.load(TABLE, new Uint8Array(0x100).fill(0xff));
    jointNumbers.forEach((j, i) => m.w8(TABLE + j, i));
    m.w32(P + 0x494, ARRAY); m.w32(P + 0x498, TABLE);
    m.w32(P + 0x30, 0); m.w32(P + 0x34, 0xffffffff); m.w32(P + 0x38, order >>> 0);
    // THE UNIT'S MODEL (the Armor Viewer, 2026-09-29; Raven: "That spark effect is supposed to be on the weapon as it
    // transforms"). cUnit's +0xf0 is its model resource, a refcounted pointer: 0x88be08 releases the old one and
    // stores the new (with +0xf8/+0xfc), the dtor 0x93726c releases it. A live hunter or monster has a model, so the
    // word is never 0 in the game -- and the placement 0x31d16c tests exactly that (0x31f6b4): a record in UNIT SPACE
    // (payload +0x38 = 1: the Switch Axe's morph sparks 500/505/520/525 at joint 8, the footfalls 251..256 at 16/19,
    // 271..301 at 8/12) then takes its joint's matrix -- or, for joint -1, the unit's -- through 0x31f6c0, while a
    // unit WITHOUT a model falls back to the unit's bare position (0x31f788), the joint it just fetched dropped. The
    // bare stand-in (and efx/parent.py, which read the fallback as the intent) drew every such record at the unit's
    // origin: the morph spark on the floor 1.4 m ahead of the hunter, not on the blade. Nothing in the placement
    // dereferences the pointer; a block of zeros stands for the resource (efx/parent.py PARENT_MODEL=1).
    m.w32(P + 0xf0, this.malloc(0x100));
    // cUnit's LOD/draw sub-block at +0x1050 (base ctor 0x43a78c, monster-agnostic): effects read +0x1052 /
    // +0x1054 / +0x1068 (flags) / +0x1074 / +0x1078 / +0x10f0 from the unit. The rest of the 0x32b4 object is
    // zero, so +0x1068 = 0 and the draw setup (0x41c74) takes the real 0x41cac path, not the float path the
    // old too-small (0x1000) stand-in forced by letting these reads fall into the vtable. See efx/parent.py.
    m.w32(P + 0x1050, 0xff08ff00); m.w32(P + 0x1054, 0x000000ff);
    const parent = { object: P, vtable: VT, table: TABLE, array: ARRAY, joints: jointNumbers.slice(),
                     position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: 1 };
    this.composeParent(parent);
    return parent;
  }
  // the parent unit's own scale (uCoord +0x60..+0x68): a monster's size, which a request's effect takes
  setParentScale(parent, s){ parent.scale = s; this.composeParent(parent); }
  // the parent unit's placement: position [x, y, z] in game units, quaternion [x, y, z, w], a uniform scale
  setParentPose(parent, { position, quaternion, scale }){
    parent.position = position.slice(); parent.quaternion = quaternion.slice(); parent.scale = scale;
    this.composeParent(parent);
  }
  // A SHELL'S OWN POSE, as a rock shell keeps it (shells-em043.md 9.8): its position, and the rotation 0x539cd4 (the
  // shell's vtable +0xcc, after its move) builds from its three u32 angle words +0xfe8 / +0xfec / +0xff0 -- each
  // vcvt.f32.u32 times 9.58738019e-05 (0x38c90fdb) -- through 0x8a4dfc on the unit, in the unit's own rotation order
  // (+0x38 = 0x30004: uCoord's 0x8a46a0, which a shell's base constructor reaches as a monster's does: 0x4a0b28 ->
  // 0x538b34 -> 0x9366e0 -> 0x88b754). The quaternion 0x8a4dfc leaves at +0x50, then the matrices as composeParent.
  setParentAngles(parent, { position, angles, scale }){
    const m = this.m, F = Math.fround, k = bitsf32(0x38c90fdb);
    const v = this.angleVec || (this.angleVec = this.malloc(0x10));
    for (let i = 0; i < 3; i++) m.wf32(v + 4 * i, F(F(angles[i] >>> 0) * k));
    m.w32(v + 12, 0);
    liftedCall(m, 0x8a4dfc, [parent.object, v]);
    const q = [0, 4, 8, 12].map(o => m.f32(parent.object + 0x50 + o));
    parent.position = position.slice(); parent.quaternion = q; parent.scale = scale;
    this.composeParent(parent);
  }
  // Position +0x40, quaternion +0x50, scale +0x60 and the matrices the ROM composes from them, in its own
  // single-precision operations: the local matrix +0x70 (0x8a53bc: the quaternion's rotation, the position
  // in the last row) and, for a unit with no parent, the world matrix +0xb0 (0x8a5480: the local matrix
  // with rows 0..2 times the scale).
  composeParent(parent){
    const F = Math.fround, P = parent.object;
    const [px, py, pz] = parent.position.map(F), [x, y, z, w] = parent.quaternion.map(F), s = F(parent.scale);
    const z2 = F(z + z), y2 = F(y + y);
    const yy = F(y * y2), zz = F(z * z2), xy = F(x * y2), xz = F(x * z2), zw = F(z2 * w), yw = F(y2 * w), yz = F(y * z2);
    const x2 = F(x + x), xx = F(x * x2), xw = F(x2 * w);
    const local = [F(1 - F(yy + zz)), F(xy + zw), F(xz - yw), 0,
                   F(xy - zw), F(1 - F(xx + zz)), F(yz + xw), 0,
                   F(xz + yw), F(yz - xw), F(1 - F(xx + yy)), 0,
                   px, py, pz, 1];
    this.writeMatrix(P + 0x40, [px, py, pz, 0]);
    this.writeMatrix(P + 0x50, [x, y, z, w]);
    this.writeMatrix(P + 0x60, [s, s, s, 0]);
    this.writeMatrix(P + 0x70, local);
    this.writeMatrix(P + 0xb0, local.map((v, i) => i < 12 ? F(s * v) : v));
  }
  setJointMatrix(parent, jointNumber, rows16){
    this.writeMatrix(parent.array + 0xa0 * parent.joints.indexOf(jointNumber) + 0x10, rows16);
  }
  attach(owner, parent){ this.m.w32(owner + 0x30, parent.object); }
  writeMatrix(a, list){ const u = new Uint32Array(new Float32Array(list).buffer); u.forEach((w, i) => this.m.w32(a + 4 * i, w)); }

  // ---- the draw ---------------------------------------------------------------------------------
  // camera: { position: [x,y,z], view: 16 floats (row-major, translation in the last row), world: 16 }
  initDraw(camera, passMask = 1){
    const m = this.m, recs = this.records;
    const obj = (size, align16 = false) => { let a = this.malloc(size + 16); if (align16) a = (a + 15) & ~15; return a >>> 0; };
    const VIEW = this.VIEW = obj(0x40000), CAM = this.CAM = obj(0x400, true), SYS = this.SYS = obj(0x400);
    const PRIM = this.PRIM = obj(0x40000), BUF = this.BUF = obj(0x100000);
    m.w16(VIEW + 0x16a, passMask);
    m.w32(VIEW + 0xd7c, CAM);
    this.setCamera(camera);
    m.w32(0x211f8b4, SYS);
    m.load(SYS, this.drawSystem);                           // the constructor's fields
    m.w32(SYS + 0x2c, PRIM);
    m.w32(PRIM + 0x54, 1);
    const LIST = this.LIST = obj(0x400), RECS = this.RECS = obj(0x28 * 4096), ENTS = this.ENTS = obj(8 * 4096);
    m.w32(PRIM + 4, LIST);
    m.w32(LIST + 0x74, RECS); m.w32(LIST + 0x78, ENTS); m.w32(LIST + 0x7c, 4096); m.w32(LIST + 0x64, 1);
    const VB = this.VB = obj(0x40), VBDATA = this.VBDATA = obj(0x100000);
    m.w32(PRIM + 8, VB); m.w32(VB + 8, 0x100000); m.w32(VB + 0x14, VBDATA);
    // the texture sets (efx/efx_draw.py build): entry 0 of the draw system's registry is no texture set
    // (ctor 0xc935a4, frame begin 0xbab2c4, read at 0xbb1e40), and a worker's ranges run on from index 1
    // (0xa26ae4)
    const TEXSETS = this.TEXSETS = obj(20 * 256);
    m.w32(PRIM + 0x248 + 4, TEXSETS + 20); m.w32(PRIM + 0x248 + 0xc, 255); m.w32(PRIM + 0x248 + 0x10, 1);
    m.w32(VIEW + 0x14, BUF); m.w32(VIEW + 0x18, BUF + 0x100000);
    // the package: one object per record, so a slot's value names its record
    const n = recs.length;
    const FAKE = this.FAKE = this.malloc(0x40 * n), PKG = this.malloc(8 * n + 64);
    for (let i = 0; i < n; i++) m.w32(PKG + 8 * i, FAKE + 0x40 * i);
    const CBTAB = this.CBTAB = this.malloc(4 * n + 64), CBDEF = this.malloc(0x1000);
    // a constant buffer's descriptor stands in for its package record: +0x18 is the record's word 6,
    // (member count << 16) | float count with padding, which the draws mask ((w << 2) & 0x3fffc)
    for (let i = 0; i < n; i++){
      const r = recs[i];
      if (!r || r[1] !== 0) continue;
      const d = this.malloc(0x40);
      m.w32(d + 0x18, r[2]); m.w32(d + 0x24, CBDEF);
      m.w32(CBTAB + 4 * i, d);
    }
    m.w32(VIEW + 0x10, PKG); m.w32(VIEW + 8, CBTAB);
    for (let i = 0; i < n; i++){
      const r = recs[i];
      if (r && (r[1] === 4 || r[1] === 5 || r[1] === 6)) m.w32(VIEW + 0x204 + 8 * i, FAKE + 0x40 * i);
    }
    // the draw system's texture-set registry shares the worker's array (one worker, from index 1)
    const REG = this.malloc(0x10);
    m.w32(REG + 4, TEXSETS); m.w32(REG + 8, 256);
    m.w32(SYS + 0x54, 1); m.w32(SYS + 0x58, REG);
    this.VBUF = this.malloc(0x100000); this.IBUF = this.malloc(0x40000);
  }
  setCamera({ position, view, world }){
    const m = this.m, CAM = this.CAM;
    this.writeMatrix(CAM + 0x40, position);
    this.writeMatrix(CAM + 0x70, view);
    this.writeMatrix(CAM + 0xb0, world);
    this.writeMatrix(CAM + 0xf0, IDENTITY);
    this.writeMatrix(CAM + 0x130, IDENTITY);
  }

  // One view's frame: the primitive layer opened, the effects drawn into it, the layer drawn.
  drawFrame(owners){
    const m = this.m;
    this.modelDraws = []; this.primDraws = []; this.gpuDraws = [];
    this.drawSeq = 0;                          // the order draws are submitted in, across the three kinds (live.js order)
    m.w32(this.VIEW + 0x14, this.BUF); m.w32(this.VIEW + 0x18, this.BUF + 0x100000);
    m.w32(this.LIST + 0x74, this.RECS); m.w32(this.LIST + 0x78, this.ENTS);
    m.w32(this.LIST + 0x80, 0); m.w32(this.LIST + 0x64, 0);
    m.w32(this.VB + 0xc, 0); m.w32(this.VB + 0x14, this.VBDATA); m.w32(this.VB + 4, 0);
    m.w32(this.PRIM + 0x248 + 8, 0);
    m.w32(this.PRIM + 0x54, 0);
    // THE CONTEXT THE GAME DRAWS EFFECTS WITH. Effect units carry view bit 0 only (unit +0xe = 1: the core's ctor 0x41e54
    // at 0x41f34, the proof effect's 0x326c30), and sUnit's draw (0xc03cd0) draws a unit only in a view whose bit it
    // carries (mask 1 << ctx byte +0x168, 0xc03cfc; tests 0xc03e50 / 0xc03fcc) -- so they are drawn by sCamera's
    // viewport-0 scene draw (sRender frame 0xbbf93c -> sCamera vtable +0x28 0xb87734 -> sUnit draw at 0xb87a0c), on the
    // frame's context (sRender +0x25c), not by the 'Common' section (view 9, 0xbbfae0). At that call:
    //   +0x168 low byte (the VIEW) = 0 (0xb87844 / 0xb87854); +0x16a (the pass mask) = 1 (0x878ea0..0x878eb4). The effect
    //   draw reads the view as a per-view index: 0x9b7684 clamps it (>= 8 -> 0), a cParticleNode's draw does not
    //   (node+0x230[view], 0xaee448 -- with 9 it read past the 0x250-byte node).
    //   +0x164 (the PASS, bits 0..4) = 0x15 with key 0 (0x87b684 / 0x87bf44), set by the scene setup 0x878e0c after the
    //   frame's 0x87cf70(ctx, 0, 0) (0xbbfa88, 0xb87830) -- 0x15 because the viewport is the whole screen at the origin
    //   (0x87c9fc..0x87ca40: surf+0x10 bit 6 is always set, 0xbb93d0; otherwise 0x17 with key all ones). No effect code
    //   sets it before a model draw, whose command KEEPS it (0xc8f608 / 0xc8f2a4): a model particle is a pass-0x15
    //   command, drawn after every pass-0x11 one (billboards, nodes) -- unless a cParticleNode drew earlier in the frame
    //   and left 0x11 (record A's 0x87cf70). It is reset every frame: the primitive list draw sets 0x11 for itself
    //   (0xbab5fc) after every unit, and a context carried into the next frame with that 0x11 sends every model draw
    //   down the sorted path (0xc8ea44).
    //   (Pass 0x15 draws into mpRTPostTarget, pass 0x11 into mpRTMainTarget -- separate colour buffers with HDR on, the
    //   depth shared (nDraw::Scene 0xb03434..0xb03594, 0xb02748 -> 0xb054dc); what copies or tone-maps Main into Post,
    //   and what the scene's pass-0x15 full-screen quads draw, is not read. The viewer has one target: it keeps the order.)
    invoke(m, 0x87cf70, [this.VIEW, 0x15, 0]);
    m.w32(this.VIEW + 0x168, (m.u32(this.VIEW + 0x168) & ~0xff) >>> 0);
    m.w32(this.VIEW + 0x164, m.u32(this.VIEW + 0x164) & 0x1f);
    // sGpuParticle's frame (effects-node.md 4.2): vfn +0x28 0xb8fcbc begins it -- write pointers to the current
    // triple-buffered VB / IB, used counts 0, CPU staging cursors to the block starts -- and vfn +0x2c 0xb8fdb8 ends
    // it -- used counts into the stats, the buffer index on, each record's slot 7 (0xb91394). The game brackets its
    // whole frame with them (0x3d9d3c / 0x3da1b4); nothing between its begin and the effect draw reads what they
    // write, so the viewer brackets its draw. A cParticleNode's draw (0xaee3d8) fills the staging through its
    // record (slots 1 / 2 / 0) and submits it with slot 3 (0xb918c4, lifted-gpu.js), whose GPU draw 0x890ce0 is
    // read here (gpuMeshDraw).
    const gpu = this.requests ? this.requests.gpu : null;
    if (gpu) liftedCall(m, 0xb8fcbc, [gpu.manager]);
    invoke(m, 0xbad710, [this.SYS, this.VIEW, 0, 0], [0]);
    // in the order sUnit's draw walks them (0xc03cd0): by move line, then each line's list in the order the units joined
    // it (proof.js registerUnit) -- which matters, as a model draw keeps the pass the draw before it left
    const units = this.requests ? this.requests.units : [];
    const rank = new Map(units.map(([u, line], i) => [u >>> 0, [line, i]]));
    const drawn = owners.map((o, i) => [rank.get(o >>> 0) || [Infinity, Infinity], i, o])
                        .sort((a, b) => (a[0][0] - b[0][0]) || (a[0][1] - b[0][1]) || (a[1] - b[1])).map(x => x[2]);
    for (const o of drawn) drawEffect(m, o, this.VIEW);
    invoke(m, 0xbad790, [this.SYS, this.VIEW, 0, 0]);
    if (gpu) liftedCall(m, 0xb8fdb8, [gpu.manager]);
    if (this.sceneModels) for (const o of owners) this.sceneModelDraws(o);   // off until the red regression is understood
    return { models: this.modelDraws, prims: this.primDraws, gpu: this.gpuDraws };
  }


  // ---- ed&4 Model generators: effect-SPAWNED SCENE MODELS -----------------------------------------
  // An ed&4 Model generator (gen+0xed bit 2) is marked gen+0x46 = 0x37 by 0xa91a30, and the generator
  // draw 0xa92710 handles only 5 and 0x1e -- so these particles are NOT drawn as effect particles at
  // all. Each one instead gets its own cModel-like record (0xa925e8 -> 0xa92610, registered by
  // 0xc04f84), which the ENGINE MODEL RENDER 0x892028 draws via record->vtable[+0x68] (0xc68664) down
  // to the GPU mesh draw 0x890ce0. This host does not run that path -- its bl closure is ~111 functions
  // of engine render, which the viewer never lifts (modeldraw.js hand-translates the engine draw at its
  // entry for the same reason). Everything that path needs is ROM-computed in the record:
  //     +0x40 position, +0x50 quaternion, +0x60 scale   composed exactly as composeParent above does
  //     +0xf0 the rModel handle
  //     +0x110 a per-mesh VISIBILITY bitmask the ed&4 move writes (0xa921b8): word (row4 >> 5) & 0x7f,
  //            bit row4 & 0x1f -- the draw tests it at 0xc69458 and skips the mesh when clear
  //     the mesh row's material index is ubfx(row4, 0xc, 0xc) (0xc69518)
  // so the draws are emitted from the record here, in the shape modeldraw.js produces. The blend is the
  // one engdraw MEASURED for these draws (BSBlendBlendAlpha, the ROM's own 0xafd834 pick); depth comes
  // from the material's .mrl state.
  sceneModelDraws(owner){
    const m = this.m, F = Math.fround;
    for (let g = m.u32(owner + 0x1f0) >>> 0; g; g = m.u32(g + 0xc) >>> 0){
      if (!(m.u8(g + 0xed) & 4)) continue;
      for (let p = m.u32(g + 0xb0) >>> 0, n = 0; p && n < 4096; p = m.u32(p + 4) >>> 0, n++){
        const rec = m.u32(p + 0x4c) >>> 0;
        if (!rec) continue;
        const h = this.handles.get(m.u32(rec + 0xf0) >>> 0);
        if (!h) continue;
        let table, count;
        try { ({ table, count } = this.resources.meshTable(h.name)); } catch (e) { continue; }
        if (!count) continue;
        // the ROM's own composition (0x8a53bc local, 0x8a5480 world = rows 0..2 times the scale)
        const px = m.f32(rec + 0x40), py = m.f32(rec + 0x44), pz = m.f32(rec + 0x48);
        const x = m.f32(rec + 0x50), y = m.f32(rec + 0x54), z = m.f32(rec + 0x58), w = m.f32(rec + 0x5c);
        const sx = m.f32(rec + 0x60), sy = m.f32(rec + 0x64), sz = m.f32(rec + 0x68);
        const x2 = F(x + x), y2 = F(y + y), z2 = F(z + z);
        const xx = F(x * x2), yy = F(y * y2), zz = F(z * z2);
        const xy = F(x * y2), xz = F(x * z2), yz = F(y * z2);
        const xw = F(x2 * w), yw = F(y2 * w), zw = F(z2 * w);
        const M = [F(1 - F(yy + zz)), F(xy + zw), F(xz - yw), 0,
                   F(xy - zw), F(1 - F(xx + zz)), F(yz + xw), 0,
                   F(xz + yw), F(yz - xw), F(1 - F(xx + yy)), 0,
                   px, py, pz, 1];
        const S = [sx, sy, sz];
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) M[4 * r + c] = F(S[r] * M[4 * r + c]);
        // CBWorld rows are the matrix's first three columns (modeldraw.js: w(0),w(0x10),w(0x20),w(0x30) ...)
        const world = [M[0], M[4], M[8], M[12], M[1], M[5], M[9], M[13], M[2], M[6], M[10], M[14]];
        for (let i = 0; i < count; i++){
          const o = 48 * i + 4;
          const row4 = (table[o] | (table[o + 1] << 8) | (table[o + 2] << 16) | (table[o + 3] << 24)) >>> 0;
          const word = m.u32(rec + 0x110 + 4 * ((row4 >>> 5) & 0x7f)) >>> 0;
          if (!((word >>> (row4 & 0x1f)) & 1)) continue;          // the move cleared this mesh
          const material = (row4 >>> 12) & 0xfff;
          let mat;
          try { mat = this.resources.material(h.name, material); } catch (e) { continue; }
          if (!mat) continue;
          this.modelDraws.push({
            model: h.name, meshIndex: i, material, world,
            cbMaterial: (mat.cbs && mat.cbs.CBMaterial) || mat.cbm || [],
            globalTransparency: 1,
            blend: 'BSBlendBlendAlpha',
            depth: (mat.state && mat.state[1]) || 'DSZTest',
            features: {},
          });
        }
      }
    }
  }

  recordName(v){
    const k = (v - this.FAKE) / 0x40;
    return (Number.isInteger(k) && k >= 0 && this.records[k]) ? this.records[k][0] : null;
  }
  // What a draw leaves selected in the context's record slots (+0x204 + 8 x record): features (kind 2), textures (1),
  // samplers (3), constant buffers (0: the block's words), and the rest (7..9).
  contextSlots(ctx){
    const m = this.m, recs = this.records;
    const features = {}, textures = {}, samplers = {}, cb = {}, other = {};
    for (let i = 0; i < recs.length; i++){
      const r = recs[i];
      if (!r) continue;
      const v = m.rawByte(ctx + 0x204 + 8 * i) | (m.rawByte(ctx + 0x205 + 8 * i) << 8) |
                (m.rawByte(ctx + 0x206 + 8 * i) << 16) | (m.rawByte(ctx + 0x207 + 8 * i) << 24);
      if (!v) continue;
      if (r[1] === 2) features[r[0]] = this.recordName(v >>> 0);
      else if (r[1] === 1){ const h = this.handles.get(v >>> 0); textures[r[0]] = h ? h.name : '0x' + (v >>> 0).toString(16); }
      else if (r[1] === 3) samplers[r[0]] = this.recordName(v >>> 0);
      else if (r[1] === 9 || r[1] === 7 || r[1] === 8) (other[r[0]] = this.recordName(v >>> 0) || '0x' + (v >>> 0).toString(16));
      else if (r[1] === 0 && r[2]){
        const words = [];
        for (let k = 0; k < (r[2] & 0xffff); k++) words.push(m.u32((v >>> 0) + 4 * k));
        cb[r[0]] = words;
      }
    }
    return { features, textures, samplers, cb, other };
  }
  // 0x890ce0(ctx, index count, first index, 0): the INDEXED GPU DRAW, reached here from sGpuParticle's record A draw
  // (0xb918c4, lifted-gpu.js: a cParticleNode's particles as quads). The context is read at the call as the primitive
  // draw's is at 0x881584 -- its record slots, the states (+0x118 blend, +0x11c depth-stencil, +0x120 rasterizer), the
  // input layout (+0x1c8), +0x154 (topology in bits 21..28, the alpha test) and +0x164 (the pass and sort key) -- and
  // the buffers it binds: the vertex buffer object at +0x124 (stride byte +0x134, byte offset +0x138) and the index
  // buffer object at +0x14c, NVN buffers kept mapped at object +0x18 (nvnBufferMap, 0xb08390 / 0xaffa90; proof.js
  // gpuMap), into which the draw copied its staging (0xb92fd8 / 0xb92fec). Indices are u16 strips, 0xffff between.
  gpuMeshDraw(args){
    const m = this.m, ctx = args[0] >>> 0, count = args[1] >>> 0, first = args[2] >>> 0;
    if (args[3] >>> 0) throw new Unverified('0x890ce0 with a base vertex');
    const ibmem = m.u32(m.u32(ctx + 0x14c) + 0x18), vbmem = m.u32(m.u32(ctx + 0x124) + 0x18);
    const stride = m.rawByte(ctx + 0x134), vboff = m.u32(ctx + 0x138);
    const indexList = new Uint16Array(count);
    let vertices = 0;
    for (let i = 0; i < count; i++){
      const a = ibmem + 2 * (first + i);
      const v = indexList[i] = m.rawByte(a) | (m.rawByte(a + 1) << 8);
      if (v !== 0xffff && v + 1 > vertices) vertices = v + 1;
    }
    const vertexBytes = new Uint8Array(vertices * stride);
    for (let i = 0; i < vertexBytes.length; i++) vertexBytes[i] = m.rawByte(vbmem + vboff + i);
    this.gpuDraws.push(Object.assign(this.contextSlots(ctx), {
      vertices, stride, vertexBytes, indexList,
      blend: this.recordName(m.u32(ctx + 0x118)), depth: this.recordName(m.u32(ctx + 0x11c)),
      raster: this.recordName(m.u32(ctx + 0x120)), layout: m.u32(ctx + 0x154), key: m.u32(ctx + 0x164), w178: m.u32(ctx + 0x178),
      seq: this.drawSeq++,
      technique: (this.records[m.u32(ctx + 0x1d8) & 0xfff] || [])[0],
      inputLayout: (this.records[m.u32(ctx + 0x1c8) & 0xfff] || [])[0] }));
  }

  // 0x881584: room for the batch. The context is read here -- every slot the draw leaves selected.
  primDraw(args, stack){
    const m = this.m, ctx = args[0] >>> 0, recs = this.records;
    const features = {}, textures = {}, samplers = {}, cb = {}, other = {};
    for (let i = 0; i < recs.length; i++){
      const r = recs[i];
      if (!r) continue;
      const v = m.rawByte(ctx + 0x204 + 8 * i) | (m.rawByte(ctx + 0x205 + 8 * i) << 8) |
                (m.rawByte(ctx + 0x206 + 8 * i) << 16) | (m.rawByte(ctx + 0x207 + 8 * i) << 24);
      if (!v) continue;
      if (r[1] === 2) features[r[0]] = this.recordName(v >>> 0);
      else if (r[1] === 1){ const h = this.handles.get(v >>> 0); textures[r[0]] = h ? h.name : '0x' + (v >>> 0).toString(16); }
      else if (r[1] === 3) samplers[r[0]] = this.recordName(v >>> 0);
      else if (r[1] === 9 || r[1] === 7 || r[1] === 8) (other[r[0]] = this.recordName(v >>> 0) || '0x' + (v >>> 0).toString(16));
      else if (r[1] === 0 && r[2]){
        const words = [];
        for (let k = 0; k < (r[2] & 0xffff); k++) words.push(m.u32((v >>> 0) + 4 * k));
        cb[r[0]] = words;
      }
    }
    m.load(stack[1] >>> 0, u32bytes(this.IBUF));
    this.pending = { vertices: args[2] >>> 0, indices: args[3] >>> 0, stride: stack[0] >>> 0, features, textures, samplers, cb, other,
                     blend: this.recordName(m.u32(ctx + 0x118)), depth: this.recordName(m.u32(ctx + 0x11c)),
                     raster: this.recordName(m.u32(ctx + 0x120)), layout: m.u32(ctx + 0x154),
                     key: m.u32(ctx + 0x164), w178: m.u32(ctx + 0x178),                   // the command's sort key (live.js)
                     inputLayout: (this.records[m.u32(ctx + 0x1c8) & 0xfff] || [])[0] };   // ctx+0x1c8: the layout record's key
    return this.VBUF;
  }
  primDrawEnd(){
    const d = this.pending;
    if (!d) return;
    const m = this.m;
    d.vertexBytes = new Uint8Array(d.vertices * d.stride);
    for (let i = 0; i < d.vertexBytes.length; i++) d.vertexBytes[i] = m.rawByte(this.VBUF + i);
    d.indexList = new Uint16Array(d.indices);
    for (let i = 0; i < d.indices; i++) d.indexList[i] = m.rawByte(this.IBUF + 2 * i) | (m.rawByte(this.IBUF + 2 * i + 1) << 8);
    d.seq = this.drawSeq++;
    this.primDraws.push(d);
    this.pending = null;
  }
}
