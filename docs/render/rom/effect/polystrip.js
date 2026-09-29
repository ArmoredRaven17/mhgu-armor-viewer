// GENERATOR TYPE 15 -- cParticleGeneratorPolygonStrip: the spawn and the particle frame.
//
// The efl's generator type 15. Unlike type 2 this class IS named by the ROM: the factory's jump table at
// 0x9badec sends type 15 to 0x9bb0b0, which allocates 0x1d0 through 0xaa8c00 and constructs with 0xaa8c3c;
// that constructor stores *(GOT 0x183c9a4) + 8 = vtable 0x1789b34, whose slot 5 getDTI 0xaae0a0 loads the
// .data variable 0x183c9a0 -> MtDTI 0x211cb5c, and the registration that builds that MtDTI (0xaae138) passes
// the rodata string "cParticleGeneratorPolygonStrip" at 0x15751e6.
//   The class is one of the two the generator note's kind table pins by hand -- PolygonStrip is kinds 0x08 and
// 0x20 at generator +0x46 (effects-generator.md) -- so the name here is read, not inferred from adjacency.
//
// Only the two slots that differ from the shared routines are here; construct.js registers +0x18 / +0x20 /
// +0x3c (0xaa8c90 / 0xaa8cc8 / 0xaa8df8) and the rest of the vtable is code the translated types already run:
// +0x1c 0xa56174, +0x24 0xa56960, +0x28 0xa56a40, +0x2c 0xa56bac, +0x30 0xa56c10, +0x34 0xa77fac,
// +0x38 0xa55ce0, +0x40 0xa570fc (the shared pre-update Model, LitePolyline and type 2 all take),
// +0x48 0xa574c4 (the shared driver), +0x58 0xa58590.
//
// ASTALOS IS WHY THIS EXISTS. em081_00_003 is 3 model rows, 1 polyline and 1 type 15, and his u 202's row
// masks enable ONLY the type-15 row -- so with the type skipped the effect built no generator at all and
// 0x9bb320 refused, stopping every effect he has. A skipped generator is survivable when something else in
// the file still builds; here nothing did.
import { liftedCall } from './bridge.js';
import './lifted-particles.js';

// 0xaaa1fc (vtable +0x5c): one particle spawned into `p` from the generator's parameter block, `info`
// carrying the spawn's position, the unit interval along the emission and the seed. Returns 1 when the
// particle was taken, which is what the caller (emit.js) requires.
export function spawnPolygonStrip(m, gen, p, info){
  return liftedCall(m, 0xaaa1fc, [gen, p, info]).r[0];
}

// 0xaaa9e8 (vtable +0x60): the generator's particles, one frame.
export function polygonStripFrame(m, gen){
  return liftedCall(m, 0xaaa9e8, [gen]).r[0];
}
