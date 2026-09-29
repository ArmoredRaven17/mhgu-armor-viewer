// LOADING: an .efl (rEffectList) and an .ean (rEffectAnim) read the way the game reads them.
//
// Translated from MHGU and checked against call vectors from the game's own loads of the eleven
// em043 effect lists (dev/effect-check.mjs). The outside world is reached through m.svc:
//   streamSize(stream), streamRead(stream, buf, n) -> n     the file's bytes
//   alloc(size, align) -> address, free(address)            the heap
//   loadResource(dti, pathAddress, flags) -> handle         the resource manager (vtable +0x30)
import { Unverified, F } from './mem.js';

export const DTI = {
  rEffectList: 0x211e7b8,      // GOT 0x18355c0
  rEffectAnim: 0x2122a64,      // GOT 0x183d358
  rModel: 0x211e1c8,           // GOT 0x1832280
  rTexture: 0x211e5d0,         // GOT 0x1838604
};

const bfi = (dst, src, lsb, width) => {
  const mask = ((1 << width) - 1) >>> 0;
  return ((dst & ~((mask << lsb) >>> 0)) | ((src & mask) << lsb)) >>> 0;
};
function clear(m, dst, n){ for (let i = 0; i < n; i++) m.w8(dst + i, 0); }
function copy(m, dst, src, n){ for (let i = 0; i < n; i++) m.w8(dst + i, m.u8(src + i)); }   // __aeabi_memcpy

// 0xb5a060: release whatever a previous load left (a fresh list has nothing).
function listRelease(m, rl){
  if (m.u32(rl + 0x70) !== 0) throw new Unverified('0xb5a074 reloading a list with entries');
  if (m.u32(rl + 0x68) !== 0) throw new Unverified('0xb5a108 reloading a list with a body');
  m.w32(rl + 0x6c, 0);
  if (m.u32(rl + 0x80) !== 0) throw new Unverified('0xb5a140 reloading a list with a child list');
}

// 0xb597a8: the entry array (0x44 bytes per row, one more when +0x7c has a low nibble) and the body.
function listAllocate(m, rl, bodySize){
  if (bodySize === 0) throw new Unverified('0xb598a0 empty body');
  listRelease(m, rl);
  const w74 = m.u32(rl + 0x74), w78 = m.u32(rl + 0x78), w7c = m.u32(rl + 0x7c);
  let n = w74;
  if (w7c & 0xf) n = (n + 1) >>> 0;
  m.w32(rl + 0x74, w74); m.w32(rl + 0x78, ((w78 & 0xffff0000) | (n & 0xffff)) >>> 0); m.w32(rl + 0x7c, w7c);
  const count = n & 0xffff;
  const block = m.svc.alloc((8 + Math.imul(count, 0x44)) >>> 0, 0x10);
  m.w32(block, 0x44); m.w32(block + 4, count);
  const entries = (block + 8) >>> 0;
  for (let e = entries; e !== (entries + Math.imul(count, 0x44)) >>> 0; e = (e + 0x44) >>> 0){
    clear(m, e, 0x40);                                                     // __aeabi_memclr4
    m.w32(e + 0x40, 0x40a00000);
  }
  m.w32(rl + 0x70, entries);
  const body = m.svc.alloc(bodySize, 0x10);
  m.w32(rl + 0x68, body);
  if (body === 0) throw new Unverified('0xb598a0 body allocation failed');
  clear(m, body, bodySize);
  m.w32(rl + 0x6c, bodySize);
  return 1;
}

// 0xb589b4: an entry's resource slots (+0x08..+0x34) start empty.
function entryReset(m, entry){
  m.w32(entry, 0); m.w32(entry + 4, 0);
  for (let k = 8; k <= 0x34; k += 4) if (m.u32(entry + k) !== 0) throw new Unverified('0xb589d4 entry slot +0x' + k.toString(16) + ' already held');
}

