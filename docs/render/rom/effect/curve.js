// KEYFRAMED VEC3 CURVES and the particle-to-world transform the base particle update uses.
//
// Translated from MHGU and checked against call vectors from the game's own run of Savage's
// em043_05_002_s (dev/effect-check.mjs). The arithmetic routines are transcribed register by register
// (s0..s31 named as in the disassembly), because single-precision results depend on the exact order
// of every add and multiply; Math.fround after each operation reproduces the VFP result bit for bit.
//
// A curve is a u32 header followed by 28-byte keys:
//   header  low byte = key count, bit 30 = loop, bits 27..29 (signed) = interpolation
//           (0 linear, 1 cubic 0xaf7bc8, 2 cubic 0xaf7db8, 3 step, negative = zero vector)
//   key     u32 time, then per axis a (base, range) pair of f32: value = base + random * range,
//           with the particle's own random vector supplying `random`.
import { Unverified, F } from './mem.js';

// 0xaea784: the time a curve is sampled at. Byte +3 of the curve block, low 3 bits, chooses it.
export function curveTime(m, gen, curve, p){
  const sel = ((m.u8(curve + 3) & 7) - 1) >>> 0;
  if (sel > 3) return m.u32(p + 0x14);                       // 0xaea7c4: the particle's age
  throw new Unverified('0xaea798 curve time source ' + (sel + 1));
}

// 0xaec7e0: the same choice read from a curve header word (bits 24..26), minus one when set.
export function curveTimeFromHeader(m, gen, headerPtr, p){
  const h = m.u32(headerPtr);
  const sel = ((((h >>> 24) & 7) - 1) >>> 0);
  if (sel <= 3) throw new Unverified('0xaec7f4 curve time source ' + (sel + 1));
  const v = m.u32(p + 0x14);                                // 0xaec81c -> 0xaec858
  if (v === 0) return 0;
  return v;                                                  // (h & 0x7000000) is 0 on this path
}

// 0xaf82f4: evaluate a vec3 curve at integer time t. out receives x, y, z, 0.
// statusPtr (optional) receives 0 inside a segment, 1 on a key, 2 before the first, 3 after the last.
export function evalCurve3(m, out, curve, t, rnd, statusPtr){
  t >>>= 0;
  let s0 = 0.0;                                              // literal at 0xaf85b0
  let sb = 2, r4 = 0;
  const h = m.u32(curve);
  const keys = curve + 4;
  const n = h & 0xff;
  if (n >= 2){
    const last = n - 1;
    const t0 = m.u32(keys), tl = m.u32(keys + 28 * last);
    if (h & 0x40000000) throw new Unverified('0xaf8360 looping curve');
    if (t0 < t){
      sb = 3;
      if (tl > t){
        sb = 1; r4 = 1;                                      // 0xaf83a8: find the segment
        let k = curve + 0x20, tk;
        for (;;){
          tk = m.u32(k);
          if (t === tk) break;
          if (t < tk){                                       // 0xaf83d4
            r4 -= 1; sb = 0;
            const ts = m.u32(keys + 28 * r4);
            s0 = F(F((t - ts) >>> 0) / F((tk - ts) >>> 0));
            break;
          }
          r4 += 1; k += 0x1c;
          if (r4 >= n) throw new Unverified('0xaf83d0 segment search ran off the end');
        }
      } else r4 = last;
    }
  }
  if (statusPtr) m.w32(statusPtr, sb);
  if (sb !== 0) return keyValue(m, out, keys, r4, rnd);       // 0xaf8410
  const type = ((h << 2) >> 29);                             // sbfx #27, #3
  if (type < 0) throw new Unverified('0xaf855c curve type ' + type);
  if (type === 0) return linearSegment(m, out, n, keys, h, rnd, r4, s0);                // 0xaf84a0
  if (type === 1) return cubicSegment(m, out, n, keys, (h >>> 30) & 1, rnd, r4, s0);   // 0xaf8588
  if (type === 3) return keyValue(m, out, keys, r4, rnd);
  throw new Unverified('0xaf848c curve interpolation ' + type);
}

