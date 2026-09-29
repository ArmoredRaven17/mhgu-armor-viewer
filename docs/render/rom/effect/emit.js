// EMISSION: when a generator spawns, and how many.
//
// Translated from MHGU and checked against call vectors from the game's own run of Savage's
// em043_05_002_s (dev/effect-check.mjs).
//
// Generator fields used here:
//   +0x08 owner (uEffect)   +0x18 node instance   +0x30 node block (the .efl row's col0)
//   +0x40 packed: type | col2 tag << 8 | col3 tag << 16 | ... ; +0x47 emission state
//   +0x48 RNG counter: every random draw site increments it, drawn or not
//   +0x88 frames since start   +0x8c node block +0x08 (emission flags)   +0x194 thinning counter (byte 1)
//   +0xd0..+0xec a packed block the ROM always rewrites whole; +0xe2 is the emission countdown
//   +0x198 / +0x19c spawn counters   +0x1a8 u16 repeat count, +0x1aa u16 start offset
// Node block (192 bytes): +0x48 count, +0x4c start offset, +0x50 first interval, +0x54 period, each
// a u16 base with a u16 random range above it; +0x58 / +0x5c curve switches for the interval/period.
// Node instance +0x11c: the start delay, multiplied by the owner's count scale (+0x1fc).
import { Unverified, F } from './mem.js';
import { Scratch } from './motion.js';

export const RNG_TABLE = 0x1777eb0;          // 4096 u32 in .data, reached through GOT 0x183b9f4

// base + RNG % (range + 1) for a u16 base / u16 range field; the counter always advances.
function draw(m, gen, field){
  const c = (m.u32(gen + 0x48) + 1) >>> 0;
  m.w32(gen + 0x48, c);
  const f = m.u32(field);
  const base = f & 0xffff, range = f >>> 16;
  if (range === 0) return base;
  const r = m.u32(RNG_TABLE + 4 * (c & 0xfff));
  return (base + (r % (range + 1))) >>> 0;
}

// Read the packed +0xd0..+0xec block, set the countdown (+0xe2), write the block back whole.
function setCountdown(m, gen, value){
  const w = [];
  for (let i = 0; i < 8; i++) w.push(m.u32(gen + 0xd0 + 4 * i));
  w[4] = ((w[4] & 0xffff) | ((value & 0xffff) << 16)) >>> 0;
  for (let i = 0; i < 8; i++) m.w32(gen + 0xd0 + 4 * i, w[i]);
  return value & 0xffff;
}
const countdown = (m, gen) => (m.u32(gen + 0xe0) >>> 16);

function setState(m, gen, s){
  const g40 = m.u32(gen + 0x40), g44 = m.u32(gen + 0x44);
  m.w32(gen + 0x40, g40);
  m.w32(gen + 0x44, ((g44 & 0x00ffffff) | (s << 24)) >>> 0);
}

// VFP float -> u32 (vcvt.u32.f32): toward zero, saturating, NaN and negatives to 0.
function toU32(v){ return (Number.isNaN(v) || v <= 0) ? 0 : (v >= 4294967295 ? 4294967295 : Math.trunc(v)); }

// State 0, shared by both machines: clear the counters and load the start delay.
function restart(m, gen, clearThinning){
  m.w32(gen + 0x88, 0); m.w32(gen + 0x19c, 0); m.w32(gen + 0x198, 0);
  const owner = m.u32(gen + 8), inst = m.u32(gen + 0x18);
  const scale = toU32(m.f32(owner + 0x1fc));
  const delay = Math.imul(scale, m.u32(inst + 0x11c));
  setCountdown(m, gen, (delay >>> 0) & 0xffff);
  if (clearThinning){
    const t = m.u32(gen + 0x194);
    m.w32(gen + 0x194, (t & 0xff0000ff) >>> 0);
  }
  setState(m, gen, 1);
}

// Count the delay down; true when it has run out.
function delayDone(m, gen){
  const c = countdown(m, gen);
  if (c === 0) return true;
  setCountdown(m, gen, c - 1);
  return false;
}

