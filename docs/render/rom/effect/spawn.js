// SPAWN: a new particle's starting state.
//
// Translated from MHGU and checked against call vectors from the game's own run of Savage's
// em043_05_002_s (dev/effect-check.mjs). Arithmetic is transcribed register by register.
//
// Two random tables, both 4096 entries, both indexed by a generator counter that every draw site
// increments whether or not the draw is used:
//   0x177beb0 (GOT 0x183b9f8)  f32 in [0, 1)
//   0x1777eb0 (GOT 0x183b9f4)  u32
// The shape sampler uses the ROM sine table at 0x190f568 (GOT 0x18321b8): index = the angle times
// 4096/2pi plus 12582912.0 -- which puts the value in [2^23, 2^24), where a float's low mantissa bits
// ARE the rounded integer -- masked to 12 bits; +0x400 is a quarter turn, i.e. the cosine.
//
// The spawn info block the generator update passes down (+0x00 local offset out, +0x20 envelope out,
// +0x24 spawn fraction, +0x28 mode) is the ROM's stack struct at 0xa57708.
import { Unverified, F, f32bits, bitsf32 } from './mem.js';
import { curveTime, evalCurve3, toWorld, evalColour } from './curve.js';
import { Scratch } from './motion.js';
import { liftedCall } from './bridge.js';

const GOT_FLOAT_RNG = 0x183b9f8, GOT_INT_RNG = 0x183b9f4, GOT_SINE = 0x18321b8;
const GOT_ZERO3 = 0x1831a78, GOT_AXIS_Z = 0x1832184, GOT_ZERO2 = 0x1838eb0;

function toS32(v){
  if (Number.isNaN(v)) return 0;
  if (v >= 2147483647) return 2147483647;
  if (v <= -2147483648) return -2147483648;
  return Math.trunc(v);
}
function toU32(v){ return (Number.isNaN(v) || v <= 0) ? 0 : (v >= 4294967295 ? 4294967295 : Math.trunc(v)); }

// f32 draw: base + table[++counter] * range, counter at gen + off
function drawF(m, gen, off, base, range){
  const c = (m.u32(gen + off) + 1) >>> 0;
  m.w32(gen + off, c);
  const r = m.f32(m.u32(GOT_FLOAT_RNG) + 4 * (c & 0xfff));
  return F(base + F(r * range));
}

// 0xa5b488: a point in the emitter shape (type 1..8). Exercised: 3 box, 5 and 6 the two round shapes.
export function sampleShape(m, out, gen, pidx, shape, divisions, params, mode){
  const zero = m.u32(GOT_ZERO3);
  let s0 = m.f32(zero), s2 = m.f32(zero + 4), s4 = m.f32(zero + 8);
  let s6;
  if (divisions !== 0){
    const r4 = (((shape - 1) >>> 0) < 3) ? divisions + 1 : divisions;
    const rem = (pidx >>> 0) % r4;
    s6 = F(F(rem) / F(divisions >>> 0));
  } else {
    if (mode !== 0) throw new Unverified('0xa5b4e8 shape sampling mode ' + mode);
    const c = (m.u32(gen + 0x48) + 1) >>> 0;
    m.w32(gen + 0x48, c);
    s6 = m.f32(m.u32(GOT_FLOAT_RNG) + 4 * (c & 0xfff));
  }
  const t = (shape - 1) >>> 0;
  if (t <= 7){
    if (mode !== 0) throw new Unverified('0xa5b548 shape sampling mode ' + mode);
    if (t === 2){                                            // 0xa5b624 -> 0xa5ba2c: box
      s0 = m.f32(params);
      const c0 = m.u32(gen + 0x48);
      const tbl = m.u32(GOT_FLOAT_RNG);
      const c1 = (c0 + 1) >>> 0, c2 = (c0 + 2) >>> 0;
      m.w32(gen + 0x48, c1);
      s2 = m.f32(params + 8);
      let s4r = m.f32(tbl + 4 * (c1 & 0xfff));
      m.w32(gen + 0x48, c2);
      s4r = F(s4r + s4r);
      s6 = F(s6 + s6);
      const s12 = m.f32(params + 0x10);
      s4r = F(s4r + -1.0);
      s6 = F(s6 + -1.0);
      let s8 = m.f32(m.u32(GOT_FLOAT_RNG) + 4 * (c2 & 0xfff));
      s0 = F(s0 * s4r);
      s4 = F(s6 * s12);
      s8 = F(s8 + s8);
      s8 = F(s8 + -1.0);
      s2 = F(s2 * s8);
    } else if (t === 4 || t === 5){                          // 0xa5b6e8 / 0xa5b760
      s0 = F(s6 * 6.2831854820251465);
      const c0 = m.u32(gen + 0x48);
      const tbl = m.u32(GOT_FLOAT_RNG);
      const c1 = (c0 + 1) >>> 0, c2 = (c0 + 2) >>> 0;
      m.w32(gen + 0x48, c1);
      const rnd = m.f32(tbl + 4 * (c1 & 0xfff));
      const sine = m.u32(GOT_SINE);
      let a = F(rnd * 1.5707963705062866);
      a = F(12582912.0 + F(a * 651.8986206054688));
      const sinPhi = m.f32(sine + 4 * (f32bits(a) & 0xfff));
      m.w32(gen + 0x48, c2);
      const sine2 = m.u32(GOT_SINE);
      const p4 = m.f32(params + 4), p8 = m.f32(params + 8), pc = m.f32(params + 0xc);
      const p10 = m.f32(params + 0x10), p14 = m.f32(params + 0x14);
      const th = F(12582912.0 + F(s0 * 651.8986206054688));
      const om = F(1.0 - sinPhi);
      const bits = f32bits(th);
      const i0 = bits & 0xfff, i1 = (bits + 0x400) & 0xfff;
      if (t === 4){                                          // 0xa5bb7c
        const s12 = F(p10 + F(om * p14));
        const s6d = F(m.f32(params) + F(om * p4));
        const sinT = m.f32(sine2 + 4 * i0), cosT = m.f32(sine2 + 4 * i1);
        s0 = F(sinT * s6d);
        s4 = F(cosT * s12);
        const r2 = m.f32(m.u32(GOT_FLOAT_RNG) + 4 * (c2 & 0xfff));
        s2 = F(p8 + F(r2 * pc));
      } else {                                               // 0xa5bc50
        const s10 = F(p8 + F(om * pc));
        const s6d = F(m.f32(params) + F(om * p4));
        const sinT = m.f32(sine2 + 4 * i0), cosT = m.f32(sine2 + 4 * i1);
        s2 = F(sinT * s10);
        s0 = F(cosT * s6d);
        const r2 = m.f32(m.u32(GOT_FLOAT_RNG) + 4 * (c2 & 0xfff));
        s4 = F(p10 + F(r2 * p14));
      }
    } else throw new Unverified('0xa5b548 emitter shape ' + shape);
  }
  const s6s = m.f32(gen + 0x160), s8s = m.f32(gen + 0x164), s10s = m.f32(gen + 0x168);   // 0xa5bf18
  m.w32(out + 0xc, 0);
  m.wf32(out, F(s0 * s6s)); m.wf32(out + 4, F(s2 * s8s)); m.wf32(out + 8, F(s4 * s10s));
}

