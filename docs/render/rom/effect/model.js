// cParticleGeneratorModel: the per-frame particle pass for mesh particles.
//
// Translated from MHGU and checked against call vectors from the game's own run of Savage's
// em043_05_002_s (dev/effect-check.mjs). Model particle fields past the common header (motion.js):
//
//   +0x40 / +0x44  uniform scale, two buffers        +0x48  its rate (integrated by 0xa6746c)
//   +0x60 / +0x70  rotation, two buffers             +0xa0  angular velocity (damped by param +0x118)
//   +0x80 / +0x90  facing direction (normalised motion direction), two buffers
//   +0xb0 anim flags (1 on, 2 loop, 4 reverse, 8 kill at end)   +0xb4 frame count | last index << 16
//   +0xb8 anim counter   +0xbc anim speed   +0xc0 / +0xc4 anim frame, two buffers
//   +0xd0 / +0xe0  per-axis scale, two buffers       +0x110 its velocity (damped by param +0xc0)
//   +0xf0 / +0xf4  colour RGBA, two buffers          +0x104 base colour
//   +0xfc  u16 offset of a scalar channel (value +4/+0xc, velocity +0x14, damping +0x1c)
// Bit 24 of +0x0c selects the current buffer of every pair, bit 25 the previous one.
import { Unverified, F } from './mem.js';
import { baseFrame } from './motion.js';
import { killParticle } from './life.js';
import { curveTime, evalColour, evalCurve3 } from './curve.js';
import { Scratch } from './motion.js';

// VFP float -> signed int (vcvt.s32.f32): toward zero, saturating, NaN to 0.
function toS32(v){
  if (Number.isNaN(v)) return 0;
  if (v >= 2147483647) return 2147483647;
  if (v <= -2147483648) return -2147483648;
  return Math.trunc(v);
}

// 0xa97838: advance the animation counter. Returns 0 when a kill-at-end animation runs out.
export function animStep(m, gen, p){
  const on = m.u8(p + 0xcc);
  const fl = m.u32(p + 0xc);
  const param = m.u32(gen + 0x34);
  if (on === 0) throw new Unverified('0xa978b4 particle +0xcc clear');
  m.u16(param + 0x138);
  const f4 = fl & 4;
  const f10 = m.u32(p + 0x10);
  if (f4) throw new Unverified('0xa97880 particle flag 4');
  if (f10 & 0x80000) throw new Unverified('0xa978bc particle +0x10 bit 19');
  const b0 = m.u32(p + 0xb0), b4 = m.u32(p + 0xb4);
  const last = b4 >>> 16;
  if (!(b0 & 1)) throw new Unverified('0xa978ac animation off');
  let s0 = m.f32(p + 0xb8);
  const s2 = m.f32(p + 0xbc);
  if (b0 & 4) throw new Unverified('0xa97b14 reverse animation');
  s0 = F(s2 + s0);
  m.wf32(p + 0xb8, s0);
  if (!(s0 < F(b4 & 0xffff)) && !Number.isNaN(s0)){         // 0xa97ae4 blt not taken
    if (b0 & 2) throw new Unverified('0xa97b44 looping animation');
    s0 = F(F(last) + 0.9999899864196777);                    // literal 0xa97dd0
    m.wf32(p + 0xb8, s0);
    if (b0 & 8) return 0;
  }
  m.wf32(p + 0xc0 + ((m.u8(p + 0xf) & 1) << 2), s0);        // 0xa97b60
  const f10b = m.u32(p + 0x10);
  if (f10b & 0x1000000) throw new Unverified('0xa97bc4 particle +0x10 bit 24');
  if (f10b & 4) throw new Unverified('0xa97c08 particle +0x10 bit 2');
  const entry = m.u32(gen + 0x28);
  m.f32(p + 0x108); m.u16(p + 0xce);
  m.u32(m.u32(entry + 0x18) + 0x78);
  if (f10b & 0x2000000) throw new Unverified('0xa97c58 particle +0x10 bit 25');
  if (m.f32(p + 0x10c) === 0) return 1;                      // 0xa97c94: no mesh cycling
  throw new Unverified('0xa97ca0 mesh cycling');
}

