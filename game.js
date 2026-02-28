const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const startCommandButton = document.getElementById('start-command-lineup');
const resultToggleButton = document.getElementById('toggle-command-result');

const W = canvas.width;
const H = canvas.height;
const GRAVITY = 1400;
const JUMP = 460;

const WORLD_W = 3200;
const FLOOR_Y = 250;
const PLAYER_SPEED = 95;
const FINISH_X = WORLD_W - 120;
const HOUSE_REVEAL_SPEED = 520;
const HOUSE_REVEAL_TARGET_OFFSET = 0.45;

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

const HOUSE_PART_BLUEPRINT = [
  { type: 'wall', x: 0, y: 0, w: 110, h: 68 },
  { type: 'roof', x: -4, y: -4 },
  { type: 'chimney', x: 84, y: -26, w: 8, h: 20 },
  { type: 'door', x: 12, y: 36, w: 14, h: 32 },
  { type: 'window', x: 36, y: 22, w: 12, h: 10 },
  { type: 'window', x: 66, y: 22, w: 12, h: 10 },
];

let houseParts = [];
let allOrdersReceived = false;
let houseRevealActive = false;
let houseRevealDone = false;

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

const COMMAND_LINE = {
  frontOffset: 20,
  spacing: 18,
  queueSpeed: 140,
  returnSpeed: 140,
  workSpeed: 130,
  markDisplayMs: 1800,
  resultPanelMaxLines: 12,
  textDisplayMaxLen: 24,
};

const commandSession = {
  active: false,
  queue: [],
  cursor: 0,
};
let showCommandResults = false;
let commandResultRows = [];
houseParts = createHouseParts();

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

const npcs = Array.from({ length: 2 }, (_, i) => {
  const baseY = FLOOR_Y - (14 + Math.floor(rand() * 8));
  const w = 12 + Math.floor(rand() * 3);
  const h = 14 + Math.floor(rand() * 4);
  const homeX = Math.floor(rand() * (WORLD_W - 200)) + 80;
  const homeY = FLOOR_Y - h;
  return {
    id: i,
    x: homeX,
    y: homeY,
    w,
    h,
    homeX,
    homeY,
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
    commandState: 'roam',
    lineSlot: -1,
    commandMarkUntil: 0,
    isBuildCommand: false,
    assignedBuildPartId: null,
    lastHeardText: '',
    lastInterpretation: '',
    commandTargetX: null,
  };
});

let clear = false;
let message = '2D Dot Meadow';
let cameraX = 0;
let walkTime = 0;
let lastTime = performance.now();
let liveTranscriptLine = '';
let latestLiveTranscript = '';
let firstBuilderAudioPaused = false;

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

function createHouseParts() {
  return HOUSE_PART_BLUEPRINT.map((part, index) => ({
    id: index,
    type: part.type,
    x: part.x,
    y: part.y,
    w: part.w || 0,
    h: part.h || 0,
    built: false,
    builtBy: null,
  }));
}

function resetHouseBuildProgress() {
  houseParts = createHouseParts();
  houseRevealActive = false;
  houseRevealDone = false;
  allOrdersReceived = false;
}

function getHousePartAbsoluteX(part) {
  return home.x + part.x;
}

function buildClosestHousePartForNpc(npc, preferredType) {
  const unbuilt = houseParts.filter((part) => !part.built);
  if (!unbuilt.length) return null;

  let candidates = unbuilt;
  if (preferredType) {
    const filtered = unbuilt.filter((part) => part.type === preferredType);
    if (filtered.length) {
      candidates = filtered;
    }
  }

  let picked = candidates[0];
  let bestDistance = Math.abs(getHousePartAbsoluteX(picked) - npc.homeX);
  for (let i = 1; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const distance = Math.abs(getHousePartAbsoluteX(candidate) - npc.homeX);
    if (distance < bestDistance) {
      picked = candidate;
      bestDistance = distance;
    }
  }

  picked.assignedTo = npc.id;
  return picked.id;
}

