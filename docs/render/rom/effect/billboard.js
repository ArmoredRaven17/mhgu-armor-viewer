// cParticleGeneratorLiteBillboard (generator type 0): spawn and per-frame particle pass.
//
// Translated from MHGU and checked against call vectors from the game's own run of Savage's effects
// (dev/effect-check.mjs). LiteBillboard particle fields past the common header (motion.js):
//
//   +0x40 / +0x44  uniform scale, two buffers        +0x48  its rate
//   +0x60 animation: +0x60 flags | sequence << 16, +0x64 frames | last << 16, +0x68 counter, +0x6c speed
//   +0x70 / +0x80  size x, y and a third value (+0x78 / +0x88), two buffers; +0xa4 / +0xa8 their rates
//   +0x7c / +0x8c  animation frame, two buffers      +0xa0  animation start
//   +0x90 / +0x94  colour RGBA, two buffers          +0x98  base colour
import { Unverified, F } from './mem.js';
import { baseFrame, Scratch } from './motion.js';
import { killParticle } from './life.js';
import { preUpdate } from './emit.js';
import { spawnBase, unitScale, baseColour, scaleInit, lastPass } from './spawn.js';
import { scaleStep } from './model.js';

const GOT_FLOAT_RNG = 0x183b9f8, GOT_INT_RNG = 0x183b9f4;

function toS32(v){
  if (Number.isNaN(v)) return 0;
  if (v >= 2147483647) return 2147483647;
  if (v <= -2147483648) return -2147483648;
  return Math.trunc(v);
}

// colour channel scaling by an envelope value, as in the Model update (alpha modes 1 3 5 7, RGB 2 4 6 8)
function envColour(col, mode, e){
  if (mode > 8) return col;
  if (0xaa & (1 << mode)) return ((col & 0x00ffffff) | (((Math.imul(col >>> 24, e) >>> 8) & 0xff) << 24)) >>> 0;
  if (0x154 & (1 << mode)){
    const g = (Math.imul((col >>> 8) & 0xff, e) & 0xff00) | (col & 0xffff0000);
    const r = (Math.imul(col & 0xff, e) >>> 8) & 0xff;
    const b = (col >>> 16) & 0xff;
    return (((g | r) & 0xff00ffff) | (((Math.imul(b, e) >>> 8) & 0xff) << 16)) >>> 0;
  }
  return col;
}

// 0xa78464 (slot 16): the shared pre-update, and a +0x1bc hook no recorded generator has.
export function preUpdateLB(m, gen){
  preUpdate(m, gen);
  if (m.u32(gen + 0x1bc) !== 0) throw new Unverified('0xa7847c generator +0x1bc');
}

// 0xa66d38: the animation binding request -- flags from param +0x50 (with random bits), the sequence,
// start frame and speed from param +0x50..+0x58.
export function animConfig(m, gen, p, out){
  const param = m.u32(gen + 0x34);
  const w50 = m.u32(param + 0x50);
  let flags = w50 & 0xffff;
  if (w50 & 0x800){
    const c = (m.u32(gen + 0x4c) + 1) >>> 0; m.w32(gen + 0x4c, c);
    flags = (flags | (((m.u32(m.u32(GOT_INT_RNG) + 4 * (c & 0xfff)) << 9) >>> 0) & 0x200)) >>> 0;
  }
  if (flags & 0x10) throw new Unverified('0xa66d94 animation flag 0x10');
  if (flags & 0x400){
    const c = (m.u32(gen + 0x4c) + 1) >>> 0; m.w32(gen + 0x4c, c);
    flags = (flags | (((m.u32(m.u32(GOT_INT_RNG) + 4 * (c & 0xfff)) << 8) >>> 0) & 0x100)) >>> 0;
  }
  if (m.u8(gen + 0xc1) & 0x40) flags = (flags ^ 0x100) >>> 0;
  if (m.u32(m.u32(gen + 0x28) + 0x14) === 0) throw new Unverified('0xa66f2c no rEffectAnim');
  if (m.u16(param + 0x44) !== 0) throw new Unverified('0xa66e18 param +0x44 channel');
  let c = (m.u32(gen + 0x4c) + 1) >>> 0; m.w32(gen + 0x4c, c);
  const w54 = m.u32(param + 0x54);
  // 0xa66ea8: the high 16 bits of param +0x54 are a random RANGE for the start frame (0 = fixed). When set,
  // start = (w54 & 0xffff) + rng % (range + 1), the int RNG indexed by the counter just bumped above (c),
  // exactly like the flag bits. Khezu em003_00_006 is the first effect to use it.
  const range = w54 >>> 16;
  let start = F(w54 & 0xffff);
  if (range){
    const rnd = (m.u32((m.u32(GOT_INT_RNG) + 4 * (c & 0xfff)) >>> 0) % ((range + 1) >>> 0)) >>> 0;
    start = F(((w54 & 0xffff) + rnd) >>> 0);
  }
  const speed = m.f32(param + 0x58);
  m.w32(out, flags);
  c = (m.u32(gen + 0x4c) + 1) >>> 0; m.w32(gen + 0x4c, c);
  const w50b = m.u32(param + 0x50);
  if (w50b >>> 24) throw new Unverified('0xa66f04 random sequence');
  m.w32(out + 4, (w50b >>> 16) & 0xff);
  m.wf32(out + 8, start); m.wf32(out + 0xc, speed); m.wf32(out + 0x10, 0.0);
}

