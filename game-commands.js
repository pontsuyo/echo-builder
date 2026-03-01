function resetHouseBuildProgress() {
  houseParts = createHouseParts();
  houseRevealActive = false;
  houseRevealDone = false;
  allOrdersReceived = false;
}

function getHousePartAbsoluteX(part) {
  return home.x + part.x;
}

function createHousePartFromTemplate(template, options = {}) {
  return {
    id: houseParts.length,
    type: template.type,
    x: options.x !== undefined ? options.x : template.x,
    y: options.y !== undefined ? options.y : template.y,
    w: options.w !== undefined ? options.w : (template.w || 0),
    h: options.h !== undefined ? options.h : (template.h || 0),
    colorHex: template.colorHex || null,
    ...(template.type === 'roof'
      ? {
          roofShape:
            options.roofShape !== undefined ? options.roofShape : (template.roofShape || DEFAULT_ROOF_SHAPE),
        }
      : {}),
    built: false,
    builtBy: null,
    isDynamic: true,
  };
}

function getHousePartTemplateByType(type) {
  const blueprint = typeof getHousePartBlueprintForGoal === 'function'
    ? getHousePartBlueprintForGoal(activeGoal)
    : HOUSE_PART_BLUEPRINT;
  return blueprint.find((part) => part.type === type);
}

function createExtraWindowPart() {
  const template =
    getHousePartTemplateByType('window')
    || HOUSE_PART_BLUEPRINT_DEFAULT.find((part) => part.type === 'window')
    || {
      type: 'window',
      x: 12,
      y: 22,
      w: 12,
      h: 10,
      colorHex: palette.houseWindow || '#fdf8b8',
    };
  if (!template) {
    return null;
  }

  const width = template.w || 12;
  const y = template.y;
  const startX = 8;
  const margin = 2;
  const maxX = Math.max(startX, home.w - width - margin);

  const existing = houseParts
    .filter((part) => part.type === 'window')
    .map((part) => ({ x: part.x, w: part.w || width }));

  for (let x = startX; x <= maxX; x += width + 2) {
    const collides = existing.some(({ x: ex, w: ew }) => !(x + width <= ex || ex + ew <= x));
    if (!collides) {
      const part = createHousePartFromTemplate(template, { x, y });
      houseParts.push(part);
      return part;
    }
  }

  const fallbackX = Math.min(maxX, startX + Math.max(1, existing.length) * (width + 2));
  const part = createHousePartFromTemplate(template, { x: fallbackX, y });
  houseParts.push(part);
  return part;
}

function maybeCreateClosestCandidate(type, requestedRoofShape = null) {
  if (!type) {
    return null;
  }

  if (type === 'window') {
    return createExtraWindowPart();
  }

  const template = getHousePartTemplateByType(type);
  if (!template) {
    return null;
  }

  const roofShape = type === 'roof' ? (requestedRoofShape || DEFAULT_ROOF_SHAPE) : undefined;

  const part = createHousePartFromTemplate(template, {
    x: template.x,
    y: template.y,
    w: template.w || 0,
    h: template.h || 0,
    ...(roofShape ? { roofShape } : {}),
  });
  houseParts.push(part);
  return part;
}

