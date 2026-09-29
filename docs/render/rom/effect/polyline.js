// cParticleGeneratorLitePolyline (generator type 1): a polyline per particle, its points a template
// from the parameter block (+0x1b0) placed through a per-particle basis.
//
// Translated from MHGU and checked against call vectors from the game's own run of Savage's effects
// (dev/effect-check.mjs). Arithmetic is transcribed register by register. The particle spawn, update and
// frame, the shape init/update dispatch and the basis are LIFTED (lifted-polyline.js, bridge.js): em043_05_000
// takes shape types 0 and 6, colour and width paths the hand translation had refused, and lifting the
// routines whole covers every path any em043 vector reached.
//
// LitePolyline particle fields past the common header (motion.js):
//   +0x40 / +0x44 uniform scale, two buffers       +0x48 its rate
//   +0x60 / +0x68 colour 1, +0x64 / +0x6c colour 2 (two buffers, 8 bytes apart); +0x70 / +0x74 bases
//   +0x78 / +0x7c shape descriptor: +0x7c byte 0 shape type, byte 1 point count, byte 2, bits 24..27,
//                 bits 28..31; +0x9c byte 0 and bits 8..11
//   +0x80 animation (flags, frames, counter +0x88, speed +0x8c); +0x90 / +0x94 frame buffers; +0x98 start
//   +0xa4 / +0xa8 width 1, +0xac / +0xb0 width 2 (two buffers); +0xb4 / +0xb8 and +0xbc / +0xc0 base, rate
// The polyline block sits at particle + generator +0xd4 (u16): the point buffers first (count * 16 each,
// two buffers), then at + count * 32: +0x00 motion direction, +0x10 random vector, +0x20 angular vector,
// +0x30 / +0x40 size (two buffers), +0x50 size velocity. (+0x00 / +0x10 are the rotation, two buffers.)
import { liftedCall } from './bridge.js';
import './lifted-polyline.js';
import { Unverified, F } from './mem.js';
import { Scratch } from './motion.js';

const GOT_FLOAT_RNG = 0x183b9f8, GOT_ZERO3 = 0x1831a78;

function toS32(v){
  if (Number.isNaN(v)) return 0;
  if (v >= 2147483647) return 2147483647;
  if (v <= -2147483648) return -2147483648;
  return Math.trunc(v);
}

