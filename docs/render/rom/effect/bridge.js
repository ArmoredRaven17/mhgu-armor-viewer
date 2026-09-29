// THE BRIDGE BETWEEN HAND TRANSLATIONS AND LIFTED ROUTINES.
//
// Most of the runtime is translated by hand (life.js, motion.js, spawn.js ...); some routines are lifted
// instruction by instruction (lifted-*.js, on cpu.js) because they are long and their hand translation
// would add nothing but risk. Both are checked against the same call vectors. This file lets each call
// the other:
//
//   liftedCall(m, address, args, stack, singles)  a lifted routine from hand code. Its stack is a frame
//                                                 of scratch memory, which the checker never compares.
//   the natives below                             hand code from a lifted routine: arguments read out of
//                                                 r0-r3, the stack words and s0 as the procedure call
//                                                 standard passes them, the result put back in r0 or s0,
//                                                 and the other scratch registers poisoned (cpu.js).
import { Cpu, call, registerNative, clobber, toS32 } from './cpu.js';
import { Unverified } from './mem.js';
import { Scratch } from './motion.js';
import * as life from './life.js';
import * as motion from './motion.js';
import * as spawn from './spawn.js';
import * as billboard from './billboard.js';
import * as polyline from './polyline.js';
import { internals as C } from './construct.js';
import * as owner from './owner.js';

export function liftedCall(m, address, args = [], stack = [], singles = []){
  const sc = new Scratch(m);
  const frame = sc.alloc(0x1000);
  const c = new Cpu();
  for (let k = 0; k < args.length; k++) c.r[k] = args[k] >>> 0;
  const sp = ((frame + 0x1000 - 16 - 4 * stack.length) & ~0xf) >>> 0;
  for (let k = 0; k < stack.length; k++) m.w32(sp + 4 * k, stack[k] >>> 0);
  c.r[13] = sp;
  c.r[14] = 0xfffffffe;
  for (let k = 0; k < singles.length; k++) c.sf[k] = singles[k];
  call(m, c, address);
  sc.free();
  return c;
}

// argument sources: 'r0'..'r3', 'st0'.. (stack words), 's0' (a single); result: 'r0', 's0' or null
const stackWord = (m, c, k) => m.u32((c.r[13] + 4 * k) >>> 0);
function native(address, fn, argSpec, result){
  registerNative(address, (m, c) => {
    const args = argSpec.map(a => a[0] === 'r' ? c.r[+a[1]] : a === 's0' ? c.sf[0] : stackWord(m, c, +a.slice(2)));
    const ret = fn(m, ...args);
    clobber(c);
    if (result === 'r0') c.r[0] = ret >>> 0;
    else if (result === 's0') c.sf[0] = ret;
  });
}
// registered lazily: polyline.js and construct.js import this file, so their exports may not exist yet
const A1 = ['r0'], A2 = ['r0', 'r1'], A3 = ['r0', 'r1', 'r2'], A4 = ['r0', 'r1', 'r2', 'r3'];

// 0x1ebe8 / 0x29d00, the matrix products, run LIFTED (lifted-math.js), not as these hand translations: the ROM routines
// push d8-d15 on entry, and a later routine reads that dead stack -- the genType-2 draw 0xa996e4 copies a local buffer
// with one word it never initialises (0x7ffffcd8 in efx/vectors/node_k5), which in the game holds what 0x29d00 pushed.
// polyline.matMul / matMulTo stay for the JS callers.
import './lifted-math.js';
native(0x320ed4, (m, ...a) => spawn.eulerMatrix(m, ...a), A3, null);