// 0xa6746c: integrate the uniform scale. next = previous + rate; rate *= param +0x1c; the current
// buffer gets max(floor, next). Returns 0 once next falls below the floor.
export function scaleStep(m, gen, p, floor){
  const f10 = m.u32(p + 0x10);
  if (f10 & 0x100000) throw new Unverified('0xa674e0 scale curve');
  if (!(f10 & 0x100)) return 1;
  const fl = m.u32(p + 0xc);
  const s0 = m.f32(p + 0x48);
  const param = m.u32(gen + 0x34);
  let s2 = m.f32(p + 0x40 + (((fl >>> 25) & 1) << 2));
  const s4 = m.f32(param + 0x1c);
  s2 = F(s0 + s2);
  m.wf32(p + 0x48, F(s0 * s4));
  const out = (floor > s2) ? floor : s2;                     // vselgt: NaN keeps s2
  const ret = (s2 < floor) ? 0 : 1;                          // movwpl
  m.wf32(p + 0x40 + (((fl >>> 24) & 1) << 2), out);
  return ret;
}

// 0xa683f8: rotation += angular velocity, then the velocity is damped.
export function rotStep(m, gen, p, curveOff, damp){
  m.u32(p + 8);
  const fl = m.u32(p + 0xc), f10 = m.u32(p + 0x10);
  if (fl & 8) throw new Unverified('0xa68428 particle flag 3');
  if (f10 & 0x200000) throw new Unverified('0xa68524 rotation curve');
  if (!(f10 & 0x400)) return;
  const v0 = m.f32(p + 0xa0), v1 = m.f32(p + 0xa4), v2 = m.f32(p + 0xa8);
  const prev = p + 0x60 + ((fl >>> 21) & 0x10), cur = p + 0x60 + ((fl >>> 20) & 0x10);
  const a0 = m.f32(prev), a1 = m.f32(prev + 4), a2 = m.f32(prev + 8);
  m.w32(cur + 0xc, 0);
  m.wf32(cur, F(a0 + v0)); m.wf32(cur + 4, F(a1 + v1)); m.wf32(cur + 8, F(a2 + v2));
  if (fl & 0x2000) throw new Unverified('0xa684d8 particle flag 13');
  m.wf32(p + 0xa0, F(damp * m.f32(p + 0xa0)));
  m.wf32(p + 0xa4, F(damp * m.f32(p + 0xa4)));
  m.wf32(p + 0xa8, F(damp * m.f32(p + 0xa8)));
}

// 0xa68c44: a scalar channel at p + off: value += velocity, velocity *= damping, and the value wraps
// by 2 when it passes 2 (both buffers together).
export function channelStep(m, gen, p, rec, off){
  const fl = m.u32(p + 0xc), f10 = m.u32(p + 0x10);
  const r4 = p + off;
  const b25 = (fl >>> 25) & 1, b24 = (fl >>> 24) & 1;
  if (f10 & 0x20000800) throw new Unverified('0xa68c78 channel mode 0x20000800');
  const f10b = m.u32(p + 0x10);
  if (!(f10b & 0x40001000)) return;
  if (f10b & 0x40000000) throw new Unverified('0xa68dbc channel curve');
  if (!(f10b & 0x1000)) return;
  let s0 = m.f32(r4 + 0x14);
  let s2 = m.f32(r4 + 4 + (b25 << 3));
  m.wf32(r4 + 4 + (b24 << 3), F(s2 + s0));
  s0 = m.f32(r4 + 0x14); s2 = m.f32(r4 + 0x1c);
  m.wf32(r4 + 0x14, F(s2 * s0));
  s0 = m.f32(r4 + 4);                                        // 0xa68e0c
  if (s0 > 2.0){
    const s4 = m.f32(r4 + 0xc);
    if (s4 > 2.0){
      m.wf32(r4 + 4, F(s0 + -2.0)); m.wf32(r4 + 0xc, F(s4 + -2.0));
      return;
    }
  }
  if (s0 < -2.0) throw new Unverified('0xa68e48 channel wrap below -2');
}

// 0xa97dd8: the Model's scalar channel pass (particle +0xfc), record from param +0x134.
export function channelPass(m, gen, p){
  const param = m.u32(gen + 0x34);
  const off = m.u16(p + 0xfc);
  let rec = m.u16(param + 0x134);
  if (rec) rec = param + rec;
  channelStep(m, gen, p, rec, off);
  if (m.u32(p + 0xfc) & 0xffff0000) throw new Unverified('0xa97e14 second channel');
}