function completeBuildForNpc(npc) {
  if (npc.assignedBuildPartId === null) {
    return null;
  }
  const part = houseParts.find((candidate) => candidate.id === npc.assignedBuildPartId);
  if (!part || part.built) {
    return null;
  }

  part.built = true;
  part.builtBy = npc.id;
  npc.assignedBuildPartId = null;
  return part;
}

function setLiveTranscript(text) {
  const line = String(text || '');
  if (!line) {
    liveTranscriptLine = '';
    latestLiveTranscript = '';
    return;
  }

  if (latestLiveTranscript && line === latestLiveTranscript) {
    return;
  }

  if (latestLiveTranscript && line.startsWith(latestLiveTranscript)) {
    const appended = line.slice(latestLiveTranscript.length);
    if (appended) {
      liveTranscriptLine += appended;
    } else {
      liveTranscriptLine = line;
    }
  } else {
    liveTranscriptLine = line;
  }

  latestLiveTranscript = line;
}

function pauseMicForBuildAndResumeNextChild(nextHasTurn) {
  setLiveTranscript('');

  const stopPromise =
    typeof window.pauseVoxtralMic === 'function'
      ? Promise.resolve(window.pauseVoxtralMic())
      : typeof window.stopVoxtralMic === 'function'
      ? Promise.resolve(window.stopVoxtralMic({ finalize: false }))
      : Promise.resolve();

  if (!nextHasTurn) {
    stopPromise.catch(() => {});
    return;
  }

  stopPromise
    .catch((err) => {
      console.error('[game] pauseVoxtralMic failed', err);
    })
    .finally(() => {
      if (typeof window.startVoxtralMic === 'function') {
        window.startVoxtralMic();
      } else {
        console.error('[game] startVoxtralMic not available');
      }
    });
}

function updateCommandButtons() {
  if (!resultToggleButton) return;
  resultToggleButton.textContent = showCommandResults ? '結果非表示' : '結果確認';
}

function ensureResultText(value, fallback = '未受信') {
  const text = String(value || '').trim();
  return text || fallback;
}

function getFrontOrderedNpcs() {
  const direction = player.facing >= 0 ? 1 : -1;
  const front = [];
  const back = [];

  for (const npc of npcs) {
    const projected = (npc.x - player.x) * direction;
    if (projected >= 0) front.push(npc);
    else back.push(npc);
  }

  const distanceSort = (a, b) => Math.abs(a.x - player.x) - Math.abs(b.x - player.x);
  front.sort(distanceSort);
  back.sort(distanceSort);
  return front.concat(back);
}

function getCommandLineX(slot) {
  const direction = player.facing >= 0 ? 1 : -1;
  return clamp(
    player.x + direction * (COMMAND_LINE.frontOffset + slot * COMMAND_LINE.spacing),
    20,
    WORLD_W - 20
  );
}

function getBuildDepartureX(npc) {
  const rightBandStart = WORLD_W - 120;
  return clamp(rightBandStart - (npc.id % 5) * 12 - (npc.w || 12), 20, WORLD_W - (npc.w || 12));
}

