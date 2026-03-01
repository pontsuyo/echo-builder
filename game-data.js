const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = 640;
const H = 360;

function resizeCanvasForDpr() {
  if (!canvas || !ctx) {
    return;
  }

  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, rect.width || W);
  const cssH = Math.max(1, rect.height || H);

  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  // Backing store is scaled by DPR, so the world transform must include it
  // to keep logical 640x360 content filling the full CSS canvas.
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
}

resizeCanvasForDpr();
window.addEventListener('resize', resizeCanvasForDpr, { passive: true });
const resultToggleButton = document.getElementById('toggle-command-result');
const debugToggleButton = document.getElementById('toggle-debug-overlay');
const testButtonsToggleButton = document.getElementById('toggle-test-buttons');
const testRelatedButtons = [];
const audioSendButton = document.getElementById('toggle-audio-send');
if (audioSendButton) {
  testRelatedButtons.push(audioSendButton);
}
testRelatedButtons.push(...document.querySelectorAll('.test-button'));
const childSpeechToggleButton = document.getElementById('toggle-child-speech');
let showChildSpeech = typeof window.__ELEVENLABS_TTS_ENABLED === 'boolean'
  ? window.__ELEVENLABS_TTS_ENABLED
  : false;

const WORLD_W = 3200;
const FLOOR_Y = 250;
const HOUSE_REVEAL_SPEED = 1040;
const HOUSE_REVEAL_TARGET_OFFSET = 0.30;
const DEFAULT_GOAL_HINT_IMAGE = '/images/goal-house-game-equivalent-1.svg';

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

const HOUSE_ROOF_SHAPES = ['triangle', 'flat', 'round', 'gable', 'hip', 'shed'];
const DEFAULT_ROOF_SHAPE = 'triangle';
const DEFAULT_GOAL_POSITION_TOLERANCE = 8;

const home = {
  x: 1550,
  w: 110,
  h: 68,
};

const HOUSE_PART_BLUEPRINT_DEFAULT = [
  { type: 'wall', x: 0, y: 0, w: 110, h: 68, colorHex: '#f2f2ea' },
  { type: 'roof', x: -4, y: -4, roofShape: 'triangle', colorHex: '#cf5547' },
  { type: 'chimney', x: 84, y: -26, w: 8, h: 20, colorHex: '#d4b07a' },
  { type: 'door', x: 12, y: 36, w: 14, h: 32, colorHex: '#5e4839' },
  { type: 'column', x: 16, y: 26, w: 7, h: 42, colorHex: '#8a847b' },
  { type: 'column', x: 50, y: 26, w: 7, h: 42, colorHex: '#8a847b' },
  { type: 'column', x: 84, y: 26, w: 7, h: 42, colorHex: '#8a847b' },
  { type: 'window', x: 36, y: 22, w: 12, h: 10, colorHex: '#fdf8b8' },
  { type: 'window', x: 66, y: 22, w: 12, h: 10, colorHex: '#fdf8b8' },
];
const HOUSE_PART_BLUEPRINT_GOAL_RED_LEFT_DOOR = [
  { type: 'wall', x: 0, y: 0, w: 110, h: 68, colorHex: '#f2f2ea' },
  { type: 'roof', x: -4, y: -4, roofShape: 'triangle', colorHex: '#cf5547' },
  { type: 'door', x: 12, y: 21, w: 12, h: 47, colorHex: '#5e4839' },
];
const HOUSE_PART_BLUEPRINT = HOUSE_PART_BLUEPRINT_DEFAULT;

const HOUSE_PART_BLUEPRINT_BY_GOAL_ID = {
  'goal-red-roof-3columns-door-strict': HOUSE_PART_BLUEPRINT_GOAL_RED_LEFT_DOOR,
  'goal-red-roof-3columns-door': HOUSE_PART_BLUEPRINT_DEFAULT,
};

