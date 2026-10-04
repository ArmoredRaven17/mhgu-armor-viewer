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
import { loader, loadGlb, getTexture, weaponMotCache, bust } from './assets.js';
import { skeletonClone, meshGroupId, playerBone, gidBonesOf } from './skeleton.js';
import { createMaterial, setEnvTexture, setSpecTexture, setChannelColor, applyRomUv, allMats,
         setOverlayAlbedo, setMaterialClip, clearMaterialClip, setCbWrite, setMaterialOverride, MAT_FPS } from './material.js';
import { kinsectColours, ELEMENTS } from './kinsect.js';
import { ROM, MT_ORDER, classInfo, mountFor, localMatrix, idsAt, triggerFor, SHEATHED_IDS, DRAWN_IDS } from './mount.js';

// Whether a weapon clip's bone-0 (root) track moves the part relative to its joint. Off:
// see placePart. Raven, 2026-09-03: the sheathed Sword & Shield's shield "is moved away
// from the hunter arm; it may have a transformation applied that is not needed".
const APPLY_ROOT_TRACK = false;
import { loadClass, loadKinsects, defaultModel, modelIdOf, phialFor, phialsFor, elementFor, notesFor, chargesFor, shellFor } from './weapons-index.js';
import { texturesFor, specFor, refForGlb, entryFor } from './materials-db.js';
import { modeOf } from './weapon-fx.js';
import { CB_COATS, COAT_KEEP } from './weapon-fx-w14.js';   // the Charge Blade's shield coats   // the Switch Axe's mode per stance: the action starts' own word
import { bowMotion } from './weapon-fx-w10.js';   // the Bow's pitch variants: a variant's flags are its main motion's
import { motionAt, drawnFlag, spiritFlags, spiritPulse, SPIRIT_BLUE, snsFlags, oilPart, OIL_RGB, LANCE_UP, lanceFlags, dbFlags, dbPulse, DB_BLUE, DB_RED, cbPhialTriggers } from './weapon-state.js';

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
const _fp = new THREE.Vector3(), _fq = new THREE.Quaternion(), _fs = new THREE.Vector3();
// Where a Kinsect in free flight is shown: the point the game's flight code steers a free
// Kinsect to when it has no target (0x00480428), in metres from the hunter's unit position,
// which stands on the ground (see mounts()).
export const KINSECT_HOVER = [1.5, 2.2, 0];

