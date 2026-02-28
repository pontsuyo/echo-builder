function resetGame() {
  clear = false;
  player.dead = false;
  player.lives = 3;
  addMessage('2D Dot Meadow - リトライ可能');
  resetPlayer();
  resetHouseBuildProgress();
  resetCommandSession();
  resetCommandResultLog();

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
        const builtPart = completeBuildForNpc(npc);
        if (builtPart) {
          const partName = getHousePartLabel(builtPart.type);
          addMessage(`子${npc.id} が家の${partName}を設置しました。`);
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
  const isThinking = isHero && Boolean(sprite.isListening);
  const heroColor = '#00ff00';
  const heroEye = '#003b14';
  const enemyColor = sprite.color || '#ff3d3d';

  const drawY = y + (isThinking ? -2 : 0);
  const drawH = h + (isThinking ? 2 : 0);

  if (isHero) {
    ctx.fillStyle = '#0fef2e';
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
    ctx.fillRect(x, y, w, h);
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
    const heroSprite = {
      w: player.w,
      h: player.h,
      facing: player.facing,
      walkPhase: player.walkPhase,
      isListening: heroListening,
      type: 'human',
      isHero: true,
    };
    drawDotBody(px, player.y, heroSprite);
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

resetGame();
addMessage('2D Dot Meadow - ゆっくり散歩するドット世界');
requestAnimationFrame((now) => {
  lastTime = now;
  requestAnimationFrame(loop);
});