function buildClosestHousePartForNpc(npc, preferredType, requestedRoofShape = null) {
  const unbuilt = houseParts.filter(
    (part) => !part.built && (part.assignedTo == null || part.assignedTo === npc.id)
  );
  if (!unbuilt.length) {
    if (!preferredType) {
      return null;
    }

    const extraPart = maybeCreateClosestCandidate(preferredType, requestedRoofShape);
    if (!extraPart) {
      return null;
    }

    extraPart.assignedTo = npc.id;
    return extraPart.id;
  }

  let candidates = unbuilt;
  if (preferredType) {
    const filtered = unbuilt.filter((part) => part.type === preferredType);
    if (filtered.length) {
      candidates = filtered;
    } else {
      const extraPart = maybeCreateClosestCandidate(preferredType, requestedRoofShape);
      if (extraPart) {
        extraPart.assignedTo = npc.id;
        return extraPart.id;
      }
      return null;
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

  if (requestedRoofShape && picked.type === 'roof') {
    picked.roofShape = requestedRoofShape;
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
  part.assignedTo = null;
  npc.assignedBuildPartId = null;
  return part;
}

function completeBuildForNpcWithQuantity(npc, preferredPartType = null, preferredRoofShape = null) {
  const requestedQuantity = Math.max(1, npc.buildQuantity || 1);
  const resolvedPreferredPartType = preferredPartType || npc.preferredPartType || null;
  const completedParts = [];

  for (let i = 0; i < requestedQuantity; i += 1) {
    if (npc.assignedBuildPartId === null) {
      npc.assignedBuildPartId = buildClosestHousePartForNpc(
        npc,
        resolvedPreferredPartType,
        preferredRoofShape
      );
    }

    const part = completeBuildForNpc(npc);
    if (part) {
      completedParts.push(part);
    } else {
      break;
    }
  }
  
  npc.lastBuiltQuantity = completedParts.length;
  return completedParts.length > 0 ? completedParts : null;
}

function getRequestedRoofShape(text) {
  if (!text) {
    return null;
  }

  if (/\b(round|dome|domed)\b|丸|丸い|ドーム/.test(text)) {
    return 'round';
  }
  if (/\b(gable|gabled|pitched)\b|切妻|切妻屋根/.test(text)) {
    return 'gable';
  }
  if (/\b(hip|hipped|hipped roof)\b|寄棟|寄棟屋根|片屋根/.test(text)) {
    return 'hip';
  }
  if (/\b(flat|flat-roof)\b|平|平ら|平らな屋根/.test(text)) {
    return 'flat';
  }
  if (/\b(triangle|triangular)\b|三角|三角屋根|三角形/.test(text)) {
    return 'triangle';
  }
  if (/\b(shed|lean-to|single-pitch)\b|片流れ|片流し|片側屋根/.test(text)) {
    return 'shed';
  }

  return null;
}

function getRoofShapeDisplayLabel(roofShape) {
  const normalized = String(roofShape || '').trim();
  if (!normalized) {
    return '';
  }
  if (normalized === 'round') {
    return 'round';
  }
  if (normalized === 'flat') {
    return 'flat';
  }
  if (normalized === 'triangle') {
    return 'triangle';
  }
  if (normalized === 'gable') {
    return 'gable';
  }
  if (normalized === 'hip') {
    return 'hip';
  }
  if (normalized === 'shed') {
    return 'shed';
  }
  return normalized;
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

function setHeroListening(active) {
  heroListening = Boolean(active);
  if (heroListening) {
    unlockHeroSpeechBubble();
  }
}

function unlockHeroSpeechBubble() {
  heroSpeechBubbleUnlocked = true;
}

window.unlockHeroSpeechBubble = unlockHeroSpeechBubble;

function isCommandSessionCompleted() {
  return (
    commandSession.cursor >= commandSession.queue.length
    && commandSession.queue.length > 0
    && !commandSession.active
    && allOrdersReceived
  );
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
  resultToggleButton.textContent = `command log: ${showCommandResults ? 'ON' : 'OFF'}`;
}

function ensureResultText(value, fallback = 'Not received') {
  const text = String(value || '').trim();
  return text || fallback;
}

function ensureResultTokens(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((token) => String(token || '').trim())
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
  
  const ordered = front.concat(back);
  
  return ordered;
}

function getCommandLineX(slot) {
  const direction = player.facing >= 0 ? 1 : -1;
  return clamp(
    player.x + direction * (COMMAND_LINE.frontOffset + slot * COMMAND_LINE.spacing),
    20,
    WORLD_W - 20
  );
}

function getEnglishLabel(japaneseLabel) {
  const labelMap = {
    'wall/fence': 'wall',
    wall: 'wall',
    roof: 'roof',
    chimney: 'chimney',
    door: 'door',
    column: 'column',
    window: 'window',
    floor: 'wall',
    house: 'house',
  };
  return labelMap[japaneseLabel] || japaneseLabel;
}

function getSpeechPartLabel(partType) {
  const map = {
    wall: 'walls',
    roof: 'roof',
    chimney: 'chimneys',
    door: 'doors',
    column: 'columns',
    window: 'windows',
  };
  return map[partType] || 'parts';
}

function getCommandQuantityFromText(text, words = []) {
  const normalized = normalizeForCommandMatch(text);
  const englishNumberWords = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
  };
  const japaneseNumberByChar = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  let quantity = 1;
  let quantityToken = '';
  const candidateWords = Array.isArray(words) && words.length ? words : [];

  const allTokens = candidateWords.length ? candidateWords : (normalized.match(/[a-z0-9一二三四五六七八九十]+/g) || []);
  for (let i = 0; i < allTokens.length; i += 1) {
    const token = String(allTokens[i]).trim();
    if (!token) continue;
    const digits = token.match(/^\d+$/);
    if (digits) {
      quantity = parseInt(digits[0], 10);
      quantityToken = digits[0];
      break;
    }

    const exactMatch = Object.entries(englishNumberWords).find(([label]) => token === label || token.startsWith(label));
    if (exactMatch) {
      quantity = exactMatch[1];
      quantityToken = exactMatch[0];
      break;
    }

    const japaneseMatch = token.match(/[一二三四五六七八九十]/);
    if (japaneseMatch) {
      const next = japaneseNumberByChar[japaneseMatch[0]];
      if (Number.isFinite(next)) {
        quantity = next;
        quantityToken = japaneseMatch[0];
        break;
      }
    }
  }

  return { quantity, quantityToken };
}

function normalizeForCommandMatch(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[。、!！?？,、]/g, ' ')
    .replace(/[."'(){}\[\],!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectEvidenceTokens(text, candidates = []) {
  const normalizedSource = normalizeForCommandMatch(text);
  const seen = new Set();
  const results = [];

  for (const candidate of candidates) {
    const rawToken = String(candidate || '').trim();
    if (!rawToken) continue;

    const normalizedToken = normalizeForCommandMatch(rawToken);
    if (!normalizedToken) continue;

    if (!normalizedSource.includes(normalizedToken)) {
      continue;
    }

    const key = normalizedToken;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(rawToken);
  }

  return results;
}

function extractColorCue(text) {
  const raw = String(text || '').toLowerCase();
  if (!raw) return '';

  const candidates = [
    { label: 'red', re: /赤|red/ },
    { label: 'blue', re: /青|blue/ },
    { label: 'yellow', re: /黄|黄色|yellow/ },
    { label: 'green', re: /緑|green/ },
    { label: 'white', re: /白|white/ },
    { label: 'black', re: /黒|black/ },
  ];

  const hit = candidates.find((candidate) => candidate.re.test(raw));
  return hit ? hit.label : '';
}

function createWorkStartSpeech(spokenText, parsed) {
  const quantity = Math.max(1, Number(parsed && parsed.quantity) || 1);
  const preferredType = parsed && parsed.preferredPartType;
  const roofShape = parsed && parsed.roofShape;
  const colorCue = extractColorCue(spokenText);

  if (colorCue) {
    return `${colorCue}... so that's it!`;
  }

  if (preferredType === 'roof' && roofShape) {
    const roofShapeLabel = getRoofShapeDisplayLabel(roofShape);
    return `${roofShapeLabel} roof... got it!`;
  }

  if (preferredType) {
    const label = getSpeechPartLabel(preferredType);
    if (quantity >= 3) {
      return `So I should add a lot of ${label}, right?`;
    }
    if (quantity > 1) {
      return `${quantity} ${label}... right!`;
    }
    return `${label}, right!`;
  }

  if (parsed && parsed.isBuild) {
    if (quantity >= 3) {
      return 'So I should add a lot, right?';
    }
    if (quantity > 1) {
      return `${quantity} pieces... right!`;
    }
    return 'Okay, I should build it!';
  }

  return 'Hmm... maybe like this?';
}

function setListeningNpc(nextNpc) {
  for (const npc of npcs) {
    npc.isListeningToPlayer = false;
    npc.listeningStartedAt = 0;
  }
  if (!nextNpc) {
    return;
  }
  nextNpc.isListeningToPlayer = true;
  nextNpc.listeningStartedAt = performance.now();
}

function isBuildingCommand(text) {
  const raw = (text || '').trim();
  if (!raw) {
    return {
      isBuild: false,
      interpretation: "I don't know what you said.",
      interpretationEvidence: '',
      interpretationEvidenceTokens: [],
    };
  }

  const normalized = normalizeForCommandMatch(raw);
  const words = normalized.match(/[a-z0-9]+/g) || [];
  const wordSet = new Set(words);
  const hasWord = (w) => wordSet.has(w);
  const hasAnyWord = (arr) => arr.some((w) => hasWord(w));
  const requestedRoofShape = getRequestedRoofShape(normalized);
  let interpretationEvidenceTokens = [];
  let interpretationEvidence = '';
  const {
    quantity,
    quantityToken,
  } = getCommandQuantityFromText(raw, words);
  const quantityEvidenceToken = quantityToken || String(quantity);

  for (const rule of BUILD_COMMAND_RULES) {
    const match = normalized.match(rule.re);
    if (match) {
      interpretationEvidenceTokens = collectEvidenceTokens(
        raw,
        [match[0], rule.label, rule.partType, String(quantityEvidenceToken)]
      );
      interpretationEvidence = interpretationEvidenceTokens.join(' / ');
      const quantityText = quantity > 1 ? ` ${quantity} times` : '';
      const englishLabel = getEnglishLabel(rule.label);
      const roofShapeText = rule.partType === 'roof' && requestedRoofShape
        ? ` ${getRoofShapeDisplayLabel(requestedRoofShape)}`
        : '';
      return {
        isBuild: true,
        interpretation: `I added ${englishLabel}${roofShapeText}${quantityText}!`,
        preferredPartType: rule.partType || null,
        roofShape: rule.partType === 'roof' ? requestedRoofShape : null,
        quantity,
        interpretationEvidence,
        interpretationEvidenceTokens,
      };
    }
  }

  const hasBuildVerb = hasAnyWord(BUILD_KEYWORDS.build);
  const hasRoof = hasAnyWord(BUILD_KEYWORDS.roof);
  const hasWall = hasAnyWord(BUILD_KEYWORDS.wall);
  const hasChimney = hasAnyWord(BUILD_KEYWORDS.chimney);
  const hasDoor = hasAnyWord(BUILD_KEYWORDS.door);
  const hasWindow = hasAnyWord(BUILD_KEYWORDS.window);
  const hasColumn = hasAnyWord(BUILD_KEYWORDS.column);
  const hasHouse = hasAnyWord(BUILD_KEYWORDS.house);

  if (hasBuildVerb) {
    const quantityText = quantity > 1 ? ` ${quantity} times` : '';
    if (hasRoof) {
      interpretationEvidenceTokens = collectEvidenceTokens(
        raw,
        ['roof', 'roofs', 'roofing', quantityEvidenceToken]
      );
      interpretationEvidence = interpretationEvidenceTokens.join(' / ');
      const roofShape = requestedRoofShape;
      const shapeText = roofShape ? ` ${getRoofShapeDisplayLabel(roofShape)}` : '';
      return {
        isBuild: true,
        interpretation: `I added a roof${shapeText}${quantityText}!`,
        preferredPartType: 'roof',
        roofShape,
        quantity,
        interpretationEvidence,
        interpretationEvidenceTokens,
      };
    }
    if (hasWall) {
      interpretationEvidenceTokens = collectEvidenceTokens(
        raw,
        ['wall', 'walls', 'floor', 'floors', 'foundation', 'base', quantityEvidenceToken]
      );
      interpretationEvidence = interpretationEvidenceTokens.join(' / ');
      return {
        isBuild: true,
        interpretation: `I added a wall${quantityText}!`,
        preferredPartType: 'wall',
        quantity,
        interpretationEvidence,
        interpretationEvidenceTokens,
      };
    }
    if (hasChimney) {
      interpretationEvidenceTokens = collectEvidenceTokens(
        raw,
        ['chimney', 'smokestack', quantityEvidenceToken]
      );
      interpretationEvidence = interpretationEvidenceTokens.join(' / ');
      return {
        isBuild: true,
        interpretation: `I added a chimney${quantityText}!`,
        preferredPartType: 'chimney',
        quantity,
        interpretationEvidence,
        interpretationEvidenceTokens,
      };
    }
    if (hasDoor) {
      interpretationEvidenceTokens = collectEvidenceTokens(
        raw,
        ['door', 'doors', 'entrance', quantityEvidenceToken]
      );
      interpretationEvidence = interpretationEvidenceTokens.join(' / ');
      return {
        isBuild: true,
        interpretation: `I added a door${quantityText}!`,
        preferredPartType: 'door',
        quantity,
        interpretationEvidence,
        interpretationEvidenceTokens,
      };
    }
    if (hasColumn) {
      interpretationEvidenceTokens = collectEvidenceTokens(
        raw,
        ['column', 'columns', 'pillar', 'pillars', quantityEvidenceToken]
      );
      interpretationEvidence = interpretationEvidenceTokens.join(' / ');
      return {
        isBuild: true,
        interpretation: `I added a column${quantityText}!`,
        preferredPartType: 'column',
        quantity,
        interpretationEvidence,
        interpretationEvidenceTokens,
      };
    }
    if (hasWindow) {
      interpretationEvidenceTokens = collectEvidenceTokens(
        raw,
        ['window', 'windows', 'glass', quantityEvidenceToken]
      );
      interpretationEvidence = interpretationEvidenceTokens.join(' / ');
      return {
        isBuild: true,
        interpretation: `I added a window${quantityText}!`,
        preferredPartType: 'window',
        quantity,
        interpretationEvidence,
        interpretationEvidenceTokens,
      };
    }
    if (hasHouse) {
      interpretationEvidenceTokens = collectEvidenceTokens(
        raw,
        ['house', 'home', quantityEvidenceToken]
      );
      interpretationEvidence = interpretationEvidenceTokens.join(' / ');
      return {
        isBuild: true,
        interpretation: `I built a house${quantityText}!`,
        preferredPartType: null,
        quantity,
        interpretationEvidence,
        interpretationEvidenceTokens,
      };
    }

    interpretationEvidenceTokens = collectEvidenceTokens(raw, [...BUILD_KEYWORDS.build, quantityEvidenceToken]);
    interpretationEvidence = interpretationEvidenceTokens.join(' / ');
    return {
      isBuild: true,
      interpretation: `Treated as a build command${quantity > 1 ? ` (${quantity})` : ''}.`,
      preferredPartType: null,
      quantity,
      interpretationEvidence,
      interpretationEvidenceTokens,
    };
  }

  return {
    isBuild: false,
    interpretation: "I didn't get that!",
    interpretationEvidence: '',
    interpretationEvidenceTokens: [],
  };
}

function appendCommandResultToLog(child) {
  const entry = {
    childId: child.id,
    heard: child.lastHeardText || '',
    interpreted: child.lastInterpretation || '',
    interpretationEvidence: child.lastInterpretationEvidence || '',
    interpretationEvidenceTokens: normalizeEvidenceTokens(child.lastInterpretationEvidenceTokens || []),
    quantity: child.buildQuantity || 1,
  };
  const idx = commandResultRows.findIndex((r) => r.childId === entry.childId);
  if (idx >= 0) {
    commandResultRows[idx] = entry;
  } else {
    commandResultRows.push(entry);
  }
  commandResultRows = commandResultRows.sort((a, b) => a.childId - b.childId);
}

function startCommandLineup(options = {}) {
  const { silentIfActive = false } = options || {};
  const completed = isCommandSessionCompleted();

  if (commandSession.active || completed) {
    if (!silentIfActive) {
      addMessage(commandSession.active ? 'Already working.' : 'All tasks are already complete.');
    }
    return;
  }

  resetCommandResultLog();
  const ordered = getFrontOrderedNpcs();
  if (!ordered.length) {
    addMessage('No child available.');
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
    resetNpcCommandState(npc);
    npc.commandState = NPC_COMMAND_STATES.QUEUED;
  }

  for (let i = 0; i < ordered.length; i += 1) {
    ordered[i].lineSlot = i;
    ordered[i].lastHeardText = '';
    ordered[i].lastInterpretation = '';
    ordered[i].lastInterpretationEvidence = '';
    ordered[i].lastInterpretationEvidenceTokens = [];
    ordered[i].buildQuantity = 1;
    ordered[i].preferredRoofShape = null;
  }

  const firstQueued = ordered[0] || null;
  setListeningNpc(firstQueued);

  updateCommandButtons();
  addMessage('Commanding start.');
  
  // 先頭の子供を点滅させる
  if (typeof window.startBlinking === 'function') {
    if (firstQueued) {
      window.startBlinking(firstQueued.id);
    }
  }
}

function receiveHeroCommand(text) {
  const spoken = (text || '').trim();
  if (!spoken) return;

  if (isCommandSessionCompleted()) {
    addMessage('All tasks are already complete.');
    return;
  }

  if (!commandSession.active) {
    addMessage('Commanding is not started yet.');
    return;
  }

  const targetNpc = commandSession.queue[commandSession.cursor];
  if (!targetNpc) {
    commandSession.active = false;
    addMessage('Task assignment is already done.');
    return;
  }

  setListeningNpc(null);

  const parsed = isBuildingCommand(spoken);
  targetNpc.lastHeardText = spoken;
  targetNpc.lastInterpretation = parsed.interpretation;
  targetNpc.lastInterpretationEvidence = parsed.interpretationEvidence || '';
  targetNpc.lastInterpretationEvidenceTokens = Array.isArray(parsed.interpretationEvidenceTokens)
    ? parsed.interpretationEvidenceTokens
    : [];
  targetNpc.isBuildCommand = parsed.isBuild;
  targetNpc.preferredPartType = parsed.preferredPartType || null;
  targetNpc.preferredRoofShape = parsed.preferredPartType === 'roof' ? (parsed.roofShape || null) : null;
  targetNpc.buildQuantity = parsed.quantity || 1;
  targetNpc.requestedBuildQuantity = targetNpc.buildQuantity;
  targetNpc.lastBuiltQuantity = 0;
  if (parsed.isBuild) {
    targetNpc.assignedBuildPartId = buildClosestHousePartForNpc(
      targetNpc,
      parsed.preferredPartType,
      targetNpc.preferredRoofShape
    );
    if (targetNpc.assignedBuildPartId === null) {
      targetNpc.isBuildCommand = false;
    }
  }
  // 家の横に立つ位置を計算（家の左側にNPCが並ぶ）
  targetNpc.commandTargetX = home.x - 50 - (targetNpc.id * 30);
  targetNpc.commandTargetY = FLOOR_Y - targetNpc.h;
  targetNpc.commandState = NPC_COMMAND_STATES.RETURN_HOME;
  targetNpc.lineSlot = -1;
  targetNpc.workStartSpeech = createWorkStartSpeech(spoken, parsed);
  targetNpc.workStartSpeechUntil = performance.now() + Number(COMMAND_LINE.workStartSpeechDurationMs || 2800);

  if (typeof window.playChildSpeech === 'function') {
    window.playChildSpeech(targetNpc.workStartSpeech, {
      childId: targetNpc.id,
      context: 'command',
    });
  }

  // 解釈データを更新（英語で表記）
  if (targetNpc.lastInterpretation) {
    updateChildInterpretation(targetNpc.id, targetNpc.lastInterpretation, {
      heardText: targetNpc.lastHeardText,
      interpretationEvidence: targetNpc.lastInterpretationEvidence,
      interpretationEvidenceTokens: targetNpc.lastInterpretationEvidenceTokens,
    });
  }
  
  appendCommandResultToLog(targetNpc);
  const wasFirstBuilder = commandSession.cursor === 0 && targetNpc.isBuildCommand;
  const currentCursor = commandSession.cursor;
  commandSession.cursor += 1;
  if (commandSession.cursor >= commandSession.queue.length) {
    allOrdersReceived = true;
    commandSession.active = false;
    addMessage(`Work complete: Child ${targetNpc.id} is the last one.`);
    
    // 点滅を停止
      if (typeof stopBlinking === 'function') {
        stopBlinking();
      }
      setListeningNpc(null);
  } else {
    const nextQueued = commandSession.queue[commandSession.cursor] || null;
    setListeningNpc(nextQueued);
    if (typeof window.startBlinking === 'function') {
      if (nextQueued) {
        window.startBlinking(nextQueued.id);
      }
    }

    const next = commandSession.queue[commandSession.cursor];
    addMessage(`Child ${targetNpc.id} accepted the task. Next is Child ${next.id}.`);
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
  npc.dir = dx >= 0 ? 1 : -1;
  const step = Math.min(1, (speed * dt) / Math.max(1, distance));
  npc.x += dx * step;
  return step >= 1;
}

function getCommandResultRows() {
  const rowsById = new Map(
    commandResultRows.map((row) => [
      row.childId,
      {
        heard: ensureResultText(row.heard),
        interpreted: ensureResultText(row.interpreted),
        interpretationEvidence: ensureResultText(row.interpretationEvidence),
        interpretationEvidenceTokens: ensureResultTokens(row.interpretationEvidenceTokens),
        quantity: row.quantity || 1,
      },
    ])
  );

  return [...npcs]
    .sort((a, b) => a.id - b.id)
    .map((npc) => ({
      childId: npc.id,
      heard: ensureResultText(rowsById.get(npc.id)?.heard),
      interpreted: ensureResultText(rowsById.get(npc.id)?.interpreted),
      interpretationEvidence: ensureResultText(rowsById.get(npc.id)?.interpretationEvidence),
      interpretationEvidenceTokens: ensureResultTokens(rowsById.get(npc.id)?.interpretationEvidenceTokens),
      quantity: rowsById.get(npc.id)?.quantity || 1,
    }));
}

function drawCommandResultPanel() {
  if (!showDebugOverlay || !showCommandResults) return;

  const x = 8;
  const y = 72;
  const rowHeight = 16;
  const lines = getCommandResultRows();

  const contentLines = Math.max(1, lines.length * 3 + 1);
  const panelHeight = Math.min(320, 10 + contentLines * rowHeight + 8);

  ctx.fillStyle = 'rgba(5, 12, 18, 0.86)';
  ctx.fillRect(x, y, Math.min(W - 16, 620), panelHeight);
  ctx.strokeStyle = '#e9f2ff';
  ctx.strokeRect(x + 0.5, y + 0.5, Math.min(W - 17, 620) - 1, panelHeight - 1);

  ctx.fillStyle = '#f1f6ff';
  ctx.font = '10px "Courier New", monospace';
  ctx.fillText('Command Result', x + 6, y + 16);

  let rowY = y + 30;

  for (const item of lines) {
    const interpretationTokens = item.interpretationEvidenceTokens || [];
    const evidence = interpretationTokens.length
      ? interpretationTokens.join(', ')
      : item.interpretationEvidence;
    const interpreted = `${item.interpreted}${item.quantity > 1 ? ` / Count:${item.quantity}` : ''}`;
    const hasHeard = String(item.heard || '').trim() && String(item.heard).trim() !== 'Not received';

    ctx.fillText(`Child ${item.childId}`, x + 6, rowY);
    rowY += rowHeight;
    ctx.fillText(`  Heard: ${truncateText(item.heard, COMMAND_LINE.textDisplayMaxLen)}`, x + 6, rowY);
    rowY += rowHeight;
    if (!hasHeard && evidence) {
      ctx.fillText(`  Evidence: ${truncateText(evidence, COMMAND_LINE.textDisplayMaxLen)}`, x + 6, rowY);
      rowY += rowHeight;
    }
    ctx.fillText(`  Interpretation: ${truncateText(interpreted, COMMAND_LINE.textDisplayMaxLen)}`, x + 6, rowY);
    rowY += rowHeight;
  }
}

function resetNpcCommandStates() {
  for (const npc of npcs) {
    resetNpcCommandState(npc);
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
  if (typeof childInterpretations !== 'undefined') {
    for (const child of childInterpretations) {
      child.heardText = '';
      child.interpretation = '';
      child.interpretationEvidence = '';
      child.interpretationEvidenceTokens = [];
    }
  }
  if (typeof npcs !== 'undefined') {
    for (const npc of npcs) {
      if (!npc) continue;
      npc.lastInterpretationEvidenceTokens = [];
      if (npc.lastInterpretationEvidence) npc.lastInterpretationEvidence = '';
    }
  }
  updateCommandButtons();
}

function toggleCommandResultPanel() {
  showCommandResults = !showCommandResults;
  updateCommandButtons();
  addMessage(showCommandResults ? 'Command Log: ON' : 'Command Log: OFF');
}
