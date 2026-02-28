const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const W = canvas.width;
const H = canvas.height;
const GRAVITY = 1400;
const JUMP = 460;

const WORLD_W = 3200;
const FLOOR_Y = 250;
const PLAYER_SPEED = 95;
const FINISH_X = WORLD_W - 120;

const keys = new Set();

const palette = {
  skyTop: '#5fb4ff',
  skyBottom: '#a5defc',
  grassDark: '#3e7a34',
  grassMid: '#56a148',
  grassLight: '#76c55e',
  ground: '#264c2f',
  houseWall: '#f2f2ea',
  houseRoof: '#cf5547',
  houseTrim: '#5e4839',
  houseWindow: '#fdf8b8',
};

const home = {
  x: 1550,
  w: 110,
  h: 68,
};

const clouds = [
  { x: 150, y: 40, w: 68, h: 18, speed: 8, depth: 0.22 },
  { x: 380, y: 70, w: 52, h: 14, speed: 6, depth: 0.15 },
  { x: 920, y: 56, w: 80, h: 20, speed: 9, depth: 0.2 },
  { x: 1320, y: 36, w: 60, h: 16, speed: 7, depth: 0.17 },
  { x: 1880, y: 74, w: 72, h: 18, speed: 10, depth: 0.23 },
];

const decor = [
  { x: 260, kind: 'fence', h: 20 },
  { x: 510, kind: 'rock', h: 8 },
  { x: 860, kind: 'flower', h: 6 },
  { x: 1160, kind: 'stone', h: 10 },
  { x: 1410, kind: 'flower', h: 6 },
  { x: 1700, kind: 'tree', h: 26 },
  { x: 2120, kind: 'flower', h: 7 },
  { x: 2380, kind: 'rock', h: 10 },
  { x: 2700, kind: 'fence', h: 18 },
  { x: 2920, kind: 'flower', h: 8 },
];

const player = {
  x: 120,
  y: FLOOR_Y - 30,
  w: 16,
  h: 30,
  vx: 0,
  vy: 0,
  onGround: true,
  facing: 1,
  walkPhase: 0,
  animationIdle: 0,
  lives: 3,
  dead: false,
};

function createRng(seed) {
  let n = seed >>> 0;
  return () => {
    n = (n * 1664525 + 1013904223) >>> 0;
    return n / 0x100000000;
  };
}

const rand = createRng(0x1337);

const npcPalette = ['#ffcb74', '#ff8eb8', '#6cd4ff', '#d49bff', '#8be58c', '#ff9b71'];
const npcTypes = ['round', 'square', 'puff'];

const npcs = Array.from({ length: 12 }, (_, i) => {
  const baseY = FLOOR_Y - (14 + Math.floor(rand() * 8));
  const w = 12 + Math.floor(rand() * 3);
  const h = 14 + Math.floor(rand() * 4);
  const homeX = Math.floor(rand() * (WORLD_W - 200)) + 80;
  return {
    id: i,
    x: homeX,
    y: baseY,
    w,
    h,
    vx: 18 + Math.floor(rand() * 15),
    dir: rand() < 0.5 ? -1 : 1,
    minX: Math.max(40, homeX - (80 + Math.floor(rand() * 180))),
    maxX: Math.min(WORLD_W - 70, homeX + (80 + Math.floor(rand() * 220))),
    walkTimer: 0.8 + rand() * 1.4,
    idleTimer: 0.4 + rand() * 1.3,
    state: rand() < 0.6 ? 'walk' : 'idle',
    color: npcPalette[i % npcPalette.length],
    cap: npcPalette[(i * 3) % npcPalette.length],
    skin: ['#ffefc3', '#f7dd9f', '#efc7ab'][i % 3],
    outfit: ['#4b90ff', '#4ccf8f', '#ff8a5c'][i % 3],
    type: npcTypes[i % npcTypes.length],
    walkPhase: 0,
  };
});

let clear = false;
let message = '2D Dot Meadow';
let cameraX = 0;
let walkTime = 0;
let lastTime = performance.now();