function isBuildingCommand(text) {
  const raw = (text || '').trim().toLowerCase();
  if (!raw) return { isBuild: false, interpretation: '聞き取れませんでした' };

  const normalized = raw
    .replace(/[。、!！?？,、]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const buildRules = [
    { re: /壁|せき|塀|かき|かけ|かぎ/, label: '壁/塀', partType: 'wall' },
    { re: /屋根|屋たて|屋根を|屋根を?作|天井/, label: '屋根', partType: 'roof' },
    { re: /床|床板|土台/, label: '床', partType: 'wall' },
    { re: /煙突|煙だ|煙突/, label: '煙突', partType: 'chimney' },
    { re: /門|とびら|出入口|入口/, label: '門', partType: 'door' },
    { re: /窓|まど|ガラス/, label: '窓', partType: 'window' },
    { re: /柱|たて|支柱/, label: '柱', partType: 'wall' },
    { re: /家|建築|建て|建てて|設置|置いて|置く|作って|作成/, label: '建築全般' },
  ];

  for (const rule of buildRules) {
    if (rule.re.test(normalized)) {
      return {
        isBuild: true,
        interpretation: `建築指示: ${rule.label}`,
        preferredPartType: rule.partType || null,
      };
    }
  }

  return { isBuild: false, interpretation: '建築指示として判定できませんでした' };
}

function appendCommandResultToLog(child) {
  const entry = {
    childId: child.id,
    heard: child.lastHeardText || '',
    interpreted: child.lastInterpretation || '',
  };
  const idx = commandResultRows.findIndex((r) => r.childId === entry.childId);
  if (idx >= 0) {
    commandResultRows[idx] = entry;
  } else {
    commandResultRows.push(entry);
  }
  commandResultRows = commandResultRows.sort((a, b) => a.childId - b.childId);
}

function startCommandLineup() {
  if (commandSession.active) {
    addMessage('命令受付中です。現在の順番で次の命令を受けます。');
    return;
  }

  resetCommandResultLog();
  const ordered = getFrontOrderedNpcs();
  if (!ordered.length) {
    addMessage('命令を受ける子が見つかりません。');
    return;
  }

  commandSession.active = true;
  firstBuilderAudioPaused = false;
  commandSession.queue = ordered;
  commandSession.cursor = 0;
  allOrdersReceived = false;
  houseRevealActive = false;
  houseRevealDone = false;

  for (const npc of npcs) {
    npc.commandState = 'queued';
    npc.commandMarkUntil = 0;
    npc.isBuildCommand = false;
    npc.assignedBuildPartId = null;
    npc.commandTargetX = null;
    npc.commandTargetY = null;
    npc.lineSlot = -1;
  }

  for (let i = 0; i < ordered.length; i += 1) {
    ordered[i].lineSlot = i;
    ordered[i].lastHeardText = '';
    ordered[i].lastInterpretation = '';
  }

  updateCommandButtons();
  if (resultToggleButton) {
    resultToggleButton.disabled = false;
  }

  addMessage('命令待機列を開始します。先頭から順に命令を受けます。');
}

function receiveHeroCommand(text) {
  const spoken = (text || '').trim();
  if (!spoken) return;

  if (!commandSession.active) {
    addMessage('命令受付は開始されていません。開始ボタンを押してください。');
    return;
  }

  const targetNpc = commandSession.queue[commandSession.cursor];
  if (!targetNpc) {
    commandSession.active = false;
    addMessage('すでに命令の割当は完了しています。');
    return;
  }

  const parsed = isBuildingCommand(spoken);
  targetNpc.lastHeardText = spoken;
  targetNpc.lastInterpretation = parsed.interpretation;
  targetNpc.isBuildCommand = parsed.isBuild;
  targetNpc.assignedBuildPartId = null;
  if (parsed.isBuild) {
    targetNpc.assignedBuildPartId = buildClosestHousePartForNpc(targetNpc, parsed.preferredPartType);
    targetNpc.commandMarkUntil = performance.now() + COMMAND_LINE.markDisplayMs;
  }
  targetNpc.commandTargetX = targetNpc.homeX;
  targetNpc.commandTargetY = targetNpc.homeY;

  if (parsed.isBuild) {
    if (targetNpc.assignedBuildPartId == null) {
      targetNpc.isBuildCommand = false;
    }
  }
  targetNpc.commandMarkUntil = targetNpc.isBuildCommand ? targetNpc.commandMarkUntil : 0;
  targetNpc.commandState = 'returnHome';
  targetNpc.lineSlot = -1;

  appendCommandResultToLog(targetNpc);
  const wasFirstBuilder = commandSession.cursor === 0 && targetNpc.isBuildCommand;
  commandSession.cursor += 1;
  if (commandSession.cursor >= commandSession.queue.length) {
    allOrdersReceived = true;
    commandSession.active = false;
    addMessage(`命令受付完了: ${targetNpc.id} が最後の子です。`);
  } else {
    const next = commandSession.queue[commandSession.cursor];
    addMessage(`子${targetNpc.id} が命令を受理。次は子${next.id}`);
    if (wasFirstBuilder && !firstBuilderAudioPaused) {
      firstBuilderAudioPaused = true;
      pauseMicForBuildAndResumeNextChild(true);
    }
  }
}

function truncateText(value, maxLen) {
  const text = String(value || '').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1))}…`;
}

function moveToward(npc, targetX, speed, dt) {
  const dx = targetX - npc.x;
  const distance = Math.abs(dx);
  if (distance <= 0.5) {
    npc.x = targetX;
    return true;
  }
  const step = Math.min(1, (speed * dt) / Math.max(1, distance));
  npc.x += dx * step;
  return step >= 1;
}

function drawBuildMark(npc, sx) {
  if (!npc.isBuildCommand) return;
  if (npc.commandState !== 'returnHome') return;
  if (npc.commandMarkUntil && npc.commandMarkUntil <= performance.now()) return;

  ctx.fillStyle = '#ffef6a';
  ctx.strokeStyle = '#2a1200';
  ctx.lineWidth = 1;
  ctx.fillRect(sx + npc.w * 0.5 - 4, npc.y - 20, 10, 12);
  ctx.strokeRect(sx + npc.w * 0.5 - 4 + 0.5, npc.y - 20 + 0.5, 9, 11);
  ctx.fillStyle = '#2a1200';
  ctx.font = '10px "Courier New", monospace';
  ctx.fillText('!', sx + npc.w * 0.5 - 2, npc.y - 10);
}

function getCommandResultRows() {
  const rowsById = new Map(
    commandResultRows.map((row) => [
      row.childId,
      {
        heard: ensureResultText(row.heard),
        interpreted: ensureResultText(row.interpreted),
      },
    ])
  );

  return [...npcs]
    .sort((a, b) => a.id - b.id)
    .map((npc) => ({
      childId: npc.id,
      heard: ensureResultText(rowsById.get(npc.id)?.heard),
      interpreted: ensureResultText(rowsById.get(npc.id)?.interpreted),
    }));
}

function drawCommandResultPanel() {
  if (!showCommandResults) return;

  const x = 8;
  const y = 72;
  const rowHeight = 13;
  const lines = getCommandResultRows();

  const panelHeight = Math.min(260, 10 + lines.length * rowHeight + 8);
  ctx.fillStyle = 'rgba(5, 12, 18, 0.86)';
  ctx.fillRect(x, y, Math.min(W - 16, 620), panelHeight);
  ctx.strokeStyle = '#e9f2ff';
  ctx.strokeRect(x + 0.5, y + 0.5, Math.min(W - 17, 620) - 1, panelHeight - 1);

  ctx.fillStyle = '#f1f6ff';
  ctx.font = '10px "Courier New", monospace';
  ctx.fillText('コマンド結果', x + 6, y + 16);

  for (let i = 0; i < lines.length; i += 1) {
    const item = lines[i];
    const lineText = `子${item.childId}: 聞取="${truncateText(
      item.heard,
      COMMAND_LINE.textDisplayMaxLen
    )}" / 解釈="${truncateText(item.interpreted, COMMAND_LINE.textDisplayMaxLen)}"`;
    ctx.fillText(lineText, x + 6, y + 30 + i * rowHeight);
  }
}

