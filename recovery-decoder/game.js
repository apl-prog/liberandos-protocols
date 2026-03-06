// game.js — Recovery Decoder Bay v2
// Drifting fragments, drifting fields, magnetic attraction, false locks, stillness as recovery.

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
  const statusEl = document.getElementById("status");

  const STEMS = window.__STEMS__;

  const state = {
    started: false,
    draggingId: null,
    dragOffsetX: 0,
    dragOffsetY: 0,
    fragments: [],
    fields: [],
    placed: new Set(),
    falseLocks: new Map(), // fragmentId -> { fieldId, until }
    completionQueued: false,
    recoveredShown: false,
    startTime: performance.now(),
  };

  function resizeCanvas() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const wrap = document.querySelector(".wrap");
    const w = Math.min(980, Math.max(320, wrap.clientWidth));
    const h = Math.round(w * (560 / 900));

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

    try {
      overlayMsg.textContent = "Loading audio...";
      await window.initAudio();
      state.started = true;
      overlay.classList.add("hidden");
      statusEl.textContent = "FIELD UNSTABLE";
      layout();
    } catch (e) {
      console.error(e);
      overlayMsg.textContent = String(e.message || e);
    }
  });

  function layout() {
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const n = STEMS.length;

    // Circular recovery fields in upper half
    const cx = W / 2;
    const cy = H * 0.28;
    const radiusX = Math.min(280, W * 0.32);
    const radiusY = Math.min(90, H * 0.12);
    const fieldR = Math.max(28, Math.min(38, W * 0.035));

    state.fields = STEMS.map((s, i) => {
      const a = (-Math.PI * 0.9) + (i / (n - 1 || 1)) * (Math.PI * 0.8);
      const bx = cx + Math.cos(a) * radiusX;
      const by = cy + Math.sin(a) * radiusY;
      return {
        id: s.id,
        baseX: bx,
        baseY: by,
        x: bx,
        y: by,
        r: fieldR,
        seed: 100 + i * 17.31,
        pulseSeed: 200 + i * 9.17,
      };
    });

    // Fragments in lower half
    const fragW = 126;
    const fragH = 42;
    const cols = Math.min(4, n);
    const rows = Math.ceil(n / cols);
    const gapX = 18;
    const gapY = 18;
    const totalW = cols * fragW + (cols - 1) * gapX;
    const startX = Math.max(24, (W - totalW) / 2);
    const startY = H * 0.62;

    state.fragments = STEMS.map((s, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const bx = startX + col * (fragW + gapX);
      const by = startY + row * (fragH + gapY);
      return {
        id: s.id,
        label: s.label,
        baseX: bx,
        baseY: by,
        x: bx,
        y: by,
        w: fragW,
        h: fragH,
        seed: 10 + i * 13.73,
        dragX: bx,
        dragY: by,
        snapped: false,
        settling: false,
      };
    });
  }

  function fieldStability() {
    return state.placed.size / STEMS.length;
  }

  function driftAmount() {
    // starts active, calms toward stillness
    const k = fieldStability();
    return lerp(1.0, 0.10, k);
  }

  function setIntegrityUI() {
    const n = state.placed.size;
    integrityEl.textContent = `${n}/${STEMS.length}`;
    if (typeof window.setIntegrity === "function") window.setIntegrity(n);

    if (n >= STEMS.length && !state.completionQueued) {
      state.completionQueued = true;
      statusEl.textContent = "TRANSMISSION STABILIZING";

      setTimeout(() => {
        statusEl.textContent = "TRANSMISSION RECOVERED";
        if (la5Row) la5Row.classList.remove("hidden");
        state.recoveredShown = true;
      }, 4200);
    } else if (!state.completionQueued) {
      statusEl.textContent = n === 0 ? "FIELD UNSTABLE" : `FIELD STABILITY ${Math.round((n / STEMS.length) * 100)}%`;
    }
  }

  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function hitRect(x, y, r) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  function distance(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function fragmentCenter(f) {
    return { x: f.x + f.w / 2, y: f.y + f.h / 2 };
  }

  function findFieldById(id) {
    return state.fields.find(f => f.id === id);
  }

  function correctFieldForFragment(fragment) {
    return findFieldById(fragment.id);
  }

  function wrongFieldNear(fragment) {
    const c = fragmentCenter(fragment);
    for (const field of state.fields) {
      if (field.id === fragment.id) continue;
      if (distance(c.x, c.y, field.x, field.y) < field.r + 16) {
        return field;
      }
    }
    return null;
  }

  function tryCorrectSnap(fragment) {
    const field = correctFieldForFragment(fragment);
    if (!field) return false;

    const c = fragmentCenter(fragment);
    const d = distance(c.x, c.y, field.x, field.y);

    if (d < field.r + 10) {
      fragment.snapped = true;
      fragment.settling = true;
      fragment.baseX = field.x - fragment.w / 2;
      fragment.baseY = field.y - fragment.h / 2;
      state.placed.add(fragment.id);

      if (typeof window.activateStem === "function") {
        window.activateStem(fragment.id);
      }

      setIntegrityUI();
      return true;
    }
    return false;
  }

  function startFalseLock(fragment, field) {
    const now = performance.now();
    state.falseLocks.set(fragment.id, {
      fieldId: field.id,
      until: now + 1600,
    });
  }

  function updateFalseLocks() {
    const now = performance.now();
    for (const [fragId, info] of state.falseLocks.entries()) {
      if (now > info.until) {
        const frag = state.fragments.find(f => f.id === fragId);
        if (frag && !state.placed.has(frag.id)) {
          // release it back into drift
          frag.dragX = frag.baseX;
          frag.dragY = frag.baseY;
        }
        state.falseLocks.delete(fragId);
      }
    }
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!state.started) return;
    e.preventDefault();

    const p = pointerPos(e);

    for (let i = state.fragments.length - 1; i >= 0; i--) {
      const f = state.fragments[i];
      if (state.placed.has(f.id)) continue;

      if (hitRect(p.x, p.y, f)) {
        state.draggingId = f.id;
        state.dragOffsetX = p.x - f.x;
        state.dragOffsetY = p.y - f.y;
        canvas.setPointerCapture?.(e.pointerId);

        state.fragments.splice(i, 1);
        state.fragments.push(f);
        return;
      }
    }
  }, { passive: false });

  canvas.addEventListener("pointermove", (e) => {
    if (!state.started || !state.draggingId) return;
    e.preventDefault();

    const p = pointerPos(e);
    const f = state.fragments.find(ff => ff.id === state.draggingId);
    if (!f) return;

    // buoyant dragging
    f.dragX = p.x - state.dragOffsetX;
    f.dragY = p.y - state.dragOffsetY;
  }, { passive: false });

  canvas.addEventListener("pointerup", (e) => {
    if (!state.started || !state.draggingId) return;
    e.preventDefault();

    const f = state.fragments.find(ff => ff.id === state.draggingId);
    if (!f) {
      state.draggingId = null;
      return;
    }

    // Correct placement
    if (tryCorrectSnap(f)) {
      state.draggingId = null;
      return;
    }

    // Wrong placement: false lock, then release
    const wrongField = wrongFieldNear(f);
    if (wrongField) {
      startFalseLock(f, wrongField);
      f.dragX = wrongField.x - f.w / 2;
      f.dragY = wrongField.y - f.h / 2;
      f.baseX = f.dragX;
      f.baseY = f.dragY;
    } else {
      // return to home drift region
      f.dragX = f.baseX;
      f.dragY = f.baseY;
    }

    state.draggingId = null;
  }, { passive: false });

  function update() {
    const t = (performance.now() - state.startTime) / 1000;
    const calm = 1 - fieldStability();
    const drift = driftAmount();

    updateFalseLocks();

    // update fields
    for (const field of state.fields) {
      const seed = field.seed;
      field.x = field.baseX + Math.sin(t * 0.27 + seed) * 10 * drift;
      field.y = field.baseY + Math.cos(t * 0.22 + seed * 0.7) * 8 * drift;
    }

    // update fragments
    for (const f of state.fragments) {
      if (state.placed.has(f.id)) {
        const field = correctFieldForFragment(f);
        if (field) {
          f.x += ((field.x - f.w / 2) - f.x) * 0.12;
          f.y += ((field.y - f.h / 2) - f.y) * 0.12;
        }
        continue;
      }

      const falseLock = state.falseLocks.get(f.id);
      if (falseLock) {
        const field = findFieldById(falseLock.fieldId);
        if (field) {
          const tremble = 1.5 + calm * 1.0;
          f.x += ((field.x - f.w / 2) - f.x) * 0.08 + Math.sin(t * 20 + f.seed) * tremble;
          f.y += ((field.y - f.h / 2) - f.y) * 0.08 + Math.cos(t * 18 + f.seed) * tremble;
        }
        continue;
      }

      const isDragged = state.draggingId === f.id;

      // idle drift target
      const dx = Math.sin(t * 0.42 + f.seed) * 12 * drift;
      const dy = Math.cos(t * 0.31 + f.seed * 0.8) * 8 * drift;
      let targetX = f.baseX + dx;
      let targetY = f.baseY + dy;

      if (isDragged) {
        targetX = f.dragX;
        targetY = f.dragY;
      }

      // magnetic pull toward correct field if near
      const field = correctFieldForFragment(f);
      if (field) {
        const cX = (isDragged ? targetX : f.x) + f.w / 2;
        const cY = (isDragged ? targetY : f.y) + f.h / 2;
        const d = distance(cX, cY, field.x, field.y);

        const magneticRadius = 150;
        if (d < magneticRadius) {
          const pull = (1 - d / magneticRadius) * 0.20;
          targetX += ((field.x - f.w / 2) - targetX) * pull;
          targetY += ((field.y - f.h / 2) - targetY) * pull;
        }
      }

      // buoyant movement
      const smooth = isDragged ? 0.22 : 0.08;
      f.x += (targetX - f.x) * smooth;
      f.y += (targetY - f.y) * smooth;
    }
  }

  function drawField(field, t) {
    const k = fieldStability();
    const pulse = 0.16 + Math.sin(t * 1.2 + field.pulseSeed) * 0.04;
    const baseAlpha = lerp(0.22, 0.35, k) + pulse;

    // outer halo
    const grad = ctx.createRadialGradient(field.x, field.y, 4, field.x, field.y, field.r * 2.6);
    grad.addColorStop(0, `rgba(255,107,61,${baseAlpha})`);
    grad.addColorStop(0.45, `rgba(255,107,61,${baseAlpha * 0.22})`);
    grad.addColorStop(1, "rgba(255,107,61,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(field.x, field.y, field.r * 2.6, 0, Math.PI * 2);
    ctx.fill();

    // main ring
    ctx.strokeStyle = `rgba(255,255,255,${0.12 + k * 0.14})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(field.x, field.y, field.r, 0, Math.PI * 2);
    ctx.stroke();

    // inner dot
    ctx.fillStyle = `rgba(255,107,61,${0.18 + k * 0.16})`;
    ctx.beginPath();
    ctx.arc(field.x, field.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFragment(f) {
    const placed = state.placed.has(f.id);
    const falseLock = state.falseLocks.has(f.id);
    const isDrag = state.draggingId === f.id;

    ctx.fillStyle = placed
      ? "rgba(120,120,120,0.18)"
      : falseLock
        ? "rgba(255,107,61,0.12)"
        : isDrag
          ? "rgba(255,255,255,0.10)"
          : "rgba(255,255,255,0.06)";

    roundRect(f.x, f.y, f.w, f.h, 10, true, false);

    ctx.strokeStyle = placed
      ? "rgba(255,255,255,0.18)"
      : falseLock
        ? "rgba(255,107,61,0.42)"
        : "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    roundRect(f.x, f.y, f.w, f.h, 10, false, true);

    ctx.fillStyle = placed
      ? "rgba(230,230,230,0.35)"
      : "rgba(230,230,230,0.78)";
    ctx.font = "12px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(f.label, f.x + f.w / 2, f.y + f.h / 2);
  }

  function drawConnectionHints() {
    for (const f of state.fragments) {
      if (state.placed.has(f.id)) continue;
      if (state.falseLocks.has(f.id)) continue;

      const field = correctFieldForFragment(f);
      if (!field) continue;

      const c = fragmentCenter(f);
      const d = distance(c.x, c.y, field.x, field.y);
      if (d > 160) continue;

      const alpha = 1 - d / 160;
      ctx.strokeStyle = `rgba(255,107,61,${alpha * 0.18})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(field.x, field.y);
      ctx.stroke();
    }
  }

  function draw() {
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const t = (performance.now() - state.startTime) / 1000;
    const k = fieldStability();

    ctx.clearRect(0, 0, W, H);

    // background
    const g = ctx.createRadialGradient(W * 0.5, H * 0.42, 20, W * 0.5, H * 0.42, Math.max(W, H) * 0.65);
    g.addColorStop(0, "rgba(255,255,255,0.03)");
    g.addColorStop(1, "rgba(0,0,0,0.68)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // fields
    for (const field of state.fields) {
      drawField(field, t);
    }

    // center readout
    ctx.fillStyle = "rgba(230,230,230,0.56)";
    ctx.font = "12px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`FIELD STABILITY: ${state.placed.size}/${STEMS.length}`, W / 2, 108);

    drawConnectionHints();

    // fragments
    for (const f of state.fragments) {
      drawFragment(f);
    }

    // completion hush / faint wash
    if (state.recoveredShown) {
      ctx.fillStyle = `rgba(255,255,255,${0.04 + Math.sin(t * 0.8) * 0.01})`;
      ctx.fillRect(0, 0, W, H);
    }

    requestAnimationFrame(loop);
  }

  function loop() {
    update();
    draw();
  }

  function roundRect(x, y, w, h, r, fill, stroke) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // init
  resizeCanvas();
  layout();
  setIntegrityUI();
  requestAnimationFrame(loop);
}