function clamp(v, min, max) {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function randf(a, b) {
  return a + rand() * (b - a);
}

function tileNoise(x, y) {
  return Math.floor(Math.sin(x * 17.0 + y * 53.0) * 43758.5453) & 0xff;
}

function addMessage(text) {
  message = text;
}

function resetPlayer() {
  player.x = 120;
  player.y = FLOOR_Y - player.h;
  player.vx = 0;
  player.vy = 0;
  player.onGround = true;
  player.facing = 1;
  player.walkPhase = 0;
}

function resetGame() {
  clear = false;
  player.dead = false;
  player.lives = 3;
  addMessage('2D Dot Meadow - リトライ可能');
  resetPlayer();
}

function updatePlayer(dt) {
  if (clear || player.dead) return;

  let targetVx = 0;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) {
    targetVx = -PLAYER_SPEED;
    player.facing = -1;
  } else if (keys.has('ArrowRight') || keys.has('KeyD')) {
    targetVx = PLAYER_SPEED;
    player.facing = 1;
  }

  player.vx += (targetVx - player.vx) * Math.min(1, dt * 12);
  if (Math.abs(player.vx) < 2) player.vx = 0;

  player.vy += GRAVITY * dt;
  player.y += player.vy * dt;

  player.x += player.vx * dt;
  player.onGround = false;
  if (player.y + player.h >= FLOOR_Y) {
    player.y = FLOOR_Y - player.h;
    player.vy = 0;
    player.onGround = true;
  }

  player.x = clamp(player.x, 0, WORLD_W - player.w);

  player.walkPhase += Math.abs(player.vx) * dt * 0.12;
  player.animationIdle = (player.animationIdle + dt * 2.2) % 1000;

  if (player.x > FINISH_X && !clear) {
    clear = true;
    addMessage('草原の端に到達！ R で再挑戦');
  }
}

function updateNpcs(dt) {
  for (const npc of npcs) {
    npc.walkPhase += dt * 6;
    if (npc.state === 'walk') {
      npc.x += npc.vx * npc.dir * dt;
      if (npc.x < npc.minX) {
        npc.x = npc.minX;
        npc.dir = 1;
        npc.state = 'idle';
        npc.idleTimer = randf(0.8, 2.0);
      } else if (npc.x + npc.w > npc.maxX) {
        npc.x = npc.maxX - npc.w;
        npc.dir = -1;
        npc.state = 'idle';
        npc.idleTimer = randf(0.8, 1.8);
      }

      npc.walkTimer -= dt;
      if (npc.walkTimer <= 0 || rand() < dt * 0.05) {
        npc.state = 'idle';
        npc.idleTimer = randf(0.3, 1.4);
      }
    } else {
      npc.idleTimer -= dt;
      if (npc.idleTimer <= 0) {
        npc.state = 'walk';
        npc.dir *= -1;
        npc.walkTimer = randf(1.2, 2.6);
      }
    }

    npc.x = clamp(npc.x, 20, WORLD_W - npc.w - 20);
  }
}

function updateCamera() {
  const target = player.x - W * 0.45;
  cameraX = clamp(target, 0, WORLD_W - W);
}

function drawSky() {
  const sky = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
  sky.addColorStop(0, palette.skyTop);
  sky.addColorStop(1, palette.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, FLOOR_Y);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  for (const c of clouds) {
    const cx = (c.x - cameraX * c.depth + W + c.w) % (WORLD_W + c.w * 2) - c.w;
    const floatY = c.y + Math.sin((c.x + walkTime * c.speed) * 0.02) * 2;
    if (cx + c.w < 0 || cx > W) continue;
    drawCloud(cx, floatY, c.w, c.h);
  }
}

function drawCloud(x, y, w, h) {
  ctx.fillStyle = '#eefcff';
  ctx.fillRect(x + 2, y + 6, 2, h - 6);
  ctx.fillRect(x + 4, y + 4, 3, h - 4);
  ctx.fillRect(x + 7, y + 2, 4, h - 2);
  ctx.fillRect(x + 11, y + 4, 3, h - 4);
  ctx.fillRect(x + 14, y + 6, 2, h - 6);
  for (let i = 0; i < 4; i++) {
    const cx = x + w * 0.2 * i;
    ctx.fillRect(cx + (i % 2), y + 2, 2, 2);
  }
}

