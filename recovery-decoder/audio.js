// audio.js — Recovery Decoder Bay
// All stems start looped + phase-locked, but muted.
// Dragging a module into the decoder ramps that stem up.
// "Machine layer" (noise + bandpass + mild saturation) fades away as integrity increases.
if (window.__RDB_AUDIO_LOADED__) {
  console.warn("audio.js already loaded, skipping");
} else {
  window.__RDB_AUDIO_LOADED__ = true;
const STEMS = [
  { id: "elecgtr", label: "ELEC GTR", url: "audio/elecgtr.m4a", base: 0.85 },
  { id: "gtr",     label: "GTR",      url: "audio/gtr.m4a",     base: 0.82 },
  { id: "piano",   label: "PIANO",    url: "audio/piano.m4a",   base: 0.75 },
  { id: "pluckies",label: "PLUCKIES", url: "audio/pluckies.m4a",base: 0.78 },
  { id: "strings", label: "STRINGS",  url: "audio/strings.m4a", base: 0.78 },
  { id: "vox",     label: "VOX",      url: "audio/vox.m4a",     base: 0.70 },
  { id: "vox2",    label: "VOX 2",    url: "audio/vox2.m4a",    base: 0.65 },
];

// Tuning
const RAMP_SEC = 0.12;
const MASTER_BASE = 0.70;
const MASTER_ACTIVE = 0.64; // keeps things stable once modules stack

let audioCtx = null;
let buffers = new Map();
let sources = new Map();
let stemGains = new Map();

let nodes = null; // machine layer + master
let started = false;

function setOverlayMsg(msg){
  const el = document.getElementById("overlayMsg");
  if (el) el.textContent = msg;
}
function setStatus(msg){
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

async function initAudio(){
  if (started) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state !== "running") await audioCtx.resume();

  setStatus("LOADING");
  setOverlayMsg("Loading stems...");

  // Load + decode
  for (const s of STEMS){
    const abs = new URL(s.url, window.location.href).toString();
    const buf = await loadBuffer(abs);
    buffers.set(s.id, buf);
  }

  buildGraph();
  startAllLoopedMuted();

  started = true;
  setStatus("ACTIVE");
}

function buildGraph(){
  const master = audioCtx.createGain();
  master.gain.value = MASTER_BASE;

  // Machine layer: bandpass-ish + noise bed + mild softclip
  const hp = audioCtx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 45;

  const lp = audioCtx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 5200;

  const shaper = audioCtx.createWaveShaper();
  shaper.curve = softClipCurve(0.06);
  shaper.oversample = "2x";

  // Noise (pink-ish via filtered white)
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

  // route noise -> filters -> noiseGain -> master
  noise.connect(nHP);
  nHP.connect(nLP);
  nLP.connect(noiseGain);
  noiseGain.connect(master);

  // audio path: sum stems -> hp -> lp -> shaper -> master -> destination
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

function startAllLoopedMuted(){
  // stop any existing
  for (const s of sources.values()){
    try { s.stop(); } catch {}
  }
  sources.clear();
  stemGains.clear();

  const when = audioCtx.currentTime + 0.03;

  for (const def of STEMS){
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
  }
}

/**
 * Called by game.js when a module is inserted.
 */
function activateStem(stemId){
  if (!started) return;
  const def = STEMS.find(s => s.id === stemId);
  const g = stemGains.get(stemId);
  if (!def || !g) return;

  const t0 = audioCtx.currentTime;

  // Bring this stem in to its base level.
  g.gain.cancelScheduledValues(t0);
  g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t0);
  g.gain.linearRampToValueAtTime(def.base, t0 + RAMP_SEC);

  // As more stems activate, back off master slightly to avoid total loudness creep.
  // (game.js calls setIntegrity, so we keep master stable there too)
}

function setIntegrity(countActive){
  if (!started || !nodes) return;

  const t0 = audioCtx.currentTime;
  const total = STEMS.length;
  const k = Math.max(0, Math.min(1, countActive / total));

  // Machine layer recedes as integrity rises
  const noiseTarget = lerp(0.085, 0.015, k);
  const lpTarget = lerp(4200, 9000, k);   // more open as recovered
  const hpTarget = lerp(120, 35, k);      // less thin as recovered
  const driveAmt  = lerp(0.08, 0.02, k);  // less saturated when recovered

  nodes.noiseGain.gain.setTargetAtTime(noiseTarget, t0, 0.15);
  nodes.lp.frequency.setTargetAtTime(lpTarget, t0, 0.18);
  nodes.hp.frequency.setTargetAtTime(hpTarget, t0, 0.18);
  nodes.shaper.curve = softClipCurve(driveAmt);

  // Gentle master normalization
  const masterTarget = lerp(MASTER_BASE, MASTER_ACTIVE, k);
  nodes.master.gain.setTargetAtTime(masterTarget, t0, 0.22);
}

function stopAudio(){
  if (!started) return;
  const t0 = audioCtx.currentTime;
  nodes.master.gain.setTargetAtTime(0.0001, t0, 0.15);
  setTimeout(() => {
    for (const s of sources.values()){
      try { s.stop(); } catch {}
    }
    sources.clear();
  }, 300);
}

// Helpers
async function loadBuffer(url){
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  const arr = await res.arrayBuffer();
  return await audioCtx.decodeAudioData(arr);
}

function makeWhiteNoiseBuffer(seconds){
  const sr = audioCtx.sampleRate;
  const len = Math.floor(sr * seconds);
  const b = audioCtx.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++){
    d[i] = (Math.random() * 2 - 1) * 0.9;
  }
  return b;
}

function softClipCurve(amount){
  // amount ~ 0.02..0.10
  const n = 44100;
  const curve = new Float32Array(n);
  const k = Math.max(0.0001, amount * 70);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++){
    const x = (i * 2) / n - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

function lerp(a,b,t){ return a + (b-a)*t; }

// Expose to game.js
window.initAudio = initAudio;
window.activateStem = activateStem;
window.setIntegrity = setIntegrity;
window.stopAudio = stopAudio;
window.__STEMS__ = STEMS;
}