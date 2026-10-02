// A MONSTER'S EFFECT REQUEST: what the game does to a uEffect it starts from an rProofEffectList record.
//
// A monster never names an effect file; it asks for an effect id (enemy vtable +0x1cc / +0x1d0), the id
// becomes a record key, and uMHProofEffect builds the effect the record describes
// (E:\offline\decode\notes\effects-firing.md). This is that build, for the records a joint-bound effect
// uses -- placement states 0..2 with a live parent -- the same as C:\MHGU-Extract\efx\proof.py does under
// the emulator:
//
//   the parameter block   uProofEffect's ctor (0x31b6b0) and the record copied over it (0x31c4ac); a
//                         fresh block's override words are 0, so every field comes from the record
//   0x32a2c4              uEffect +0x114 top nibble := 3 (parent mode 3: the parent is not applied at the
//                         effect's root; joint-bound nodes still follow its joints)
//   0x9ba5d8              quaternion, parent, ROOT JOINT, offset; row masks +0x1c8 / +0x1cc; the list set
//                         through vtable +0x6c (0x9ba238), which STARTS the effect (vtable +0xd0)
//   0x9ba544              the masks and the list again: a reset (vtable +0xd4) and a second start
//   0x32a3c0..0x32a494    scale, +0x38, +0x110's high half, +0x118's low nibble
//
// So the effect this returns is started; start() must not be called on it again. The ROM routines are
// lifted (lifted-proof.js, checked against efx/vecproof.py's vectors); the stores between them are
// transcribed from 0x32a284.
import { Unverified } from './mem.js';
import { liftedCall } from './bridge.js';
import { registerNative, clobber } from './cpu.js';
import './lifted-proof.js';
import './lifted-request.js';
import './lifted-gpu.js';
import './lifted-added.js';          // efx/add_effects.py --grow
import { L_a91c48 } from './lifted-particles.js';
import { registerCode, ownerMatrix } from './owner.js';

// uMHProofEffect's owner matrix (vtable +0x50, 0x3273e8) is a branch to uEffect's.
registerCode(0x3273e8, (m, o) => ownerMatrix(m, o));

// 0x42744 is the request CORE's GROUND-HEIGHT resolve (uMHEffectCore vtable 0x172a578 +0x58 -- the core's, not
// uMHProofEffect's: a run shows it reading core+0x140 and core+0xec; NOT the draw at +0x12c = 0x43168), called
// from the placement 0x31d16c/0x327188 with (self, vec3*) and RETURNING THE HEIGHT AS A FLOAT IN s0, which
// 0x31f904 stores straight into the effect's world-matrix Y. It is now LIFTED (lift-effects.sh,
// lifted-request.js) instead of stubbed: a no-op left s0 holding cpu.js's POISON, so every particle of
// em084_00_007 was placed at Y = -6.27e18 and drew off-screen.
//   The ROM: s16 = the input Y (the default result); with no parent handle or no parent unit it returns that
// unchanged. Otherwise, only when effect+0xec bit 4 is set does it ray-cast through 0x18154c (the -FLT
// sentinel 0xc7c35000) -- that branch is unrecorded and stays an Unverified throw. With the bit clear it
// takes the parent unit's own fields: s0 = [parent+0x1074], s2 = [parent+0x10f0], skipped entirely when
// [parent+0x1066] & 4; then s0 = max(s0, s2) and effect+0xec bit 0 picks s0 over s2. Both fields are ZERO on a
// constructed enemy -- 0x538b34 stores -100000.0 at +0x1074 (0x538c3c) and then clears +0x1058..+0x1093 and
// +0x10a0..+0x10fb (memclr8 at 0x538e14 / 0x538e20); in game the stage floor query 0x18154c fills them -- so with
// no stage this answers 0.0, the ROM's own value. The core's spawn height check (0x328c10, payload +0x40 / +0x52,
// allowed height payload +0x58) compares a joint's y against it.

// 0xc04f84 is the unit manager's add with a parent (sUnit *0x211ff48, line, unit, parent): the same line-list
// link as 0xc03670 (sUnit + line*0x18 + 0x28/0x2c, the line into the unit's +0xc bits 3..9, 0xc04d7c with the
// parent's +0x20/+0x24 masks), not a draw list. So it is answered like 0xc03670 (bridge.js): registers as they
// were, the unit kept for the passes -- as efx/proofunit.py answers both. An ended effect's CHILD LIST effect
// is added this way (0x9b6e44 -> 0xc04f84 at 0x9b6f00); so are the ed&4 model records (0xa92688).
registerNative(0xc04f84, (m, c) => { m.svc.registerUnit(c.r[0] >>> 0, c.r[1] >>> 0, c.r[2] >>> 0, c.r[3] >>> 0); });

// 0xb8f05c(sEffect, request, param): a type-9 generator's post (0xa826bc, at 0xa82c0c) hands sEffect a 0xf0-byte
// SCREEN FILTER request (effects-filter.md; the caller ignores the return). sEffect's per-view filter units rank
// and draw them; that consumer is not the effect's code, so the request is taken here, as the recorder takes it
// (efx/proofunit.py 'filter_submit'), for the host to draw (filter.js).
registerNative(0xb8f05c, (m, c) => { m.svc.filterSubmit(c.r[0] >>> 0, c.r[1] >>> 0, c.r[2] >>> 0); });

