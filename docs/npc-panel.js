// THE NPC TAB (Raven, 2026-10-23: "An NPC tab in the Armor Viewer"): every NPC the game's own table names, drawn with
// its own model and the game's own materials, posed by its own motion lists. The data is docs/npcs.json, read from the
// ROM by dev/build-npcs.py: the NPC table (arc/npc/com.arc npc\tables\baseData\npcID: the model, two motion lists per
// NPC), the names (eng/table/NpcName_eng.gmd, one per record), the models (npc\mod\npcMMM) and the lists built on each
// model. Loaded on the first visit, so the boot does not wait for it.
//
// createNpcPanel(ctx): ctx.world (the stage group), ctx.pose (the shared PoseDriver -- the Animation panel's transport
// drives an NPC's clip as it does the hunter's), ctx.pieceCtx (the piece pipeline's context), ctx.loadEntry
// (render/piece.js), ctx.setLoading, ctx.isActive() (the NPC tab is the figure on screen), ctx.onShown() (frame it).
import { setChannelColor } from './base/render/material.js';
import { meshGroupId } from './base/render/skeleton.js';

export function createNpcPanel(ctx){
  const $ = id => document.getElementById(id);
  const sel = $('npcSel'), poseSel = $('npcPose');
  let DATA = null, loading = null;
  let mounted = null, mountedKey = null, seq = 0;
  // the motion an option names: [list key, clip]
  let poses = [];
  // THE MODEL'S PARTS-DISPLAY SET (uModel +0x110): the groups hidden now (the constructor shows every group), and each
  // mesh of the mounted model with its group and whether the loader left it drawn (a proxy or LOD layer stays hidden)
  let hidden = new Set(), meshes = [], lastMask = null;

  function load(){
    if (DATA) return Promise.resolve(DATA);
    if (!loading) loading = fetch('npcs.json').then(r => r.json()).then(j => {
      DATA = j;
      // the game's names, in the table's order; an NPC the table names twice with the same model is one row
      sel.innerHTML = j.npcs.map((n, i) => '<option value="' + i + '" title="NPC ' + n.ids.join(', ') + ', model ' +
        n.model + '">' + n.name + '</option>').join('');
      return j;
    });
    return loading;
  }
  // THE NPC'S OWN POSES (Raven, 2026-10-23: "Restrict the poses, since some poses end up looking odd with some NPCs"):
  // the motions the NPC table gives this NPC (its record's ten slots, in their order; the record's list), not the whole
  // village list it shares -- one group per list, the list's own name from the game's files; "Pose N" in that order
  function fillPoses(n){
    poses = (n.poses || []).filter(([key]) => DATA.lists[key]);
    const groups = new Map();
    poses.forEach(([key, clip], v) => {
      if (!groups.has(key)) groups.set(key, []);
      const c = DATA.lists[key].clips.find(x => x.clip === clip);
      groups.get(key).push('<option value="' + v + '" title="' + DATA.lists[key].list + ' ' + clip +
        (c && c.dur ? ', ' + c.dur.toFixed(2) + ' s' : ', one frame') + '">Pose ' + (v + 1) + '</option>');
    });
    poseSel.innerHTML = '<option value="">Bind pose</option>' + [...groups].map(([key, opts]) =>
      '<optgroup label="' + DATA.lists[key].list + '">' + opts.join('') + '</optgroup>').join('');
    // a first look gets the first pose rather than the bind pose (the models ship in their T-pose)
    poseSel.value = poses.length ? '0' : '';
  }
  async function show(){
    const n = DATA && DATA.npcs[+sel.value];
    if (!n) return;
    const m = DATA.models[n.model];
    const my = ++seq;
    if (mountedKey !== n.model){
      ctx.setLoading(true);
      try {
        // undyeable: the hunter's pigment never reaches an NPC's dye region (its colour is the NPC's own palette, below)
        const g = await ctx.loadEntry({ glb: m.glb, joints: m.joints || [], undyeable: true }, { key: n.model, slot: 'npc' },
                                      ctx.pieceCtx);
        if (my !== seq) return;                       // superseded while loading
        if (mounted) ctx.world.remove(mounted);
        mounted = g; mountedKey = n.model; meshes = [];
        if (g){
          g.userData.npc = n.model; g.visible = ctx.isActive(); ctx.world.add(g);
          g.traverse(o => { if (o.isMesh) meshes.push({ o, g: meshGroupId(o), drawn: o.visible }); });
        }
      } finally { ctx.setLoading(false); }
    }
    paint(n);
    subParts(n);
    fillPoses(n);
    await play();
    ctx.onShown();
  }
  // THE NPC'S OWN PALETTE (Raven, 2026-10-23: "Some NPCs are the same, but pallete swapped"): the colours its subData
  // gives each colour channel (npcs.json `colours`: [[channel, [r, g, b]] ...]; Red and Black Hell Hunter are one model
  // with two), over fAlbedoColor as the game's channel colours go (setChannelColor); a channel it names no colour for
  // keeps the model as drawn. Repainted on every NPC change: two NPCs can share the loaded model.
  function paint(n){
    if (!mounted) return;
    const cols = new Map((n.colours || []).map(([ch, rgb]) => [ch, rgb]));
    mounted.traverse(o => {
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const mat of mats){
        const rom = mat.userData && mat.userData.rom;
        if (!rom || !mat.userData.u) continue;
        setChannelColor(mat, cols.get(rom.ch) || null);
      }
    });
  }
  // THE NPC'S OWN PARTS (Raven, 2026-10-23: "Argosy Captain has a second sword model rendering"): its subData's hide /
  // show records (npcs.json `parts`: [[0 hide | 2 show, group] ...], uLobbyNpc 0x6bf26c), in order, over a model that
  // starts with every group shown -- the Captain's (0, 1) hides the copy of his sheathed sword in his hand and leaves the
  // one on his back.
  // Applied on every NPC change: two NPCs can share the loaded model.
  function subParts(n){
    hidden = new Set(); lastMask = null;
    for (const [cmd, grp] of (n && n.parts) || []){
      if (cmd === 0) hidden.add(grp); else if (cmd === 2) hidden.delete(grp);
    }
    showParts();
  }
  function showParts(){
    for (const m of meshes) m.o.visible = m.drawn && !hidden.has(m.g);
  }
  // PARTS BY MOTION (uLobbyNpc 0x6beb38, every frame): for the NPCs the game names (npcs.json `partsByMotion`: true, or
  // the motions it applies in), the playing clip's parts track sets the groups -- at the clip's frame (below) the span's
  // bit k hides group slot k and a clear bit shows it; no bits, or no track, shows every
  // group. Any other NPC or motion leaves the groups as they are -- in the game they stay as the last motion left them;
  // here a pose is a fresh start, so each one begins from the NPC as it loads (play()).
  function tick(){
    const n = DATA && DATA.npcs[+sel.value], v = poseSel.value, act = ctx.pose.action;
    if (!mounted || !n || !n.partsByMotion || v === '' || !poses[+v] || !act) return;
    const [key, clip] = poses[+v];
    const no = +((/^Motion\[(\d+)\]/.exec(clip) || [])[1]);
    if (n.partsByMotion !== true && !n.partsByMotion.includes(no)) return;
    const c = DATA.lists[key].clips.find(x => x.clip === clip), P = c && c.parts;
    let mask = 0;
    if (P){
      // the track spans the motion's frames 0 .. n-1, and its last span is always a lone frame of no bits; the game
      // reads one frame back once the motion has ended (0x6bec68), so it never shows that frame. The clip's clock
      // reaches n-1 (or n: a clip can run n/60 s) only at its end, so anything from n-1 on is read as n-2
      const n = P.spans.reduce((a, [, frames]) => a + frames, 0);
      let f = Math.floor(act.time * 60 + 1e-4) + P.at;
      if (f >= n - 1) f = n - 2;
      let sum = 0;
      for (const [bits, frames] of P.spans){ sum += frames; if (sum > f){ mask = bits; break; } }
    }
    if (mask === lastMask) return;
    lastMask = mask;
    if (!mask) hidden = new Set();
    else P.groups.forEach((grp, k) => { if (!grp) return; if (mask >> k & 1) hidden.add(grp); else hidden.delete(grp); });
    showParts();
  }
  async function play(){
    const n = DATA && DATA.npcs[+sel.value];
    const v = poseSel.value;
    // every pose starts from the NPC as it loads (its subData), the bind pose included
    subParts(n);
    if (!n || v === '' || !poses[+v]) { ctx.pose.stop(); return; }
    const [key, clip] = poses[+v];
    const m = DATA.models[n.model], L = DATA.lists[key];
    // the clip binds to a clone of the NPC's own model by node name (pose.js entry.model), and its bones are copied out
    // by joint id, as a monster's are
    await ctx.pose.play({ file: L.file, model: m.glb, clip, src: L.list }, { figure: 'npc', joints: m.joints || [] });
  }
  sel.addEventListener('change', () => { show(); });
  poseSel.addEventListener('change', () => { play(); });

  return {
    // the NPC on screen (the pose driver's roots)
    roots: () => mounted ? [mounted] : [],
    // entering the tab: load the table once, then the selected NPC (the first, on a first visit)
    async enter(){
      await load();
      if (!mounted) await show();
      else { if (mounted) mounted.visible = true; paint(DATA.npcs[+sel.value]); await play(); }
    },
    leave(){ if (mounted) mounted.visible = false; },
    play,
    // every frame a pose plays on the NPC (index.html stepGamePose)
    tick
  };
}
