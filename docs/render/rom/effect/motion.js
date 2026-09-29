// BASE PARTICLE MOTION and the per-frame tick that drives it.
//
// Translated from MHGU and checked against call vectors from the game's own run of Savage's
// em043_05_002_s (dev/effect-check.mjs).
//
// Particle header (every generator type):
//   +0x00 prev   +0x04 next   +0x08 u16 index   +0x0c flags   +0x14 age in frames
//   +0x20 / +0x30  position, two buffers: bit 24 of +0x0c selects the current one, bit 25 the previous
// Update slot (per particle, in the generator's pool at +0xc8 + index * stride):
//   +0x00..+0x08 last motion direction   +0x10 motion mode (low 2 bits)   +0x44 motion flags
//   +0x50 local offset   +0x70 scratch (saved and restored around the previous-frame evaluation)
//   +0x80 the particle's random vector, which scales every curve key's range
import { Unverified, F } from './mem.js';
import { curveTime, curveTimeFromHeader, evalCurve3, toWorld } from './curve.js';
import { lifePass } from './life.js';
import { liftedCall } from './bridge.js';
import './lifted-motion.js';

// 0xa637c8: place a particle on its generator's position curve (col3 +0x70), in world space.
// `mode` is 1 for the spawn-time call and 0 per frame. Returns 1 to keep the particle.
export function updateMotion(m, gen, p, upd, mode){
  const kind = m.u32(upd + 0x10) & 3;
  if (kind === 0) return 1;
  if (kind === 3) throw new Unverified('0xa63800 motion kind 3');
  if (!(m.u8(upd + 0x44) & 1)) throw new Unverified('0xa63814 motion without curve flag');
  const fl = m.u32(p + 0x0c);
  const prevBuf = p + 0x20 + ((fl >>> 21) & 0x10), curBuf = p + 0x20 + ((fl >>> 20) & 0x10);
  // locals, as the ROM keeps them on its stack: prev (sp+0x60), cur (sp+0x50), local point (sp+0x40)
  const prev = [m.u32(prevBuf), m.u32(prevBuf + 4), m.u32(prevBuf + 8)];
  const cur = [m.u32(curBuf), m.u32(curBuf + 4), m.u32(curBuf + 8)];
  let sb = 0;
  const col3 = m.u32(gen + 0x3c);
  const off = m.u32(col3 + 0x70);
  if (off === 0) throw new Unverified('0xa63914 no position curve');
  const curveA = col3 + off;
  const scratch = new Scratch(m);
  const status = scratch.alloc(4); m.w32(status, 0);
  const local = scratch.alloc(16);
  evalCurve3(m, local, curveA, curveTime(m, gen, curveA, p), upd + 0x80, status);
  if (m.u32(status) === 3) sb = 0x400;
  const node = m.u32(gen + 0x18);
  const worldPrev = scratch.alloc(16), worldCur = scratch.alloc(16);
  m.w32(worldPrev, prev[0]); m.w32(worldPrev + 4, prev[1]); m.w32(worldPrev + 8, prev[2]); m.w32(worldPrev + 12, 0);
  const nodeTracks = (m.u32(node + 0x110) & 0x80) || (m.u8(gen + 0x43) & 0x20);
  if (nodeTracks){                                           // 0xa63954
    const s70 = m.u32(upd + 0x70), s74 = m.u32(upd + 0x74), s78 = m.u32(upd + 0x78);
    if (m.u8(upd + 0x44) & 0x10) throw new Unverified('0xa63978 motion flag 0x10');
    if (m.u32(col3 + 0x70) === 0) throw new Unverified('0xa63a6c no position curve (previous)');
    const t2 = curveTimeFromHeader(m, gen, curveA, p);
    const localPrev = scratch.alloc(16);
    evalCurve3(m, localPrev, curveA, t2, upd + 0x80, 0);
    toWorld(m, gen, upd, localPrev, worldPrev);
    m.w32(upd + 0x70, s70); m.w32(upd + 0x74, s74); m.w32(upd + 0x78, s78); m.w32(upd + 0x7c, 0);
  }
  if (mode === 1) throw new Unverified('0xa63ad0 spawn-time motion');
  if (m.u32(upd + 0x44) & 0x10) throw new Unverified('0xa63af8 motion flag 0x10');
  toWorld(m, gen, upd, local, worldCur);                     // 0xa63bac
  if ((m.u32(upd + 0x10) & 3) === 1) throw new Unverified('0xa63bd4 motion kind 1');
  const c40 = m.u32(col3 + 0x40);                            // 0xa63c2c
  if (sb & 0x400){
    if (c40 & 0x200) throw new Unverified('0xa63c44 curve end kills');
    sb |= (c40 >>> 9) & 2;
  }
  if (c40 & 0xff) throw new Unverified('0xa63c5c col3 +0x40 low byte');
  let ip, r3;
  let s2, s4, s0;
  if ((m.u32(m.u32(gen + 0x18) + 0x110) & 0x80) || (m.u8(gen + 0x43) & 0x20)){   // 0xa63d20
    ip = m.u32(p + 8); r3 = m.u32(p + 0xc);
    const pb = p + 0x20 + ((r3 >>> 21) & 0x10);
    m.w32(pb, m.u32(worldPrev)); m.w32(pb + 4, m.u32(worldPrev + 4)); m.w32(pb + 8, m.u32(worldPrev + 8)); m.w32(pb + 12, 0);
    s2 = m.f32(worldPrev); s4 = m.f32(worldPrev + 4); s0 = m.f32(worldPrev + 8);
  } else {                                                   // 0xa63d08
    s2 = m.f32(worldPrev); s4 = m.f32(worldPrev + 4); s0 = m.f32(worldPrev + 8);
    ip = m.u32(p + 8); r3 = m.u32(p + 0xc);
  }
  const cb = p + 0x20 + ((r3 >>> 20) & 0x10);                // 0xa63d60
  m.w32(cb, m.u32(worldCur)); m.w32(cb + 4, m.u32(worldCur + 4)); m.w32(cb + 8, m.u32(worldCur + 8)); m.w32(cb + 12, 0);
  s2 = F(m.f32(worldCur) - s2);
  s4 = F(m.f32(worldCur + 4) - s4);
  s0 = F(m.f32(worldCur + 8) - s0);
  let s8 = F(s4 * s4);
  s8 = F(s8 + F(s2 * s2));
  s8 = F(s8 + F(s0 * s0));
  if (s8 > 1.1920928955078125e-07){                          // literal 0xa63ef8
    m.w32(upd + 0xc, 0);
    m.wf32(upd, s2); m.wf32(upd + 4, s4); m.wf32(upd + 8, s0);
    ip = m.u32(p + 8); r3 = m.u32(p + 0xc);
  }
  m.w32(p + 8, ip);                                          // 0xa63dd8
  m.w32(p + 0xc, ((((sb | r3) & 0xfe7f) | (r3 & 0xffff0000) | 0x180) >>> 0));
  scratch.free();
  return 1;
}

