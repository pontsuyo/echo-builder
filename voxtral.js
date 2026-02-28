(function () {
  const micButton = document.getElementById('ask-voxtral-mic');
  const CHAT_MODEL_CANDIDATES = ['mistral-small-latest', 'mistral-small'];
  const VOXTRAL_AUDIO_MODEL = 'voxtral-mini-latest';
  const AUDIO_SEND_WAV = true;
  const AUDIO_MODEL_CANDIDATES = [VOXTRAL_AUDIO_MODEL];
  const CHAT_ENDPOINT_PATH = '/v1/chat/completions';
  const AUDIO_ENDPOINT_PATH = '/v1/audio/transcriptions';
  const MIC_TIMESLICE_MS = 2000;
  const MIC_STOP_FLUSH_DELAY_MS = 80;

  function normalizeEndpoint(url, fallback) {
    const raw = String(url || fallback || '').trim();
    return raw.endsWith('/') ? raw.replace(/\/+$/, '') : raw;
  }

  function buildEndpoint({ explicit, proxy, fallback, path }) {
    const explicitEndpoint = explicit != null && String(explicit).trim();
    if (explicitEndpoint) return normalizeEndpoint(explicitEndpoint);

    const proxyEndpoint = proxy != null && String(proxy).trim();
    if (proxyEndpoint) {
      const normalized = normalizeEndpoint(proxyEndpoint);
      if (normalized.endsWith(path)) {
        return normalized;
      }
      return `${normalized}${path}`;
    }

    return normalizeEndpoint(fallback);
  }

  const CHAT_API = {
    endpoint:
      buildEndpoint({
        explicit: window.__MISTRAL_API_URL,
        proxy: window.__MISTRAL_PROXY_URL,
        fallback: `https://api.mistral.ai${CHAT_ENDPOINT_PATH}`,
        path: CHAT_ENDPOINT_PATH,
      }),
    apiKey: window.__MISTRAL_API_KEY || '',
    model: window.__MISTRAL_API_MODEL || CHAT_MODEL_CANDIDATES[0],
  };
  const AUDIO_API = {
    endpoint:
      buildEndpoint({
        explicit: window.__MISTRAL_AUDIO_TRANSCRIPT_URL,
        proxy: window.__MISTRAL_PROXY_AUDIO_URL || window.__MISTRAL_PROXY_URL,
        fallback: `https://api.mistral.ai${AUDIO_ENDPOINT_PATH}`,
        path: AUDIO_ENDPOINT_PATH,
      }),
    apiKey: window.__MISTRAL_API_KEY || '',
    model: VOXTRAL_AUDIO_MODEL,
  };
  const ENABLE_DEBUG_LOG = Boolean(
    window.__MISTRAL_DEBUG || window.__VOXTRAL_DEBUG || false
  );

  let gameApi = null;
  let isRequesting = false;

  let mediaStream = null;
  let mediaRecorder = null;
  let micActive = false;
  let transcriptionText = '';
  let chunkSeq = 0;
  let audioRequestSeq = 0;
  let recordedChunks = [];
  let lastMicMimeType = '';
  let lastAudioChunk = null;
  let heroSpeechCandidate = '';
  let heroSpeechDebounceTimer = null;
  let lastHeroSpeechSentText = '';
  let lastHeroSpeechSentAt = 0;
  let isMicFlowSuspended = false;
  const HERO_SPEECH_MIN_LEN = 2;
  const HERO_SPEECH_IDLE_MS = 600;
  const HERO_SPEECH_COOLDOWN_MS = 700;
  const LIVE_TRANSCRIBE_DELAY_MS = 2000;
  const LIVE_TRANSCRIBE_MIN_BYTES = 14000;
  const FINAL_TRANSCRIBE_MIN_BYTES = 16000;
  let liveTranscribeTimer = null;
  let liveTranscribeInFlight = false;
  let liveChunkQueue = [];
  let liveChunkBytes = 0;
  const isMicActive = () => micActive;

  function notifyHeroListening(active) {
    if (gameApi && typeof gameApi.setHeroListening === 'function') {
      gameApi.setHeroListening(active);
    }
  }

  const micMimeTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
    'audio/m4a',
  ];

  function isConfigReady() {
    return Boolean(window.__MISTRAL_PROXY_URL || window.__MISTRAL_API_KEY);
  }

  function isAudioConfigReady() {
    return Boolean(window.__MISTRAL_PROXY_AUDIO_URL || window.__MISTRAL_PROXY_URL || window.__MISTRAL_API_KEY);
  }

  function canSendRequest() {
    return Boolean(gameApi && typeof gameApi.setMessage === 'function');
  }

  function setMicBusy(active) {
    if (!micButton) return;
    micActive = active;
    micButton.disabled = false;
    micButton.textContent = active ? 'マイク停止' : 'マイク開始';
  }

  function postMessage(text) {
    if (canSendRequest()) {
      gameApi.setMessage(text);
      return;
    }
    console.info(text);
  }

  function logDebug(...args) {
    if (!ENABLE_DEBUG_LOG) return;
    console.debug('[Voxtral]', ...args);
  }

  function getGameStateText() {
    const state = gameApi && typeof gameApi.getState === 'function' ? gameApi.getState() : {};
    return `x=${state.playerX ?? '?'}, y=${state.playerY ?? '?'}, lives=${state.lives ?? '?'}, clear=${state.clear ?? '?'}, enemies=${state.enemyCount ?? 0}`;
  }

  function buildPrompt(extraUserPrompt = '') {
    const base =
      'あなたは2Dドット風アクションゲームのゲーム内アシスタントです。短く実用的なヒントを1つ日本語で返してください。';
    const status = getGameStateText();
    if (extraUserPrompt) {
      return `${base}\n状態: ${status}\nプレイヤーの追加入力: ${extraUserPrompt}`;
    }
    return `${base}\n状態: ${status}`;
  }

  function getChatModelCandidates() {
    return uniqueFromList([CHAT_API.model, ...CHAT_MODEL_CANDIDATES]);
  }

  function formatRequestPayload(extraUserPrompt = '', model = CHAT_API.model) {
    return {
      model,
      messages: [
        {
          role: 'user',
          content: buildPrompt(extraUserPrompt),
        },
      ],
      max_tokens: 120,
      temperature: 0.6,
      stream: true,
    };
  }

  function toHeaderObj(headers) {
    const obj = {};
    if (!headers || typeof headers.forEach !== 'function') return obj;
    headers.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }

  function summarizeForm(form) {
    const fields = [];
    form.forEach((value, key) => {
      if (value instanceof File) {
        fields.push({
          key,
          fileName: value.name,
          fileType: value.type,
          fileSize: value.size,
        });
        return;
      }
      fields.push({ key, value });
    });
    return fields;
  }

  function safeParseErrorBody(rawBody) {
    try {
      return rawBody ? JSON.parse(rawBody) : null;
    } catch {
      return null;
    }
  }

  function summarizeBodyForLog(rawBody, maxLen = 900) {
    const text = String(rawBody || '').replace(/\s+/g, ' ').trim();
    if (!text) return 'empty';
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen)}... (truncated ${text.length - maxLen} chars)`;
  }

  function extractErrorCodeFromBody(errorBody) {
    if (!errorBody || typeof errorBody !== 'object') return '';
    return (
      errorBody.error?.code ||
      errorBody.error?.type ||
      errorBody.code ||
      errorBody.type ||
      ''
    );
  }

  function extractErrorDetailFromBody(errorBody) {
    if (!errorBody || typeof errorBody !== 'object') return '';
    return (
      errorBody.error?.message ||
      errorBody.message ||
      errorBody.detail ||
      errorBody.error ||
      ''
    );
  }

  async function getBlobLeadingHex(blob, maxBytes = 16) {
    if (!blob || !blob.size) return '';
    try {
      const head = blob.slice(0, Math.min(maxBytes, blob.size));
      const buffer = await head.arrayBuffer();
      return Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
    } catch (err) {
      logDebug('audio blob hex read failed', {
        error: String(err && err.message ? err.message : err),
      });
      return '';
    }
  }

  async function toWavBlob(sourceBlob) {
    if (!sourceBlob || !sourceBlob.size) {
      throw new Error('変換対象の音声データがありません');
    }
    if (!window.AudioContext && !window.webkitAudioContext) {
      throw new Error('AudioContextが利用できないためWAV変換をスキップします');
    }

    const arrayBuffer = await sourceBlob.arrayBuffer();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioCtx();
    let audioBuffer = null;
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } catch (err) {
      await audioCtx.close().catch(() => {});
      throw new Error(`WAV変換用デコード失敗: ${String(err && err.message ? err.message : err)}`);
    }

    try {
      const channelData = [];
      const channelCount = audioBuffer.numberOfChannels;
      for (let c = 0; c < channelCount; c += 1) {
        channelData.push(audioBuffer.getChannelData(c));
      }

      const sampleRate = audioBuffer.sampleRate;
      const samples = audioBuffer.length;
      const bytesPerSample = 2;
      const byteRate = sampleRate * channelCount * bytesPerSample;
      const blockAlign = channelCount * bytesPerSample;
      const dataSize = samples * blockAlign;
      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);
      const writeString = (offset, str) => {
        for (let i = 0; i < str.length; i += 1) {
          view.setUint8(offset + i, str.charCodeAt(i));
        }
      };

      writeString(0, 'RIFF');
      view.setUint32(4, 36 + dataSize, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, channelCount, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, byteRate, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, dataSize, true);

      let offset = 44;
      for (let i = 0; i < samples; i += 1) {
        for (let ch = 0; ch < channelCount; ch += 1) {
          const sample = Math.max(-1, Math.min(1, channelData[ch][i] ?? 0));
          view.setInt16(offset, sample * 32767, true);
          offset += 2;
        }
      }

      return new Blob([buffer], { type: 'audio/wav' });
    } finally {
      await audioCtx.close().catch(() => {});
    }
  }

  function guessAudioExtension(mimeType) {
    if (!mimeType) return 'webm';
    const t = String(mimeType).toLowerCase();
    if (t.includes('ogg')) return 'ogg';
    if (t.includes('mp4') || t.includes('m4a') || t.includes('aac')) return 'm4a';
    if (t.includes('wav')) return 'wav';
    return t.includes('webm') ? 'webm' : 'webm';
  }

  function uniqueFromList(values) {
    const seen = new Set();
    return values.filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
  }

  function getAudioModelCandidates() {
    return uniqueFromList([VOXTRAL_AUDIO_MODEL, ...AUDIO_MODEL_CANDIDATES]);
  }

  function isInvalidModelError(status, detail) {
    if (status !== 400) return false;
    const text = String(detail || '').toLowerCase();
    return text.includes('invalid model') || text.includes('unknown model');
  }

  function isDecodeError(status, detail) {
    if (status !== 400) return false;
    const text = String(detail || '').toLowerCase();
    return (
      text.includes('could not be decoded') ||
      text.includes('audio input could not be decoded') ||
      text.includes('decode')
    );
  }

  async function readStreamingText(response, onChunk, extractor) {
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
            const delta = extractor(data);
            if (typeof delta === 'string' && delta) {
              doneText += delta;
              onChunk(doneText);
            }
          } catch {
            logDebug('sse parse failed', {
              payloadPreview: payload.slice(0, 120),
            });
          }
        }
      }
    }

    if (buffer.trim()) {
      const tailLines = buffer
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'));
      for (const line of tailLines) {
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const data = JSON.parse(payload);
          const delta = extractor(data);
          if (typeof delta === 'string' && delta) {
            doneText += delta;
            onChunk(doneText);
          }
        } catch {
          logDebug('sse tail parse failed', {
            payloadPreview: payload.slice(0, 120),
          });
        }
      }
    }

    return doneText;
  }

  function extractChatText(data) {
    return (
      data?.choices?.[0]?.delta?.content ??
      data?.choices?.[0]?.text ??
      data?.choices?.[0]?.message?.content ??
      data?.delta?.content ??
      ''
    );
  }

  function extractTranscriptionText(data) {
    return (
      data?.text ??
      data?.transcript ??
      data?.segments?.[0]?.text ??
      data?.choices?.[0]?.text ??
      data?.delta?.text ??
      data?.output ??
      ''
    );
  }

  function mergeTranscriptText(nextText, current) {
    const trimmedCurrent = (current || '').trim();
    const trimmedNext = (nextText || '').trim();
    if (!trimmedNext) return current;
    if (!trimmedCurrent) return trimmedNext;
    if (trimmedNext.startsWith(trimmedCurrent)) return trimmedNext;
    if (trimmedCurrent.startsWith(trimmedNext)) return trimmedCurrent;
    return `${trimmedCurrent} ${trimmedNext}`;
  }

  async function requestVoxtralHint(extraUserPrompt = '') {
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
    postMessage('Voxtralに問い合わせ中...');

    try {
      const useProxy = Boolean(window.__MISTRAL_PROXY_URL);
      const models = getChatModelCandidates();
      let res = null;

      for (let i = 0; i < models.length; i += 1) {
        const model = models[i];
        const headers = {
          'Content-Type': 'application/json',
        };
        if (!useProxy) {
          headers.Authorization = `Bearer ${CHAT_API.apiKey}`;
        }
        const requestPayload = formatRequestPayload(extraUserPrompt, model);
        const debugHeaders = {
          ...headers,
        };
        if (debugHeaders.Authorization) {
          debugHeaders.Authorization = 'Bearer ***';
        }
        logDebug('request start', {
          type: 'chat',
          attempt: i + 1,
          model,
          url: CHAT_API.endpoint,
          useProxy,
          headers: debugHeaders,
          payload: requestPayload,
        });

        res = await fetch(CHAT_API.endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestPayload),
        });

        if (!res.ok) {
          const errorBodyText = await res.text().catch(() => '');
          let errorBody = null;
          try {
            errorBody = errorBodyText ? JSON.parse(errorBodyText) : null;
          } catch {
            errorBody = null;
          }

          const detail =
            errorBody?.error?.message ||
            errorBody?.message ||
            (typeof errorBodyText === 'string' && errorBodyText.length
              ? errorBodyText
              : 'No error detail');

          console.error('[Voxtral] request failed', {
            type: 'chat',
            status: res.status,
            statusText: res.statusText,
            url: res.url,
            headers: toHeaderObj(res.headers),
            body: errorBodyText,
          });

          logDebug('chat request failed detail', {
            attempt: i + 1,
            model,
            detail,
          });

          if (isInvalidModelError(res.status, detail) && i + 1 < models.length) {
            logDebug('chat model fallback retry', {
              fromModel: model,
              toModel: models[i + 1],
            });
            continue;
          }

          throw new Error(`HTTP ${res.status}: ${detail}`);
        }

        break;
      }

      if (!res) {
        throw new Error('チャットAPIのレスポンスがありません');
      }

      logDebug('response ok', {
        type: 'chat',
        status: res.status,
        headers: toHeaderObj(res.headers),
      });

      let streamed = '';
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        streamed = await readStreamingText(res, (draft) => {
          postMessage(`AIヒント: ${draft}`);
        }, extractChatText);
      } else {
        const data = await res.json();
        streamed =
          data?.choices?.[0]?.message?.content ??
          data?.choices?.[0]?.text ??
          data?.output ??
          data?.text ??
          data?.message ??
          '';
        logDebug('non-stream response', { type: 'chat', data });
      }

      if (typeof streamed !== 'string' || !streamed.trim()) {
        throw new Error('AIレスポンスの形式が想定外です');
      }

      postMessage(`AIヒント: ${streamed.trim()}`);
    } catch (err) {
      const message = `Voxtral呼び出し失敗: ${String(err.message || err)}`;
      console.error('[Voxtral] Failed', err);
      postMessage(message);
    } finally {
      isRequesting = false;
    }
  }

  function appendTranscriptionText(chunkText, fromStream = false) {
    transcriptionText = mergeTranscriptText(chunkText, transcriptionText);
    postMessage(transcriptionText);
    notifyLiveTranscript(transcriptionText);
    if (fromStream) {
      scheduleHeroSpeechFromTranscript(transcriptionText);
    }
  }

  function clearLiveTranscribeTimer() {
    if (liveTranscribeTimer) {
      clearTimeout(liveTranscribeTimer);
      liveTranscribeTimer = null;
    }
  }

  function requestLiveTranscription() {
    if (!isMicActive() || isMicFlowSuspended || !lastAudioChunk) {
      return;
    }

    clearLiveTranscribeTimer();
    liveTranscribeTimer = setTimeout(async () => {
      liveTranscribeTimer = null;
      if (!isMicActive() || liveTranscribeInFlight || !lastAudioChunk) return;
      if (isMicFlowSuspended) return;

      if (!liveChunkQueue.length || liveChunkBytes < LIVE_TRANSCRIBE_MIN_BYTES) {
        logDebug('live transcription skipped (chunk too small)', {
          queueLength: liveChunkQueue.length,
          queueBytes: liveChunkBytes,
          minBytes: LIVE_TRANSCRIBE_MIN_BYTES,
        });
        return;
      }

      const chunksToSend = liveChunkQueue.splice(0, liveChunkQueue.length);
      const chunkBytes = liveChunkBytes;
      liveChunkBytes = 0;
      const aggregatedBlob = new Blob(chunksToSend, {
        type: lastMicMimeType || mediaRecorder?.mimeType || 'audio/webm',
      });

      if (!aggregatedBlob || !aggregatedBlob.size) {
        logDebug('live transcription skipped (aggregated empty)', {
          queueLength: chunksToSend.length,
          queueBytes: chunkBytes,
        });
        return;
      }

      liveTranscribeInFlight = true;
      try {
        const text = await sendTranscriptionChunk(aggregatedBlob, {
          noStream: false,
          minBytes: LIVE_TRANSCRIBE_MIN_BYTES,
        });
        if (text && text.trim()) {
          appendTranscriptionText(text, true);
        }
      } catch (err) {
        logDebug('live transcription failed', {
          error: String(err && err.message ? err.message : err),
        });
        liveChunkQueue = chunksToSend.concat(liveChunkQueue);
        liveChunkBytes += chunkBytes;
      } finally {
        liveTranscribeInFlight = false;
      }
    }, LIVE_TRANSCRIBE_DELAY_MS);
  }

  function normalizeHeroSpeechText(text) {
    return String(text || '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isHeroSpeechReady(text) {
    return text.length >= HERO_SPEECH_MIN_LEN && /[一-龥ぁ-ゞァ-ヾa-zA-Z0-9]/.test(text);
  }

  function scheduleHeroSpeechFromTranscript(text) {
    const candidate = normalizeHeroSpeechText(text);
    if (!isHeroSpeechReady(candidate)) {
      if (heroSpeechDebounceTimer) {
        clearTimeout(heroSpeechDebounceTimer);
        heroSpeechDebounceTimer = null;
      }
      heroSpeechCandidate = '';
      return;
    }
    heroSpeechCandidate = candidate;
    if (heroSpeechDebounceTimer) {
      clearTimeout(heroSpeechDebounceTimer);
      heroSpeechDebounceTimer = null;
    }
    heroSpeechDebounceTimer = setTimeout(() => {
      if (!heroSpeechCandidate) return;

      const now = performance.now();
      if (
        heroSpeechCandidate === lastHeroSpeechSentText &&
        now - lastHeroSpeechSentAt < HERO_SPEECH_COOLDOWN_MS
      ) {
        return;
      }
      const speechText = heroSpeechCandidate;
      heroSpeechCandidate = '';
      notifyHeroSpeech(speechText);
      postMessage(`文字起こし(確定): ${speechText}`);
    }, HERO_SPEECH_IDLE_MS);
  }

  function notifyHeroSpeech(text) {
    const speechText = normalizeHeroSpeechText(text);
    if (!speechText) return;

    if (
      speechText === lastHeroSpeechSentText &&
      performance.now() - lastHeroSpeechSentAt < HERO_SPEECH_COOLDOWN_MS
    ) {
      return;
    }

    lastHeroSpeechSentText = speechText;
    lastHeroSpeechSentAt = performance.now();
    if (gameApi && typeof gameApi.onHeroSpeech === 'function') {
      gameApi.onHeroSpeech(speechText);
    }
  }

  function notifyLiveTranscript(text) {
    const speechText = normalizeHeroSpeechText(text);
    if (!speechText) return;
    if (gameApi && typeof gameApi.setLiveTranscript === 'function') {
      gameApi.setLiveTranscript(speechText);
    }
  }

  function chooseAudioMimeType() {
    for (const mt of micMimeTypes) {
      if (MediaRecorder.isTypeSupported(mt)) {
        logDebug('audio mime selected', { mimeType: mt });
        return mt;
      }
    }
    logDebug('audio mime default', { selected: 'default' });
    return '';
  }

  function buildAudioForm(blob, enableStream, chunkBase, attempt, model) {
    const ext = guessAudioExtension(blob.type);
    const fileName = `chunk-${chunkBase}-${attempt}.${ext}`;
    const file = new File([blob], fileName, {
      type: blob.type || 'audio/webm',
    });
    const form = new FormData();
    form.append('file', file);
    form.append('model', model);
    if (enableStream) {
      form.append('stream', 'true');
    }
    return { form, fileName, file };
  }

  async function sendTranscriptionChunk(blob, options = {}) {
    if (isMicFlowSuspended) {
      logDebug('audio transcription skipped (flow suspended)');
      return '';
    }

    if (!isAudioConfigReady()) {
      throw new Error('音声APIの設定がありません');
    }
    if (!blob || !blob.size) {
      return '';
    }

    const minBytes = options.minBytes ?? (options.noStream ? FINAL_TRANSCRIBE_MIN_BYTES : LIVE_TRANSCRIBE_MIN_BYTES);
    if (blob.size < minBytes) {
      logDebug('audio transcription skipped (too small)', {
        reason: 'insufficient audio size',
        size: blob.size,
        minBytes,
        stream: Boolean(options.noStream),
      });
      return '';
    }

    const baseRequestId = `a-${Date.now()}-${++audioRequestSeq}`;
    const useProxy = Boolean(window.__MISTRAL_PROXY_AUDIO_URL || window.__MISTRAL_PROXY_URL);
    const models = getAudioModelCandidates();
    const attempts = models.map((model) => ({
      stream: false,
      model,
      kind: 'wav',
    }));

    logDebug('audio transcription plan', {
      baseRequestId,
      attempts: attempts.map((attempt, index) => ({
        sequence: index + 1,
        stream: attempt.stream,
        model: attempt.model,
        kind: attempt.kind,
      })),
      blobSize: blob.size,
      blobType: blob.type || 'unknown',
    });

    const chunkBase = `n${++chunkSeq}`;

    for (let i = 0; i < attempts.length; i += 1) {
      const { stream, model, kind } = attempts[i];
      const requestId = `${baseRequestId}-${i + 1}`;
      if (!AUDIO_SEND_WAV || kind !== 'wav') {
        logDebug('audio sending skipped (unexpected kind)', { requestId, kind });
        continue;
      }

      let wavBlob = null;
      try {
        wavBlob = await toWavBlob(blob);
        if (wavBlob && wavBlob.size) {
          const wavHead = await getBlobLeadingHex(wavBlob, 24);
          logDebug('audio wav header inspect', {
            requestId,
            wavHead,
          });
        }
      } catch (err) {
        logDebug('audio wav convert failed', {
          requestId,
          reason: String(err && err.message ? err.message : err),
        });
        throw err;
      }

      const headers = {};
      if (!useProxy) {
        headers.Authorization = `Bearer ${AUDIO_API.apiKey}`;
      }
      const debugHeaders = { ...headers };
      if (debugHeaders.Authorization) {
        debugHeaders.Authorization = 'Bearer ***';
      }

      const { form, fileName, file } = buildAudioForm(
          kind === 'wav' ? wavBlob : blob,
          stream,
        chunkBase,
        i + 1,
        model
      );
      const headHex = await getBlobLeadingHex(file);
      logDebug('audio request start', {
        requestId,
        attempt: i + 1,
        stream,
        kind,
        endpoint: AUDIO_API.endpoint,
        useProxy,
        headers: debugHeaders,
        model,
        headHex,
        mimeType: file.type,
        fileSize: file.size,
        body: summarizeForm(form),
      });

      let res;
      try {
        res = await fetch(AUDIO_API.endpoint, {
          method: 'POST',
          headers,
          body: form,
        });
      } catch (networkErr) {
        console.error('[Voxtral] audio request network error', {
          requestId,
          error: String(networkErr && networkErr.message ? networkErr.message : networkErr),
        });
        throw networkErr;
      }

    if (!res.ok) {
      const errorBodyText = await res.text().catch(() => '');
      const errorBody = safeParseErrorBody(errorBodyText);
      const parsedCode = extractErrorCodeFromBody(errorBody);
      const parsedDetail = extractErrorDetailFromBody(errorBody);
      const detail =
        parsedDetail ||
        (typeof errorBodyText === 'string' && errorBodyText.length
          ? errorBodyText
          : 'No error detail');
      console.error('[Voxtral] audio request failed', {
        requestId,
        status: res.status,
        statusText: res.statusText,
        url: res.url,
        headers: toHeaderObj(res.headers),
        body: errorBodyText,
      });
      logDebug('audio request failed detail', {
        requestId,
        fileName,
        fileType: file.type,
        fileSize: file.size,
        detail,
        code: parsedCode || 'none',
        bodyPreview: summarizeBodyForLog(errorBodyText, 500),
        endpoint: AUDIO_API.endpoint,
      });
      if (isDecodeError(res.status, detail)) {
        logDebug('audio decode failure detected', {
          requestId,
          reason: detail,
        });
        if (i + 1 < attempts.length) {
          continue;
        }
      }
      if (isInvalidModelError(res.status, detail)) {
        if (i + 1 < attempts.length) {
          logDebug('audio model fallback retry', {
            requestId,
            fromModel: model,
            nextModel: attempts[i + 1].model,
            nextKind: attempts[i + 1].kind,
          });
          continue;
        }
      }
      throw new Error(`音声API ${res.status}: ${detail}`);
    }

    const contentType = res.headers.get('content-type') || '';
      logDebug('audio response headers', {
        requestId,
        contentType,
        status: res.status,
        statusText: res.statusText,
        contentLength: res.headers.get('content-length') || 'unknown',
      });
      let resultText = '';
      if (contentType.includes('text/event-stream')) {
        resultText = await readStreamingText(res, (draft) => {
          appendTranscriptionText(draft, true);
        }, extractTranscriptionText);
        if (resultText && resultText.trim()) {
          logDebug('audio stream done', { requestId, text: resultText });
          return resultText;
        }
      }

      const data = await res.json().catch(async () => {
        const fallbackText = await res.text().catch(() => '');
        logDebug('audio non-json response body', {
          requestId,
          fallbackText: summarizeBodyForLog(fallbackText, 500),
        });
        return { text: fallbackText };
      });
      const text =
        data?.text ??
        data?.transcript ??
        data?.output ??
        data?.message ??
        '';
      if (typeof text === 'string' && text) {
        appendTranscriptionText(text);
      }
      logDebug('audio non-stream response', { requestId, data });
      return text;
    }

    return '';
  }

  function enqueueAudioChunk(blob) {
    if (!blob || !blob.size || !isMicActive()) {
      logDebug('enqueueAudioChunk skipped', {
        hasData: Boolean(blob),
        size: blob ? blob.size : 0,
        state: isMicActive() ? 'active' : 'inactive',
      });
      return;
    }
    liveChunkQueue.push(blob);
    liveChunkBytes += blob.size;
    logDebug('media recorder chunk buffered', {
      size: blob.size,
      type: blob.type || 'unknown',
      state: 'active',
    });
    lastAudioChunk = blob;
    recordedChunks.push(blob);
  }

  async function startMicCapture() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      postMessage('このブラウザはMediaRecorderをサポートしていません。');
      return;
    }
    if (!isAudioConfigReady()) {
      postMessage('音声API未設定: window.__MISTRAL_API_KEY または window.__MISTRAL_PROXY_URL を設定してください。');
      return;
    }
    if (isRequesting) {
      postMessage('AI応答中は一時的にマイク開始をブロックします。');
      return;
    }
    if (micActive) {
      logDebug('mic start ignored (already active)');
      return;
    }
    isMicFlowSuspended = false;
    logDebug('mic start requested', {
      hasMediaDevices: Boolean(navigator.mediaDevices),
      hasMediaRecorder: Boolean(window.MediaRecorder),
      audioConfigReady: isAudioConfigReady(),
    });

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      const mimeType = chooseAudioMimeType();
      const options = mimeType ? { mimeType } : undefined;
      mediaRecorder = new MediaRecorder(mediaStream, options);
      lastMicMimeType = options?.mimeType || mediaRecorder.mimeType || mimeType || 'audio/webm';
      logDebug('media recorder created', {
        mimeType: options?.mimeType || 'default',
        state: mediaRecorder.state,
      });
      transcriptionText = '';
      clearLiveTranscript();
      heroSpeechCandidate = '';
      clearLiveTranscribeTimer();
      liveTranscribeInFlight = false;
      if (heroSpeechDebounceTimer) {
        clearTimeout(heroSpeechDebounceTimer);
        heroSpeechDebounceTimer = null;
      }
      chunkSeq = 0;
      recordedChunks = [];
      liveChunkQueue = [];
      liveChunkBytes = 0;
      lastAudioChunk = null;
      postMessage('音声入力を開始しました。しゃべるとリアルタイムで文字起こしします。');
      setMicBusy(true);
      notifyHeroListening(true);

      mediaRecorder.onstart = () => {
        logDebug('media recorder onstart', { state: mediaRecorder.state });
      };

      mediaRecorder.ondataavailable = (event) => {
        if (!event.data || event.data.size <= 0) {
          logDebug('media recorder empty chunk');
          return;
        }
        logDebug('media recorder chunk available', { size: event.data.size, type: event.data.type || 'unknown' });
        enqueueAudioChunk(event.data);
        requestLiveTranscription();
      };

      mediaRecorder.onerror = (event) => {
        console.error('[Voxtral] recorder error', event.error);
        postMessage(`音声入力エラー: ${String(event.error && event.error.message ? event.error.message : 'unknown')}`);
      };

      // Start with timeslice to receive periodic chunks for live commands.
      // This lets child commands be accepted without stopping mic.
      mediaRecorder.start(MIC_TIMESLICE_MS);
      logDebug('media recorder started', {
        timesliceMs: MIC_TIMESLICE_MS,
        state: mediaRecorder.state,
      });
    } catch (err) {
      console.error('[Voxtral] mic start error', err);
      setMicBusy(false);
      notifyHeroListening(false);
      if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop());
        mediaStream = null;
      }
      postMessage(`音声開始失敗: ${String(err.message || err)}`);
    }
  }

  async function stopMicCapture(options = {}) {
    const { finalize = true } = options || {};
    isMicFlowSuspended = true;
    if (heroSpeechDebounceTimer) {
      clearTimeout(heroSpeechDebounceTimer);
      heroSpeechDebounceTimer = null;
    }
    clearLiveTranscribeTimer();
    liveTranscribeInFlight = false;
    heroSpeechCandidate = '';

    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      liveChunkQueue = [];
      liveChunkBytes = 0;
      if (micActive) {
        setMicBusy(false);
      }
      notifyHeroListening(false);
      isMicFlowSuspended = !finalize;
      logDebug('mic stop ignored', {
        hasRecorder: Boolean(mediaRecorder),
        state: mediaRecorder ? mediaRecorder.state : 'none',
      });
      return;
    }

    await new Promise((resolve) => {
      const prevOnStop = mediaRecorder.onstop;
      mediaRecorder.onstop = () => {
        logDebug('media recorder onstop', { state: mediaRecorder.state });
        if (typeof prevOnStop === 'function') {
          prevOnStop();
        }
        resolve();
      };
      mediaRecorder.stop();
    });

    await new Promise((resolve) => setTimeout(resolve, MIC_STOP_FLUSH_DELAY_MS));

    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }

    const validChunks = recordedChunks.filter((chunk) => chunk && chunk.size > 0);
    if (lastAudioChunk && !validChunks.includes(lastAudioChunk) && lastAudioChunk.size > 0) {
      validChunks.push(lastAudioChunk);
    }

    const finalBlob = validChunks.length
      ? new Blob(validChunks, {
          type: lastMicMimeType || mediaRecorder?.mimeType || 'audio/webm',
        })
      : new Blob([], {
          type: lastMicMimeType || mediaRecorder?.mimeType || 'audio/webm',
        });

    const finalBytes = finalBlob && finalBlob.size ? finalBlob.size : 0;
    if (finalize) {
      if (finalBytes >= FINAL_TRANSCRIBE_MIN_BYTES) {
        liveChunkQueue = [];
        liveChunkBytes = 0;
        const headHex = await getBlobLeadingHex(finalBlob);
        logDebug('final audio blob ready', {
          size: finalBlob.size,
          type: finalBlob.type,
          chunks: recordedChunks.length,
          headHex,
        });
        try {
          const text = await sendTranscriptionChunk(finalBlob, { noStream: true });
          if (text && text.trim()) {
            transcriptionText = text;
          } else {
            postMessage('音声文字起こし: 0文字（文字起こしできませんでした）');
          }
        } catch (err) {
          console.error('[Voxtral] final audio request failed', err);
          postMessage(`音声再送信失敗: ${String(err.message || err)}`);
        }
      } else {
        logDebug('final audio blob missing', {
          chunks: recordedChunks.length,
          lastChunk: !!lastAudioChunk,
        });
        const fallbackMessage =
          finalBytes > 0
            ? `音声文字起こし: 0文字（録音データが短すぎます: ${finalBytes} bytes）`
            : '音声文字起こし: 0文字（録音データなし）';
        postMessage(fallbackMessage);
      }
    }
    isMicFlowSuspended = finalize ? false : true;
    setMicBusy(false);
    notifyHeroListening(false);
    if (finalize && transcriptionText && transcriptionText.trim()) {
      const spokenText = transcriptionText.trim();
      notifyHeroSpeech(spokenText);
      postMessage(spokenText);
      logDebug('final transcript', {
        length: transcriptionText.length,
        text: transcriptionText,
      });
    } else if (finalize) {
      postMessage('音声文字起こし: 0文字');
    }
  }

  function setupIntegration(api) {
    if (!api || typeof api !== 'object') {
      gameApi = null;
      postMessage('VoxtralはゲームAPI未接続です。');
      return;
    }
    gameApi = api;
    logDebug('voxtral endpoint config', {
      chatEndpoint: CHAT_API.endpoint,
      audioEndpoint: AUDIO_API.endpoint,
      proxyAudio: !!window.__MISTRAL_PROXY_AUDIO_URL,
      proxyMain: !!window.__MISTRAL_PROXY_URL,
      useProxyMainAudio:
        Boolean(window.__MISTRAL_PROXY_AUDIO_URL || window.__MISTRAL_PROXY_URL),
      audioModelCandidates: getAudioModelCandidates(),
      chatModelCandidates: getChatModelCandidates(),
    });
    if (!isConfigReady()) {
      postMessage('音声APIは未接続です: window.__MISTRAL_API_KEY または window.__MISTRAL_PROXY_URL を設定してください。');
    }
    logDebug('setupIntegration', {
      hasSetMessage: !!(gameApi && typeof gameApi.setMessage === 'function'),
      hasGetState: !!(gameApi && typeof gameApi.getState === 'function'),
      hasOnHeroSpeech: !!(gameApi && typeof gameApi.onHeroSpeech === 'function'),
      hasSetLiveTranscript: !!(gameApi && typeof gameApi.setLiveTranscript === 'function'),
    });
  }

  function clearLiveTranscript() {
    if (gameApi && typeof gameApi.setLiveTranscript === 'function') {
      gameApi.setLiveTranscript('');
    }
  }

  window.startVoxtralMic = startMicCapture;
  window.stopVoxtralMic = stopMicCapture;
  window.pauseVoxtralMic = () => stopMicCapture({ finalize: false });
  window.resumeVoxtralMic = () => startMicCapture();
  window.setupVoxtralIntegration = setupIntegration;

  if (micButton) {
    micButton.disabled = false;
    micButton.addEventListener('click', () => {
      if (!micActive) {
        startMicCapture();
      } else {
        stopMicCapture();
      }
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M' || e.code === 'KeyM') {
      e.preventDefault();
      if (!micActive) {
        startMicCapture();
      } else {
        stopMicCapture();
      }
    }
  });

  // デバッグ用: テストボタンのイベントリスナー
  const testRedRoofButton = document.getElementById('test-red-roof');
  const testTwoWindowsButton = document.getElementById('test-two-windows');
  const testTwoDotsButton = document.getElementById('test-two-dots');

  if (testRedRoofButton) {
    testRedRoofButton.addEventListener('click', () => {
      sendTestAudio('wav/build_a_red_roof.wav');
    });
  }

  if (testTwoWindowsButton) {
    testTwoWindowsButton.addEventListener('click', () => {
      sendTestAudio('wav/put_two_windows.wav');
    });
  }

  if (testTwoDotsButton) {
    testTwoDotsButton.addEventListener('click', () => {
      sendTestAudio('wav/there should be two .mp3');
    });
  }

  // テスト用オーディオファイル送信関数
  async function sendTestAudio(filePath) {
    if (isRequesting) {
      logDebug('前のリクエストが完了していません');
      return;
    }

    try {
      isRequesting = true;
      logDebug(`テストオーディオ送信開始: ${filePath}`);

      // ファイルをfetchで読み込む
      const response = await fetch(filePath);
      if (!response.ok) {
        throw new Error(`ファイル読み込み失敗: ${response.status} - ${filePath}`);
      }

      const audioBlob = await response.blob();
      logDebug(`オーディオファイル読み込み完了: ${audioBlob.size} bytes, type: ${audioBlob.type}`);

      const resultText = await sendTranscriptionChunk(audioBlob, {
        noStream: true,
        minBytes: 1,
      });
      if (!resultText || !resultText.trim()) {
        postMessage('テスト音声: 0文字（文字起こしできませんでした）');
        return;
      }

      transcriptionText = resultText;
      if (typeof setLiveTranscript === 'function') {
        setLiveTranscript(transcriptionText);
      }
      if (gameApi && typeof gameApi.startCommandLineup === 'function') {
        gameApi.startCommandLineup();
      }
      if (gameApi && typeof gameApi.onHeroSpeech === 'function') {
        gameApi.onHeroSpeech(transcriptionText);
      }
      logDebug(`認識テキスト: ${transcriptionText}`);
    } catch (error) {
      logDebug('テストオーディオ送信エラー:', error);
      postMessage(`テスト音声処理失敗: ${String(error && error.message ? error.message : error)}`);
    } finally {
      isRequesting = false;
    }
  }
})();