// 0xca6874(params, v1, v2, mul, s0 = the camera distance) -> an int: the DISTANCE FADE the draws apply (110 callers).
// Translated whole, every branch from the instructions, because which branch runs is the viewer's camera
// distance and no recorder camera reaches them all (the roar's cm202_050 models met 0xca68fc live). Checked
// against the recorded vectors (dev/effect-check.mjs) and, every branch, against the ROM's own routine run under
// the emulator over 264 flag x distance cases, NaN included (efx/fadegrid.py -> dev/effect-fadegrid.mjs). Flag bit 29 turns the fade on: 0 up to +0x10, rising to 1
// at +0x14 (bit 30: stays 0), 1 up to +0x18, falling to 0 at +0x1c (bit 31: 0 from +0x18), 0 beyond +0x1c.
// Bit 7 multiplies in an angle factor (0xca6988) no recording reaches: refused.
const F = Math.fround;
export function distanceFade(m, p, v1, v2, mul, d){
  let s16 = 1.0;
  const flags = m.u32(p);
  if (flags & 0x20000000){                                          // 0xca688c
    const s6 = m.f32(p + 0x10);
    if (s6 >= d) s16 = 0;                                           // bge 0xca68ec (unordered: not taken)
    else {
      const s4 = m.f32(p + 0x1c);
      if (s4 <= d) s16 = 0;                                         // bls 0xca68fc
      else {
        const s8 = m.f32(p + 0x14);
        if (s8 <= d || Number.isNaN(s8) || Number.isNaN(d)){        // ble 0xca6944 (unordered: taken)
          const s18 = m.f32(p + 0x18);
          if (s18 < d){                                             // bpl 0xca6900 when s18 >= d or unordered
            if ((flags | 0) < 0) s16 = 0;                           // 0xca6958 blt
            else s16 = F(1 - F(F(d - s18) / F(s4 - s18)));          // 0xca6960
          }
        } else if (flags & 0x40000000) s16 = 0;                     // 0xca68cc
        else s16 = F(F(d - s6) / F(s8 - s6));                       // 0xca68d4
      }
    }
  }
  if (flags & 0x80) throw new Unverified('0xca6908 distance fade with the angle factor 0xca6988');
  const f28 = m.f32(p + 0x28);                                      // 0xca6914
  const s0 = F(F(f28 + F(s16 * F(1 - f28))) * 256);
  return Math.imul(toS32(s0) | 0, mul | 0) >> 8;                    // vcvt.s32.f32, mul, asr #8
}
native(0xca6874, (m, p, v1, v2, mul, d) => distanceFade(m, p, v1, v2, mul, d), ['r0', 'r1', 'r2', 'r3', 's0'], 'r0');
native(0xb8ef7c, (m, ...a) => C.workArea(m, ...a), A3, 'r0');
native(0xa55fe0, (m, ...a) => C.generatorInit(m, ...a), A4, 'r0');
native(0xa562a0, (m, ...a) => C.generatorStart(m, ...a), A1, null);
native(0xa58690, (m, ...a) => C.generatorSizes(m, ...a), A3, 'r0');
native(0xa588b8, (m, ...a) => C.paramBit16(m, ...a), A1, 'r0');
// The effect's move (0x9b6130) and everything it runs -- nodes, a generator's update, spawn, particle frames,
// emitter shapes, curves ... -- are LIFTED
// (lifted-particles.js, from every recorded run: Savage's, Deviljho's and Teostra's); the hand translations
// they replaced -- spawnBase, baseFrame, scaleInit, velDir, the colour and scale inits, the billboard and
// polyline helpers, killParticle, generatorTransform -- stay for the checker, and no longer answer calls.
// The heap the engine allocates from (0x189f148 +0x20 -> an allocator object): vtable +0x1c alloc(size,
// align), +0x34 free(pointer). The emulator harness (efx_emu.py, efx_load.py) points them at its stub
// entries 0x7e000000 and 0x7e000104, so those are the addresses lifted code calls through; a host lays
// its allocator object out the same way.
native(0x7e000000, (m, self, size, align) => m.svc.alloc(size, align), A3, 'r0');
native(0x7e000104, (m, self, p) => { m.svc.free(p); return 0; }, A2, 'r0');
native(0x13ecc68, (m, d, s, n) => { for (let i = 0; i < n; i++) m.w8(d + i, m.u8(s + i)); }, A3, null);   // __aeabi_memcpy
native(0x13ecc08, (m, d, s, n) => { for (let i = 0; i < n; i++) m.w8(d + i, m.u8(s + i)); }, A3, null);   // __aeabi_memcpy4
native(0x13ece30, (m, d, s, n) => { for (let i = 0; i < n; i++) m.w8(d + i, m.u8(s + i)); }, A3, null);   // __aeabi_memcpy8
// The allocator an engine object is made with: 0x7a75a0 picks one per DTI from a table; the emulator harness
// hooks it to answer every DTI with its allocator object (efx_emu.py ALLOC_OBJ), which a host lays out the
// same way (vtable +0x1c / +0x34 above).
export const ALLOCATOR = 0x600f0000;
native(0x7a75a0, () => ALLOCATOR, [], 'r0');
// The resource manager's release (its vtable +0x3c, reached through 0x884698): the harness's is a stub at
// 0x7e000144 (efx_load.py resmgr_vt15) that frees nothing and returns 0; a host points its resource
// manager's vtable +0x3c there.
export const RESMGR_RELEASE = 0x7e000144;
native(RESMGR_RELEASE, () => 0, [], 'r0');
// 0x9baa9c (uEffect vtable +0xd0): the start, which setting an effect's list calls (0x9ba238, lifted-proof.js)
native(0x9baa9c, (m, ...a) => C.startEffect(m, ...a), A1, 'r0');
// 0x9bd16c / 0x9bd174 (uEffect vtable +0xf8 / +0x100, the proof effect's too): each one instruction, `bx lr` -- every
// register comes back as it went in, so no clobber. A cParticleNode's frame prep (0xaeda7c) and pre-update (0xaedafc)
// call them on the owner.
registerNative(0x9bd16c, () => {});
registerNative(0x9bd174, () => {});
// A parent unit's getDTI (vtable +0x14), which a start on a parent asks (0x9ba080 walks the chain for
// uModel). The emulator's stand-in parent (efx/parent.py GETDTI) answers from this address with its
// monster's class: uEm043_00's DTI 0x184a218 (its getDTI thunk 0xe812ac, GOT 0x18325fc). A host whose
// parent is another monster sets that monster's class.
export const PARENT_GETDTI = 0x7e001000;
let parentClass = 0x184a218;
export function setParentClass(dti){ parentClass = dti >>> 0; }
native(PARENT_GETDTI, () => parentClass, [], 'r0');
// The LiteBillboard generator's getDTI (its vtable at 0x17890b4 slot 5 / +0x14 is the ROM thunk 0xa81ed4,
// which tail-calls through GOT 0x183c8a0 to the generator type's DTI 0x211c66c). A type check the effect
// runs at 0x440d4 (getDTI, then compare [DTI+4]); the recorded monsters' billboards never reached slot 5,
// cm200_007's (Raging Brachydios' enrage effect) does. Same shape as PARENT_GETDTI: return the DTI.
native(0xa81ed4, () => 0x211c66c, [], 'r0');
// The Model generator's getDTI, the same shape: cParticleGeneratorModel's vtable 0x1789734 slot 5 / +0x14 is the thunk
// 0xa981a8 (`ldr r0, [pc, r0]` of GOT 0x1836364 -> the type's DTI 0x211c9ec, on the same exported page). The same type
// check reaches it from Raging Brachydios' cm202_070 (c 70: L0 Motion[50] / [51]).
native(0xa981a8, () => 0x211c9ec, [], 'r0');
// cParticleNode's getDTI, the third of the same shape and reached the same way. Its vtable 0x1789ebc slot 5
// / +0x14 is the ROM thunk 0xaf266c (`ldr r0,[pc,#4]; ldr r0,[pc,r0]; bx lr`), whose .data variable 0x1832438
// holds the type's DTI 0x211cd5c -- the same DTI construct.js names when it builds a type-25 row through
// 0xaece5c/0xaece98. Its sibling cParticleNodeInfinite answers 0x211cd7c from 0xaf2694 and is not reached yet.
// The caller is again the type check at 0x440d4 (getDTI, then compare [DTI+4]); no recorded run had asked a
// NODE for its type before Congalala, whose em021_00_000 gas records stopped every effect he has with
// `call to 0xaf266c, which is not translated`. (2026-09-25.)
native(0xaf266c, () => 0x211cd5c, [], 'r0');
// The fourth and fifth of the same shape, both reached by the same 0x440d4 type check, both 2026-09-26:
//   * 0xaf2694 is slot 5 / +0x14 of vtable 0x1789f20 -- cParticleNodeInfinite, the sibling the comment above
//     said was "not reached yet". SHAGARU MAGALA reaches it (em072_00, L2 Motion[49], key 290 on Gore's own
//     em071_00_017.efl), which stopped every effect he has.
//   * 0xaa8978 is slot 5 / +0x14 of vtable 0x1789834 -- a generator class between Model's 0x1789734 and
//     NodeInfinite's; its NAME is NOT READ, only its vtable and its DTI. MIZUTSUNE reaches it (em082_00) on
//     eleven motions across L2 and L3.
// Both DTIs are read from the thunk's own .data variable, not from the comment above: `ldr r0,[pc,#4]` takes the
// literal at fn+12, and `ldr r0,[pc,r0]` resolves against pc = fn+12, giving 0x183ca0c and 0x183c95c. The METHOD
// was validated by reproducing all three known answers exactly -- 0xa81ed4 -> 0x211c66c, 0xa981a8 -> 0x211c9ec,
// 0xaf266c -> 0x211cd5c -- because a first attempt that was 4 bytes off returned plausible VTABLE addresses
// (0x1789f18, 0x178982c) rather than DTIs, which would have answered the type check with a wrong type silently.
// The 0xaf2694 value also independently matches what the comment above had recorded for it.
native(0xaf2694, () => 0x211cd7c, [], 'r0');
native(0xaa8978, () => 0x211ca8c, [], 'r0');
// The sixth, and it is the SAME record still walking further: 0x43f38 is an isKindOf, not an equality test --
// 0x44124 compares the exact DTI type id and 0x4413c follows DTI+0x10 up the PARENT CHAIN on a mismatch, falling
// out at 0x447a4. Registering 0xaf2694 let the check ask the question; the answer then took the parent walk, which
// no recording had covered (every prior run matched exactly at the first compare). Recording Shagaru covered the
// walk, and the walk asks the NEXT generator in the chain for its type -- 0xaba21c, slot 5 / +0x14 of vtable
// 0x1789bb4, DTI 0x211cbac. Class name NOT READ. (em072_00 L2 Motion[49], key 290, 2026-09-26.)
native(0xaba21c, () => 0x211cbac, [], 'r0');