// The per-frame tick, one per motion kind (generator +0x40 bits 20..23): 0xa5ffb0 kind 0 (placed on
// the node), 0xa60600 kind 5 (on a position curve), 0xa609c8 kind 10 (velocity and gravity). Each one,
// for every live particle: swap the two position buffers (the new current buffer starts as a copy of
// the old one), reset the low flag word to the generator's +0xde, age it by one frame, then run the
// kind's placement; a particle the placement rejects would be freed (never recorded, so refused).
function tickWith(m, gen, place, where){
  let p = m.u32(gen + 0xb0);
  while (p){
    const fl = (m.u32(p + 0xc) ^ 0x3000000) >>> 0;
    const w8 = m.u32(p + 8);
    const low = m.u16(gen + 0xde);
    const src = p + 0x20 + ((fl >>> 21) & 0x10), dst = p + 0x20 + ((fl >>> 20) & 0x10);
    m.w32(dst, m.u32(src)); m.w32(dst + 4, m.u32(src + 4)); m.w32(dst + 8, m.u32(src + 8)); m.w32(dst + 12, 0);
    m.w32(p + 0xc, ((fl & 0xffff0000) | low) >>> 0);
    m.w32(p + 8, w8);
    m.w32(p + 0x14, (m.u32(p + 0x14) + 1) >>> 0);
    const upd = (m.u32(gen + 0x24) + m.u32(gen + 0xc8) + m.u16(gen + 0xda) * (w8 & 0xffff)) >>> 0;
    if (place(m, gen, p, upd, 0) === 1){ p = m.u32(p + 4); continue; }
    throw new Unverified(where + ' placement rejected a particle');
  }
}
export const tick = (m, gen) => tickWith(m, gen, updateMotion, '0xa606c0');                // 0xa60600
export const tickStatic = (m, gen) => tickWith(m, gen, placeStatic, '0xa60070');           // 0xa5ffb0
export const tickVelocity = (m, gen) => tickWith(m, gen, integrateVelocity, '0xa60a84');   // 0xa609c8
export const tickKind2 = (m, gen) => tickWith(m, gen, (mm, g, p, upd) => motionKind2(mm, g, p, upd, 1), '0xa602f4');   // 0xa60234

