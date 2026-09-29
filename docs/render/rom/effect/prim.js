// THE ENGINE'S PRIMITIVE DRAW.
//
// LiteBillboard and LitePolyline do not draw anything themselves: their draws (lifted-draw.js) leave
// primitive records and vertices in the worker's record list and dynamic vertex buffer (0x8a2e58). The
// draw system (*0x211f8b4, vtable 0x178e584) turns those into GPU draws: +0x30 (0xbad710) opens a view's
// primitive layer before the effect draws into it, +0x34 (0xbad790) sorts the layer (0xc8cbc8), draws
// it through +0x40 (0xbab58c: CBPrimitiveView, CBPrimitiveEx, samplers and the scene-UV clamp for the
// list; per record 0xbb1e10 the textures and shader features, then the batch draws +0x48..+0x54 with
// blend, depth and rasterizer states and the vertex upload) and closes it (0xc8cee4).
//
// All of that is LIFTED from the ROM into lifted-prim.js (C:\MHGU-Extract\efx\lift.py over the vectors
// efx/vecprim.py records) and checked byte for byte by dev/effect-check.mjs. What it calls outside the
// draw system is the draw context's own submission, which is where a viewer takes over:
//   0x87f734 begin a draw (the context resolves its shader)       -> m.svc.drawBegin(ctx)
//   0x881584 the GPU draw: (ctx, 0, vertices, indices; stride 0x20, &index pointer) -> vertex pointer
//                                                                  -> m.svc.primDraw(args, stack, cpu)
//   0x87f798 end a draw (the context submits it)                  -> m.svc.drawEnd(ctx)
//   0xbd0ab0 the render singleton's per-view setup (not read)     -> m.svc.renderSetup(args)
// The emulator's stand-ins for these return 0 (0x881584: the scratch vertex buffer), so the lifted code
// is verified against exactly that.
import { registerNative, clobber } from './cpu.js';
import { stackWords } from './draw.js';
import './lifted-prim.js';
import './bridge.js';                  // memcpy as natives

registerNative(0x87f734, (m, c) => { m.svc.drawBegin(c.r[0]); clobber(c); c.r[0] = 0; });
registerNative(0x87f798, (m, c) => { m.svc.drawEnd(c.r[0]); clobber(c); c.r[0] = 0; });
registerNative(0xbd0ab0, (m, c) => { m.svc.renderSetup([c.r[0], c.r[1], c.r[2]]); clobber(c); c.r[0] = 0; });
registerNative(0x881584, (m, c) => {
  const r0 = m.svc.primDraw([c.r[0], c.r[1], c.r[2], c.r[3]], stackWords(m, c, 2), c);
  clobber(c);
  c.r[0] = r0 >>> 0;
});
