// game.js — Recovery Decoder Bay
// Drag modules (bottom) into decoder slots (top).
// Each inserted module unmutes a stem and increases integrity.
// After all are inserted, reveal the link row.
if (window.__RDB_GAME_LOADED__) {
  console.warn("game.js already loaded, skipping");
} else {
  window.__RDB_GAME_LOADED__ = true;
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

const overlay = document.getElementById("overlay");
const startBtn = document.getElementById("startBtn");
const overlayMsg = document.getElementById("overlayMsg");

const integrityEl = document.getElementById("integrity");
const la5Row = document.getElementById("la5Row");

const STEMS = window.__STEMS__;
const state = {
  started: false,
  draggingId: null,
  dragOffsetX: 0,
  dragOffsetY: 0,
  modules: [],
  slots: [],
  placed: new Set(),
};

function resizeCanvas(){
  // Keep internal size stable for crisp drawing; scale via CSS.
  // But adjust for small screens if needed.
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const w = Math.min(980, Math.max(320, document.querySelector(".wrap").clientWidth));
  const h = Math.round(w * (560/900));

  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener("resize", () => {
  resizeCanvas();
  layout();
});

startBtn.addEventListener("click", async () => {
  if (state.started) return;
  try{
    overlayMsg.textContent = "Loading audio...";
    await window.initAudio();
    state.started = true;
    overlay.classList.add("hidden");
    document.getElementById("status").textContent = "ACTIVE";
    layout();
  }catch(e){
    console.error(e);
    overlayMsg.textContent = String(e.message || e);
  }
});

function layout(){
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;

  // Slots across the top
  const slotCount = STEMS.length;
  const pad = 18;
  const slotW = Math.min(120, Math.floor((W - pad*2 - (slotCount-1)*10) / slotCount));
  const slotH = 54;

  state.slots = [];
  for (let i = 0; i < slotCount; i++){
    state.slots.push({
      x: pad + i * (slotW + 10),
      y: 22,
      w: slotW,
      h: slotH,
      id: STEMS[i].id,      // deterministic mapping: slot i expects STEMS[i]
      label: STEMS[i].label
    });
  }

  // Modules row at bottom
  const mW = 132;
  const mH = 44;
  const gap = 10;

  const totalRowW = STEMS.length * mW + (STEMS.length - 1) * gap;
  let startX = (W - totalRowW) / 2;
  startX = Math.max(pad, startX);

  const y = H - mH - 26;

  state.modules = STEMS.map((s, i) => ({
    id: s.id,
    label: s.label,
    x: startX + i * (mW + gap),
    y,
    w: mW,
    h: mH,
    homeX: startX + i * (mW + gap),
    homeY: y
  }));
}

function hitRect(x,y,r){
  return x >= r.x && x <= r.x+r.w && y >= r.y && y <= r.y+r.h;
}

function setIntegrityUI(){
  const n = state.placed.size;
  integrityEl.textContent = `${n}/${STEMS.length}`;
  if (typeof window.setIntegrity === "function") window.setIntegrity(n);

  if (n >= STEMS.length){
    if (la5Row) la5Row.classList.remove("hidden");
    document.getElementById("status").textContent = "ACCESS GRANTED";
  }
}

function pointerPos(e){
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left),
    y: (e.clientY - rect.top),
  };
}

canvas.addEventListener("pointerdown", (e) => {
  if (!state.started) return;
  e.preventDefault();

  const p = pointerPos(e);

  // Grab topmost module under pointer (iterate reversed)
  for (let i = state.modules.length - 1; i >= 0; i--){
    const m = state.modules[i];

    // already placed modules are not draggable
    if (state.placed.has(m.id)) continue;

    if (hitRect(p.x, p.y, m)){
      state.draggingId = m.id;
      state.dragOffsetX = p.x - m.x;
      state.dragOffsetY = p.y - m.y;
      canvas.setPointerCapture?.(e.pointerId);

      // bring to front
      state.modules.splice(i,1);
      state.modules.push(m);
      return;
    }
  }
}, { passive: false });