function linearSegment(m, out, n, keys, h, rnd, idx, s0){    // 0xaf84a0
  if (h & 0x40000000) throw new Unverified('0xaf84cc looping linear segment');
  const k0 = keys + 28 * idx, k1 = keys + 28 * (idx + 1);
  let s2 = m.f32(rnd), s4 = m.f32(rnd + 4), s6 = m.f32(rnd + 8);
  const s16 = 1.0;
  let s5 = m.f32(k0 + 4), s7 = m.f32(k0 + 8), s9 = m.f32(k0 + 0xc), s11 = m.f32(k0 + 0x10);
  let s13 = m.f32(k0 + 0x14), s15 = m.f32(k0 + 0x18);
  s5 = F(s5 + F(s2 * s7));
  s9 = F(s9 + F(s4 * s11));
  s13 = F(s13 + F(s6 * s15));
  let s8 = m.f32(k1 + 4), s10 = m.f32(k1 + 8), s12 = m.f32(k1 + 0xc), s14 = m.f32(k1 + 0x10);
  let s1 = m.f32(k1 + 0x14), s3 = m.f32(k1 + 0x18);
  m.w32(out + 0xc, 0);
  s8 = F(s8 + F(s2 * s10));
  s12 = F(s12 + F(s4 * s14));
  s1 = F(s1 + F(s6 * s3));
  s10 = F(s16 - s0);
  s2 = F(s0 * s8);
  s4 = F(s0 * s12);
  s0 = F(s0 * s1);
  s2 = F(s2 + F(s10 * s5));
  s4 = F(s4 + F(s10 * s9));
  s0 = F(s0 + F(s10 * s13));
  m.wf32(out, s2); m.wf32(out + 4, s4); m.wf32(out + 8, s0);
}

function keyValue(m, out, keys, i, rnd){                     // 0xaf8410
  let s0 = m.f32(rnd), s2 = m.f32(rnd + 4), s4 = m.f32(rnd + 8);
  const k = keys + 28 * i;
  let s6 = m.f32(k + 4), s8 = m.f32(k + 8), s10 = m.f32(k + 0xc), s12 = m.f32(k + 0x10);
  let s14 = m.f32(k + 0x14), s1 = m.f32(k + 0x18);
  m.w32(out + 0xc, 0);
  s6 = F(s6 + F(s0 * s8));
  s10 = F(s10 + F(s2 * s12));
  s14 = F(s14 + F(s4 * s1));
  m.wf32(out, s6); m.wf32(out + 4, s10); m.wf32(out + 8, s14);
}