// sGpuParticle's driver side (E:/offline/decode/notes/effects-node.md section 8; efx/proofunit.py build_gpu_particle): the
// NVN buffer procs its ctor calls through .bss pointers, GPU memory pool 5 and the device -- answered at the fixed
// addresses the recorder uses, through m.svc (installRequests).
export const NVN_SET_DEVICE = 0x7e001020, NVN_SET_DEFAULTS = 0x7e001024, NVN_SET_STORAGE = 0x7e001028,
             NVN_INITIALIZE = 0x7e00102c, NVN_MAP = 0x7e001030, NVN_FINALIZE = 0x7e001034, POOL_ALLOC = 0x7e001038, POOL_FREE = 0x7e00103c;
const NVN_SLOTS = [[0x1918704, NVN_SET_DEVICE], [0x1918708, NVN_SET_DEFAULTS], [0x191870c, NVN_SET_STORAGE],
                   [0x191871c, NVN_INITIALIZE], [0x1918728, NVN_MAP], [0x1918724, NVN_FINALIZE]];
const POOL_BYTES = 0x200000;
// Each answers through m.svc under the recorder's service name, so a check replays them in the game's order.
registerNative(NVN_SET_DEVICE, (m, c) => { c.r[0] = m.svc.gpuStub('nvn_set_device', c.r[0] >>> 0) >>> 0; });
registerNative(NVN_SET_DEFAULTS, (m, c) => { c.r[0] = m.svc.gpuStub('nvn_set_defaults', c.r[0] >>> 0) >>> 0; });
registerNative(NVN_FINALIZE, (m, c) => { c.r[0] = m.svc.gpuStub('nvn_finalize', c.r[0] >>> 0) >>> 0; });
registerNative(NVN_SET_STORAGE, (m, c) => { m.svc.gpuSetStorage(c.r[0] >>> 0, c.r[1] >>> 0, c.r[2] >>> 0, c.r[3] >>> 0); c.r[0] = 0; });
registerNative(NVN_INITIALIZE, (m, c) => { c.r[0] = m.svc.gpuInitialize(c.r[0] >>> 0, c.r[1] >>> 0) >>> 0; });
registerNative(NVN_MAP, (m, c) => { c.r[0] = m.svc.gpuMap(c.r[0] >>> 0) >>> 0; });
registerNative(POOL_ALLOC, (m, c) => { c.r[0] = m.svc.gpuPoolAlloc(c.r[1] >>> 0, c.r[2] >>> 0, c.r[0] >>> 0) >>> 0; });
// The pool's free (its vtable +0x34) is free(self, offset) -- r0 is the pool, R1 IS THE BLOCK. The stub is kept so a
// check replays the service calls in the game's order, and the block is handed back to the stand-in's own free list:
// the ROM does call this (0x8676fc..0x86770c, the buffer's finalize, and the model draws' own), and treating it as a
// no-op made pool 5 a one-way bump -- Rathian went dark with 'GPU pool 5 stand-in exhausted' 101 motions into one
// runtime, and cParticleNodeInfinite made it far likelier by taking its own VB/IB per play.
registerNative(POOL_FREE, (m, c) => {
  m.svc.gpuStub('gpu_pool_free', c.r[0] >>> 0);
  c.r[0] = (m.svc.gpuPoolFree ? m.svc.gpuPoolFree(c.r[1] >>> 0) : 0) >>> 0;
});
// RECORD A'S DRAW (sGpuParticle record vtable 0x178e160 slot 3, 0xb918c4, with its fog features, slot 8 0xb913fc) runs
// LIFTED (lifted-gpu.js; effects-node.md 5.2-5.4): the pass and sort key, technique, input layout, states, constant
// buffers and the copies of its staging into the mapped buffers. What it hands the GPU, the indexed draw
// 0x890ce0(ctx, index count, first index, 0), is the host's to render: the context is read there (host.gpuMeshDraw),
// as the primitive draw's is at 0x881584 (prim.js). Recorded the same way: efx/vecdrawsched.py GPU_DRAW_ROM=1.
registerNative(0x890ce0, (m, c) => { m.svc.gpuMeshDraw([c.r[0], c.r[1], c.r[2], c.r[3]]); clobber(c); c.r[0] = 0; });

// TEMPORARILY BACK OUT the ed&4 path (2026-09-20): with it on, Raven reports the RED energy effect no
// longer renders. Until that regression is understood, ed&4 Model generators are skipped again -- their
// per-particle records are not built, exactly as before this work. The lifted ed&4 branch, the record
// machinery and host.sceneModelDraws stay in place behind this switch.
registerNative(0xa91c48, (m, c) => {
  const gen = c.r[0] >>> 0;
  if ((m.u8(gen + 0xed) & 4) && !globalThis.__ED4__) return;   // __ED4__ = true re-enables the ed&4 records
  return L_a91c48(m, c);
});

const QUAT_GOT = 0x1832ad8;          // 0x32a300: the quaternion the start passes (identity)

// 0x329d88: the compose state from the block's placement mode (+0x46), +0x48 and +0x4e
function composeState(m, block){
  const mode = m.u8(block + 0x46);
  if (mode === 4) return 0;
  if (mode === 1) return 2;
  if (mode === 0) return m.u8(block + 0x48) === 1 ? 1 : 0;
  return m.u8(block + 0x4e) === 6 ? 3 : 4;
}

