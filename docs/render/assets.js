// Loader singletons and the caches every module shares. One GLTFLoader and one TextureLoader
// for the whole viewer; a texture is decoded once and handed to every material that binds it,
// and a GLB is parsed once per cache key and cloned (skeletonClone) per mount.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const loader = new GLTFLoader(), texLoader = new THREE.TextureLoader();
export const texCache = new Map(), glbCache = new Map();
// The game's own held poses, played once on an off-screen proxy (see render/pose.js). The
// proxy GLB is cached here and reused across poses.
export const poseCache = new Map();
// the weapon's own motion sets (poses/weapons/mot/), see render/weapon.js
export const weaponMotCache = new Map();

// ONE STAMP PER PAGE LOAD, appended to every MODEL and TEXTURE fetch. The Monster Viewer's
// lesson, brought over (its render/assets.js, 2026-09-12): loadJson has always cache-busted,
// so the manifests were fresh while the .glb and .webp they name came from the browser's disk
// cache -- the worst possible split, because everything the app REPORTS is current while the
// geometry on screen is old. It cost Raven two rounds there of looking at a model that had
// already been repaired and pushed ("Hard Refreshed and still see the weld"). GitHub Pages
// serves these with a freshness lifetime and the browser does not revalidate inside it, so an
// ETag does not save us; this app is served the same way.
//   PER LOAD, not per request: the stamp is fixed for the life of the page, so switching
// hunters, weapons or poses still hits the browser cache and costs nothing, and only a reload
// refetches -- which is the whole contract of "hard refresh and look again".
const ASSET_V = '?v=' + Date.now();
export const bust = url => (String(url).indexOf('?') >= 0 ? url : url + ASSET_V);

// tiled maps viewed at a glancing angle (skirts, capes) alias badly without this
let maxAnisotropy = 1;
export function initAssets(renderer){
  maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
}

// `opt.linear`: a data map (a monster's normal map) that must not be read as sRGB colour;
// cached apart from the colour reading of the same file
export async function getTexture(file, opt){
  const key = (opt && opt.linear) ? file + '#linear' : file;
  if (texCache.has(key)) return texCache.get(key);
  const t = await texLoader.loadAsync(bust(file));
  t.colorSpace = (opt && opt.linear) ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.flipY = false;
  // MT Framework tiles its maps: 14% of primitives have UVs outside 0..1, up to 6x on
  // capes, long hair and skirts. three.js defaults to ClampToEdge, which smears the edge
  // texel across everything past the first tile -- it reads as the texture being
  // magnified rather than repeated.
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAnisotropy;
  texCache.set(key, t); return t;
}

// one parse per cache key; callers skeletonClone() the scene they get back
export async function loadGlb(url, cacheKey){
  let gltf = glbCache.get(cacheKey);
  if (!gltf) { gltf = await loader.loadAsync(bust(url)); repairZeroNormals(gltf.scene); glbCache.set(cacheKey, gltf); }
  return gltf;
}

// ZERO-LENGTH NORMALS (2026-10-08; Raven: "Yukumo Bow has the issue I saw earlier with the hunting horn"). Some of the game's
// own meshes carry vertices whose normal is (0, 0, 0) -- 1,105 vertices in the drawn groups of 221 shipped models, among
// them the Yukumo Bow (weapons/w10/135, 4) and Avenir's Music Box (w12/022, 4). Lighting normalizes the normal, and a zero
// vector normalizes to NaN: the triangles round those vertices wrote NaN pixels, specks on the plain canvas that any blur
// (the Effects panel's bloom, depth of field) spreads into black squares. A viewer repair, not the game's data: each such
// vertex takes the area-weighted normal of the triangles it belongs to (or its neighbours' normals when those are
// degenerate), once per parse -- every mount shares the geometry.
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();
export function repairZeroNormals(root){
  root.traverse(o => {
    const g = o.isMesh ? o.geometry : null, n = g && g.attributes.normal, p = g && g.attributes.position;
    if (!n || !p || g.userData.zeroNormalsRepaired) return;
    g.userData.zeroNormalsRepaired = true;
    const face = new Map(), near = new Map();
    for (let i = 0; i < n.count; i++)
      if (n.getX(i) === 0 && n.getY(i) === 0 && n.getZ(i) === 0){ face.set(i, new THREE.Vector3()); near.set(i, new THREE.Vector3()); }
    if (!face.size) return;
    const idx = g.index, tris = Math.floor((idx ? idx.count : p.count) / 3);
    for (let t = 0; t < tris; t++){
      const v = [0, 1, 2].map(k => idx ? idx.getX(3 * t + k) : 3 * t + k);
      if (!v.some(i => face.has(i))) continue;
      _a.fromBufferAttribute(p, v[0]); _b.fromBufferAttribute(p, v[1]); _c.fromBufferAttribute(p, v[2]);
      _b.sub(_a); _c.sub(_a); _b.cross(_c);                         // the face normal, weighted by its area
      for (const i of v){
        if (!face.has(i)) continue;
        face.get(i).add(_b);
        for (const j of v) if (j !== i && !face.has(j)) near.get(i).add(_n.fromBufferAttribute(n, j));
      }
    }
    for (const [i, f] of face){
      const use = f.lengthSq() > 0 ? f : near.get(i).lengthSq() > 0 ? near.get(i) : f.set(0, 1, 0);
      use.normalize();
      n.setXYZ(i, use.x, use.y, use.z);                            // a normalized (int8) attribute takes floats in -1..1
    }
    n.needsUpdate = true;
  });
}

// cache-bust: the dev server sends no no-cache headers and a stale manifest
// silently strips the joint table, which makes posing a no-op
export async function loadJson(url){
  return (await fetch(url + '?v=' + Date.now())).json();
}
