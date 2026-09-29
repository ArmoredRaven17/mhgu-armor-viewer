// GENERATOR TYPE 2 -- the spawn and the particle frame.
//
// The efl's generator type 2, whose class the ROM builds with vtable 0x1789834 (GOT 0x183c960). It is NOT
// named here: the 27 cParticleGenerator* names live in rodata, but the genType -> class mapping is pinned
// only for 5 <-> Model, so a name would be a guess (construct.js's GENERATOR_TYPES says the same).
//
// Only the two slots that differ from the shared routines are here. The rest of the vtable is the same
// code the translated types already run: +0x1c 0xa56174 (pool link), +0x24 0xa56960 (seed start),
// +0x30 0xa56c10 (frame prep), +0x40 0xa570fc (pre-update), +0x48 0xa574c4 (the generator update),
// +0x50 0xa77fb4 (no post pass) -- and construct.js registers +0x18 / +0x20 / +0x3c.
//
// Both routines below are the lifted ROM code, covered by the recorded call vectors of three runs that
// build a type-2 generator: cm202_250 (em043_05u:10), em007_04_008 (em007_04u:631) and em007_04_006
// (em007_04u:781). Between them the spawn ran 6 times and the particle frame 134.
import { liftedCall } from './bridge.js';
import './lifted-particles.js';

// 0xa9cfc4 (vtable +0x5c): one particle spawned into `p` from the generator's parameter block, `info`
// carrying the spawn's position, the unit interval along the emission and the seed. Returns 1 when the
// particle was taken, which is what the caller (emit.js) requires.
export function spawnType2(m, gen, p, info){
  return liftedCall(m, 0xa9cfc4, [gen, p, info]).r[0];
}

// 0xa9d630 (vtable +0x60): the generator's particles, one frame.
export function type2Frame(m, gen){
  return liftedCall(m, 0xa9d630, [gen]).r[0];
}