// ---- a monster's effect request, whole (proof.js ProofRequest; efx/proofunit.py) -------------------------
// uMHProofEffect's move (0x327188) ends in uEffect's own move, and its owner matrix (vtable +0x50, 0x3273e8)
// is a branch to uEffect's: both are lifted now (lifted-particles.js).
native(0x939278, (m, model, joint) => owner.jointMatrix(m, model, joint), A2, 'r0');   // uModel's joint matrix
native(0x9b4184, () => 1, [], 'r0');                   // uEffect vtable +0x88: mov r0, #1
// the constructors the request's objects start from, translated by hand (construct.js): cUnit's and uEffect's base
native(0x884990, (m, p) => { C.unitCtor(m, p); return p; }, A1, 'r0');
native(0x9b1f1c, (m, p) => { C.effectBaseCtor(m, p); return p; }, A1, 'r0');
// 0xb01c44, THE ATOMIC RELEASE -- the one routine in the cParticleNodeInfinite chain lift.py cannot take (LDAEX /
// STLEX / CLREX). Hand-translated from the ROM at 0xb01c44..0xb01cd8 rather than stubbed, because this is what
// destroys a GPU particle record: the Infinite node's teardown reaches it through 0xb977b0 on every play, and a stub
// would leak the record and never run its deleting destructor.
//   ip = obj; r0 = obj + 8; r3 = [r0]; r4 = r3 - 1; the LDAEX/STLEX pair writes r4 back and retries on contention --
//   with one thread here the result is the same as the plain store. If r4 != 0 it returns (0xb01c94 popne, with r0
//   still obj + 8). Otherwise it compares [obj+4] against [0x211d120] SIGNED (0xb01cac is `bge`, not `bhs`) and,
//   when LESS, TAIL-CALLS the object's own vtable slot 1 -- the deleting destructor -- with r0 = obj
//   (0xb01cb0..0xb01cc0). The other side (0xb01cc4: an append to the device's deferred-destruction array through
//   0xbbf5b8) is NOT READ, so it refuses rather than guesses.
//   [obj+4] IS A GPU FENCE STAMP and the sign is the whole point: nDraw::VertexBuffer's constructor chain
//   (0xb082e0 -> 0xcc86e8 -> 0xb01aa0) writes 0xFFFFFFFF there, meaning "never submitted", and the two sites that
//   ever stamp it (0x87af3c, 0x8ae2a4) write [0x211d120] + [0x211d124] -- the device's frame counter plus the frames
//   in flight, i.e. "free me once the GPU has passed the frame I was last drawn in". Nothing on the effect path
//   stamps it, so an undrawn buffer keeps -1 and is destroyed at once. A DRAWN one is stamped, and then only a
//   RUNNING frame counter makes it come due -- proof.js unitFrame advances 0x211d120 once a frame for exactly this
//   reason. With it running, 0xbbf5b8 and its drain (0xbbdc34, from the device's frame end 0xbbd8ac) stay dead code
//   here rather than something the viewer skips; with it parked at 0 every drawn buffer deferred and leaked.
//   THE COMPARE MUST BE `| 0`, NOT toS32: toS32 is the SATURATING float->int conversion (vcvt.s32.f32), which turns
//   0xFFFFFFFF into 2147483647 and sends every buffer down the deferred branch. That cost an afternoon.
registerNative(0xb01c44, (m, c) => {
  const obj = c.r[0] >>> 0;
  const n = (m.u32((obj + 8) >>> 0) - 1) >>> 0;
  m.w32((obj + 8) >>> 0, n);
  if (n !== 0){ clobber(c); c.r[0] = (obj + 8) >>> 0; return; }
  if ((m.u32((obj + 4) >>> 0) | 0) >= (m.u32(0x211d120) | 0))
    throw new Unverified('0xb01cc4 release through 0xbbf5b8, which is not read (stamp ' + (m.u32((obj + 4) >>> 0) | 0) + ' vs device frame ' + (m.u32(0x211d120) | 0) + ', in flight ' + (m.u32(0x211d124) | 0) + ')');
  const rc = liftedCall(m, m.u32((m.u32(obj) + 4) >>> 0), [obj]);
  clobber(c); c.r[0] = rc.r[0] >>> 0;
});
// 0xaee2dc: three instructions, `r1 = [r0]; r1 = [r1 + 0x40]; bx r1` -- a bare tail call through the generator's
// vtable SLOT 16, which the effect's move reaches at 0x9b65b0. A native rather than a lift because lifting a computed
// tail call would only reproduce the dispatch: this reads the slot and runs what is in it, passing r0-r3 through as
// the branch does. Both cParticleNode (vtable 0x1789ebc) and cParticleNodeInfinite (0x1789f20) hold 0xaedafc there,
// which is lifted -- the Infinite node is the first to come through the thunk rather than call it directly.
registerNative(0xaee2dc, (m, c) => {
  const obj = c.r[0] >>> 0;
  const rc = liftedCall(m, m.u32((m.u32(obj) + 0x40) >>> 0), [obj, c.r[1], c.r[2], c.r[3]]);
  clobber(c); c.r[0] = rc.r[0] >>> 0;
});
// cUnit's empty virtual (vtable +0x2c of both the core and the effect): bx lr.
registerNative(0x1eba8, () => {});
// The unit manager's add (0xc03670: sUnit, line, unit, ...): the harness hooks it to return at once with the
// registers as they were, keeping the unit for its passes; so does this, into m.svc.registerUnit.
registerNative(0xc03670, (m, c) => { m.svc.registerUnit(c.r[0] >>> 0, c.r[1] >>> 0, c.r[2] >>> 0, c.r[3] >>> 0); });
// The enemy's parent handle (enemy +0xfd0) as the harness stands it in (proofunit.py): vtable +0 valid,
// +4 the unit.
export const HANDLE_VALID = 0x7e001004, HANDLE_GET = 0x7e001008;
// the parent unit's +0x10c: a proof effect's first frame hands itself to its parent (0x43cac); the harness's
// stand-in keeps nothing and answers 0 (efx/parent.py ADD_EFFECT)
export const PARENT_ADD_EFFECT = 0x7e001010;
native(PARENT_ADD_EFFECT, () => 0, [], 'r0');
native(HANDLE_VALID, (m) => m.svc.handleValid(), [], 'r0');
native(HANDLE_GET, (m, h) => m.svc.handleUnit(h), A1, 'r0');           // the handle's own parent (proof.js)
// The resource manager's load (vtable +0x30) a request's state machine calls for its record's path
// (0x323b40): the host answers with the list it loaded (m.svc.requestLoad).
export const REQUEST_LOAD = 0x7e00100c;

