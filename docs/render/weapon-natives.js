// THE PLAYER EFFECTS' TWO NATIVE ANSWERS, shared by render/weapon-fx.js (the page) and dev/effect-export-rom-w08.mjs (the
// page exporter's soak, which runs the same host in node and must answer them the same way).
import { registerNative, clobber } from './rom/effect/cpu.js';
import { Unverified } from './rom/effect/mem.js';

// TWO ROM ROUTINES THE LIFTER CANNOT REACH, answered here as the ROM answers them (2026-09-28). Every player
// effect whose particle nodes take a colour walks them (0x43f38 -> 0x447b4 at start, 0x3273ec every frame:
// per cParticleNode with a colour nibble, the core's vtable +0x78 then the colour lookup 0x320e00), and the
// emulator harness never constructs a cParticleNode (efx_emu.py: no node manager), so no recording covers
// them and lift.py has nothing to translate. This is THIS APP'S OWN: it belongs upstream once the harness
// builds the node manager, and until then rom/effect/*.js stays untouched.
//   0x43400  uMHEffectCore vtable +0x78 -- `mov r0, #0; bx lr` -- the base core's colour sub-index, 0.
//   0x320e00 the colour lookup, (out, node, block, idx): with block +0x97 set, the colour-control table entry
//            block +0xc4 sub-entry idx; with block +0xc3 set, the same table by the node's nibble; else the
//            record's own colour at block +0xb4, stored to out, returning 1. The two table branches read the
//            colour-control manager (*0x18323dc / *0x18323d8, rProofEffectColorControl, per stage), which
//            this image does not carry, so they refuse the way an unlifted branch does.
registerNative(0x43400, (m, c) => { clobber(c); c.r[0] = 0; });
registerNative(0x320e00, (m, c) => {
  const out = c.r[0] >>> 0, block = c.r[2] >>> 0;
  if (m.u8(block + 0x97)) throw new Unverified('0x320e00: colour-control table by index (block +0x97), the manager *0x18323dc is not in the image');
  if (m.u8(block + 0xc3)) throw new Unverified('0x320e00: colour-control table by node nibble (block +0xc3), the manager *0x18323d8 is not in the image');
  const colour = m.u32(block + 0xb4);
  clobber(c);
  m.w32(out, colour);
  c.r[0] = 1;
});

export const WEAPON_NATIVES = [0x43400, 0x320e00];
