// game.js — Crossing Field

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const TILE = 32;
const GRID_W = 16;
const GRID_H = 16;

let player = { x: 8, y: 15 };
let round = 1;
let deaths = 0;
let crossings = 0;

let obstacles = [];
let hasWon = false;
let started = false;
let isCollapsed = false;

let winTimeMs = 0;

// Overlay start gate
const overlay = document.getElementById("overlay");
const startBtn = document.getElementById("startBtn");
const overlayMsg = document.getElementById("overlayMsg");

// For "made it safe" sound: only fire once per crossing when hitting row 0.
let safeSfxArmed = true;

// Simple movement boop
let moveSfxCtx = null;
function playMoveBoop() {
  try {
    if (!moveSfxCtx) {
      moveSfxCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (moveSfxCtx.state === "suspended") moveSfxCtx.resume();

    const t0 = moveSfxCtx.currentTime;
    const osc = moveSfxCtx.createOscillator();
    const gain = moveSfxCtx.createGain();

    osc.type = "square";
    osc.frequency.setValueAtTime(520, t0);
    osc.frequency.exponentialRampToValueAtTime(390, t0 + 0.06);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.035, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.075);

    osc.connect(gain);
    gain.connect(moveSfxCtx.destination);

    osc.start(t0);
    osc.stop(t0 + 0.08);
  } catch {}
}

startBtn.addEventListener("click", async () => {
  if (started) return;

  try{
    overlayMsg.textContent = "Loading audio...";
    await initAudio();
    started = true;
    overlay.classList.add("hidden");
    document.getElementById("status").textContent = "ROUND 1";
  } catch(e){
    console.error(e);
    overlayMsg.textContent = String(e.message || e);
  }
});

// Movement helper
function move(dx, dy){
  if (!started || hasWon || isCollapsed) return;

  const oldX = player.x;
  const oldY = player.y;

  player.x += dx;
  player.y += dy;

  player.x = Math.max(0, Math.min(GRID_W - 1, player.x));
  player.y = Math.max(0, Math.min(GRID_H - 1, player.y));

  if (player.x !== oldX || player.y !== oldY) {
    playMoveBoop();
  }
}

// Keyboard controls
document.addEventListener("keydown", e => {
  if (!started) return;

  if (e.key === "ArrowLeft") move(-1, 0);
  if (e.key === "ArrowRight") move(1, 0);
  if (e.key === "ArrowUp") move(0, -1);
  if (e.key === "ArrowDown") move(0, 1);
});

// Mobile swipe controls
let touchStart = null;

canvas.addEventListener("pointerdown", e => {
  if (!started) return;
  if (isCollapsed) return;

  e.preventDefault();
  canvas.setPointerCapture?.(e.pointerId);
  touchStart = { x: e.clientX, y: e.clientY };
}, { passive: false });

canvas.addEventListener("pointermove", e => {
  if (!started) return;
  e.preventDefault();
}, { passive: false });

canvas.addEventListener("pointerup", e => {
  if (!started || !touchStart) return;
  if (isCollapsed) return;

  e.preventDefault();

  const dx = e.clientX - touchStart.x;
  const dy = e.clientY - touchStart.y;

  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const THRESH = 18;

  if (adx < THRESH && ady < THRESH) {
    touchStart = null;
    return;
  }

  if (adx > ady) move(dx > 0 ? 1 : -1, 0);
  else move(0, dy > 0 ? 1 : -1);

  touchStart = null;
}, { passive: false });