// 0xa59c1c: the spawn point. A sample of the emitter shape, through the node instance's matrix into
// world space; both position buffers get it, the info block gets the local offset.
export function spawnPlace(m, gen, p, upd, info){
  const zero = m.u32(GOT_ZERO3);
  const zx = m.u32(zero), zy = m.u32(zero + 4), zz = m.u32(zero + 8);
  let lx = zx, ly = zy, lz = zz, haveShape = 0;
  const e4 = m.u32(gen + 0xe4);
  const sc = new Scratch(m);
  if (e4 & 0xff0000){
    const g11 = m.u8(gen + 0x11);
    const p8 = m.u32(p + 8);
    const mode = m.u32(info + 0x28);
    if (g11 & 4) throw new Unverified('0xa59d04 generator +0x11 bit 2');
    const node = m.u32(gen + 0x30);
    const out = sc.alloc(16);
    sampleShape(m, out, gen, p8 >>> 16, (e4 >>> 16) & 0xff, e4 & 0xffff, node + 0x60, mode);
    lx = m.u32(out); ly = m.u32(out + 4); lz = m.u32(out + 8);
    haveShape = 1;
  }
  const e4b = m.u32(gen + 0xe4), e8 = m.u32(gen + 0xe8);
  if (e8 & 0xff) throw new Unverified('0xa59d70 generator +0xe8 low byte');
  let dirMode = 0, dx = zx, dy = zy, dz = zz;
  if (e4b & 0xff000000){                                     // 0xa59e14: launch direction from the shape
    const mode = e4b >>> 24;
    if (mode !== 1) throw new Unverified('0xa59e1c spawn direction mode ' + mode);
    const x = bitsf32(lx), y = bitsf32(ly), z = bitsf32(lz);
    let l2 = F(y * y); l2 = F(l2 + F(x * x)); l2 = F(l2 + F(z * z));
    const len = F(Math.sqrt(l2));
    if (Number.isNaN(len)) throw new Unverified('0xa59e50 sqrtf fallback');
    if (!(len >= 1.1920928955078125e-07)) throw new Unverified('0xa59e80 zero-length launch direction');
    const inv = F(1.0 / len);                                // 0xa59f84
    dy = f32bits(F(inv * y)); dx = f32bits(F(inv * x)); dz = f32bits(F(inv * z));
    dirMode = 1;
  }
  if (m.u32(m.u32(gen + 0x28) + 0x1c) !== 0) throw new Unverified('0xa59fc4 list entry +0x1c transform');
  const inst = m.u32(gen + 0x18);
  if (haveShape !== 1) throw new Unverified('0xa5a224 spawn without an emitter shape');
  const s24 = bitsf32(lx), s26 = bitsf32(ly), s22 = bitsf32(lz);   // 0xa5a0c0
  let s0 = m.f32(inst + 0xe0), s2 = m.f32(inst + 0xe4), s4 = m.f32(inst + 0xe8);
  let s6 = m.f32(inst + 0x18), s8 = m.f32(inst + 0x14), s10 = m.f32(inst + 4), s12 = m.f32(inst + 8);
  const s14 = m.f32(inst), s1 = m.f32(inst + 0x10), s3 = m.f32(inst + 0x20), s5 = m.f32(inst + 0x24), s7 = m.f32(inst + 0x28);
  s2 = F(s26 * s2); s0 = F(s24 * s0); s4 = F(s22 * s4);
  s6 = F(s2 * s6); s8 = F(s2 * s8);
  s6 = F(s6 + F(s0 * s12)); s8 = F(s8 + F(s0 * s10));
  s12 = m.f32(inst + 0x38);
  s2 = F(s2 * s1); s2 = F(s2 + F(s0 * s14));
  s10 = m.f32(inst + 0x34); s0 = m.f32(inst + 0x30);
  s2 = F(s2 + F(s4 * s3)); s6 = F(s6 + F(s4 * s7)); s8 = F(s8 + F(s4 * s5));
  const wz = F(s12 + s6), wy = F(s10 + s8), wx = F(s0 + s2);
  const node = m.u32(gen + 0x30);
  if (m.u8(node + 0x7a) & 0x10) throw new Unverified('0xa5a278 node block +0x7a bit 4');
  m.w32(info, lx); m.w32(info + 4, ly); m.w32(info + 8, lz); m.w32(info + 0xc, 0);
  m.wf32(p + 0x20, wx); m.wf32(p + 0x24, wy); m.wf32(p + 0x28, wz); m.w32(p + 0x2c, 0);
  m.wf32(p + 0x30, wx); m.wf32(p + 0x34, wy); m.wf32(p + 0x38, wz); m.w32(p + 0x3c, 0);
  m.w32(upd, dx); m.w32(upd + 4, dy); m.w32(upd + 8, dz); m.w32(upd + 0xc, 0);
  const w8 = m.u32(p + 8), wc = m.u32(p + 0xc);
  const de = m.u16(gen + 0xde);
  m.w16(p + 0xc, de);
  if (dirMode === 1){                                        // 0xa5a530: a launched particle
    m.w32(p + 8, w8);
    m.w32(p + 0xc, ((wc & 0xffff0000) | de | 0x80) >>> 0);
  }
  sc.free();
  return 1;
}

// 0xa5c7b4: the update slot's header: motion mode, flags from the col3 block, a random scale.
export function initUpdSlot(m, gen, upd, info){
  const ip = m.u32(upd + 0x10);
  m.w32(upd + 0x10, (ip & ~0xf0) >>> 0);
  if (m.u32(gen + 0xf0) !== 0) throw new Unverified('0xa5c7d4 generator +0xf0');
  let r3 = (((ip & 0xff00000c) | 2) >>> 0);
  m.w32(upd + 0x10, r3); m.w32(upd + 0x18, 0); m.w32(upd + 0x1c, 0);
  const h = m.u32(m.u32(gen + 0x3c));
  r3 = (((r3 & ~4) | ((((h >>> 1) & 0x3fffffff) & 1) << 2)) ^ 4) >>> 0;
  m.w32(upd + 0x10, r3);
  r3 = ((r3 & 0x00ffffff) | (m.u32(m.u32(gen + 0x3c) + 4) << 24)) >>> 0;
  m.w32(upd + 0x10, r3);
  const mode = m.u32(info + 0x28);
  const col3 = m.u32(gen + 0x3c);
  if (mode !== 0) throw new Unverified('0xa5c9c0 spawn mode ' + mode);
  m.wf32(upd + 0x14, drawF(m, gen, 0x48, m.f32(col3 + 8), m.f32(col3 + 0xc)));
}

// 0x320ed4: rotation matrix from euler angles. Orders 0 to 5 recorded (the order is the jump table at
// 0x320efc: 0 -> 0x320f14, 1 -> 0x321054, 2 -> 0x321100, 3 -> 0x3211ac, 4 -> 0x321260, 5 -> 0x32131c).
export function eulerMatrix(m, out, ang, order){
  const sx = F(Math.sin(m.f32(ang))), sy = F(Math.sin(m.f32(ang + 4))), sz = F(Math.sin(m.f32(ang + 8)));
  const cx = F(Math.cos(m.f32(ang))), cy = F(Math.cos(m.f32(ang + 4))), cz = F(Math.cos(m.f32(ang + 8)));
  const s16 = sx, s18 = sy, s20 = sz, s22 = cx, s24 = cy;
  const s26 = F(s16 * s18);
  let s0 = cz, s2, s4, s6;
  if (order === 0){                                          // 0x320f14
    s2 = F(s24 * s0);
    s4 = F(s20 * s24);
    s6 = F(-s18);
    let s8 = F(s22 * s0);
    m.wf32(out, s2);
    s2 = F(s18 * s0);
    m.wf32(out + 4, s4);
    m.wf32(out + 8, s6);
    s6 = F(s18 * s20);
    m.w32(out + 0xc, 0);
    s8 = F(s8 + F(s16 * s6));
    s4 = F(s16 * s2);
    s4 = F(s4 - F(s20 * s22));
    s2 = F(s22 * s2);
    s2 = F(s2 + F(s16 * s20));
    m.wf32(out + 0x10, s4);
    s4 = F(s16 * s24);
    m.wf32(out + 0x14, s8);
    m.wf32(out + 0x18, s4);
    s4 = F(s6 * s22);
    s4 = F(s4 - F(s16 * s0));
    m.w32(out + 0x1c, 0);
    m.wf32(out + 0x20, s2);
    s0 = F(s22 * s24);
    m.wf32(out + 0x24, s4);
    m.wf32(out + 0x28, s0);
  } else if (order === 2){                                   // 0x321100
    s2 = F(s24 * s0); s2 = F(s2 - F(s26 * s20));
    s4 = F(s26 * s0); s4 = F(s4 + F(s20 * s24));
    s6 = F(s18 * s20);
    m.wf32(out, s2);
    s2 = F(-(s22 * s18));
    m.wf32(out + 4, s4);
    s4 = F(s22 * s0);
    m.wf32(out + 8, s2);
    s2 = F(-(s22 * s20));
    m.w32(out + 0xc, 0);
    m.wf32(out + 0x10, s2);
    s2 = F(s16 * s24);
    m.wf32(out + 0x14, s4);
    s4 = F(s18 * s0);
    m.wf32(out + 0x18, s16);
    m.w32(out + 0x1c, 0);
    s6 = F(s6 - F(s2 * s0));
    s4 = F(s4 + F(s20 * s2));
    s0 = F(s22 * s24);
    m.wf32(out + 0x20, s4);
    m.wf32(out + 0x24, s6);
    m.wf32(out + 0x28, s0);
  } else if (order === 4){                                   // 0x321260
    s4 = F(s16 * s20);
    s2 = F(s24 * s0); s2 = F(s2 + F(s26 * s20));
    s6 = F(s20 * s22);
    s4 = F(s4 * s24); s4 = F(s4 - F(s18 * s0));
    m.wf32(out, s2);
    s2 = F(s16 * s0);
    m.wf32(out + 4, s6);
    m.wf32(out + 8, s4);
    s4 = F(s16 * s24);
    s2 = F(s18 * s2); s2 = F(s2 - F(s20 * s24));
    m.w32(out + 0xc, 0);
    s4 = F(s4 * s0);
    s0 = F(s22 * s0);
    s4 = F(s4 + F(s18 * s20));
    m.wf32(out + 0x10, s2);
    s2 = F(-s16);
    m.wf32(out + 0x14, s0);
    s0 = F(s18 * s22);
    m.wf32(out + 0x18, s4);
    m.w32(out + 0x1c, 0);
    m.wf32(out + 0x20, s0);
    s0 = F(s22 * s24);
    m.wf32(out + 0x24, s2);
    m.wf32(out + 0x28, s0);
  } else if (order === 3){                                   // 0x3211ac
    let s28 = F(s22 * s24);
    s2 = F(s24 * s0);
    s4 = F(s18 * s22);
    s6 = F(s20 * s24);
    let s8 = s26;
    s8 = F(s8 + F(s20 * s28));
    s28 = F(s28 + F(s26 * s20));
    m.wf32(out, s2);
    s2 = F(s20 * s4);
    s4 = F(-s4 + F(s16 * s6));
    s2 = F(s2 - F(s16 * s24));
    s6 = F(s22 * s0);
    m.wf32(out + 4, s8);
    m.wf32(out + 8, s4);
    s4 = F(-s20);
    m.w32(out + 0xc, 0);
    m.wf32(out + 0x10, s4);
    s4 = F(s16 * s0);
    s0 = F(s18 * s0);
    m.wf32(out + 0x14, s6);
    m.wf32(out + 0x18, s4);
    m.w32(out + 0x1c, 0);
    m.wf32(out + 0x20, s0);
    m.wf32(out + 0x24, s2);
    m.wf32(out + 0x28, s28);
  } else if (order === 5){                                   // 0x32131c
    s2 = F(s18 * s0);
    let s8 = F(s22 * s0);
    s6 = F(s16 * s20);
    s4 = F(s24 * s0);
    s0 = F(s16 * s0);
    s2 = F(s16 * s2);
    s2 = F(s2 + F(s20 * s22));
    s6 = F(s6 - F(s18 * s8));
    m.wf32(out, s4);
    s4 = F(-F(s20 * s24));
    m.wf32(out + 4, s2);
    m.wf32(out + 8, s6);
    s2 = F(s16 * s18);
    s6 = F(s18 * s22);
    m.w32(out + 0xc, 0);
    m.wf32(out + 0x10, s4);
    s8 = F(s8 - F(s2 * s20));
    s0 = F(s0 + F(s20 * s6));
    s2 = F(s22 * s24);
    m.wf32(out + 0x14, s8);
    m.wf32(out + 0x18, s0);
    m.w32(out + 0x1c, 0);
    s0 = F(-F(s16 * s24));
    m.wf32(out + 0x20, s18);
    m.wf32(out + 0x24, s0);
    m.wf32(out + 0x28, s2);
  } else if (order === 1){                                   // 0x321054 (first met in the roar's cm202_050 models)
    s2 = F(s24 * s0);
    s4 = F(s16 * s18);
    s6 = F(s20 * s22);
    let s8 = F(s16 * s24);
    const s10 = F(s22 * s0);
    m.wf32(out, s2);
    s2 = F(-F(s18 * s0));                                   // vnmul
    m.wf32(out + 4, s20);
    s0 = F(-F(s16 * s0));                                   // vnmul
    m.wf32(out + 8, s2);
    s2 = s4;
    m.w32(out + 0xc, 0);
    s2 = F(s2 - F(s6 * s24));                               // vmls
    s6 = F(s18 * s22);
    m.wf32(out + 0x10, s2);
    s2 = F(s16 * s20);
    s8 = F(s8 + F(s20 * s6));                               // vmla
    m.wf32(out + 0x14, s10);
    s6 = F(s6 + F(s2 * s24));                               // vmla
    s2 = F(s22 * s24);
    s2 = F(s2 - F(s4 * s20));                               // vmls
    m.wf32(out + 0x18, s8);
    m.w32(out + 0x1c, 0);
    m.wf32(out + 0x20, s6);
    m.wf32(out + 0x24, s0);                                 // the common tail 0x3213c4
    m.wf32(out + 0x28, s2);
  } else throw new Unverified('0x320ef8 euler order ' + order);
  m.w32(out + 0x2c, 0); m.w32(out + 0x30, 0); m.w32(out + 0x34, 0); m.w32(out + 0x38, 0);
  m.wf32(out + 0x3c, 1.0);
}