// 0x29d00: dst = a * b for 4x4 matrices. Every input is read before the first write, so dst may be a or b.
// 0x1ebe8 (MtMatrix::operator*=) is the same instructions writing through a: matMul below.
export function matMulTo(m, dst, a, b){
  let s0 = m.f32(b + 0xc), s10 = m.f32(b + 0x10), s23 = m.f32(a + 4), s21 = m.f32(a), s14 = m.f32(b);
  let s25 = m.f32(a + 8), s27 = m.f32(a + 0xc), s20 = m.f32(b + 4), s4 = m.f32(b + 8);
  const sp4 = s0;
  let s29 = F(s23 * s10); s29 = F(s29 + F(s21 * s14));
  let s3 = m.f32(b + 0x20), s8 = m.f32(b + 0x30), s30 = m.f32(b + 0x14), s26 = m.f32(b + 0x24);
  let s18 = m.f32(a + 0x20), s22 = m.f32(a + 0x24), s16 = m.f32(a + 0x28), s11 = m.f32(a + 0x2c);
  let s1 = m.f32(a + 0x30), s9 = m.f32(a + 0x34), s6 = m.f32(a + 0x38), s2 = m.f32(a + 0x3c);
  let s17 = m.f32(a + 0x1c), s19 = m.f32(a + 0x18), s31 = m.f32(a + 0x10);
  s0 = m.f32(a + 0x14);
  let s12 = m.f32(b + 0x3c), s5 = m.f32(b + 0x2c), s24 = m.f32(b + 0x1c), s7 = m.f32(b + 0x38);
  let s13 = m.f32(b + 0x28), s28 = m.f32(b + 0x18), s15 = m.f32(b + 0x34);
  s29 = F(s29 + F(s25 * s3)); s29 = F(s29 + F(s27 * s8)); m.wf32(dst, s29);
  s29 = F(s23 * s30); s29 = F(s29 + F(s21 * s20)); s29 = F(s29 + F(s25 * s26)); s29 = F(s29 + F(s27 * s15)); m.wf32(dst + 4, s29);
  s29 = F(s23 * s28); s29 = F(s29 + F(s21 * s4)); s29 = F(s29 + F(s25 * s13)); s29 = F(s29 + F(s27 * s7));
  s23 = F(s23 * s24);
  m.wf32(dst + 8, s29);
  s29 = sp4;
  s23 = F(s23 + F(s21 * s29));
  s21 = F(s10 * s0); s21 = F(s21 + F(s14 * s31));
  s23 = F(s23 + F(s25 * s5));
  s21 = F(s21 + F(s3 * s19));
  s23 = F(s23 + F(s27 * s12));
  s21 = F(s21 + F(s8 * s17));
  m.wf32(dst + 0xc, s23); m.wf32(dst + 0x10, s21);
  s21 = F(s30 * s0); s21 = F(s21 + F(s20 * s31)); s21 = F(s21 + F(s26 * s19)); s21 = F(s21 + F(s15 * s17)); m.wf32(dst + 0x14, s21);
  s21 = F(s28 * s0); s21 = F(s21 + F(s4 * s31));
  s0 = F(s24 * s0); s0 = F(s0 + F(s29 * s31));
  s21 = F(s21 + F(s13 * s19));
  s0 = F(s0 + F(s5 * s19));
  s21 = F(s21 + F(s7 * s17));
  s0 = F(s0 + F(s12 * s17));
  m.wf32(dst + 0x18, s21); m.wf32(dst + 0x1c, s0);
  s0 = F(s10 * s22); s0 = F(s0 + F(s14 * s18)); s0 = F(s0 + F(s3 * s16)); s0 = F(s0 + F(s8 * s11));
  s10 = F(s10 * s9); s10 = F(s10 + F(s14 * s1));
  s14 = F(s24 * s9); s14 = F(s14 + F(s29 * s1));
  s10 = F(s10 + F(s3 * s6));
  m.wf32(dst + 0x20, s0);
  s0 = F(s30 * s22); s0 = F(s0 + F(s20 * s18));
  s14 = F(s14 + F(s5 * s6));
  s10 = F(s10 + F(s8 * s2));
  s0 = F(s0 + F(s26 * s16));
  s14 = F(s14 + F(s12 * s2));
  s0 = F(s0 + F(s15 * s11));
  m.wf32(dst + 0x24, s0);
  s0 = F(s30 * s9); s0 = F(s0 + F(s20 * s1));
  s20 = F(s28 * s9);
  s28 = F(s28 * s22); s28 = F(s28 + F(s4 * s18));
  s20 = F(s20 + F(s4 * s1));
  s0 = F(s0 + F(s26 * s6));
  s22 = F(s24 * s22); s22 = F(s22 + F(s29 * s18));
  s28 = F(s28 + F(s13 * s16));
  s20 = F(s20 + F(s13 * s6));
  s0 = F(s0 + F(s15 * s2));
  s22 = F(s22 + F(s5 * s16));
  s28 = F(s28 + F(s7 * s11));
  s20 = F(s20 + F(s7 * s2));
  s22 = F(s22 + F(s12 * s11));
  m.wf32(dst + 0x28, s28); m.wf32(dst + 0x2c, s22); m.wf32(dst + 0x30, s10); m.wf32(dst + 0x34, s0);
  m.wf32(dst + 0x38, s20); m.wf32(dst + 0x3c, s14);
}
// 0x1ebe8: a = a * b.
export function matMul(m, a, b){ matMulTo(m, a, a, b); }

// 0xa69af0: the polyline basis: identity, scaled by `size`, rotated by the euler vector `rot` (order
// generator +0xea), then by the generator transform (+0x100); translation from the ROM row at
// 0x1917600. `dir` is not read on the recorded path.
export function polyBasis(m, out, gen, flags, rot, dir, size){
  liftedCall(m, 0xa69af0, [out, gen, flags, rot], [dir, size]);
}