// 0xcaa674: bind the animation into the particle's +0x60 block.
export function animBindLB(m, p, anim, cfg){
  const seq = m.u32(cfg + 4), startBits = m.u32(cfg + 8);
  const lr = (m.u16(cfg) | (seq << 16)) >>> 0;
  let s0 = m.f32(cfg + 0xc);
  m.w32(p + 0x60, lr);
  if (anim === 0) throw new Unverified('0xcaa6a8 no rEffectAnim');
  const frames = m.u16(m.u32(anim + 0x6c) + (seq << 5) + 4);
  const s2 = F(frames);
  const packed = (frames | (((frames << 16) >>> 0) + 0xffff0000) >>> 0) >>> 0;
  const s4 = F(toS32(F(s0 / s2)));
  m.w32(p + 0x60, lr); m.w32(p + 0x64, packed);
  m.w32(p + 0x68, startBits);
  s0 = F(s0 - F(s2 * s4));
  m.wf32(p + 0x6c, s0);
  const v8 = m.u32(cfg + 8);
  m.w32(p + 0x8c, v8); m.w32(p + 0x7c, v8);
  m.w32(p + 0xa0, m.u32(cfg + 0x10));
  const w8 = m.u32(p + 8), wc = m.u32(p + 0xc);
  m.w32(p + 8, w8); m.w32(p + 0xc, (wc | 0x8000000) >>> 0);
}