// 0x9ba918: an axis of the euler rotation. Axis 4 and 6 (the ROM's Z axis 0x1917700) recorded.
export function axisDir(m, out, ang, order, axis){
  const sc = new Scratch(m);
  const mat = sc.alloc(64);
  eulerMatrix(m, mat, ang, order);
  let s2, s4i, s0;
  if (axis === 4 || axis === 6){                             // 0x9ba978: the ROM's Z axis
    const v = m.u32(GOT_AXIS_Z);
    s2 = m.f32(v); s4i = m.f32(v + 4); s0 = m.f32(v + 8);
  } else if (axis === 2){                                    // 0x9ba99c: the ROM's Y axis
    const v = m.u32(0x1832130);
    s2 = m.f32(v); s4i = m.f32(v + 4); s0 = m.f32(v + 8);
  } else if (axis === 5){                                    // 0x9baa24: -Z
    s4i = 0.0; s0 = -1.0; s2 = s4i;
  } else throw new Unverified('0x9ba958 direction axis ' + axis);
  let s12 = m.f32(mat + 0x10), s14 = m.f32(mat + 0x14);
  const s6 = m.f32(mat), s8 = m.f32(mat + 4), s10 = m.f32(mat + 8), s1 = m.f32(mat + 0x18);
  const s3 = m.f32(mat + 0x20), s5 = m.f32(mat + 0x24), s6b = m.f32(mat + 0x28);
  m.w32(out + 0xc, 0);
  s12 = F(s4i * s12); s12 = F(s12 + F(s2 * s6));
  s14 = F(s4i * s14);
  let s4 = F(s4i * s1);
  s14 = F(s14 + F(s2 * s8));
  s4 = F(s4 + F(s2 * s10));
  s12 = F(s12 + F(s0 * s3)); s14 = F(s14 + F(s0 * s5)); s4 = F(s4 + F(s0 * s6b));
  m.wf32(out, s12); m.wf32(out + 4, s14); m.wf32(out + 8, s4);
  sc.free();
}

// 0xa742c0: the launch direction: the chosen axis of an euler rotation, scaled and rotated by the
// node instance (no translation).
export function velDir(m, out, gen, v, upd, flags){
  const sc = new Scratch(m);
  const ang = sc.alloc(16);
  m.w32(ang, m.u32(v)); m.w32(ang + 4, m.u32(v + 4)); m.w32(ang + 8, m.u32(v + 8)); m.w32(ang + 0xc, 0);
  const c1 = m.u8(gen + 0xc1), ec = m.u32(gen + 0xec);
  if (c1 & 0x40) throw new Unverified('0xa7431c generator +0xc1 bit 6');
  axisDir(m, out, ang, ec & 0xf, (ec >>> 4) & 0xf);
  if (flags & 0x200){                                        // 0xa74474: scaled by the node, not rotated
    if (flags & 0x80) throw new Unverified('0xa7447c launch flags 0x280');
    const inst = m.u32(gen + 0x18);
    m.wf32(out, F(m.f32(inst + 0xe0) * m.f32(out)));
    m.wf32(out + 4, F(m.f32(inst + 0xe4) * m.f32(out + 4)));
    m.wf32(out + 8, F(m.f32(inst + 0xe8) * m.f32(out + 8)));
    sc.free();
    return;
  }
  if (flags & 0x80) throw new Unverified('0xa743ac launch flag 0x80');
  const inst = m.u32(gen + 0x18);
  let s0 = F(m.f32(inst + 0xe0) * m.f32(out)); m.wf32(out, s0);
  let s2 = F(m.f32(inst + 0xe4) * m.f32(out + 4)); m.wf32(out + 4, s2);
  const s4 = F(m.f32(inst + 0xe8) * m.f32(out + 8)); m.wf32(out + 8, s4);
  let s12 = m.f32(inst + 0x14), s1 = m.f32(inst + 0x10);
  const s6 = m.f32(inst + 4), s8 = m.f32(inst + 8), s10 = m.f32(inst), s14 = m.f32(inst + 0x18);
  const s3 = m.f32(inst + 0x20), s5 = m.f32(inst + 0x24);
  s12 = F(s2 * s12); s12 = F(s12 + F(s0 * s6));
  const s6b = m.f32(inst + 0x28);
  s1 = F(s1 * s2); s1 = F(s1 + F(s10 * s0));
  m.w32(out + 0xc, 0);
  s2 = F(s2 * s14); s2 = F(s2 + F(s0 * s8));
  s1 = F(s1 + F(s4 * s3)); s12 = F(s12 + F(s4 * s5)); s2 = F(s2 + F(s4 * s6b));
  m.wf32(out, s1); m.wf32(out + 4, s12); m.wf32(out + 8, s2);
  sc.free();
}

