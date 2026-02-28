(function () {
  const micButton = document.getElementById('ask-voxtral-mic');
  const testRedRoofButton = document.getElementById('test-red-roof');
  const testTwoWindowsButton = document.getElementById('test-two-windows');
  const testTwoDotsButton = document.getElementById('test-two-dots');

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

  function updateMicButtonLabel() {
    if (!micButton) return;
    micButton.textContent = isMicActive() ? 'マイク停止' : isRetryMode ? 'retry' : 'START';
  }

  if (micButton) {
    micButton.disabled = false;
    micButton.addEventListener('click', () => {
      if (isMicActive()) {
        stopMic();
      } else {
        startMic();
      }
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M' || e.code === 'KeyM') {
      e.preventDefault();
      if (isMicActive()) {
        stopMic();
      } else {
        startMic();
      }
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