function drawGround() {
  const grad = ctx.createLinearGradient(0, FLOOR_Y, 0, H);
  grad.addColorStop(0, palette.grassMid);
  grad.addColorStop(1, palette.grassDark);
  ctx.fillStyle = grad;
  ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);

  const groundStart = Math.floor(cameraX / 16) * 16;
  for (let wx = groundStart - 16; wx < cameraX + W + 16; wx += 16) {
    const sx = wx - cameraX;
    if (sx < -24 || sx > W + 24) continue;

    const stripe = tileNoise(wx, 2) % 10;
    if (stripe < 2) {
      ctx.fillStyle = palette.grassDark;
    } else if (stripe < 5) {
      ctx.fillStyle = palette.grassMid;
    } else {
      ctx.fillStyle = palette.grassLight;
    }
    ctx.fillRect(sx, FLOOR_Y + 5, 16, 6);

    if (tileNoise(wx, 9) % 100 > 74) {
      const lightX = sx + 3;
      const lightY = FLOOR_Y + 1 + (tileNoise(wx, 11) % 8);
      ctx.fillStyle = '#95d96a';
      ctx.fillRect(lightX, lightY, 2, 2);
      ctx.fillRect(lightX + 2, lightY + 1, 2, 1);
    }

    if (tileNoise(wx, 4) % 100 > 84) {
      const dx = sx + 6;
      const dy = FLOOR_Y + 2;
      drawGrassBlip(dx, dy, 0.4 + (tileNoise(wx, 33) % 12) / 30);
    }
  }

  drawGroundDecorations();
}

function drawGrassBlip(x, y, a = 0.5) {
  const top = `rgba(130, 206, 98, ${a})`;
  const mid = `rgba(91, 164, 82, ${Math.max(0.2, a - 0.2)})`;
  ctx.fillStyle = top;
  ctx.fillRect(x, y, 2, 2);
  ctx.fillStyle = mid;
  ctx.fillRect(x + 1, y + 2, 1, 2);
}

function drawHouse() {
  const x = home.x - cameraX;
  const y = FLOOR_Y - home.h;
  if (x + home.w < -20 || x > W + 20) return;

  // shadow
  ctx.fillStyle = '#24402b66';
  ctx.fillRect(x + 12, FLOOR_Y + 2, home.w - 20, 3);

  // wall
  ctx.fillStyle = palette.houseWall;
  ctx.fillRect(x, y, home.w, home.h);

  // roof
  for (let i = 0; i < 14; i++) {
    const rowY = y - 4 - i;
    const rx = x - 4 + i;
    const rw = 6 + i * 2;
    ctx.fillStyle = i === 0 ? '#9a352a' : palette.houseRoof;
    ctx.fillRect(rx, rowY, rw, 4);
  }

  // door
  ctx.fillStyle = palette.houseTrim;
  ctx.fillRect(x + 12, y + 36, 14, 32);
  ctx.fillStyle = '#f1f7db';
  ctx.fillRect(x + 16, y + 48, 2, 6);

  // windows
  ctx.fillStyle = palette.houseWindow;
  ctx.fillRect(x + 36, y + 22, 12, 10);
  ctx.fillRect(x + 66, y + 22, 12, 10);
  ctx.fillStyle = palette.houseTrim;
  ctx.fillRect(x + 39, y + 24, 2, 6);
  ctx.fillRect(x + 69, y + 24, 2, 6);

  // chimney
  ctx.fillStyle = '#d4b07a';
  ctx.fillRect(x + 84, y - 26, 8, 20);
}

function drawGroundDecorations() {
  for (const d of decor) {
    const sx = d.x - cameraX;
    if (sx < -40 || sx > W + 40) continue;
    const baseY = FLOOR_Y;
    if (d.kind === 'flower') {
      ctx.fillStyle = '#f9f4d0';
      ctx.fillRect(sx + 4, baseY - d.h - 1, 4, 2);
      ctx.fillRect(sx, baseY - d.h - 4, 2, 2);
      ctx.fillRect(sx + 6, baseY - d.h - 4, 2, 2);
    } else if (d.kind === 'fence') {
      ctx.fillStyle = '#7e5e3d';
      ctx.fillRect(sx, baseY - 4, 28, 4);
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(sx + i * 8, baseY - 14, 4, 10);
      }
    } else if (d.kind === 'rock') {
      ctx.fillStyle = '#8a8d93';
      ctx.fillRect(sx + 2, baseY - d.h, d.h + 2, d.h);
    } else if (d.kind === 'tree') {
      ctx.fillStyle = '#6b4528';
      ctx.fillRect(sx + 6, baseY - d.h, 4, d.h);
      ctx.fillStyle = '#4f9a45';
      ctx.fillRect(sx - 1, baseY - d.h - 12, 12, 12);
    } else if (d.kind === 'stone') {
      ctx.fillStyle = '#a8adbd';
      ctx.fillRect(sx, baseY - d.h, d.h + 4, d.h + 2);
    }
  }
}

