// THE PRIMITIVE SHADER PROGRAM, LINKED FOR ONE DRAW.
//
// docs/effects/prim-shaders.json holds the shader package's functions for the primitive technique
// (TPrimitive: VS_Primitive / PS_Primitive and everything they call, over every variant the draws have
// selected) translated to GLSL ES 3.00 by C:\MHGU-Extract\efx\shader\glsl.py -- a mechanical translation
// of the package's expression trees with its declared types (see that file's header for the
// conventions: row-major matrices uploaded in stored order, HLSL conversions spelt out).
//
// A draw selects a variant per interface (the context slots the lifted primitive draw left, host.js's
// `features`) and an input layout (ctx+0x1c8). Linking is what the engine's shader resolve does for
// that selection: each interface call goes to the selected variant, or to the interface's own body
// when nothing selected one. The two entry points are wrapped for WebGL:
//
//   vertex    the layout's elements become attributes, bound to PRIMITIVE_VS_INPUT by semantic name;
//             gl_Position.z = 2z - w, because the device runs NVN's NEAR_IS_ZERO depth mode
//             (nvnDeviceSetDepthMode(dev, 1) at 0x866a48, see ../state.js): clip z spans 0..w there and
//             -w..w in GL, and the window depth comes out the same
//   fragment  PS_Primitive's parameters are bound to PRIMITIVE_VS_OUTPUT's members by semantic;
//             SV_POSITION is gl_FragCoord with its w back to the clip w a pixel shader's SV_POSITION carries
//             (GLSL's is 1/w) (window coordinates; used to sample screen textures,
//             which the viewer renders in GL's orientation)
//
// A variant the JSON does not carry throws: export it (glsl.py over a dump that selects it) rather than
// fall back to anything.
//
// OUTPUT: the fragment colour is the program's return value, unencoded. The game renders into RGBA8 UNORM
// colour targets: sRender's mSRGBEnable (+0x29) is !(ctor flags bit 9) (0xbb9dfc, its only store), the game
// builds its sRender with flags 0x133f (0x3d7f6c -> 0x3ddc9c; the game's own sRender newInstance 0x3ddb64
// passes the same), so it is 0, and the colour targets chosen by it are MT format 7 where they would be 9
// (0xbb9110, 0xbc26a4, 0xb021a8) -- format 7 is NVN RGBA8, 9 is RGBA8_SRGB (the format table, 0xb07e48).
// Nothing converts the colour on the way into the target, blending runs on the stored values, and at the
// game's default brightness (24: sRender Gamma = 0.4 + 0.025 x 24 = 1.0, 0x520a48 / 0x520984) the display
// shows them. A raw shader's output on the viewer's canvas is exactly that; the sRGB encode three.js applies
// to its own materials is not a step of this path. Textures are the same story: the effect textures are
// format 7 (RGBA8 UNORM), sampled without a decode (live.js loads them linear).

// The layout's element formats (chunk5-shaders Part 18; NVN attribute formats from 0xbd93d4):
// 1 F32, 3 S16, 4 U16, 7 S8 -- integer values reaching the shader as floats, unnormalised --
// 5 the 16-bit signed NORMALISED case (IAGPUParticle's TexCoordScl, the corners +-0x7fff / 0x8001 = +-1),
// 14 VertexColor, 4 bytes read as normalised RGBA8 (its conversion before that switch is not read).
export const FORMATS = {
  1: { array: Float32Array, size: 4, normalized: false },
  3: { array: Int16Array, size: 2, normalized: false },
  4: { array: Uint16Array, size: 2, normalized: false },
  5: { array: Int16Array, size: 2, normalized: true },
  7: { array: Int8Array, size: 1, normalized: false },
  8: { array: Uint8Array, size: 1, normalized: false },
  14: { array: Uint8Array, size: 1, normalized: true, components: 4 },
};

const GLSL_TYPE = n => ['float', 'float', 'vec2', 'vec3', 'vec4'][n];

function orderStructs(structs){
  const out = [], seen = new Set();
  const visit = name => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const u of structs[name].uses) visit(u);
    out.push(name);
  };
  for (const name of Object.keys(structs)) visit(name);
  return out;
}