// The joint frame a proof-effect model sees (0x0031d16c, mode 0 / sub-mode 0): the joint's
// translation as it is, but its rotation taken apart into Euler angles with the parent's
// order (0x007c3638 for order 0 .. 0x007c3a38 for order 4), put back together as single-axis
// rotations in the record's order (0x0031eb84: x Rz, x Rx, x Ry for order 4), scale dropped
// (the rows are normalised; the effect's scale is the record's times the PLAYER's, not the
// joint's). Identical to the joint matrix only when the two orders agree -- as they do for
// the hunter, whose order is 4 like every arrow record's (WeaponRig.playerOrder).
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
// 49 / 50 switch the same barrel and shield parts (1 and 2) plus a second variant part on
// the special models whose display type has them (the Skeletal and Cosmic Cannon, the
// Goldcannon, which has no 16 / 17 at all); which player state fires them is not read yet
const FORM_NAMES = {
  w04: [[36, 'None'], [17, 'Shield'], [16, 'Power Barrel'], [50, 'Shield (alt)'], [49, 'Power Barrel (alt)']],
  w06: [[36, 'None'], [18, 'Long Barrel'], [19, 'Silencer']],
};
// triggers the game fires by itself from the player's state: 0 at rest, 1 drawn, 2 display,
// 3 hold -- never an attachment, so never offered in the select
const STATE_TRIGGERS = new Set([0, 1, 2, 3]);
// THE BOW'S NOCKED ARROW: which record, and when -- the ROM's own rule (read 2026-09-30, render/weapon-fx-w10.js).
// The arrow is not a weapon part: it is a MODEL record of w10_000 (effect\base\cm100_900: the .pel record's byte +0x3d
// = 1, the proof effect's +0x158 = 1 -> 0x323dc8 loads the rModel and the effect draws it), drawn here as a part at the
// record's own placement (shared.arrow.records). The Bow's effect holder (uShellPlEffectW10) creates three of them at its
// setup (vtable +0x148 = 0x455e3c), hidden: slot 3 = 620 (joint 12, the drawing hand, 120 cm along its -X, turned -90 deg
// about Y: the draw line, nock at the hand), slot 4 = 640 (joint 12, (-10, 0, -55) cm, turned 180 deg) and slot 5 = 621
// (joint 8, the bow hand, 22 cm along +X, turned +90 deg). Its stop policy (+0x160 = 0x456094) writes their show bytes
// every frame: 620 = BIT 0 and 640 = BIT 1 of the playing motion's GROUP-2 sequence track at its frame (0x281de4(self,
// 1, bit) = player +0x14e4, filled by 0x280254; shared.arrow.flags, C:/MHGU-Extract/add-bow-arrow-flags.py); 621 =
// Motion[52] played by acts 19 / 45 (0x456ac0), or base motions this app does not play (bank 0's 121 / 122 with group
// 1's acts 128..130; Motion[51] / [52] with group 4's act 10). A bow whose pl_w10.plweplist mSubParam[0] is 1 (models
// 17, 73, 158: the Kelbi Stingshot, Genie's Grimoire and Kayamcha Slinger) holds 630 / 650 / 631 instead (650 another
// model, cm020_001) -- NOT reproduced: such a bow shows none. (Until 2026-09-30 the code that asks the arrow had not been
// found, and record 521, which has 620's placement, was shown through windows read off each stance by eye, 2026-09-19.)
const ARROW_BITS = [['620', 1], ['640', 2]];
const ARROW_HELD = { draw: { 52: '621' } };
// Hunter clips a weapon's own list has no clip for, and the weapon clip they take instead of
// the drawn idle bindMotion falls back to, by stance file (w10 and w10_sa share clip names).
// The Bow's string is its bone 2 SCALED along Z by the list (x2.2 in Motion[16], x2.65 in the
// aim, Motion[105]), so a draw the list lacks would hold the arrow on a slack string.
//   * Motion[5] (Stance 5), an aim walk (its schedule fires footsteps 251/252 at frames 20
//     and 44) and Motion[60] (Stance 18) hold the drawing hand on the draw line for the whole
//     clip; the lists have no clip 5 or 60, so the bow keeps the aim (Raven, 2026-09-19:
//     Stance 5 "will need the bowstring to be pulled back"). Not Motion[4], the other walk:
//     its drawing hand points 150 deg off the line.
//   * The hunter's lists hold two or three versions of most actions (105/106/107, 118/119/120,
//     189/190/191 ...) and the bow's lists only the first. Their drawing hands follow the
//     first's path (RMS 3-17 cm and 0.5-31 deg apart over the clip; 127/128, 130/131, 150
//     and sa 3, 5, 6, 8, 9 are the first's animation exactly), so each takes the first's bow
//     clip (review of 2026-09-19; which clip the game gives the bow is not read -- the bow's
//     LMT has no entries for them at all).
const WEAPON_CLIP = {
  w10: {
    'Motion[5]_loop': 'Motion[105]_loop', 'Motion[60]': 'Motion[105]_loop',
    'Motion[106]_start': 'Motion[105]_start', 'Motion[107]_start': 'Motion[105]_start',
    'Motion[106]_loop': 'Motion[105]_loop',   'Motion[107]_loop': 'Motion[105]_loop',
    'Motion[109]': 'Motion[108]', 'Motion[110]': 'Motion[108]',
    'Motion[116]': 'Motion[115]', 'Motion[117]': 'Motion[115]',
    'Motion[119]': 'Motion[118]', 'Motion[120]': 'Motion[118]',
    'Motion[124]': 'Motion[123]', 'Motion[125]': 'Motion[122]',
    'Motion[127]': 'Motion[126]', 'Motion[128]': 'Motion[126]',
    'Motion[130]': 'Motion[129]', 'Motion[131]': 'Motion[129]',
    'Motion[135]': 'Motion[134]', 'Motion[136]': 'Motion[134]',
    'Motion[150]_start': 'Motion[233]_start', 'Motion[150]_loop': 'Motion[233]_loop',
    'Motion[190]': 'Motion[189]', 'Motion[191]': 'Motion[189]',
    'Motion[193]_start': 'Motion[192]_start', 'Motion[194]_start': 'Motion[192]_start',
    'Motion[193]_loop': 'Motion[192]_loop',   'Motion[194]_loop': 'Motion[192]_loop',
    'Motion[198]_start': 'Motion[197]_start', 'Motion[199]_start': 'Motion[197]_start',
    'Motion[198]_loop': 'Motion[197]_loop',   'Motion[199]_loop': 'Motion[197]_loop',
  },
  w10_sa: {
    'Motion[2]': 'Motion[1]', 'Motion[3]': 'Motion[1]', 'Motion[5]': 'Motion[4]', 'Motion[6]': 'Motion[4]',
    'Motion[8]': 'Motion[7]', 'Motion[9]': 'Motion[7]', 'Motion[11]': 'Motion[10]', 'Motion[12]': 'Motion[10]',
    'Motion[16]': 'Motion[15]', 'Motion[17]': 'Motion[15]', 'Motion[19]': 'Motion[18]', 'Motion[20]': 'Motion[18]',
  },
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
    this.kinsectElement = null;                // its strongest element (ELEMENTS index), null none
    this.kinsectMotion = null;                 // a clip of its own list in free flight, null perched
    this.kinsectTime = null;                   // a fixed time for that clip (the harness), null = run
    this._kinT = 0; this._kinLast = 0;
    this.arrowKey = null;                      // no arrow until a PEL record is chosen
    // the player's angle order (MT enum, uCoord +0x38): 4, written by the player's action
    // reset 0x000a50dc (reached from the player update 0x000ad6f8); the action-step
    // interpreter 0x0009ee80 sets 1 only while its work flag 0x400 is on (commands 42 / 41, 43)
    this.playerOrder = 4;
    this.parts = {};                 // kind -> root, for the parts currently built
    this.drawn = true;               // the player's drawn flag
    this.stance = null;              // { file, clip, dur, label } from the class's stance list
    this.modeWord = null;            // player+0x3328 for the Switch Axe: 'sword' / 'axe' as the last declaring stance set it, carried
    this.form = null;                // gimmick trigger override, null = the game's rule
    // THE WEAPON MODEL'S OWN STATE (render/weapon-state.js), each the user's control: the Long Sword's Spirit Gauge level
    // (0 none, 1..3, 4 Valor's) and the Sword & Shield's oil (0 none, 1 Affinity, 2 Destroyer, 3 Stamina, 4 Mind's Eye)
    this.spirit = 0;
    this.oil = 0;
    // the Dual Blades' states the blades' part code reads (render/weapon-state.js dbFlags): Demon Mode (vtable +0x4c4) and
    // Valor State (style 5 with the second status word's hi 0x40000) -- the user's switches
    this.demonMode = false;
    this.valorState = false;
    this.shieldCoat = false;         // the Lance's Healing Shield: pl_lance_up over the shield (applyShieldCoat)
    this.cbCoat = null;              // the Charge Blade's coat: { kind, both } (applyCbCoat)
    this.cbGauge = 0;                // the Charge Blade's gauge level 0..3: its phials (cbPhialTriggers)
    this._ps = null;                 // the part state's memory: the last frame's triggers, the colours written, the pulse
    this._appliedKey = null;
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
  // THE PHIAL this Switch Axe fires ('Power' | 'Element' | 'Paralysis' | 'Dragon' | 'Exhaust' |
  // 'Poison'), or null for a class that ships none. The game's own effects for a sword-mode attack
  // are chosen by it (Raven, 2026-09-27: "When doing Sword Mode attacks, they use the effect"), so
  // the effect layer will read this; nothing draws from it yet.
  phial(){ return phialFor(this.cj, this.modelId, this.weaponName); }
  // more than one means the model alone cannot say and the name decided it
  phialAmbiguous(){ return phialsFor(this.cj, this.modelId).length > 1; }
  // THE ELEMENT this weapon carries, by name, or null (weapons-index.js elementFor): the game's player parameter 17
  element(){ return elementFor(this.cj, this.modelId, this.weaponName); }
  // THE HUNTING HORN'S NOTES this weapon carries ([n1, n2, n3], note numbers 1..8), by name, or null (weapons-index.js
  // notesFor): the game's player parameters 27..29 (render/weapon-fx-w12.js)
  notes(){ return notesFor(this.cj, this.modelId, this.weaponName); }
  // THE BOW'S OPEN CHARGE LEVELS (2..4), by name, or null (weapons-index.js chargesFor): the game's player parameter 28,
  // the cap of the class's charge level (render/weapon-fx-w10.js)
  charges(){ return chargesFor(this.cj, this.modelId, this.weaponName); }
  // THE GUNLANCE'S SHELLING, { type, level } by name, or null (weapons-index.js shellFor): player parameters 27 / 28
  shell(){ return shellFor(this.cj, this.modelId, this.weaponName); }
  // THE WEAPON ON THE BACK, AS THE GAME TESTS IT. The weapon unit's state word +0x13d4 is its mount INDEX (0x316edc switches
  // on it; build/notes/palico-weapon.md), and the game's test is (index | 0x10) == 0x12: index 2 (the carry on the back) or
  // 18 (the rest record) -- the effect holder's stop policy (0x454f6c) and Tempest Axe's gate (0x11a5db0) both ask it.
  // Read from the mount step() placed this frame, so it follows the clip's own events: a sheathe stance goes to the back
  // at the frame its LMT ids say, not at its end. false with no main part (no weapon is not "on the back").
  onBack(){
    const p = this.parts && this.parts.main, m = p && p.userData.mount;
    return !!(m && typeof m.index === 'number' && ((m.index | 0x10) === 0x12));
  }
  modelRows(){ return (this.cj && this.cj.weapons) || []; }
  classJson(){ return this.cj; }

  clearParts(){
    for (const kind of Object.keys(this.parts)){
      const p = this.parts[kind];
      if (p) this.scene.remove(p);
    }
    this.parts = {};
    this._appliedTrg = null;
    this._ps = null;                 // the materials it wrote went with the parts
  }

  // set(cls, modelId): load the class index, pick the model (null = the class's first named
  // Smithy row, its Petrified weapon), build every part it ships, bind the motion sets.
  // `name` is the NAMED WEAPON the caller picked, where it knows one. It is only consulted for a
  // model that several named weapons share and that they disagree about -- the phial (phialFor).
  async set(cls, modelId, name){
    const seq = ++this._seq;
    this.weaponName = name || null;
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
    // the PART table (`.plgmktype` group) is picked by the list's mDispType, shipped as
    // models[id].disp, not by the motion group: across every class the display type's
    // trigger list names exactly the parts the model carries (the Skeletal Cannon's 3-5, the
    // Loyal Thunder's 3, the Goldcannon's 3-5 ...) while the motion group's often names parts
    // the model has not got. Read off the motion group, those extra parts never switched and
    // every variant showed at once (Raven, 2026-09-03: "some have attachments that render
    // oddly").
    this.gmkGroup = (m && m.disp !== undefined) ? m.disp : 0;
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
    this.applyKinsectColours();
    await this.rebindMotion();
    this.applyShieldCoat();
    this.applyCbCoat();
    this.step();
  }

  // the kinsect: type 20 of the Insect Glaive, a model from docs/weapons/bug.json
  async setKinsect(id, seq){
    const token = (this._kseq = (this._kseq || 0) + 1);
    if (this.parts.kinsect){ this.scene.remove(this.parts.kinsect); delete this.parts.kinsect; }
    this.kinsectId = id || null;
    this.applyKinsectColours();                // the glaive follows the Kinsect, or loses its colour
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
    for (const [, root] of built) root.userData.joints = m.joints || [];   // the gid table (bug.json models[id].joints)
    this.applyKinsectWings();
    this.applyKinsectColours();
    await this.bindMotion('kinsect');
    if (stale()) return;
    this.step();
  }

  // ---- the Kinsect's own motion ----------------------------------------------------------
  // Raven, 2026-09-18: "let's focus on seeing if we can animate the Kinsects. They can leave
  // the hunter ... we are simply displaying the Kinsects." The shell's state machine
  // (0x00481870: mode +0x15bc, state +0x15be) requests every clip of its list; what it does
  // around them, read from the ROM (build/notes and the board carry the table):
  //   perched  mode 0 states 3/8/9 (0x0048288c): clip 6, a static pose; on the hunter's
  //            joint 11 (state 3), scale 0.8 (+0x60..+0x68), wings folded (0x0047f754)
  //   flying   take-off (0x0047eb48) opens the wings again and the flight handlers set the
  //            scale to 1.0 (0x00482ad0, 0x00483ae0, 0x00483d4c, 0x00484740); clips 0 and 7
  //            are the mode-0 flight near the hunter (0x00481e64, 0x0048244c), 21 the mode-0
  //            handler 0x00482ad0, 1-5, 10, 20 and 30-33 the mode-1 handlers; 40 has no
  //            request in this machine
  // null = perched, else a clip of the list shown in free flight (render: placePart `free`).
  async setKinsectMotion(name){
    const mo = this._bugJson && this._bugJson.motion;
    const ok = !name || !mo || ((mo.clips || []).includes(name) && name !== mo.perched);
    this.kinsectMotion = (name && ok && !(mo && name === mo.perched)) ? name : null;
    this._kinT = 0; this._kinLast = 0;
    this.applyKinsectWings();
    await this.bindMotion('kinsect');
    this.step();
  }
  // The wings: the joint the model's id map lists under id 3 goes to 0.1 while perched
  // (0x0047f754, called by the perch handler) and back to 1.0 at take-off (0x0047eb48) --
  // in bug001 the only bone with wing vertices. Models whose map has no id 3 have no fold.
  applyKinsectWings(){
    const part = this.parts.kinsect, fold = this._bugJson && this._bugJson.perch && this._bugJson.perch.fold;
    if (!part || !fold) return;
    for (const b of gidBonesOf(part)) if (b.gid === fold.gid) b.node.scale.setScalar(this.kinsectMotion ? 1 : fold.scale);
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
    const chan = [];                           // the materials that name a colour channel
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
        noTint: true,          // no armour pigment; the Kinsect colours are applyKinsectColours
        wire: this.ctx.wire });
      o.material = mat; allMats.push(mat);
      if (rom && rom.ch) chan.push(mat);
      if (mat.userData.renderOrder) o.renderOrder = mat.userData.renderOrder;
      if (tx && tx.albedo) jobs.push(getTexture(tx.albedo).then(t0 => { if (setOverlayAlbedo(mat, t0)) return;
        const t = applyRomUv(mat, t0);
        mat.map = t; if (mat.userData.emissiveFromMap) mat.emissiveMap = t; mat.needsUpdate = true; }));
      if (rom){
        if (rom.feat && rom.feat.reflect === 'SphereMap' && rom.sphere) jobs.push(getTexture(rom.sphere).then(t => setEnvTexture(mat, t)));
        if (rom.spec && !rom.specIsAlbedo) jobs.push(getTexture(rom.spec).then(t => setSpecTexture(mat, t)));
      } else if (tx && tx.sphere) jobs.push(getTexture(tx.sphere).then(t => setEnvTexture(mat, t)));
    });
    await Promise.all(jobs);
    root.userData.chanMats = chan;
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
  // A LEVEL OR AN OIL PICKED IS A NEW STATE: its trigger rises afresh and restarts its clip. (In the game the Long Sword's
  // level 4 and 3 share trigger 23, so dropping from one to the other raises nothing and the blue would stand, frozen;
  // here the select is how the user asks for a look, so each pick starts from nothing.)
  setSpirit(n){ n = +n; this.spirit = (n >= 1 && n <= 4) ? n : 0; this.clearPartState(); this._appliedTrg = null; this.step(); }
  setOil(n){ n = +n; this.oil = (n >= 1 && n <= 4) ? n : 0; this.clearPartState(); this._appliedTrg = null; this.step(); }
  setDemonMode(on){ this.demonMode = !!on; this._appliedTrg = null; this.step(); }
  setValorState(on){ this.valorState = !!on; this._appliedTrg = null; this.step(); }
  setCbGauge(n){ n = +n; this.cbGauge = n >= 0 && n <= 3 ? n : 0; this.step(); }
  // THE LANCE'S HEALING SHIELD (render/weapon-state.js LANCE_UP): the user's control, as the Arts' states are. While it
  // stands the shield's materials outside colour channel 10 take pl_lance_up's constants and its looping clip, the green
  // pulse (material.js stepMaterialAnim runs it every frame) -- drawn or sheathed: nothing in the request (0x1179d88) or
  // the part's override tests either.
  setShieldCoat(on){ this.shieldCoat = !!on; this.applyShieldCoat(); }
  applyShieldCoat(){
    const p = this.parts.second, o = (this.cls === 'w03' && this.shieldCoat) ? LANCE_UP : null;
    if (!p) return;
    p.traverse(x => {
      const m = x.material;
      if (!m || !m.userData || !m.userData.rom || m.userData.rom.ch === 10) return;
      if (o || m.userData.override) setMaterialOverride(m, o);
    });
  }
  // THE CHARGE BLADE'S COAT (render/weapon-fx-w14.js CB_COATS): Shield Charge's red or Valor State's blue, as the class's
  // update posts it every frame (0x11d0df4: part-state 4 / 6, mask 0x40000400 -- channels 10 and 30 keep their own) on the
  // shield and, in axe mode, the blade. `c` is { kind, both } or null; ChargeBladeEffects decides it from the player's facts.
  setCbCoat(c){ this.cbCoat = c || null; this.applyCbCoat(); }
  applyCbCoat(){
    const c = this.cls === 'w14' ? this.cbCoat : null, o = c ? CB_COATS[c.kind] : null;
    for (const [part, on] of [[this.parts.second, !!o], [this.parts.main, !!(o && c.both)]]){
      if (!part) continue;
      part.traverse(x => {
        const m = x.material;
        if (!m || !m.userData || !m.userData.rom || COAT_KEEP.has(m.userData.rom.ch)) return;
        if (on) setMaterialOverride(m, o);
        else if (m.userData.override) setMaterialOverride(m, null);
      });
    }
  }
  // the arrow placement: a key of shared.arrow.records ('520' ...) or null for none
  setArrow(key){ this.arrowKey = (key === null || key === undefined || key === '') ? null : String(key); this.step(); }
  // the Kinsect's strongest element: an index into ELEMENTS (render/kinsect.js), or null for none
  setKinsectElement(e){
    this.kinsectElement = (e === null || e === undefined || e === '' || !(+e >= 0 && +e < ELEMENTS.length)) ? null : +e;
    this.applyKinsectColours();
  }
  // The Insect Glaive's and its Kinsect's colours (render/kinsect.js), as 0x002876a8 hands them
  // out: the glaive's channel-5 materials take the Kinsect's species colour, the Kinsect's own
  // channel 5 the same and its channel 6 the element colour. With no Kinsect the game colours
  // nothing, so every channel material keeps its own constants -- as it does on every other
  // weapon, whose channels (3, 8, 30 ...) are fed by other code this app does not model yet.
  applyKinsectColours(){
    const cols = (this.cls === 'w13' && this.kinsectId) ? kinsectColours(modelIdOf(this.kinsectId), this.kinsectElement) : null;
    for (const kind of Object.keys(this.parts)){
      const mats = (this.parts[kind] && this.parts[kind].userData.chanMats) || [];
      for (const mat of mats){
        const ch = mat.userData.rom.ch;
        const own = kind === 'kinsect' ? (ch === 5 || ch === 6) : (kind === 'main' && ch === 5);
        setChannelColor(mat, (cols && own) ? cols[ch] : null);
      }
    }
  }
  // the player's angle order the arrow's joint is decomposed with (MT enum 0..5; see mounts())
  setPlayerOrder(n){ n = Number(n); this.playerOrder = (n >= 0 && n < MT_ORDER.length) ? n : 4; this.step(); return MT_ORDER[this.playerOrder]; }
  arrowOptions(){ const r = this.cj && this.cj.shared.arrow && this.cj.shared.arrow.records; return r ? Object.keys(r) : []; }
  // the record the current stance shows at time t (default: now), as the holder's policy shows it: the motion's group-2
  // bit at its frame (620 / 640), else the motion that holds 621; null for none
  stanceArrow(t){
    const arrow = this.cj && this.cj.shared.arrow, fl = arrow && arrow.flags;
    if (!fl || !this.stance) return null;
    const m = this.cj.models && this.cj.models[this.modelId];
    if (m && m.sub && m.sub[0] === 1) return null;                 // 630 / 650 / 631: not reproduced
    const set = /_sa\./.test(this.stance.file || '') ? 'sa' : 'draw';
    const mm = /Motion\[(\d+)\]/.exec(this.stance.clip || '');
    if (!mm) return null;
    // a pitch variant (Motion[106] of [105] ...) is blended into its main motion, whose flags the game reads
    const n = String(bowMotion(set, +mm[1]));
    // the motion frame (player +0x500): a `_loop` stance is the second half of one LMT motion (its start, stance.t0)
    const at = t === undefined ? this.poseTime() : t;
    const total = fl.frames && fl.frames[set] && fl.frames[set][n];
    const f = Math.floor((at + (this.stance.t0 || 0)) * 60 + 1e-6);
    let bits = 0;
    const spans = fl[set] && fl[set][n];
    if (spans && f < total) for (const [from, b] of spans){ if (f >= from) bits = b; else break; }
    for (const [key, bit] of ARROW_BITS) if (bits & bit) return key;
    return (ARROW_HELD[set] && ARROW_HELD[set][n]) || null;
  }
  // the select's label for a record: its number, joint, position (cm) and rotation (deg)
  arrowLabel(k){
    const r = this.cj && this.cj.shared.arrow && this.cj.shared.arrow.records && this.cj.shared.arrow.records[k];
    if (!r) return 'Record ' + k;
    const v = a => '(' + a.map(x => Math.round(x)).join(', ') + ')';
    return k + ' · joint ' + r.joint + ' · ' + v(r.pos) + ' cm' + (r.rot.some(x => x) ? ' · rot ' + v(r.rot) : '');
  }
  setStance(entry){
    this.stance = entry || null; this._appliedTrg = null;
    // THE MODE WORD (player+0x3328): every Switch Axe action start writes it (vtable +0x84c) and the base's own
    // idle/run picks read it (render/weapon-fx.js MODES); a stance that declares nothing leaves it as it was
    if (entry && entry.clip){
      const m = /Motion\[(\d+)\]/.exec(entry.clip), set = /_sa\.glb$/.test(entry.file || '') ? 'sa' : 'draw';
      const word = m ? modeOf(set, +m[1]) : null;
      if (word) this.modeWord = word;
    }
  }
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
    const now = t === undefined ? this.poseTime() : t;
    const at = this.activeIds(now);
    const axe = this.axeMode(at);
    const out = {};
    for (const kind of Object.keys(this.parts)){
      if (!this.parts[kind]) continue;
      if (kind === 'arrow'){
        // One of the proof-effect records of docs/weapons/wNN.json shared.arrow.records --
        // joint, position (cm), rotation (deg) and its angle order as the PEL says. Which one
        // shows is the Bow's effect holder's (stanceArrow, above); the hidden Arrow select
        // picks one by hand where it shows none.
        // The game composes a joint-following model effect (uProofEffect, 0x0031d16c with
        // mode 0 / sub-mode 0) as: position = the joint's world matrix applied to the
        // record's position; rotation = the joint's rows normalised, DECOMPOSED into angles
        // with the PLAYER's angle order (uCoord +0x38; 0x007c3638..), re-applied as
        // single-axis rotations in the record's order (0x0031eb84 for order 4), times the
        // record's rotation; then the sum is rebuilt in the record's order (0x00320ed4) and
        // the effect keeps that order (+0x38, set at creation 0x009b3308). The player's order
        // is 4 (see the constructor) and so is every arrow record's, so the joint comes
        // through unchanged; `frame` keeps both for setPlayerOrder's comparison. (Read as the
        // unit default 0 until 2026-09-19, which stood every record across the draw line.)
        const recs = this.cj.shared.arrow && this.cj.shared.arrow.records;
        const byStance = this.stanceArrow(now);
        const key = byStance || this.arrowKey;
        const a = recs && key ? recs[key] : null;
        const order = a && MT_ORDER.includes(a.order) ? a.order : 'YXZ';
        const pord = MT_ORDER[this.playerOrder] || 'YXZ';
        out[kind] = a ? { type: null, index: null, joint: a.joint, rec: { pos: a.pos, rot: a.rot, order },
                          frame: { decompose: pord, rebuild: order },
                          scale: a.scale || 1, record: key,
                          prov: a.prov + (byStance ? '; shown by the holder (the motion\'s group-2 flags, 0x456094)' : '; chosen by the user') +
                                '; joint re-composed ' + pord + '->' + order + ' (0x0031d16c; player order 0x000a50dc)' } : null;
        continue;
      }
      if (kind === 'kinsect' && this.kinsectMotion){
        // In flight the Kinsect is its own unit, off the hunter: at the point the flight code
        // steers a free Kinsect to when it has no target (0x00480428): the hunter's position
        // plus (150 cos a, 220, -150 sin a) cm for the hunter's yaw a (+0xfec; 0x013ecc20 is
        // sinf, 0x013ecc2c cosf, read from the import table), i.e. 1.5 m along the hunter's
        // own +X -- the left side, joint 11 on -X being the right arm -- and 2.2 m up. The
        // hunter's position is on the ground; the viewer's hunter faces +Z with its pelvis at
        // the origin and its feet at the pose driver's rest ground (the lowest bone at rest,
        // pose.js), so the point is measured from there. Scale 1.0, as every flight handler
        // sets it.
        const g = (this.pose && Number.isFinite(this.pose.ground)) ? this.pose.ground : 0;
        out[kind] = { free: true, type: null, index: null, joint: null,
                      anchor: [KINSECT_HOVER[0], g + KINSECT_HOVER[1], KINSECT_HOVER[2]], scale: 1,
                      prov: 'rom: hover point 0x00480428 (no target) above the rest ground, flight scale 1.0 (0x00482ad0 ..), clip from the Kinsect list' };
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
    const ps = this.partState();          // after placePart: it reads where the mount put the weapon
    this.applyForm(ids, mounts, ps);
    this.stepPartState(ps);
  }
  placePart(part, m){
    const b = part.userData.bone;
    if (m && m.free){
      // A free unit (the Kinsect in flight): its own frame at the anchor, then the clip's
      // reference track, then bone 0's own motion -- the model's node chain
      // reference -> 0:0, which the perched path skips because clip 6 moves neither.
      part.userData.mount = m;
      part.visible = !!b && this.visible;
      if (!part.visible) return;
      b.matrixAutoUpdate = false; b.matrixWorldAutoUpdate = false;
      b.matrix.compose(_fp.fromArray(m.anchor), _fq.identity(), _fs.setScalar(m.scale));
      const mot = part.userData.mot;
      if (mot && mot.refSrc) b.matrix.multiply(_rootM.compose(mot.refSrc.position, mot.refSrc.quaternion, mot.refSrc.scale));
      if (mot && mot.rootSrc) b.matrix.multiply(_rootM.compose(mot.rootSrc.position, mot.rootSrc.quaternion, mot.rootSrc.scale));
      b.matrixWorld.copy(b.matrix);
      b.children.forEach(c => c.updateMatrixWorld(true));
      return;
    }
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
      // Sword & Shield's shield rest loop (0, 0.88, 0) and is superseded by this one. THAT 0.88 m
      // WAS NEVER BONE 0's (corrected 2026-09-30, Raven: "Sheathed SnS shield placement is off again,
      // it is floating off the arm"): wg01_r_00's first track in every motion is a per-motion TAG
      // track (its bone byte runs 0, 1, 2, 3, 9, 18, 130 with the motion; reference (0, 87.959, 0) cm
      // in motions 0 and 1), and lmt_to_gltf took it for bone 0 in motion 0 alone, where the tag is
      // 0. The list's own bone-0 track there is (0, 0, 0), fixed in the two group-0 off sets. The
      // game plays that rest clip on the shield whenever the weapon is on the back (0x30837c: a
      // non-weapon motion bank -> clip 0 while the main part's mount index is 2 / 0x12), so the
      // shield stays on the arm.
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
      try { g = await loader.loadAsync(bust(rec.file)); } catch (_) { return null; }
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
    const want = kind === 'kinsect' ? (this.kinsectMotion || recs[0].perched) : (this.stance && this.stance.clip);
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
    // a flight clip this Kinsect's list lacks: back to the perch
    if (!hit && kind === 'kinsect' && this.kinsectMotion){ this.kinsectMotion = null; this.applyKinsectWings(); hit = find(recs[0].perched); }
    const ids0 = want ? this.activeIds(0) : null;
    // The idle of the clip's MODE: an axe-mode Charge Blade action without a shield clip
    // (33 of its 53 axe clips) keeps the shield where the axe idle holds it, bone 0 at
    // 1.8 m up the weapon, not where the sword idle has it (Raven, 2026-09-03: the shield
    // sat at the sword's base through axe mode). Motion[20]_loop is the axe idle.
    //   THE SWITCH AXE'S IS THE GAME'S OWN RULE, read 2026-09-28 (the weapon part unit's update
    // 0x30837c): the unit plays its own clip N when its list has it (0x950b48), else the idle clip
    // of the MODE the player's word holds -- Motion[20] in sword mode, Motion[1] otherwise (the
    // type-8 branch; the Charge Blade's, type 14, is the reverse) -- not "the pose it already
    // had". The word is this rig's modeWord (setStance). Raven: "Still seeing Demon Riot effect
    // on Axe Mode animations" -- a hit reaction after a sword stance drew the axe idle under the
    // sword-mode aura.
    const swordIdle = this.cls === 'w08' && this.modeWord === 'sword';
    const idleNames = (swordIdle || (ids0 && this.axeMode(ids0)))
      ? ['Motion[20]_loop', 'Motion[20]', 'Motion[1]_loop', 'Motion[1]'] : ['Motion[1]_loop', 'Motion[1]'];
    let idleHit = null;
    for (const n of idleNames){ idleHit = find(n, drawSets); if (idleHit) break; }
    // a stance the list lacks that plays another clip of the list rather than the idle
    // (WEAPON_CLIP: the Bow's aim walk keeps the aim; a second or third version of an action
    // takes the first's clip -- string drawn with the arrow on it)
    const byFile = WEAPON_CLIP[this.stanceKey()];
    const holdName = !hit && want && kind !== 'kinsect' && byFile && byFile[want];
    if (holdName) hit = find(holdName) || find(holdName, drawSets);
    // THE GAME PAIRS BY MOTION NUMBER, NOT BY THE DECORATED NAME. A motion slot is one clip to the
    // engine; the _start / _loop / bare suffixes are how the exporter names the LMT's segments, and the
    // two lists do not always agree on them -- the Switch Axe's stance Motion[137] meets its weapon's
    // Motion[137]_loop, its Motion[123]_start meets Motion[123]_loop, and 245 / 247 disagree the other
    // way round. Matching on the exact string alone, those six stances (and the Charge Blade's
    // Motion[189]) found nothing and fell back to the DRAWN IDLE -- which for a Switch Axe is the axe
    // shape, so a sword-mode action showed the axe (Raven, 2026-09-27: "Switch Axes not entering Sword
    // mode"). Measured across the shipped lists, only those seven stances are affected; every other
    // stance either pairs exactly or has no weapon clip for its number at all.
    //   The preference order is the segment's own kind first (a _start stance takes a _start clip),
    // then the loop, then whatever the list has for that number -- never another number.
    if (!hit && want && kind !== 'kinsect'){
      const num = (/Motion\[(\d+)\]/.exec(want) || [])[1];
      if (num !== undefined){
        const suffix = (want.split(']')[1] || '');
        const order = [suffix, '_loop', '_start', ''];
        for (const suf of order){
          const cand = 'Motion[' + num + ']' + suf;
          if (cand === want) continue;
          hit = find(cand) || find(cand, drawSets);
          if (hit) break;
        }
        if (!hit) for (const g of sets){
          const c = g.animations.find(c => c.name && c.name.startsWith('Motion[' + num + ']'));
          if (c){ hit = [c, g]; break; }
        }
      }
    }
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
    // PAIR THE CLIP'S BONES TO THE MODEL'S BY GLOBAL ID, not by the whole node name.
    // A node is named "<localIndex>:<globalId>", and a motion set is shared by every model in its
    // motion GROUP -- but the models in a group do not all order their bones the same way. 23 of the
    // Bow's 105 models name their two limbs `1:2` and `2:1` where the group's clip drives `1:1` and
    // `2:2`: same bones, same global ids, the local indices swapped. Matching on the whole string,
    // NEITHER limb was driven on those 23, so they kept their bind pose -- folded -- through every
    // drawn stance (Raven, 2026-09-27: "Still seeing Bows not unfolding, review each bow"; Akantor
    // Bow, Prominence Bow, Kelbi Stingshot, Diablos Coilbender and 19 more).
    // The GLOBAL ID is what this app addresses bones by everywhere else -- the hunter's pose driver
    // does (render/skeleton.js bonesByGid), and a model row carries `joints[i].gid` for exactly this
    // reason. The local index is a position in one model's table and means nothing across models.
    // The exact name is still tried first, so a set and a model that agree pair as they always did;
    // the `_s` leaf duplicates keep their own key so a leaf can never take a real bone's track.
    const gidKey = n => { const m = /^(\d+):(\d+)(_s)?$/.exec(n || ''); return m ? '#' + m[2] + (m[3] || '') : null; };
    const byName = root => {
      const m = new Map();
      root.traverse(o => {
        const n = o.userData && o.userData.name;
        if (!n) return;
        if (!m.has(n)) m.set(n, o);
        const g = gidKey(n);
        if (g && !m.has(g)) m.set(g, o);
      });
      return m;
    };
    const boneFor = (map, n) => { if (!n) return null; const hit = map.get(n); if (hit) return hit; const g = gidKey(n); return g ? (map.get(g) || null) : null; };
    const rootBone = part.userData.bone;
    const rootName = rootBone && rootBone.userData && rootBone.userData.name;
    // bone 0's layered state: the mount owns the node itself, placePart composes this on top.
    // It starts from the MODEL'S OWN REST, not from zero: a list tracks only some bones (the
    // Gunlance's wg09_00 tracks the lance's bone 1 and never the shield's bone 0) and the
    // game keeps a bone's rest wherever a clip has no track for it, so a shield whose bone 0
    // rests off the origin (Blackhare Gunlance, 0.912 m) stays where its model puts it
    // (Raven, 2026-09-05: "shield is not attached to the arm"). The shipped sets carry no
    // channel for untracked bones any more (strip-untracked-weapon-tracks.py); a tracked
    // bone is still driven from here by copyDriven below.
    const rootBase = rootBone
      ? { position: rootBone.position.clone(), quaternion: rootBone.quaternion.clone(), scale: rootBone.scale.clone() }
      : { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(1, 1, 1) };
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
        const from = boneFor(lsrc, o.userData && o.userData.name);
        if (from) copyDriven(from, o === rootBone ? rootBase : o, flagsFor(ldriven, from.name));
      });
    }
    const proxy = skeletonClone(src_gltf.scene);
    const src = byName(proxy);
    // the live proxy's bone 0 starts from the layered state, so a clip without a root track
    // (an axe attack the shield's list covers without moving bone 0) keeps the idle's offset
    const rootSrc = rootName ? boneFor(src, rootName) : null;
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
      const from = boneFor(src, o.userData && o.userData.name);
      if (!from) return;
      const f = flagsFor(driven, from.name);
      if (f.pos || f.rot || f.scl) pairs.push([from, o, f]);
    });
    // bone 0's track (or its layered state) rides on the mount in placePart. A Kinsect in free
    // flight also carries its list's `reference` track (the LMT's bone-255 absolute position,
    // clips 21 and 30-33) and runs on its own clock, looping so every clip can be watched.
    const free = kind === 'kinsect' && !!this.kinsectMotion;
    const refSrc = free ? (src.get('reference') || null) : null;
    part.userData.mot = (pairs.length || rootSrc || refSrc)
      ? { mixer, pairs, rootSrc, refSrc, free, clip: clip.name, dur: Math.max(clip.duration - 1e-3, 0),
          loop: free || /_loop$/.test(clip.name), len: clip.duration } : null;
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
      if (m.free){
        // the Kinsect in flight keeps its own time: it has left the hunter's action
        const now = performance.now();
        const dtk = this._kinLast ? Math.min((now - this._kinLast) / 1000, 0.1) : 0;
        this._kinLast = now;
        this._kinT = this.kinsectTime !== null ? this.kinsectTime : this._kinT + dtk;
        m.mixer.setTime(at(this._kinT));
      }
      else if (src !== null) m.mixer.setTime(at(src));
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
    const g = this.gmk() && this.gmk()[String(this.gmkGroup)];
    if (!g) return [];
    const trgs = g.filter(r => ((r.on && r.on.length) || (r.off && r.off.length)) && !STATE_TRIGGERS.has(r.trg)).map(r => r.trg);
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
  applyForm(ids, mounts, ps){
    if (!this.cj) return;
    if (!ids){ const r = this.mounts(); ids = r.ids; mounts = r.mounts; }
    if (ps === undefined) ps = this.partState();
    // a class whose part code this app runs (render/weapon-state.js) fires 0 / 1 by that code's own answer; the Charge
    // Blade's adds its phial triggers to the forms' own (ps.cb)
    const own = ps && this.form === null && !ps.cb;
    const trg = own ? (ps.t1 && !ps.t0 ? 1 : 0) : this.currentTrigger(ids, mounts);
    const key = ps ? ps.key : null;
    if (trg === this._appliedTrg && key === this._appliedKey) return;
    this._appliedTrg = trg; this._appliedKey = key;
    const g = this.gmk() && this.gmk()[String(this.gmkGroup)];
    const recs = [];
    if (g){
      // the game's order: 0 at rest, 1 once drawn, then the mode or attachment trigger --
      // each accumulates on the last (a drawn special bowgun deploys its part 3 on trigger 1
      // and keeps it under the attachment trigger)
      const r0 = g.find(r => r.trg === 0); if (r0) recs.push(r0);
      if (own){ if (trg === 1){ const r1 = g.find(r => r.trg === 1); if (r1) recs.push(r1); } }
      else if (this.drawn && trg !== 1){ const r1 = g.find(r => r.trg === 1); if (r1) recs.push(r1); }
      if (!own && trg !== 0){ const r = g.find(r => r.trg === trg); if (r) recs.push(r); }
      // the Long Sword's Spirit trigger (20..23) fires after them, and its record wins
      if (own && ps.trg != null){ const r = g.find(r => r.trg === ps.trg); if (r) recs.push(r); }
      // the Charge Blade's channel-30 triggers come after the forms' (0x315e04)
      if (ps && ps.cb) for (const t of ps.trgs){ const r = g.find(x => x.trg === t); if (r) recs.push(r); }
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
        // the bits the part code sets and clears itself, after the records (the Sword & Shield's oil groups)
        if (kind === 'main' && ps && ps.show && id in ps.show) vis = ps.show[id];
        o.visible = vis;
      });
    }
  }

  // ---- the weapon model's own state (render/weapon-state.js) ------------------------------
  // What the part code answers this frame, for a class whose code this app runs, else null:
  //   { cls, t1, t0 (the drawn / sheathed triggers), trg (the Long Sword's 20..23 or null), blue (its level 4),
  //     show ({ group: visible } the code sets itself), oil, key (what the part visibility depends on) }
  // The motion is the stance's while the weapon is drawn; sheathed, the hunter plays a Hunter Pose, no weapon motion.
  partState(){
    const cls = this.cls;
    if (cls === 'w14' && this.cj){
      const mo = motionAt(this.drawn ? this.stance : null, this.poseTime());
      const trgs = cbPhialTriggers({ drawn: this.drawn, motion: mo.id, frame: mo.frame, onBack: this.onBack(), level: this.cbGauge });
      return { cls, cb: true, trgs, oil: 0, key: 'cb:' + trgs.join(',') };
    }
    if ((cls !== 'w07' && cls !== 'w01' && cls !== 'w03' && cls !== 'w11') || !this.cj) return null;
    const mo = motionAt(this.drawn ? this.stance : null, this.poseTime());
    const o = { drawn: drawnFlag(this.drawn, mo), motion: mo.id, frame: mo.frame, onBack: this.onBack(), disp: this.gmkGroup | 0 };
    if (cls === 'w07'){
      const f = spiritFlags(Object.assign(o, { level: this.spirit }));
      const trg = f.t23 ? 23 : f.t22 ? 22 : f.t21 ? 21 : f.t20 ? 20 : null;
      return { cls, t1: f.t1, t0: f.t0, trg, blue: f.blue, show: null, oil: 0, key: 'ls:' + trg };
    }
    if (cls === 'w11'){
      // Valor State stands for the style byte 5 with its status: in Valor the class enters no Demon Mode, and the reader
      // replaces Demon Mode's bits with Valor's
      const f = dbFlags(Object.assign(o, { demon: this.demonMode, valor: this.valorState, valorState: this.valorState }));
      const trg = f.t24 ? 24 : f.t25 ? 25 : null;
      return { cls, t1: f.t1, t0: f.t0, trg, blue: f.colour, red: f.red, pulse: f.t24, show: null, oil: 0, key: 'db:' + trg };
    }
    if (cls === 'w03'){
      const f = lanceFlags(o);
      const trg = f.t43 ? 43 : f.t51 ? 51 : null;
      return { cls, t1: f.t1, t0: f.t0, trg, blue: false, show: null, oil: 0, key: 'lance:' + trg };
    }
    const f = snsFlags(o);
    const g = this.oil ? oilPart(f.t1, parseInt(this.modelId, 10)) : 0;
    return { cls, t1: f.t1, t0: f.t0, trg: null, blue: false, show: { 21: g === 21, 31: g === 31 }, oil: this.oil, key: 'oil:' + g };
  }
  // THE PART'S MATERIALS, every frame: a trigger's `anime` on its rising edge (0x30890c: slot 0 at time 0 on the trigger's
  // colour channel -- 8 for 0..3, 2 for 20..23), the Long Sword's level-4 colour and pulse, the Sword & Shield's oil colour
  // on the type's change. On the main part: the shield, the scabbard and a second blade are units of their own.
  stepPartState(ps){
    if (!ps){ if (this._ps) this.clearPartState(); return; }
    const main = this.parts.main;
    // the Lance's shield is a unit of its own that runs the same triggers (kind 5 = 0x30de60 asks 0x30dab4 too)
    const units = ps.cls === 'w03' || ps.cls === 'w11' ? [main, this.parts.second] : [main];   // the Dual Blades: kinds 16 / 17
    const chan = ch => units.flatMap(p => (p && p.userData.chanMats) || []).filter(m => m.userData.rom.ch === ch);
    const now = performance.now() / 1000;
    let e = this._ps;
    if (!e || e.cls !== ps.cls || e.root !== main){
      this.clearPartState();
      e = this._ps = { cls: ps.cls, root: main, trgs: new Set(), oil: 0, blue: false, timer: 0, last: now };
    }
    const now1 = ps.cb ? ps.trgs : [ps.t1 ? 1 : null, ps.t0 ? 0 : null, ps.trg].filter(t => t !== null);   // 0x310300's / 0x30aafc's order
    const g = this.gmk() && this.gmk()[String(this.gmkGroup)];
    for (const t of now1){
      if (e.trgs.has(t)) continue;
      const r = g && g.find(r => r.trg === t);
      // the channel the trigger is fired with: the Long Sword's Spirit triggers pass 2, every other here 8
      if (r && r.anime !== undefined && r.anime !== null)
        for (const m of chan(ps.cb ? 30 : ps.cls === 'w07' && t >= 20 && t <= 23 ? 2 : 8)) setMaterialClip(m, r.anime, now);
    }
    e.trgs = new Set(now1);
    if (ps.cls === 'w11'){
      // 0x3136a4: the timer runs while trigger 24 stands; with bit 0x10 the pulse is channel 2's colour and transparency
      if (ps.pulse){
        const p = dbPulse(e.timer, Math.min(Math.max(now - e.last, 0), 0.1) * MAT_FPS);
        e.timer = p.timer; e.pulse = p.value;
      }
      if (ps.blue){
        const rgb = ps.red ? DB_RED : DB_BLUE;
        for (const m of chan(2)){
          setMaterialClip(m, -1, now);
          setCbWrite(m, { reflective: rgb, specular: rgb, transparency: e.pulse == null ? 1 : e.pulse });
        }
      } else if (e.blue) for (const m of chan(2)) setCbWrite(m, null);
      e.blue = ps.blue;
    } else if (ps.cls === 'w07'){
      if (ps.blue){
        const p = spiritPulse(e.timer, Math.min(Math.max(now - e.last, 0), 0.1) * MAT_FPS);
        e.timer = p.timer; e.pulse = p.value;
        for (const m of chan(2)){
          setMaterialClip(m, -1, now);
          setCbWrite(m, { reflective: SPIRIT_BLUE, specular: SPIRIT_BLUE, transparency: p.value });
        }
      } else if (e.blue) for (const m of chan(2)) setCbWrite(m, null);
      e.blue = ps.blue;
    } else if (ps.oil !== e.oil){
      for (const m of chan(2)) setCbWrite(m, ps.oil ? { reflective: OIL_RGB[ps.oil] } : null);
      e.oil = ps.oil;
    }
    e.last = now;
  }
  // back to the materials' own: the clip the engine gave slot 0 at load, the constants they ship
  clearPartState(){
    for (const kind of Object.keys(this.parts)){
      for (const m of (this.parts[kind] && this.parts[kind].userData.chanMats) || []){ clearMaterialClip(m); setCbWrite(m, null); }
    }
    this._ps = null;
  }
  partAudit(){
    const ps = this.partState(), e = this._ps, main = this.parts.main;
    const mats = ((main && main.userData.chanMats) || []).map(m => ({ name: m.name, ch: m.userData.rom.ch, overlay: !!m.userData.ov,
      slot0: m.userData.slot0 || null, write: m.userData.cbWrite || null,
      refl: m.userData.ov ? m.userData.ov.uRefl.value.toArray() : null, transp: m.userData.ov ? m.userData.ov.uTransp.value : null }));
    const groups = {};
    if (main) main.traverse(o => { if ((o.isMesh || o.isSkinnedMesh) && o.userData.part < 100) groups[o.userData.part] = o.visible; });
    return { cls: this.cls, spirit: this.spirit, oil: this.oil, state: ps, trgs: e ? [...e.trgs] : [], pulse: e ? e.pulse : null,
             motion: motionAt(this.drawn ? this.stance : null, this.poseTime()), groups, mats };
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
    return { cls: this.cls, model: this.modelId, kinsect: this.kinsectId, kinsectElement: this.kinsectElement,
             kinsectMotion: this.kinsectMotion, arrow: this.arrowKey, arrowByStance: this.stanceArrow(),
             playerOrder: MT_ORDER[this.playerOrder], drawn: this.drawn,
             stance: this.stance ? this.stance.clip : null, ids: Array.from(ids).sort((a, b) => a - b),
             synthetic, trigger: this._appliedTrg, motGroup: this.motGroup, gmkGroup: this.gmkGroup,
             weaponName: this.weaponName, phial: this.phial(), phialAmbiguous: this.phialAmbiguous(), element: this.element(), parts };
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