// 0xaf7bc8: cubic segment through keys idx and idx+1, shaped by idx+2. s0 is the segment fraction.
export function cubicSegment(m, out, n, keys, loop, rnd, idx, s0){
  if (loop) throw new Unverified('0xaf7be0 looping cubic');
  const r3 = idx + 2;
  const k1 = keys + 28 * (idx + 1), k0 = keys + 28 * idx;
  let s3 = m.f32(rnd), s1 = m.f32(rnd + 4), s10 = m.f32(rnd + 8);
  let s14 = m.f32(k1 + 4), s5 = m.f32(k1 + 8), s12 = m.f32(k1 + 0xc);
  let s7 = m.f32(k1 + 0x10), s8 = m.f32(k1 + 0x14), s9 = m.f32(k1 + 0x18);
  let s6 = m.f32(k0 + 4), s11 = m.f32(k0 + 8), s4 = m.f32(k0 + 0xc);
  let s13 = m.f32(k0 + 0x10), s2 = m.f32(k0 + 0x14), s15 = m.f32(k0 + 0x18);
  s14 = F(s14 + F(s3 * s5));
  s12 = F(s12 + F(s1 * s7));
  s2 = F(s2 + F(s10 * s15));
  s4 = F(s4 + F(s1 * s13));
  s6 = F(s6 + F(s3 * s11));
  s8 = F(s8 + F(s10 * s9));
  if (r3 >= n) throw new Unverified('0xaf7d7c last segment (linear)');
  const k2 = keys + 28 * r3;                                 // 0xaf7c70
  s5 = 3.0;
  let s16 = F(s14 - s6);
  let s20 = F(s12 - s4);
  let s22 = F(s14 + s14);
  let s24 = F(s6 + s6);
  s7 = F(s14 * s5);
  let s18 = F(s12 * s5);
  s7 = F(s7 - F(s6 * s5));
  s18 = F(s18 - F(s4 * s5));
  s9 = m.f32(k2 + 4); s11 = m.f32(k2 + 8); s13 = m.f32(k2 + 0xc); s15 = m.f32(k2 + 0x10);
  let s26 = F(s16 + s16);
  let s28 = F(s20 + s20);
  s9 = F(s9 + F(s3 * s11));
  s13 = F(s13 + F(s1 * s15));
  s15 = m.f32(k2 + 0x18);
  s1 = F(s24 - s22);
  s3 = F(s12 + s12);
  s11 = F(s4 + s4);
  s22 = m.f32(k2 + 0x14);
  s24 = F(s8 - s2);
  m.w32(out + 0xc, 0);
  s7 = F(s7 - s26);
  s3 = F(s11 - s3);
  s11 = F(s18 - s28);
  s1 = F(s16 + s1);
  s18 = F(s8 + s8);
  s22 = F(s22 + F(s10 * s15));
  s14 = F(s9 - s14);
  s9 = F(s8 * s5);
  s12 = F(s13 - s12);
  s9 = F(s9 - F(s2 * s5));
  s5 = F(s2 + s2);
  s13 = F(s0 * s0);
  s10 = F(s20 + s3);
  s26 = F(s24 + s24);
  s7 = F(s7 - s14);
  s3 = F(s11 - s12);
  s14 = F(s1 + s14);
  s8 = F(s22 - s8);
  s11 = F(s13 * s0);
  s5 = F(s5 - s18);
  s10 = F(s10 + s12);
  s1 = F(s13 * s7);
  s7 = F(s9 - s26);
  s12 = F(s13 * s3);
  s1 = F(s1 + F(s11 * s14));
  s12 = F(s12 + F(s11 * s10));
  s14 = F(s24 + s5);
  s3 = F(s7 - s8);
  s1 = F(s1 + F(s16 * s0));
  s12 = F(s12 + F(s20 * s0));
  s8 = F(s14 + s8);
  s10 = F(s13 * s3);
  s6 = F(s6 + s1);
  s4 = F(s4 + s12);
  s10 = F(s10 + F(s11 * s8));
  m.wf32(out, s6);
  m.wf32(out + 4, s4);
  s10 = F(s10 + F(s24 * s0));
  s0 = F(s2 + s10);
  m.wf32(out + 8, s0);
}

// 0xa76cc8: a particle-space vec3 to world space through the generator's node instance.
// gen +0x1b8 scales it, the update slot's +0x50 offsets it, node +0xe0 scales again, and the node's
// 4x3 matrix (+0x00..+0x38) places it. out receives x, y, z, 0; returns 0.
export function toWorld(m, gen, upd, v, out){
  let s0 = m.f32(v), s2 = m.f32(v + 4), s4 = m.f32(v + 8);
  const sc = m.u32(gen + 0x1b8);
  const s6 = m.f32(sc), s8 = m.f32(sc + 4), s10 = m.f32(sc + 8);
  const s16 = F(s0 * s6), s20 = F(s2 * s8), s18 = F(s4 * s10);
  if (m.u8(upd + 0x44) & 2) throw new Unverified('0xa76d40 rotated particle space');
  s4 = s18; s0 = s20; s2 = s16;
  if (m.u32(m.u32(gen + 0x28) + 0x1c) !== 0) throw new Unverified('0xa76dbc list entry +0x1c transform');
  const node = m.u32(gen + 0x18);                            // 0xa76dec
  let t6 = m.f32(upd + 0x50), t8 = m.f32(upd + 0x54), t10 = m.f32(upd + 0x58);
  let s12 = m.f32(node + 0xe0), s14 = m.f32(node + 0xe4), s1 = m.f32(node + 0xe8);
  s2 = F(s2 + t6); s0 = F(s0 + t8); s4 = F(s4 + t10);
  s2 = F(s2 * s12); s0 = F(s0 * s14); s4 = F(s4 * s1);
  s12 = m.f32(node + 0x14); s1 = m.f32(node + 0x10);
  t6 = m.f32(node + 4); t8 = m.f32(node + 8); t10 = m.f32(node);
  s14 = m.f32(node + 0x18);
  const s3 = m.f32(node + 0x24), s5 = m.f32(node + 0x28), s7 = m.f32(node + 0x20);
  s1 = F(s1 * s0);
  s12 = F(s0 * s12);
  s1 = F(s1 + F(t10 * s2));
  s12 = F(s12 + F(s2 * t6));
  t6 = m.f32(node + 0x30);
  s0 = F(s0 * s14);
  s0 = F(s0 + F(s2 * t8));
  t10 = m.f32(node + 0x34);
  s2 = m.f32(node + 0x38);
  s0 = F(s0 + F(s4 * s5));
  s1 = F(s1 + F(s7 * s4));
  s12 = F(s12 + F(s4 * s3));
  t6 = F(t6 + s1);
  s4 = F(t10 + s12);
  s0 = F(s2 + s0);
  m.wf32(out, t6); m.wf32(out + 4, s4); m.wf32(out + 8, s0);
  m.w32(out + 0xc, 0);
  return 0;
}

