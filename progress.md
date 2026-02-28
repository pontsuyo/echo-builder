Original prompt: 子が、playerからの指示を聞きはじめて5秒後時点で何も解釈ができていなかった場合、子の頭の上には?マークの入った吹き出しが現れる

## 2026-03-01
- 調査: `setListeningNpc` で聞き取り対象が切り替わり、`npc.isListeningToPlayer` が立つ設計を確認。
- 調査: NPC描画は `game-engine.js` の `draw()` ループ内で行われるため、?吹き出しはここに追加する方針。
- 次: 聞き取り開始時刻をNPCに保持し、5秒未解釈で `?` 吹き出しを表示する処理を実装する。
- 実装: `COMMAND_LINE.uninterpretedHintDelayMs` を追加（5000ms）。
- 実装: NPCに `listeningStartedAt` を追加し、`setListeningNpc` で聞き取り開始時刻を設定・切替時にクリア。
- 実装: `shouldShowUninterpretedHint` と `drawUninterpretedHintBubble` を `game-engine.js` に追加。聞き取り開始から5秒かつ解釈未設定時のみ `?` 吹き出しを頭上に描画。
- 実装: `render_game_to_text` に `isListeningToPlayer` と `questionBubbleVisible` を追加。
- 実装: `heroSpeechBubbleUnlocked` フラグを追加し、`START`（実際には `setHeroListening(true)`）が一度でも発火するまでプレイヤー吹き出しを描画しないよう変更。
- 実装: `resetGame()` 時に `heroSpeechBubbleUnlocked` を `false` に戻し、リトライ直後は再び `START` 押下後にのみ吹き出しが表示されるよう統一。
- 実装: `window.unlockHeroSpeechBubble()` を追加し、`voxtral-ui.js` の `startMic()`（START/Mキー起点）で押下直後に解禁するよう調整。マイク開始可否に依存せず要件通り「START押下後」に表示される。
