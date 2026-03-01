# Echo Builder

A voice-controlled 2D building game where you speak and AI workers build houses in real time.

---

## Overview

Echo Builder is a browser-based game that uses voice commands to control AI workers who construct houses. You speak, Mistral Voxtral transcribes your speech, and workers interpret and place building parts such as roofs, walls, windows, doors, chimneys, and columns. Mishearings and misunderstandings are part of the design, so imperfect interpretations can still be fun.

---

## Key Features

- **Real-time voice input**: Speak naturally to give build instructions.
- **Mistral Voxtral API**: Speech-to-text transcription for live voice commands.
- **Command parsing**: Extracts part type, count, color.
- **2D building**: Workers place roofs, walls, windows, doors, chimneys, and columns.
- **Goal and scoring**: Random goals at start; scoring based on count, color, and position when building is complete.

---

## Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+), Canvas API
- **Voice**: Mistral Voxtral API, MediaRecorder
- **Backend**: Python Flask proxy for secure API key handling
- **No frameworks**: Single HTML page with modular scripts

---

## How Mistral AI Is Used

Echo Builder uses the Mistral Voxtral API for speech-to-text. Audio from the browser microphone is streamed to the API, which returns transcriptions. The game parses these transcripts into build commands and drives the AI workers' actions. A local proxy server keeps the API key secure and out of the browser.