// 0xa7a8a8 (slot 23): spawn one LiteBillboard particle. Returns particle +0x0c bit 26.
export function spawnLB(m, gen, p, info){
  if (spawnBase(m, gen, p, info) !== 1) return 0;
  const param = m.u32(gen + 0x34);
  const sc = new Scratch(m);
  const cfg = sc.alloc(0x14), cbuf = sc.alloc(4);
  animConfig(m, gen, p, cfg);
  animBindLB(m, p, m.u32(m.u32(gen + 0x28) + 0x14), cfg);
  const f4 = m.u32(gen + 0xf4), fl = m.u32(cfg), w0 = m.u32(param);
  m.w32(p + 0x1c, f4);
  const bits = ((((fl >>> 8) & 3) | ((fl >>> 10) & 4)) << 26) >>> 0;
  const w18 = ((bits | (w0 >>> 19)) & 0x1c001fe0) >>> 0;
  m.w32(p + 0x18, w18); m.w32(p + 0x18, w18);
  unitScale(m, gen, p);
  if (m.u32(param + 0x40) >>> 16) throw new Unverified('0xa7a960 colour curve at spawn');
  baseColour(m, cbuf, gen);
  let col = m.u32(cbuf);
  m.w32(p + 0x98, col);
  const mode = (m.u32(gen + 0x40) >>> 12) & 0xf;
  m.u32(gen + 0x44);
  if (mode !== 0) col = envColour(col, mode, toS32(F(m.f32(info + 0x20) * 256.0)));   // 256.0 at 0xa7aa08
  m.w32(p + 0x94, col); m.w32(p + 0x90, col);
  const scale = scaleInit(m, gen, p, 0.0);                   // its s0 on return
  const sx = F(scale * m.f32(gen + 0xfc));
  m.wf32(p + 0x80, sx); m.wf32(p + 0x70, sx);
  const c0 = m.u32(gen + 0x4c);
  const w198 = m.u32(param + 0x198);
  m.w32(gen + 0x4c, (c0 + 1) >>> 0);
  const r1 = m.f32(m.u32(GOT_FLOAT_RNG) + 4 * ((c0 + 1) & 0xfff));
  if (w198 !== 0) throw new Unverified('0xa7aaf4 param +0x198 curve');
  m.w32(gen + 0x4c, (c0 + 2) >>> 0);
  const a = F(m.f32(param + 0x170) + F(r1 * m.f32(param + 0x174)));
  const r2 = m.f32(m.u32(GOT_FLOAT_RNG) + 4 * ((c0 + 2) & 0xfff));
  const rate = F(m.f32(param + 0x178) + F(r2 * m.f32(param + 0x17c)));
  if (!(rate === 0)){                                        // 0xa7ab70: an animated size
    m.w32(p + 0x10, (m.u32(p + 0x10) | 1) >>> 0);
    if (m.u32(param + 0x194) !== 0) throw new Unverified('0xa7ab88 param +0x194 size curve');
  }
  if (m.u32(p + 0x10) & 0x4000) throw new Unverified('0xa7ac40 particle flag 0x4000');
  m.wf32(p + 0x84, a); m.wf32(p + 0x74, a); m.wf32(p + 0xa4, rate);
  const c1 = m.u32(gen + 0x4c);
  const tbl = m.u32(GOT_FLOAT_RNG);
  m.w32(gen + 0x4c, (c1 + 1) >>> 0);
  const q1 = m.f32(tbl + 4 * ((c1 + 1) & 0xfff));
  m.w32(gen + 0x4c, (c1 + 2) >>> 0);
  const q2 = m.f32(tbl + 4 * ((c1 + 2) & 0xfff));
  const b = F(m.f32(param + 0x180) + F(q1 * m.f32(param + 0x184)));
  const brate = F(m.f32(param + 0x188) + F(q2 * m.f32(param + 0x18c)));
  if (!(brate === 0)) m.w32(p + 0x10, (m.u32(p + 0x10) | 8) >>> 0);
  m.wf32(p + 0x88, b); m.wf32(p + 0x78, b); m.wf32(p + 0xa8, brate);
  if (m.u32(gen + 0xcc) !== 0) throw new Unverified('0xa7acd4 generator +0xcc');
  if (m.u8(gen + 0x43) & 0xf) throw new Unverified('0xa7ad08 generator +0x43 low nibble');
  lastPass(m, gen, p);
  sc.free();
  return (m.u32(p + 0xc) >>> 26) & 1;
}

// 0xa6703c: advance a texture animation block (flags, frames, counter, speed). Returns 0 when a
// kill-at-end animation runs out.
export function texAnimStep(m, gen, p, anim, s16){
  if (m.u8(p + 0xc) & 4) throw new Unverified('0xa6705c particle flag 2');
  if (m.u8(p + 0x12) & 8) throw new Unverified('0xa670ac particle +0x12 bit 3');
  const fl = m.u32(anim);
  if (!(fl & 1)) return 1;
  let s0 = m.f32(anim + 8);
  const s2 = m.f32(anim + 0xc);
  const packed = m.u32(anim + 4);
  if (fl & 4) throw new Unverified('0xa67164 reverse texture animation');
  s0 = F(s2 + s0);
  m.wf32(anim + 8, s0);
  if (s0 < F(packed & 0xffff) || Number.isNaN(s0)) return 1;
  if (fl & 2) throw new Unverified('0xa67230 looping texture animation');
  m.wf32(anim + 8, F(F(packed >>> 16) + 0.9999899864196777)); // 0.99999 at 0xa67148
  return (fl & 8) ? 0 : 1;
}

