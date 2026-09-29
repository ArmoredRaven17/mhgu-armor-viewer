// THE MODEL PARTICLE SHADER PROGRAM, LINKED FOR ONE DRAW.
//
// A Model particle is an effect model drawn with its own material -- nDraw::MaterialStd, technique
// TMaterialStd, forward pass VS_MaterialStd / PS_MaterialStd -- under the selection the engine's model
// draw makes over the material's (modeldraw.js: FPrimitiveModifierEmu -> EflEmu, FColorModifier,
// FPrimitiveTransparency, FDiffuse -> None for an FDiffuseMD material, FBlendFog ...). The functions are
// the shader package's, translated by C:\MHGU-Extract\efx\shader\glsl.py --material into
// docs/effects/model-shaders.json; linking is primshader.js's, with MaterialStd's own entry points.
//
// Read for Savage's effect models (cm150_000, cm202_042, em024_00_001) the program reduces to
//   rgb = albedo map * fAlbedoColor * (diffuse + fEmissionColor) * fPrimColor
//   a   = vertex alpha * map alpha * fTransparency * fGlobalTransparency * soft-depth fade
// because no dynamic light is selected for the draw (FDynamicLight0..7 run their own bodies, which
// light nothing) and a material with no specular map multiplies the specular term by it.
//
// WHAT THE VIEWER SUPPLIES THAT THE ROM'S BUILD DID, STATED:
//   * VertexColor / VertexAlpha are READ when the mesh's layout declares them (IANonSkinBC and the other
//     *C/*A layouts) and the model export carried them as the glb 'color' attribute (COLOR_0, RGBA8): bound
//     below to I.vcolor(.rgb) / I.valpha(.w). Where the layout does NOT carry them (IANonSkinB), nothing
//     binds and they are the stand-in 1 (colour 1,1,1, alpha 1) -- the only value under which those meshes
//     are visible at all. Occlusion (1) and the instance colour (1,1,1,1) are the same kind of stand-in.
//   * a texture slot the material leaves empty (tSpecularMap index 0): bound to black, so it zeroes
//     the specular term it multiplies instead of adding a colour nothing selected
//   * the normal: IANonSkinB packs it as format 11, which the model export drops; a stand-in (0,1,0)
//     only reaches terms that the two choices above multiply by zero
import { linkFunctions, structBlock } from './primshader.js';

const GLSL_TYPE = n => ['float', 'float', 'vec2', 'vec3', 'vec4'][n];
// the effect model glb's attributes, by the semantic the layout gives the bytes they came from
const ATTRIBUTE = { Position: ['position', 3], Normal: ['normal', 3], TexCoord: ['uv', 2],
                    UV_Primary: ['uv', 2], UV_Secondary: ['uv', 2], UV_Unique: ['uv', 2], UV_Extend: ['uv', 2] };
const ABSENT = { vcolor: 'vec3(1.0)', valpha: '1.0', occlusion: '1.0', tangent: 'vec4(1.0, 0.0, 0.0, 1.0)', normal: 'vec3(0.0, 1.0, 0.0)' };

export function uniformDecls(shaders, text){
  const lines = [];
  for (const [cb, members] of Object.entries(shaders.cbs)){
    const id = cb.replace('$', '');
    for (const [name, type, , , arr] of members){
      const u = id + '_' + name;
      if (!new RegExp('\\b' + u + '\\b').test(text)) continue;
      const m = /^mat(\d)x(\d)$/.exec(type);
      if (m){
        // three.js has no uniform for a non-square matrix: its stored rows go up as vectors, and under the
        // stored-row convention those rows ARE the GLSL matrix's columns
        const rows = Array.from({ length: +m[1] }, (_, i) => u + '_r' + i);
        lines.push('uniform vec' + m[2] + ' ' + rows.join(', ') + ';');
        lines.push('#define ' + u + ' ' + type + '(' + rows.join(', ') + ')');
      } else lines.push('uniform ' + type + ' ' + u + (arr ? '[' + arr + ']' : '') + ';');   // arr: an array CB member (fSHCoef vec4[7])
    }
  }
  // FLighting samples a spot and a point projection texture for each of its 8 dynamic lights: 16 samplers,
  // past WebGL's 16 fragment texture units with the material's own. The viewer binds no light (the
  // lights' interfaces run their own, unlit bodies), so every one of them would be the same stand-in;
  // they share one unit per kind here, which binds exactly what 16 separate stand-ins would.
  const shared = new Set();
  for (const t of shaders.textures){
    if (!new RegExp('\\b' + t + '\\b').test(text)) continue;
    const cube = shaders.cubes.includes(t);
    const light = /^t(Spot|Point)LightTexture\d$/.exec(t);
    if (light){
      const one = 't' + light[1] + 'LightTextures';
      if (!shared.has(one)){ shared.add(one); lines.push('uniform ' + (cube ? 'samplerCube ' : 'sampler2D ') + one + ';'); }
      lines.push('#define ' + t + ' ' + one);
    } else lines.push('uniform ' + (cube ? 'samplerCube ' : 'sampler2D ') + t + ';');
  }
  return lines.join('\n');
}