function spawnObstacles(){
  obstacles = [];

  let baseSpeed;
  let obstaclesPerRow;

  if (round === 1) {
    baseSpeed = 0.040;
    obstaclesPerRow = 1;
  } else if (round === 2) {
    baseSpeed = 0.047;
    obstaclesPerRow = 2;
  } else {
    baseSpeed = 0.059;
    obstaclesPerRow = 3;
  }

  for (let y = 2; y < 14; y += 2){
    const dir = ((y / 2) % 2 === 0) ? 1 : -1;
    const laneVar = 0.82 + ((y % 6) * 0.04);
    const laneSpeed = baseSpeed * laneVar;

    for (let i = 0; i < obstaclesPerRow; i++){
      const spacing = Math.floor(GRID_W / obstaclesPerRow);
      const jitter = Math.floor(Math.random() * Math.max(1, spacing));
      const x0 = (i * spacing + jitter) % GRID_W;

      obstacles.push({
        x: x0,
        y,
        speed: laneSpeed,
        dir
      });
    }
  }
}

function updateIntegrityUI(){
  const integrity = Math.max(0, 100 - deaths * 33);
  document.getElementById("integrity").textContent = "INTEGRITY: " + integrity + "%";
  return integrity;
}

function triggerCollapse(){
  if (isCollapsed) return;
  isCollapsed = true;

  document.getElementById("status").textContent = "INTEGRITY FAILURE";

  if (typeof collapseAudio === "function") collapseAudio();

  setTimeout(() => {
    if (!hasWon) document.getElementById("status").textContent = "RECOVERY FAILED";
  }, 4200);
}

function playerDeath(){
  deaths++;

  if (typeof playHitSound === "function") playHitSound();
  if (typeof degradeAudio === "function") degradeAudio();

  const integrity = updateIntegrityUI();

  player = { x: 8, y: 15 };

  if (integrity <= 0){
    triggerCollapse();
  }
}

function winGame(){
  if (hasWon) return;
  hasWon = true;
  winTimeMs = performance.now();

  const status = document.getElementById("status");
  if (status) status.textContent = "ASCENSION";

  const panel = document.getElementById("ascendPanel");
  if (panel) panel.classList.remove("hidden");

  if (typeof ascendAudio === "function") ascendAudio();
}

function update(){
  if (!started || hasWon || isCollapsed) return;

  obstacles.forEach(o => {
    o.x += o.speed * o.dir;

    if (o.x >= GRID_W) o.x -= GRID_W;
    if (o.x < 0) o.x += GRID_W;

    if (Math.floor(o.x) === player.x && o.y === player.y){
      playerDeath();
    }
  });

  if (player.y === 0){
    if (safeSfxArmed && typeof playSafeSound === "function") {
      playSafeSound();
      safeSfxArmed = false;
    }

    crossings++;
    round++;

    player = { x: 8, y: 15 };
    safeSfxArmed = true;

    if (crossings >= 3){
      winGame();
      return;
    }

    document.getElementById("status").textContent = "ROUND " + round;
    spawnObstacles();
  }
}

function draw(){
  ctx.fillStyle = "#120a08";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(0, 0, canvas.width, TILE);

  ctx.fillStyle = "#d07a2a";
  obstacles.forEach(o => {
    ctx.fillRect(Math.floor(o.x) * TILE, o.y * TILE, TILE, TILE);
  });

  if (!hasWon){
    ctx.fillStyle = isCollapsed ? "#5a5a5a" : "#c7372c";
    ctx.fillRect(player.x * TILE, player.y * TILE, TILE, TILE);
    return;
  }

  const now = performance.now();
  const t = Math.max(0, (now - winTimeMs) / 1000);
  const fade = clamp01(t / 1.2);

  ctx.fillStyle = `rgba(0,0,0,${0.62 * fade})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#2fbf5a";
  ctx.fillRect(player.x * TILE, player.y * TILE, TILE, TILE);
  ctx.fillStyle = "#d8d8d8";
  ctx.fillRect(player.x * TILE + TILE - 6, player.y * TILE + 6, 3, TILE - 12);

  const pulse = 1 + 0.03 * Math.sin((2 * Math.PI * t) / 1.6);

 
}

function loop(){
  update();
  draw();
  requestAnimationFrame(loop);
}

function clamp01(x){
  return Math.max(0, Math.min(1, x));
}

spawnObstacles();
updateIntegrityUI();
loop();
