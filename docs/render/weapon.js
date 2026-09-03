// The weapon rig: the weapon's parts, where each hangs, the weapon's own motion, and the
// gimmick forms. One instance per stage.
//
// What places a part comes from the ROM through render/mount.js:
//   * the stance clip's LMT event ids at the current time (poses/weapons/events.json) decide
//     the attachment index, as 0x00288008 does in the game;
//   * the index decides the joint and the local transform (computeJoint, get(type,index));
//   * a part resting on the body is drawn at the class rest scale.
// With no stance (Carry), the part takes id 2 -- what the common rest idle carries. Two
// things are NOT readings and are marked as such where they are used: the Charge Blade's
// "sword mode" flag is taken as !(id 13 active) (ROM.cbFlag.viewerProv = 'hyp'), and the
// kinsect's placement (PLACEMENT_OVERRIDE in mount.js). The per-model motion/gimmick group
// is a reading: pl_wNN.plweplist (build/frag/weaponlist.json), shipped as models[id].g. Per-weapon models come from docs/weapons/wNN.json; textures come from the
// game's own material files through render/materials-db.js.
import * as THREE from 'three';
import { loader, loadGlb, getTexture, weaponMotCache } from './assets.js';
import { skeletonClone, meshGroupId, playerBone, gidBonesOf } from './skeleton.js';
import { createMaterial, setEnvTexture, setSpecTexture, allMats } from './material.js';
import { ROM, MT_ORDER, classInfo, mountFor, localMatrix, idsAt, triggerFor, SHEATHED_IDS, DRAWN_IDS } from './mount.js';

// Whether a weapon clip's bone-0 (root) track moves the part relative to its joint. Off:
// see placePart. Raven, 2026-09-03: the sheathed Sword & Shield's shield "is moved away
// from the hunter arm; it may have a transformation applied that is not needed".
const APPLY_ROOT_TRACK = false;
import { loadClass, loadKinsects, defaultModel, modelIdOf } from './weapons-index.js';
import { texturesFor, specFor, refForGlb, entryFor } from './materials-db.js';

export const PART_KINDS = ['main', 'second', 'saya', 'kinsect', 'arrow'];

// The node every joint hangs from. Folding weapons -- bow, both bowguns, gunlance, switch
// axe, hunting horn, insect glaive -- carry 2-4 bones for their moving parts, and those
// bones are SIBLINGS under one shared parent, not a chain off bone 0. Driving bones[0]
// therefore flew the main body to the hand and left every folding part stranded at bind,
// which is what made the bow render as scattered pieces.
export function weaponMountNode(skel, stop){
  const coversAll = n => skel.bones.every(b => { for (let p = b; p; p = p.parent) if (p === n) return true; return false; });
  let node = skel.bones[0];
  while (node.parent && node.parent !== stop && !coversAll(node)) node = node.parent;
  return node;
}

const _local = new THREE.Matrix4(), _rootM = new THREE.Matrix4();

// The joint frame a proof-effect model sees (0x0031d16c, mode 0 / sub-mode 0): the joint's
// translation as it is, but its rotation taken apart into Euler angles with the parent's
// order (0x007c3638 for order 0 .. 0x007c3a38 for order 4), put back together as single-axis
// rotations in the record's order (0x0031eb84: x Rz, x Rx, x Ry for order 4), scale dropped
// (the rows are normalised; the effect's scale is the record's times the PLAYER's, not the
// joint's). Identical to the joint matrix only when the two orders agree.
const _jp = new THREE.Vector3(), _jq = new THREE.Quaternion(), _js = new THREE.Vector3(), _jone = new THREE.Vector3(1, 1, 1);
const _je = new THREE.Euler(), _je2 = new THREE.Euler(), _jm = new THREE.Matrix4();
function recomposedJoint(world, frame, out){
  world.decompose(_jp, _jq, _js);
  _je.setFromQuaternion(_jq, frame.decompose);
  _je2.set(_je.x, _je.y, _je.z, frame.rebuild);
  _jq.setFromEuler(_je2);
  return out.compose(_jp, _jq, _jone);
}

// new WeaponRig({ scene, pose, roots, ctx, events })
//   scene    where the parts are added
//   pose     the PoseDriver: the stance clip's time clocks both the ids and the weapon's motion
//   roots()  the player roots a mount bone is looked up in (armour + clothing)
//   ctx      { wire } -- the wireframe toggle, read as a part is built
//   events   poses/weapons/events.json "clips": stance key -> motion number -> id timeline
// Bowgun attachments, as the game names them (Raven, 2026-09-03): the Heavy Bowgun's
// triggers 36 / 17 / 16 are None / Shield / Power Barrel, the Light Bowgun's 36 / 18 / 19
// are None / Long Barrel / Silencer. The select is titled Attachment and lists None first.
const FORM_NAMES = {
  w04: [[36, 'None'], [17, 'Shield'], [16, 'Power Barrel']],
  w06: [[36, 'None'], [18, 'Long Barrel'], [19, 'Silencer']],
};

