// audio.js — Recovery Decoder Bay v2
// 5 stems only. Fragments can preview near correct fields, be placed, and be removed again.

if (window.__RDB_AUDIO_LOADED__) {
  console.warn("audio.js already loaded, skipping");
} else {
  window.__RDB_AUDIO_LOADED__ = true;

  const SCRIPT_BASE = new URL(".", document.currentScript?.src || window.location.href);
  const asset = (p) => new URL(p, SCRIPT_BASE).toString();

  const STEMS = [
    { id: "elecgtr",  label: "FRAGMENT A", url: asset("audio/elecgtr.m4a"),  base: 0.85 },
    { id: "gtr",      label: "FRAGMENT B", url: asset("audio/gtr.m4a"),      base: 0.82 },
    { id: "piano",    label: "FRAGMENT C", url: asset("audio/piano.m4a"),    base: 0.75 },
    { id: "pluckies", label: "FRAGMENT D", url: asset("audio/pluckies.m4a"), base: 0.78 },
    { id: "strings",  label: "FRAGMENT E", url: asset("audio/strings.m4a"),  base: 0.78 },
  ];

  const RAMP_SEC = 0.18;
  const MASTER_BASE = 0.68;
  const MASTER_ACTIVE = 0.62;

  let audioCtx = null;
  let buffers = new Map();
  let sources = new Map();
  let stemGains = new Map();
  let stemState = new Map(); // id -> { placed: bool, preview: 0..1 }

  let nodes = null;
  let started = false;

  function setOverlayMsg(msg) {
    const el = document.getElementById("overlayMsg");
    if (el) el.textContent = msg;
  }

  function setStatus(msg) {
    const el = document.getElementById("status");
    if (el) el.textContent = msg;
  }

  async function initAudio() {
    if (started) return;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state !== "running") await audioCtx.resume();

    setStatus("LOADING");

    buffers.clear();
    for (let i = 0; i < STEMS.length; i++) {
      const s = STEMS[i];
      setOverlayMsg(`Loading ${i + 1}/${STEMS.length}: ${s.label}...`);

      try {
        const buf = await loadBuffer(s.url);
        buffers.set(s.id, buf);
      } catch (err) {
        console.error("Failed stem:", s, err);
        setStatus("ERROR");
        setOverlayMsg(`FAILED: ${s.label}`);
        throw err;
      }
    }

    buildGraph();
    startAllLoopedMuted();

    started = true;
    setOverlayMsg("Ready.");
    setStatus("ACTIVE");
  }

  function buildGraph() {
    const master = audioCtx.createGain();
    master.gain.value = MASTER_BASE;

    const hp = audioCtx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 45;

    const lp = audioCtx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 5200;

    const shaper = audioCtx.createWaveShaper();
    shaper.curve = softClipCurve(0.06);
    shaper.oversample = "2x";

    const noiseGain = audioCtx.createGain();
    noiseGain.gain.value = 0.08;

    const n = makeWhiteNoiseBuffer(2.0);
    const noise = audioCtx.createBufferSource();
    noise.buffer = n;
    noise.loop = true;

    const nLP = audioCtx.createBiquadFilter();
    nLP.type = "lowpass";
    nLP.frequency.value = 1800;

    const nHP = audioCtx.createBiquadFilter();
    nHP.type = "highpass";
    nHP.frequency.value = 120;

    noise.connect(nHP);
    nHP.connect(nLP);
    nLP.connect(noiseGain);
    noiseGain.connect(master);

    const sum = audioCtx.createGain();
    sum.gain.value = 1.0;

    sum.connect(hp);
    hp.connect(lp);
    lp.connect(shaper);
    shaper.connect(master);
    master.connect(audioCtx.destination);

    noise.start(audioCtx.currentTime + 0.01);

    nodes = { master, sum, hp, lp, shaper, noiseGain };
  }

  function startAllLoopedMuted() {
    for (const s of sources.values()) {
      try { s.stop(); } catch {}
    }

    sources.clear();
    stemGains.clear();
    stemState.clear();

    const when = audioCtx.currentTime + 0.03;

    for (const def of STEMS) {
      const src = audioCtx.createBufferSource();
      src.buffer = buffers.get(def.id);
      src.loop = true;

      const g = audioCtx.createGain();
      g.gain.value = 0.0001;

      src.connect(g);
      g.connect(nodes.sum);

      src.start(when);

      sources.set(def.id, src);
      stemGains.set(def.id, g);
      stemState.set(def.id, { placed: false, preview: 0 });
    }
  }

  function targetGainFor(def, st) {
    const placedGain = st.placed ? def.base : 0;
    const previewGain = st.placed ? 0 : def.base * 0.42 * st.preview;
    return Math.max(0.0001, placedGain + previewGain);
  }

  function updateStemGain(id) {
    const def = STEMS.find((s) => s.id === id);
    const st = stemState.get(id);
    const g = stemGains.get(id);
    if (!def || !st || !g) return;

    const t0 = audioCtx.currentTime;
    const target = targetGainFor(def, st);

    g.gain.cancelScheduledValues(t0);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t0);
    g.gain.linearRampToValueAtTime(target, t0 + RAMP_SEC);
  }

  function setStemPlaced(stemId, placed) {
    if (!started) return;
    const st = stemState.get(stemId);
    if (!st) return;
    st.placed = placed;
    updateStemGain(stemId);
  }

  function setStemPreview(stemId, amt) {
    if (!started) return;
    const st = stemState.get(stemId);
    if (!st) return;
    st.preview = Math.max(0, Math.min(1, amt));
    updateStemGain(stemId);
  }

  function clearAllPreviews() {
    if (!started) return;
    for (const def of STEMS) {
      setStemPreview(def.id, 0);
    }
  }

  function setIntegrity(countActive) {
    if (!started || !nodes) return;

    const t0 = audioCtx.currentTime;
    const total = STEMS.length;
    const k = Math.max(0, Math.min(1, countActive / total));

    const noiseTarget = lerp(0.085, 0.015, k);
    const lpTarget = lerp(4200, 9000, k);
    const hpTarget = lerp(120, 35, k);
    const driveAmt = lerp(0.08, 0.02, k);

    nodes.noiseGain.gain.setTargetAtTime(noiseTarget, t0, 0.15);
    nodes.lp.frequency.setTargetAtTime(lpTarget, t0, 0.18);
    nodes.hp.frequency.setTargetAtTime(hpTarget, t0, 0.18);
    nodes.shaper.curve = softClipCurve(driveAmt);

    const masterTarget = lerp(MASTER_BASE, MASTER_ACTIVE, k);
    nodes.master.gain.setTargetAtTime(masterTarget, t0, 0.22);
  }

  function stopAudio() {
    if (!started || !nodes) return;
    const t0 = audioCtx.currentTime;
    nodes.master.gain.setTargetAtTime(0.0001, t0, 0.15);

    setTimeout(() => {
      for (const s of sources.values()) {
        try { s.stop(); } catch {}
      }
      sources.clear();
    }, 300);
  }

  async function loadBuffer(url) {
    console.log("fetch:", url);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
    const arr = await res.arrayBuffer();
    return await audioCtx.decodeAudioData(arr);
  }

  function makeWhiteNoiseBuffer(seconds) {
    const sr = audioCtx.sampleRate;
    const len = Math.floor(sr * seconds);
    const b = audioCtx.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.9;
    return b;
  }

  function softClipCurve(amount) {
    const n = 44100;
    const curve = new Float32Array(n);
    const k = Math.max(0.0001, amount * 70);
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    return curve;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  window.initAudio = initAudio;
  window.setStemPlaced = setStemPlaced;
  window.setStemPreview = setStemPreview;
  window.clearAllPreviews = clearAllPreviews;
  window.setIntegrity = setIntegrity;
  window.stopAudio = stopAudio;
  window.__STEMS__ = STEMS;
}