// 0xa5949c: the first interval (node +0x50) into the countdown.
export function loadInterval(m, gen){
  const node = m.u32(gen + 0x30);
  if (m.f32(node + 0x58) !== 0) throw new Unverified('0xa59568 interval from a curve');
  setCountdown(m, gen, draw(m, gen, node + 0x50));
}

// 0xa59814: the period (node +0x54) into the countdown; returns 1 when it is not zero.
export function loadPeriod(m, gen){
  const node = m.u32(gen + 0x30);
  if (m.f32(node + 0x5c) !== 0) throw new Unverified('0xa598dc period from a curve');
  return setCountdown(m, gen, draw(m, gen, node + 0x54)) !== 0 ? 1 : 0;
}

// 0xa596e8: thin a spawn count by the effect's particle volume (generator +0x50 top nibble, the owner's
// mParticleVolume). Volume 2 and 3 pass the count through; 0 and 1 skip spawns with a counter at +0x195.
export function thinCount(m, gen, count){
  const vol = m.u32(gen + 0x50) >>> 28;
  if (vol === 1 || vol === 0) throw new Unverified('0xa596f0 particle volume ' + vol);
  return count;
}

// 0xae9e88: the emission-start hook. With the manager's gate (+0x231) set it would bind the node
// block's +0x30 target; neither Savage row asks for one, and its list entry has no +0x30 object.
export function emissionStart(m, gen){
  const mgr = m.u32(0x211f554);
  if (m.u8(mgr + 0x231) !== 0){
    const node = m.u32(gen + 0x30);
    if (m.u32(node + 0x30) & 0xff00) throw new Unverified('0xae9ec4 node +0x30 target');
  }
  const entry = m.u32(gen + 0x28);
  if (entry !== 0 && m.u32(entry + 0x30) !== 0) throw new Unverified('0xaea080 list entry +0x30 object');
}

// 0xa56bac (generator vtable slot 11): end the emission. Sets +0x10 bits 31 and 2 and state 5.
export function endEmission(m, gen, how){
  if (how === 1) throw new Unverified('0xae9b50 end emission mode 1');
  const f8c = m.u32(gen + 0x8c);
  if (f8c & 1) throw new Unverified('0xa56bc8 node flag 0');
  let state;
  if (!(f8c & 2) || how === 1){
    m.w32(gen + 0x10, (m.u32(gen + 0x10) | 0x80000004) >>> 0);
    state = 5;
  } else state = 6;
  const g40 = m.u32(gen + 0x40), g44 = m.u32(gen + 0x44);
  m.w32(gen + 0x40, g40);
  m.w32(gen + 0x44, ((g44 & 0x00ffffff) | (state << 24)) >>> 0);
}

// 0xa57938: emission mode A (col2 tag low nibble 1). One spawn when the start delay runs out.
export function emitOnce(m, gen){
  const state = m.u8(gen + 0x47);
  if (state === 0){
    restart(m, gen, false);
    if (!(m.u8(gen + 0x10) & 4)) return 0;
  } else if (state === 1){
    if (!(m.u8(gen + 0x10) & 4)) throw new Unverified('0xa57a48 mode A, generator inactive');
  } else if (state === 5){
    m.w32(gen + 0x88, (m.u32(gen + 0x88) + 1) >>> 0);
    return 0;
  } else throw new Unverified('0xa57970 mode A state ' + state);
  if (!delayDone(m, gen)) return 0;
  emissionStart(m, gen);                                     // 0xa57bbc
  m.w8(gen + 0x47, 3);
  endEmission(m, gen, 0);
  m.w32(gen + 0x88, (m.u32(gen + 0x88) + 1) >>> 0);
  return 1;
}