export function linkMaterial(shaders, layoutName, features, attributes){
  const layout = shaders.layouts[layoutName];
  if (!layout) throw new Error('modelshader: no input layout ' + layoutName);
  const vsFunctions = linkFunctions(shaders, 'VS_MaterialStd', features);
  const fsFunctions = linkFunctions(shaders, 'PS_MaterialStd', features);
  const structs = structBlock(shaders);

  const input = shaders.structs.MATERIAL_INPUT.members;
  const semantics = new Set(layout.elements.map(e => e[0]));
  const used = new Set();
  const assign = [];
  let vertexColor = false;
  for (const [name, type, semantic] of input){
    if ((semantic === 'VertexColor' || semantic === 'VertexAlpha') && semantics.has(semantic) && attributes.includes('color')){
      // the mesh's own vertex data, which the ROM reads for a VertexColor/VertexAlpha layout (IANonSkinBC and
      // the other *C/*A): the glb 'color' attribute is COLOR_0 (RGBA8, normalized). .rgb is the vertex colour
      // VS_MaterialStd linearises into mc.vertex_color; .w the vertex alpha it carries into mc.transparency,
      // the master fragment alpha. The cm100/cm101 flash shells author it 0 over most of the mesh -- their
      // soft falloff -- so stubbing it to 1 draws every shell opaque. (A vec3 export leaves .w at 1.)
      vertexColor = true;
      assign.push('  I.' + name + ' = color' + (semantic === 'VertexColor' ? '.rgb' : '.w') + ';');
    } else if (semantics.has(semantic) && ATTRIBUTE[semantic] && attributes.includes(ATTRIBUTE[semantic][0])){
      const [attr, n] = ATTRIBUTE[semantic];
      used.add(attr + ':' + n);
      assign.push('  I.' + name + ' = ' + (GLSL_TYPE(n) === type ? attr : type + '(' + attr + ')') + ';');
    } else if (ABSENT[name]) assign.push('  I.' + name + ' = ' + ABSENT[name] + ';');
  }
  const output = shaders.structs.MATERIAL_OUTPUT.members;
  const varying = output.filter(([n]) => n !== 'position').map(([n, t]) => [t, 'v_' + n, n]);
  const vertexShader = [
    'precision highp float;', 'precision highp int;',
    structs, uniformDecls(shaders, vsFunctions),
    [...used].map(u => { const [a, n] = u.split(':'); return 'in ' + GLSL_TYPE(+n) + ' ' + a + ';'; }).join('\n'),
    vertexColor ? 'in vec4 color;' : '',
    varying.map(([t, v]) => 'out ' + t + ' ' + v + ';').join('\n'),
    vsFunctions,
    'void main() {',
    '  MATERIAL_INPUT I = zero_MATERIAL_INPUT();',
    assign.join('\n'),
    '  INSTANCING_INPUT ISI = zero_INSTANCING_INPUT();',
    '  ISI.instance_color = vec4(1.0);',
    '  MATERIAL_OUTPUT O = VS_MaterialStd(I, zero_SWING_INPUT(), zero_MORPH_INPUT(), zero_SOFTBODY_INPUT(), zero_LATTICE_DEFORM_INPUT(), ISI, zero_PROJECTION_INPUT(), 0);',
    '  gl_Position = vec4(O.position.xy, 2.0 * O.position.z - O.position.w, O.position.w);',
    varying.map(([, v, n]) => '  ' + v + ' = O.' + n + ';').join('\n'),
    '}',
  ].join('\n');
  const fragmentShader = [
    'precision highp float;', 'precision highp int;', 'precision highp sampler2D;',
    structs, uniformDecls(shaders, fsFunctions),
    varying.map(([t, v]) => 'in ' + t + ' ' + v + ';').join('\n'),
    'out highp vec4 fragColor;',
    fsFunctions,
    'void main() {',
    '  MATERIAL_OUTPUT I = zero_MATERIAL_OUTPUT();',
    '  I.position = vec4(gl_FragCoord.xyz, 1.0 / gl_FragCoord.w);',        // SV_Position: .w is the clip w (FPrimitiveTransparencyVolume's depth)
    varying.map(([, v, n]) => '  I.' + n + ' = ' + v + ';').join('\n'),
    '  fragColor = PS_MaterialStd(I, gl_FrontFacing);',                    // stored as returned (primshader.js, OUTPUT)
    '}',
  ].join('\n');
  return { vertexShader, fragmentShader };
}