// 0xa7aecc: one LiteBillboard particle, one frame. Returns 0 to free it.
export function updateLBParticle(m, gen, p){
  const s0a = m.f32(p + 0xa0);
  const sl = m.u32(p + 0xc);
  if (texAnimStep(m, gen, p, p + 0x60, s0a) !== 1) return 0;
  m.w32(p + 0x7c + ((m.u8(p + 0xf) & 1) << 4), m.u32(p + 0x68));
  if (m.u8(p + 0x12) & 2) throw new Unverified('0xa7af28 colour curve');
  let bit, prevBit;
  if (!(sl & 0x40)){
    m.u32(p + 8);
    const wc = m.u32(p + 0xc);
    bit = (wc >>> 24) & 1; prevBit = (wc >>> 25) & 1;
    m.w32(p + 0x90 + (bit << 2), m.u32(p + 0x98));
  } else {                                                   // 0xa7af98
    const g40 = m.u32(gen + 0x40); m.u32(gen + 0x44);
    const col = m.u32(p + 0x98);
    const mode = (g40 >>> 12) & 0xf;
    if (mode === 0) throw new Unverified('0xa7b054 colour mode 0');
    const pool = m.u32(gen + 0x24), lo = m.u32(gen + 0xc4), lsz = m.u16(gen + 0xd8);
    const w8 = m.u32(p + 8), wc = m.u32(p + 0xc);
    const e = toS32(F(m.f32((pool + lo + lsz * (w8 & 0xffff)) >>> 0) * 256.0));   // 256.0 at 0xa7afc4
    bit = (wc >>> 24) & 1; prevBit = (wc >>> 25) & 1;
    m.w32(p + 0x90 + (bit << 2), envColour(col, mode, e));
  }
  const f10 = m.u32(p + 0x10);
  if (f10 & 0x100100){
    if (scaleStep(m, gen, p, 0.0) !== 1) return 0;           // 0.0 at 0xa7b0ac
    m.u32(p + 8);
    const wc2 = m.u32(p + 0xc);
    bit = (wc2 >>> 24) & 1; prevBit = (wc2 >>> 25) & 1;
  }
  const s0 = m.f32(gen + 0xfc);
  if (sl & 8) throw new Unverified('0xa7b0fc particle flag 3');
  m.wf32(p + 0x70 + (bit << 4), F(m.f32(p + 0x40 + (bit << 2)) * s0));
  const r3 = m.u32(p + 0x10);
  if (r3 & 0x1000000) throw new Unverified('0xa7b198 particle +0x10 bit 24');
  if (r3 & 1){                                               // 0xa7b134: size y += rate, rate damped
    const rate = m.f32(p + 0xa4);
    m.wf32(p + 0x70 + (bit << 4) + 4, F(rate + m.f32(p + 0x70 + (prevBit << 4) + 4)));
    const damped = F(rate * m.f32(m.u32(gen + 0x34) + 0x190));
    if (sl & 0x2000) throw new Unverified('0xa7b168 particle flag 13');
    m.wf32(p + 0xa4, damped);
  }
  if (r3 & 8) throw new Unverified('0xa7b200 particle +0x10 bit 3');
  return 1;
}

// 0xa7adac (slot 24): the LiteBillboard particle pass.
export function billboardFrame(m, gen){
  if (baseFrame(m, gen) !== 1) return 0;
  let p = m.u32(gen + 0xb0);
  while (p){
    if (updateLBParticle(m, gen, p) === 1) p = m.u32(p + 4);
    else p = killParticle(m, gen, p);
    const d0 = m.u32(gen + 0xd0), d4 = m.u32(gen + 0xd4);
    const rest = [];
    for (let i = 0; i < 6; i++) rest.push(m.u32(gen + 0xd8 + 4 * i));
    m.w32(gen + 0xd0, ((d0 & 0xffff) | (((d0 + 0x10000) >>> 0) & 0xffff0000)) >>> 0);
    m.w32(gen + 0xd4, d4);
    for (let i = 0; i < 6; i++) m.w32(gen + 0xd8 + 4 * i, rest[i]);
  }
  if (m.u8(gen + 0x43) & 0xf) throw new Unverified('0xa7ae58 generator +0x43 low nibble');
  if (m.u32(gen + 0xcc) !== 0 && m.u32(gen + 0xb0) !== 0) throw new Unverified('0xa7aeb8 generator +0xcc');
  return 1;
}