// 0xa57bfc: emission mode B (col2 tag low nibble 2). Start delay, a first interval, then a count of
// particles every period.
export function emitPeriodic(m, gen){
  let state = m.u8(gen + 0x47);
  if (state === 0){
    restart(m, gen, true);
    if (!(m.u8(gen + 0x10) & 4)) return 0;
    state = 1;
  }
  if (state === 1){
    if (!(m.u8(gen + 0x10) & 4)) throw new Unverified('0xa57d20 mode B, generator inactive');
    if (!delayDone(m, gen)) return 0;
    emissionStart(m, gen);                                   // 0xa57f4c: the delay ran out
    const node = m.u32(gen + 0x30);
    m.w16(gen + 0x1aa, draw(m, gen, node + 0x4c));
    m.w8(gen + 0x47, 2);
    state = 2;
  }
  if (state === 2) return spawnWave(m, gen);                 // 0xa57fac
  if (state === 4){                                          // 0xa57dac: counting the period down
    if (!(m.u8(gen + 0x10) & 4)) throw new Unverified('0xa57db4 mode B, generator inactive');
    const c = (countdown(m, gen) + 0xffff) & 0xffff;
    setCountdown(m, gen, c);
    if (c === 0){
      if ((m.u32(gen + 0x1a8) >>> 16) !== 0) throw new Unverified('0xa57e54 repeat count');
      setState(m, gen, 2);                                   // 0xa58170
    }
    m.w32(gen + 0x88, (m.u32(gen + 0x88) + 1) >>> 0);
    return 0;
  }
  if (state === 5){                                          // 0xa57f3c: finished
    m.w32(gen + 0x88, (m.u32(gen + 0x88) + 1) >>> 0);
    return 0;
  }
  throw new Unverified('0xa57c38 mode B state ' + state);
}

// 0xa57fac..0xa58160: load the interval, draw the count, thin it, and start the period.
function spawnWave(m, gen){
  loadInterval(m, gen);
  const f10 = m.u32(gen + 0x10);
  if ((f10 & 0x200) && (m.u8(gen + 0x8d) & 2)) throw new Unverified('0xa57fc8 random repeat count');
  m.w8(gen + 0x47, 3);
  if (!(f10 & 4)) throw new Unverified('0xa57ff8 mode B, generator inactive');
  const node = m.u32(gen + 0x30);
  if (f10 & 0x200) throw new Unverified('0xa58050 count from a curve');
  let count = draw(m, gen, node + 0x48);
  if (!(m.u8(gen + 0x8c) & 4)) count = thinCount(m, gen, count);
  const c = setCountdown(m, gen, (countdown(m, gen) + 0xffff) & 0xffff);
  if (c === 0){
    if (loadPeriod(m, gen) === 1) m.w8(gen + 0x47, 4);
    else {                                                   // 0xa58120: no period -- wave again
      const w = m.u32(gen + 0x1a8);
      if ((w >>> 16) === 0) m.w8(gen + 0x47, 2);
      else {                                                 // 0xa58130: a counted number of waves
        const left = ((w >>> 16) + 0xffff) & 0xffff;
        m.w32(gen + 0x1a8, ((w & 0xffff) | (left << 16)) >>> 0);
        if (left !== 0) m.w8(gen + 0x47, 2);
        else endEmission(m, gen, 0);                         // 0xa58184
      }
    }
  }
  m.w32(gen + 0x88, (m.u32(gen + 0x88) + 1) >>> 0);
  return count;
}

// 0xaebda8: the generator's visibility state for this frame. Only the plain case has been recorded:
// the owner is not in the mode (+0x118 top nibble 1) that hides generators, so +0x10 gains bit 2
// (active) and the state is 4.
export function visibilityState(m, gen){
  const owner = m.u32(gen + 8);
  const g50 = m.u32(gen + 0x50), o118 = m.u32(owner + 0x118);
  if ((g50 & 0xf000000) && (o118 & 0xf00000)) throw new Unverified('0xaebdc8 generator +0x50 view mask');
  const f10 = m.u32(gen + 0x10);
  if ((o118 & 0xf0000000) === 0x10000000) throw new Unverified('0xaebf94 owner +0x118 mode 1');
  m.w32(gen + 0x10, (f10 | 4) >>> 0);
  return 4;
}

// 0xaebc68: the generator colour curve (param block +0x3c). None recorded.
export function colourCurve(m, gen){
  const param = m.u32(gen + 0x34);
  if (param === 0) return;
  if (m.u16(param + 0x3c) !== 0) throw new Unverified('0xaebc8c generator colour curve');
}