// materialAt (0x88db14 = model->materials[+0xf8][i]) and the material's own vmethods. A MODEL effect's
// ed&4 records ask the model for each material (0x88be08's fill loop, then the draw) -- but no recorder or
// host builds model material OBJECTS: materials are resolved from the .mrl at draw time (modeldraw.js).
// So the host answers materialAt with a stand-in object, exactly as efx/engdraw.py does for the recorder.
// MATERIAL_VM is every slot of its vtable: it must leave r0 alone, because the fill loop STORES the return
// of vt+0x1c (addref) into the table.
export const MATERIAL_VM = 0x7e001010;
native(MATERIAL_VM, () => {}, [], null);
native(0x88db14, (m, model, index) => m.svc.materialAt(model, index), A2, 'r0');
native(REQUEST_LOAD, (m, self, dti, path, flags) => m.svc.requestLoad(dti, path, flags), A4, 'r0');
// libm, as the emulator's imports compute it (build/arm/emu.py _on_plt): the float32 argument, the double
// result rounded to float32, in s0.
const f32 = Math.fround;
function libm(address, fn){
  registerNative(address, (m, c) => { const a = c.sf[0], b = c.sf[1]; const r = fn(a, b); clobber(c, true); c.sf[0] = f32(r); });
}
libm(0x13ecba8, (a, b) => Math.atan2(a, b));           // atan2f
libm(0x13ecc2c, a => Math.cos(a));                     // cosf
libm(0x13ecc14, a => Math.sqrt(a));                    // sqrtf
libm(0x13ecc20, a => Math.sin(a));                     // sinf
libm(0x13ecfc8, a => (a < -1 || a > 1) ? NaN : Math.asin(a));   // asinf (math.asin raises -> nan)
native(0x13ecd34, (m, d, n, v) => { for (let i = 0; i < n; i++) m.w8(d + i, v & 0xff); return d; }, A3, 'r0');   // __aeabi_memset4(dest, n, c)
native(0x13ecd58, (m, d, n, v) => { for (let i = 0; i < n; i++) m.w8(d + i, v & 0xff); return d; }, A3, 'r0');   // __aeabi_memset8(dest, n, c)
native(0x13ecbb4, (m, d, n) => { for (let i = 0; i < n; i++) m.w8(d + i, 0); return d; }, A2, 'r0');          // __aeabi_memclr4(dest, n)
native(0x13ecbfc, (m, d, n) => { for (let i = 0; i < n; i++) m.w8(d + i, 0); return d; }, A2, 'r0');          // __aeabi_memclr8(dest, n)
native(0x13ecbe4, (m, d, n) => { for (let i = 0; i < n; i++) m.w8(d + i, 0); return d; }, A2, 'r0');          // __aeabi_memclr(dest, n)
native(0x13ece0c, () => 0, [], 'r0');   // nn::os::GetCurrentThread: 0, as the emulator answers an unknown import
// 0x9bd170, uEffect vtable +0xfc: bx lr (the generator's preUpdate calls it) -- touches no register
registerNative(0x9bd170, () => {});
// 0x9bca30, the node DRAW-REGISTRATION: the lifted node update (L_9bba54) reaches it by a direct bl when a
// node sets +0x110 bit 12 (Soulseer em082_04's eye flame does). It walks the render singleton's passes and
// combines each with the camera -- the viewer stands up no render singleton and draws every effect itself
// through host.drawFrame, so this is LEFT OUT, exactly as owner.js's hand nodeUpdate skips the same branch
// (the vtable path). Its return is unused by the caller (0x9bca18 falls straight into the epilogue).
registerNative(0x9bca30, () => {});
// nn::os::InitializeMutex (a singleton's constructor): the emulator's import does nothing and answers 0
native(0x13ecde8, () => 0, [], 'r0');
// the effect manager's unique id (0xb8f4b8: lock, ++[mgr +0x22c], unlock), the harness's next_id service
native(0xb8f4b8, (m, mgr) => m.svc.nextId(mgr), A1, 'r0');
