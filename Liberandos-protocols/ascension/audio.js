// audio.js — Crossing Field
// 2 stems (percussion + mass).
// Deaths degrade audio (filter + distortion + tempo shift) while keeping overall loudness stable.
// Integrity 0 collapses (slowdown + fade).
// ASCENSION: jump to 1:57 (116s), CLEAN, NON-LOOPING, plays to end then stops.
// ASCENSION loudness: boosted for ~5s, then gradually returns to normal.

let audioCtx;
let percBuffer;
let massBuffer;

let percSource;
let massSource;

let gainPerc;
let gainMass;

let masterGain;
let filter;
let distortion;

let degradation = 0;
let collapsing = false;

// Mix / loudness tuning
const BASE_MASTER = 0.65;     // overall level baseline
const MIN_MASTER = 0.30;      // allow more reduction when heavily degraded
const DIST_COMP_DB = 39;      // stronger trim to counter distortion loudness rise
const COMP_CURVE = 1.00;      // 1.0 = linear in d, <1 favors early steps, >1 favors later

// Win jump target (1:57)
const ASCEND_JUMP_SEC = 116;

// Ascension boost envelope
const ASCEND_BOOST_DB = 6.0;       // initial boost amount
const ASCEND_HOLD_SEC = 5.0;       // hold boosted level
const ASCEND_RETURN_SEC = 10.0;    // fade back down over this many seconds

// ---- UI helpers (optional) ----
function setOverlayMsg(msg) {
  const el = document.getElementById("overlayMsg");
  if (el) el.textContent = msg;
}
function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

// ---- Public API (called by game.js) ----
async function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state !== "running") await audioCtx.resume();

  setOverlayMsg("Loading audio...");

  const percUrl = new URL("audio/percussion.m4a", window.location.href).toString();
  const massUrl = new URL("audio/mass.m4a", window.location.href).toString();

  percBuffer = await loadBuffer(percUrl);
  massBuffer = await loadBuffer(massUrl);

  buildGraph();
  startLoop();
}

function degradeAudio() {
  if (!audioCtx || !filter || !distortion || !percSource || !massSource) return;
  if (collapsing) return;

  degradation = Math.min(1, degradation + 0.15);

  // Darken progressively
  const lp = 8000 - (6000 * degradation);
  filter.frequency.setTargetAtTime(Math.max(900, lp), audioCtx.currentTime, 0.05);

  // Speed up slightly as it degrades
  const rate = 1.2 + degradation * 0.3;
  percSource.playbackRate.setTargetAtTime(rate, audioCtx.currentTime, 0.05);
  massSource.playbackRate.setTargetAtTime(rate, audioCtx.currentTime, 0.05);

  // Distortion increases with degradation
  const distAmount = degradation * 60;
  distortion.curve = makeDistortion(distAmount);

  // Loudness compensation (no ducking, every hit)
  applyLoudnessComp(degradation);
}

function collapseAudio() {
  if (!audioCtx || !percSource || !massSource || !masterGain) return;
  if (collapsing) return;
  collapsing = true;

  const t0 = audioCtx.currentTime;

  // Drawn-out slow down over ~3.5s
  percSource.playbackRate.cancelScheduledValues(t0);
  massSource.playbackRate.cancelScheduledValues(t0);

  percSource.playbackRate.setValueAtTime(percSource.playbackRate.value, t0);
  massSource.playbackRate.setValueAtTime(massSource.playbackRate.value, t0);

  percSource.playbackRate.linearRampToValueAtTime(0.35, t0 + 3.5);
  massSource.playbackRate.linearRampToValueAtTime(0.35, t0 + 3.5);

  // Fade down to near silence
  masterGain.gain.cancelScheduledValues(t0);
  masterGain.gain.setValueAtTime(masterGain.gain.value, t0);
  masterGain.gain.linearRampToValueAtTime(0.0001, t0 + 4.2);

  // stop after fade
  setTimeout(() => {
    safeStop();
  }, 4500);
}