const GOAL_PATTERNS = [
  {
    goalId: 'goal-red-roof-3columns-door-strict',
    name: 'Red Roof, Left Door',
    version: '1.0',
    parts: [
      {
        partType: 'roof',
        requiredCount: { min: 1, max: 1 },
        weight: { count: 10, color: 10, position: 0 },
        targetColorHex: '#cf5547',
        targetRoofShape: 'triangle',
      },
      {
        partType: 'door',
        requiredCount: { min: 1, max: 1 },
        weight: { count: 10, color: 0, position: 0 },
      },
    ],
    penalties: {
      extraPart: -5,
      destroyedPart: -10,
    },
    score: {
      base: 0,
      min: 0,
      max: 100,
    },
    hintImage: DEFAULT_GOAL_HINT_IMAGE,
  },
  {
    goalId: 'goal-red-roof-3columns-door',
    name: 'Red Roof, 3 Pillars, Center Door',
    version: '1.0',
    parts: [
      {
        partType: 'roof',
        requiredCount: { min: 1, max: 1 },
        weight: { count: 10, color: 10, position: 0 },
        targetColorHex: '#d64545',
        targetRoofShape: 'triangle',
      },
      {
        partType: 'column',
        requiredCount: { min: 3, max: 3 },
        weight: { count: 10, color: 0, position: 0 },
      },
      {
        partType: 'door',
        requiredCount: { min: 1, max: 1 },
        weight: { count: 10, color: 0, position: 0 },
        positionRule: {
          mode: 'x-center',
          tolerancePx: 8,
        },
      },
    ],
    penalties: {
      extraPart: -5,
      destroyedPart: -10,
    },
    score: {
      base: 0,
      min: 0,
      max: 100,
    },
    hintImage: DEFAULT_GOAL_HINT_IMAGE,
  },
  {
    goalId: 'goal-blue-flat-roof-window2',
    name: 'Blue Flat Roof, 2 Windows',
    version: '1.0',
    parts: [
      {
        partType: 'roof',
        requiredCount: { min: 1, max: 1 },
        weight: { count: 10, color: 10, position: 0 },
        targetColorHex: '#4da6ff',
        targetRoofShape: 'flat',
      },
      {
        partType: 'window',
        requiredCount: { min: 2, max: 2 },
        weight: { count: 10, color: 8, position: 0 },
        targetColorHex: '#fdf8b8',
      },
      {
        partType: 'door',
        requiredCount: { min: 1, max: 1 },
        weight: { count: 10, color: 0, position: 0 },
      },
    ],
    penalties: {
      extraPart: -5,
      destroyedPart: -10,
    },
    score: {
      base: 0,
      min: 0,
      max: 100,
    },
    hintImage: DEFAULT_GOAL_HINT_IMAGE,
  },
  {
    goalId: 'goal-green-round-chimney',
    name: 'Green Round Roof, Chimney',
    version: '1.0',
    parts: [
      {
        partType: 'roof',
        requiredCount: { min: 1, max: 1 },
        weight: { count: 10, color: 10, position: 0 },
        targetColorHex: '#2f8f5f',
        targetRoofShape: 'round',
      },
      {
        partType: 'chimney',
        requiredCount: { min: 1, max: 1 },
        weight: { count: 10, color: 0, position: 0 },
      },
      {
        partType: 'column',
        requiredCount: { min: 2, max: 2 },
        weight: { count: 5, color: 0, position: 0 },
      },
    ],
    penalties: {
      extraPart: -5,
      destroyedPart: -10,
    },
    score: {
      base: 0,
      min: 0,
      max: 100,
    },
    hintImage: DEFAULT_GOAL_HINT_IMAGE,
  },
];

let houseParts = [];
let allOrdersReceived = false;
let houseRevealActive = false;
let houseRevealDone = false;
let activeGoal = null;
let lastGoalId = null;
let goalScore = 0;
let goalScoreBreakdown = null;
let scoreVisible = false;

function cloneGoal(goal) {
  return JSON.parse(JSON.stringify(goal));
}

function getHousePartBlueprintForGoal(goalSpec = null) {
  const goalId = goalSpec ? goalSpec.goalId : (activeGoal ? activeGoal.goalId : null);
  return HOUSE_PART_BLUEPRINT_BY_GOAL_ID[goalId] || HOUSE_PART_BLUEPRINT;
}

function getGoalHintImagePath(goalSpec = null) {
  const goal = goalSpec || activeGoal || null;
  return goal && goal.hintImage ? goal.hintImage : DEFAULT_GOAL_HINT_IMAGE;
}

function selectRandomGoal(seed) {
  if (!GOAL_PATTERNS.length) {
    activeGoal = null;
    lastGoalId = null;
    goalScore = 0;
    goalScoreBreakdown = null;
    scoreVisible = false;
    return null;
  }

  const idx = Number.isFinite(seed)
    ? Math.abs(Math.floor(seed) % GOAL_PATTERNS.length)
    : Math.floor(Math.random() * GOAL_PATTERNS.length);
  const nextGoal = cloneGoal(GOAL_PATTERNS[idx]);
  activeGoal = nextGoal;
  lastGoalId = nextGoal.goalId;
  goalScore = 0;
  goalScoreBreakdown = null;
  scoreVisible = false;

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent('goal:selected', {
        detail: {
          goalId: nextGoal.goalId,
          version: nextGoal.version || '1.0',
          selectedAt: Date.now(),
        },
      })
    );
  }

  return activeGoal;
}