// 0xa972b8: one Model particle, one frame. Returns 0 to free it.
export function updateModelParticle(m, gen, p){
  m.u32(p + 8);
  const r7 = m.u32(p + 0xc);
  if (r7 & 0x8000000){ if (animStep(m, gen, p) !== 1) return 0; }
  let r6 = m.u32(p + 0x10);                                  // 0xa67304 is an empty function
  if (r6 & 0x20000){                                         // 0xa97314: colour from the curve
    const param = m.u32(gen + 0x34);
    const off = m.u32(param + 0x40) >>> 16;
    const curve = off ? param + off : 0;
    const t = curveTime(m, gen, curve, p);
    const sc = new Scratch(m);
    const out = sc.alloc(4);
    evalColour(m, out, curve, t, m.u16(p + 0x102));
    m.w32(p + 0x104, m.u32(out));
    r6 = (m.u32(p + 0x10) | 2) >>> 0;
    m.w32(p + 0x10, r6);
    sc.free();
  }
  if (!(r7 & 0x40)){                                         // envelope unchanged: base colour
    m.w32(p + 0xf0 + ((m.u8(p + 0xf) & 1) << 2), m.u32(p + 0x104));
  } else {                                                   // 0xa97388
    const g40 = m.u32(gen + 0x40); m.u32(gen + 0x44);
    const mode = (g40 >>> 12) & 0xf;
    let col = m.u32(p + 0x104);
    let ip;
    if (mode === 0) ip = m.u8(p + 0xf);
    else {
      const pool = m.u32(gen + 0x24), lo = m.u32(gen + 0xc4), lsz = m.u16(gen + 0xd8);
      const w8 = m.u32(p + 8), wc = m.u32(p + 0xc);
      ip = wc >>> 24;
      const e = toS32(F(m.f32((pool + lo + lsz * (w8 & 0xffff)) >>> 0) * 256.0));   // literal 0xa976e8
      if (mode <= 8){
        if (0xaa & (1 << mode)){                             // alpha modes 1 3 5 7
          col = ((col & 0x00ffffff) | ((((Math.imul(col >>> 24, e) >>> 8) & 0xff)) << 24)) >>> 0;
        } else if (0x154 & (1 << mode)){                     // colour modes 2 4 6 8
          const g = (Math.imul((col >>> 8) & 0xff, e) & 0xff00) | (col & 0xffff0000);
          const r = (Math.imul(col & 0xff, e) >>> 8) & 0xff;
          const b = (col >>> 16) & 0xff;
          col = (((g | r) & 0xff00ffff) | (((Math.imul(b, e) >>> 8) & 0xff) << 16)) >>> 0;
        }
      }
    }
    r6 = (r6 | 2) >>> 0;
    m.w32(p + 0xf0 + ((ip & 1) << 2), col);
    m.w32(p + 0x10, r6);
  }
  if (r6 & 0x100100){                                        // 0xa97470
    if (scaleStep(m, gen, p, 0.0) !== 1) return 0;           // literal 0xa976ec
    r6 = m.u32(p + 0x10);
  }
  let w8;
  if (r6 & 0x800000){                                        // 0xa9753c: per-axis scale from a curve
    const param = m.u32(gen + 0x34);
    const w130 = m.u32(param + 0x130);
    const curve = (w130 >>> 16) ? param + (w130 >>> 16) : 0;
    const t = curveTime(m, gen, curve, p);
    const sc = new Scratch(m);
    const rnd = sc.alloc(12), out = sc.alloc(16);
    m.w32(rnd, m.u32(p + 0x110)); m.w32(rnd + 4, m.u32(p + 0x114)); m.w32(rnd + 8, m.u32(p + 0x118));
    evalCurve3(m, out, curve, t, rnd, 0);
    const c = p + 0xd0 + ((m.u8(p + 0xf) & 1) << 4);
    w8 = m.u32(p + 8);
    m.w32(c, m.u32(out)); m.w32(c + 4, m.u32(out + 4)); m.w32(c + 8, m.u32(out + 8)); m.w32(c + 0xc, 0);
    r6 = m.u32(p + 0x10);
    sc.free();
  } else {
    w8 = m.u32(p + 8);
    const wc = m.u32(p + 0xc);
    const v0 = m.f32(p + 0x110), v1 = m.f32(p + 0x114), v2 = m.f32(p + 0x118);
    const prev = p + 0xd0 + ((wc >>> 21) & 0x10), cur = p + 0xd0 + ((wc >>> 20) & 0x10);
    const a0 = m.f32(prev), a1 = m.f32(prev + 4), a2 = m.f32(prev + 8);
    m.w32(cur + 0xc, 0);
    m.wf32(cur, F(a0 + v0)); m.wf32(cur + 4, F(a1 + v1)); m.wf32(cur + 8, F(a2 + v2));
    if (r6 & 0x8000){
      const param = m.u32(gen + 0x34);
      m.wf32(p + 0x110, F(m.f32(param + 0xc0) * m.f32(p + 0x110)));
      m.wf32(p + 0x114, F(m.f32(param + 0xc4) * m.f32(p + 0x114)));
      m.wf32(p + 0x118, F(m.f32(param + 0xc8) * m.f32(p + 0x118)));
    }
  }
  if (r6 & 0x200400){                                        // 0xa975b8
    const param = m.u32(gen + 0x34);
    rotStep(m, gen, p, m.u16(param + 0x130), m.f32(param + 0x118));
    w8 = m.u32(p + 8);
  }
  const upd = (m.u32(gen + 0x24) + m.u32(gen + 0xc8) + m.u16(gen + 0xda) * (w8 & 0xffff)) >>> 0;
  const sx = m.f32(upd), sy = m.f32(upd + 4), sz = m.f32(upd + 8);
  let l2 = F(sy * sy);
  l2 = F(l2 + F(sx * sx));
  l2 = F(l2 + F(sz * sz));
  const len = F(Math.sqrt(l2));
  if (Number.isNaN(len)) throw new Unverified('0xa97628 sqrtf fallback');
  let bx, by, bz;
  if (len < 1.1920928955078125e-07){                         // literal 0xa976f0: keep the raw vector
    bx = m.u32(upd); by = m.u32(upd + 4); bz = m.u32(upd + 8);
  } else {
    const s0 = F(1.0 / len);
    const fy = F(s0 * sy), fx = F(s0 * sx), fz = F(s0 * sz);
    bx = bits(fx); by = bits(fy); bz = bits(fz);
  }
  const fl = m.u32(p + 0xc);
  const c = p + ((fl >>> 20) & 0x10);
  m.w32(c + 0x80, bx); m.w32(c + 0x84, by); m.w32(c + 0x88, bz); m.w32(c + 0x8c, 0);
  if ((m.u32(m.u32(gen + 0x18) + 0x110) & 0x80) || (m.u8(gen + 0x43) & 0x20)){
    const pr = p + ((fl >>> 21) & 0x10);
    m.w32(pr + 0x80, bx); m.w32(pr + 0x84, by); m.w32(pr + 0x88, bz); m.w32(pr + 0x8c, 0);
  }
  if (m.u16(p + 0xfc) !== 0) channelPass(m, gen, p);
  return 1;
}