// 0xa570fc (generator vtable slot 16 for Model and LitePolyline): this frame's generator transform.
// The node instance's matrix rows are scaled by the owner's scale factors (+0x1a0..+0x1a8, times
// the generator's +0xf8 and the owner's time scale +0x1b0) and by the node's own scale (+0xe0..);
// generators with +0xed bit 4 take the rotation from the ROM identity rows instead.
export function preUpdate(m, gen){
  const owner = m.u32(gen + 8);
  let s0 = m.f32(gen + 0xf8);
  const inst = m.u32(gen + 0x18);
  let s6 = m.f32(owner + 0x1b0), s2 = m.f32(owner + 0x1a4), s4 = m.f32(owner + 0x1a8), s8 = m.f32(owner + 0x1a0);
  const r1 = m.u32(inst + 0x10c);
  s6 = F(s0 * s6); s0 = F(s6 * s4); s2 = F(s6 * s2); s4 = F(s8 * s6);
  if (r1 & 0xf00000) throw new Unverified('0xa57138 node instance +0x10c scale mode');
  const s8b = m.f32(inst + 0xe4), s10 = m.f32(inst + 0xe8), s12 = m.f32(inst + 0xe0), s14 = m.f32(inst + 0xfc);
  s0 = F(s0 * s10); s2 = F(s2 * s8b); s4 = F(s4 * s12); s6 = F(s6 * s14);
  m.wf32(gen + 0xfc, s6);
  let row0, row1, row2;
  if (m.u8(gen + 0xed) & 0x10){                              // 0xa571c0: identity rows
    row0 = m.u32(0x1839d84); row2 = m.u32(0x1839d8c); row1 = m.u32(0x1839d88);
  } else { row0 = inst; row1 = inst + 0x10; row2 = inst + 0x20; }
  for (let k = 0; k < 4; k++) m.wf32(gen + 0x100 + 4 * k, F(s4 * m.f32(row0 + 4 * k)));
  m.wf32(gen + 0x110, F(s2 * m.f32(row1))); m.wf32(gen + 0x114, F(s2 * m.f32(row1 + 4)));
  m.wf32(gen + 0x118, F(s2 * m.f32(row1 + 8))); m.wf32(gen + 0x11c, F(s2 * m.f32(row1 + 0xc)));
  m.wf32(gen + 0x120, F(s0 * m.f32(row2))); m.wf32(gen + 0x124, F(s0 * m.f32(row2 + 4)));
  m.wf32(gen + 0x128, F(s0 * m.f32(row2 + 8))); m.wf32(gen + 0x12c, F(s0 * m.f32(row2 + 0xc)));
  for (let k = 0; k < 4; k++) m.w32(gen + 0x130 + 4 * k, m.u32(inst + 0x30 + 4 * k));
  m.w32(gen + 0x14c, 0);
  m.wf32(gen + 0x140, s4); m.wf32(gen + 0x144, s2); m.wf32(gen + 0x148, s0);
  const st = visibilityState(m, gen);
  if (st === 3 || st === 2) throw new Unverified('0xa572c0 visibility state ' + st);
  colourCurve(m, gen);
  if (m.u32(m.u32(owner) + 0xfc) !== 0x9bd170) throw new Unverified('0xa5739c owner vtable +0xfc');
  m.w32(gen + 0x10, (m.u32(gen + 0x10) | 0x20000) >>> 0);
}

// ---- the generator update (vtable slot 18, 0xa574c4) --------------------------------------------
// Per-type vtable slots, by the generator's vtable address. Types not translated yet refuse.
const TYPES = new Map();
export function registerType(vtable, slots){ TYPES.set(vtable, slots); }
function slotsOf(m, gen){
  const vt = m.u32(gen);
  const s = TYPES.get(vt);
  if (!s) throw new Unverified('generator vtable 0x' + vt.toString(16) + ' not translated');
  return s;
}