// the template points through a basis's 3x3 part into a point buffer (the loops at 0xa651c8 / 0xa65434)
function placePoints(m, M, shape, dst, count){
  const s4 = m.f32(M), s6 = m.f32(M + 4), s8 = m.f32(M + 8), s10 = m.f32(M + 0x10), s14 = m.f32(M + 0x14);
  const s2 = m.f32(M + 0x18), s1 = m.f32(M + 0x20), s12 = m.f32(M + 0x24), s0 = m.f32(M + 0x28);
  for (let i = 0; i < count; i++){
    const src = shape + 0x70 + 16 * i, d = dst + 16 * i;
    let s5 = m.f32(src + 4);
    const s3 = m.f32(src), s7 = m.f32(src + 8);
    m.w32(d + 0xc, 0);
    let s9 = F(s10 * s5), s11 = F(s5 * s14);
    s9 = F(s9 + F(s4 * s3)); s11 = F(s11 + F(s3 * s6));
    s5 = F(s5 * s2); s5 = F(s5 + F(s3 * s8));
    s9 = F(s9 + F(s1 * s7)); s11 = F(s11 + F(s7 * s12)); s5 = F(s5 + F(s7 * s0));
    m.wf32(d, s9); m.wf32(d + 4, s11); m.wf32(d + 8, s5);
  }
}

// the motion direction, normalised when it is long enough (as in the Model update)
function direction(m, upd, out){
  const x = m.f32(upd), y = m.f32(upd + 4), z = m.f32(upd + 8);
  let l2 = F(y * y); l2 = F(l2 + F(x * x)); l2 = F(l2 + F(z * z));
  const len = F(Math.sqrt(l2));
  if (Number.isNaN(len)) throw new Unverified('0xa650a4 sqrtf fallback');
  if (len < 1.1920928955078125e-07){
    m.w32(out, m.u32(upd)); m.w32(out + 4, m.u32(upd + 4)); m.w32(out + 8, m.u32(upd + 8));
  } else throw new Unverified('0xa650f0 normalised polyline direction');
  m.w32(out + 0xc, 0);
}

// 0xa65014: the polyline's points for this frame (both buffers when `both` is 1).
export function polyPoints(m, gen, p, shape, both){
  const wc = m.u32(p + 0xc), w7c = m.u32(p + 0x7c);
  const blockOff = m.u16(gen + 0xd4);
  const idx = m.u16(p + 8);
  const upd = (m.u32(gen + 0x24) + m.u32(gen + 0xc8) + m.u16(gen + 0xda) * idx) >>> 0;
  const bit = (wc >>> 24) & 1;
  const count = (w7c >>> 8) & 0xff;
  const block = p + blockOff;
  const area = block + (count << 5);
  const sc = new Scratch(m);
  const dir = sc.alloc(16), size = sc.alloc(16), M = sc.alloc(64);
  direction(m, upd, dir);
  const scale = m.f32(p + 0x40 + ((m.u8(p + 0xf) & 1) << 2));
  const sz = area + 0x30 + (bit << 4);
  m.wf32(size, F(scale * m.f32(sz))); m.wf32(size + 4, F(scale * m.f32(sz + 4)));
  m.wf32(size + 8, F(scale * m.f32(sz + 8))); m.w32(size + 0xc, 0);
  polyBasis(m, M, gen, wc & 0xffff, area + (bit << 4), dir, size);
  const cur = bit ? block + (count << 4) : block;
  placePoints(m, M, shape, cur, count);
  if (both === 1){                                           // 0xa6522c: the previous buffer too
    const idx2 = m.u16(p + 8), wc2 = m.u32(p + 0xc);
    const upd2 = (m.u32(gen + 0x24) + m.u32(gen + 0xc8) + m.u16(gen + 0xda) * idx2) >>> 0;
    const prevBit = (wc2 >>> 25) & 1;
    direction(m, upd2, dir);
    const scale2 = m.f32(p + 0x40 + (((m.u32(p + 0xc) >>> 25) & 1) << 2));
    const sz2 = area + 0x30 + (prevBit << 4);
    m.wf32(size, F(scale2 * m.f32(sz2))); m.wf32(size + 4, F(scale2 * m.f32(sz2 + 4)));
    m.wf32(size + 8, F(scale2 * m.f32(sz2 + 8))); m.w32(size + 0xc, 0);
    polyBasis(m, M, gen, wc2 & 0xffff, area + (prevBit << 4), dir, size);
    if (count !== 0) placePoints(m, M, shape, cur + ((prevBit ? count : -count) << 4), count);
  }
  sc.free();
}