canvas.addEventListener("pointermove", (e) => {
  if (!state.started) return;
  if (!state.draggingId) return;
  e.preventDefault();

  const p = pointerPos(e);
  const m = state.modules.find(mm => mm.id === state.draggingId);
  if (!m) return;

  m.x = p.x - state.dragOffsetX;
  m.y = p.y - state.dragOffsetY;
}, { passive: false });

canvas.addEventListener("pointerup", (e) => {
  if (!state.started) return;
  if (!state.draggingId) return;
  e.preventDefault();

  const m = state.modules.find(mm => mm.id === state.draggingId);
  if (!m){
    state.draggingId = null;
    return;
  }

  // If dropped on its matching slot, lock it in
  const slot = state.slots.find(s => s.id === m.id);
  const p = pointerPos(e);

  let placed = false;
  if (slot){
    const snapRect = { x: slot.x, y: slot.y, w: slot.w, h: slot.h };
    if (hitRect(p.x, p.y, snapRect)){
      m.x = slot.x + Math.floor((slot.w - m.w) / 2);
      m.y = slot.y + slot.h + 10;
      state.placed.add(m.id);
      placed = true;

      // Activate audio stem
      if (typeof window.activateStem === "function"){
        window.activateStem(m.id);
      }
      setIntegrityUI();
    }
  }

  // If not placed, return to home
  if (!placed){
    m.x = m.homeX;
    m.y = m.homeY;
  }

  state.draggingId = null;
}, { passive: false });

function draw(){
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;

  // background
  ctx.clearRect(0,0,W,H);

  // vignette
  const g = ctx.createRadialGradient(W*0.5, H*0.45, 20, W*0.5, H*0.45, Math.max(W,H)*0.65);
  g.addColorStop(0, "rgba(255,255,255,0.03)");
  g.addColorStop(1, "rgba(0,0,0,0.65)");
  ctx.fillStyle = g;
  ctx.fillRect(0,0,W,H);

  // slots
  ctx.font = "12px ui-monospace, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const s of state.slots){
    const ok = state.placed.has(s.id);

    ctx.fillStyle = ok ? "rgba(255,107,61,0.10)" : "rgba(255,255,255,0.04)";
    roundRect(s.x, s.y, s.w, s.h, 10, true, false);

    ctx.strokeStyle = ok ? "rgba(255,107,61,0.42)" : "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    roundRect(s.x, s.y, s.w, s.h, 10, false, true);

    ctx.fillStyle = ok ? "rgba(255,107,61,0.85)" : "rgba(230,230,230,0.55)";
    ctx.fillText(s.label, s.x + s.w/2, s.y + s.h/2);
  }

  // center readout
  const n = state.placed.size;
  ctx.fillStyle = "rgba(230,230,230,0.6)";
  ctx.font = "12px ui-monospace, Menlo, monospace";
  ctx.fillText(`INTEGRITY: ${n}/${STEMS.length}`, W/2, 110);

  // modules
  for (const m of state.modules){
    const placed = state.placed.has(m.id);
    const isDrag = (state.draggingId === m.id);

    ctx.fillStyle = placed ? "rgba(120,120,120,0.20)" : (isDrag ? "rgba(255,107,61,0.16)" : "rgba(255,255,255,0.06)");
    roundRect(m.x, m.y, m.w, m.h, 10, true, false);

    ctx.strokeStyle = placed ? "rgba(120,120,120,0.25)" : "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    roundRect(m.x, m.y, m.w, m.h, 10, false, true);

    ctx.fillStyle = placed ? "rgba(230,230,230,0.35)" : "rgba(230,230,230,0.78)";
    ctx.font = "12px ui-monospace, Menlo, monospace";
    ctx.fillText(m.label, m.x + m.w/2, m.y + m.h/2);
  }

  requestAnimationFrame(draw);
}

function roundRect(x, y, w, h, r, fill, stroke){
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

// init
resizeCanvas();
layout();
setIntegrityUI();
requestAnimationFrame(draw);}