// 0xa574c4: one generator, one frame -- pre-update (slot 16), emission, spawns (slot 23) and the
// particle pass (slot 24). Returns 1.
export function generatorUpdate(m, gen){
  const w = [];
  for (let i = 0; i < 8; i++) w.push(m.u32(gen + 0xd0 + 4 * i));
  w[7] = (w[7] ^ 0x300) >>> 0;                               // +0xec bits 8 and 9 flip every frame
  for (let i = 1; i < 8; i++) m.w32(gen + 0xd0 + 4 * i, w[i]);
  m.w32(gen + 0xd0, w[0]);
  const T = slotsOf(m, gen);
  T.preUpdate(m, gen);
  const count = ((m.u32(gen + 0x40) & 0xf00) === 0x100) ? emitOnce(m, gen) : emitPeriodic(m, gen);
  if (m.u32(gen + 0x1b8) !== 0){
    const r0 = (m.u16(gen + 0x42) | (m.u32(gen + 0x44) << 16)) >>> 0;
    const sel = r0 & 0xf;
    if (m.u8(gen + 0xed) & 0x40){
      if (sel === 4 || sel === 3) throw new Unverified('0xa57590 generator +0x42 mode ' + sel);
    } else {
      if (sel === 4 || sel === 3) throw new Unverified('0xa575b8 generator +0x42 mode ' + sel);
      const v = [];
      for (let i = 0; i < 8; i++) v.push(m.u32(gen + 0xd0 + 4 * i));
      v[7] = (v[7] | 0x4000) >>> 0;
      for (let i = 0; i < 8; i++) m.w32(gen + 0xd0 + 4 * i, v[i]);
    }
  }
  if (count !== 0){
    const inv = F(1.0 / F(count >>> 0));
    const sc = new Scratch(m);
    const info = sc.alloc(0x2c);
    for (let i = 0; i < count; i++){
      const ctr = (m.u8(gen + 0x197) & 2) ? gen + 0x19c : gen + 0x198;
      const p = m.u32(gen + 0xb8);
      if (p === 0) continue;
      const next = m.u32(p + 4);
      const cval = m.u32(ctr);
      m.w32(gen + 0xb8, next);
      if (next !== 0) m.w32(m.u32(gen + 0xbc), 0);
      else m.w32(gen + 0xbc, 0);
      if (m.u32(gen + 0xb0) !== 0){
        m.w32(p, m.u32(gen + 0xb4));
        m.w32(m.u32(gen + 0xb4) + 4, p);
      } else {
        m.w32(p, 0);
        m.w32(gen + 0xb0, p);
      }
      m.w32(gen + 0xb4, p);
      m.w32(p + 4, 0);
      const c0 = m.u32(gen + 0xc0), idx = m.u16(p + 8), wc = m.u32(p + 0xc);
      m.w32(p + 0x14, 0);
      m.w32(p + 0x10, c0);
      m.w32(p + 0x4c, 0);
      m.w32(p + 0xc, ((wc & ~0x0fff0000) | (0x600 << 16)) >>> 0);
      m.w32(p + 8, (idx | (cval << 16)) >>> 0);
      const zero = m.u32(0x1831a78);
      m.w32(info, m.u32(zero)); m.w32(info + 4, m.u32(zero + 4)); m.w32(info + 8, m.u32(zero + 8));
      for (let k = 0xc; k <= 0x1c; k += 4) m.w32(info + k, 0);
      m.wf32(info + 0x20, 1.0);
      m.wf32(info + 0x24, F(inv * F(i >>> 0)));
      m.w32(info + 0x28, 0);
      if (T.spawn(m, gen, p, info) !== 1) throw new Unverified('0xa57780 spawn refused a particle');
      m.w32(gen + 0x198, (m.u32(gen + 0x198) + 1) >>> 0);
    }
    m.w32(gen + 0x19c, (m.u32(gen + 0x19c) + 1) >>> 0);
    sc.free();
  }
  if (m.u32(gen + 0x1b4) !== 0) throw new Unverified('0xa5781c generator +0x1b4 transform');
  T.particles(m, gen);
  for (let p = m.u32(gen + 0xb0); p; p = m.u32(p + 4)){         // 0xa578b4: +0x1c bit 13 from +0x1c4
    const v = m.u32(p + 0x1c);
    m.w32(p + 0x1c, m.u8(gen + 0x1c4) ? (v | 0x2000) >>> 0 : (v & ~0x2000) >>> 0);
  }
  const f10 = m.u32(gen + 0x10);
  m.w32(gen + 0x10, (f10 & ~0x60000000) >>> 0);
  if ((m.u32(gen + 0xd0) & 0xffff0000) === 0 && (f10 & 0x80000004) === 0x80000004)
    throw new Unverified('0xa5790c generator finished');
  return 1;
}