// payload: the record's 160 fixed bytes (Uint8Array). scratch(size) -> an address the block and the
// payload may live at for the call (the harness allocates them from its heap, in this order).
export function proofStart(m, owner, list, parent, payload, scratch){
  const block = scratch(0x100);
  liftedCall(m, 0x31b6b0, [block]);
  const pay = scratch(0xa0);
  m.load(pay, payload);
  liftedCall(m, 0x31c4ac, [block, pay]);
  const state = composeState(m, block);
  if (state > 2) throw new Unverified('0x32a320 proof start in placement state ' + state);
  const mask1 = m.u32(block + 0x58), mask2 = m.u32(block + 0x5c);
  const joint = (m.u16(block + 0x42) << 16) >> 16;
  // 0x32a2c4: a block store of +0x110..+0x118 with +0x114's top nibble := 3
  const w0 = m.u32(owner + 0x110), w1 = m.u32(owner + 0x114), w2 = m.u32(owner + 0x118);
  m.w32(owner + 0x110, w0); m.w32(owner + 0x114, ((w1 & 0x0fffffff) | 0x30000000) >>> 0); m.w32(owner + 0x118, w2);
  liftedCall(m, 0x9ba5d8, [owner, list, mask1, mask2], [m.u32(QUAT_GOT), parent, joint >>> 0, block + 0x10, 4]);
  liftedCall(m, 0x9ba544, [owner, list, mask1, mask2]);
  // 0x32a3c0..0x32a494
  for (let k = 0; k < 12; k += 4) m.w32(owner + 0x60 + k, m.u32(block + 0x30 + k));
  m.w32(owner + 0x6c, 0);
  m.w16(owner + 0x38, m.u8(block + 0x47));
  const v = m.u16(block + 0x60);
  if ((((v - 1) >>> 0) >>> 3) <= 0x4a) m.w32(owner + 0x110, ((m.u32(owner + 0x110) & 0xffff) | (v << 16)) >>> 0);
  const k = m.u8(block + 0x4b);
  if (k <= 2) m.w32(owner + 0x118, ((m.u32(owner + 0x118) & ~0xf) | [0, 1, 3][k]) >>> 0);
  return { state, mask1, mask2, joint };
}

// ---- a monster's effect request, whole (C:\MHGU-Extract\efx\proofunit.py) -----------------------------------
//
// In the game the effect a request makes is not a plain uEffect: a uMHEffectCore (0x350 bytes) makes a
// uMHProofEffect (0x500), whose own update (0x43d5c) and move (0x43da0 -> 0x327188) recompose it from the
// monster every frame -- its root at the joint, its scale the record's times the monster's (uCoord +0x60) --
// before uEffect's move. This builds the same objects the harness builds, in the same order, and runs them
// with the same unit passes; every routine is lifted (lifted-request.js) from efx/vecproofunit.py's vectors.
// The stand-ins are the harness's (proofunit.py's header lists them), answered by bridge.js at its fixed
// addresses through m.svc: registerUnit, handleValid, handleUnit, requestLoad.
import { ALLOCATOR, REQUEST_LOAD, HANDLE_VALID, HANDLE_GET } from './bridge.js';

const RECORD_VT_GOT = 0x32288c + 0x1512d40;          // 0x322884: the record object's vtable
const DT = 1.0;                                      // the frame delta a pass writes to a unit's +0x1c
export const AREA = 1;                               // the monster's and the player's area: only ever compared
const PROOF_EFFECT_VT = 0x172a7d4 + 8;              // uMHProofEffect's vtable, as its ctor 0x43af0 installs it