// 0xaf63c4: an RGBA colour curve at integer time t. Keys are 12 bytes {u32 time, u32 RGBA, u32}; the
// header is as for vec3 curves (low byte count, bit 30 loop, bits 27..29 interpolation) plus bit 9
// (fixed colours). Linear interpolation is 8-bit fixed point per channel. out receives the colour.
export function evalColour(m, out, curve, t, pick){
  t >>>= 0;
  const h = m.u32(curve);
  const keys = curve + 4;
  const n = h & 0xff;
  const key = i => {
    if (!(h & 0x200)) throw new Unverified('0xaf6400 colour curve without bit 9');
    m.w32(out, m.u32(keys + 12 * i + 4));
  };
  if (n < 2) return key(0);
  const last = n - 1;
  const loop = h & 0x40000000;
  const tl = m.u32(keys + 12 * last), t0 = m.u32(keys);
  if (loop) throw new Unverified('0xaf64b4 looping colour curve');
  if (t0 >= t) return key(0);
  if (!(tl > t)) return key(last);
  let r7 = 1, r5;
  for (let k = curve + 0x10;; k += 12){
    r5 = m.u32(k);
    if (t === r5) return key(r7);
    if (t < r5) break;
    throw new Unverified('0xaf6514 colour curve search past key 1');
  }
  const lr = r7 - 1;
  const ts = m.u32(keys + 12 * lr);
  const frac = Math.floor((((t - ts) << 8) >>> 0) / ((r5 - ts) >>> 0)) >>> 0;
  if (!(h & 0x200)) throw new Unverified('0xaf654c colour curve without bit 9');
  const type = (h << 2) >> 29;
  if (type < 0 || (type & 7) !== 0) throw new Unverified('0xaf65b0 colour interpolation ' + type);
  let r6 = r7;                                               // 0xaf65c4 linear
  if (r7 === last) r6 = 0;
  if (!loop) r6 = r7;
  const c0 = m.u32(keys + 12 * lr + 4), c1 = m.u32(keys + 12 * r6 + 4);
  let r3 = ((c1 & 0xff) - (c0 & 0xff)) | 0;
  let r7b = ((((c1 >>> 8) & 0xff)) - ((c0 >>> 8) & 0xff)) | 0;
  r3 = Math.imul(r3, frac) >>> 0;
  r7b = Math.imul(r7b, frac) >>> 0;
  r3 = (c0 + (r3 >>> 8)) >>> 0;
  r7b = (r7b + (((c0 >>> 8) << 8) >>> 0)) >>> 0;
  r3 = ((r7b & 0xff00) | (r3 & 0xff)) >>> 0;
  let a = ((c1 >>> 24) - (c0 >>> 24)) | 0;
  a = ((Math.imul(a, frac) >>> 8) + (c0 >>> 24)) >>> 0;
  r3 = (r3 | ((a << 24) >>> 0)) >>> 0;
  let b = (((c1 >>> 16) & 0xff) - ((c0 >>> 16) & 0xff)) | 0;
  b = ((Math.imul(b, frac) >>> 8) + (c0 >>> 16)) >>> 0;
  const r1 = ((b << 16) >>> 0) & 0x00ff00ff;
  m.w32(out, (r3 | r1) >>> 0);
}