// 0xb58ae8: resources a node block names (+0xb8 / +0xba / +0xbc; none recorded).
function nodeResources(m, entry, nb){
  if (nb === 0) return;
  if (m.u16(nb + 0xb8) !== 0) throw new Unverified('0xb58b0c node block resource +0xb8');
  if (m.u16(nb + 0xba) !== 0) throw new Unverified('0xb58b64 node block resource +0xba');
  if (m.u16(nb + 0xbc) !== 0) throw new Unverified('0xb58bbc node block resource +0xbc');
}

// 0xb592c0: resources the column-3 block names (none recorded).
function col3Resources(m, entry, blk, kind){
  if (blk === 0) return;
  if (kind > 8) return;
  if (kind === 3) throw new Unverified('0xb593c4 column 3 kind 3 resources');
  const w = m.u32(blk + 4);
  if ((w >>> 16) !== 0 && ((blk + (w >>> 16)) >>> 0) !== 0) throw new Unverified('0xb592fc column 3 resources');
}

// 0xb59178: a texture slot (+0x08 + 4 * slot) from a path.
function textureSlot(m, entry, path, slot){
  if (m.u8(path) === 0){
    if (slot !== 0) return;
    throw new Unverified('0xb59290 texture slot 0 without a path');
  }
  const h = m.svc.loadResource(DTI.rTexture, path, 0x80);
  m.w32(entry + 8 + 4 * slot, h);
  if (h === 0) throw new Unverified('0xb591cc texture request failed');
}

// 0xb58c24: the generator block's resources, by generator type.
const ANIM_TEXTURES_A = new Set([1, 2, 12, 15, 17, 23, 26]);   // 0xb58cbc
const ANIM_TEXTURES_B = new Set([0, 3, 13, 19, 20, 21]);       // 0xb58d08
function generatorResources(m, entry, blk, type){
  if (blk === 0 || type > 0x1a) return;
  if (type === 4 || type === 14 || type === 22) return;
  if (ANIM_TEXTURES_A.has(type) || ANIM_TEXTURES_B.has(type)){
    if (m.u8(blk + 0x130) !== 0){
      const h = m.svc.loadResource(DTI.rEffectAnim, (blk + 0x130) >>> 0, 1);
      m.w32(entry + 0x14, h);
      if (h === 0) throw new Unverified('0xb58cfc animation request failed');
    } else if (ANIM_TEXTURES_B.has(type)) throw new Unverified('0xb58d50 generator without an animation');
    textureSlot(m, entry, (blk + 0x70) >>> 0, 0);                            // 0xb58d60
    textureSlot(m, entry, (blk + 0xb0) >>> 0, 1);
    textureSlot(m, entry, (blk + 0xf0) >>> 0, 2);
    m.wf32(entry + 0x38, F(F(m.u16(blk + 0x68)) / 1000.0));
    m.wf32(entry + 0x3c, F(F(m.u16(blk + 0x6a)) / 1000.0));
    m.w32(entry + 0x40, m.u32(blk + 0x6c));
    if (m.u8(blk + 5) & 4) throw new Unverified('0xb58dd0 generator block +5 bit 2');
    return;
  }
  if (type === 5){                                                          // 0xb58de0: Model
    if (m.u8(blk + 0x50) === 0) throw new Unverified('0xb59050 Model without a mesh path');
    const h = m.svc.loadResource(DTI.rModel, (blk + 0x50) >>> 0, 1);
    m.w32(entry + 0x18, h);
    if (h === 0) throw new Unverified('0xb58e20 model request failed');
    const w = m.u32(blk + 0x138);
    if ((w & 0xffff) === 0) return;
    const path = (blk + (w & 0xffff)) >>> 0;
    if (m.u8(path) === 0) throw new Unverified('0xb59118 Model animation path empty');
    const a = m.svc.loadResource(DTI.rEffectAnim, path, 1);
    m.w32(entry + 0x14, a);
    if (a === 0) throw new Unverified('0xb590b8 Model animation request failed');
    return;
  }
  if (type === 25){                                                         // 0xb59004: an effect
    // animation at +0x60 (into entry +0x14, the same slot the ANIM cases and Model use) and then a
    // texture at +0xa0 into slot 0. Kushala's wind barrier (em024_00_100 / _101) is the first to use it.
    if (m.u8(blk + 0x60) !== 0){                                            // 0xb59008
      const h = m.svc.loadResource(DTI.rEffectAnim, (blk + 0x60) >>> 0, 1);
      m.w32(entry + 0x14, h);
      if (h === 0) throw new Unverified('0xb59044 type 25 animation request failed');
    }
    textureSlot(m, entry, (blk + 0xa0) >>> 0, 0);                           // 0xb590e8 -> 0xb59178
    return;
  }
  if (type === 9){                                                          // 0xb58ed8: the screen FILTER's mask
    // only for kind 0 (block +0x40) and a named mask (+0xa0): 0xb590f0 -> 0xb59178, an rTexture into slot 0
    // (entry +8). No shipped row names one (effects-filter.md section 8), so for them nothing loads.
    if (m.u8(blk + 0x40) !== 0 || m.u8(blk + 0xa0) === 0) return;
    textureSlot(m, entry, (blk + 0xa0) >>> 0, 0);
    return;
  }
  throw new Unverified('0xb58c4c generator resources, type ' + type);
}