// 0xa67540: the polyline's random vector (and an angular vector, zero on the recorded path).
export function polyRandomVec(m, gen, p, out1, out2, base1, base2, mode){
  const zero = m.u32(GOT_ZERO3);
  const zx = m.u32(zero), zy = m.u32(zero + 4), zz = m.u32(zero + 8);
  if (mode !== 0) throw new Unverified('0xa67594 polyline random vector mode');
  const tbl = m.u32(GOT_FLOAT_RNG);
  const c0 = m.u32(gen + 0x4c);
  const draw = k => { m.w32(gen + 0x4c, (c0 + k) >>> 0); return m.f32(tbl + 4 * ((c0 + k) & 0xfff)); };
  const r1 = draw(1), r2 = draw(2), r3 = draw(3);
  const x = F(m.f32(base1) + F(r1 * m.f32(base1 + 4)));
  const y = F(m.f32(base1 + 8) + F(r2 * m.f32(base1 + 0xc)));
  if ((m.u32(gen + 0x50) >>> 16) & 0x80) throw new Unverified('0xa67700 polyline angular vector');
  const z = F(m.f32(base1 + 0x10) + F(r3 * m.f32(base1 + 0x14)));
  if (m.u8(gen + 0xed) & 8) throw new Unverified('0xa678e8 generator +0xed bit 3');
  if (m.u8(gen + 0xc1) & 0x40) throw new Unverified('0xa67928 generator +0xc1 bit 6');
  m.wf32(out1, x); m.wf32(out1 + 4, y); m.wf32(out1 + 8, z); m.w32(out1 + 0xc, 0);
  m.w32(out2, zx); m.w32(out2 + 4, zy); m.w32(out2 + 8, zz); m.w32(out2 + 0xc, 0);
}

// 0xa6b2f4: shape type 1 at spawn -- random size and size velocity (shape +0x00..+0x2c), rotation
// (shape +0x30.., both buffers at block +0x00/+0x10) and angular vector (+0x20), then the points.
export function polyShapeInit1(m, gen, p, shape){
  const w7c = m.u32(p + 0x7c);
  const area = p + m.u16(gen + 0xd4) + ((w7c >>> 3) & 0x1fe0);
  if (m.u32(shape + 0x68) !== 0) throw new Unverified('0xa6b334 polyline shape +0x68');
  const tbl = m.u32(GOT_FLOAT_RNG);
  const c0 = m.u32(gen + 0x4c);
  const draw = (k, t) => { m.w32(gen + 0x4c, (c0 + k) >>> 0); return m.f32(t + 4 * ((c0 + k) & 0xfff)); };
  const r1 = draw(1, tbl), r2 = draw(2, tbl), r3 = draw(3, tbl), r4 = draw(4, tbl);
  const sx = F(m.f32(shape) + F(r1 * m.f32(shape + 4)));
  const sy = F(m.f32(shape + 8) + F(r2 * m.f32(shape + 0xc)));
  const sz = F(m.f32(shape + 0x10) + F(r3 * m.f32(shape + 0x14)));
  m.wf32(area + 0x50, F(m.f32(shape + 0x18) + F(r4 * m.f32(shape + 0x1c))));
  m.wf32(area + 0x54, F(m.f32(shape + 0x20) + F(draw(5, tbl) * m.f32(shape + 0x24))));
  m.wf32(area + 0x58, F(m.f32(shape + 0x28) + F(draw(6, tbl) * m.f32(shape + 0x2c))));
  m.wf32(area + 0x40, sx); m.wf32(area + 0x44, sy); m.wf32(area + 0x48, sz); m.w32(area + 0x4c, 0);
  m.w32(area + 0x30, m.u32(area + 0x40)); m.w32(area + 0x34, m.u32(area + 0x44));
  m.w32(area + 0x38, m.u32(area + 0x48)); m.w32(area + 0x3c, 0);
  const sc = new Scratch(m);
  const v1 = sc.alloc(16), v2 = sc.alloc(16);
  polyRandomVec(m, gen, p, v1, v2, shape + 0x30, shape + 0x48, m.u32(shape + 0x6c));
  const a = m.u32(v1), b = m.u32(v1 + 4), c = m.u32(v1 + 8);
  m.w32(area + 0x10, a); m.w32(area + 0x14, b); m.w32(area + 0x18, c); m.w32(area + 0x1c, 0);
  m.w32(area, a); m.w32(area + 4, b); m.w32(area + 8, c); m.w32(area + 0xc, 0);
  m.w32(area + 0x20, m.u32(v2)); m.w32(area + 0x24, m.u32(v2 + 4)); m.w32(area + 0x28, m.u32(v2 + 8)); m.w32(area + 0x2c, 0);
  polyPoints(m, gen, p, shape, 1);
  sc.free();
}

