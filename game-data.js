const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const resultToggleButton = document.getElementById('toggle-command-result');

const W = canvas.width;
const H = canvas.height;

const WORLD_W = 3200;
const FLOOR_Y = 250;
const HOUSE_REVEAL_SPEED = 1040;
const HOUSE_REVEAL_TARGET_OFFSET = 0.30;

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

const HOUSE_ROOF_SHAPES = ['round', 'triangle', 'flat'];
const DEFAULT_ROOF_SHAPE = 'triangle';

const home = {
  x: 1550,
  w: 110,
  h: 68,
};

const HOUSE_PART_BLUEPRINT = [
  { type: 'wall', x: 0, y: 0, w: 110, h: 68 },
  { type: 'roof', x: -4, y: -4, roofShape: 'triangle' },
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
  facing: 1,
};

const COMMAND_LINE = {
  frontOffset: 20,
  spacing: 18,
  queueSpeed: 140,
  workSpeed: 130,
  markDisplayMs: 1800,
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
  wall: '壁',
  roof: '屋根',
  chimney: '煙突',
  door: '扉',
  window: '窓',
  default: '部品',
};

const BUILD_COMMAND_RULES = [
  { re: /壁|せき|塀|かき|かけ|かぎ|wall|walls|fence/, label: '壁/塀', partType: 'wall' },
  {
    re: /屋根|屋たて|屋根を|屋根を?作|天井|\broof\b|\broofs\b|\broofing\b/,
    label: '屋根',
    partType: 'roof',
  },
  { re: /床|床板|土台|floor|floors|foundation|base/, label: '床', partType: 'wall' },
  { re: /煙突|煙だ|煙突|chimney|smokestack/, label: '煙突', partType: 'chimney' },
  { re: /門|とびら|出入口|入口|door|doors|entrance/, label: '門', partType: 'door' },
  { re: /窓|まど|ガラス|window|windows|glass/, label: '窓', partType: 'window' },
  { re: /柱|たて|支柱|column|columns|pillar|pillars/, label: '柱', partType: 'wall' },
  {
    re: /家|建築|建て|建てて|設置|置いて|置く|作って|作成|house|home|build|building|construct|create|add|place/,
    label: '建築全般',
  },
];

const BUILD_KEYWORDS = {
  build: ['build', 'building', 'builds', 'construct', 'constructs', 'create', 'created', 'add', 'adding', 'place', 'placed', 'make', 'made'],
  roof: ['roof', 'roofs', 'roofing'],
  wall: ['wall', 'walls', 'fence', 'fences', 'foundation', 'floor', 'floors', 'ground', 'base'],
  chimney: ['chimney', 'smokestack'],
  door: ['door', 'doors', 'entrance'],
  window: ['window', 'windows', 'glass'],
  house: ['house', 'home'],
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
    commandMarkUntil: 0,
    isBuildCommand: false,
    preferredPartType: null,
    preferredRoofShape: null,
    requestedBuildQuantity: 1,
    lastBuiltQuantity: 0,
    assignedBuildPartId: null,
    buildQuantity: 1,
    isListeningToPlayer: false,
    lastHeardText: '',
    lastInterpretation: '',
    commandTargetX: null,
  };
}

const npcs = Array.from({ length: 2 }, (_, i) => createNpc(i));

// 各子供の解釈データ
const childInterpretations = [
  { childId: 0, interpretation: "" },
  { childId: 1, interpretation: "" }
];

// 解釈データを更新する関数
function updateChildInterpretation(childId, interpretation) {
  const child = childInterpretations.find(c => c.childId === childId);
  if (child) {
    child.interpretation = interpretation;
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
  npc.commandMarkUntil = 0;
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
  npc.isListeningToPlayer = false;
}