// The functions reachable from an entry point, callees first, each interface call sent to the variant
// the selection names (or left on the interface's own body).
export function linkFunctions(shaders, entry, features){
  const resolve = name => {
    const v = features[name];
    if (v && !shaders.functions[v]) throw new Error('shader link: variant ' + v + ' of ' + name + ' is not exported');
    return v || name;
  };
  const emitted = new Set();
  const order = [];
  const visit = name => {
    if (emitted.has(name)) return;
    emitted.add(name);
    const fn = shaders.functions[name];
    if (!fn) throw new Error('shader link: function ' + name + ' is not exported');
    let text = fn.glsl;
    for (const callee of fn.calls){
      const target = resolve(callee);
      visit(target);
      if (target !== callee) text = text.replace(new RegExp('\\b' + callee.replace('$', '\\$') + '\\(', 'g'), target + '(');
    }
    order.push(text);
  };
  visit(entry);
  return order.join('\n');
}
export function structBlock(shaders){ return orderStructs(shaders.structs).map(n => shaders.structs[n].glsl).join('\n'); }

export function linkPrimitive(shaders, layoutName, features){
  return linkProgram(shaders, layoutName, features, PRIMITIVE);
}
const PRIMITIVE = { vs: 'VS_Primitive', ps: 'PS_Primitive', input: 'PRIMITIVE_VS_INPUT', output: 'PRIMITIVE_VS_OUTPUT' };
// TGPUParticle pass 0, sGpuParticle's record A draw (effects-node.md 5.5; docs/effects/gpu-shaders.json)
export const GPU_PARTICLE = { vs: 'VS_GpuParticle', ps: 'PS_GpuParticle', input: 'GPU_PARTICLE_VS_INPUT', output: 'GPU_PARTICLE_PS_INPUT' };

// THE FIXED-FUNCTION ALPHA TEST a draw's state carries in ctx+0x154 (effects-node.md 5.2 / 5.4): with bit 19 or 20 set
// the command executor binds the colour state for the function field (bits 3..10) through table 0x211cee0 = {1..8}[func]
// and sets the reference (bits 11..18) / 255 (0xbbf25c..0xbbf364). WebGL has no alpha test, so the program does it
// after the pixel shader: { func: the NVN value, ref }. Only NVN 5 is taken -- its name GREATER is the NVN API's enum
// order (NEVER 1 .. ALWAYS 8), not read from the image; another value throws until a draw selects it.
export function alphaTestOf(w154){
  if (!((w154 >>> 19) & 3)) return null;
  const func = (w154 >>> 3) & 0xff;
  if (func > 7) throw new Error('primshader: alpha test function field ' + func);
  return { func: func + 1, ref: ((w154 >>> 11) & 0xff) / 255 };
}
function alphaTestGlsl({ func, ref }){
  if (func !== 5) throw new Error('primshader: alpha test NVN function ' + func + ' not taken yet');
  return '  if (!(fragColor.a > ' + ref.toFixed(9) + ')) discard;';
}

