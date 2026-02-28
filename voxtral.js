(function () {
  const button = document.getElementById('ask-voxtral');
  const VOXTRAL_API = {
    endpoint:
      window.__MISTRAL_PROXY_URL ||
      window.__MISTRAL_API_URL ||
      'https://api.mistral.ai/v1/chat/completions',
    apiKey: window.__MISTRAL_API_KEY || '',
    model: window.__MISTRAL_API_MODEL || 'voxtral-mini',
  };
  let gameApi = null;
  let isRequesting = false;

  function isConfigReady() {
    return Boolean(window.__MISTRAL_PROXY_URL || VOXTRAL_API.apiKey);
  }

  function canSendRequest() {
    return Boolean(gameApi && typeof gameApi.setMessage === 'function');
  }

  function setBusy(busy) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? '取得中...' : 'Voxtralでヒント取得';
  }

  function postMessage(text) {
    if (canSendRequest()) {
      gameApi.setMessage(text);
      return;
    }
    console.info(text);
  }

  function buildPrompt() {
    const state = gameApi && typeof gameApi.getState === 'function' ? gameApi.getState() : {};
    const status = `Player(x=${state.playerX ?? '?'}, y=${state.playerY ?? '?'}, lives=${state.lives ?? '?'}, clear=${state.clear ?? '?'}, enemies=${state.enemyCount ?? 0})`;
    return `あなたは2Dドット風アクションゲームのゲーム内アシスタントです。短く実用的なヒントを1つ日本語で返してください。\n状態: ${status}`;
  }

  async function readStreamingText(response, onChunk) {
    if (!response.body) {
      throw new Error('ストリーミングレスポンスボディがありません');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let doneText = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';

      for (const frame of frames) {
        const lines = frame
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.startsWith('data:'));

        for (const line of lines) {
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') {
            continue;
          }

          try {
            const data = JSON.parse(payload);
            const delta =
              data?.choices?.[0]?.delta?.content ??
              data?.choices?.[0]?.text ??
              data?.choices?.[0]?.message?.content ??
              data?.delta?.content ??
              '';
            if (typeof delta === 'string') {
              doneText += delta;
              onChunk(doneText);
            }
          } catch {
            // 応答形式が想定外の時は無視して継続
          }
        }
      }
    }

    return doneText;
  }

  async function requestVoxtralHint() {
    if (isRequesting) return;
    if (!isConfigReady()) {
      postMessage('Voxtral未設定: window.__MISTRAL_API_KEY または window.__MISTRAL_PROXY_URL を設定してください。');
      return;
    }
    if (!canSendRequest()) {
      postMessage('Voxtral連携APIがゲーム本体に接続されていません。');
      return;
    }

    isRequesting = true;
    setBusy(true);
    postMessage('Voxtralに問い合わせ中...');

    try {
      const useProxy = Boolean(window.__MISTRAL_PROXY_URL);
      const headers = {
        'Content-Type': 'application/json',
      };
      if (!useProxy) {
        headers.Authorization = `Bearer ${VOXTRAL_API.apiKey}`;
      }

      const body = {
        model: VOXTRAL_API.model,
        messages: [
          {
            role: 'user',
            content: buildPrompt(),
          },
        ],
        max_tokens: 120,
        temperature: 0.6,
        stream: true,
      };

      const res = await fetch(VOXTRAL_API.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      let streamed = '';
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        streamed = await readStreamingText(res, (draft) => {
          postMessage(`AIヒント: ${draft}`);
        });
      } else {
        const data = await res.json();
        streamed =
          data?.choices?.[0]?.message?.content ??
          data?.choices?.[0]?.text ??
          data?.output ??
          data?.text ??
          data?.message ??
          '';
      }

      if (typeof streamed !== 'string' || !streamed.trim()) {
        throw new Error('AIレスポンスの形式が想定外です');
      }

      postMessage(`AIヒント: ${streamed.trim()}`);
    } catch (err) {
      postMessage(`Voxtral呼び出し失敗: ${String(err.message || err)}`);
    } finally {
      isRequesting = false;
      setBusy(false);
    }
  }

  function setupIntegration(api) {
    if (!api || typeof api !== 'object') {
      gameApi = null;
      postMessage('VoxtralはゲームAPI未接続です。');
      return;
    }
    gameApi = api;
    if (!isConfigReady()) {
      postMessage('ヒント機能は未接続です: window.__MISTRAL_API_KEY または window.__MISTRAL_PROXY_URL を設定してください。');
    }
  }

  window.requestVoxtralHint = requestVoxtralHint;
  window.setupVoxtralIntegration = setupIntegration;

  if (button) {
    button.addEventListener('click', requestVoxtralHint);
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H' || e.code === 'KeyH') {
      e.preventDefault();
      requestVoxtralHint();
    }
  });
})();