export class WeaponRig {
  constructor(opt){
    this.scene = opt.scene;
    this.pose = opt.pose;
    this.roots = opt.roots;
    this.ctx = opt.ctx || {};
    this.events = opt.events || {};
    this.cls = 'none'; this.modelId = null; this.cj = null;
    this.kinsectId = null;
    this.arrowKey = null;                      // no arrow until a PEL record is chosen
    this.playerOrder = 0;                      // the player's angle order (MT enum): unit default
    this.parts = {};                 // kind -> root, for the parts currently built
    this.drawn = true;               // the player's drawn flag
    this.stance = null;              // { file, clip, dur, label } from the class's stance list
    this.form = null;                // gimmick trigger override, null = the game's rule
    this.motGroup = 0;
    this.visible = true;             // the figure on screen is the hunter
    this._seq = 0; this._appliedTrg = null; this._motLast = 0;
    this._lastIds = SHEATHED_IDS;
  }

  // ---- what is equipped ---------------------------------------------------------------
  get key(){ return this.cls; }
  poses(){ return (this.cj && this.cj.shared.poses) || []; }
  // the model's carry type (pl_wNN.plweplist mCarryType, shipped as models[id].carry)
  carry(){ const m = this.cj && this.modelId && this.cj.models[this.modelId]; return (m && m.carry) || 0; }
  gmk(){ return (this.cj && this.cj.shared.gmk) || null; }
  modelRows(){ return (this.cj && this.cj.weapons) || []; }
  classJson(){ return this.cj; }

  clearParts(){
    for (const kind of Object.keys(this.parts)){
      const p = this.parts[kind];
      if (p) this.scene.remove(p);
    }
    this.parts = {};
    this._appliedTrg = null;
  }

  // set(cls, modelId): load the class index, pick the model (null = the class's first named
  // Smithy row, its Petrified weapon), build every part it ships, bind the motion sets.
  async set(cls, modelId){
    const seq = ++this._seq;
    this.clearParts();
    this.cls = cls || 'none'; this.cj = null; this.modelId = null;
    if (!cls || cls === 'none' || !classInfo(cls)) return;
    const cj = await loadClass(cls);
    if (seq !== this._seq) return;
    this.cj = cj;
    const want = modelId !== null && modelId !== undefined ? modelIdOf(modelId) : null;
    const id = (want && cj.models[want]) ? want : defaultModel(cj);
    this.modelId = id;
    const m = id && cj.models[id];
    // the model's own motion/gimmick group (ROM: pl_wNN.plweplist mGmkMotNo, shipped as
    // models[id].g); the class value is only the fallback for a model the list lacks
    this.motGroup = (m && m.g !== undefined) ? m.g : ((cj.shared.motGroup && cj.shared.motGroup.value) || 0);
    if (!m) return;
    const built = [];
    const jobs = [this.buildPart('main', m.main.glb, m.main.mats, built)];
    if (m.second) jobs.push(this.buildPart('second', m.second.glb, m.second.mats, built));
    if (m.saya)   jobs.push(this.buildPart('saya', m.saya.glb, m.saya.mats, built));
    // a class-wide attachment the game draws as a proof effect (the Bow's nocked arrow):
    // docs/weapons/wNN.json shared.arrow, from effect/pel/pl/wNN_000.pel
    const arrow = cj.shared.arrow;
    if (arrow) jobs.push(this.buildPart('arrow', arrow.glb, arrow.mats, built).then(root => {
      // harvest-effect-models.py names the nodes Group<part>, so userData.part is the MOD
      // part id; shared.arrow.parts lists the groups to show (the arrow is group 0)
      const keep = new Set(arrow.parts || [0]);
      root.traverse(o => { if ((o.isMesh || o.isSkinnedMesh) && o.userData.part < 100) o.visible = keep.has(o.userData.part); });
      return root;
    }));
    await Promise.all(jobs);
    if (seq !== this._seq) return;              // superseded while loading: leave nothing behind
    for (const [kind, root] of built){ this.scene.add(root); this.parts[kind] = root; }
    if (this.kinsectId && cls === 'w13') await this.setKinsect(this.kinsectId, seq);
    if (seq !== this._seq) return;
    await this.rebindMotion();
    this.step();
  }

  // the kinsect: type 20 of the Insect Glaive, a model from docs/weapons/bug.json
  async setKinsect(id, seq){
    const token = (this._kseq = (this._kseq || 0) + 1);
    if (this.parts.kinsect){ this.scene.remove(this.parts.kinsect); delete this.parts.kinsect; }
    this.kinsectId = id || null;
    if (!id || this.cls !== 'w13') return;
    const stale = () => token !== this._kseq || (seq !== undefined && seq !== this._seq) || this.cls !== 'w13';
    const kj = await loadKinsects();
    this._bugJson = kj;
    if (stale()) return;
    const m = kj.models[modelIdOf(id)];
    if (!m) return;
    const built = [];
    await this.buildPart('kinsect', m.glb, m.mats, built);
    if (stale()) return;                       // a later call (or a class change) won
    if (this.parts.kinsect) this.scene.remove(this.parts.kinsect);
    for (const [kind, root] of built){ this.scene.add(root); this.parts[kind] = root; }
    // The perched form: the shell's perch handler (0x0048288c) calls 0x0047f754 after the
    // motion request, which sets the scale of the joint the model's id map lists under
    // id 3 to 0.1 (0x3dcccccd) -- the wings, in bug001 the only bone with wing vertices.
    // Take-off (0x0047eb48) restores 1.0. The viewer only shows the perched form.
    const fold = kj.perch && kj.perch.fold;
    if (fold){
      for (const [, root] of built){
        root.userData.joints = m.joints || [];              // the gid table (bug.json models[id].joints)
        for (const b of gidBonesOf(root)) if (b.gid === fold.gid) b.node.scale.setScalar(fold.scale);
      }
    }
    this.step();
  }