function ascendAudio() {
  if (!audioCtx || !percBuffer || !massBuffer) return;

  collapsing = false;

  // Brief fade down before jump (prevents click)
  const t0 = audioCtx.currentTime;
  masterGain.gain.cancelScheduledValues(t0);
  masterGain.gain.setValueAtTime(masterGain.gain.value, t0);
  masterGain.gain.linearRampToValueAtTime(0.0001, t0 + 0.18);

  setTimeout(() => {
    // RESET TO CLEAN before jump
    degradation = 0;

    if (distortion) distortion.curve = makeDistortion(0);
    if (filter) filter.frequency.setValueAtTime(8000, audioCtx.currentTime);

    // Restart at 1:57, non-looping, clean
    restartAt(ASCEND_JUMP_SEC, { forceClean: true, loop: false });

    const now = audioCtx.currentTime;

    // Ascension boost: strong for ~5s, then gradually return
    const baseTarget = getCompTarget(0);
    const boostGain = Math.pow(10, ASCEND_BOOST_DB / 20);
    const boosted = clamp(baseTarget * boostGain, 0.0001, 1.2);

    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(0.0001, now);

    // Quick rise
    masterGain.gain.linearRampToValueAtTime(boosted, now + 0.35);

    // Hold
    masterGain.gain.setValueAtTime(boosted, now + 0.35 + ASCEND_HOLD_SEC);

    // Gradual return
    masterGain.gain.linearRampToValueAtTime(
      baseTarget,
      now + 0.35 + ASCEND_HOLD_SEC + ASCEND_RETURN_SEC
    );
  }, 189);
}

// ---- Core graph ----
function buildGraph() {
  // Master -> filter -> distortion -> destination
  masterGain = audioCtx.createGain();
  masterGain.gain.value = BASE_MASTER;

  filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 8000;
  filter.Q.value = 0.7;

  distortion = audioCtx.createWaveShaper();
  distortion.curve = makeDistortion(0);
  distortion.oversample = "2x";

  masterGain.connect(filter);
  filter.connect(distortion);
  distortion.connect(audioCtx.destination);
}

function startLoop() {
  safeStop();

  degradation = 0;
  collapsing = false;

  filter.frequency.setValueAtTime(8000, audioCtx.currentTime);
  distortion.curve = makeDistortion(0);

  // Set base gain at compensated target (degradation=0)
  masterGain.gain.setValueAtTime(getCompTarget(0), audioCtx.currentTime);

  percSource = audioCtx.createBufferSource();
  massSource = audioCtx.createBufferSource();

  percSource.buffer = percBuffer;
  massSource.buffer = massBuffer;

  percSource.loop = true;
  massSource.loop = true;

  gainPerc = audioCtx.createGain();
  gainMass = audioCtx.createGain();

  gainPerc.gain.value = 1.0;
  gainMass.gain.value = 0.7;

  percSource.connect(gainPerc);
  massSource.connect(gainMass);

  gainPerc.connect(masterGain);
  gainMass.connect(masterGain);

  // Baseline tempo
  percSource.playbackRate.value = 1.2;
  massSource.playbackRate.value = 1.2;

  const when = audioCtx.currentTime + 0.03;
  percSource.start(when);
  massSource.start(when);
}