const fb = new Float32Array(1), ub = new Uint32Array(fb.buffer);
function bits(v){ fb[0] = v; return ub[0]; }

// 0xa9718c: the Model generator's particle pass (vtable slot 24). Runs the base frame, then each
// particle, freeing the ones that end; generator +0xd2 counts the particles processed.
export function modelFrame(m, gen){
  if (baseFrame(m, gen) !== 1) return 0;
  let p = m.u32(gen + 0xb0);
  while (p){
    if (updateModelParticle(m, gen, p) === 1) p = m.u32(p + 4);
    else p = killParticle(m, gen, p);
    const d0 = m.u32(gen + 0xd0), d4 = m.u32(gen + 0xd4);
    const rest = [m.u32(gen + 0xd8), m.u32(gen + 0xdc), m.u32(gen + 0xe0), m.u32(gen + 0xe4), m.u32(gen + 0xe8), m.u32(gen + 0xec)];
    m.w32(gen + 0xd0, ((d0 & 0xffff) | (((d0 + 0x10000) >>> 0) & 0xffff0000)) >>> 0);
    m.w32(gen + 0xd4, d4);
    for (let i = 0; i < 6; i++) m.w32(gen + 0xd8 + 4 * i, rest[i]);
  }
  if (m.u8(gen + 0x43) & 0xf) throw new Unverified('0xa97238 generator +0x43 low nibble');
  if (m.u32(gen + 0xcc) !== 0) throw new Unverified('0xa9729c generator +0xcc');
  return 1;
}