// The boot objects, once per memory: the default heap and MtString's allocator on the host's allocator, the
// session singleton (a quest, the monster in the player's area) and the MH effect manager. Returns the request
// state the services read.
export function installRequests(m, malloc){
  const state = { units: [], lists: new Map(), handleParent: 0, malloc };
  m.svc.registerUnit = (sunit, line, unit) => {
    state.units.push([unit >>> 0, line >>> 0]);
    // the one write the real add makes to the UNIT that effect code reads back: its move line into flags bits
    // 3..9 (0xc036f8 / 0xc05030: bfi +0xc, line, #3, #7) -- as efx/proofunit.py's service does it
    if (unit) m.w32(unit + 0xc, ((m.u32(unit + 0xc) & ~(0x7f << 3)) | ((line & 0x7f) << 3)) >>> 0);
  };
  // this frame's screen-filter requests (0xb8f05c): the 0xf0 bytes as submitted and the param (the row's mask
  // texture entry, 0 as shipped); cleared as each frame's unit passes start (unitFrame), as sEffect's filter unit
  // clears its entries in its update pass before the effects' move submits again (0xc6050c)
  state.filters = [];
  m.svc.filterSubmit = (mgr, req, param) => {
    const bytes = new Uint8Array(0xf0);
    for (let i = 0; i < 0xf0; i++) bytes[i] = m.rawByte(req + i);
    state.filters.push({ bytes, param });
  };
  m.svc.handleValid = () => 1;
  // the handle's own parent (ProofRequest stores it at handle +8, which only this service reads), so requests hung
  // from different parents -- the monster's and a shell's -- each get theirs (efx/proofunit.py does the same)
  m.svc.handleUnit = h => (h && m.u32(h + 8)) || state.handleParent;
  m.svc.requestLoad = (dti, path) => {
    let name = ''; for (let a = path, c; (c = m.u8(a)) !== 0; a++) name += String.fromCharCode(c);
    const list = state.lists.get(name);
    if (list === undefined) throw new Unverified('request load of ' + name + ': no list');
    return list;
  };
  m.w32(0x189f148 + 4, ALLOCATOR);
  m.w32(0x177feb0, ALLOCATOR);
  // The session as a hunt has it (efx/proofunit.py install): mode 5, an aQuest running (0x126c4), so 0x3f79c8
  // picks the local area byte +0x49, and that area is the monster's (AREA, what every request carries): each
  // core then sets +0x18c = (local area == its area) (0x43300) and the effect's unit flag bit 11 follows it
  // (0x327210) -- the bit a child list's spawn (0x4498c) needs. The ctor's mode 0 / area 0 was "another area".
  state.session = liftedCall(m, 0x3f6be8).r[0];
  m.w32(state.session + 0x1c, 5);
  m.w8(state.session + 0x49, AREA);
  // the unit manager sUnit (*0x211ff48) by its own newInstance 0xc0374c: 64 move lines, each flags word 0x3fd
  // (0xc037d4); effect code reads a line's flags byte for the line in a unit's flags (the filter gate, 0xa82660)
  state.sunit = liftedCall(m, 0xc0374c).r[0];
  // sGpuParticle (*0x211f5d4) by its own ctor 0xb8f968(obj, 0x60000, 0x20000), as the boot builds it (0x3d81b0) and
  // efx/proofunit.py build_gpu_particle does: pool 5 ([0x189f148 + 0x14], vtable +0x1c alloc / +0x34 free, +0x58 base,
  // +0x5b0 an opaque NVN pool), the device ([0x211f998] + 0x90) and the NVN proc pointers
  {
    const gpu = state.gpu = { storage: new Map(), buffers: new Map(), base: malloc(POOL_BYTES), cursor: 0,
                              live: new Map(), holes: [], peak: 0 };
    gpu.cursor = gpu.base;
    // A BLOCK THE GAME HAS FREED IS HANDED BACK OUT. The real pool 5 is an NVN memory pool the engine sub-allocates
    // and releases; this stand-in carves blocks out of emulated memory. Its free once did nothing (every effect that
    // played took its slab for good); then it reused a freed block only at the exact same size and alignment, so a run
    // of ever-new shapes -- cParticleNodeInfinite's record E asks 2 x (128N + 12N - 2) bytes, N its particles -- still
    // climbed the cursor until every effect of the host stopped at once. Now (the Monster Viewer session's patch,
    // 2026-10-01, verified there by randomized invariants and an A/B soak): freed blocks become HOLES, kept sorted and
    // coalesced with their neighbours, a hole that reaches the cursor lowers it, and an allocation takes the first hole
    // it fits (in address order) before the cursor rises. `peak` is the real high-water mark.
    const alignUp = (a, al) => Math.ceil(a / al) * al;
    const addHole = (lo, hi) => {
      const H = gpu.holes;
      let i = 0;
      while (i < H.length && H[i][0] < lo) i++;
      H.splice(i, 0, [lo, hi]);
      if (i + 1 < H.length && H[i][1] === H[i + 1][0]){ H[i][1] = H[i + 1][1]; H.splice(i + 1, 1); }
      if (i > 0 && H[i - 1][1] === H[i][0]){ H[i - 1][1] = H[i][1]; H.splice(i, 1); }
      const top = H[H.length - 1];
      if (top && top[1] === gpu.cursor){ gpu.cursor = top[0]; H.pop(); }
    };
    m.svc.gpuPoolAlloc = (size, align) => {
      align = Math.max(align, 1);
      const key = size + ':' + align;
      for (let i = 0; i < gpu.holes.length; i++){                    // first fit, in address order
        const [lo, hi] = gpu.holes[i], at = alignUp(lo, align);
        if (at + size > hi) continue;
        const rest = [];
        if (at > lo) rest.push([lo, at]);
        if (at + size < hi) rest.push([at + size, hi]);
        gpu.holes.splice(i, 1, ...rest);
        gpu.live.set(at, key);
        return at;
      }
      const at = alignUp(gpu.cursor, align);
      if (at + size > gpu.base + POOL_BYTES){
        const tally = m2 => { const t = new Map(); for (const k of m2) t.set(k, (t.get(k) || 0) + 1);
          return [...t].sort((a, b) => b[1] * +b[0].split(':')[0] - a[1] * +a[0].split(':')[0]).slice(0, 4)
                 .map(([k, n]) => k + ' x' + n).join(', '); };
        const holeBytes = gpu.holes.reduce((n, [lo, hi]) => n + hi - lo, 0), big = gpu.holes.reduce((n, [lo, hi]) => Math.max(n, hi - lo), 0);
        throw new Unverified('GPU pool 5 stand-in exhausted asking ' + key + ': ' + Math.round(gpu.cursor - gpu.base >> 10) + ' KB of ' +
          (POOL_BYTES >> 10) + ' KB to the cursor, ' + gpu.live.size + ' blocks held (' + tally(gpu.live.values()) + '), ' +
          gpu.holes.length + ' holes below it (' + (holeBytes >> 10) + ' KB, the largest ' + big + ' bytes), free called ' +
          (gpu.freeCalls || 0) + ' times, ' + (gpu.freeMiss || 0) + ' on a block not ours');
      }
      const was = gpu.cursor;
      gpu.cursor = at + size;
      if (at > was) addHole(was, at);                                  // the alignment's gap, free to the next fit
      gpu.peak = Math.max(gpu.peak, gpu.cursor - gpu.base);
      gpu.live.set(at, key);
      return at;
    };
    // the ROM frees by the value it was given; a host that keeps offsets rather than addresses is accepted too
    m.svc.gpuPoolFree = p => {
      p = p >>> 0;
      gpu.freeCalls = (gpu.freeCalls || 0) + 1;
      const at = gpu.live.has(p) ? p : (gpu.live.has((gpu.base + p) >>> 0) ? (gpu.base + p) >>> 0 : 0);
      if (!at){ gpu.freeMiss = (gpu.freeMiss || 0) + 1; return 0; }   // not ours (or freed twice): leave it alone
      const size = +gpu.live.get(at).split(':')[0];
      gpu.live.delete(at);
      addHole(at, at + size);
      return 0;
    };
    m.svc.gpuSetStorage = (builder, pool, offset, size) => { gpu.storage.set(builder, [pool, offset, size]); };
    m.svc.gpuInitialize = (buffer, builder) => { gpu.buffers.set(buffer, gpu.base + gpu.storage.get(builder)[1]); return 1; };
    m.svc.gpuMap = buffer => gpu.buffers.get(buffer);
    m.svc.gpuStub = () => 0;
    const pool = malloc(0x800), pvt = malloc(0x100);
    m.w32(pvt + 0x1c, POOL_ALLOC); m.w32(pvt + 0x34, POOL_FREE);
    m.w32(pool, pvt); m.w32(pool + 0x58, gpu.base); m.w32(pool + 0x5b0, malloc(0x100));
    m.w32(0x189f148 + 5 * 4, pool);
    const dev = malloc(0x100);
    m.w32(dev + 0x90, malloc(0x1000));
    m.w32(0x211f998, dev);
    for (const [slot, addr] of NVN_SLOTS) m.w32(slot, addr);
    const M = malloc(0x114);
    liftedCall(m, 0xb8f968, [M, 0x60000, 0x20000]);
    m.w32(0x211f5d4, M);
    gpu.manager = M;
  }
  state.manager = liftedCall(m, 0x4111c).r[0];
  if (!state.manager) throw new Unverified('MH effect manager: none');
  state.units.length = 0;
  return state;
}

