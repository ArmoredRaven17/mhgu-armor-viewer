// THE WEAPON MODEL'S OWN STATE: what the weapon part unit's per-type update does to its model every frame -- which mesh
// groups show, which material clip plays, which colour constants stand. Some of what reads as a weapon "aura" is this and
// not an effect record (build/notes/weapon-effects-guide.md 11b). Read 2026-09-29/30; every address is exefs/main.
//
// THE UPDATE: 0x307030 (the part unit's per-frame step) clears the part's trigger bits (+0x13e0 / +0x13e4), runs the carry
// state (0x3070f8), then the per-type function by the kind word +0x13d0 (0x3073b0's jump table: kind 1 -> 0x30aafc, the
// Sword & Shield; kind 9 -> 0x310300, the Long Sword), and keeps the bits as the previous frame's (+0x13e8 / +0x13ec).
// A gimmick trigger is 0x30890c(part, trigger, channel, flag): it sets the trigger's bit and, ON ITS RISING EDGE against
// the previous frame's bits, applies the trigger's .plgmktype record -- its on / off parts set / clear bits of the part's
// +0x110 / +0x114 words, the MESH-GROUP visibility mask (bit n = mesh group n), and its `anime` puts that material clip in
// animation slot 0 at time 0 (0xb09ae8) on every material whose colour channel ([mat+0x18] >> 22 & 0xff) is `channel`.
// Both classes here pass channel 8 for triggers 0..3 and channel 2 for the Long Sword's 20..23.
//
// THE COLOUR WRITERS, each over the model's materials of one colour channel:
//   0x53a254(part, channel, &rgba, flag)  CBMaterial.fReflectiveColor = rgb / 255 (the lookup 0xb0aac0 returns the constant
//                                         buffer's data: +0 fDiffuseColor, +0xc fTransparency, +0x10 fReflectiveColor, as
//                                         0x53a4ac's own writes show); flag 1 first sets slot 0 to clip 0xffff, none
//   0x53a3bc(part, channel, &rgba)        $Globals.fSpecularColor (+0xb0) = rgb / 255
//   0x53a738(part, channel, value)        CBMaterial.fTransparency = value
// None of them is undone by the material's own clips unless a clip's track writes that member.
//
// THE DRAWN FLAG the code reads is vtable +0x178 = byte +0x2749 bit 0 (0x2a1c84). The viewer has the Carry select and the
// stance, no per-frame flag. The Long Sword's reader (0x31068c) names seven motions under the flag's CLEAR branch, each
// with its frame window -- the sheathes 3 and 9, 95, 195, 196, 252 and the sharpening 255 -- so those actions run with
// the flag clear, and a drawn-list stance playing one reads clear here (drawnFlag). Every other drawn stance reads set.
import { slotOf, setOf } from './weapon-fx.js';

// THE MOTION the part code reads: 0x539330(player), decimal bank * 1000 + slot (the class list is bank 5, its Arts list
// bank 7), and player+0x500, its frame (60 a second from the action's top: a `_loop` stance adds its t0). No weapon
// stance (sheathed, a Hunter Pose) is id 0, which no test names.
export function motionAt(stance, time){
  const slot = stance ? slotOf(stance.clip) : null;
  if (slot === null) return { id: 0, frame: 0 };
  return { id: (setOf(stance.file) === 'sa' ? 7000 : 5000) + slot, frame: ((time || 0) + (stance.t0 || 0)) * 60 };
}
const CLEAR_SLOTS = new Set([3, 9, 95, 195, 196, 252, 255]);
export function drawnFlag(drawn, motion){
  return !!drawn && !(motion.id > 5000 && motion.id < 6000 && CLEAR_SLOTS.has(motion.id - 5000));
}