export function linkProgram(shaders, layoutName, features, entry = PRIMITIVE, alphaTest = null){
  const layout = shaders.layouts[layoutName];
  if (!layout) throw new Error('primshader: no input layout ' + layoutName);
  const vsFunctions = linkFunctions(shaders, entry.vs, features);
  const fsFunctions = linkFunctions(shaders, entry.ps, features);

  const structs = structBlock(shaders);
  const uniforms = text => {
    const lines = [];
    for (const [cb, members] of Object.entries(shaders.cbs)){
      for (const [name, type] of members){
        if (new RegExp('\\b' + cb + '_' + name + '\\b').test(text)) lines.push('uniform ' + type + ' ' + cb + '_' + name + ';');
      }
    }
    for (const t of shaders.textures) if (new RegExp('\\b' + t + '\\b').test(text)) lines.push('uniform sampler2D ' + t + ';');
    return lines.join('\n');
  };

  // vertex: attributes by semantic
  const input = shaders.structs[entry.input].members;
  const output = shaders.structs[entry.output].members;
  const attributes = [];
  const assign = [];
  for (const [semantic, offset, count, format] of layout.elements){
    const member = input.find(m => m[2] === semantic);
    if (!member) continue;
    const f = FORMATS[format];
    if (!f) throw new Error('primshader: element format ' + format + ' (' + semantic + ')');
    const components = f.components || count;
    const name = 'a_' + semantic;
    attributes.push({ name, semantic, offset, count: components, format });
    const want = member[1], have = GLSL_TYPE(components);
    assign.push('  I.' + member[0] + ' = ' + (want === have ? name : want + '(' + name + (want === 'float' ? '' : '') + ')') + ';');
  }
  const varying = [];         // [glsl type, varying name, output member path]
  for (const [name, type] of output){
    if (name === 'position') continue;
    const st = shaders.structs[type];
    if (st) for (const [mn, mt] of st.members) varying.push([mt, 'v_' + name + '_' + mn, name + '.' + mn]);
    else varying.push([type, 'v_' + name, name]);
  }
  const vertexShader = [
    'precision highp float;', 'precision highp int;',
    structs, uniforms(vsFunctions),
    attributes.map(a => 'in ' + GLSL_TYPE(a.count) + ' ' + a.name + ';').join('\n'),
    varying.map(([t, v]) => 'out ' + t + ' ' + v + ';').join('\n'),
    vsFunctions,
    'void main() {',
    '  ' + entry.input + ' I = zero_' + entry.input + '();',
    assign.join('\n'),
    '  ' + entry.output + ' O = ' + entry.vs + '(I);',
    '  gl_Position = vec4(O.position.xy, 2.0 * O.position.z - O.position.w, O.position.w);',
    varying.map(([, v, path]) => '  ' + v + ' = O.' + path + ';').join('\n'),
    '}',
  ].join('\n');

  // fragment: the pixel shader's parameters by semantic
  const params = shaders.functions[entry.ps].params;
  const args = [];
  const prelude = [];
  const FRAG_POSITION = 'vec4(gl_FragCoord.xyz, 1.0 / gl_FragCoord.w)';
  for (const [type, name, semantic] of params){
    if (semantic === 'SV_POSITION'){ args.push(FRAG_POSITION); continue; }
    // the vertex shader's whole output struct as one parameter (PS_GpuParticle(GPU_PARTICLE_PS_INPUT I)): rebuilt member
    // by member from the varyings, its SV_POSITION member from gl_FragCoord as above
    if (type === entry.output){
      prelude.push('  ' + type + ' ' + name + ' = ' + type + '(' + output.map(([mn, mt, sem]) => {
        if (sem === 'SV_POSITION') return FRAG_POSITION;
        const st = shaders.structs[mt];
        return st ? mt + '(' + st.members.map(([sm]) => 'v_' + mn + '_' + sm).join(', ') + ')' : 'v_' + mn;
      }).join(', ') + ');');
      args.push(name);
      continue;
    }
    const member = output.find(m => m[2] === semantic);
    if (!member) throw new Error('primshader: no vertex output for ' + semantic);
    const st = shaders.structs[type];
    if (st){
      prelude.push('  ' + type + ' ' + name + ' = ' + type + '(' + st.members.map(([mn]) => 'v_' + member[0] + '_' + mn).join(', ') + ');');
      args.push(name);
    } else args.push('v_' + member[0]);
  }
  const fragmentShader = [
    'precision highp float;', 'precision highp int;', 'precision highp sampler2D;',
    structs, uniforms(fsFunctions),
    varying.map(([t, v]) => 'in ' + t + ' ' + v + ';').join('\n'),
    'out highp vec4 fragColor;',
    fsFunctions,
    'void main() {',
    prelude.join('\n'),
    // stored as the program returns it (OUTPUT above), after the fixed-function alpha test when the state has one
    '  fragColor = ' + entry.ps + '(' + args.join(', ') + ');',
    alphaTest ? alphaTestGlsl(alphaTest) : '',
    '}',
  ].join('\n');
  return { vertexShader, fragmentShader, attributes, stride: layout.stride };
}

// The draw's constant buffers as uniform values: a member's words in stored order (a matrix's 16 as a
// GLSL mat4 filled column by column, which makes GLSL's column i the stored row i).
export function cbUniforms(shaders, cb){
  const out = {};
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  const floatOf = w => { u32[0] = w >>> 0; return f32[0]; };
  for (const [name, words] of Object.entries(cb)){
    const members = shaders.cbs[name];
    if (!members) continue;
    for (const [member, type, offset, count] of members){
      const v = [];
      for (let i = 0; i < count; i++) v.push(floatOf(words[offset + i]));
      out[name + '_' + member] = { type, value: v };
    }
  }
  return out;
}