// 0xb598b0: every row's resources, then the child list the header names.
function listResources(m, rl){
  if (m.u32(rl + 0x70) === 0) throw new Unverified('0xb59a6c list without entries');
  const rows = m.u16(rl + 0x74);
  if (rows === 0) throw new Unverified('0xb59990 list without rows');
  for (let i = 0; ; i++){
    const body = m.u32(rl + 0x68);
    const entry = (m.u32(rl + 0x70) + Math.imul(i, 0x44)) >>> 0;
    entryReset(m, entry);
    const row = (body + (i << 4)) >>> 0;
    const c0 = m.u32(row);
    nodeResources(m, entry, (c0 >>> 8) !== 0 ? (m.u32(rl + 0x68) + (c0 >>> 8)) >>> 0 : 0);
    const c3 = m.u32(row + 0xc);
    col3Resources(m, entry, (c3 >>> 8) !== 0 ? (m.u32(rl + 0x68) + (c3 >>> 8)) >>> 0 : 0, c3 & 0xf);
    const c1 = m.u32(row + 4);
    generatorResources(m, entry, (c1 >>> 8) !== 0 ? (m.u32(rl + 0x68) + (c1 >>> 8)) >>> 0 : 0, c1 & 0xff);
    if (!(i + 1 < m.u16(rl + 0x74))) break;
  }
  if (m.u16(rl + 0x74) < m.u16(rl + 0x78)) throw new Unverified('0xb599a4 list with extra entries');
  if (m.u32(rl + 0x80) !== 0) throw new Unverified('0xb59a08 list already holding a child');
  const off = m.u32(rl + 0x90);
  if (off === 0) return;
  const at = (m.u32(rl + 0x68) + off) >>> 0;
  if (at === 0) return;
  const noff = m.u16(at + 0xa);
  if (noff === 0) return;
  const path = (at + noff) >>> 0;
  if (path === 0 || m.u8(path) === 0) return;
  m.w32(rl + 0x80, m.svc.loadResource(DTI.rEffectList, path, 1));
}

