function resetGame() {
  clear = false;
  addMessage('2D Dot Meadow - リトライ可能');
  resetPlayer();
  selectRandomGoal(Date.now());
  heroSpeechBubbleUnlocked = false;
  resetHouseBuildProgress();
  resetCommandSession();
  resetCommandResultLog();

  // 点滅を停止
  stopBlinking();

  // 初期状態で子供たちを整列させる
  const ordered = getFrontOrderedNpcs();
  for (let i = 0; i < ordered.length; i += 1) {
    ordered[i].lineSlot = i;
    ordered[i].commandState = NPC_COMMAND_STATES.QUEUED;
    ordered[i].vx = 0; // 移動を停止
    ordered[i].state = NPC_ACTIVITY_STATES.IDLE; // 歩行状態をアイドルに設定
    ordered[i].x = getCommandLineX(i); // 整列位置に設定
    ordered[i].y = FLOOR_Y - ordered[i].h;
  }
}

function resetPlayer() {
  player.x = 120;
  player.y = FLOOR_Y - player.h;
  player.facing = 1;
}

function updateNpcs(dt) {
  for (const npc of npcs) {
    if (npc.commandState === NPC_COMMAND_STATES.QUEUED) {
      const targetX = getCommandLineX(npc.lineSlot);
      const reached = moveToward(npc, targetX, COMMAND_LINE.queueSpeed, dt);
      npc.state = NPC_ACTIVITY_STATES.WALK;
      npc.walkPhase += dt * 10;
      npc.y = FLOOR_Y - npc.h;
      npc.x = clamp(npc.x, 20, WORLD_W - npc.w - 20);
      if (reached) {
        npc.state = NPC_ACTIVITY_STATES.IDLE;
        npc.idleTimer = Math.max(npc.idleTimer || 0, randf(0.2, 0.6));
      }
      continue;
    }

    if (npc.commandState === NPC_COMMAND_STATES.RETURN_HOME) {
      // 家の横に立つ位置を計算（家の左側にNPCが並ぶ）
      const targetX = npc.commandTargetX ?? (home.x - 50 - (npc.id * 30));
      const arrived = moveToward(npc, targetX, COMMAND_LINE.workSpeed, dt);
      npc.state = NPC_ACTIVITY_STATES.WALK;
      npc.walkPhase += dt * 12;
      npc.y = npc.commandTargetY ?? FLOOR_Y - npc.h;

      if (arrived) {
        const builtParts = completeBuildForNpcWithQuantity(
          npc,
          npc.preferredPartType,
          npc.preferredRoofShape
        );
        if (builtParts && builtParts.length > 0) {
          const partNames = builtParts.map(part => getHousePartLabel(part.type)).join('と');
          addMessage(`子${npc.id} が家の${partNames}を設置しました（${builtParts.length}つ）。`);
        }
        // 家の横に留まるため、minXとmaxXを現在位置付近に設定
        npc.minX = npc.x - 10;
        npc.maxX = npc.x + 10;
        npc.commandTargetX = null;
        npc.commandTargetY = null;
        npc.commandMarkUntil = 0;
        npc.isBuildCommand = false;
        npc.assignedBuildPartId = null;
        // 一度建築したら戻ってくる可能性は0なので、状態をCOMPLETEDに遷移させる
        npc.commandState = NPC_COMMAND_STATES.COMPLETED;
        npc.state = NPC_ACTIVITY_STATES.IDLE; // 到着後にアイドル状態に設定
        npc.vx = 0; // 移動を停止
        npc.dir = 0; // 移動方向をリセット
        npc.walkTimer = 0; // 歩行タイマーをリセット
        npc.idleTimer = 0; // アイドルタイマーをリセット
      }
      continue;
    }

    npc.walkPhase += dt * 6;
    if (npc.state === NPC_ACTIVITY_STATES.WALK) {
      npc.x += npc.vx * npc.dir * dt;
      if (npc.x < npc.minX) {
        npc.x = npc.minX;
        npc.dir = 1;
        npc.state = NPC_ACTIVITY_STATES.IDLE;
        npc.idleTimer = randf(0.8, 2.0);
      } else if (npc.x + npc.w > npc.maxX) {
        npc.x = npc.maxX - npc.w;
        npc.dir = -1;
        npc.state = NPC_ACTIVITY_STATES.IDLE;
        npc.idleTimer = randf(0.8, 1.8);
      }

      npc.walkTimer -= dt;
      if (npc.walkTimer <= 0 || rand() < dt * 0.05) {
        npc.state = NPC_ACTIVITY_STATES.IDLE;
        npc.idleTimer = randf(0.3, 1.4);
      }
    } else {
      npc.idleTimer -= dt;
      if (npc.idleTimer <= 0) {
        npc.state = NPC_ACTIVITY_STATES.WALK;
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
    (npc) =>
      npc.commandState === NPC_COMMAND_STATES.QUEUED || npc.commandState === NPC_COMMAND_STATES.RETURN_HOME
  );
  if (busy) {
    return;
  }

  houseRevealActive = true;
  addMessage('全員の指示が完了したので、建物のある場所へカメラを移動します。');
}

function getBuiltHousePartSummaryText() {
  const requestedByType = {};
  const builtByType = {};

  for (const npc of npcs) {
    if (!npc.isBuildCommand) continue;
    const type = npc.preferredPartType;
    if (!type) continue;
    const requested = Math.max(1, npc.requestedBuildQuantity || npc.buildQuantity || 1);
    requestedByType[type] = (requestedByType[type] || 0) + requested;
  }

  for (const part of houseParts) {
    if (!part.built) continue;
    builtByType[part.type] = (builtByType[part.type] || 0) + 1;
  }

  const ordered = ['wall', 'roof', 'chimney', 'door', 'window', 'column'];
  const summaries = [];

  for (const type of ordered) {
    const requested = requestedByType[type] || 0;
    const built = builtByType[type] || 0;
    if (requested > 0 || built > 0) {
      const label = `${HOUSE_PART_LABELS[type] || type}${requested || built}個`;
      summaries.push(requested === 0 || requested === built ? label : `${label}(依頼:${requested} / 実施:${built})`);
    }
  }

  for (const type of Object.keys({ ...requestedByType, ...builtByType })) {
    if (ordered.includes(type)) continue;
    const requested = requestedByType[type] || 0;
    const built = builtByType[type] || 0;
    const label = `${HOUSE_PART_LABELS[type] || type}${requested || built}個`;
    summaries.push(requested === 0 || requested === built ? label : `${label}(依頼:${requested} / 実施:${built})`);
  }

  return summaries.length ? summaries.join('、') : '未設置';
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
      if (!scoreVisible) {
        const evaluated = evaluateGoalScore(activeGoal, houseParts, []);
        goalScore = evaluated.score;
        goalScoreBreakdown = evaluated.breakdown;
        scoreVisible = true;

        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(
            new CustomEvent('goal:score.finalized', {
              detail: {
                goalId: activeGoal ? activeGoal.goalId : null,
                score: evaluated.score,
                breakdown: evaluated.breakdown,
                extraPenalty: evaluated.breakdown.extraPenalty,
                idealMatchRate: evaluated.breakdown.idealMatchRate,
              },
            })
          );
        }
      }
      const builtSummary = getBuiltHousePartSummaryText();
      addMessage(`家の建設が完了。設置数: ${builtSummary}。スコア:${goalScore}。Rでリトライできます。`);
      
      // 各子供の解釈を表示
      for (const child of childInterpretations) {
        if (child.interpretation) {
          addMessage(`子${child.childId}の解釈: ${child.interpretation}`);
        }
      }
      
      // 音声入力を自動で停止
      if (typeof window.stopVoxtralMic === 'function') {
        window.stopVoxtralMic();
      }
      
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
    const roofShape = part.roofShape || DEFAULT_ROOF_SHAPE;
    if (roofShape === 'flat') {
      ctx.fillStyle = palette.houseRoof;
      ctx.fillRect(sx - 2, sy - 4, 114, 6);
      return;
    }
    if (roofShape === 'round') {
      const rows = 16;
      for (let i = 0; i < rows; i += 1) {
        const t = (i + 1) / (rows + 1);
        const rowY = sy - 24 + i * 2;
        const rowW = Math.max(10, Math.round(114 * Math.sin(Math.PI * t)));
        const rowX = sx + (home.w - rowW) / 2;
        ctx.fillStyle = i === 0 ? '#9a352a' : palette.houseRoof;
        ctx.fillRect(rowX, rowY, rowW, 2);
      }
      return;
    }
    for (let i = 0; i < 14; i += 1) {
      const rowY = sy - 4 - i;
      const rx = sx - 4 + i;
      const rw = 6 + i * 2;
      ctx.fillStyle = i === 0 ? '#9a352a' : palette.houseRoof;
      ctx.fillRect(rx, rowY, rw, 4);
    }
    return;
  }
  if (part.type === 'column') {
    const color = part.colorHex || palette.houseWall;
    ctx.fillStyle = color;
    ctx.fillRect(sx + part.x, sy + part.y, part.w, part.h);

    ctx.strokeStyle = '#3f2f24';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + part.x + 0.5, sy + part.y + 0.5, part.w, part.h);
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

function getGoalHintTextLines() {
  const goal = typeof getActiveGoalForUi === 'function' ? getActiveGoalForUi() : activeGoal;
  if (!goal) {
    return ['未設定'];
  }

  const toRequiredText = (target) => {
    if (!target) return '1';
    if (typeof target === 'number') {
      return `${target}`;
    }
    if (typeof target.min === 'number' && typeof target.max === 'number') {
      if (target.min === target.max) {
        return `${target.min}`;
      }
      return `${target.min}-${target.max}`;
    }
    if (typeof target.min === 'number') {
      return `${target.min}`;
    }
    if (typeof target.max === 'number') {
      return `${target.max}`;
    }
    return '1';
  };

  const lines = [];
  lines.push(`目標: ${goal.name || goal.goalId}`);

  for (const rule of goal.parts || []) {
    const type = HOUSE_PART_LABELS[rule.partType] || rule.partType || '部品';
    const req = toRequiredText(rule.requiredCount);
    let detail = `${type}${req}個`;

    if (rule.targetColorHex) {
      detail += ` / 色:${rule.targetColorHex}`;
    }
    if (rule.targetRoofShape) {
      detail += ` / 屋根:${rule.targetRoofShape}`;
    }
    if (rule.positionRule && rule.positionRule.mode === 'x-center') {
      const tol = Number(rule.positionRule.tolerancePx) || DEFAULT_GOAL_POSITION_TOLERANCE;
      detail += ` / 中央±${tol}px`;
    }

    lines.push(detail);
  }

  if (scoreVisible && goalScoreBreakdown) {
    const rate = Math.round((goalScoreBreakdown.idealMatchRate || 0) * 100);
    const extraPenalty = goalScoreBreakdown.extraPenalty || 0;
    const destroyPenalty = goalScoreBreakdown.destroyPenalty || 0;
    lines.push(`スコア: ${goalScore}点（一致率:${rate}%）`);
    lines.push(`追加罰則: ${extraPenalty + destroyPenalty}点`);
  } else if (goalScoreBreakdown && typeof goalScore === 'number') {
    lines.push(`暫定スコア: ${goalScore}点`);
  }

  return lines;
}

const GOAL_HINT_IMAGE_FALLBACK_PATH = '/images/goal-house-game-equivalent-1.svg';
const goalHintImageStateCache = Object.create(null);

function getGoalHintImageSource() {
  const goal = typeof getActiveGoalForUi === 'function' ? getActiveGoalForUi() : activeGoal;
  const fromApi = typeof getGoalHintImagePath === 'function'
    ? getGoalHintImagePath(goal)
    : null;

  if (typeof fromApi === 'string' && fromApi.trim()) {
    return fromApi.trim();
  }

  if (goal && typeof goal.hintImage === 'string' && goal.hintImage.trim()) {
    return goal.hintImage.trim();
  }

  return GOAL_HINT_IMAGE_FALLBACK_PATH;
}

function getGoalHintImageState(path = null) {
  const source = path || GOAL_HINT_IMAGE_FALLBACK_PATH;
  const cached = goalHintImageStateCache[source];
  if (cached) {
    return cached;
  }

  if (typeof Image === 'undefined') {
    const pending = { image: null, loaded: false, failed: true };
    goalHintImageStateCache[source] = pending;
    return pending;
  }

  const image = new Image();
  const state = {
    image,
    loaded: false,
    failed: false,
  };

  image.onload = () => {
    state.loaded = true;
  };
  image.onerror = () => {
    state.failed = true;
  };
  image.src = source;
  goalHintImageStateCache[source] = state;
  return state;
}

function drawGoalHintPanel() {
  const imageState = getGoalHintImageState(getGoalHintImageSource());

  if (!imageState.image || !imageState.loaded || imageState.failed) {
    return;
  }

  const x = 8;
  const y = 96;
  const width = 252;
  const padding = 8;
  const maxImageWidth = width - padding * 2;
  const maxImageHeight = Math.min(180, Math.max(1, H - y - 12));

  const image = imageState.image;
  const ratio = image.naturalWidth
    ? image.naturalWidth / Math.max(1, image.naturalHeight)
    : 1;
  let drawWidth = Math.min(maxImageWidth, image.naturalWidth || maxImageWidth);
  let drawHeight = drawWidth / ratio;

  if (drawHeight > maxImageHeight) {
    drawHeight = maxImageHeight;
    drawWidth = drawHeight * ratio;
  }

  const dx = x + (width - drawWidth) / 2;
  const dy = y + padding + (maxImageHeight - drawHeight) / 2;
  ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
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

function drawDotBody(x, y, sprite = {}, opacity = 1.0) {
  const w = sprite.w || 12;
  const h = sprite.h || 12;
  const isHero = sprite.isHero === true;
  const isThinking = isHero && Boolean(sprite.isListening);
  const heroColor = '#00ff00';
  const heroEye = '#003b14';
  const enemyColor = sprite.color || '#ff3d3d';

  const drawY = y + (isThinking ? -2 : 0);
  const drawH = h + (isThinking ? 2 : 0);

  if (isHero) {
    ctx.fillStyle = '#0fef2e';
    ctx.globalAlpha = opacity;
    ctx.fillRect(x, drawY, w, drawH);

    if (isThinking) {
      // 顔を上を向いた「考え中」ポーズ
      ctx.fillStyle = '#8dff89';
      ctx.fillRect(x + 2, drawY - 3, w - 4, 3);

      ctx.fillStyle = heroEye;
      ctx.fillRect(x + 4, drawY, 2, 2);
      ctx.fillRect(x + 6, drawY, 2, 2);
      ctx.fillRect(x + 3, drawY - 2, 1, 2);
      ctx.fillRect(x + 8, drawY - 2, 1, 2);
      ctx.fillRect(x + w / 2 - 1, drawY - 2, 2, 2);
    } else {
      ctx.fillStyle = heroEye;
      ctx.fillRect(x + (sprite.facing >= 0 ? w - 3 : 3), y + 4, 2, 2);
    }

    // 顎に手を当てるように見せる装飾（簡易）
    if (isThinking) {
      ctx.fillStyle = '#80e6ff';
      ctx.fillRect(x + w - 1, drawY + 6, 1, 3);
      ctx.fillRect(x + w - 2, drawY + 8, 2, 1);
    }
  } else {
    // ドット風: 2x2で色を変える
    ctx.fillStyle = enemyColor;
    ctx.globalAlpha = opacity;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#ff9a9a';
    ctx.fillRect(x + 1, y + 1, 4, 4);
    ctx.fillRect(x + w - 5, y + 1, 4, 4);
  }
  ctx.globalAlpha = 1.0;
}

function drawPlayerSpeechBubble(anchorX, topY, isListening = false, opacity = 1.0, imageState = null) {
  const bubbleW = 105;
  const bubbleH = 96;
  const radius = 16;
  const tailTipY = topY - 1;
  const tailWidth = 6;
  const bubbleX = anchorX - bubbleW / 2;
  const bubbleY = topY - bubbleH - 40;

  const fill = isListening ? '#ffffff' : '#f6fbff';
  const stroke = isListening ? '#2d4666' : '#4d678a';

  const bx = Math.max(2, bubbleX);
  const by = Math.max(2, bubbleY);
  const tailX = clamp(anchorX, bx + 8, bx + bubbleW - 8);
  const by2 = by + bubbleH;
  const tailY = clamp(tailTipY, by2 + 6, by2 + 20);
  const bubbleAlpha = 0.95 * opacity;

  ctx.globalAlpha = bubbleAlpha;
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;

  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(bx, by, bubbleW, bubbleH, radius);
    ctx.fill();
    ctx.stroke();
  } else {
    const r = radius;
    const x0 = bx;
    const y0 = by;
    const x1 = bx + bubbleW;
    const y1 = by + bubbleH;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.arcTo(x1, y0, x1, y1, r);
    ctx.arcTo(x1, y1, x0, y1, r);
    ctx.arcTo(x0, y1, x0, y0, r);
    ctx.arcTo(x0, y0, x1, y0, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // 思考中の吹き出しらしく、小さい泡を頭方向に配置する
  const tailBaseX = clamp(anchorX, bx + bubbleW * 0.30, bx + bubbleW * 0.70);
  // 3つの円を配置する
  const tailNodes = [
    { x: tailBaseX, y: by2 + 6, r: 4 },
    { x: tailBaseX + (anchorX - tailBaseX) * 0.55, y: by2 + 15, r: 3 },
    { x: anchorX, y: Math.min(topY - 4, by2 + 24), r: 2 },
  ];
  for (const node of tailNodes) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  if (!imageState || !imageState.image || imageState.failed) {
    const fallbackDotColor = isListening ? '#6f9ecf' : '#7a8fa4';
    const dotY = by + 16;
    const basePhase = isListening ? walkTime * 6 : 0;
    const dots = isListening ? [0, 1, 2] : [0];
    ctx.fillStyle = fallbackDotColor;
    for (const d of dots) {
      const dx = (d - 1) * 5;
      const bounce = isListening ? Math.max(0.5, 0.5 + Math.sin(basePhase + d * 1.6) * 0.5) : 1;
      const dotRadius = 1.5 * bounce;
      ctx.beginPath();
      // ctx.arc(tailX - 3 + dx, dotY, dotRadius, 0, Math.PI * 2);
      ctx.arc(anchorX + dx, dotY, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
    return;
  }

  if (!imageState.loaded) {
    const loadingDotY = by + 20;
    const loadingDots = [0, 1, 2];
    ctx.fillStyle = isListening ? '#6f9ecf' : '#7a8fa4';
    for (const d of loadingDots) {
      const dx = (d - 1) * 6;
      const phase = isListening ? walkTime * 6 + d * 1.2 : 0;
      const radius = isListening ? 1.3 + Math.sin(phase) * 0.4 : 1.2;
      ctx.beginPath();
      ctx.arc(tailX - 3 + dx, loadingDotY, Math.max(0.8, radius), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
    return;
  }

  const img = imageState.image;
  const padding = 2;
  const imageArea = {
    x: bx + padding,
    y: by + padding,
    w: Math.max(1, bubbleW - padding * 2),
    h: Math.max(1, bubbleH - padding * 2 - 4),
  };
  const ratio = img.naturalWidth ? img.naturalWidth / Math.max(1, img.naturalHeight) : 1;
  let drawW = imageArea.w;
  let drawH = drawW / ratio;
  if (drawH > imageArea.h) {
    drawH = imageArea.h;
    drawW = drawH * ratio;
  }
  const dx = imageArea.x + (imageArea.w - drawW) / 2;
  const dy = imageArea.y + (imageArea.h - drawH) / 2 + 6;
  ctx.drawImage(img, dx, dy, drawW, drawH);
  ctx.globalAlpha = 1.0;
}

// 点滅状態管理
let blinkTimer = null;
let isBlinking = false;
let blinkCounter = 0;
let blinkingNpcId = null; // 点滅対象のNPC ID

function startBlinking(npcId = null) {
  if (isBlinking && blinkingNpcId === npcId) return;
  
  if (blinkTimer) {
    clearInterval(blinkTimer);
  }
  
  isBlinking = true;
  blinkCounter = 0;
  blinkingNpcId = npcId; // 点滅対象のNPC IDを設定
  blinkTimer = setInterval(() => {
    blinkCounter++;
  }, 500);
}

function stopBlinking() {
  if (blinkTimer) {
    clearInterval(blinkTimer);
    blinkTimer = null;
  }
  isBlinking = false;
  blinkCounter = 0;
  blinkingNpcId = null;
}

// グローバル関数としてエクスポート
window.startBlinking = startBlinking;
window.stopBlinking = stopBlinking;

// QUEUED状態の子供のうち、最も先頭にいる子供を返す
function getFirstQueuedChild() {
  if (npcs.length === 0) return null;

  const explicitListeningNpc = npcs.find((npc) => npc.isListeningToPlayer);
  if (explicitListeningNpc) {
    return explicitListeningNpc;
  }
  
  // QUEUED状態の子供を抽出
  const queuedChildren = npcs.filter(npc => npc.commandState === NPC_COMMAND_STATES.QUEUED);
  
  if (queuedChildren.length === 0) return null;
  
  // playerに最も近い子供を返す
  const direction = player.facing >= 0 ? 1 : -1;
  return queuedChildren.reduce((closest, npc) => {
    const projected = (npc.x - player.x) * direction;
    const closestProjected = (closest.x - player.x) * direction;
    return projected < closestProjected ? npc : closest;
  });
}

// グローバル関数としてエクスポート
window.getFirstQueuedChild = getFirstQueuedChild;

function shouldShowUninterpretedHint(npc, nowMs = performance.now()) {
  if (!npc || !npc.isListeningToPlayer) return false;
  if (String(npc.lastInterpretation || '').trim()) return false;

  const listeningStartedAt = Number(npc.listeningStartedAt || 0);
  if (!Number.isFinite(listeningStartedAt) || listeningStartedAt <= 0) return false;

  const delayMs = Number(COMMAND_LINE.uninterpretedHintDelayMs || 5000);
  return nowMs - listeningStartedAt >= delayMs;
}

function drawUninterpretedHintBubble(npc, sx, opacity = 1.0) {
  const bubbleW = 16;
  const bubbleH = 14;
  const anchorX = sx + npc.w * 0.5;
  const bx = clamp(Math.round(anchorX - bubbleW / 2), 2, W - bubbleW - 2);
  const by = Math.round(npc.y - bubbleH - 14);
  const tailBaseX = clamp(anchorX, bx + 4, bx + bubbleW - 4);
  const tailTipY = npc.y - 5;

  ctx.save();
  ctx.globalAlpha = 0.95 * opacity;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#2d4666';
  ctx.lineWidth = 1;

  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(bx, by, bubbleW, bubbleH, 5);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(bx, by, bubbleW, bubbleH);
    ctx.strokeRect(bx + 0.5, by + 0.5, bubbleW - 1, bubbleH - 1);
  }

  ctx.beginPath();
  ctx.moveTo(tailBaseX - 2, by + bubbleH - 1);
  ctx.lineTo(tailBaseX + 2, by + bubbleH - 1);
  ctx.lineTo(anchorX, tailTipY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#1f2f45';
  ctx.font = 'bold 11px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', bx + bubbleW / 2, by + bubbleH / 2 + 0.5);
  ctx.restore();
}

function draw() {
  ctx.imageSmoothingEnabled = false;
  drawSky();
  drawGround();
  drawHouse();

  // NPCを先に描画し、主人公は最後に描画して必ず見えるようにする
  const nowMs = performance.now();
  const sortedNpcs = [...npcs].sort((a, b) => a.y + a.h - (b.y + b.h));
  for (const e of sortedNpcs) {
    const sx = e.x - cameraX;
    if (sx + 80 < 0 || sx - 80 > W) continue;

    // 点滅対象の子供を表示
    let opacity = 1.0;
    if (isBlinking && e.id === blinkingNpcId) {
      opacity = blinkCounter % 2 === 0 ? 1.0 : 0.5;
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
    }, opacity);

    drawBuildMark(e, sx);
    if (shouldShowUninterpretedHint(e, nowMs)) {
      drawUninterpretedHintBubble(e, sx, opacity);
    }

    // 解釈データを表示（家が映った後にのみ表示）
    if (houseRevealDone) {
      const childInterpretation = childInterpretations.find(c => c.childId === e.id);
      if (childInterpretation && childInterpretation.interpretation) {
        // 吹き出しの背景
        const text = childInterpretation.interpretation;
        const textWidth = ctx.measureText(text).width;
        const padding = 4;
        const bgWidth = textWidth + padding * 2;
        const bgHeight = 16;
        
        // 吹き出しの位置を調整（キャラクターの位置に応じて調整）
        // 左右を確実に合わせ、上下を少しずらす
        const balloonX = sx;
        // 吹き出しのY位置を調整して重ならないようにする
        const balloonY = e.y + e.h + 4 + (e.id * 20);
        
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.8 * opacity;
        ctx.fillRect(balloonX, balloonY, bgWidth, bgHeight);
        ctx.globalAlpha = 1.0;
        
        // 吹き出しの枠線
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.strokeRect(balloonX, balloonY, bgWidth, bgHeight);
        
        // 吹き出しの尻尾（合同にするために統一した形状）
        // 縦の長さを短い方に揃えて形状を統一
        const tailHeight = balloonY - (e.y + e.h);
        const tailWidth = 4;
        const tailX = balloonX + 10;
        const tailY = balloonY - 5;
        
        ctx.beginPath();
        ctx.moveTo(tailX - tailWidth / 2, balloonY);
        ctx.lineTo(tailX, tailY);
        ctx.lineTo(tailX + tailWidth / 2, balloonY);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.8 * opacity;
        ctx.fill();
        ctx.globalAlpha = 1.0;
        ctx.stroke();
        
        // 解釈データを表示
        ctx.fillStyle = '#000000';
        ctx.font = '12px "Courier New", monospace';
        ctx.fillText(text, balloonX + padding, balloonY + 14);
      }
    }
  }

  // Hero (always on top)
  const px = player.x - cameraX;
  if (px + 80 >= 0 && px - 80 <= W) {
    const heroSprite = {
      w: player.w,
      h: player.h,
      facing: player.facing,
      isListening: heroListening,
      type: 'human',
      isHero: true,
    };
    drawDotBody(px, player.y, heroSprite);

    const hasSpeechBubble =
      heroSpeechBubbleUnlocked
      && (!clear || heroListening || Boolean(latestLiveTranscript && String(latestLiveTranscript).trim()));
    if (hasSpeechBubble) {
      drawPlayerSpeechBubble(
        px + player.w / 2,
        player.y,
        heroListening,
        heroListening ? 1.0 : 0.8,
        getGoalHintImageState(getGoalHintImageSource())
      );
    }
  }

  // HUD
  ctx.fillStyle = '#e9f2ff';
  ctx.font = '14px "Courier New", monospace';
  ctx.fillText(message, 8, 34);
  ctx.fillText(`X:${Math.floor(player.x)} / ${WORLD_W}`, 8, 50);

  // NPC座標デバッグ情報
  ctx.fillText('NPC Positions:', W - 200, 34);
  npcs.forEach((npc, i) => {
    ctx.fillText(`ID${npc.id}: X${Math.floor(npc.x)} Y${Math.floor(npc.y)} ${npc.commandState}`, W - 200, 50 + i * 20);
  });

  ctx.fillText('音声デバッグ:', 8, 66);
  ctx.fillText(liveTranscriptLine, 8, 82);

  // ゴール画像はプレイヤー頭上の吹き出しに統一して表示する
  drawCommandResultPanel();
}

function update(dt) {
  if (!clear) {
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

if (typeof window.setupVoxtralIntegration === 'function') {
  window.setupVoxtralIntegration({
    getState: () => ({
      playerX: Math.floor(player.x),
      playerY: Math.floor(player.y),
      clear,
      npcCount: npcs.length,
      enemyCount: npcs.length,
      cameraX: Math.floor(cameraX),
      goal: getGoalStateForUi ? getGoalStateForUi() : {
        activeGoal: getActiveGoalForUi ? getActiveGoalForUi() : activeGoal,
        score: goalScore,
        scoreVisible,
        breakdown: goalScoreBreakdown,
      },
      mode: clear ? 'goal' : 'play',
    }),
    setMessage: addMessage,
    setLiveTranscript,
    setHeroListening,
    onHeroSpeech: receiveHeroCommand,
    startCommandLineup: startCommandLineup,
  });
}

if (resultToggleButton) {
  resultToggleButton.addEventListener('click', toggleCommandResultPanel);
}
updateCommandButtons();

window.render_game_to_text = () =>
  JSON.stringify({
    origin: 'top-left',
    player: {
      x: Math.floor(player.x),
      y: Math.floor(player.y),
    },
    npcs: npcs.map((n) => ({
      id: n.id,
      x: Math.floor(n.x),
      y: Math.floor(n.y),
      state: n.state,
      isListeningToPlayer: Boolean(n.isListeningToPlayer),
      questionBubbleVisible: shouldShowUninterpretedHint(n),
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
  if (e.code === 'KeyR') {
    e.preventDefault();
    resetGame();
  }
});

resetGame();
addMessage('2D Dot Meadow - ゆっくり散歩するドット世界');
requestAnimationFrame((now) => {
  lastTime = now;
  requestAnimationFrame(loop);
});
