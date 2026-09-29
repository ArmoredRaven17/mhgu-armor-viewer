// The effect runtime's entry points and the generator types it has translated.
//
// Generator types are dispatched by vtable address, exactly as the ROM dispatches them; a generator
// whose type is not registered here refuses to run (Unverified) rather than drawing something wrong.
import { registerType, preUpdate, generatorUpdate } from './emit.js';
import { spawnModel } from './spawn.js';
import { modelFrame } from './model.js';
import { preUpdateLB, spawnLB, billboardFrame } from './billboard.js';
import { spawnLPL, polylineFrame } from './polyline.js';
import { spawnType2, type2Frame } from './type2.js';
import { spawnPolygonStrip, polygonStripFrame } from './polystrip.js';

export const VTABLE = { Model: 0x1789734, LiteBillboard: 0x17890b4, LitePolyline: 0x1789bb4, Type2: 0x1789834,
                        PolygonStrip: 0x1789b34 };

// cParticleGeneratorModel: slot 16 0xa570fc, slot 23 0xa965c4, slot 24 0xa9718c
registerType(VTABLE.Model, { preUpdate, spawn: spawnModel, particles: modelFrame });
// cParticleGeneratorLiteBillboard: slot 16 0xa78464, slot 23 0xa7a8a8, slot 24 0xa7adac
registerType(VTABLE.LiteBillboard, { preUpdate: preUpdateLB, spawn: spawnLB, particles: billboardFrame });
// cParticleGeneratorLitePolyline: slot 16 0xa570fc, slot 23 0xab4710, slot 24 0xab4f64
registerType(VTABLE.LitePolyline, { preUpdate, spawn: spawnLPL, particles: polylineFrame });
// genType 2 (no class name is pinned for it): slot 16 0xa570fc -- the same shared pre-update Model and
// LitePolyline take -- slot 23 0xa9cfc4, slot 24 0xa9d630.
registerType(VTABLE.Type2, { preUpdate, spawn: spawnType2, particles: type2Frame });
// cParticleGeneratorPolygonStrip (genType 15): slot 16 0xa570fc -- the same shared pre-update -- slot 23
// 0xaaa1fc, slot 24 0xaaa9e8.
registerType(VTABLE.PolygonStrip, { preUpdate, spawn: spawnPolygonStrip, particles: polygonStripFrame });

export { generatorUpdate };