  // one weapon piece: the weapon, a shield, the arrows, the scabbard, the kinsect
  async buildPart(kind, glb, matsRef, built){
    const gltf = await loadGlb(glb, 'W:' + glb);
    const root = skeletonClone(gltf.scene);
    // the class index names the materials entry; where that key is absent (the Dual Blades'
    // main blade is keyed by its sou_r prefix) the database's own glb map is the authority
    let ref = matsRef;
    if (!entryFor(ref)) ref = refForGlb(glb) || ref;
    const jobs = [];
    root.traverse(o => {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      const srcName = (o.material && o.material.name) || '';
      // The glTF node name IS the part id: a MOD mesh group is (LOD << 12) | part, and the
      // exporter writes only the low bits. So Group[24] is part 24, addressable straight
      // from .plgmktype without any conversion.
      o.userData.part = meshGroupId(o);
      if (o.userData.part >= 100) { o.visible = false; return; }  // same proxy layer as armour
      // the effect-base models ship no normals (cm100_900: position + uv only); a lit material
      // needs them or the mesh draws black
      if (o.geometry && !o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      o.frustumCulled = false;
      // The whole material comes from the game's own material file resolved through
      // materials.json (material.js lists what it decides); a placeholder the database does
      // not carry falls back to the table's first map and the name rules.
      const rom = specFor(ref, srcName);
      const tx = rom || texturesFor(ref, srcName);
      const mat = createMaterial({
        srcName, rom, alphaCut: rom ? 0 : (/^XfBA/.test(srcName) ? 0.5 : 0),
        noTint: true,          // weapons are not dyed
        wire: this.ctx.wire });
      o.material = mat; allMats.push(mat);
      if (mat.userData.renderOrder) o.renderOrder = mat.userData.renderOrder;
      if (tx && tx.albedo) jobs.push(getTexture(tx.albedo).then(t => { mat.map = t; if (mat.userData.emissiveFromMap) mat.emissiveMap = t; mat.needsUpdate = true; }));
      if (rom){
        if (rom.feat && rom.feat.reflect === 'SphereMap' && rom.sphere) jobs.push(getTexture(rom.sphere).then(t => setEnvTexture(mat, t)));
        if (rom.spec && !rom.specIsAlbedo) jobs.push(getTexture(rom.spec).then(t => setSpecTexture(mat, t)));
      } else if (tx && tx.sphere) jobs.push(getTexture(tx.sphere).then(t => setEnvTexture(mat, t)));
    });
    await Promise.all(jobs);
    // Drive the weapon's OWN root BONE, never the group that holds it. glTF says a skinned
    // mesh node's transform is ignored, but three.js still multiplies it in and cancels it
    // with bindMatrixInverse -- so moving a parent that contains BOTH the mesh nodes and the
    // joint nodes applies the hand matrix TWICE. The mount matrix carries the model's own
    // dequantisation scale through the bone's world matrix, which is why the decompose in
    // the pose path never touches a weapon.
    let wskel = null;
    root.traverse(o => { if (!wskel && o.isSkinnedMesh) wskel = o.skeleton; });
    // A model with no skeleton (the arrow, effect/base/cm100_900: plain meshes under a LOD
    // group) is driven by its root node instead; its mesh nodes keep their own cm -> m scale.
    root.userData.bone = wskel ? weaponMountNode(wskel, root) : root;
    root.userData.kind = kind;
    root.userData.glb = glb;
    root.visible = false;                      // until step() places it
    built.push([kind, root]);
    return root;
  }

  // ---- state ----------------------------------------------------------------------------
  setDrawn(b){ this.drawn = !!b; this._appliedTrg = null; }
  // the arrow placement: a key of shared.arrow.records ('520' ...) or null for none
  setArrow(key){ this.arrowKey = (key === null || key === undefined || key === '') ? null : String(key); this.step(); }
  // the player's angle order the arrow's joint is decomposed with (MT enum 0..5; see mounts())
  setPlayerOrder(n){ n = Number(n); this.playerOrder = (n >= 0 && n < MT_ORDER.length) ? n : 0; this.step(); return MT_ORDER[this.playerOrder]; }
  arrowOptions(){ const r = this.cj && this.cj.shared.arrow && this.cj.shared.arrow.records; return r ? Object.keys(r) : []; }
  // the select's label for a record: its number, joint, position (cm) and rotation (deg)
  arrowLabel(k){
    const r = this.cj && this.cj.shared.arrow && this.cj.shared.arrow.records && this.cj.shared.arrow.records[k];
    if (!r) return 'Record ' + k;
    const v = a => '(' + a.map(x => Math.round(x)).join(', ') + ')';
    return k + ' · joint ' + r.joint + ' · ' + v(r.pos) + ' cm' + (r.rot.some(x => x) ? ' · rot ' + v(r.rot) : '');
  }
  setStance(entry){ this.stance = entry || null; this._appliedTrg = null; }
  setForm(trg){ this.form = (trg === null || trg === undefined || trg === '') ? null : +trg; this._appliedTrg = null; this.applyForm(); }
  setVisible(v){ this.visible = !!v; for (const p of Object.values(this.parts)) if (p && !v) p.visible = false; if (v) this.step(); }

  // the stance file's key in events.json ('w00', 'w00_sa') and the clip's motion number
  stanceKey(){
    const f = this.stance && this.stance.file;
    const m = f && /([^/]+)\.glb$/.exec(f);
    return m ? m[1] : null;
  }
  stanceMotion(){
    const c = this.stance && this.stance.clip;
    const m = c && /Motion\[(\d+)\]/.exec(c);
    return m ? m[1] : null;
  }
  poseTime(){ const a = this.pose && this.pose.action; return a ? a.time : 0; }

  // the LMT ids active now: read from the stance clip (whichever file it comes from), or
  // id 2 when there is no stance (Carry). The common rest idle's own ids are not shipped;
  // see build/notes/phase2.md.
  activeIds(t){
    if (!this.stance) return { ids: SHEATHED_IDS, synthetic: true, clipIds: SHEATHED_IDS };
    const key = this.stanceKey(), mid = this.stanceMotion();
    const tl = key && mid && this.events[key] && this.events[key][mid];
    // a `_loop` stance is the second half of one LMT motion: its action time restarts at 0,
    // while the timeline is in the whole motion's time, so add the loop's start (entry.t0)
    // A motion with NO group-0 event track leaves the player's state mask as the previous
    // action left it (the Heavy Bowgun's dodges 90, 91, 92 are the only shipped clips
    // without one; Raven, 2026-09-03: the gun stays in hand through them). The previous
    // action of any stance is the drawn idle, so the drawn state carries over. An empty
    // timeline is that case; a timeline with segments says what it says.
    const ids = (tl && tl.length) ? idsAt(tl, t + (this.stance.t0 || 0)) : null;
    if (!ids) return { ids: DRAWN_IDS, synthetic: true, clipIds: DRAWN_IDS };
    const clipIds = new Set();
    for (const [, seg] of tl) for (const id of seg) clipIds.add(id);
    return { ids, synthetic: false, clipIds };
  }
  // The Charge Blade's mode, the player's "sword mode" flag (uPlayerQuest14 vfn +0x35c =
  // [player+0x3328] == 1; 1 at construction). Every action writes it through vtable slot
  // 531 (0x011dc42c) when it STARTS, so a clip plays in the mode it belongs to: a clip that
  // carries id 13 anywhere (axe attacks, the morphs to axe, the draws into axe) runs in axe
  // mode, every other clip in sword mode. The index rules then read coherently: id 13 ->
  // index 14 (axe, both parts at the sword hand) whatever the flag; id 3 -> the sword
  // placements; id 8 -> "sword ? 14 : sword placement", the PREVIOUS configuration, which
  // is why the morphs open with it; id 17 -> the current mode. A clip without 13 played in
  // axe mode (guards, hit reactions) needs the Form override: 4 is the axe form.
  // Was `13 active in the current segment` (hypothesis), which put both parts into the
  // axe placement for the opening frames of a morph to axe and never followed a Form of 4.
  axeMode(at){
    if (this.form === 4) return true;
    return !!(at && at.clipIds && at.clipIds.has(13));
  }
  // every part's mount at time t (default: now)
  mounts(t){
    const at = this.activeIds(t === undefined ? this.poseTime() : t);
    const axe = this.axeMode(at);
    const out = {};
    for (const kind of Object.keys(this.parts)){
      if (!this.parts[kind]) continue;
      if (kind === 'arrow'){
        // One of the proof-effect records of docs/weapons/wNN.json shared.arrow.records --
        // joint, position (cm), rotation (deg) and its angle order as the PEL says. Which
        // record an animation requests could not be read from the ROM (no request site
        // found), so nothing is shown until a record is chosen (setArrow / the Arrow select).
        // The game composes a joint-following model effect (uProofEffect, 0x0031d16c with
        // mode 0 / sub-mode 0) as: position = the joint's world matrix applied to the
        // record's position; rotation = the joint's rows normalised, DECOMPOSED into angles
        // with the PLAYER's angle order (0x007c3638..), re-applied as single-axis
        // rotations in the record's order (0x0031eb84 for order 4), times the record's
        // rotation; then the sum is rebuilt in the record's order (0x00320ed4) and the
        // effect keeps that order (+0x38, set at creation 0x009b3308). The joint is
        // rebuilt exactly only when both orders agree, so `frame` carries both: the
        // player's order is the unit default 0 unless an action state changes it (states
        // writing 1 and 4 exist; which the Bow's shots use was not read), settable with
        // setPlayerOrder for Raven's comparison.
        const recs = this.cj.shared.arrow && this.cj.shared.arrow.records;
        const a = recs && this.arrowKey ? recs[this.arrowKey] : null;
        const order = a && MT_ORDER.includes(a.order) ? a.order : 'YXZ';
        out[kind] = a ? { type: null, index: null, joint: a.joint, rec: { pos: a.pos, rot: a.rot, order },
                          frame: { decompose: MT_ORDER[this.playerOrder] || 'ZYX', rebuild: order },
                          scale: a.scale || 1, prov: a.prov + '; chosen by the user; joint re-composed ' +
                          (MT_ORDER[this.playerOrder] || 'ZYX') + '->' + order + ' (0x0031d16c)' } : null;
        continue;
      }
      out[kind] = mountFor({ cls: this.cls, part: kind, ids: at.ids, drawn: this.drawn, axe, synthetic: at.synthetic,
                             carry: this.carry() });
    }
    return { ids: at.ids, synthetic: at.synthetic, mounts: out };
  }

  // ---- placing --------------------------------------------------------------------------
  // every frame: the ids may change within a stance (a draw clip goes 2 -> 1 -> 3)
  step(){
    if (!this.cj) return;
    const { ids, mounts } = this.mounts();
    this._lastIds = ids;
    for (const kind of Object.keys(this.parts)){
      const part = this.parts[kind];
      if (part) this.placePart(part, mounts[kind]);
    }
    this.applyForm(ids, mounts);
  }
  placePart(part, m){
    const b = part.userData.bone;
    const mount = (m && m.joint !== null && m.joint !== undefined) ? playerBone(this.roots(), m.joint) : null;
    part.userData.mount = m;
    part.visible = !!(b && mount) && this.visible;
    if (!part.visible) return;
    mount.updateWorldMatrix(true, false);
    b.matrixAutoUpdate = false; b.matrixWorldAutoUpdate = false;
    // joint world * (T * R * S of the record and rest scale) * the weapon clip's bone-0
    // transform (below).
    // A mount with `frame` (the proof-effect arrow) sees the joint through the game's
    // decompose-and-rebuild instead of the joint matrix itself (see mounts()).
    const jm = m.frame ? recomposedJoint(mount.matrixWorld, m.frame, _jm) : mount.matrixWorld;
    b.matrix.multiplyMatrices(jm, localMatrix(m, _local));
    const mot = part.userData.mot;
    if (APPLY_ROOT_TRACK && mot && mot.rootSrc){
      mot.rootSrc.updateMatrix();
      b.matrix.multiply(mot.rootSrc.matrix);
    } else if (mot && mot.rootSrc){
      // The clip's bone-0 TRANSLATION and SCALE are the weapon's own motion inside its
      // mount and are applied on top of the record. The Charge Blade's shield is the proof:
      // its list slides bone 0 along the weapon, 0 in the sword idle, 1.8 m in the axe idle
      // (wg14_r_00 Motion[20]_loop) and every axe attack, 0 -> 1.8 through the morphs to
      // axe (131, 163, 137) and back (121, 122, 126, 149, 152, 158), 0.57 in some guard
      // points -- which is what carries the shield from the sword's base to its tip (Raven,
      // 2026-09-03: "the shield attached to the base of the sword, not the tip"). The
      // hand-relative records alone cannot reach the tip. The sword's list scales bone 0
      // to 0.8 in sword mode (Raven: "the scale of the sword looks large"). The ROTATION
      // track rides too: the shield turns half a turn about the weapon's axis as it slides
      // through the sheathe (Motion[3]) and the morphs to axe (131), the sword spins 163 deg
      // in the draw, and the Light Bowgun's 35-40, 131, 132 and 197 turn bone 0 up to 175
      // deg. (An earlier reading called the rotation tracks NaN: that was the reader taking
      // normalized int16 quaternions for floats; 192 of the 3,006 weapon clips rotate bone
      // 0.) The earlier reading that the translation is root-motion data came from the
      // Sword & Shield's shield rest loop (0, 0.88, 0) and is superseded by this one; the
      // sheathed SnS shield now rides that 0.88 m too.
      const rs = mot.rootSrc;
      b.matrix.multiply(_rootM.compose(rs.position, rs.quaternion, rs.scale));
    }
    b.matrixWorld.copy(b.matrix);
    b.children.forEach(c => c.updateMatrixWorld(true));
  }

  // ---- the weapon's OWN motion ---------------------------------------------------------
  // `poses/weapons/wNN.glb` drives the PLAYER; the sets in poses/weapons/mot/ drive the
  // WEAPON's own 1-4 bones -- what folds a Switch Axe, turns a Charge Blade's shield into the
  // axe, articulates the bowguns. The two pair BY CLIP NUMBER: the hunter's Motion[N] goes
  // with the weapon's Motion[N]. `_sa` is the sheathed set. The mount node is skipped:
  // placePart owns it, and the weapon's own bones hang under it.
  // The set follows the STANCE FILE: a stance from wNN_sa.glb pairs with the weapon's `_sa`
  // list, anything else with `_draw`. The `_sa` list is NOT the sheathed set -- its clips
  // carry state id 3 (drawn) and the Switch Axe's blade is extended in its Motion[1] -- so
  // Carry (no stance) uses the `_draw` list too, and takes its Motion[0] loop (below).
  motionRecFor(kind, forceSet){
    // the kinsect has its own list (docs/weapons/bug.json motion); it plays the perched idle
    if (kind === 'kinsect') return (this._bugJson && this._bugJson.motion) || null;
    if (!this.cj) return null;
    const side = kind === 'main' ? 'main' : (kind === 'second' ? 'off' : null);
    if (!side) return null;                     // the scabbard has no set
    const sa = forceSet ? forceSet === 'sa' : !!(this.stance && /_sa\.glb$/.test(this.stance.file || ''));
    const slot = side + '_' + (sa ? 'sa' : 'draw');
    // The first list a motion resolves through; bindMotion uses motionRecsFor, which adds
    // the class's g00 list behind the model's group (see there). Kept for the audit.
    // (docs/weapons/wNN.json shared.motionGroups, from harvest-weapon-mot-groups.py)
    const groups = this.cj.shared.motionGroups || {};
    const own = groups[String(this.motGroup)], base = groups['0'];
    const rec = (own && own[slot]) || (base && base[slot]) || null;
    if (rec) return rec;
    const mo = this.cj.shared.motion;            // the pre-list single set, last resort
    return mo ? (mo[slot] || mo[side + '_draw'] || null) : null;
  }
  // The lists a motion resolves through, in order: the model's group list, then the class's
  // g00 list of the same set. The game loads both (0x00286f70, slots 0x19 and 0x1a) and the
  // group lists are OVERLAYS: the Charge Blade shield's g01 list holds one clip, the Hammer's
  // g01..g21 two, the Heavy Bowgun's g03 two, the Light Bowgun's g01..g03 lack the rolling
  // shots 35-40 and 197 -- their draws, idles, sheathes and shots can only come from g00.
  motionRecsFor(kind, forceSet){
    if (kind === 'kinsect'){ const r = this.motionRecFor(kind); return r ? [r] : []; }
    if (!this.cj) return [];
    const side = kind === 'main' ? 'main' : (kind === 'second' ? 'off' : null);
    if (!side) return [];
    const sa = forceSet ? forceSet === 'sa' : !!(this.stance && /_sa\.glb$/.test(this.stance.file || ''));
    const slot = side + '_' + (sa ? 'sa' : 'draw');
    const groups = this.cj.shared.motionGroups || {};
    const own = groups[String(this.motGroup)], base = groups['0'];
    const out = [];
    for (const g of [own, base]){ const r = g && g[slot]; if (r && !out.includes(r)) out.push(r); }
    if (!out.length){ const mo = this.cj.shared.motion; const r = mo && (mo[slot] || mo[side + '_draw']); if (r) out.push(r); }
    return out;
  }
  async loadMot(rec){
    if (!rec || !rec.file) return null;
    let g = weaponMotCache.get(rec.file);
    if (!g){
      try { g = await loader.loadAsync(rec.file); } catch (_) { return null; }
      weaponMotCache.set(rec.file, g);
    }
    return g;
  }
  async loadSets(recs){
    const out = [];
    for (const r of recs){ const g = await this.loadMot(r); if (g && (g.animations || []).length) out.push(g); }
    return out;
  }
  async bindMotion(kind){
    const part = this.parts[kind];
    if (!part) return;
    part.userData.mot = null;
    const recs = this.motionRecsFor(kind);
    const sets = await this.loadSets(recs);
    if (!sets.length) return;
    // find(name) -> [clip, gltf] from the first list that has it
    const find = (name, list) => { for (const g of (list || sets)){ const c = g.animations.find(c => c.name === name); if (c) return [c, g]; } return null; };
    const want = kind === 'kinsect' ? recs[0].perched : (this.stance && this.stance.clip);
    // Carry: the weapon's Motion[0] loop. The hunter's weapon list has no clip 0 (the rest
    // idle is a common motion), and the weapon's clip 0 is the shape that pairs with it --
    // the Switch Axe's Motion[0]_loop holds its blade bones where Motion[3] (the sheathe)
    // leaves them, not where Motion[1]_loop (the drawn idle) has them.
    // Carry: the rest loop. A stance: the same-numbered clip. A stance the weapon's list
    // does not cover keeps the weapon where the game keeps it -- in the pose it already had,
    // which for any drawn action is the DRAWN IDLE (Motion[1]_loop of the `_draw` list); the
    // bind pose is the folded shape and is wrong for every folding weapon (Raven: "animations
    // with folding weapons where they remain folded"). Never a different action's clip: the
    // Charge Blade shield's first loop carries a 1.8 m root offset.
    // the `_draw` lists hold the rest loop, the draw (Motion[2]) and the idles every drawn
    // action builds on (a `_sa` stance's own list has none of them)
    const drawSets = kind === 'kinsect' ? [] : await this.loadSets(this.motionRecsFor(kind, 'draw'));
    const restHit = find('Motion[0]_loop') || find('Motion[0]') || find('Motion[0]_loop', drawSets) || find('Motion[0]', drawSets);
    let hit = want ? find(want) : restHit;
    const ids0 = want ? this.activeIds(0) : null;
    // The idle of the clip's MODE: an axe-mode Charge Blade action without a shield clip
    // (33 of its 53 axe clips) keeps the shield where the axe idle holds it, bone 0 at
    // 1.8 m up the weapon, not where the sword idle has it (Raven, 2026-09-03: the shield
    // sat at the sword's base through axe mode). Motion[20]_loop is the axe idle.
    const idleNames = (ids0 && this.axeMode(ids0))
      ? ['Motion[20]_loop', 'Motion[20]', 'Motion[1]_loop', 'Motion[1]'] : ['Motion[1]_loop', 'Motion[1]'];
    let idleHit = null;
    for (const n of idleNames){ idleHit = find(n, drawSets); if (idleHit) break; }
    if (!hit && want && idleHit) hit = idleHit;
    if (!hit) return;
    const [clip, src_gltf] = hit;
    // Bones the clip does not drive keep the pose they already have: the game never resets a
    // joint a motion does not track, so the state carries over from the actions before it.
    // The viewer rebuilds that history as layers, each overriding only the PROPERTIES it
    // tracks (a clip may move a bone without rotating it: the Ner Bustergun's drawn idle has
    // position and scale tracks for its port-cover bone but no rotation track):
    //   1. the rest loop (every weapon starts sheathed);
    //   2. for an action that starts drawn, the draw (Motion[2]) at its last frame, then the
    //      idle of the clip's mode at its first frame;
    //   3. the clip itself, live.
    // The Heavy Bowgun is the proof: its fold bone (1:1) sits at 180 deg in the rest loop,
    // the draw turns it to 0 and the drawn idle holds 0, but its shooting clips (45, 46, 47,
    // 104, 136, 151, 153, 177, 181) drive only the recoil bone -- with the rest loop alone
    // as the baseline they fired folded (Raven, 2026-09-03: "folded when supposed to be
    // unfolded"). The Ner Bustergun's port cover (46 deg in the rest loop, untracked by the
    // draw and the idle) stays at 46 deg through the layers, as Raven saw it in game.
    const drivenBy = c => new Set(c.tracks.map(t => t.name));
    const flagsFor = (set, name) => ({ pos: set.has(name + '.position'), rot: set.has(name + '.quaternion'), scl: set.has(name + '.scale') });
    const copyDriven = (from, to, f) => { if (f.pos) to.position.copy(from.position); if (f.rot) to.quaternion.copy(from.quaternion); if (f.scl) to.scale.copy(from.scale); };
    const byName = root => { const m = new Map(); root.traverse(o => { const n = o.userData && o.userData.name; if (n) m.set(n, o); }); return m; };
    const rootBone = part.userData.bone;
    const rootName = rootBone && rootBone.userData && rootBone.userData.name;
    // bone 0's layered state: the mount owns the node itself, placePart composes this on top
    const rootBase = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(1, 1, 1) };
    const layers = [];
    if (restHit && restHit[0] !== clip) layers.push([restHit[0], restHit[1], false]);
    const startsDrawn = !!(ids0 && ids0.ids.size && !Array.from(ids0.ids).some(i => SHEATHED_IDS.has(i)));
    if (startsDrawn){
      const drawHit = find('Motion[2]', drawSets);
      if (drawHit && drawHit[0] !== clip) layers.push([drawHit[0], drawHit[1], true]);
      if (idleHit && idleHit[0] !== clip) layers.push([idleHit[0], idleHit[1], false]);
    }
    for (const [lclip, lg, atEnd] of layers){
      const lproxy = skeletonClone(lg.scene);
      const lmixer = new THREE.AnimationMixer(lproxy);
      lmixer.clipAction(lclip).reset().play();
      lmixer.update(atEnd ? Math.max(lclip.duration - 1e-3, 0) : 0);
      const lsrc = byName(lproxy), ldriven = drivenBy(lclip);
      part.traverse(o => {
        const n = o.userData && o.userData.name;
        const from = n && lsrc.get(n);
        if (from) copyDriven(from, o === rootBone ? rootBase : o, flagsFor(ldriven, from.name));
      });
    }
    const proxy = skeletonClone(src_gltf.scene);
    const src = byName(proxy);
    // the live proxy's bone 0 starts from the layered state, so a clip without a root track
    // (an axe attack the shield's list covers without moving bone 0) keeps the idle's offset
    const rootSrc = rootName ? (src.get(rootName) || null) : null;
    if (rootSrc){ rootSrc.position.copy(rootBase.position); rootSrc.quaternion.copy(rootBase.quaternion); rootSrc.scale.copy(rootBase.scale); }
    const mixer = new THREE.AnimationMixer(proxy);
    const action = mixer.clipAction(clip);
    // Default LoopRepeat, and the time is CLAMPED in stepMotion instead of LoopOnce: a
    // finished LoopOnce action is paused by three.js, and the next setTime() resets a paused
    // action to 0, which snapped weapons back to their folded first frame for good. The
    // weapon's clip is usually SHORTER than the hunter's stance for the same action (Switch
    // Axe: 17 of 35 shared clips; Great Sword: 15 of 16), so clamping holds it at the end
    // while the hunter continues, which is what the two clips together describe.
    action.reset().play();
    mixer.update(0);
    const pairs = [];
    const driven = drivenBy(clip);                       // only the bones this clip animates
    part.traverse(o => {
      if (o === rootBone) return;                        // the mount owns this one
      const n = o.userData && o.userData.name;
      const from = n && src.get(n);
      if (!from) return;
      const f = flagsFor(driven, from.name);
      if (f.pos || f.rot || f.scl) pairs.push([from, o, f]);
    });
    // bone 0's track (or its layered state) rides on the mount in placePart
    part.userData.mot = (pairs.length || rootSrc)
      ? { mixer, pairs, rootSrc, clip: clip.name, dur: Math.max(clip.duration - 1e-3, 0),
          loop: /_loop$/.test(clip.name), len: clip.duration } : null;
  }
  async rebindMotion(){
    for (const kind of ['main', 'second', 'kinsect']) await this.bindMotion(kind);
  }
  // Clocked from the stance ACTION's time (a stance plays once and holds, then may restart:
  // its time goes back to 0 with it) so the weapon and the hunter stay one action.
  stepMotion(){
    const synced = this.pose && this.pose.mixer;
    let dt = 0;
    if (!synced){
      const now = performance.now();
      dt = this._motLast ? Math.min((now - this._motLast) / 1000, 0.1) : 0;
      this._motLast = now;
    } else this._motLast = 0;
    for (const part of Object.values(this.parts)){
      const m = part && part.userData.mot;
      if (!m) continue;
      const src = (synced && this.pose.action) ? this.pose.action.time : null;
      // a `_loop` clip wraps; anything else holds its last frame
      const at = tt => m.loop ? (m.len > 0 ? tt % m.len : 0) : Math.min(tt, m.dur);
      if (src !== null) m.mixer.setTime(at(src));
      else if (synced) m.mixer.setTime(at(this.pose.mixer.time));
      else m.mixer.update(dt);
      for (const [from, to, f] of m.pairs){
        if (f.pos) to.position.copy(from.position);
        if (f.rot) to.quaternion.copy(from.quaternion);
        if (f.scl) to.scale.copy(from.scale);
      }
    }
  }