const vslot = (m, obj, slot) => m.u32((m.u32(obj) + slot) >>> 0);

// record: { index, key, path, payload (Uint8Array) }; list: the loaded rEffectList handle for record.path;
// parent: the parent unit (host.createParent's object).
export class ProofRequest {
  constructor(m, state, { list, parent, record, area = AREA, requester = null }){
    const malloc = state.malloc;
    this.m = m; this.state = state;
    m.w32(list + 0x50, (m.u32(list + 0x50) | 1) >>> 0);
    state.lists.set(record.path, list);
    m.w32(m.u32(m.u32(0x211fa64)) + 0x30, REQUEST_LOAD);
    state.handleParent = parent;
    const H = this.handle = malloc(0x40), HVT = malloc(0x40);
    m.w32(H, HVT); m.w32(HVT, HANDLE_VALID); m.w32(HVT + 4, HANDLE_GET);
    m.w32(H + 8, parent);
    const idx = record.index;
    const L = this.list = malloc(0x100), recs = malloc(4 * (idx + 1));
    m.w32(L + 0x90, idx + 1); m.w32(L + 0x9c, recs);
    const R = this.record = malloc(0xc0);
    m.w32(R, (m.u32(RECORD_VT_GOT) + 8) >>> 0);
    liftedCall(m, 0x323724, [R]);
    const s = Array.from(record.path, ch => ch.charCodeAt(0));
    const string = malloc(s.length + 0xc);
    m.w32(string, 1); m.w32(string + 4, s.length);
    m.load(string + 8, new Uint8Array([...s, 0]));
    m.w32(R + 0x14, string);
    m.load(R + 0x20, record.payload);
    const kind = record.payload[0x3d];
    m.w32(R + 8, kind === 0 ? 1 : kind === 1 ? 2 : 3);
    m.w32(recs + 4 * idx, R);
    const Q = this.requester = malloc(0xe0);
    liftedCall(m, 0x40a54, [Q]);
    m.w8(Q + 0xc, area);
    m.w32(Q + 0xd0, H); m.w32(Q + 0x1c, (m.u32(Q + 0x1c) | 2) >>> 0);
    if (requester){
      // A SHELL'S requester (E:/offline/decode/notes/shells-em043.md section 1), as efx/proofunit.py fills it:
      // 0x4a10c8 sets +0x1c |= 3, +0xc0..+0xcc the anchor position (w 0), +0x14 |= 0x40000000 with +0x40..+0x4c =
      // (ShellScale x3, 0), +4 = 0; the shell sets +0x14 |= 2 with +0x30..+0x3c the rotation override (degrees,
      // w 0); 0x4a11e4 sets +8 = 3. The parent (+0xd0's handle) is the shell's model interface.
      // A REQUEST AT A POINT stops there: 0x703b8 (a cut tail's landing, tail-option-em043.md 7) writes the parent
      // handle, +0x1c |= 3 and the position alone -- no +0x14, +0x40, +4 or +8.
      const r = requester, v4 = (a, v) => { for (let k = 0; k < 3; k++) m.wf32(a + 4 * k, v[k]); m.w32(a + 12, 0); };
      // A requester with no position (the Switch Axe's sword-aura requester 0x11a40f4, below) keeps +0x1c's bit 1 alone
      m.w32(Q + 0x1c, (m.u32(Q + 0x1c) | (r.flags1c == null ? (r.position ? 3 : 2) : r.flags1c)) >>> 0);
      if (r.position) v4(Q + 0xc0, r.position);
    }
    // A PLAYER WEAPON'S requester (the Armor Viewer, 2026-09-28; uPlayerQuest08's 0x11a40f4 read in full): no position and
    // no scale, but two OVERRIDES in +0x14's mask -- bit 5 (0x20) with the ROOT JOINT at +0x52 (u16; the sword aura hangs
    // from the weapon unit's joint 0 whatever joint its record names) and bit 17 (0x20000) with a COLOUR at +0x80 (a u32 as
    // a colour-control entry stores it, R G B A little-endian), the phial's tint from the FIXED table (resident pec_001). This is
    // the Armor Viewer's addition to the Monster Viewer's proof.js; it belongs upstream with the next sync.
    if (requester && requester.rootJoint != null){
      m.w32(Q + 0x14, (m.u32(Q + 0x14) | 0x20) >>> 0);
      m.w16(Q + 0x52, requester.rootJoint & 0xffff);
    }
    if (requester && requester.colour != null){
      m.w32(Q + 0x14, (m.u32(Q + 0x14) | 0x20000) >>> 0);
      m.w32(Q + 0x80, requester.colour >>> 0);
    }
    // The SECOND override word: a burst shell's colour (uShellPlw08_000's 0x473ff4 sets +0x18 bit 6 with the colour at
    // +0x94; the mask walker 0x31bbe8's second loop copies it to the effect's params +0x84). Same source and licence as above.
    if (requester && requester.colour2 != null){
      m.w32(Q + 0x18, (m.u32(Q + 0x18) | 0x40) >>> 0);
      m.w32(Q + 0x94, requester.colour2 >>> 0);
    }
    // THE OFFSET OVERRIDE: +0x14 bit 0 with a vector at +0x20 (w 0), the mask walker 0x31bbe8's first field (copied into
    // the effect's params +0x10 in place of the record's offset). The Heavy Bowgun's Art (uPlayerQuest04 act 79,
    // 0x1182164) sets (0, y, 0) by the gun model (its vtable +0x894). Same source and licence as above.
    if (requester && requester.offset){
      m.w32(Q + 0x14, (m.u32(Q + 0x14) | 1) >>> 0);
      for (let k = 0; k < 3; k++) m.wf32(Q + 0x20 + 4 * k, requester.offset[k]);
      m.w32(Q + 0x2c, 0);
    }
    if (requester && !requester.positionOnly && (requester.scale || requester.rotationDeg != null || requester.flags14 != null || requester.type8 != null)){
      const r = requester, v4 = (a, v) => { for (let k = 0; k < 3; k++) m.wf32(a + 4 * k, v[k]); m.w32(a + 12, 0); };
      // a rock's shell sets no rotation override (shells-em043.md 9.4 step 6): +0x14 keeps 0x4a10c8's 0x40000000 alone
      const rot = r.rotationDeg != null;
      m.w32(Q + 0x14, (m.u32(Q + 0x14) | (r.flags14 == null ? (rot ? 0x40000002 : 0x40000000) : r.flags14)) >>> 0);
      v4(Q + 0x40, r.scale);
      if (rot) v4(Q + 0x30, r.rotationDeg);
      m.w32(Q + 4, 0); m.w32(Q + 8, r.type8 == null ? 3 : r.type8);
    }
    const C = this.core = malloc(0x350);
    liftedCall(m, 0x41e54, [C]);
    liftedCall(m, 0x328b48, [C, L, 2, idx], [Q + 0x10]);
    liftedCall(m, vslot(m, C, 0xb8), [C, m.u32(Q + 4)]);
    liftedCall(m, vslot(m, C, 0xc0), [C, m.u8(Q + 0xc)]);
    liftedCall(m, vslot(m, C, 0xc8), [C, m.u32(Q + 8)]);
    m.w32(C + 0x1b4, record.key);
    liftedCall(m, 0x42e4c, [C, 0, 2]);
    state.units.unshift([C, 0]);
  }
  // the uMHProofEffects the core has made (+0x150, +0x15c count), then any CHILD LIST effect one of them left
  // when it ended (0x9b6e44): the same core made it (vtable +0x88 = 0x42550 -> ctor 0x43af0, whose +0x374 is
  // the core) and the unit manager has it (0xc04f84), but it never joins the core's array -- the game runs and
  // draws it as a unit of its own, so it is found among the units.
  effects(){
    const m = this.m, core = this.core;
    const out = Array.from({ length: m.u32(core + 0x15c) }, (_, i) => m.u32(core + 0x150 + 4 * i));
    for (const [u] of this.state.units){
      if (m.u32(u) === PROOF_EFFECT_VT && m.u32(u + 0x374) === core && (m.u32(u + 0xc) & 7) !== 3 && !out.includes(u)) out.push(u);
    }
    return out;
  }
  // A one-shot's end, as efx lifecycle runs show it (Teostra's rage burst: its effect's unit goes to state 3
  // at frame 209 and leaves the core's array, the core goes to state 3 three frames later): the core in
  // state 3 with no effect left -- a child list effect included, which outlives the effect that left it.
  finished(){ return (this.m.u32(this.core + 0xc) & 7) === 3 && this.effects().length === 0; }
}