// ---- the Long Sword (kind 9, 0x310300) ------------------------------------------------------------------------------
// THE SPIRIT GAUGE is the level +0x3330 (vtable +0x808 reads, +0x80c writes): 1..3 the white, yellow and red gauge, and 4,
// which vtable +0x3e0 (0x119598c) sets while the style byte (vtable +0x168, the equipment block +0x4d9) is 5 and the
// second status word's hi 0x40000 stands (vtable +0x1b0) -- Valor (Raven, 2026-09-29: "Levels 1-3 and Valor colors").
// While the player's mode word +0x13c8 is 0 (the others fire trigger 2 or 3 and nothing below), 0x310300 asks
// spiritFlags and fires what it answers: drawn -> trigger 1, sheathed -> 0, then 20 (no level), 21 / 22 / 23 (levels
// 1 / 2 / 3; level 4 fires 23 too), all but 0 / 1 with channel 2. Every display type's record (docs/weapons/w07.json
// shared.gmk) shows mesh group 21 -- the channel-2 additive overlay -- on 21..23 and hides it on 0..3 and 20, and the
// anime is 2 / 1 / 0, the overlay's clips `white` / `yellow` / `red` (6-frame loops of fReflectiveColor, fTransparency
// and $Globals.fSpecularColor). Some display types swap the blade's other groups with it (1, 5, 7, 9, 10).
//   0x31068c(part, disp, player, &b27, &b26, &b25, &b24, &b23, &b22, &b21) -- b27 drawn, b26 sheathed, b25 trigger 20,
// b24..b22 the three levels, b21 level 4. `disp` is the part's +0x13f4, the weapon list's mDispType (models[id].disp);
// `onBack` the weapon unit's mount index (+0x13d4 | 0x10) == 0x12. A +0x2506 / +0x250a action-kind test (0x800 and
// motion 48) has no counterpart in the viewer and reads false.
export function spiritFlags({ drawn, motion: m, frame: fr, onBack, disp, level }){
  let b27 = 0, b26 = 0, b25 = 0, b24 = 0, b23 = 0, b22 = 0, b21 = 0;
  const setLevel = () => {                  // the jump tables on vtable +0x808 - 1; anything else is trigger 20
    if (level === 1) b24 = 1; else if (level === 2) b23 = 1; else if (level === 3) b22 = 1; else if (level === 4) b21 = 1; else b25 = 1;
  };
  let at = 'L74c';
  if (drawn){
    if (m > 5001){                                                         // 0x3108fc
      if (m === 5002) at = fr < 10 ? 'L74c' : 'Lba8';                      // the draw: the blade is out from frame 10
      else if (m === 5115 || m === 5126) at = fr < 4 ? 'L74c' : 'Lba8';
      else at = 'Lbb4';
    } else {
      const r = m - 1005;                                                  // a mask of 30 common motions (bank 1)
      at = (r >= 0 && r <= 29 && ((0x2000c7db >>> r) & 1)) ? 'L74c' : 'Lbb4';
    }
  }
  if (at === 'Lbb4'){ if (onBack) b26 = 1; else b27 = 1; at = 'L74c'; }   // 0x310bb4: the mount index
  if (at === 'Lba8'){ b27 = 1; at = 'L758'; }
  if (at === 'L74c'){
    if (b27) at = 'L758';
    else {                                                                 // 0x3107a0: the flag's clear branch
      if (m <= 5194){
        if (m === 5003){ if (fr < 49){ b27 = 1; b25 = 1; } else b26 = 1; }
        else if (m === 5009){ if (fr < 43){ b27 = 1; b25 = 1; } else b26 = 1; }
        else if (m === 5095){ if (fr >= 36) b26 = 1; else { b27 = 1; setLevel(); } }
        else b26 = 1;
      } else if (m === 5195 || m === 5196){ b27 = 1; setLevel(); }
      else if (m === 5252){ if (fr < 92){ b27 = 1; setLevel(); } else b26 = 1; }
      else if (m === 5255){ if (fr >= 20 && fr < 324){ b27 = 1; b25 = 1; } else b26 = 1; }
      else b26 = 1;
    }
  }
  if (at === 'L758') setLevel();
  // 0x3109c8's tail, by display type
  if (disp === 9 && b26){
    if (m === 5127){ b27 = 1; b26 = 0; b25 = 1; }
    else if (!onBack){ b27 = 1; b26 = 0; b25 = 1; b24 = b23 = b22 = b21 = 0; }
  } else if (disp === 6){
    if (m === 5252){ if (fr >= 90){ b26 = 1; b25 = b24 = b23 = b22 = b21 = 0; } else { b27 = 1; setLevel(); } }
    else if (m === 5003){ if (fr >= 36){ b27 = 0; b26 = 1; b25 = 0; } else { b27 = 1; b25 = 1; } }
  }
  return { t1: !!b27, t0: !!b26, t20: !!b25, t21: !!b24, t22: !!b23, t23: !!(b22 || b21), blue: !!b21 };
}
// LEVEL 4's COLOUR, every frame it stands (0x3104e4..0x3105b4): the part's timer +0x1404 runs by the unit's delta
// (0x539d48), the pulse is 1 - timer / 8 to timer 3, then 0.5 + (timer - 3) / 8 to 6, where the timer goes back to 0
// and the pulse is 1 -- then 0x53a254(part, 2, colour, 1) (slot 0 none, fReflectiveColor), 0x53a3bc (fSpecularColor) and
// 0x53a738 (fTransparency = the pulse), the colour 0x00ff8000 with the pulse as its alpha: RGB 0, 128, 255.
export const SPIRIT_BLUE = [0, 128 / 255, 1];
export function spiritPulse(timer, dt){
  timer += dt;
  if (timer <= 3) return { timer, value: 1 - timer * 0.125 };
  if (timer - 3 <= 3) return { timer, value: 0.5 + (timer - 3) / 3 * 0.375 };
  return { timer: 0, value: 1 };
}