// 0xa6243c: motion kind 2 -- velocity with gravity like kind 10, with more options. LIFTED
// (lifted-motion.js): a particle spawned from a node that tracks a parent joint (update +0x44 bits 0x400,
// 0x100, 0x200) follows it here, which only a run with a parent reaches. `mode` is 1 from the tick.
export function motionKind2(m, gen, p, upd, mode){
  return liftedCall(m, 0xa6243c, [gen, p, upd, mode]).r[0];
}

// 0xa61a3c: motion kind 0. The particle sits at the node's matrix applied to its update slot's +0x20
// offset (scaled by node +0xe0); both position buffers get the point.
export function placeStatic(m, gen, p, upd, mode){
  const fl = m.u32(p + 0xc);
  const w8 = m.u32(p + 8);
  const cur = p + ((fl >>> 20) & 0x10);
  m.u32(cur + 0x20); m.u32(cur + 0x24); m.u32(cur + 0x28);
  if (m.u32(m.u32(gen + 0x28) + 0x1c) !== 0) throw new Unverified('0xa61ab0 list entry +0x1c transform');
  const node = m.u32(gen + 0x18);
  let s2 = m.f32(upd + 0x24), s0 = m.f32(upd + 0x20), s4 = m.f32(upd + 0x28);
  let s8 = m.f32(node + 0xe4), s6 = m.f32(node + 0xe0), s10 = m.f32(node + 0xe8);
  let s3 = m.f32(node + 0x14), s7 = m.f32(node + 0x10), s12 = m.f32(node + 4), s14 = m.f32(node + 8);
  let s1 = m.f32(node), s5 = m.f32(node + 0x18), s9 = m.f32(node + 0x20);
  s2 = F(s2 * s8); s0 = F(s0 * s6); s4 = F(s4 * s10);
  s6 = F(s2 * s7); s8 = F(s2 * s3);
  s3 = m.f32(node + 0x24); s7 = m.f32(node + 0x28);
  s10 = F(s2 * s5);
  s8 = F(s8 + F(s0 * s12));
  s10 = F(s10 + F(s0 * s14));
  s6 = F(s6 + F(s0 * s1));
  s2 = m.f32(node + 0x30); s12 = m.f32(node + 0x34); s14 = m.f32(node + 0x38);
  s6 = F(s6 + F(s4 * s9));
  s8 = F(s8 + F(s4 * s3));
  s10 = F(s10 + F(s4 * s7));
  s0 = F(s2 + s6);
  s4 = F(s14 + s10);
  s2 = F(s12 + s8);
  if (m.u8(upd + 0x33) & 1){                                 // 0xa61bb0
    m.w32(p + 8, w8); m.w32(p + 0xc, (fl | 0x80) >>> 0);
  }
  m.wf32(p + 0x20, s0); m.wf32(p + 0x24, s2); m.wf32(p + 0x28, s4); m.w32(p + 0x2c, 0);
  m.wf32(p + 0x30, s0); m.wf32(p + 0x34, s2); m.wf32(p + 0x38, s4); m.w32(p + 0x3c, 0);
  if (mode !== 0) throw new Unverified('0xa61ccc spawn-time static placement');
  if ((m.u32(upd + 0x10) & 3) === 1) throw new Unverified('0xa61cf0 motion kind 1');
  return 1;
}