// 0xa5e99c: spawn motion kind 5 (position curve). Random vector at +0x80, the curve's first point
// through the node into both position buffers.
function spawnMotionCurve(m, gen, p, upd, info){
  const bit = m.u8(p + 0xf) & 1;
  const col3 = m.u32(gen + 0x3c);
  const cur = p + (bit << 4);
  m.u32(cur + 0x20); m.u32(cur + 0x24); m.u32(cur + 0x28);
  m.w16(upd + 0x44, 1);
  for (let k = 0; k < 8; k++) m.w32(upd + 0x50 + 4 * k, m.u32(info + 4 * k));
  const o38 = m.u16(col3 + 0x38);
  if (o38 !== 0) throw new Unverified('0xa5ea1c col3 +0x38 curve');
  if (m.u32(info + 0x28) !== 0) throw new Unverified('0xa5ea94 spawn mode');
  m.wf32(upd + 0x70, drawF(m, gen, 0x48, m.f32(col3 + 0x10), m.f32(col3 + 0x14)));
  m.wf32(upd + 0x74, drawF(m, gen, 0x48, m.f32(col3 + 0x18), m.f32(col3 + 0x1c)));
  const s0 = drawF(m, gen, 0x48, m.f32(col3 + 0x20), m.f32(col3 + 0x24));
  const zero = m.u32(GOT_ZERO3);
  m.wf32(upd + 0x78, s0);
  if (m.f32(upd + 0x70) !== m.f32(zero)) throw new Unverified('0xa5ee24 col3 offset x');
  const zero2 = m.u32(GOT_ZERO3);
  if (m.f32(upd + 0x74) !== m.f32(zero2 + 4)) throw new Unverified('0xa5ee24 col3 offset y');
  if (s0 !== m.f32(zero2 + 8)) throw new Unverified('0xa5ee24 col3 offset z');
  if (m.u32(info + 0x28) !== 0) throw new Unverified('0xa5ee3c spawn mode');
  const c0 = m.u32(gen + 0x48);                              // 0xa5eeac
  const tbl = m.u32(GOT_FLOAT_RNG);
  m.w32(gen + 0x48, (c0 + 1) >>> 0);
  const r0 = m.f32(tbl + 4 * ((c0 + 1) & 0xfff));
  m.w32(gen + 0x48, (c0 + 2) >>> 0);
  const r1 = m.f32(tbl + 4 * ((c0 + 2) & 0xfff));
  m.w32(gen + 0x48, (c0 + 3) >>> 0);
  const r2 = m.f32(tbl + 4 * ((c0 + 3) & 0xfff));
  m.w32(gen + 0x48, (c0 + 4) >>> 0);
  m.u32(m.u32(GOT_INT_RNG) + 4 * ((c0 + 4) & 0xfff));
  const o70 = m.u32(col3 + 0x70);
  if (o70 === 0) throw new Unverified('0xa5ef7c no position curve');
  const curveA = col3 + o70;
  const sc = new Scratch(m);
  m.wf32(upd + 0x80, r0); m.wf32(upd + 0x84, r1); m.wf32(upd + 0x88, r2);
  const local = sc.alloc(16), world = sc.alloc(16);
  evalCurve3(m, local, curveA, curveTime(m, gen, curveA, p), upd + 0x80, 0);
  const c40 = m.u32(col3 + 0x40);
  if ((c40 >>> 16) !== 0) throw new Unverified('0xa5efb8 col3 +0x42 curve');
  const c44 = m.u32(col3 + 0x44);
  if ((c44 >>> 16) !== 0) throw new Unverified('0xa5efe8 col3 +0x44 random range');
  m.w16(upd + 0x46, c44 & 0xffff);
  toWorld(m, gen, upd, local, world);
  const w0 = m.u32(world), w1 = m.u32(world + 4), w2 = m.u32(world + 8);
  m.w32(p + 0x30, w0); m.w32(p + 0x34, w1); m.w32(p + 0x38, w2); m.w32(p + 0x3c, 0);
  m.w32(p + 0x20, w0); m.w32(p + 0x24, w1); m.w32(p + 0x28, w2); m.w32(p + 0x2c, 0);
  sc.free();
}

// 0xa5fb54: spawn motion kind 10 (velocity). A random launch angle picks a direction, a random speed
// scales it into +0x50; +0x20/+0x24/+0x28 get the damping, its own damping and the gravity.
function spawnMotionVelocity(m, gen, p, upd, info){
  const w44 = m.u32(upd + 0x44);
  const col3 = m.u32(gen + 0x3c);
  m.w32(upd + 0x44, (w44 & 0xffff0000) >>> 0);
  if ((m.u32(m.u32(gen + 0x18) + 0x110) & 0x80) || (m.u8(gen + 0x43) & 0x20)) throw new Unverified('0xa5fb9c tracking node');
  if (m.u32(info + 0x28) !== 0) throw new Unverified('0xa5fbb0 spawn mode');
  const tbl = m.u32(GOT_FLOAT_RNG);
  const c0 = m.u32(gen + 0x48);
  const d = [];
  for (let k = 1; k <= 5; k++){
    m.w32(gen + 0x48, (c0 + k) >>> 0);
    d.push(m.f32(tbl + 4 * ((c0 + k) & 0xfff)));
  }
  m.w32(gen + 0x48, (c0 + 6) >>> 0);
  const sc = new Scratch(m);
  const ang = sc.alloc(16), dir = sc.alloc(16);
  m.wf32(ang, F(m.f32(col3 + 0x10) + F(d[0] * m.f32(col3 + 0x14))));
  const tbl2 = m.u32(GOT_FLOAT_RNG);
  const s20 = m.f32(tbl2 + 4 * ((c0 + 6) & 0xfff));
  m.wf32(ang + 4, F(m.f32(col3 + 0x18) + F(d[1] * m.f32(col3 + 0x1c))));
  m.wf32(ang + 8, F(m.f32(col3 + 0x20) + F(d[2] * m.f32(col3 + 0x24))));
  m.w32(ang + 0xc, 0);
  velDir(m, dir, gen, ang, upd, m.u16(p + 0xc));
  const dx = m.u32(dir), dy = m.u32(dir + 4), dz = m.u32(dir + 8);
  const speed = F(m.f32(col3 + 0x28) + F(d[3] * m.f32(col3 + 0x2c)));
  m.wf32(upd + 0x20, speed);
  m.wf32(upd + 0x24, F(m.f32(col3 + 0x40) + F(d[4] * m.f32(col3 + 0x44))));
  const owner = m.u32(gen + 8);
  let g = F(F(m.f32(col3 + 0x30) + F(s20 * m.f32(col3 + 0x34))) * m.f32(owner + 0x1bc));
  m.wf32(upd + 0x28, g);
  if (m.u8(upd + 0x10) & 4){
    g = F(g * m.f32(m.u32(gen + 0x18) + 0xe4));
    m.wf32(upd + 0x28, g);
  }
  m.w32(upd + 0x2c, 0); m.w32(upd + 0x5c, 0);
  m.wf32(upd + 0x50, F(bitsf32(dx) * speed));
  m.wf32(upd + 0x54, F(bitsf32(dy) * speed));
  m.wf32(upd + 0x58, F(bitsf32(dz) * speed));
  m.w16(p + 0xc, (m.u32(p + 0xc) | 0x180) & 0xffff);
  m.w32(upd, dx); m.w32(upd + 4, dy); m.w32(upd + 8, dz); m.w32(upd + 0xc, 0);
  sc.free();
}

// 0xa5d194: spawn motion kind 2. Random launch angles give a direction; then random speed, damping
// and gravity, as for kind 10 but drawn after the direction. LIFTED (lifted-motion.js): from a node that
// tracks a parent joint it also sets the update's tracking flags (+0x44), which only a parented run reaches.
function spawnMotionKind2(m, gen, p, upd, info){
  liftedCall(m, 0xa5d194, [gen, p, upd, info]);
}

// 0xa5a570: spawn motion by kind (generator +0x40 bits 20..23).
export function spawnMotion(m, gen, p, upd, info){
  initUpdSlot(m, gen, upd, info);
  const kind = (m.u32(gen + 0x40) >>> 20) & 0xf;
  if (kind === 0){                                           // 0xa5a5e4
    for (let k = 0; k < 8; k++) m.w32(upd + 0x20 + 4 * k, m.u32(info + 4 * k));
    const pc = m.u32(p + 0xc);
    if (pc & 0x180){                                         // 0xa5a608: a launched static particle
      const node = m.u32(gen + 0x30);
      if (m.u32(info + 0x28) !== 0) throw new Unverified('0xa5a618 spawn mode');
      const speed = drawF(m, gen, 0x48, m.f32(node + 0x80), m.f32(node + 0x84));
      m.wf32(upd, F(m.f32(upd) * speed));
      m.wf32(upd + 4, F(speed * m.f32(upd + 4)));
      m.wf32(upd + 8, F(speed * m.f32(upd + 8)));
      const w30 = m.u32(upd + 0x30), w34 = m.u32(upd + 0x34);
      m.w32(upd + 0x34, w34);
      m.w32(upd + 0x30, ((w30 & ~0x3000000) | ((((pc >>> 7) & 0xff) & 3) << 24)) >>> 0);
      return;
    }
    const w30 = m.u32(upd + 0x30), w34 = m.u32(upd + 0x34);
    m.w32(upd + 0x30, (w30 & ~0x3000000) >>> 0); m.w32(upd + 0x34, w34);
    return;
  }
  if (kind === 2) return spawnMotionKind2(m, gen, p, upd, info);
  if (kind === 5) return spawnMotionCurve(m, gen, p, upd, info);
  if (kind === 10) return spawnMotionVelocity(m, gen, p, upd, info);
  if (kind > 11) return;
  throw new Unverified('0xa5a5b0 spawn motion kind ' + kind);
}

