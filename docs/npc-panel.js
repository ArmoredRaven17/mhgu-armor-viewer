// THE NPC TAB (Raven, 2026-10-23: "An NPC tab in the Armor Viewer"): every NPC the game's own table names, drawn with
// its own model and the game's own materials, posed by its own motion lists. The data is docs/npcs.json, read from the
// ROM by dev/build-npcs.py: the NPC table (arc/npc/com.arc npc\tables\baseData\npcID: the model, two motion lists per
// NPC), the names (eng/table/NpcName_eng.gmd, one per record), the models (npc\mod\npcMMM) and the lists built on each
// model. Loaded on the first visit, so the boot does not wait for it.
//
// createNpcPanel(ctx): ctx.world (the stage group), ctx.pose (the shared PoseDriver -- the Animation panel's transport
// drives an NPC's clip as it does the hunter's), ctx.pieceCtx (the piece pipeline's context), ctx.loadEntry
// (render/piece.js), ctx.setLoading, ctx.isActive() (the NPC tab is the figure on screen), ctx.onShown() (frame it).
export function createNpcPanel(ctx){
  const $ = id => document.getElementById(id);
  const sel = $('npcSel'), poseSel = $('npcPose');
  let DATA = null, loading = null;
  let mounted = null, mountedKey = null, seq = 0;
  // the motion an option names: [list key, clip]
  let poses = [];

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
        const g = await ctx.loadEntry({ glb: m.glb, joints: m.joints || [] }, { key: n.model, slot: 'npc' }, ctx.pieceCtx);
        if (my !== seq) return;                       // superseded while loading
        if (mounted) ctx.world.remove(mounted);
        mounted = g; mountedKey = n.model;
        if (g){ g.userData.npc = n.model; g.visible = ctx.isActive(); ctx.world.add(g); }
      } finally { ctx.setLoading(false); }
    }
    fillPoses(n);
    await play();
    ctx.onShown();
  }
  async function play(){
    const n = DATA && DATA.npcs[+sel.value];
    const v = poseSel.value;
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
      else { if (mounted) mounted.visible = true; await play(); }
    },
    leave(){ if (mounted) mounted.visible = false; },
    play
  };
}