function setActiveGoal(goalSpec) {
  activeGoal = goalSpec ? cloneGoal(goalSpec) : null;
}

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeCount(req) {
  if (typeof req === 'number' && Number.isFinite(req)) {
    return { min: Math.max(0, req), max: Math.max(0, req) };
  }

  const fallback = { min: 0, max: 0 };
  if (!req || typeof req !== 'object') {
    return fallback;
  }

  const min = Number.isFinite(req.min) ? Math.max(0, req.min) : 0;
  const max = Number.isFinite(req.max) ? Math.max(0, req.max) : min;
  return {
    min,
    max: Math.max(min, max),
  };
}

function getWeight(rule, key) {
  if (!rule || typeof rule !== 'object') {
    return 0;
  }

  const direct = Number(rule[key]);
  if (Number.isFinite(direct)) {
    return direct;
  }

  const aliases = {
    countWeight: 'count',
    colorWeight: 'color',
    positionWeight: 'position',
  };
  const alias = aliases[key];
  if (alias && Number.isFinite(Number(rule[alias]))) {
    return Number(rule[alias]);
  }

  const nested = rule.weight && Number(rule.weight[key.replace('Weight', '')]);
  if (Number.isFinite(nested)) {
    return nested;
  }

  return 0;
}

function normalizeColor(value) {
  if (!value) return '';
  const color = String(value).trim().toLowerCase();
  return color.startsWith('#') ? color : `#${color}`;
}

function isColorMatch(actual, expected) {
  if (!expected) {
    return false;
  }
  return normalizeColor(actual) === normalizeColor(expected);
}

function buildGoalRuleScore(goal, builtParts, destroyedParts = []) {
  const rules = Array.isArray(goal?.parts) ? goal.parts : [];
  const builtByType = {};

  for (const part of builtParts || []) {
    if (!part || !part.type) continue;
    const list = builtByType[part.type] || [];
    list.push(part);
    builtByType[part.type] = list;
  }

  const requiredByType = {};
  const breakdownRows = [];
  const extraByPartType = Object.create(null);
  let matchScore = 0;
  let maxMatchScore = 0;
  let extraCount = 0;

  for (const rule of rules) {
    const partType = rule.partType || rule.part || '';
    const range = normalizeCount(rule.requiredCount);
    const targetCount = Math.max(range.max, range.min);

    requiredByType[partType] = (requiredByType[partType] || 0) + targetCount;

    const countWeight = getWeight(rule.weight || rule, 'countWeight');
    const colorWeight = getWeight(rule.weight || rule, 'colorWeight');
    const positionWeight = getWeight(rule.weight || rule, 'positionWeight');
    maxMatchScore += countWeight + colorWeight + positionWeight;

    const builtOfType = builtByType[partType] || [];
    const doneCount = builtOfType.length;
    const denom = Math.max(1, targetCount);
    const countMatchScore = targetCount > 0
      ? (Math.min(doneCount, targetCount) / targetCount) * countWeight
      : 0;

    const targetColorHex = rule.targetColorHex;
    let colorMatchCount = 0;
    if (targetColorHex) {
      colorMatchCount = builtOfType.filter((part) => isColorMatch(part.colorHex, targetColorHex)).length;
    }
    const colorMatchScore = targetCount > 0
      ? (Math.min(colorMatchCount, targetCount) / denom) * colorWeight
      : 0;

    let positionMatchScore = 0;
    if (rule.positionRule && rule.positionRule.mode === 'x-center' && doneCount > 0 && targetCount > 0) {
      const sorted = [...builtOfType].sort((a, b) => {
        const aCenter = home.x + a.x + (a.w || 0) / 2;
        const bCenter = home.x + b.x + (b.w || 0) / 2;
        const ideal = home.x + home.w / 2;
        return Math.abs(aCenter - ideal) - Math.abs(bCenter - ideal);
      });
      const bestPart = sorted[0];
      const bestCenter = home.x + bestPart.x + (bestPart.w || 0) / 2;
      const tolerance = Number(rule.positionRule.tolerancePx) || DEFAULT_GOAL_POSITION_TOLERANCE;
      const dx = Math.abs(bestCenter - (home.x + home.w / 2));
      const decay = clamp01(1 - dx / tolerance);
      positionMatchScore = decay * positionWeight;
    }

    const partScore = countMatchScore + colorMatchScore + positionMatchScore;
    matchScore += partScore;

    breakdownRows.push({
      partType,
      targetCount,
      doneCount,
      countMatchScore,
      colorMatchScore,
      positionMatchScore,
      partScore,
      countWeight,
      colorWeight,
      positionWeight,
    });
  }

  for (const [type, parts] of Object.entries(builtByType)) {
    const expected = requiredByType[type] || 0;
    const extra = expected === 0 ? parts.length : Math.max(0, parts.length - expected);
    if (extra > 0) {
      extraCount += extra;
      extraByPartType[type] = (extraByPartType[type] || 0) + extra;
    }
  }

  const extraPenaltyValue = goal?.penalties?.extraPart || -5;
  const destroyPenaltyValue = goal?.penalties?.destroyedPart || -10;
  const destroyedCount = Array.isArray(destroyedParts) ? destroyedParts.length : 0;
  const extraPenalty = (extraPenaltyValue < 0 ? -1 : 1) * (Math.abs(extraPenaltyValue) * extraCount);
  const destroyPenalty = (destroyPenaltyValue < 0 ? -1 : 1) * (Math.abs(destroyPenaltyValue) * destroyedCount);

  const maxScore = goal?.score?.max ?? 100;
  const baseScore = goal?.score?.base ?? 0;
  const idealMatchRate = maxMatchScore > 0 ? clamp01(matchScore / maxMatchScore) : 0;
  const matchScaled = idealMatchRate * (maxScore - baseScore);
  const totalScore = matchScaled + baseScore + extraPenalty + destroyPenalty;

  return {
    score: Math.round(Math.max(goal?.score?.min ?? 0, Math.min(maxScore, totalScore))),
    breakdown: {
      baseScore,
      maxScore,
      targetMatchScore: Math.round(matchScore * 1000) / 1000,
      maxMatchScore: Math.round(maxMatchScore * 1000) / 1000,
      idealMatchRate,
      matchScaled: Math.round(matchScaled * 1000) / 1000,
      extraCount,
      destroyedCount,
      extraByPartType,
      extraPenalty,
      destroyPenalty,
      extraPenaltyValue,
      destroyPenaltyValue,
      rows: breakdownRows,
    },
  };
}

