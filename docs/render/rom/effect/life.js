// PARTICLE LIFE: the phase envelope every particle carries in its generator's life slot.
//
// Translated from MHGU 0xaeae40 and checked against call vectors recorded from the game's own run of
// Savage's em043_05_002_s (dev/effect-check.mjs). Life slot, 16 bytes, one per particle:
//
//   +0x0  f32   envelope value (the particle's fade), written only when it changes
//   +0x4  u32   w0 | w1 << 16            fade-in and hold lengths, from the row's col2 block
//   +0x8  u32   w2 | counter << 16       fade-out length and the running phase counter
//   +0xc  u32   phase << 16 | sustain << 24
//
// Phases: 1 fade-in, 2 hold, 3 fade-out, 4 dead. The fade-in value is (counter + 1) / (w0 + 1), the
// fade-out value counter / w2 counting down; the hold writes nothing. A particle with the sustain bit
// holds for as long as its generator keeps bit 28 of +0x40 set. Particle +0x0c gains 0x40 whenever
// the value changed this frame -- the Model update recomputes its colour only then -- and the call
// returns 0 once the particle reaches phase 4.
//
// Squaring the value (generator +0x40 bit 30) is the caller's business: 0xa60f68.
import { Unverified, F } from './mem.js';
import { liftedCall } from './bridge.js';

export function updateLife(m, gen, p, slot){               // 0xaeae40
  const pflags = m.u32(p + 0x0c);
  const A = m.u32(slot + 0x4), B = m.u32(slot + 0x8), C = m.u32(slot + 0xc);
  if (pflags & 2) throw new Unverified('0xaeae64 particle release request (+0x0c bit 1)');
  let ip = pflags & 0xffff;
  const phase = (C >>> 16) & 0xff;
  const w0 = A & 0xffff, w1 = A >>> 16, w2 = B & 0xffff;
  const genFlagClear = where => {                          // 0xaeb0e0 / 0xaeb178: generator +0x13 & 0x20
    if (m.u8(gen + 0x13) & 0x20) throw new Unverified(where + ' generator +0x10 bit 29');
  };
  const store = (b, c) => { m.w32(slot + 0x4, A); m.w32(slot + 0x8, b); m.w32(slot + 0xc, c); };

  switch (phase){
    case 1: {                                              // 0xaeaec0 fade-in
      const counter = ((B >>> 16) + 1) & 0xffff;
      store((w2 | (counter << 16)) >>> 0, C);
      if (counter < w0){
        m.wf32(slot, F(F(counter + 1) / F(w0 + 1)));
        genFlagClear('0xaeb0e0');
        ip |= 0x40;
        break;
      }
      m.wf32(slot, 1.0);                                   // 0xaeafd0
      if (w1 !== 0){                                       // 0xaeafec -> 0xaeb0a4: into the hold
        const b2 = ((w1 << 16) | w2) >>> 0;
        store(b2, C);
        store(b2, ((C & 0xff00ffff) | 0x20000) >>> 0);
      } else {                                             // 0xaeb07c: no hold
        if (C & 0x1000000) throw new Unverified('0xaeb08c sustain with no hold');
        if (w2 === 0) throw new Unverified('0xaeb210 no hold and no fade-out');
        const b2 = ((w2 << 16) | w2) >>> 0;                // 0xaeb214 -> 0xaeb0ac: straight to fade-out
        store(b2, C);
        store(b2, ((C & 0xff00ffff) | 0x30000) >>> 0);
      }
      genFlagClear('0xaeb0e0');
      ip |= 0x40;
      break;
    }
    case 2: {                                              // 0xaeaf24 hold
      if ((C & 0x1000000) && (m.u32(gen + 0x40) & 0x10000000)){
        if (C & 0xffff) throw new Unverified('0xaeaf44 sustained hold, low word set');
        if ((B >>> 16) === 0) throw new Unverified('0xaeb184 sustained hold, counter 0');
        genFlagClear('0xaeb178');                          // 0xaeb064: held, nothing written
        break;
      }
      const b1 = ((((B & 0xffff0000) - 0x10000) >>> 0) | w2) >>> 0;   // 0xaeb038
      store(b1, C);
      if ((b1 & 0xffff0000) !== 0){ genFlagClear('0xaeb178'); break; }
      if (w2 === 0) throw new Unverified('0xaeb1b4 hold ends with no fade-out');
      const b2 = ((w2 << 16) | w2) >>> 0;                  // 0xaeb190: into the fade-out
      store(b2, C);
      store(b2, ((C & 0xff00ffff) | 0x30000) >>> 0);
      break;
    }
    case 3: {                                              // 0xaeaf78 fade-out
      const counter = ((B >>> 16) + 0xffff) & 0xffff;
      const b1 = (w2 | (counter << 16)) >>> 0;
      store(b1, C);
      if (counter !== 0){
        ip |= 0x40;
        m.wf32(slot, F(F(counter) / F(w2)));
        break;
      }
      m.wf32(slot, 0);                                     // 0xaeb010: dead
      store(b1, ((C & 0xff00ffff) | 0x40000) >>> 0);
      return 0;
    }
    default:
      throw new Unverified('0xaeae84 phase ' + phase);
  }
  m.w16(p + 0x0c, (m.u32(p + 0x0c) | ip) & 0xffff);         // 0xaeb1e8
  return 1;
}