// 0xa6b06c: shape init by type (particle +0x7c low byte).
export function polyShapeInit(m, gen, p, shape, info){
  liftedCall(m, 0xa6b06c, [gen, p, shape, info]);
}

// 0xa6ecc4: shape type 1 per frame -- size += velocity, then the points (both buffers when the node
// tracks or generator +0x43 bit 5).
export function polyShapeUpdate1(m, gen, p, shape){
  const w7c = m.u32(p + 0x7c);
  const area = p + m.u16(gen + 0xd4) + ((w7c >>> 3) & 0x1fe0);
  m.u32(p + 8);
  const wc = m.u32(p + 0xc);
  if (m.u8(p + 0x12) & 0x80) throw new Unverified('0xa6ed64 particle +0x12 bit 7');
  const v0 = m.f32(area + 0x50), v1 = m.f32(area + 0x54), v2 = m.f32(area + 0x58);
  const prev = area + 0x30 + ((wc >>> 21) & 0x10), cur = area + 0x30 + (((wc >>> 24) & 1) << 4);
  const a0 = m.f32(prev), a1 = m.f32(prev + 4), a2 = m.f32(prev + 8);
  m.w32(cur + 0xc, 0);
  m.wf32(cur, F(a0 + v0)); m.wf32(cur + 4, F(a1 + v1)); m.wf32(cur + 8, F(a2 + v2));
  if (m.u32(p + 0x10) & 0x200400) throw new Unverified('0xa6edf0 polyline rotation');
  let both = 1;
  if (!(m.u32(m.u32(gen + 0x18) + 0x110) & 0x80)) both = (m.u8(gen + 0x43) >>> 5) & 1;
  polyPoints(m, gen, p, shape, both);
}

// 0xa6ea50: per-frame shape update by type.
export function polyShapeUpdate(m, gen, p, shape){
  return liftedCall(m, 0xa6ea50, [gen, p, shape]).r[0];
}

// 0xcaa710: bind the animation into the particle's +0x80 block. Returns 0 when bound.
export function animBindLPL(m, p, anim, cfg){
  m.w16(p + 0xa0, 0);
  const flags16 = m.u16(cfg);
  if (anim === 0) throw new Unverified('0xcaa7b4 no rEffectAnim');
  const seq = m.u32(cfg + 4), startBits = m.u32(cfg + 8);
  let s0 = m.f32(cfg + 0xc);
  const r4 = (flags16 | (seq << 16)) >>> 0;
  m.w32(p + 0x80, r4);
  const r1 = m.u32(m.u32(anim + 0x6c) + (seq << 5) + 4);
  const frames = r1 & 0xffff;
  const s2 = F(frames);
  const packed = (frames | ((((r1 << 16) >>> 0) + 0xffff0000) >>> 0)) >>> 0;
  const s4 = F(toS32(F(s0 / s2)));
  m.w32(p + 0x80, r4); m.w32(p + 0x84, packed);
  m.w32(p + 0x88, startBits);
  s0 = F(s0 - F(s2 * s4));
  m.wf32(p + 0x8c, s0);
  const v8 = m.u32(cfg + 8);
  m.w32(p + 0x94, v8); m.w32(p + 0x90, v8);
  m.w32(p + 0x98, m.u32(cfg + 0x10));
  const w8 = m.u32(p + 8), wc = m.u32(p + 0xc);
  m.w32(p + 8, w8); m.w32(p + 0xc, (wc | 0x8000000) >>> 0);
  return 0;
}

// 0xa6908c: the second base colour, generator +0x178 on the recorded path.
export function baseColour2(m, out, gen){
  const w = m.u32(gen + 0x194);
  if (w & 0xf) throw new Unverified('0xa6909c colour source ' + (w & 0xf));
  if (w & 0x20) throw new Unverified('0xa69160 colour source bit 5');
  m.w32(out, m.u32(gen + 0x178));
}

// 0xab4710 (slot 23): spawn one LitePolyline particle. Returns particle +0x0c bit 26.
export function spawnLPL(m, gen, p, info){
  return liftedCall(m, 0xab4710, [gen, p, info]).r[0];
}

// 0xab5090: one LitePolyline particle, one frame. Returns 0 to free it.
export function updateLPLParticle(m, gen, p){
  return liftedCall(m, 0xab5090, [gen, p]).r[0];
}

// 0xab4f64 (slot 24): the LitePolyline particle pass.
export function polylineFrame(m, gen){
  return liftedCall(m, 0xab4f64, [gen]).r[0];
}