  // ---- forms: `.plgmktype` part visibility ---------------------------------------------
  // rPlayerGimmickType lists, per TRIGGER, which parts switch on and off. The game fires
  // trigger 0 while the weapon rests and 1 when drawn (0x0030890c), the Charge Blade's axe
  // form fires 4, and the rest come from the action id. Triggers are edge-driven and
  // accumulate, so the viewer rebuilds the state the way the game reaches it: every part on,
  // trigger 0, then the current trigger. The model's gimmick group is the motion group.
  formOptions(){
    const g = this.gmk() && this.gmk()[String(this.motGroup)];
    if (!g) return [];
    const trgs = g.filter(r => (r.on && r.on.length) || (r.off && r.off.length)).map(r => r.trg);
    // the named attachments first, in the game's order; anything unnamed keeps the list order
    const named = (FORM_NAMES[this.cls] || []).map(e => e[0]).filter(t => trgs.includes(t));
    return named.concat(trgs.filter(t => !named.includes(t)));
  }
  formTitle(){ return FORM_NAMES[this.cls] ? 'Attachment' : 'Form'; }
  // Only the bowguns offer the select (Raven, 2026-09-03: "hide the Forms option for
  // non-Bowguns since some of them don't have an obvious function or are better called
  // programmatically for animations"); every other class runs the game's trigger logic.
  formSelectable(){ return !!FORM_NAMES[this.cls]; }
  formLabel(t){
    const hit = (FORM_NAMES[this.cls] || []).find(e => e[0] === +t);
    return hit ? hit[1] : ('Trigger ' + t);
  }
  currentTrigger(ids, mounts){
    if (this.form !== null) return this.form;
    if (!ids){ const r = this.mounts(); ids = r.ids; mounts = r.mounts; }
    return triggerFor(mounts && mounts.main, ids, this.drawn);
  }
  applyForm(ids, mounts){
    if (!this.cj) return;
    if (!ids){ const r = this.mounts(); ids = r.ids; mounts = r.mounts; }
    const trg = this.currentTrigger(ids, mounts);
    if (trg === this._appliedTrg) return;
    this._appliedTrg = trg;
    const g = this.gmk() && this.gmk()[String(this.motGroup)];
    const recs = [];
    if (g){
      const r0 = g.find(r => r.trg === 0); if (r0) recs.push(r0);
      if (trg !== 0){ const r = g.find(r => r.trg === trg); if (r) recs.push(r); }
    }
    for (const kind of ['main', 'second']){
      const part = this.parts[kind];
      if (!part) continue;
      part.traverse(o => {
        if (!(o.isMesh || o.isSkinnedMesh)) return;
        const id = o.userData.part;
        if (id === undefined || id >= 100) return;      // the proxy layer stays hidden
        let vis = true;
        for (const rec of recs){
          if (rec.off && rec.off.includes(id)) vis = false;
          else if (rec.on && rec.on.includes(id)) vis = true;
        }
        o.visible = vis;
      });
    }
  }

  // ---- inspection -----------------------------------------------------------------------
  audit(){
    const { ids, synthetic, mounts } = this.mounts();
    const parts = {};
    for (const kind of Object.keys(this.parts)){
      const p = this.parts[kind], m = mounts[kind] || null;
      parts[kind] = Object.assign({ glb: p.userData.glb, visible: p.visible,
                                    motion: p.userData.mot ? p.userData.mot.clip : null }, m);
    }
    return { cls: this.cls, model: this.modelId, kinsect: this.kinsectId, arrow: this.arrowKey,
             playerOrder: MT_ORDER[this.playerOrder], drawn: this.drawn,
             stance: this.stance ? this.stance.clip : null, ids: Array.from(ids).sort((a, b) => a - b),
             synthetic, trigger: this._appliedTrg, motGroup: this.motGroup, parts };
  }
  // every mesh part and whether it is drawn
  parts_(){
    const out = [];
    for (const kind of Object.keys(this.parts)){
      const part = this.parts[kind];
      if (part) part.traverse(o => {
        if (o.isMesh || o.isSkinnedMesh) out.push({ kind, part: o.userData.part, visible: o.visible });
      });
    }
    return out;
  }
}