function evaluateGoalScore(goalSpec = null, placedParts = [], destroyedParts = []) {
  const targetGoal = goalSpec || activeGoal;
  if (!targetGoal) {
    return {
      score: 0,
      breakdown: {
        baseScore: 0,
        maxScore: 100,
        targetMatchScore: 0,
        maxMatchScore: 0,
        idealMatchRate: 0,
        matchScaled: 0,
        extraCount: 0,
        destroyedCount: 0,
        extraByPartType: {},
        extraPenalty: 0,
        destroyPenalty: 0,
        extraPenaltyValue: -5,
        destroyPenaltyValue: -10,
        rows: [],
      },
    };
  }

  const builtParts = (placedParts || []).filter((part) => part && part.built);
  return buildGoalRuleScore(targetGoal, builtParts, destroyedParts);
}

function getActiveGoalForUi() {
  if (!activeGoal) {
    return null;
  }
  return cloneGoal(activeGoal);
}

function getGoalStateForUi() {
  return {
    activeGoal: getActiveGoalForUi(),
    lastGoalId,
    score: goalScore,
    scoreVisible,
    breakdown: goalScoreBreakdown,
  };
}

function setGoalScoreState(scoreState) {
  const next = scoreState || {};
  if (typeof next.score === 'number') {
    goalScore = next.score;
  }
  if (typeof next.breakdown === 'object') {
    goalScoreBreakdown = next.breakdown;
  }
  if (typeof next.scoreVisible === 'boolean') {
    scoreVisible = next.scoreVisible;
  }
}

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
  facing: 1,
};

const COMMAND_LINE = {
  frontOffset: 20,
  spacing: 18,
  queueSpeed: 140,
  workSpeed: 130,
  workStartSpeechDurationMs: 2800,
  uninterpretedHintDelayMs: 5000,
  textDisplayMaxLen: 24,
};

const NPC_COMMAND_STATES = {
  QUEUED: 'queued',
  RETURN_HOME: 'returnHome',
  COMPLETED: 'completed',
};