// 0xcaa624: release a particle on its way to the free list. Clears flag bit 26; a particle holding
// an attached object at +0x4c (none in the recorded effects) would also drop it.
export function releaseParticle(m, p){
  const w8 = m.u32(p + 8), wc = m.u32(p + 0xc);
  m.w32(p + 8, w8);
  m.w32(p + 0xc, (wc & ~0x4000000) >>> 0);
  // 0xcaa63c: the ed&4 Model record this particle carries at +0x4c (made by 0xa925e8 -> 0xa92610). The
  // ROM releases it through the record's OWN vtable +0x40 and clears the pointer -- but only while the
  // record is in state 1 or 2 ([rec+0xc] & 7, then `sub r1,#1; cmp r1,#1; pophi` at 0xcaa650, so any
  // other state returns and leaves it attached).
  const rec = m.u32(p + 0x4c) >>> 0;
  if (rec !== 0 && ((((m.u32(rec + 0xc) & 7) - 1) >>> 0) <= 1)){
    liftedCall(m, m.u32((m.u32(rec) + 0x40) >>> 0) >>> 0, [rec]);
    m.w32(p + 0x4c, 0);
  }
}

// Unlink a particle from the generator active list (+0xb0 head, +0xb4 tail) and append it to the
// free list (+0xb8 head, +0xbc tail). Returns the particle that followed it. The same sequence is
// inlined at 0xa5825c, 0xa60fd4, 0xa606c8 and 0xa577a0; only the head-of-list, empty-free-list case
// has been recorded, so the others refuse.
export function unlinkToFree(m, gen, p, where){
  const prev = m.u32(p), next = m.u32(p + 4);
  if (prev !== 0) throw new Unverified(where + ' freeing a particle that is not the list head');
  m.w32(gen + 0xb0, next);
  if (next !== 0) m.w32(next, 0); else m.w32(gen + 0xb4, 0);
  if (m.u32(gen + 0xb8) !== 0){                             // behind the free list's tail
    m.w32(p, m.u32(gen + 0xbc));
    m.w32(m.u32(gen + 0xbc) + 4, p);
  } else {
    m.w32(p, 0);
    m.w32(gen + 0xb8, p);
  }
  m.w32(gen + 0xbc, p);
  const ret = m.u32(p + 4);
  m.w32(p + 4, 0);
  return ret;
}

// 0xa5825c: free one particle; returns the next.
export function killParticle(m, gen, p){
  releaseParticle(m, p);
  return unlinkToFree(m, gen, p, '0xa58270');
}

// 0xa60f68: the life pass over every live particle (envelope kinds 1 and 2). With generator +0x40
// bit 30 set -- node block +0x08 bit 27, see 0xae99f8 -- the stored value is squared.
export function lifePass(m, gen){
  let p = m.u32(gen + 0xb0);
  if (!(m.u8(gen + 0x43) & 0x40)){                           // 0xa60f80: the value as it is
    while (p){
      const slot = (m.u32(gen + 0x24) + m.u32(gen + 0xc4) + m.u16(gen + 0xd8) * m.u16(p + 8)) >>> 0;
      if (updateLife(m, gen, p, slot) !== 1) throw new Unverified('0xa60fcc linear pass frees a particle');
      p = m.u32(p + 4);
    }
    return;
  }
  while (p){
    const slotOf = () => (m.u32(gen + 0x24) + m.u32(gen + 0xc4) + m.u16(gen + 0xd8) * m.u16(p + 8)) >>> 0;
    if (updateLife(m, gen, p, slotOf()) === 1){
      const s = slotOf();
      const v = m.f32(s);
      m.wf32(s, Math.fround(v * v));
      p = m.u32(p + 4);
    } else {
      releaseParticle(m, p);
      p = unlinkToFree(m, gen, p, '0xa610c0');
    }
  }
}