// THE UNIT MANAGER'S SIDE OF A UNIT'S END. A unit in state 3 gets nothing from either pass below, so taking it
// off the list changes nothing a pass does -- but the game's manager DELETES it, and the delete is not
// bookkeeping: an effect's sGpuParticle records own GPU pool 5 blocks (0x86772c takes one, the finalize at
// 0x8676c8 gives it back), so a viewer that only dropped the unit never returned them. Barioth ran the pool out
// 80 motions into one runtime with 54 blocks held and none free, and because live.js fails a monster's WHOLE
// effect set at the first refusal, that reads as the effects simply stopping -- which is what Raven saw on Khezu
// ("effects also play one or two times then stop rendering"). 400 units reach state 3 in one of his soaks.
//   SLOT 0, not slot 1. uMHProofEffect's vtable holds the complete destructor at slot 0 (0x43bc0) and the
// DELETING one at slot 1 (0x43c7c) -- the latter ends in the allocator's free (0x7a75a0's vtable +0x34) on the
// object itself, and this runtime's heap is a bump allocator with nothing to free into. The destructor is the
// half that releases what the object owns; the heap half is deliberately not run, and is said so here rather
// than faked. Both are lifted (lift-effects.sh), recorded by efx/proofunit.py's unit pass, which now ends a
// state-3 unit the same way -- that is where the vectors for them come from.
// release() takes a request off the passes altogether -- its core and the effects it has made -- for an effect
// the viewer stops: how the game ends a running effect (a fade, a kill) is not read.
export function pruneUnits(m, state){
  // A FRAME LATE, deliberately. The unit is off the passes as soon as it reaches state 3, but things around it
  // still read it on that frame: schedule.step() drops a finished request straight after this call and
  // Request.finished() reads the core's state and its effect array to decide -- so destroying the core here read
  // its own freed memory the next step and walked off into an image page the export does not carry. The game has
  // no such race (its manager deletes on its own pass, after everyone else has had the frame); waiting one frame
  // is how that ordering is kept without guessing at the manager.
  const keep = [], dead = [];
  for (const e of state.units) ((m.u32(e[0] + 0xc) & 7) !== 3 ? keep : dead).push(e);
  state.units = keep;
  for (const [u] of state.dying || []) destroyUnit(m, u);     // last frame's, now that nothing reads them
  state.dying = dead;
}
export function destroyUnit(m, u){ liftedCall(m, vslot(m, u, 0), [u]); }
// A STOP REQUEST, the way a monster's own code ends a running effect -- Teostra's aura when its switch goes
// off (0xe1108c): 0x329c40(core, 0), which asks the core to stop (vtable +0x9c, 7) unless it is already
// stopping. The effect runs on to its own end (32 frames for the aura) and the core then dies as a
// one-shot does, so the request stays in the passes until finished().
export function stopRequest(m, request){
  liftedCall(m, 0x329c40, [request.core, 0]);
  request.stopped = true;
}
// A STOP AT ONCE, the way the player's effect holder ends a slot's effect when its policy answers 3 or a flag-1
// request takes the slot (0x44bef0, 0x44c210: 0x329c40(core, 1)): the core's own kill (vtable +0xa4) and its state
// byte +0x30 to 2. The request stays in the passes until finished(), as the game's manager deletes it on its own pass --
// destroying its units outright while they still emit left the GPU particle manager drawing a freed object (the Heavy
// Bowgun's Guns Blazing aura replaced at once: 0xb97910, a branch no recording took). (The Armor Viewer, 2026-09-30.)
export function killRequest(m, request){
  liftedCall(m, 0x329c40, [request.core, 1]);
  request.stopped = true;
}
export function releaseRequest(state, request){
  const gone = new Set([request.core, ...request.effects()]);
  state.units = state.units.filter(([u]) => !gone.has(u));
  for (const u of gone) destroyUnit(request.m, u);
}