const NPC_ACTIVITY_STATES = {
  IDLE: 'idle',
  WALK: 'walk',
};

const HOUSE_PART_LABELS = {
  wall: 'Wall',
  roof: 'Roof',
  chimney: 'Chimney',
  door: 'Door',
  column: 'Column',
  window: 'Window',
  default: 'Part',
};

const BUILD_COMMAND_RULES = [
  { re: /壁|せき|塀|かき|かけ|かぎ|wall|walls|fence/, label: 'wall/fence', partType: 'wall' },
  {
    re: /屋根|屋たて|屋根を|屋根を?作|天井|\broof\b|\broofs\b|\broofing\b/,
    label: 'roof',
    partType: 'roof',
  },
  { re: /床|床板|土台|floor|floors|foundation|base/, label: 'wall', partType: 'wall' },
  { re: /煙突|煙だ|煙突|chimney|smokestack/, label: 'chimney', partType: 'chimney' },
  { re: /門|とびら|出入口|入口|door|doors|entrance/, label: 'door', partType: 'door' },
  { re: /窓|まど|ガラス|window|windows|glass/, label: 'window', partType: 'window' },
  { re: /柱|たて|支柱|column|columns|pillar|pillars/, label: 'column', partType: 'column' },
  {
    re: /家|建築|建て|建てて|設置|置いて|置く|作って|作成|house|home|build|building|construct|create|add|place/,
    label: 'house',
  },
];

const BUILD_KEYWORDS = {
  build: ['build', 'building', 'builds', 'construct', 'constructs', 'create', 'created', 'add', 'adding', 'place', 'placed', 'make', 'made'],
  roof: ['roof', 'roofs', 'roofing'],
  wall: ['wall', 'walls', 'fence', 'fences', 'foundation', 'floor', 'floors', 'ground', 'base'],
  chimney: ['chimney', 'smokestack'],
  door: ['door', 'doors', 'entrance'],
  window: ['window', 'windows', 'glass'],
  column: ['column', 'columns', 'pillar', 'pillars'],
  house: ['house', 'home'],
};

const commandSession = {
  active: false,
  queue: [],
  cursor: 0,
};
let showCommandResults = false;
let showDebugOverlay = false;
let showTestButtons = true;
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

function createNpc(i) {
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
    state: rand() < 0.6 ? NPC_ACTIVITY_STATES.WALK : NPC_ACTIVITY_STATES.IDLE,
    color: npcPalette[i % npcPalette.length],
    cap: npcPalette[(i * 3) % npcPalette.length],
    skin: ['#ffefc3', '#f7dd9f', '#efc7ab'][i % 3],
    outfit: ['#4b90ff', '#4ccf8f', '#ff8a5c'][i % 3],
    type: npcTypes[i % npcTypes.length],
    walkPhase: 0,
    commandState: NPC_COMMAND_STATES.RETURN_HOME,
    lineSlot: -1,
    isBuildCommand: false,
    preferredPartType: null,
    preferredRoofShape: null,
    requestedBuildQuantity: 1,
    lastBuiltQuantity: 0,
    assignedBuildPartId: null,
    buildQuantity: 1,
    isListeningToPlayer: false,
    listeningStartedAt: 0,
    lastHeardText: '',
    lastInterpretation: '',
    lastInterpretationEvidence: '',
    lastInterpretationEvidenceTokens: [],
    commandTargetX: null,
    commandTargetY: null,
    workStartSpeech: '',
    workStartSpeechUntil: 0,
  };
}

const npcs = Array.from({ length: 3 }, (_, i) => createNpc(i));

// 各子供の解釈データ
const childInterpretations = npcs.map((npc) => ({
  childId: npc.id,
  heardText: '',
  interpretation: '',
  interpretationEvidence: '',
  interpretationEvidenceTokens: [],
}));

function normalizeEvidenceTokens(tokens = []) {
  const seen = new Set();
  return (Array.isArray(tokens) ? tokens : [tokens])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .reduce((acc, token) => {
      const key = token.toLowerCase();
      if (seen.has(key)) {
        return acc;
      }
      seen.add(key);
      acc.push(token);
      return acc;
    }, []);
}

// 解釈データを更新する関数
function updateChildInterpretation(childId, interpretation, options = {}) {
  const child = childInterpretations.find(c => c.childId === childId);
  if (child) {
    child.interpretation = interpretation;
    child.heardText = String(options.heardText || '');
    child.interpretationEvidence = String(options.interpretationEvidence || '');
    child.interpretationEvidenceTokens = normalizeEvidenceTokens(options.interpretationEvidenceTokens);
  }
}