// 0xaea108: the life slot from the col2 block (w0 fade-in, w1 hold, w2 fade-out, w3 high half), and
// the first envelope value. The sustain bit comes from generator +0x40 bit 28.
export function spawnLife(m, gen, p, slot){
  const col2 = m.u32(gen + 0x38);
  let c = (m.u32(gen + 0x48) + 1) >>> 0; m.w32(gen + 0x48, c);
  const f0 = m.u32(col2);
  if (f0 >>> 16) throw new Unverified('0xaea13c random fade-in');
  let A = m.u32(slot + 4), B = m.u32(slot + 8), C = m.u32(slot + 0xc);
  A = ((f0 & 0xffff) | (A & 0xffff0000)) >>> 0;
  m.w32(slot + 4, A); m.w32(slot + 8, B); m.w32(slot + 0xc, C);
  if (((m.u32(col2 + 0xc) >>> 1) & 0x7fff) !== 0) throw new Unverified('0xaea190 col2 +0xc curve');
  c = (m.u32(gen + 0x48) + 1) >>> 0; m.w32(gen + 0x48, c);
  const f1 = m.u32(col2 + 4);
  if (f1 >>> 16) throw new Unverified('0xaea1dc random hold');
  A = m.u32(slot + 4); B = m.u32(slot + 8); C = m.u32(slot + 0xc);
  A = ((A & 0xffff) | ((f1 & 0xffff) << 16)) >>> 0;
  m.w32(slot + 4, A); m.w32(slot + 8, B); m.w32(slot + 0xc, C);
  c = (m.u32(gen + 0x48) + 1) >>> 0; m.w32(gen + 0x48, c);
  const f2 = m.u32(col2 + 8);
  if (f2 >>> 16) throw new Unverified('0xaea290 random fade-out');
  A = m.u32(slot + 4); B = m.u32(slot + 8); C = m.u32(slot + 0xc);
  B = ((f2 & 0xffff) | (B & 0xffff0000)) >>> 0;
  m.w32(slot + 4, A); m.w32(slot + 8, B); m.w32(slot + 0xc, C);
  const owner = m.u32(gen + 8);
  if ((m.u16(owner + 0x11a) & 0xf) !== 2) throw new Unverified('0xaea2e4 owner +0x11a mode');
  const hi = m.u16(col2 + 0xe);                               // 0xaea414
  let C1 = (hi | (C & 0xffff0000)) >>> 0;
  m.w32(slot + 4, A); m.w32(slot + 8, B);
  m.w32(slot + 0xc, C1);
  const sustain = (m.u32(gen + 0x40) >>> 28) & 1;
  m.w32(slot + 4, A); m.w32(slot + 8, B);
  C1 = ((C1 & ~0x1000000) | (sustain << 24)) >>> 0;
  m.w32(slot + 0xc, C1);
  let env;
  if (A & 0xffff){                                           // fade-in first
    C1 = ((C1 & 0xff00ffff) | 0x10000) >>> 0;
    m.w32(slot + 4, A); m.w32(slot + 8, B & 0xffff);
    env = F(1.0 / F(((A & 0xffff) + 1) | 0));
  } else {
    if (A & 0xffff0000){                                     // 0xaea490: straight into the hold
      C1 = ((C1 & 0xff00ffff) | 0x20000) >>> 0;
      m.w32(slot + 4, A); m.w32(slot + 8, B);
      m.w32(slot + 0xc, C1);
      m.w32(slot + 4, A); m.w32(slot + 8, ((B & 0xffff) | (A & 0xffff0000)) >>> 0);
      m.w32(slot + 0xc, C1);
      m.wf32(slot, 1.0);
      return;
    }
    C1 = ((C1 & 0xff00ffff) | 0x30000) >>> 0;                // straight to the fade-out
    m.w32(slot + 4, A);
    m.w32(slot + 8, ((((B & 0xffff) << 16) & 0xffff0000) | (B & 0xffff)) >>> 0);
    m.w32(slot + 0xc, C1);
    if ((B & 0xffff) === 0) throw new Unverified('0xaea504 no fade-out');
    env = 1.0;
  }
  m.w32(slot + 0xc, C1);
  m.wf32(slot, env);
}

// 0xa59a5c: the spawn every generator type shares -- place, motion, life -- and the envelope handed
// back in the info block.
export function spawnBase(m, gen, p, info){
  const upd = (m.u32(gen + 0x24) + m.u32(gen + 0xc8) + m.u16(gen + 0xda) * m.u16(p + 8)) >>> 0;
  if (spawnPlace(m, gen, p, upd, info) !== 1) return 0;
  spawnMotion(m, gen, p, upd, info);
  const env = (((m.u32(gen + 0x40) >>> 12) & 0xf) - 1) >>> 0;
  const slotOf = () => (m.u32(gen + 0x24) + m.u32(gen + 0xc4) + m.u16(gen + 0xd8) * m.u16(p + 8)) >>> 0;
  if (env === 0 || env === 1) spawnLife(m, gen, p, slotOf());
  else if (env <= 7) throw new Unverified('0xa59ae8 envelope kind ' + (env + 1));
  if (m.u8(gen + 0x43) & 0x40){
    const s = slotOf();
    const v = m.f32(s);
    m.wf32(s, F(v * v));
  }
  m.w32(info + 0x20, m.u32(slotOf()));
  return 1;
}

// 0xb460c8: the mesh whose part id (the .mod mesh record's +4, low 12 bits) matches.
export function meshByPart(m, model, part){
  const n = m.u32(model + 0x78);
  if (n === 0) throw new Unverified('0xb460fc model without meshes');
  let rec = m.u32(model + 0x74);
  for (let i = 0; i < n; i++, rec += 0x30) if ((m.u32(rec + 4) & 0xfff) === part) return i;
  throw new Unverified('0xb460fc no mesh with part ' + part);
}

// 0xcabf10: bind an rEffectAnim sequence to the particle's animation fields; returns 1 when there is
// no animation (and clears them).
export function animSetup(m, p, anim, cfg, flag){
  const ip = p + 0xb0;
  if (anim === 0){
    m.w32(ip, 0); m.w32(ip + 4, 1);
    m.w32(p + 0xc8, 0); m.w32(p + 0xc4, 0); m.w32(p + 0xc0, 0); m.w32(p + 0xbc, 0); m.w32(p + 0xb8, 0);
    const wc = m.u32(p + 0xc), w8 = m.u32(p + 8);
    m.w32(p + 8, w8); m.w32(p + 0xc, (wc & ~0x8000000) >>> 0);
    m.w32(p + 0xcc, (m.u32(p + 0xcc) & ~0xff) >>> 0);
    return 1;
  }
  const seq = m.u32(cfg + 4), start = m.u32(cfg + 8);
  const r5 = (m.u16(cfg) | (seq << 16)) >>> 0;
  let s0 = m.f32(cfg + 0xc);
  m.w32(ip, r5);
  const r1 = m.u32(m.u32(anim + 0x6c) + (seq << 5) + 4);
  const frames = r1 & 0xffff;
  const s2 = F(frames);
  const packed = (frames | ((((r1 << 16) >>> 0) - 0x10000) >>> 0)) >>> 0;
  const s4 = F(toS32(F(s0 / s2)));
  m.w32(ip, r5); m.w32(ip + 4, packed);
  m.w32(p + 0xb8, start);
  s0 = F(s0 - F(s2 * s4));
  m.wf32(p + 0xbc, s0);
  const w8v = m.u32(cfg + 8);
  m.w32(p + 0xc4, w8v); m.w32(p + 0xc0, w8v);
  m.w32(p + 0xc8, m.u32(cfg + 0x10));
  const w8 = m.u32(p + 8), wc = m.u32(p + 0xc);
  m.w32(p + 8, w8); m.w32(p + 0xc, (wc | 0x8000000) >>> 0);
  m.w8(p + 0xcc, flag);
  return 0;
}

