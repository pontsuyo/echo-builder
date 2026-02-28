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

function completeBuildForNpcWithQuantity(npc) {
  const quantity = npc.buildQuantity || 1;
  const completedParts = [];
  
  for (let i = 0; i < quantity; i++) {
    const part = completeBuildForNpc(npc);
    if (part) {
      completedParts.push(part);
    }
  }
  
  return completedParts.length > 0 ? completedParts : null;
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

function isBuildingCommand(text) {
  const raw = (text || '').trim();
  if (!raw) return { isBuild: false, interpretation: '聞き取れませんでした' };

  const normalized = raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[。、!！?？,、]/g, ' ')
    .replace(/[."'(){}\[\],!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = normalized.match(/[a-z0-9]+/g) || [];
  const wordSet = new Set(words);
  const hasWord = (w) => wordSet.has(w);
  const hasAnyWord = (arr) => arr.some((w) => hasWord(w));

  // 数字を認識（数字、日本語、英語の数詞をサポート）
  const numberMatch = normalized.match(/\b(\d+)\b/);
  let quantity = 1;
  if (numberMatch) {
    quantity = parseInt(numberMatch[1], 10);
  } else {
    const japaneseMatch = normalized.match(/([一二三四五六七八九十]+)/);
    if (japaneseMatch) {
      // 日本語の数字を変換
      const japaneseNumbers = {
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
      quantity = japaneseNumbers[japaneseMatch[1]] || 1;
    } else {
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
      };
      for (let i = 0; i < words.length; i += 1) {
        const token = words[i];
        const hit = Object.entries(englishNumberWords).find(([word]) => token === word || token.startsWith(word));
        if (hit) {
          quantity = hit[1];
          break;
        }
      }
    }
  }

  for (const rule of BUILD_COMMAND_RULES) {
    if (rule.re.test(normalized)) {
      const quantityText = quantity > 1 ? ` ${quantity}つ` : '';
      return {
        isBuild: true,
        interpretation: `建築指示: ${rule.label}${quantityText}`,
        preferredPartType: rule.partType || null,
        quantity,
      };
    }
  }

  const hasBuildVerb = hasAnyWord(BUILD_KEYWORDS.build);
  const hasRoof = hasAnyWord(BUILD_KEYWORDS.roof);
  const hasWall = hasAnyWord(BUILD_KEYWORDS.wall);
  const hasChimney = hasAnyWord(BUILD_KEYWORDS.chimney);
  const hasDoor = hasAnyWord(BUILD_KEYWORDS.door);
  const hasWindow = hasAnyWord(BUILD_KEYWORDS.window);
  const hasHouse = hasAnyWord(BUILD_KEYWORDS.house);

  if (hasBuildVerb) {
    const quantityText = quantity > 1 ? ` ${quantity}つ` : '';
    if (hasRoof) {
      return { isBuild: true, interpretation: `建築指示: 屋根${quantityText}`, preferredPartType: 'roof', quantity };
    }
    if (hasWall) {
      return { isBuild: true, interpretation: `建築指示: 壁/塀${quantityText}`, preferredPartType: 'wall', quantity };
    }
    if (hasChimney) {
      return { isBuild: true, interpretation: `建築指示: 煙突${quantityText}`, preferredPartType: 'chimney', quantity };
    }
    if (hasDoor) {
      return { isBuild: true, interpretation: `建築指示: 門${quantityText}`, preferredPartType: 'door', quantity };
    }
    if (hasWindow) {
      return { isBuild: true, interpretation: `建築指示: 窓${quantityText}`, preferredPartType: 'window', quantity };
    }
    if (hasHouse) {
      return { isBuild: true, interpretation: `建築全般${quantityText}`, preferredPartType: null, quantity };
    }

    return { isBuild: true, interpretation: `建築指示として判定しました${quantity > 1 ? ` (${quantity}つ)` : ''}`, preferredPartType: null, quantity };
  }

  return { isBuild: false, interpretation: '建築指示として判定できませんでした' };
}

function appendCommandResultToLog(child) {
  const entry = {
    childId: child.id,
    heard: child.lastHeardText || '',
    interpreted: child.lastInterpretation || '',
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

function startCommandLineup() {
  if (commandSession.active) {
    addMessage('すでに作業中です。');
    return;
  }

  resetCommandResultLog();
  const ordered = getFrontOrderedNpcs();
  if (!ordered.length) {
    addMessage('子供が見つかりません。');
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
    ordered[i].buildQuantity = 1;
  }

  updateCommandButtons();
  addMessage('作業を開始します。');
}

function receiveHeroCommand(text) {
  const spoken = (text || '').trim();
  if (!spoken) return;

  if (!commandSession.active) {
    addMessage('作業が開始されていません。');
    return;
  }

  const targetNpc = commandSession.queue[commandSession.cursor];
  if (!targetNpc) {
    commandSession.active = false;
    addMessage('すでに作業の割当は完了しています。');
    return;
  }

  const parsed = isBuildingCommand(spoken);
  targetNpc.lastHeardText = spoken;
  targetNpc.lastInterpretation = parsed.interpretation;
  targetNpc.isBuildCommand = parsed.isBuild;
  targetNpc.assignedBuildPartId = null;
  targetNpc.buildQuantity = parsed.quantity || 1;
  if (parsed.isBuild) {
    targetNpc.assignedBuildPartId = buildClosestHousePartForNpc(targetNpc, parsed.preferredPartType);
    targetNpc.commandMarkUntil = performance.now() + COMMAND_LINE.markDisplayMs;
  }
  // 家の横に立つ位置を計算（家の左側にNPCが並ぶ）
  targetNpc.commandTargetX = home.x - 50 - (targetNpc.id * 30);
  targetNpc.commandTargetY = FLOOR_Y - targetNpc.h;

  if (parsed.isBuild) {
    if (targetNpc.assignedBuildPartId == null) {
      targetNpc.isBuildCommand = false;
    }
  }
  targetNpc.commandMarkUntil = targetNpc.isBuildCommand ? targetNpc.commandMarkUntil : 0;
  targetNpc.commandState = NPC_COMMAND_STATES.RETURN_HOME;
  targetNpc.lineSlot = -1;

  appendCommandResultToLog(targetNpc);
  const wasFirstBuilder = commandSession.cursor === 0 && targetNpc.isBuildCommand;
  commandSession.cursor += 1;
  if (commandSession.cursor >= commandSession.queue.length) {
    allOrdersReceived = true;
    commandSession.active = false;
    addMessage(`作業完了: ${targetNpc.id} が最後の子です。`);
  } else {
    const next = commandSession.queue[commandSession.cursor];
    addMessage(`子${targetNpc.id} が作業を受理。次は子${next.id}`);
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
  if (npc.commandState !== NPC_COMMAND_STATES.RETURN_HOME) return;
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
      quantity: rowsById.get(npc.id)?.quantity || 1,
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
    const quantityText = item.quantity > 1 ? ` / 個数: ${item.quantity}つ` : '';
    const lineText = `子${item.childId}: 聞取="${truncateText(
      item.heard,
      COMMAND_LINE.textDisplayMaxLen
    )}" / 解釈="${truncateText(item.interpreted, COMMAND_LINE.textDisplayMaxLen)}"${quantityText}`;
    ctx.fillText(lineText, x + 6, y + 30 + i * rowHeight);
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
  updateCommandButtons();
}

function toggleCommandResultPanel() {
  showCommandResults = !showCommandResults;
  updateCommandButtons();
  addMessage(showCommandResults ? '結果表示: ON' : '結果表示: OFF');
}