let clear = false;
let message = '2D Dot Meadow';
let cameraX = 0;
let walkTime = 0;
let lastTime = performance.now();
let liveTranscriptLine = '';
let latestLiveTranscript = '';
let heroListening = false;
let heroSpeechBubbleUnlocked = false;
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
  const blueprint = getHousePartBlueprintForGoal(activeGoal);
  return blueprint.map((part, index) => ({
    id: index,
    type: part.type,
    x: part.x,
    y: part.y,
    w: part.w || 0,
    h: part.h || 0,
    colorHex: part.colorHex || null,
    ...(part.type === 'roof' ? { roofShape: part.roofShape || DEFAULT_ROOF_SHAPE } : {}),
    built: false,
    builtBy: null,
  }));
}

function getHousePartLabel(type) {
  return HOUSE_PART_LABELS[type] || HOUSE_PART_LABELS.default;
}

function resetNpcCommandState(npc) {
  npc.commandState = NPC_COMMAND_STATES.RETURN_HOME;
  npc.lineSlot = -1;
  npc.commandTargetX = null;
  npc.commandTargetY = null;
  npc.isBuildCommand = false;
  npc.preferredPartType = null;
  npc.preferredRoofShape = null;
  npc.requestedBuildQuantity = 1;
  npc.lastBuiltQuantity = 0;
  npc.assignedBuildPartId = null;
  npc.buildQuantity = 1;
  npc.lastInterpretationEvidence = '';
  npc.lastInterpretationEvidenceTokens = [];
  npc.isListeningToPlayer = false;
  npc.listeningStartedAt = 0;
  npc.workStartSpeech = '';
  npc.workStartSpeechUntil = 0;
}

function updateDebugToggleButton() {
  if (!debugToggleButton) return;
  debugToggleButton.textContent = showDebugOverlay ? 'debug info: ON' : 'debug info: OFF';
}

function updateTestButtonsToggleButton() {
  testRelatedButtons.forEach((button) => {
    if (!button) return;
    button.style.display = showTestButtons ? '' : 'none';
  });
  if (!testButtonsToggleButton) return;
  testButtonsToggleButton.textContent = showTestButtons ? 'debug button: ON' : 'debug button: OFF';
  testButtonsToggleButton.setAttribute(
    'aria-label',
    showTestButtons ? 'Hide debug test buttons' : 'Show debug test buttons'
  );
}

function toggleDebugOverlay() {
  showDebugOverlay = !showDebugOverlay;
  updateDebugToggleButton();
}

function toggleTestButtons() {
  showTestButtons = !showTestButtons;
  updateTestButtonsToggleButton();
}

function isChildSpeechEnabled() {
  return Boolean(showChildSpeech);
}

function updateChildSpeechToggleButton() {
  if (!childSpeechToggleButton) return;
  childSpeechToggleButton.textContent = isChildSpeechEnabled() ? '🔊' : '🔇';
  childSpeechToggleButton.title = isChildSpeechEnabled()
    ? 'Child Speech: ON'
    : 'Child Speech: OFF';
  childSpeechToggleButton.setAttribute('aria-label', isChildSpeechEnabled() ? 'Enable Child Speech' : 'Disable Child Speech');
}

function setChildSpeechEnabled(enabled) {
  showChildSpeech = Boolean(enabled);
  window.__ELEVENLABS_TTS_ENABLED = showChildSpeech;
  if (!showChildSpeech && typeof window.stopChildSpeech === 'function') {
    window.stopChildSpeech();
  }
  updateChildSpeechToggleButton();
}

function toggleChildSpeechOverlay() {
  setChildSpeechEnabled(!isChildSpeechEnabled());
}

window.selectRandomGoal = selectRandomGoal;
window.getActiveGoalForUi = getActiveGoalForUi;
window.getHousePartBlueprintForGoal = getHousePartBlueprintForGoal;
window.getGoalHintImagePath = getGoalHintImagePath;
window.getGoalStateForUi = getGoalStateForUi;
window.setGoalScoreState = setGoalScoreState;
window.evaluateGoalScore = evaluateGoalScore;
window.isChildSpeechEnabled = isChildSpeechEnabled;
window.setChildSpeechEnabled = setChildSpeechEnabled;
window.updateChildSpeechToggleButton = updateChildSpeechToggleButton;

if (childSpeechToggleButton) {
  childSpeechToggleButton.addEventListener('click', toggleChildSpeechOverlay);
}