// One frame of the unit passes over every unit the requests registered (proofunit.py unit_frame).
// between: called after the update pass and before the move pass -- where a shell's move places its effect (the
// shell's move line 18 runs before the effects' line 22 in the move pass, after every update; efx/proofunit.py)
// passes: 'all', or 'move' alone -- for units made between the passes when none ran before them (host.js unitFrame)
export function unitFrame(m, state, between, passes = 'all'){
  state.filters = [];
  // THE DEVICE'S FRAME COUNTER (0x211d120) RUNS, because the ROM's own arithmetic is relative to it and a counter
  // that never moves makes that arithmetic meaningless. A GPU buffer's +4 is a fence stamp: the draw writes
  // [0x211d120] + [0x211d124] into it (0x87af3c, 0x8ae2a4) and the release destroys the buffer at once only when
  // the stamp is BELOW the counter (0xb01cac, bridge.js) -- "free me once the GPU has passed the frame I was last
  // drawn in". Left at 0, every buffer the viewer had drawn stamped 0, 0 >= 0 was true, and each went down the
  // deferred-destruction path (0xbbf5b8) the viewer does not read -- so an effect's buffers could never be
  // released. Advanced once a frame, as the device advances it, a buffer last drawn on an earlier frame is due and
  // the ROM destroys it here, which is the path the game takes and the one that is translated.
  //   efx/proofunit.py's unit_frame advances it in the same place, so a recording and the viewer read the same
  // number on the same frame. [0x211d124], the frames in flight, is left at 0: nothing here reads it and the
  // game's value is not read.
  if (passes === 'all') m.w32(0x211d120, (m.u32(0x211d120) + 1) >>> 0);
  if (passes === 'all') for (const [u] of state.units.slice()){             // update pass (0xc044c4)
    m.wf32(u + 0x1c, DT);
    const w = m.u32(u + 0xc);
    if ((w & 7) === 1){ m.w32(u + 0xc, ((w & ~7) | 2) >>> 0); liftedCall(m, vslot(m, u, 0x18), [u]); }
    if ((m.u32(u + 0xc) & 0x407) === 0x402) liftedCall(m, vslot(m, u, 0x24), [u]);
  }
  // PASS 2 (0xc04848), which calls +0x24 AGAIN. The ROM runs THREE unit passes -- their order within a frame is
  // their profiler ids (0xcc861c: 1, 2, 3) -- and this one was not modelled here or in efx/proofunit.py. It has
  // to be, because +0x24 (0x43168) REACHES BOTH a walk of the core's effect array, which calls each entry's vtable
  // +0x128, and a reap of it -- and the walk comes first.
  //   READ OUT PROPERLY 2026-09-25, in two goes, and the second corrects the first. 0x43168 does neither job
  // itself: it is the CORE'S FRAME STEP (clock +0x1ac / +0x1b0 from +0x1c, then a stop through the handle at
  // +0x140), and at 0x431d4 it calls 0x328ea8 when byte +0x1a0 has bit 1 set. Inside 0x328ea8, in this order:
  //     the DISPATCH on byte [core+0x30] through vtable +0x90 / +0x94 / +0x98 -- which is how 0x329874 runs, and
  //       its loop at 0x3298ec reads core+0x150 + 4i and does `ldr r1,[r1,#0x128]` / `blx r1` at 0x329900 (that
  //       function has no direct callers; it is only ever reached through this vtable)
  //     then the REAP at 0x328fa0, gated on byte [core+0x158]: for each i it reads core+0x154 + 4i, and where the
  //       entry's state `(+0xc & 7) - 1` is 2 or more -- i.e. not 1 and not 2 -- it clears the slot, shuffles the
  //       tail down and decrements the count at core+0x15c (0x329010).
  //   An intermediate version of this comment claimed 0x328ea8 was "a state machine, not a reap" and that the
  // reap did not exist. That was wrong and is the reason this now cites line numbers. STILL NOT READ: the walk
  // reads core+0x150 + 4i for the +0x128 call and core+0x154 + 4i for a +0x88 call, while the reap only touches
  // the +0x154 words -- whether those are one array read at two offsets or two arrays is not established here,
  // and it is the obvious place to look for why the hold-175 case below still dies.
  // An effect created and destroyed inside ONE frame leaves a state-3 corpse that the next walk reaches, and by
  // then its destructor has wound the vtable back down to the base cUnit 0x17828bc, whose group ends at +0x120 --
  // so +0x128 reads 0, `blx 0` runs the static initialisers, they re-register DTIs and the registry walk at
  // 0x7abfb8 never returns. Under the recorder that reads as "instruction budget exhausted" at pc 0 and no budget
  // finishes it (400M instructions, 40 minutes, on Gravios's u 241).
  //   It is here as well as in the recorder ON PURPOSE: the byte-exact checks compare what this produces against
  // what the recorder produced, so a pass in one and not the other would make every vector set disagree with the
  // runtime that is supposed to reproduce it. Raven, 2026-09-25: "we want to be as close to the ROM as possible."
  if (passes === 'all') for (const [u] of state.units.slice()){
    if ((m.u32(u + 0xc) & 0x407) === 0x402) liftedCall(m, vslot(m, u, 0x24), [u]);
  }
  if (between) between();
  for (const [u] of state.units.slice()){                                   // move pass
    const w = m.u32(u + 0xc);
    if ((w & 7) === 1){
      m.w32(u + 0xc, ((w & ~7) | 2) >>> 0);
      liftedCall(m, vslot(m, u, 0x18), [u]);
      if ((m.u32(u + 0xc) & 0x407) === 0x402){ liftedCall(m, vslot(m, u, 0x24), [u]); liftedCall(m, vslot(m, u, 0x2c), [u]); }
    }
    if ((m.u32(u + 0xc) & 0x407) === 0x402) liftedCall(m, vslot(m, u, 0x28), [u]);
  }
}
