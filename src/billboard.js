// ─── BILLBOARD: painted character sprites as camera-facing planes (CT.billboard) ───
// Shared by npcs.js (heroines, companion, townsfolk) and life.js (road travellers).
// A billboard turns around Y only, toward the camera, and shows the painted frame for the angle between the character's
// facing yaw and the camera: the angles present in CT.sprites[id].frames (a0, a35|a45, a90, a135, a180); the side angles
// mirror for the other side. alphaTest keeps it in the opaque pass (no sorting with fire, fog or smoke).
// Frames may carry an optional sequence: frames[key].seq = [src, src, ...] (+ fps, default 8), and CT.sprites[id].walk may
// hold a second frame set used while walking; both cycle automatically (for the animated idle/walk loops).
//   has(id) -> bool
//   make(id, {parent, tint:[r,g,b], scale, shadow:bool}) -> bb
//   update(bb, camPos, x, y, z, yaw, dt, t, {walk:{amt,ph,vx,vz}, work:'hammer'|'hoe'|'sweep'|'strum', tip:{a, side}, dead:k})
//   dispose(bb)
(function () {
  'use strict';
  window.CT = window.CT || {};
  const T = THREE, PI = Math.PI, TAU = PI * 2;
  const TEX = {};   // shared textures per sprite id / set / key: [Texture...]
  const has = id => !!(CT.sprites && CT.sprites[id] && CT.sprites[id].frames && CT.sprites[id].frames.a0);
  function texFor(src) {
    const img = new Image(), t = new T.Texture(img);
    t.colorSpace = T.SRGBColorSpace; t.minFilter = T.LinearMipmapLinearFilter; t.magFilter = T.LinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
    img.onload = () => { t.needsUpdate = true; }; img.src = src; return t;
  }
  function setTextures(id, setName, frames) {
    const k = id + '|' + setName; if (TEX[k]) return TEX[k];
    const out = {};
    Object.keys(frames).forEach(key => { const f = frames[key]; out[key] = (f.seq && f.seq.length ? f.seq : [f.src]).map(texFor); });
    return (TEX[k] = out);
  }
  function anglesOf(frames) {   // [[deg, key]...] sorted
    return Object.keys(frames).map(k => [parseFloat(k.slice(1)), k]).filter(a => a[0] === a[0]).sort((a, b) => a[0] - b[0]);
  }
  let GEO = null, SHGEO = null, SHMAT = null;
  function make(id, o) {
    o = o || {};
    const SP = CT.sprites[id];
    if (!GEO) { GEO = new T.PlaneGeometry(1, 1); GEO.translate(0, 0.5, 0); SHGEO = new T.CircleGeometry(1, 16); SHMAT = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false }); }
    const sets = { idle: setTextures(id, 'idle', SP.frames) };
    if (SP.walk) sets.walk = setTextures(id, 'walk', SP.walk);
    const first = sets.idle.a0[0];
    // lit by the scene (Lambert) plus an emissive copy of the painting so a plane never sinks into its own dark side
    const mat = new T.MeshLambertMaterial({ map: first, emissive: 0xffffff, emissiveMap: first, emissiveIntensity: 0.55, alphaTest: 0.5, side: T.DoubleSide });
    if (o.tint) { mat.color.setRGB(o.tint[0], o.tint[1], o.tint[2]); mat.emissive.setRGB(o.tint[0], o.tint[1], o.tint[2]); }
    const root = new T.Group(), mesh = new T.Mesh(GEO, mat); root.add(mesh); root.name = 'bb_' + id;
    let shadow = null;
    if (o.shadow !== false) { shadow = new T.Mesh(SHGEO, SHMAT); shadow.rotation.x = -PI / 2; shadow.position.y = 0.03; shadow.scale.set(0.46, 0.34, 1); shadow.renderOrder = -1; root.add(shadow); }
    (o.parent || (CT.core && CT.core.scene)).add(root);
    return { id, root, mesh, mat, shadow, sets, SP, angles: { idle: anglesOf(SP.frames), walk: SP.walk ? anglesOf(SP.walk) : null },
      H: (SP.height || 1.8) * (o.scale || 1), key: null, mir: 1, set: 'idle', bob: 0, tex: first, ph: o.ph != null ? o.ph : Math.random() * 10, tipK: 0 };
  }
  // nearest painted angle to |rel| (degrees), with 6 degrees of hysteresis so turning never flickers
  function pick(angles, rel, cur) {
    const a = Math.abs(rel) * 180 / PI, sg = rel < 0 ? -1 : 1;
    const mirOf = deg => (deg > 1 && deg < 179 && sg < 0 ? -1 : 1);
    if (cur && cur.key) {
      const i = angles.findIndex(x => x[1] === cur.key);
      if (i >= 0) {
        const lo = i > 0 ? (angles[i - 1][0] + angles[i][0]) / 2 : 0, hi = i < angles.length - 1 ? (angles[i][0] + angles[i + 1][0]) / 2 : 181;
        const deg = angles[i][0], sameSide = cur.mir === mirOf(deg) || deg <= 1 || deg >= 179;
        if (a >= lo - 6 && a < hi + 6 && sameSide) return cur;
      }
    }
    let best = angles[0];
    for (const x of angles) if (Math.abs(x[0] - a) < Math.abs(best[0] - a)) best = x;
    return { key: best[1], mir: mirOf(best[0]) };
  }
  function update(bb, cam, x, y, z, yaw, dt, t, o) {
    o = o || {};
    bb.root.position.set(x, y, z);
    const toCam = Math.atan2(cam.x - x, cam.z - z);
    bb.root.rotation.y = toCam;
    let rel = toCam - yaw; while (rel > PI) rel -= TAU; while (rel < -PI) rel += TAU;
    const walking = !!(o.walk && o.walk.amt > 0.3 && bb.sets.walk);
    const setName = walking ? 'walk' : 'idle', angles = bb.angles[setName], frames = setName === 'walk' ? bb.SP.walk : bb.SP.frames;
    const F = pick(angles, rel, bb.set === setName ? { key: bb.key, mir: bb.mir } : null);
    if (F.key !== bb.key || F.mir !== bb.mir || setName !== bb.set) { if (bb.key && !walking) bb.bob = 1; bb.key = F.key; bb.mir = F.mir; bb.set = setName; }
    const m = frames[bb.key], texs = bb.sets[setName][bb.key];
    // idle loops cycle while standing; a walker without a walk set holds the first (static) frame + the bob/lean below
    const hold = !!(o.walk && o.walk.amt > 0.3) && setName === 'idle';
    const fi = texs.length > 1 && !hold ? Math.floor((t + bb.ph) * (m.fps || 8)) % texs.length : 0;
    if (texs[fi] !== bb.tex) { bb.tex = texs[fi]; bb.mat.map = bb.mat.emissiveMap = bb.tex; }
    const Hw = bb.H / Math.max(0.1, m.bottom - m.top), Ww = Hw * m.w / m.h, tt = t + bb.ph;
    bb.bob = Math.max(0, bb.bob - dt * 3.5);
    let sy = 1 + Math.sin(tt * 1.7) * 0.01, sx = 1, dy = Math.sin(bb.bob * PI) * 0.025, rz = Math.sin(tt * 0.42) * 0.008;
    // walking: a step bob and a lean into the direction of travel as seen from the camera
    if (o.walk && o.walk.amt > 0.03) {
      const w = o.walk, k = Math.min(1, w.amt);
      dy += Math.abs(Math.sin(w.ph)) * 0.035 * k; sy *= 1 + Math.sin(w.ph * 2) * 0.012 * k;
      const rx = Math.cos(toCam), rzv = -Math.sin(toCam), sp = Math.hypot(w.vx || 0, w.vz || 0);
      if (sp > 0.05) rz += -(((w.vx || 0) * rx + (w.vz || 0) * rzv) / sp) * 0.06 * k;
    }
    // work motions: Bram's hammer = a rhythmic dip; hoe = a slower heavier dip; sweep = a side-to-side sway; strum = a small beat
    if (o.work === 'hammer') { const c = Math.pow(Math.max(0, Math.sin(tt * 3.2)), 6); dy -= c * 0.05; sy *= 1 - c * 0.035; sx *= 1 + c * 0.02; }
    else if (o.work === 'hoe') { const c = Math.max(0, Math.sin(tt * 2.2)); dy -= c * 0.04; sy *= 1 - c * 0.03; }
    else if (o.work === 'sweep') { rz += Math.sin(tt * 2.6) * 0.03; }
    else if (o.work === 'strum') { dy += Math.abs(Math.sin(tt * 5.5)) * 0.012; }
    // knock-down / death: tip over sideways in the view plane, pivoting at the feet
    const tipT = o.dead ? 1 : o.tip ? Math.min(1, o.tip) : 0;
    bb.tipK += (tipT - bb.tipK) * Math.min(1, dt * (tipT > bb.tipK ? 9 : 4));
    const side = o.side || (bb.mir < 0 ? -1 : 1);
    rz += side * bb.tipK * (PI / 2) * 0.96;
    bb.mesh.scale.set(Ww * bb.mir * sx, Hw * sy, 1);
    bb.mesh.position.set((0.5 - m.ax) * Ww * bb.mir, -(1 - m.bottom) * Hw + dy * (1 - bb.tipK) + bb.tipK * 0.06, 0);
    bb.mesh.rotation.z = rz;
    if (bb.shadow) bb.shadow.visible = bb.tipK < 0.5;
  }
  function dispose(bb) { if (!bb) return; if (bb.root.parent) bb.root.parent.remove(bb.root); bb.mat.dispose(); }
  CT.billboard = { has, make, update, dispose, pick };
})();
