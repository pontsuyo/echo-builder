(function () {
  const micButton = document.getElementById('ask-voxtral-mic');
  const audioSendToggleButton = document.getElementById('toggle-audio-send');
  const testRedRoofButton = document.getElementById('test-red-roof');
  const testTwoWindowsButton = document.getElementById('test-two-windows');
  const testTwoDotsButton = document.getElementById('test-two-dots');
  let isRetryMode = false;

  function startMic() {
    if (typeof window.unlockHeroSpeechBubble === 'function') {
      window.unlockHeroSpeechBubble();
    }
    if (typeof window.startVoxtralMic === 'function') {
      window.startVoxtralMic();
    }
  }

  function stopMic() {
    if (typeof window.stopVoxtralMic === 'function') {
      window.stopVoxtralMic();
    }
  }

  function isMicActive() {
    if (!window.__voxtralState || typeof window.__voxtralState.isMicActive !== 'function') {
      return false;
    }
    return Boolean(window.__voxtralState.isMicActive());
  }

  function isAudioSendEnabled() {
    if (!window.__voxtralState || typeof window.__voxtralState.isAudioServerSendEnabled !== 'function') {
      return true;
    }
    return Boolean(window.__voxtralState.isAudioServerSendEnabled());
  }

  function setAudioSendEnabled(next) {
    if (!window.__voxtralState || typeof window.__voxtralState.setAudioServerSendEnabled !== 'function') {
      return;
    }
    window.__voxtralState.setAudioServerSendEnabled(next);
  }

  function updateAudioSendButtonLabel() {
    if (!audioSendToggleButton) return;
    const enabled = isAudioSendEnabled();
    audioSendToggleButton.textContent = enabled ? 'Python送信: ON' : 'Python送信: OFF';
    audioSendToggleButton.setAttribute(
      'aria-label',
      enabled ? 'Python送信は有効です' : 'Python送信は無効です'
    );
  }

  function updateMicButtonLabel() {
    if (!micButton) return;
    micButton.textContent = isMicActive() ? 'STOP' : isRetryMode ? 'Retry' : 'START';
  }

  if (micButton) {
    micButton.disabled = false;
    updateMicButtonLabel();
    micButton.addEventListener('click', () => {
      if (isMicActive()) {
        stopMic();
      } else if (isRetryMode && window.resetGame) {
        window.resetGame();
      } else {
        startMic();
      }
    });
  }

  if (audioSendToggleButton) {
    audioSendToggleButton.disabled = false;
    updateAudioSendButtonLabel();
    audioSendToggleButton.addEventListener('click', () => {
      setAudioSendEnabled(!isAudioSendEnabled());
      updateAudioSendButtonLabel();
    });
  }

  window.addEventListener('goal:score.finalized', () => {
    isRetryMode = true;
    updateMicButtonLabel();
  });

  window.addEventListener('game:reset', () => {
    isRetryMode = false;
    updateMicButtonLabel();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M' || e.code === 'KeyM') {
      e.preventDefault();
      if (isMicActive()) {
        stopMic();
      } else {
        startMic();
      }
      updateMicButtonLabel();
    }
  });

  function sendTest(filePath) {
    if (typeof window.__voxtralSendTestAudio === 'function') {
      window.__voxtralSendTestAudio(filePath);
    }
  }

  if (testRedRoofButton) {
    testRedRoofButton.addEventListener('click', () => {
      sendTest('wav/build_a_red_roof.wav');
    });
  }

  if (testTwoWindowsButton) {
    testTwoWindowsButton.addEventListener('click', () => {
      sendTest('wav/put_two_windows.wav');
    });
  }

  if (testTwoDotsButton) {
    testTwoDotsButton.addEventListener('click', () => {
      sendTest('wav/there should be two .mp3');
    });
  }
})();
