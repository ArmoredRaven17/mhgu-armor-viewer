// FLAT MEMORY FOR THE EFFECT RUNTIME.
//
// The particle code is a translation of MHGU's own routines, and those routines keep their state in
// packed C++ structs: two-buffer vectors selected by a flag bit, bitfields shared between phases,
// counters in the high half of a word. Keeping the same bytes at the same offsets is what lets every
// translated routine be checked against the game byte for byte (dev/effect-check.mjs replays call
// vectors recorded from the emulator), so the runtime stores its state the way the game does rather
// than in objects of our own design.
//
// Addresses are plain numbers. Memory is sparse pages, so a test can load the exact addresses the
// emulator used and the viewer can lay its structs out wherever it likes.

export class Unverified extends Error {
  // A branch of a ROM routine that no recorded call has exercised. The runtime refuses it rather
  // than guess: extend the vectors (another effect that takes the branch) and translate it then.
  constructor(where){ super('unverified path: ' + where); this.name = 'Unverified'; }
}

const PAGE = 4096;
const f32buf = new Float32Array(1), u32of = new Uint32Array(f32buf.buffer);

export class Mem {
  constructor(){
    this.pages = new Map();
    this.onRead = null;           // (addr, size) -- set by the checker
    this.onWrite = null;          // (addr, size, bytes)
  }
  page(a){
    const k = Math.floor(a / PAGE);
    let p = this.pages.get(k);
    if (!p){ p = new Uint8Array(PAGE); this.pages.set(k, p); }
    return p;
  }
  load(addr, bytes){ for (let i = 0; i < bytes.length; i++) this.page(addr + i)[(addr + i) % PAGE] = bytes[i]; }
  rawByte(a){ return this.page(a)[a % PAGE]; }

  u8(a){ a >>>= 0; if (this.onRead) this.onRead(a, 1); return this.rawByte(a); }
  u16(a){ a >>>= 0; if (this.onRead) this.onRead(a, 2); return this.rawByte(a) | (this.rawByte(a + 1) << 8); }
  u32(a){
    a >>>= 0; if (this.onRead) this.onRead(a, 4);
    return (this.rawByte(a) | (this.rawByte(a + 1) << 8) | (this.rawByte(a + 2) << 16) | (this.rawByte(a + 3) << 24)) >>> 0;
  }
  i32(a){ return this.u32(a) | 0; }
  f32(a){ u32of[0] = this.u32(a); return f32buf[0]; }

  w8(a, v){ a >>>= 0; const b = [v & 0xff]; if (this.onWrite) this.onWrite(a, 1, b); this.load(a, b); }
  w16(a, v){ a >>>= 0; const b = [v & 0xff, (v >>> 8) & 0xff]; if (this.onWrite) this.onWrite(a, 2, b); this.load(a, b); }
  w32(a, v){
    a >>>= 0; v >>>= 0;
    const b = [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    if (this.onWrite) this.onWrite(a, 4, b); this.load(a, b);
  }
  wf32(a, v){ f32buf[0] = v; this.w32(a, u32of[0]); }
}

// IEEE single-precision helpers: every VFP s-register operation is one of these.
export const F = Math.fround;
export function f32bits(v){ f32buf[0] = v; return u32of[0]; }
export function bitsf32(u){ u32of[0] = u >>> 0; return f32buf[0]; }