// 0xa96a70: the Model particle's mesh (by part id, param +0x100) and animation (param +0x138 record).
export function meshAnimInit(m, gen, p){
  const param = m.u32(gen + 0x34);
  const r0 = m.u32(param + 0x138);
  const sbOff = m.u16(param + 0x44);
  m.u32(param + 0x130);
  const anim = m.u32(m.u32(gen + 0x28) + 0x14);
  const rec = (r0 & 0xffff) ? param + (r0 & 0xffff) : 0;
  const sc = new Scratch(m);
  const cfg = sc.alloc(0x14);
  let flags = 0x100000, seq, s0, s2, s16;
  if (anim === 0 || rec === 0){
    s0 = 0.0; flags = 0; seq = 0; s2 = 0.0; s16 = 0.0;       // 0xa96b4c
  } else {
    const c = m.u32(gen + 0x4c);
    const recFlags = m.u16(rec + 0x40);
    if (sbOff !== 0 && (r0 & 0x100000)) throw new Unverified('0xa96af4 animation by channel');
    m.w32(gen + 0x4c, (c + 1) >>> 0);
    const r2 = m.u32(rec + 0x44);
    let start = r2 & 0xffff;
    if (r2 >>> 16){                                          // 0xa96b78: base + u32 random % (range + 1)
      const r = m.u32(m.u32(GOT_INT_RNG) + 4 * ((c + 1) & 0xfff));
      start = (start + (r % ((r2 >>> 16) + 1))) >>> 0;
    }
    s0 = F(start); s16 = 0.0;
    s2 = m.f32(rec + 0x48);
    flags = recFlags;
    m.w32(gen + 0x4c, (m.u32(gen + 0x4c) + 1) >>> 0);
    const r2b = m.u32(rec + 0x40);
    seq = (r2b >>> 16) & 0xff;
    if (r2b >>> 24) throw new Unverified('0xa96c94 random sequence');
  }
  m.w32(cfg, flags); m.w32(cfg + 4, seq); m.wf32(cfg + 8, s0); m.wf32(cfg + 0xc, s2); m.wf32(cfg + 0x10, s16);
  const noAnim = animSetup(m, p, m.u32(m.u32(gen + 0x28) + 0x14), cfg, m.u8(param + 0x13a));
  const w10c = m.u32(param + 0x10c);
  if (w10c & 0x10) throw new Unverified('0xa96d00 param +0x10c bit 4');
  m.w16(p + 0xce, w10c & 0xffff);
  if (sbOff !== 0) throw new Unverified('0xa96d34 param +0x44 channel');
  m.w32(gen + 0x4c, (m.u32(gen + 0x4c) + 1) >>> 0);
  const w100 = m.u32(param + 0x100);
  let part = (w100 >>> 12) & 0x3ff;
  if (w100 >>> 22){                                          // 0xa96d60: base + u32 random % (range + 1)
    const r = m.u32(m.u32(GOT_INT_RNG) + 4 * (m.u32(gen + 0x4c) & 0xfff));
    part = (part + (r % ((w100 >>> 22) + 1))) >>> 0;
  }
  if (w10c & 1) throw new Unverified('0xa96eb0 mesh cycling');
  const s18 = F(part);
  const mesh = meshByPart(m, m.u32(m.u32(gen + 0x28) + 0x18), toU32(s18));
  m.wf32(p + 0x108, s18);
  m.wf32(p + 0x10c, 0.0);
  m.w8(p + 0x100, mesh);
  const w8 = m.u32(p + 8), wc = m.u32(p + 0xc);
  let on;
  if (noAnim === 0) on = true;
  else on = (m.u32(p + 0x10) & 0x1000008) !== 0;
  m.w32(p + 8, w8);
  m.w32(p + 0xc, on ? (wc | 0x8000000) >>> 0 : (wc & ~0x8000000) >>> 0);
  sc.free();
}

// 0xa672dc: +0x50/+0x54/+0x58 from the generator's +0x188 (a unit and its x256 integer).
export function unitScale(m, gen, p){
  let s0 = m.f32(gen + 0x188);
  m.wf32(p + 0x58, s0);
  s0 = F(s0 * 256.0);                                        // literal 0xa67300
  m.w32(p + 0x54, toU32(s0));
  m.w32(p + 0x50, toU32(s0));
}

// 0xa67308: the uniform scale and its rate (param +0x28..+0x34 base/range pairs).
export function scaleInit(m, gen, p, floor){
  const param = m.u32(gen + 0x34);
  const w38 = m.u32(param + 0x38);
  if (w38 >>> 16) throw new Unverified('0xa67338 scale curve');
  const tbl = m.u32(GOT_FLOAT_RNG);
  const c0 = m.u32(gen + 0x4c);
  m.w32(gen + 0x4c, (c0 + 1) >>> 0);
  let s0 = m.f32(param + 0x28);
  const s2 = m.f32(param + 0x2c);
  const s4 = m.f32(tbl + 4 * ((c0 + 1) & 0xfff));
  m.w32(gen + 0x4c, (c0 + 2) >>> 0);
  let s16 = m.f32(param + 0x30);
  const s8 = m.f32(param + 0x34);
  const s6 = m.f32(tbl + 4 * ((c0 + 2) & 0xfff));
  s0 = F(s0 + F(s4 * s2));
  s16 = F(s16 + F(s6 * s8));
  s0 = (floor > s0) ? floor : s0;
  if (!(s16 === 0)) m.w32(p + 0x10, (m.u32(p + 0x10) | 0x100) >>> 0);
  m.wf32(p + 0x40, s0); m.wf32(p + 0x44, s0); m.wf32(p + 0x48, s16);
  return s0;                  // left in s0: the LiteBillboard spawn 0xa7aab4 reads it after the call
}

// 0xa685d4: per-axis scale and its velocity (six base/range draws).
export function axisInit(m, gen, p, outScale, outVel, base, vel, mode){
  if (mode !== 0){                                           // 0xa6860c: per-axis scale from a curve
    const param = m.u32(gen + 0x34);
    const curve = param + mode;
    const c0 = m.u32(gen + 0x4c);
    const tbl = m.u32(GOT_FLOAT_RNG);
    m.w32(gen + 0x4c, (c0 + 1) >>> 0);
    const a = m.u32(tbl + 4 * ((c0 + 1) & 0xfff));
    m.w32(gen + 0x4c, (c0 + 2) >>> 0);
    const b = m.u32(tbl + 4 * ((c0 + 2) & 0xfff));
    m.w32(gen + 0x4c, (c0 + 3) >>> 0);
    const c = m.u32(tbl + 4 * ((c0 + 3) & 0xfff));
    const sc = new Scratch(m);
    const rnd = sc.alloc(12), out = sc.alloc(16);
    m.w32(rnd, a); m.w32(rnd + 4, b); m.w32(rnd + 8, c);
    evalCurve3(m, out, curve, curveTime(m, gen, curve, p), rnd, 0);
    if ((m.u32(curve) | 0) < 0) throw new Unverified('0xa687a8 fixed axis-scale curve');
    m.w32(p + 0x10, (m.u32(p + 0x10) | 0x800000) >>> 0);
    m.w32(outScale, m.u32(out)); m.w32(outScale + 4, m.u32(out + 4)); m.w32(outScale + 8, m.u32(out + 8)); m.w32(outScale + 0xc, 0);
    m.w32(outVel, a); m.w32(outVel + 4, b); m.w32(outVel + 8, c); m.w32(outVel + 0xc, 0);
    sc.free();
    return;
  }
  const tbl = m.u32(GOT_FLOAT_RNG);
  const c0 = m.u32(gen + 0x4c);
  const r = [];
  for (let k = 1; k <= 6; k++){
    m.w32(gen + 0x4c, (c0 + k) >>> 0);
    r.push(m.f32(tbl + 4 * ((c0 + k) & 0xfff)));
  }
  const pick = (blk, i, rr) => F(m.f32(blk + 8 * i) + F(rr * m.f32(blk + 8 * i + 4)));
  const x = pick(base, 0, r[0]), y = pick(base, 1, r[1]), z = pick(base, 2, r[2]);
  const vx = pick(vel, 0, r[3]), vy = pick(vel, 1, r[4]), vz = pick(vel, 2, r[5]);
  m.wf32(outScale, x); m.wf32(outScale + 4, y); m.wf32(outScale + 8, z); m.w32(outScale + 0xc, 0);
  m.wf32(outVel, vx); m.wf32(outVel + 4, vy); m.wf32(outVel + 8, vz); m.w32(outVel + 0xc, 0);
}