function restartAt(offsetSec, opts = {}) {
  if (!audioCtx || !percBuffer || !massBuffer) return;

  const { forceClean = false, loop = true } = opts;

  safeStop();

  percSource = audioCtx.createBufferSource();
  massSource = audioCtx.createBufferSource();

  percSource.buffer = percBuffer;
  massSource.buffer = massBuffer;

  percSource.loop = !!loop;
  massSource.loop = !!loop;

  gainPerc = audioCtx.createGain();
  gainMass = audioCtx.createGain();

  gainPerc.gain.value = 1.0;
  gainMass.gain.value = 0.7;

  percSource.connect(gainPerc);
  massSource.connect(gainMass);

  gainPerc.connect(masterGain);
  gainMass.connect(masterGain);

  // Restore baseline tempo
  percSource.playbackRate.value = 1.2;
  massSource.playbackRate.value = 1.2;

  // Clamp offset to buffer duration
  const offP = clampOffset(offsetSec, percBuffer.duration);
  const offM = clampOffset(offsetSec, massBuffer.duration);

  const t0 = audioCtx.currentTime;

  // Fade in after jump to avoid click
  masterGain.gain.cancelScheduledValues(t0);
  masterGain.gain.setValueAtTime(0.0001, t0);

  const target = forceClean ? getCompTarget(0) : getCompTarget(degradation);
  masterGain.gain.linearRampToValueAtTime(target, t0 + 0.35);

  // If non-looping, stop cleanly when both sources finish
  if (!loop) {
    attachStopOnEnded(percSource, massSource);
  }

  const when = t0 + 0.03;
  percSource.start(when, offP);
  massSource.start(when, offM);
}

function attachStopOnEnded(a, b) {
  let ended = 0;
  const done = () => {
    ended += 1;
    if (ended >= 2) {
      safeStop();
      setStatus("COMPLETE");
    }
  };
  a.onended = done;
  b.onended = done;
}

function safeStop() {
  try { percSource?.stop(); } catch {}
  try { massSource?.stop(); } catch {}
  percSource = null;
  massSource = null;
}

// ---- Loudness compensation ----
function getCompTarget(d) {
  // Stronger, steadier compensation so each degradation stays level.
  // d is 0..1. This applies up to DIST_COMP_DB of trim by the curve.
  const shaped = Math.pow(clamp(d, 0, 1), COMP_CURVE);
  const trimDb = -DIST_COMP_DB * shaped;
  const trim = Math.pow(10, trimDb / 20);

  return clamp(BASE_MASTER * trim, MIN_MASTER, BASE_MASTER);
}

function applyLoudnessComp(d) {
  const target = getCompTarget(d);
  const t0 = audioCtx.currentTime;
  masterGain.gain.cancelScheduledValues(t0);
  // Short time constant so it follows each hit without “pumping”
  masterGain.gain.setTargetAtTime(target, t0, 0.06);
}

// ---- Loading + DSP helpers ----
async function loadBuffer(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  const arr = await res.arrayBuffer();
  return await audioCtx.decodeAudioData(arr);
}

function makeDistortion(amount) {
  const k = amount;
  const n = 44100;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2 / n) - 1;
    curve[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function clampOffset(sec, dur) {
  if (!isFinite(sec) || !isFinite(dur) || dur <= 0) return 0;
  const m = ((sec % dur) + dur) % dur;
  return m;
}

// --- Tiny UI sounds ---
function playHitSound() {
  if (!audioCtx || !masterGain) return;

  const t0 = audioCtx.currentTime;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const bit = audioCtx.createWaveShaper();

  osc.type = "square";
  osc.frequency.setValueAtTime(140, t0);
  osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.08);

  bit.curve = makeDistortion(20);
  bit.oversample = "none";

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(0.18, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);

  osc.connect(bit);
  bit.connect(gain);
  gain.connect(masterGain);

  osc.start(t0);
  osc.stop(t0 + 0.14);
}

function playSafeSound() {
  if (!audioCtx || !masterGain) return;

  const t0 = audioCtx.currentTime;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(440, t0);
  osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.18);

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(0.12, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);

  osc.connect(gain);
  gain.connect(masterGain);

  osc.start(t0);
  osc.stop(t0 + 0.28);
}

// Expose functions globally
window.initAudio = initAudio;
window.degradeAudio = degradeAudio;
window.collapseAudio = collapseAudio;
window.ascendAudio = ascendAudio;

window.playHitSound = playHitSound;
window.playSafeSound = playSafeSound;