function resetNpcCommandStates() {
  for (const npc of npcs) {
    npc.commandState = 'roam';
    npc.commandMarkUntil = 0;
    npc.lineSlot = -1;
    npc.commandTargetX = null;
    npc.commandTargetY = null;
    npc.isBuildCommand = false;
    npc.assignedBuildPartId = null;
  }
}

function resetCommandSession() {
  commandSession.active = false;
  commandSession.queue = [];
  commandSession.cursor = 0;
  allOrdersReceived = false;
  firstBuilderAudioPaused = false;
  resetNpcCommandStates();
}

function resetCommandResultLog() {
  commandResultRows = [];
  showCommandResults = false;
  updateCommandButtons();
}

function toggleCommandResultPanel() {
  showCommandResults = !showCommandResults;
  updateCommandButtons();
  addMessage(showCommandResults ? '結果表示: ON' : '結果表示: OFF');
}

function resetGame() {
  clear = false;
  player.dead = false;
  player.lives = 3;
  addMessage('2D Dot Meadow - リトライ可能');
  resetPlayer();
  resetHouseBuildProgress();
  resetCommandSession();
  resetCommandResultLog();
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
    if (npc.commandState === 'queued') {
      const targetX = getCommandLineX(npc.lineSlot);
      const reached = moveToward(npc, targetX, COMMAND_LINE.queueSpeed, dt);
      npc.state = 'walk';
      npc.walkPhase += dt * 10;
      npc.y = FLOOR_Y - npc.h;
      npc.x = clamp(npc.x, 20, WORLD_W - npc.w - 20);
      if (reached) {
        npc.state = 'idle';
        npc.idleTimer = Math.max(npc.idleTimer || 0, randf(0.2, 0.6));
      }
      continue;
    }

    if (npc.commandState === 'returnHome') {
      const targetX = npc.commandTargetX ?? npc.homeX;
      const arrived = moveToward(npc, targetX, COMMAND_LINE.workSpeed, dt);
      npc.state = 'walk';
      npc.walkPhase += dt * 12;
      npc.y = npc.commandTargetY ?? FLOOR_Y - npc.h;

      if (arrived) {
        const builtPart = completeBuildForNpc(npc);
        if (builtPart) {
          const partName = builtPart.type === 'wall' ? '壁' : builtPart.type === 'roof' ? '屋根' : builtPart.type === 'door' ? '扉' : builtPart.type === 'window' ? '窓' : '部品';
          addMessage(`子${npc.id} が家の${partName}を設置しました。`);
        }
        npc.commandState = 'roam';
        npc.commandTargetX = null;
        npc.commandTargetY = null;
        npc.commandMarkUntil = 0;
        npc.isBuildCommand = false;
        npc.assignedBuildPartId = null;
      }
      continue;
    }

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

function checkHouseRevealTrigger() {
  if (houseRevealActive || houseRevealDone || !allOrdersReceived || clear) {
    return;
  }

  const busy = npcs.some(
    (npc) => npc.commandState === 'queued' || npc.commandState === 'moveToWork' || npc.commandState === 'returnHome'
  );
  if (busy) {
    return;
  }

  houseRevealActive = true;
  addMessage('全員の指示が完了したので、建物のある場所へカメラを移動します。');
}

function updateCamera(dt) {
  if (houseRevealDone && !houseRevealActive) {
    return;
  }

  if (houseRevealActive) {
    const target = clamp(home.x - W * HOUSE_REVEAL_TARGET_OFFSET, 0, WORLD_W - W);
    const dx = target - cameraX;
    const step = HOUSE_REVEAL_SPEED * dt;
    if (Math.abs(dx) <= step) {
      cameraX = target;
      houseRevealActive = false;
      houseRevealDone = true;
      clear = true;
      addMessage('家の建設が完了。Rでリトライできます。');
      return;
    }
    cameraX += dx > 0 ? step : -step;
    return;
  }

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

function drawHousePart(part, sx, sy) {
  if (part.type === 'wall') {
    ctx.fillStyle = palette.houseWall;
    ctx.fillRect(sx + part.x, sy + part.y, part.w, part.h);
    return;
  }
  if (part.type === 'roof') {
    for (let i = 0; i < 14; i += 1) {
      const rowY = sy - 4 - i;
      const rx = sx - 4 + i;
      const rw = 6 + i * 2;
      ctx.fillStyle = i === 0 ? '#9a352a' : palette.houseRoof;
      ctx.fillRect(rx, rowY, rw, 4);
    }
    return;
  }
  if (part.type === 'chimney') {
    ctx.fillStyle = '#d4b07a';
    ctx.fillRect(sx + part.x, sy + part.y, part.w, part.h);
    return;
  }
  if (part.type === 'door') {
    ctx.fillStyle = palette.houseTrim;
    ctx.fillRect(sx + part.x, sy + part.y, part.w, part.h);
    ctx.fillStyle = '#f1f7db';
    ctx.fillRect(sx + part.x + 4, sy + part.y + 12, 2, 6);
    return;
  }
  if (part.type === 'window') {
    ctx.fillStyle = palette.houseWindow;
    ctx.fillRect(sx + part.x, sy + part.y, part.w, part.h);
    ctx.fillStyle = palette.houseTrim;
    ctx.fillRect(sx + part.x + 3, sy + part.y + 2, 2, part.h - 4);
    ctx.fillRect(sx + part.x + 9, sy + part.y + 2, 2, part.h - 4);
  }
}

function drawHouse() {
  const x = home.x - cameraX;
  const y = FLOOR_Y - home.h;
  const builtParts = houseParts.filter((part) => part.built);
  if (!builtParts.length && !houseRevealActive && !houseRevealDone) return;

  if (x + home.w < -20 || x > W + 20) return;

  // shadow
  ctx.fillStyle = '#24402b66';
  ctx.fillRect(x + 12, FLOOR_Y + 2, home.w - 20, 3);

  for (const part of builtParts) {
    drawHousePart(part, x, y);
  }
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

function drawDotBody(x, y, sprite = {}) {
  const w = sprite.w || 12;
  const h = sprite.h || 12;
  const isHero = sprite.isHero === true;
  const heroColor = '#00ff00';
  const heroEye = '#003b14';
  const enemyColor = sprite.color || '#ff3d3d';

  ctx.fillStyle = isHero ? heroColor : enemyColor;
  ctx.fillRect(x, y, w, h);

  if (isHero) {
    ctx.fillStyle = heroEye;
    ctx.fillRect(x + (sprite.facing >= 0 ? w - 3 : 3), y + 4, 2, 2);
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

  // NPCを先に描画し、主人公は最後に描画して必ず見えるようにする
  const sortedNpcs = [...npcs].sort((a, b) => a.y + a.h - (b.y + b.h));
  for (const e of sortedNpcs) {
    const sx = e.x - cameraX;
    if (sx + 80 < 0 || sx - 80 > W) continue;

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

    drawBuildMark(e, sx);
  }

  // Hero (always on top)
  const px = player.x - cameraX;
  if (px + 80 >= 0 && px - 80 <= W) {
    drawDotBody(px, player.y, {
      w: player.w,
      h: player.h,
      facing: player.facing,
      walkPhase: player.walkPhase,
      type: 'human',
      isHero: true,
    });
  }

  // HUD
  ctx.fillStyle = '#e9f2ff';
  ctx.font = '14px "Courier New", monospace';
  ctx.fillText(`NPC:${npcs.length}  HP:${player.lives}`, 8, 18);
  ctx.fillText(message, 8, 34);
  ctx.fillText(`X:${Math.floor(player.x)} / ${WORLD_W}`, 8, 50);

  ctx.fillText('音声デバッグ:', 8, 66);
  ctx.fillText(liveTranscriptLine, 8, 82);

  drawCommandResultPanel();
}

function update(dt) {
  if (!clear) {
    if (!houseRevealActive) {
      updatePlayer(dt);
    }
    updateNpcs(dt);
    checkHouseRevealTrigger();
  }
  updateCamera(dt);
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
    setLiveTranscript,
    onHeroSpeech: receiveHeroCommand,
  });
}

if (startCommandButton) {
  startCommandButton.addEventListener('click', () => {
    startCommandLineup();
  });
}

if (resultToggleButton) {
  resultToggleButton.disabled = true;
  resultToggleButton.addEventListener('click', toggleCommandResultPanel);
}
updateCommandButtons();

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