// 0xa67de4: rotation and angular velocity (the latter only with generator +0x52 bit 7).
export function rotationInit(m, gen, p, base, vel, mode){
  const zero = m.u32(GOT_ZERO3);
  const zx = m.u32(zero), zz = m.u32(zero + 8), zy = m.u32(zero + 4);
  if (mode !== 0) throw new Unverified('0xa67e30 rotation mode');
  const tbl = m.u32(GOT_FLOAT_RNG);
  const c0 = m.u32(gen + 0x4c);
  const draw = (k) => { m.w32(gen + 0x4c, (c0 + k) >>> 0); return m.f32(tbl + 4 * ((c0 + k) & 0xfff)); };
  const r1 = draw(1), r2 = draw(2), r3 = draw(3);
  const rx = F(m.f32(base) + F(r1 * m.f32(base + 4)));
  const ry = F(m.f32(base + 8) + F(r2 * m.f32(base + 0xc)));
  const rz = F(m.f32(base + 0x10) + F(r3 * m.f32(base + 0x14)));
  const g50 = m.u32(gen + 0x50);
  let ax = zx, ay = zy, az = zz;
  if ((g50 >>> 16) & 0x80){
    if ((g50 >>> 16) & 1) throw new Unverified('0xa67fc4 angular velocity mode');
    const tbl2 = m.u32(GOT_FLOAT_RNG);
    const d = (k) => { m.w32(gen + 0x4c, (c0 + k) >>> 0); return m.f32(tbl2 + 4 * ((c0 + k) & 0xfff)); };
    const q1 = d(4), q2 = d(5), q3 = d(6);
    const vx = F(m.f32(vel) + F(q1 * m.f32(vel + 4)));
    const vy = F(m.f32(vel + 8) + F(q2 * m.f32(vel + 0xc)));
    const vz = F(m.f32(vel + 0x10) + F(q3 * m.f32(vel + 0x14)));
    m.w32(p + 0x10, (m.u32(p + 0x10) | 0x400) >>> 0);
    ax = f32bits(F(1.0 * vx)); ay = f32bits(F(1.0 * vy)); az = f32bits(F(1.0 * vz));
  }
  if (m.u8(gen + 0x52) & 8) throw new Unverified('0xa68154 generator +0x52 bit 3');
  let ox = rx, oy = ry, oz = rz;
  if (m.u8(gen + 0xed) & 8){                                 // 0xa68190: plus the node's orientation
    const sc = new Scratch(m);
    const e = sc.alloc(16);
    nodeEuler(m, e, gen, p);
    ox = F(rx + m.f32(e)); oy = F(ry + m.f32(e + 4)); oz = F(rz + m.f32(e + 8));
    sc.free();
  }
  if (m.u8(gen + 0xc1) & 0x40) throw new Unverified('0xa681d4 generator +0xc1 bit 6');
  m.wf32(p + 0x70, ox); m.wf32(p + 0x74, oy); m.wf32(p + 0x78, oz); m.w32(p + 0x7c, 0);
  m.wf32(p + 0x60, ox); m.wf32(p + 0x64, oy); m.wf32(p + 0x68, oz); m.w32(p + 0x6c, 0);
  m.w32(p + 0xa0, ax); m.w32(p + 0xa4, ay); m.w32(p + 0xa8, az); m.w32(p + 0xac, 0);
}

// 0x72dec: rotation matrix to quaternion (x, y, z, w). Positive-trace case recorded.
export function matToQuat(m, out, mat){
  const m00 = m.f32(mat), m11 = m.f32(mat + 0x14), m22 = m.f32(mat + 0x28);
  let tr = F(m00 + m11); tr = F(tr + m22);
  if (!(tr > 0)){                                            // 0x72e90: from the largest diagonal element
    const NEXT = [1, 2, 0];                                  // the ROM's table at 0x159c504
    const at = (r, c) => mat + 16 * r + 4 * c;
    let i = m11 > m00 ? 1 : 0;
    if (m22 > m.f32(at(i, i))) i = 2;
    const j = NEXT[i], k = NEXT[j];
    let d = F(m.f32(at(i, i)) - m.f32(at(j, j)));
    d = F(d - m.f32(at(k, k)));
    const t = F(d + 1.0);
    const r = F(Math.sqrt(t));
    if (Number.isNaN(r)) throw new Unverified('0x72f0c sqrtf fallback');
    const half = F(r * 0.5), s = F(0.5 / r);
    const q = [out, out + 4, out + 8];
    m.wf32(q[i], half);
    m.wf32(out + 0xc, F(s * F(m.f32(at(j, k)) - m.f32(at(k, j)))));
    m.wf32(q[j], F(s * F(m.f32(at(i, j)) + m.f32(at(j, i)))));
    m.wf32(q[k], F(s * F(m.f32(at(i, k)) + m.f32(at(k, i)))));
    return;
  }
  const r = F(Math.sqrt(F(tr + 1.0)));
  if (Number.isNaN(r)) throw new Unverified('0x72e34 sqrtf fallback');
  const s = F(0.5 / r);
  m.wf32(out + 0xc, F(r * 0.5));
  m.wf32(out, F(s * F(m.f32(mat + 0x18) - m.f32(mat + 0x24))));
  m.wf32(out + 4, F(s * F(m.f32(mat + 0x20) - m.f32(mat + 8))));
  m.wf32(out + 8, F(s * F(m.f32(mat + 4) - m.f32(mat + 0x10))));
}

// 0x7c3a38: rotation matrix to euler angles (order 4). The gimbal cases (|m21| >= 1) are unrecorded.
export function matToEuler(m, out, mat){
  m.w32(out + 0xc, 0);
  const m21 = m.f32(mat + 0x24);
  if (!(m21 < 1.0)) throw new Unverified('0x7c3ab4 euler at +90');
  if (!(m21 > -1.0)) throw new Unverified('0x7c3ad8 euler at -90');
  m.wf32(out + 8, F(-F(Math.atan2(F(-m.f32(mat + 4)), m.f32(mat + 0x14)))));
  m.wf32(out, F(-F(Math.asin(m.f32(mat + 0x24)))));
  m.wf32(out + 4, F(-F(Math.atan2(F(-m.f32(mat + 0x20)), m.f32(mat + 0x28)))));
}

// 0xa6aee0: quaternion to matrix, then to euler angles in the given order (4 recorded).
export function quatToEuler(m, out, q, order){
  const s0q = m.f32(q), s2q = m.f32(q + 4), s4q = m.f32(q + 8), s6 = m.f32(q + 0xc);
  const sc = new Scratch(m);
  const M = sc.alloc(64);
  const s8 = F(s4q + s4q), s10a = F(s2q + s2q);
  const s12 = F(s2q * s10a), s4 = F(s4q * s8);
  const s5 = F(s0q * s10a), s7 = F(s0q * s8), s3a = F(s8 * s6), s10 = F(s10a * s6), s2 = F(s2q * s8);
  let s1 = F(s12 + s4);
  const s9 = F(s5 + s3a), s11 = F(s7 - s10), s3 = F(s5 - s3a);
  s1 = F(1.0 - s1);
  m.wf32(M, s1);
  const x2 = F(s0q + s0q);
  m.wf32(M + 4, s9); m.wf32(M + 8, s11); m.w32(M + 0xc, 0); m.wf32(M + 0x10, s3);
  const xx = F(s0q * x2), xw = F(x2 * s6);
  let t4 = F(xx + s4), t0 = F(xx + s12);
  const t8 = F(s2 + xw), t2 = F(s2 - xw);
  t4 = F(1.0 - t4); t0 = F(1.0 - t0);
  m.wf32(M + 0x14, t4);
  const t4b = F(s7 + s10);
  m.wf32(M + 0x18, t8); m.w32(M + 0x1c, 0); m.wf32(M + 0x20, t4b); m.wf32(M + 0x24, t2); m.wf32(M + 0x28, t0);
  m.w32(M + 0x2c, 0); m.w32(M + 0x30, 0); m.w32(M + 0x34, 0); m.w32(M + 0x38, 0); m.wf32(M + 0x3c, 1.0);
  if (order !== 4) throw new Unverified('0xa6afc0 euler order ' + order);
  matToEuler(m, out, M);                                     // 0xa6b048
  sc.free();
}

// 0xa67988: the node instance's orientation as euler angles (generator +0xe8 top nibble 6).
export function nodeEuler(m, out, gen, p){
  const e8 = m.u32(gen + 0xe8);
  if ((e8 & 0xf000000) !== 0x6000000) throw new Unverified('0xa679c0 orientation source ' + ((e8 >>> 24) & 0xf));
  const sc = new Scratch(m);
  const q = sc.alloc(16);
  matToQuat(m, q, m.u32(gen + 0x18));
  quatToEuler(m, out, q, m.u16(gen + 0xea) & 0xf);
  sc.free();
}