// 0xa646f4: motion kind 10. position += velocity - accumulated gravity; then velocity (+0x50) and
// +0x20 are multiplied by the damping at +0x24 and the accumulator (+0x2c) grows by +0x28. The last
// motion direction (+0x00) is kept when the step is longer than the ROM's epsilon.
export function integrateVelocity(m, gen, p, upd){
  const r1 = m.u32(upd + 0x10);
  const k = r1 & 3;
  if (k === 0) return 1;
  if (k === 3) throw new Unverified('0xa64724 motion kind 3');
  const cur = p + 0x20 + ((m.u8(p + 0xf) & 1) << 4);
  let s6 = m.f32(cur), s10 = m.f32(cur + 4), s12 = m.f32(cur + 8);
  const s0 = m.f32(upd + 0x2c), s2 = m.f32(upd + 0x54), s4 = m.f32(upd + 0x50);
  const r2 = m.u32(upd + 0x58);
  const s14 = F(s2 - s0);
  const s8 = F(s4 + s6);
  s6 = m.f32(upd + 0x58);
  s12 = F(s6 + s12);
  let s1 = F(s14 * s14);
  s1 = F(s1 + F(s4 * s4));
  s10 = F(s14 + s10);
  s1 = F(s1 + F(s6 * s6));
  if (s1 > 1.1920928955078125e-07){                          // literal 0xa64890
    m.wf32(upd, s4); m.wf32(upd + 4, s14); m.w32(upd + 8, r2); m.w32(upd + 0xc, 0);
  }
  if ((r1 >>> 24) !== 0) throw new Unverified('0xa647ac update slot +0x13');
  const damp = m.f32(upd + 0x24);                            // 0xa647f4
  m.wf32(upd + 0x20, F(damp * m.f32(upd + 0x20)));
  m.wf32(upd + 0x50, F(damp * s4));
  m.wf32(upd + 0x54, F(damp * s2));
  m.wf32(upd + 0x58, F(damp * s6));
  m.wf32(upd + 0x2c, F(m.f32(upd + 0x28) + s0));
  const w8 = m.u32(p + 8), wc = m.u32(p + 0xc);
  const dst = p + 0x20 + ((wc >>> 20) & 0x10);
  m.wf32(dst, s8); m.wf32(dst + 4, s10); m.wf32(dst + 8, s12); m.w32(dst + 0xc, 0);
  if (m.u32(upd + 0x44) & 0x100) throw new Unverified('0xa64868 update slot +0x44 bit 8');
  m.w32(p + 8, w8);
  m.w32(p + 0xc, (wc | 0x180) >>> 0);
  return 1;
}

// 0xa5fdf0: the base per-frame update every generator type runs before its own particle pass.
// Returns 1 while the generator has live particles.
export function baseFrame(m, gen){
  const d0 = m.u16(gen + 0xd0);
  const d4 = m.u32(gen + 0xd4), d8 = m.u32(gen + 0xd8), dc = m.u32(gen + 0xdc), e0 = m.u32(gen + 0xe0);
  const e4 = m.u32(gen + 0xe4), e8 = m.u32(gen + 0xe8), ec = m.u32(gen + 0xec);
  m.w32(gen + 0xd0, d0);                                     // the high half of +0xd0 is cleared
  m.w32(gen + 0xd4, d4); m.w32(gen + 0xd8, d8); m.w32(gen + 0xdc, dc); m.w32(gen + 0xe0, e0);
  m.w32(gen + 0xe4, e4); m.w32(gen + 0xe8, e8); m.w32(gen + 0xec, ec);
  if (!(m.u8(gen + 0x10) & 4) || m.u32(gen + 0xb0) === 0) return 0;
  const kind = (m.u32(gen + 0x40) >>> 20) & 0xf;
  if (kind === 0) tickStatic(m, gen);
  else if (kind === 2) tickKind2(m, gen);
  else if (kind === 5) tick(m, gen);
  else if (kind === 10) tickVelocity(m, gen);
  else throw new Unverified('0xa5fe60 motion kind ' + kind);
  if (m.u32(gen + 0xb0) === 0) return 0;
  const env = (((m.u32(gen + 0x40) >>> 12) & 0xf) - 1) >>> 0;
  if (env === 0 || env === 1) lifePass(m, gen);
  else if (env <= 7) throw new Unverified('0xa5ff4c envelope kind ' + (env + 1));
  return m.u32(gen + 0xb0) !== 0 ? 1 : 0;
}

// Locals the ROM keeps on its stack. The translation needs addresses for them because the callees
// write through pointers; they live in a reserved page nobody else uses and are never compared.
const SCRATCH_BASE = 0x7e800000;
class Scratch {
  constructor(m){ this.m = m; this.top = SCRATCH_BASE + (Scratch.depth++) * 0x1000; this.at = this.top; }
  alloc(n){ const a = this.at; this.at += (n + 3) & ~3; return a; }
  free(){ Scratch.depth--; }
}
Scratch.depth = 0;
export { Scratch, SCRATCH_BASE };