function drawDotBody(x, y, base, options = {}) {
  const w = base.w || 12;
  const h = base.h || 12;
  const isHero = options.isHero === true;
  const heroColor = '#00ff00';
  const heroEye = '#003b14';
  const enemyColor = options.color || '#ff3d3d';

  ctx.fillStyle = isHero ? heroColor : enemyColor;
  ctx.fillRect(x, y, w, h);

  if (isHero) {
    ctx.fillStyle = heroEye;
    ctx.fillRect(x + (options.facing >= 0 ? w - 3 : 3), y + 4, 2, 2);
  } else {
    // ドット風: 2x2で色を変える
    ctx.fillStyle = '#ff9a9a';
    ctx.fillRect(x + 1, y + 1, 4, 4);
    ctx.fillRect(x + w - 5, y + 1, 4, 4);
  }
}

function draw() {
  ctx.imageSmoothingEnabled = false;
  drawSky();
  drawGround();
  drawHouse();

  // NPCs (draw behind player if smaller y) to get depth-like ordering
  const actors = [...npcs, { ...player, isHero: true }].sort((a, b) => a.y + a.h - (b.y + b.h));
  for (const e of actors) {
    const sx = e.x - cameraX;
    if (sx + 80 < 0 || sx - 80 > W) continue;

    if (e.isHero) {
      drawDotBody(sx, e.y, {
        w: player.w,
        h: player.h,
        facing: player.facing,
        walkPhase: player.walkPhase,
        type: 'human',
        isHero: true,
      });
      continue;
    }

    drawDotBody(sx, e.y, {
      w: e.w,
      h: e.h,
      type: e.type,
      faceDir: 1,
      facing: e.dir,
      walkPhase: e.walkPhase,
      cap: e.cap,
      skin: e.skin,
      outfit: e.outfit,
      color: '#ff3d3d',
      isHero: false,
    });
  }

  // HUD
  ctx.fillStyle = '#e9f2ff';
  ctx.font = '14px "Courier New", monospace';
  ctx.fillText(`NPC:${npcs.length}  HP:${player.lives}`, 8, 18);
  ctx.fillText(message, 8, 34);
  ctx.fillText(`X:${Math.floor(player.x)} / ${WORLD_W}`, 8, 50);
}

function update(dt) {
  if (!clear) {
    updatePlayer(dt);
    updateNpcs(dt);
  }
  updateCamera();
}

function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  walkTime += dt;

  update(dt);
  draw();

  requestAnimationFrame(loop);
}

function updateFromVoxtral() {
  // 予約。音声制御を将来差し込むためのフックのみ。
}

if (typeof window.setupVoxtralIntegration === 'function') {
  window.setupVoxtralIntegration({
    getState: () => ({
      playerX: Math.floor(player.x),
      playerY: Math.floor(player.y),
      lives: player.lives,
      clear,
      npcCount: npcs.length,
      enemyCount: npcs.length,
      cameraX: Math.floor(cameraX),
      mode: clear ? 'goal' : 'play',
    }),
    setMessage: addMessage,
  });
}

window.render_game_to_text = () =>
  JSON.stringify({
    origin: 'top-left',
    player: {
      x: Math.floor(player.x),
      y: Math.floor(player.y),
      vx: Number(player.vx.toFixed(2)),
      vy: Number(player.vy.toFixed(2)),
      onGround: player.onGround,
    },
    npcs: npcs.map((n) => ({
      id: n.id,
      x: Math.floor(n.x),
      y: Math.floor(n.y),
      state: n.state,
    })),
    cameraX: Math.floor(cameraX),
    clear,
  });

window.advanceTime = (ms) => {
  const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  for (let i = 0; i < steps; i++) {
    const dt = 1 / 60;
    walkTime += dt;
    update(dt);
  }
  draw();
};

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Space' || e.code === 'KeyZ') {
    if (player.onGround && !clear) {
      player.vy = -JUMP;
      player.onGround = false;
    }
    e.preventDefault();
  }
  if (e.code === 'KeyR') {
    e.preventDefault();
    resetGame();
  }
});

window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
});

resetPlayer();
addMessage('2D Dot Meadow - ゆっくり散歩するドット世界');
requestAnimationFrame((now) => {
  lastTime = now;
  requestAnimationFrame(loop);
});