// 0xb59604: rEffectList::load.
export function loadEffectList(m, rl, stream){
  const size = m.svc.streamSize(stream);
  if (size === 0) throw new Unverified('0xb59798 empty stream');
  const buf = m.svc.alloc(size, 0x10);
  if (buf === 0) throw new Unverified('0xb59798 read buffer allocation failed');
  if (m.svc.streamRead(stream, buf, size) !== size) throw new Unverified('0xb5977c short read');
  if (m.u32(buf) !== 0x4c4645) throw new Unverified('0xb59798 not an EFL');
  if (m.u32(buf + 4) !== 0x20120306) throw new Unverified('0xb59798 EFL version');
  m.w32(rl + 0x64, m.u32(buf + 0xc));
  const count = m.u16(buf + 0x10);
  const w74 = m.u32(rl + 0x74), w78 = m.u32(rl + 0x78), w7c = m.u32(rl + 0x7c);
  let r1 = ((w74 & ~0xffff) | count) >>> 0;
  const r0 = ((w78 & 0xffff) | ((count << 20) & 0xffff0000)) >>> 0;
  m.w32(rl + 0x74, r1); m.w32(rl + 0x78, w78); m.w32(rl + 0x7c, w7c);
  r1 = ((r1 & 0xffff) | (m.u32(buf + 0x10) & 0xffff0000)) >>> 0;
  m.w32(rl + 0x74, r1);
  let r7 = bfi(m.u32(buf + 0x14), w7c >>> 4, 4, 28);
  m.w32(rl + 0x7c, r7);
  r7 = bfi(r7, m.u32(buf + 0x14) >>> 4, 4, 4);
  m.w32(rl + 0x7c, r7);
  const b14 = m.u32(buf + 0x14);
  m.w32(rl + 0x78, r0); m.w32(rl + 0x74, r1);
  m.w32(rl + 0x7c, bfi(r7, b14 >>> 8, 8, 4));
  m.w32(rl + 0x84, m.u32(buf + 0x20)); m.w32(rl + 0x88, m.u32(buf + 0x24));
  m.w32(rl + 0x8c, m.u32(buf + 0x28)); m.w32(rl + 0x90, m.u32(buf + 0x2c));
  if (listAllocate(m, rl, m.u32(buf + 8)) !== 1) throw new Unverified('0xb5977c list allocation failed');
  copy(m, m.u32(rl + 0x68), (buf + 0x30) >>> 0, m.u32(rl + 0x6c));
  listResources(m, rl);
  m.svc.free(buf);
  return 1;
}

// 0xce14a4: rEffectAnim::load.
export function loadEffectAnim(m, anim, stream){
  const size = m.svc.streamSize(stream);
  if (size === 0) throw new Unverified('0xce1628 empty stream');
  const buf = m.svc.alloc(size, 0x10);
  if (buf === 0) throw new Unverified('0xce1628 read buffer allocation failed');
  if (m.svc.streamRead(stream, buf, size) !== size) throw new Unverified('0xce160c short read');
  if (m.u32(buf) !== 0x4e4145) throw new Unverified('0xce1628 not an EAN');
  if (m.u32(buf + 4) !== 0x20120224) throw new Unverified('0xce1628 EAN version');
  const n = m.u32(buf + 8);
  if (n === 0) throw new Unverified('0xce1608 EAN without data');
  if (m.u32(anim + 0x6c) !== 0) throw new Unverified('0xce1564 reloading an animation');
  m.w32(anim + 0x64, 0);
  const data = m.svc.alloc(n, 0x10);
  m.w32(anim + 0x6c, data);
  if (data === 0) throw new Unverified('0xce160c animation allocation failed');
  clear(m, data, n);
  m.w32(anim + 0x64, n);
  const hdr = m.u32(buf + 0xc);
  m.w32(anim + 0x68, bfi(m.u32(anim + 0x68), hdr, 0, 24));
  m.w32(anim + 0x68, ((hdr & 0xffffff) | ((m.u8(buf + 0xf) !== 0 ? 1 : 0) << 24)) >>> 0);
  copy(m, m.u32(anim + 0x6c), (buf + 0x10) >>> 0, n);
  m.svc.free(buf);
  return 1;
}

export const internals = { listRelease, listAllocate, entryReset, nodeResources, col3Resources, textureSlot, generatorResources, listResources };
