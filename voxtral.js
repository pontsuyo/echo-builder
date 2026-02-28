(function () {
  const micButton = document.getElementById('ask-voxtral-mic');
  const VOXTRAL_MODEL = 'voxtral-mini-latest';
  const AUDIO_SEND_NATIVE_FIRST = true;
  const AUDIO_SEND_WAV_FALLBACK = true;
  const AUDIO_MODEL_CANDIDATES = [VOXTRAL_MODEL];
  const USE_PCM_LIVE_CAPTURE = true;
  const PCM_LIVE_AS_LIVE_SOURCE = true;
  const AUDIO_ENDPOINT_PATH = '/v1/audio/transcriptions';
  const MIC_TIMESLICE_MS = 1400;
  const MIC_STOP_FLUSH_DELAY_MS = 120;

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

  function withDocStreamAnchor(url) {
    const raw = String(url || '').trim();
    if (!raw) return raw;
    const noHash = raw.split('#')[0];
    return `${noHash}#stream`;
  }

  const AUDIO_API = {
      endpoint:
      withDocStreamAnchor(
        buildEndpoint({
        explicit: window.__MISTRAL_AUDIO_TRANSCRIPT_URL,
        proxy: window.__MISTRAL_PROXY_AUDIO_URL || window.__MISTRAL_PROXY_URL,
        fallback: `https://api.mistral.ai${AUDIO_ENDPOINT_PATH}`,
        path: AUDIO_ENDPOINT_PATH,
        })
      ),
    apiKey: window.__MISTRAL_API_KEY || '',
    model: VOXTRAL_MODEL,
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
  let liveTranscriptionPendingText = '';
  let liveTranscriptionPendingTimer = null;
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
  const LIVE_TRANSCRIBE_DELAY_MS = 100;
  const LIVE_TRANSCRIBE_MIN_BYTES = 16000;
  const LIVE_TRANSCRIBE_TARGET_MS = 1000;
  const LIVE_STREAM_MAX_WINDOW_MS = 4500;
  const LIVE_STREAM_MIN_COMMIT_LEN = 8;
  const LIVE_STREAM_COMMIT_GRACE_MS = 550;
  const FINAL_TRANSCRIBE_MIN_BYTES = 16000;
  const DISPLAY_FINAL_TRANSCRIPT = false;
  const LIVE_ONLY_PIPELINE = true;
  const LIVE_DUPLICATE_GUARD_MS = 1400;
  const LIVE_STREAM_OVERLAP_CHARS = 180;
  const LIVE_PCM_NOISE_GATE_ENABLED = true;
  const LIVE_PCM_NOISE_GATE_RMS = 0.0018;
  const AUDIO_REQUEST_LANGUAGE = 'en';
  const AUDIO_REQUEST_TEMPERATURE = 0.0;
  const AUDIO_REQUEST_DIARIZE = false;
  const AUDIO_REQUEST_TIMESTAMP_GRANULARITIES = ['word'];
  const AUDIO_STREAM_MIN_TEXT_LEN = 4;
  const AUDIO_STREAM_SHORT_TEXT_RETRY = true;
  const AUDIO_REQUEST_CONTEXT_BIAS = [
    'build',
    'builds',
    'house',
    'houses',
    'tower',
    'wall',
    'bridge',
    'door',
    'window',
    'road',
    'create',
    'add',
  ];
  let liveTranscribeTimer = null;
  let liveTranscribeInFlight = false;
  let liveTranscribePending = false;
  let liveChunkQueue = [];
  let liveChunkBytes = 0;
  let liveAudioContext = null;
  let liveMediaStreamSource = null;
  let liveAudioProcessor = null;
  let liveAudioGain = null;
  let livePcmChunkQueue = [];
  let livePcmBytes = 0;
  let livePcmSampleRate = 0;
  let livePcmSilenceFrames = 0;
  let liveTranscriptSessionStartAt = 0;
  const isMicActive = () => micActive;

  function notifyHeroListening(active) {
    if (gameApi && typeof gameApi.setHeroListening === 'function') {
      gameApi.setHeroListening(active);
    }
  }

  const micMimeTypes = [
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/webm;codecs=opus',
    'audio/webm',
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
    micButton.textContent = active ? 'マイク停止' : 'START';
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

  function floatToInt16Sample(value) {
    const clamped = Math.max(-1, Math.min(1, value));
    return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
  }

  function pcmToWavBlob(int16Chunks, sampleRate, channelCount = 1) {
    if (!int16Chunks.length) {
      throw new Error('音声データがありません');
    }
    const merged = new Int16Array(int16Chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (let i = 0; i < int16Chunks.length; i += 1) {
      const chunk = int16Chunks[i];
      if (!chunk || !chunk.length) continue;
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const samples = merged.length / channelCount;
    const bytesPerSample = 2;
    const byteRate = sampleRate * channelCount * bytesPerSample;
    const blockAlign = channelCount * bytesPerSample;
    const dataSize = samples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeString = (pos, str) => {
      for (let i = 0; i < str.length; i += 1) {
        view.setUint8(pos + i, str.charCodeAt(i));
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

    let writeOffset = 44;
    for (let i = 0; i < merged.length; i += 1) {
      view.setInt16(writeOffset, merged[i], true);
      writeOffset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  function stopPcmCapture() {
    if (liveAudioProcessor) {
      liveAudioProcessor.onmessage = null;
      liveAudioProcessor.onaudioprocess = null;
      try {
        liveAudioProcessor.disconnect();
      } catch {
      }
      liveAudioProcessor = null;
    }
    if (liveMediaStreamSource) {
      try {
        liveMediaStreamSource.disconnect();
      } catch {
      }
      liveMediaStreamSource = null;
    }
    if (liveAudioGain) {
      try {
        liveAudioGain.disconnect();
      } catch {
      }
      liveAudioGain = null;
    }
    if (liveAudioContext && liveAudioContext.state !== 'closed') {
      liveAudioContext.close().catch(() => {});
    }
    liveAudioContext = null;
    livePcmChunkQueue = [];
    livePcmBytes = 0;
    livePcmSampleRate = 0;
    livePcmSilenceFrames = 0;
  }

  function getRmsAmplitude(floatSamples) {
    if (!floatSamples || !floatSamples.length) return 0;
    let sum = 0;
    for (let i = 0; i < floatSamples.length; i += 1) {
      const value = floatSamples[i] || 0;
      sum += value * value;
    }
    return Math.sqrt(sum / floatSamples.length);
  }

  function getLiveMinBytes() {
    const sampleRate = livePcmSampleRate || 44100;
    return Math.max(
      LIVE_TRANSCRIBE_MIN_BYTES,
      Math.round(sampleRate * 2 * (LIVE_TRANSCRIBE_TARGET_MS / 1000))
    );
  }

  function getLiveMaxWindowBytes() {
    const sampleRate = livePcmSampleRate || 44100;
    return Math.max(
      LIVE_TRANSCRIBE_MIN_BYTES,
      Math.round(sampleRate * 2 * (LIVE_STREAM_MAX_WINDOW_MS / 1000))
    );
  }

  function pushLivePcmChunk(floatChunks, sampleRate) {
    if (!floatChunks.length || !sampleRate) return;
    const rms = getRmsAmplitude(floatChunks);
    if (LIVE_PCM_NOISE_GATE_ENABLED && rms < LIVE_PCM_NOISE_GATE_RMS) {
      livePcmSilenceFrames += 1;
      if (livePcmSilenceFrames <= 2) {
        logDebug('live pcm chunk skipped by silence gate', {
          rms,
        });
      }
      return;
    }
    livePcmSilenceFrames = 0;

    const int16Chunk = new Int16Array(floatChunks.length);
    for (let i = 0; i < floatChunks.length; i += 1) {
      int16Chunk[i] = floatToInt16Sample(floatChunks[i]);
    }
    logDebug('live pcm chunk buffered', {
      sampleCount: int16Chunk.length,
      byteLength: int16Chunk.byteLength,
      queueBytesBefore: livePcmBytes,
      sampleRate,
    });
    livePcmChunkQueue.push(int16Chunk);
    livePcmBytes += int16Chunk.byteLength;
    livePcmSampleRate = sampleRate;

    const liveMinBytes = getLiveMinBytes();
    if (livePcmBytes >= liveMinBytes) {
      logDebug('live pcm threshold reached', {
        threshold: liveMinBytes,
        currentBytes: livePcmBytes,
      });
      try {
        const wavBlob = pcmToWavBlob(livePcmChunkQueue, livePcmSampleRate, 1);
        logDebug('live pcm wav converted', {
          wavSize: wavBlob.size,
          wavType: wavBlob.type || 'audio/wav',
          segments: livePcmChunkQueue.length,
        });
        livePcmChunkQueue = [];
        livePcmBytes = 0;
        enqueueAudioChunk(wavBlob, {
          trackForLive: true,
          trackForFinal: false,
        });
        logDebug('live pcm request requested', {
          pendingLiveQueueBytes: liveChunkBytes,
          pendingLiveQueueLength: liveChunkQueue.length,
        });
        requestLiveTranscription();
      } catch (err) {
        logDebug('audio pcm wav convert failed', {
          reason: String(err && err.message ? err.message : err),
          sampleRate,
          chunkBytes: livePcmBytes,
        });
      }
    }
  }

  function startPcmCapture(stream) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      throw new Error('AudioContextが利用できません');
    }
    if (!stream) {
      throw new Error('音声入力ストリームがありません');
    }

    liveAudioContext = new AudioCtx();
    liveMediaStreamSource = liveAudioContext.createMediaStreamSource(stream);
    liveAudioProcessor = liveAudioContext.createScriptProcessor(2048, 1, 1);
    liveAudioGain = liveAudioContext.createGain();
    liveAudioGain.gain.value = 0;

    livePcmSampleRate = liveAudioContext.sampleRate;
    liveAudioProcessor.onaudioprocess = (event) => {
      if (!isMicActive() || isMicFlowSuspended) return;
      const input = event.inputBuffer.getChannelData(0);
      if (!input || !input.length) return;
      const mixedSamples = new Float32Array(input.length);
      mixedSamples.set(input);
      pushLivePcmChunk(mixedSamples, livePcmSampleRate);
    };

    liveMediaStreamSource.connect(liveAudioProcessor);
    liveAudioProcessor.connect(liveAudioGain);
    liveAudioGain.connect(liveAudioContext.destination);
    logDebug('live pcm capture started', {
      sampleRate: livePcmSampleRate,
      processor: 'scriptprocessor',
    });
  }

  function guessAudioExtension(mimeType) {
    if (!mimeType) return 'webm';
    const t = String(mimeType).toLowerCase();
    if (t.includes('mp3') || t.includes('mpeg')) return 'mp3';
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
    return uniqueFromList([VOXTRAL_MODEL, ...AUDIO_MODEL_CANDIDATES]);
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

  function isUnsupportedAudioError(status, detail) {
    if (status !== 400) return false;
    const text = String(detail || '').toLowerCase();
    return (
      text.includes('unsupported') ||
      text.includes('unsupported format') ||
      text.includes('invalid file type') ||
      text.includes('invalid media type') ||
      text.includes('media type')
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
    let parsedFrames = 0;
    let emittedFrames = 0;
    logDebug('stream reader start');

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
            parsedFrames += 1;
            if (parsedFrames <= 8) {
              logDebug('stream frame parsed', {
                frame: parsedFrames,
                hasDelta: Boolean(delta),
                deltaPreview: typeof delta === 'string' ? delta.slice(0, 120) : '',
              });
            }
            if (typeof delta === 'string' && delta) {
              const mergedText = mergeStreamingChunkText(doneText, delta);
              if (mergedText !== doneText) {
                logDebug('stream chunk merged', {
                  frame: parsedFrames,
                  hasMerge: true,
                  mergedPreview: mergedText.slice(0, 120),
                });
                doneText = mergedText;
                onChunk(doneText);
                emittedFrames += 1;
              }
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
          parsedFrames += 1;
          if (parsedFrames <= 8) {
            logDebug('stream tail frame parsed', {
              frame: parsedFrames,
              hasDelta: Boolean(delta),
              deltaPreview: typeof delta === 'string' ? delta.slice(0, 120) : '',
            });
          }
          if (typeof delta === 'string' && delta) {
            const mergedText = mergeStreamingChunkText(doneText, delta);
            if (mergedText !== doneText) {
              logDebug('stream tail chunk merged', {
                frame: parsedFrames,
                hasMerge: true,
                mergedPreview: mergedText.slice(0, 120),
              });
              doneText = mergedText;
              onChunk(doneText);
              emittedFrames += 1;
            }
          }
        } catch {
          logDebug('sse tail parse failed', {
            payloadPreview: payload.slice(0, 120),
          });
        }
      }
    }

    logDebug('stream reader end', {
      parsedFrames,
      emittedFrames,
      finalTextLength: doneText.length,
      finalTextPreview: doneText.slice(0, 120),
    });
    return doneText;
  }

  function extractTranscriptionText(data) {
    return (
      data?.text ??
      data?.transcript ??
      data?.transcription ??
      data?.segments?.[0]?.text ??
      data?.segments?.[0]?.transcript ??
      data?.choices?.[0]?.text ??
      data?.choices?.[0]?.delta?.text ??
      data?.choices?.[0]?.delta?.content ??
      data?.delta?.text ??
      data?.delta?.content ??
      data?.output?.text ??
      data?.output ??
      data?.message ??
      ''
    );
  }

  function mergeTranscriptText(nextText, current) {
    const currentText = String(current || '').trim();
    const incomingText = String(nextText || '').trim();
    if (!incomingText) return currentText;
    if (!currentText) return incomingText;
    if (incomingText.startsWith(currentText)) return incomingText;
    if (currentText.startsWith(incomingText)) return currentText;
    const overlap = overlapLength(currentText, incomingText);
    if (overlap) {
      return `${currentText}${incomingText.slice(overlap)}`;
    }
    return `${currentText} ${incomingText}`;
  }

  function normalizeTranscriptText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function overlapLength(leftText, rightText, maxLen = LIVE_STREAM_OVERLAP_CHARS) {
    const left = String(leftText || '');
    const right = String(rightText || '');
    if (!left || !right) return 0;
    const maxOverlap = Math.min(left.length, right.length, maxLen);
    for (let n = maxOverlap; n >= 1; n -= 1) {
      if (left.slice(-n) === right.slice(0, n)) {
        return n;
      }
    }
    return 0;
  }

  function extractTranscriptDelta(previousText, nextText) {
    const prev = String(previousText || '').trim();
    const next = String(nextText || '').trim();
    if (!next) return '';
    if (!prev) return next;
    if (next.startsWith(prev)) return next.slice(prev.length).trim();
    if (prev.startsWith(next)) return '';
    const overlap = overlapLength(prev, next);
    return overlap ? next.slice(overlap).trim() : next;
  }

  function normalizeLiveCommitCandidate(text) {
    return normalizeTranscriptText(text)
      .replace(/^(?:the|it|a|an|to|and)\s+/i, '')
      .trim();
  }

  function isShortLiveCommitCandidate(text) {
    const normalized = normalizeLiveCommitCandidate(text);
    if (!normalized) return true;
    if (/[.!?。！？]$/.test(normalized)) return false;
    return normalized.length < LIVE_STREAM_MIN_COMMIT_LEN;
  }

  function clearLiveTranscriptPending(commitPending = false) {
    if (liveTranscriptionPendingTimer) {
      clearTimeout(liveTranscriptionPendingTimer);
      liveTranscriptionPendingTimer = null;
    }
    if (!commitPending) {
      liveTranscriptionPendingText = '';
    }
  }

  function flushLiveTranscriptPending() {
    if (!liveTranscriptionPendingText) return;
    const pendingText = liveTranscriptionPendingText;
    clearLiveTranscriptPending(true);
    liveTranscriptionPendingText = '';
    const mergedText = mergeTranscriptText(pendingText, transcriptionText);
    if (!mergedText || mergedText === transcriptionText) return;
    transcriptionText = mergedText;
    logDebug('appendTranscriptionText pending flush', {
      pendingLength: pendingText.length,
      mergedLength: transcriptionText.length,
      mergedPreview: transcriptionText.slice(0, 120),
    });
    postMessage(transcriptionText);
    notifyLiveTranscript(transcriptionText);
    scheduleHeroSpeechFromTranscript(transcriptionText);
  }

  function splitTranscriptTokens(text) {
    const normalized = normalizeTranscriptText(text).toLowerCase();
    if (!normalized) return [];
    return normalized
      .replace(/[^\w一-龥ぁ-ヾァ-ヿ0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function hasTokenPrefix(tokens, prefix) {
    if (!prefix.length || tokens.length < prefix.length) return false;
    for (let i = 0; i < prefix.length; i += 1) {
      if (tokens[i] !== prefix[i]) return false;
    }
    return true;
  }

  function squashLeadingRepeat(prevText, incomingText) {
    const prev = normalizeTranscriptText(prevText);
    const incoming = normalizeTranscriptText(incomingText);
    if (!prev || !incoming) return incoming;

    const prevLower = prev.toLowerCase();
    const incomingLower = incoming.toLowerCase();
    if (!incomingLower.startsWith(prevLower)) {
      return incoming;
    }

    const prevTokens = splitTranscriptTokens(prev);
    const incomingTokens = splitTranscriptTokens(incoming);
    if (!prevTokens.length || !incomingTokens.length) return incoming;
    if (!hasTokenPrefix(incomingTokens, prevTokens)) return incoming;

    let reduced = incomingTokens;
    let changed = false;
    while (reduced.length >= prevTokens.length * 2) {
      const tail = reduced.slice(prevTokens.length);
      if (!hasTokenPrefix(tail, prevTokens)) break;
      reduced = tail;
      changed = true;
    }

    if (!changed) return incoming;
    return reduced.length ? reduced.join(' ') : prev;
  }

  function normalizeLiveChunkForMerge(prevText, rawChunkText) {
    const normalized = normalizeTranscriptText(rawChunkText);
    if (!normalized) return '';

    if (!liveTranscriptSessionStartAt) {
      return normalized;
    }

    const elapsed = performance.now() - liveTranscriptSessionStartAt;
    if (elapsed <= LIVE_DUPLICATE_GUARD_MS) {
      return squashLeadingRepeat(prevText, normalized);
    }

    return normalized;
  }

  function mergeStreamingChunkText(currentText, incomingText) {
    return mergeTranscriptText(incomingText, currentText);
  }

  function appendTranscriptionText(chunkText, fromStream = false) {
    const incomingText = fromStream
      ? normalizeLiveChunkForMerge(transcriptionText, chunkText)
      : normalizeHeroSpeechText(chunkText);

    if (!incomingText) {
      logDebug('appendTranscriptionText ignored', {
        fromStream,
        reason: 'empty after normalization',
      });
      return;
    }

    logDebug('appendTranscriptionText called', {
      fromStream,
      incomingLength: incomingText ? incomingText.length : 0,
      currentLength: transcriptionText ? transcriptionText.length : 0,
      incomingPreview: incomingText.slice(0, 120),
    });

    const mergedText = mergeTranscriptText(incomingText, transcriptionText);

    if (liveTranscriptionPendingText) {
      clearLiveTranscriptPending();
      liveTranscriptionPendingText = '';
    }
    if (!mergedText || mergedText === transcriptionText) {
      logDebug('appendTranscriptionText unchanged', {
        fromStream,
        mergedTextLength: mergedText ? mergedText.length : 0,
      });
      return;
    }
    if (fromStream && isShortLiveCommitCandidate(mergedText)) {
      clearLiveTranscriptPending();
      liveTranscriptionPendingText = mergedText;
      liveTranscriptionPendingTimer = setTimeout(() => {
        flushLiveTranscriptPending();
      }, LIVE_STREAM_COMMIT_GRACE_MS);
      logDebug('appendTranscriptionText deferred', {
        fromStream,
        pendingLength: liveTranscriptionPendingText.length,
        pendingPreview: liveTranscriptionPendingText.slice(0, 120),
      });
      return;
    }
    if (fromStream && !extractTranscriptDelta(transcriptionText, mergedText)) {
      return;
    }
    transcriptionText = mergedText;
    logDebug('appendTranscriptionText merged', {
      mergedLength: transcriptionText ? transcriptionText.length : 0,
      mergedPreview: transcriptionText ? transcriptionText.slice(0, 120) : '',
    });
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
    logDebug('requestLiveTranscription entered', {
      active: isMicActive(),
      suspended: isMicFlowSuspended,
      queueLength: liveChunkQueue.length,
      queueBytes: liveChunkBytes,
      inFlight: liveTranscribeInFlight,
      timerActive: Boolean(liveTranscribeTimer),
      hasLastChunk: Boolean(lastAudioChunk),
    });

    if (!isMicActive() || isMicFlowSuspended || !liveChunkQueue.length) {
      logDebug('requestLiveTranscription skipped', {
        reason: !isMicActive()
          ? 'not active'
          : isMicFlowSuspended
            ? 'flow suspended'
            : 'empty live queue',
      });
      return;
    }

    if (liveTranscribeTimer) {
      logDebug('live transcription deferred (timer already pending)', {
        queueLength: liveChunkQueue.length,
        queueBytes: liveChunkBytes,
      });
      return;
    }
    if (liveTranscribeInFlight) {
      liveTranscribePending = true;
      logDebug('live transcription deferred (in flight)', {
        queueLength: liveChunkQueue.length,
        queueBytes: liveChunkBytes,
      });
      return;
    }

    liveTranscribeTimer = setTimeout(async () => {
      liveTranscribeTimer = null;
      const liveMinBytes = getLiveMinBytes();
      logDebug('live transcription timer fired', {
        active: isMicActive(),
        inFlight: liveTranscribeInFlight,
        queueLength: liveChunkQueue.length,
        queueBytes: liveChunkBytes,
        suspended: isMicFlowSuspended,
        hasLastChunk: Boolean(lastAudioChunk),
      });

      if (!isMicActive() || liveTranscribeInFlight || !lastAudioChunk) {
        if (liveTranscribeInFlight) {
          liveTranscribePending = true;
        }
        logDebug('live transcription timer abort', {
          reason: !isMicActive()
            ? 'not active'
            : liveTranscribeInFlight
              ? 'request in flight'
              : 'no last audio chunk',
        });
        return;
      }
      if (isMicFlowSuspended) {
        logDebug('live transcription timer abort', {
          reason: 'flow suspended after timer',
        });
        return;
      }

      if (!liveChunkQueue.length || liveChunkBytes < liveMinBytes) {
        logDebug('live transcription skipped (chunk too small)', {
          queueLength: liveChunkQueue.length,
          queueBytes: liveChunkBytes,
          minBytes: liveMinBytes,
        });
        if (liveChunkBytes >= LIVE_TRANSCRIBE_MIN_BYTES) {
          liveTranscribePending = true;
        }
        return;
      }

      const chunksToSend = liveChunkQueue.splice(0, liveChunkQueue.length);
      const chunkBytes = liveChunkBytes;
      liveChunkBytes = 0;
      logDebug('live transcription dequeued', {
        chunkCount: chunksToSend.length,
        chunkBytes,
        remainingQueueLength: liveChunkQueue.length,
      });
      const chunkType =
        chunksToSend[0]?.type ||
        lastMicMimeType ||
        mediaRecorder?.mimeType ||
        'audio/wav';
      const aggregatedBlob = new Blob(chunksToSend, {
        type: chunkType,
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
        logDebug('live transcription request dispatch', {
          chunkBytes: aggregatedBlob.size,
          chunkType: aggregatedBlob.type || 'unknown',
          chunkCount: chunksToSend.length,
        });
        const text = await sendTranscriptionChunk(aggregatedBlob, {
          noStream: false,
          minBytes: liveMinBytes,
        });
        if (text && text.trim()) {
          appendTranscriptionText(text, true);
        }
      } catch (err) {
        logDebug('live transcription failed', {
          error: String(err && err.message ? err.message : err),
          chunkCount: chunksToSend.length,
          chunkBytes,
        });
        liveChunkQueue = chunksToSend.concat(liveChunkQueue);
        liveChunkBytes += chunkBytes;
        logDebug('live transcription queue restored', {
          queueLength: liveChunkQueue.length,
          queueBytes: liveChunkBytes,
        });
      } finally {
        liveTranscribeInFlight = false;
        logDebug('live transcription inFlight reset', {
          inFlight: liveTranscribeInFlight,
        });
        if (liveTranscribePending && !liveTranscribeTimer) {
          liveTranscribePending = false;
          requestLiveTranscription();
        }
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
    if (gameApi && typeof gameApi.startCommandLineup === 'function') {
      gameApi.startCommandLineup({ silentIfActive: true });
    }
    if (gameApi && typeof gameApi.onHeroSpeech === 'function') {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          gameApi.onHeroSpeech(speechText);
        });
      });
    }
  }

  function notifyLiveTranscript(text) {
    const speechText = normalizeHeroSpeechText(text);
    if (!speechText) return;
    logDebug('notifyLiveTranscript', {
      speechText: speechText.slice(0, 120),
      hasSetter: Boolean(gameApi && typeof gameApi.setLiveTranscript === 'function'),
    });
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
    const resolvedModel = model || VOXTRAL_MODEL;
    const ext = guessAudioExtension(blob.type);
    const fileName = `chunk-${chunkBase}-${attempt}.${ext}`;
    const file = new File([blob], fileName, {
      type: blob.type || 'audio/webm',
    });
    const form = new FormData();
    form.append('file', file);
    form.append('model', resolvedModel);
    form.append('language', AUDIO_REQUEST_LANGUAGE);
    form.append('temperature', String(AUDIO_REQUEST_TEMPERATURE));
    if (AUDIO_REQUEST_DIARIZE !== false) {
      form.append('diarize', AUDIO_REQUEST_DIARIZE ? 'true' : 'false');
    }
    if (Array.isArray(AUDIO_REQUEST_TIMESTAMP_GRANULARITIES) && AUDIO_REQUEST_TIMESTAMP_GRANULARITIES.length) {
      for (const granularity of AUDIO_REQUEST_TIMESTAMP_GRANULARITIES) {
        const value = String(granularity || '').trim();
        if (value) {
          form.append('timestamp_granularities', value);
        }
      }
    }
    if (Array.isArray(AUDIO_REQUEST_CONTEXT_BIAS) && AUDIO_REQUEST_CONTEXT_BIAS.length) {
      for (const phrase of AUDIO_REQUEST_CONTEXT_BIAS) {
        const value = String(phrase || '').trim();
        if (value) {
          form.append('context_bias', value);
        }
      }
    }
    if (enableStream) {
      form.append('stream', 'true');
    }
    return { form, fileName, file };
  }

  async function parseAudioTextFromResponse(res, requestId, requestExtractor, onStreamChunk) {
    const responseId = requestId || 'unknown';
    const contentType = res.headers.get('content-type') || '';
    logDebug('audio response headers', {
      requestId: responseId,
      contentType,
      status: res.status,
      statusText: res.statusText,
      contentLength: res.headers.get('content-length') || 'unknown',
    });

    let resultText = '';
    if (contentType.includes('text/event-stream')) {
      let streamText = '';
      resultText = await readStreamingText(
        res,
        (draft) => {
          streamText = draft;
          if (typeof onStreamChunk === 'function') {
            onStreamChunk(draft);
          }
        },
        requestExtractor
      );
      if (streamText && streamText.trim()) {
        logDebug('audio stream incomplete', { requestId: responseId, text: streamText });
      }
      return resultText;
    }

    const data = await res.json().catch(async () => {
      const fallbackText = await res.text().catch(() => '');
      logDebug('audio non-json response body', {
        requestId: responseId,
        fallbackText: summarizeBodyForLog(fallbackText, 500),
      });
      return { text: fallbackText };
    });
    let text = '';
    if (typeof data === 'string') {
      text = data;
    } else if (data && typeof data === 'object') {
      text = requestExtractor(data) || '';
      if (!text && Array.isArray(data.segments)) {
        text = data.segments
          .map((segment) => {
            const segmentText =
              segment?.text ??
              segment?.transcript ??
              segment?.output ??
              '';
            return String(segmentText || '').trim();
          })
          .filter(Boolean)
          .join(' ')
          .trim();
      }
      if (!text && data?.results && Array.isArray(data.results)) {
        text = data.results
          .map((result) => requestExtractor(result) || '')
          .join(' ')
          .trim();
      }
    }
    if (typeof text === 'string' && text) {
      return text;
    }
    logDebug('audio non-stream response', { requestId: responseId, data });
    return '';
  }

  async function sendTranscriptionChunk(blob, options = {}) {
    const { allowFlowSuspended = false, allowNonStreamFallback = AUDIO_STREAM_SHORT_TEXT_RETRY } = options || {};
    if (isMicFlowSuspended && !allowFlowSuspended) {
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
    const enableStream = !options.noStream;
    const attempts = [];
    for (const model of models) {
      if (AUDIO_SEND_NATIVE_FIRST) {
        attempts.push({
          stream: enableStream,
          model,
          kind: 'native',
        });
      }

      if (AUDIO_SEND_WAV_FALLBACK) {
        attempts.push({
          stream: enableStream,
          model,
          kind: 'wav',
        });
      }
    }

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
      let requestBlob = null;
      try {
        if (kind === 'native') {
          requestBlob = blob;
        } else {
          requestBlob = await toWavBlob(blob);
          if (requestBlob && requestBlob.size) {
            const wavHead = await getBlobLeadingHex(requestBlob, 24);
            logDebug('audio wav header inspect', {
              requestId,
              wavHead,
            });
          }
        }
        if (!requestBlob || !requestBlob.size) {
          throw new Error(`変換後の音声データが空です: kind=${kind}`);
        }
      } catch (err) {
        logDebug('audio wav convert failed', {
          requestId,
          kind,
          reason: String(err && err.message ? err.message : err),
        });
        if (kind === 'native') {
          logDebug('audio native conversion skipped (unsupported native kind)', {
            requestId,
            kind,
            reason: String(err && err.message ? err.message : err),
          });
          if (i + 1 < attempts.length && attempts[i + 1].kind === 'wav') {
            continue;
          }
        }
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
          requestBlob,
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
          kind,
          code: parsedCode || 'none',
          bodyPreview: summarizeBodyForLog(errorBodyText, 500),
          endpoint: AUDIO_API.endpoint,
        });
        if (isDecodeError(res.status, detail) || isUnsupportedAudioError(res.status, detail)) {
          if (kind === 'native') {
            logDebug('audio decode failure detected', {
              requestId,
              kind,
              reason: detail,
            });
            if (i + 1 < attempts.length) {
              continue;
            }
          }
        }
        if (isInvalidModelError(res.status, detail) && i + 1 < attempts.length) {
          logDebug('audio model fallback retry', {
            requestId,
            fromModel: model,
            nextModel: attempts[i + 1].model,
            nextKind: attempts[i + 1].kind,
          });
          continue;
        }
        throw new Error(`音声API ${res.status}: ${detail}`);
      }

      let resultText = '';
      let streamShort = false;
      let streamHadText = false;
      resultText = await parseAudioTextFromResponse(
        res,
        requestId,
        extractTranscriptionText,
        (draft) => {
          if (draft && draft.trim()) {
            streamHadText = true;
            if (draft.trim().length < AUDIO_STREAM_MIN_TEXT_LEN) {
              streamShort = true;
            }
          }
        }
      );

      if (resultText && resultText.trim()) {
        if (!stream || !streamShort || !allowNonStreamFallback || resultText.trim().length >= AUDIO_STREAM_MIN_TEXT_LEN) {
          logDebug('audio stream done', { requestId, text: resultText });
          return resultText;
        }
      }

      if (stream && allowNonStreamFallback && (streamShort || !streamHadText)) {
        logDebug('audio stream text short, retrying non-stream', {
          requestId,
          resultLength: resultText ? resultText.trim().length : 0,
          minLength: AUDIO_STREAM_MIN_TEXT_LEN,
        });

        const fallbackRequestId = `${requestId}-final`;
        const fallbackHeaders = { ...headers };
          const { form: fallbackForm } = buildAudioForm(
            requestBlob,
            false,
            chunkBase,
            `${i + 1}f`,
            model
          );
        const fallbackResponse = await fetch(AUDIO_API.endpoint, {
          method: 'POST',
          headers: fallbackHeaders,
          body: fallbackForm,
        });

        if (!fallbackResponse.ok) {
          const fallbackBodyText = await fallbackResponse.text().catch(() => '');
          logDebug('audio non-stream fallback failed', {
            requestId: fallbackRequestId,
            status: fallbackResponse.status,
            fallbackBody: summarizeBodyForLog(fallbackBodyText, 500),
          });
        } else {
          const fallbackText = await parseAudioTextFromResponse(
            fallbackResponse,
            fallbackRequestId,
            extractTranscriptionText
          );
          if (fallbackText && fallbackText.trim()) {
            logDebug('audio non-stream fallback success', {
              requestId: fallbackRequestId,
              text: fallbackText,
            });
            return fallbackText;
          }
          logDebug('audio non-stream fallback empty', {
            requestId: fallbackRequestId,
          });
        }
      }
      logDebug('audio final text unavailable', {
        requestId,
        resultLength: resultText ? String(resultText).trim().length : 0,
        stream,
      });
      return '';
    }

    return '';
  }

  function enqueueAudioChunk(blob, options = {}) {
    const { trackForLive = true, trackForFinal = true } = options || {};

    if (!blob || !blob.size || !isMicActive()) {
      logDebug('enqueueAudioChunk skipped', {
        hasData: Boolean(blob),
        size: blob ? blob.size : 0,
        state: isMicActive() ? 'active' : 'inactive',
      });
      return;
    }
    if (trackForLive) {
      liveChunkQueue.push(blob);
      liveChunkBytes += blob.size;
      const maxWindowBytes = getLiveMaxWindowBytes();
      if (liveChunkBytes > maxWindowBytes && liveChunkQueue.length > 1) {
        while (liveChunkBytes > maxWindowBytes && liveChunkQueue.length > 1) {
          const removed = liveChunkQueue.shift();
          if (removed && removed.size) {
            liveChunkBytes -= removed.size;
          }
        }
        logDebug('live chunk queue trimmed', {
          limitBytes: maxWindowBytes,
          queueLength: liveChunkQueue.length,
          queueBytes: liveChunkBytes,
        });
      }
      logDebug('media recorder chunk buffered (live)', {
        size: blob.size,
        type: blob.type || 'unknown',
        state: 'active',
        queueLength: liveChunkQueue.length,
        queueBytes: liveChunkBytes,
        trackForFinal,
      });
    } else {
      logDebug('media recorder chunk buffered (live skipped)', {
        size: blob.size,
        type: blob.type || 'unknown',
        trackForLive,
        trackForFinal,
      });
    }
    if (trackForFinal) {
      recordedChunks.push(blob);
      logDebug('media recorder chunk buffered (final list)', {
        size: blob.size,
        type: blob.type || 'unknown',
        recordedCount: recordedChunks.length,
      });
    }
    lastAudioChunk = blob;
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
      postMessage('AI応答中は一時的にSTARTをブロックします。');
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
      liveTranscriptSessionStartAt = performance.now();
      clearLiveTranscript();
      heroSpeechCandidate = '';
      clearLiveTranscriptPending();
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
      livePcmSilenceFrames = 0;
      lastAudioChunk = null;
      postMessage('音声入力を開始しました。しゃべるとリアルタイムで文字起こしします。');
      setMicBusy(true);
      notifyHeroListening(true);
      if (gameApi && typeof gameApi.startCommandLineup === 'function') {
        gameApi.startCommandLineup({ silentIfActive: true });
      }

      mediaRecorder.onstart = () => {
        logDebug('media recorder onstart', { state: mediaRecorder.state });
      };

      mediaRecorder.ondataavailable = (event) => {
        if (!event.data || event.data.size <= 0) {
          logDebug('media recorder empty chunk');
          return;
        }
        logDebug('media recorder chunk available', { size: event.data.size, type: event.data.type || 'unknown' });
        if (USE_PCM_LIVE_CAPTURE && PCM_LIVE_AS_LIVE_SOURCE) {
          enqueueAudioChunk(event.data, {
            trackForLive: false,
            trackForFinal: !LIVE_ONLY_PIPELINE,
          });
          return;
        }
        enqueueAudioChunk(event.data);
        requestLiveTranscription();
      };

      mediaRecorder.onerror = (event) => {
        console.error('[Voxtral] recorder error', event.error);
        postMessage(`音声入力エラー: ${String(event.error && event.error.message ? event.error.message : 'unknown')}`);
      };

      if (USE_PCM_LIVE_CAPTURE && PCM_LIVE_AS_LIVE_SOURCE) {
        try {
          startPcmCapture(mediaStream);
          logDebug('pcm capture started', { enabled: true });
        } catch (err) {
          console.error('[Voxtral] pcm capture start failed', err);
          logDebug('pcm capture start failed', {
            error: String(err && err.message ? err.message : err),
          });
        }
      }

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
    stopPcmCapture();
    clearLiveTranscriptPending();
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
      liveTranscriptSessionStartAt = 0;
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

    if (finalize && !LIVE_ONLY_PIPELINE) {
      const finalBlob = validChunks.length
        ? new Blob(validChunks, {
            type: lastMicMimeType || mediaRecorder?.mimeType || 'audio/webm',
          })
        : new Blob([], {
            type: lastMicMimeType || mediaRecorder?.mimeType || 'audio/webm',
          });

      const finalBytes = finalBlob && finalBlob.size ? finalBlob.size : 0;
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
          const text = await sendTranscriptionChunk(finalBlob, {
            noStream: true,
            allowFlowSuspended: true,
          });
          if (text && text.trim()) {
            transcriptionText = text;
          } else {
            logDebug('final transcript empty', { finalBytes });
          }
        } catch (err) {
          console.error('[Voxtral] final audio request failed', err);
          logDebug('final transcript request failed', {
            error: String(err && err.message ? err.message : err),
          });
        }
      } else {
        logDebug('final audio blob missing', {
          chunks: recordedChunks.length,
          lastChunk: !!lastAudioChunk,
          finalBytes,
        });
      }
    } else if (finalize) {
      logDebug('final transcript skipped (live-only pipeline)', {
        chunks: recordedChunks.length,
        lastChunk: !!lastAudioChunk,
      });
    }
    liveTranscriptSessionStartAt = 0;
    isMicFlowSuspended = finalize ? false : true;
    setMicBusy(false);
    notifyHeroListening(false);
    if (!LIVE_ONLY_PIPELINE && finalize && transcriptionText && transcriptionText.trim()) {
      const spokenText = transcriptionText.trim();
      notifyHeroSpeech(spokenText);
      if (DISPLAY_FINAL_TRANSCRIPT) {
        postMessage(spokenText);
      } else {
        logDebug('final transcript hidden', {
          length: spokenText.length,
          reason: 'DISPLAY_FINAL_TRANSCRIPT=false',
        });
      }
      logDebug('final transcript', {
        length: transcriptionText.length,
        text: transcriptionText,
      });
    } else if (!LIVE_ONLY_PIPELINE && finalize) {
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
      audioEndpoint: AUDIO_API.endpoint,
      proxyAudio: !!window.__MISTRAL_PROXY_AUDIO_URL,
      proxyMain: !!window.__MISTRAL_PROXY_URL,
      useProxyMainAudio:
        Boolean(window.__MISTRAL_PROXY_AUDIO_URL || window.__MISTRAL_PROXY_URL),
      audioModelCandidates: getAudioModelCandidates(),
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
  window.__voxtralState = { isMicActive };

  // UI側で使うためにエクスポート
  window.__voxtralSendTestAudio = sendTestAudio;

  async function sendTestAudio(filePath) {
    if (isRequesting) {
      logDebug('前のリクエストが完了していません');
      return;
    }

    try {
      isRequesting = true;
      logDebug(`テストオーディオ送信開始: ${filePath}`);

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
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            gameApi.onHeroSpeech(transcriptionText);
          });
        });
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