// 0xa6885c: a scalar channel (value, velocity, damping) from its record.
export function channelSetup(m, gen, p, rec, off){
  const r4 = p + off;
  const z = m.u32(GOT_ZERO2);
  const a = m.u32(z), b = m.u32(z + 4);
  m.w32(r4 + 0xc, b); m.w32(r4 + 8, a); m.w32(r4, a); m.w32(r4 + 4, b);
  m.w32(r4 + 0x14, 0); m.w32(r4 + 0x10, 0); m.wf32(r4 + 0x1c, 1.0);
  if (m.u32(rec + 0x30) !== 0) throw new Unverified('0xa688b8 channel curve A');
  let s0 = drawF(m, gen, 0x4c, m.f32(rec), m.f32(rec + 4));
  m.wf32(r4 + 8, s0); m.wf32(r4, s0);
  s0 = drawF(m, gen, 0x4c, m.f32(rec + 0x10), m.f32(rec + 0x14));
  m.wf32(r4 + 0x10, s0);
  if (!(s0 === 0)) m.w32(p + 0x10, (m.u32(p + 0x10) | 0x800) >>> 0);
  if (m.u32(rec + 0x34) !== 0) throw new Unverified('0xa68a74 channel curve B');
  s0 = drawF(m, gen, 0x4c, m.f32(rec + 8), m.f32(rec + 0xc));
  m.wf32(r4 + 0xc, s0); m.wf32(r4 + 4, s0);
  s0 = drawF(m, gen, 0x4c, m.f32(rec + 0x18), m.f32(rec + 0x1c));
  m.wf32(r4 + 0x14, s0);
  if (!(s0 === 0)) m.w32(p + 0x10, (m.u32(p + 0x10) | 0x1000) >>> 0);
  m.w32(r4 + 0x1c, m.u32(rec + 0x20));
  return 0;
}

// 0xa96f78: the Model particle's scalar channel at generator +0xd4 (low half) into particle +0xfc.
export function channelInit(m, gen, p){
  const param = m.u32(gen + 0x34);
  const d4 = m.u32(gen + 0xd4);
  let rec = m.u16(param + 0x134);
  if (rec) rec = param + rec;
  const off = d4 & 0xffff;
  if (channelSetup(m, gen, p, rec, off) === 1) throw new Unverified('0xa96fb8 channel setup failed');
  const fc = m.u32(p + 0xfc), w100 = m.u32(p + 0x100);
  const r6 = ((fc & 0xffff0000) | off) >>> 0;
  const r3 = (w100 & ~0xc00) >>> 0;
  m.w32(p + 0xfc, r6); m.w32(p + 0x100, r3);
  if (m.u32(param + 0x134) & 0xffff0000) throw new Unverified('0xa97000 second channel record');
  m.w32(p + 0xfc, r6 & 0xffff);
  m.w32(p + 0x100, (r3 & 0xfffff0ff) >>> 0);
}

// 0xa68e78: the base colour, generator +0x170 on the recorded path.
export function baseColour(m, out, gen){
  const w = m.u32(gen + 0x194);
  if (w & 0xf) throw new Unverified('0xa68e88 colour source ' + (w & 0xf));
  if (w & 0x20) throw new Unverified('0xa68f4c colour source bit 5');
  m.w32(out, m.u32(gen + 0x170));
}

// 0xa71870: particle +0x0e from generator +0xee.
export function lastPass(m, gen, p){
  const ec = m.u32(gen + 0xec);
  if (ec >= 0x1000000) throw new Unverified('0xa71880 generator +0xef');
  m.w8(p + 0xe, (ec >>> 16) & 0xff);
}

// 0xa965c4 (Model vtable slot 23): spawn one Model particle. Returns particle +0x0c bit 26.
export function spawnModel(m, gen, p, info){
  if (spawnBase(m, gen, p, info) !== 1) return 0;
  const param = m.u32(gen + 0x34);
  meshAnimInit(m, gen, p);
  const r0a = (m.u32(param) >>> 19) & 0x1fe0;
  const f4 = m.u32(gen + 0xf4);
  m.w32(p + 0x18, r0a); m.w32(p + 0x1c, f4); m.w32(p + 0x18, r0a);
  m.w32(p + 0x10, (m.u32(p + 0x10) | 3) >>> 0);
  const nib = (m.u32(param + 0x10c) >>> 20) & 0xf;
  const w100 = ((m.u32(p + 0x100) & ~0xf000) | (nib << 12)) >>> 0;
  const fc = m.u32(p + 0xfc);
  m.w32(p + 0x100, w100);
  m.w32(p + 0xfc, fc);
  m.w32(p + 0xf8, m.u32(param + 0x114));
  unitScale(m, gen, p);
  const sc = new Scratch(m);
  const cbuf = sc.alloc(4);
  const cOff = m.u32(param + 0x40) >>> 16;
  if (cOff !== 0){                                           // 0xa96678: colour from the curve
    const curve = param + cOff;
    const c = (m.u32(gen + 0x4c) + 1) >>> 0;
    m.w32(gen + 0x4c, c);
    const sl = m.u32(m.u32(GOT_INT_RNG) + 4 * (c & 0xfff));
    const t = curveTime(m, gen, curve, p);
    let pick = sl & 0xff;
    if (pick === 0) pick = sl & 0x100;
    evalColour(m, cbuf, curve, t, pick);
    if ((m.u32(curve) | 0) >= 0) m.w32(p + 0x10, (m.u32(p + 0x10) | 0x20000) >>> 0);
    m.w16(p + 0x102, pick);
  } else baseColour(m, cbuf, gen);
  let col = m.u32(cbuf);
  m.w32(p + 0x104, col);
  const mode = (m.u32(gen + 0x40) >>> 12) & 0xf;
  m.u32(gen + 0x44);
  if (mode !== 0){
    const e = toS32(F(m.f32(info + 0x20) * 256.0));         // literal 0xa96a64
    if (mode <= 8){
      if (0xaa & (1 << mode)){
        col = ((col & 0x00ffffff) | (((Math.imul(col >>> 24, e) >>> 8) & 0xff) << 24)) >>> 0;
      } else if (0x154 & (1 << mode)){
        const g = (Math.imul((col >>> 8) & 0xff, e) & 0xff00) | (col & 0xffff0000);
        const r = (Math.imul(col & 0xff, e) >>> 8) & 0xff;
        const b = (col >>> 16) & 0xff;
        col = (((g | r) & 0xff00ffff) | (((Math.imul(b, e) >>> 8) & 0xff) << 16)) >>> 0;
      }
    }
  }
  m.w32(p + 0xf4, col); m.w32(p + 0xf0, col);
  scaleInit(m, gen, p, 0.0);                                 // literal 0xa96a68
  const axisS = sc.alloc(16), axisV = sc.alloc(16);
  axisInit(m, gen, p, axisS, axisV, param + 0x90, param + 0xa8, m.u16(param + 0x132));
  const ax = m.u32(axisS), ay = m.u32(axisS + 4), az = m.u32(axisS + 8);
  m.w32(p + 0xe0, ax); m.w32(p + 0xe4, ay); m.w32(p + 0xe8, az); m.w32(p + 0xec, 0);
  m.w32(p + 0xd0, ax); m.w32(p + 0xd4, ay); m.w32(p + 0xd8, az); m.w32(p + 0xdc, 0);
  m.w32(p + 0x110, m.u32(axisV)); m.w32(p + 0x114, m.u32(axisV + 4)); m.w32(p + 0x118, m.u32(axisV + 8));
  m.w32(p + 0x11c, 0);
  if ((m.u32(param + 0x10c) | 0) < 0) m.w32(p + 0x10, (m.u32(p + 0x10) | 0x8000) >>> 0);
  rotationInit(m, gen, p, param + 0xd0, param + 0xe8, m.u16(param + 0x130));
  const upd = (m.u32(gen + 0x24) + m.u32(gen + 0xc8) + m.u16(gen + 0xda) * m.u16(p + 8)) >>> 0;
  const sx = m.f32(upd), sy = m.f32(upd + 4), sz = m.f32(upd + 8);
  let l2 = F(sy * sy); l2 = F(l2 + F(sx * sx)); l2 = F(l2 + F(sz * sz));
  const len = F(Math.sqrt(l2));
  if (Number.isNaN(len)) throw new Unverified('0xa968c0 sqrtf fallback');
  let bx, by, bz;
  if (len < 1.1920928955078125e-07){                         // literal 0xa96a6c
    bx = m.u32(upd); by = m.u32(upd + 4); bz = m.u32(upd + 8);
  } else {
    const s0 = F(1.0 / len);
    const fy = F(s0 * sy), fx = F(s0 * sx), fz = F(s0 * sz);
    bx = f32bits(fx); by = f32bits(fy); bz = f32bits(fz);
  }
  m.w32(p + 0x80, bx); m.w32(p + 0x84, by); m.w32(p + 0x88, bz); m.w32(p + 0x8c, 0);
  m.w32(p + 0x90, bx); m.w32(p + 0x94, by); m.w32(p + 0x98, bz); m.w32(p + 0x9c, 0);
  if (m.u16(param + 0x134) !== 0) channelInit(m, gen, p);
  else {
    const w = m.u32(p + 0x100);
    m.w32(p + 0xfc, 0);
    m.w32(p + 0x100, (w & ~0xf00) >>> 0);
  }
  if (m.u32(gen + 0xcc) !== 0) throw new Unverified('0xa96968 generator +0xcc');
  if (m.u8(gen + 0x43) & 0xf) throw new Unverified('0xa969e8 generator +0x43 low nibble');
  lastPass(m, gen, p);
  sc.free();
  return (m.u32(p + 0xc) >>> 26) & 1;
}