// ---- the Sword & Shield (kind 1, 0x30aafc) --------------------------------------------------------------------------
// THE OILS are items (Affinity, Destroyer, Stamina, Mind's Eye: item effects 0x5e..0x61 set the class's type +0x3328 and
// timer +0x3330 through vtable +0x530 / +0x534) and the status word's lo 1 / 2 / 4 / 8 stand while one lasts. With the
// mode word 0, 0x30aafc fires trigger 1 or 0 (channel 8) by snsFlags, then, while any of the four stands, sets the
// +0x110 bit of mesh group 21 -- or 31 when the sword is not drawn on eleven models -- and clears the other; with none
// it clears both. When the type changes (+0x1410) it writes the type's colour through 0x53a254(part, 2, colour, 0): the
// oil's colour over fReflectiveColor, the sphere map's tint, on the channel-2 overlay every model carries in group 21
// (123 of 123), whose own auto clip keeps pulsing fTransparency 0 -> 1 -> 0 over 60 frames. Nothing tests Chaos Oil.
export const OIL_RGB = [[1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1]];   // the .bss table 0x30ab3c fills, byte 0 red
const OIL_31 = new Set([46, 99, 130, 131, 142, 155, 173, 179, 183, 185, 188]);    // 0x30acc4's table and the 46 test
export function oilPart(drawn, model){ return drawn ? 21 : (OIL_31.has(model) ? 31 : 21); }
// 0x30af7c(part, disp, player, &b7, &b6): the drawn (b7) and sheathed (b6) triggers
export function snsFlags({ drawn, motion: m, frame: fr, onBack, disp }){
  let b7 = 0, b6 = 0;
  if (m === 5195 || m === 5196) b7 = 1;
  else if (m === 5095){ if (fr < 31) b7 = 1; else b6 = 1; }
  else if (m === 5252){ if (fr < 78) b7 = 1; else b6 = 1; }
  else if (!drawn || onBack) b6 = 1;
  else b7 = 1;
  if ((disp === 4 || disp === 1) && b6 && !onBack){ b7 = 1; b6 = 0; }
  else if (disp === 2 && b6 && m === 5255 && fr >= 20 && fr < 324){ b7 = 1; b6 = 0; }
  return { t1: !!b7, t0: !!b6 };
}
