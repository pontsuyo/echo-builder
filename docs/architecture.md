# アーキテクチャ設計書 - Echo Builders

## 0. 優先度

- **p0**: 現在の実装で成立する基盤機能
- **p1**: 今後の検討対象（現行未実装）

## 1. 概要

Echo Builders は「音声入力 → NPC 指示 → 家パーツ生成」を実現するブラウザ実行ゲームです。  
現在は TTS/スコアリングを外し、コマンド解釈と建築実行の最低構成を維持します。

## 2. システム全体構成

```
┌─────────────────────────────────────────────────────────────┐
│                          ブラウザ (クライアント)             │
├────────────────────────┬────────────────────────┬────────────┤
│ Voxtral連携層         │ ゲームロジック層           │ UI/描画層  │
│ (voxtral.js)          │ (game-commands.js,       │ (index.html,│
│                       │  game-engine.js)          │ canvas)    │
└─────────────┬──────────┴───────────────┬──────────┴────────────┘
              ▼                          ▼
      音声文字起こし APIプロキシ       状態管理＋描画/判定
      (mistral_proxy.py / 外部経由)      (game-data.js)
              ▼
      Mistral Voxtral API (外部サービス)

（※ElevenLabs APIは p1、現行未接続）
```

## 3. 設計方針

- `シングルページ + 分割スクリプト`：  
  `index.html` から3本の主要JSを読み込み、即時実行で動作。
- `薄いオーケストレーション`：  
  音声入力とゲーム状態は分離しつつ、`window` 経由の最小 API で接続。
- `p1 分離`：  
  未実装機能は仕様上の拡張点として明示し、現行実装を複雑化しない。

## 4. コンポーネント

### 4.1 ボイスレイヤ（p0）

- ファイル: `voxtral.js`
- 役割:
  - マイク取得・録音（`MediaRecorder`）
  - 音声チャンクをVoxtralへ送信
  - 転写結果をゲーム側へ通知
- ゲーム側公開 API:
  - `startVoxtralMic()`
  - `stopVoxtralMic()`
  - `pauseVoxtralMic()`
  - `resumeVoxtralMic()`
  - `setupVoxtralIntegration(api)`
- 連携 API（ゲーム側実装）:
  - `setMessage(text)`
  - `setLiveTranscript(text)`
  - `setHeroListening(boolean)` ※実体はプレイヤー入力状態（将来 `setPlayerListening` に整理可能）
  - `onHeroSpeech(text)` ※実体はプレイヤー確定コマンド（将来 `onPlayerCommand` に整理可能）

### 4.2 コマンド解釈・割当（p0）

- ファイル: `game-commands.js`
- 役割:
  - 音声確定文を建築指示として判定
  - `BUILD_COMMAND_RULES`/`BUILD_KEYWORDS` を使って
    - 部位（屋根/壁/窓/扉/煙突/建築全体）
    - 数量
    - 判定結果の構造（isBuild / interpretation / preferredPartType / buildQuantity）
    を決定
  - NPC の順序管理（前方優先）と指示受領
  - ログ化（`commandResultRows`）

### 4.3 建築実行エンジン（p0）

- ファイル: `game-commands.js` + `game-engine.js`
- 役割:
  - `buildClosestHousePartForNpc` で空き部位選定
  - `completeBuildForNpcWithQuantity` による建築実行
  - 建築完了状態（`houseParts[].built`）更新
  - 全指示完了時に建築完成判定

### 4.4 描画・HUD（p0）

- ファイル: `game-engine.js`, `game-data.js`
- 役割:
  - NPC/家/環境の更新処理
  - 結果パネルとライブ文字起こし表示
  - リセット後の初期化

### 4.5 音声合成（p1）

- 目的: 建築完了時の復唱音声
- 現行: 未実装
- 候補: ElevenLabs 連携を追加した場合に `voiceSynthesis` を新設

### 4.6 スコアリング（p1）

- 目的: 指示一致度の定量化表示
- 現行: 未実装
- 候補: `commandResultRows` と建築実体の差分集計

## 5. データフロー

### 5.1 音声入力フロー（p0）

1. ユーザー操作: `ask-voxtral-mic` ボタン or `M` キー  
2. `voxtral.js` が録音開始
3. `Voxtral API` へ文字起こしリクエスト
4. `setLiveTranscript` でライブ表示更新
5. 確定テキスト到達時、`onHeroSpeech` 経由でゲームへ通知（実体上は Player コマンド）

### 5.2 指示実行フロー（p0）

1. 通知を `receiveHeroCommand` が受理（実体はプレイヤー指示。将来 `receivePlayerCommand` へ整理可能）
2. NPC キュー（前方順）から対象を確定
3. 指示文字列を `isBuildingCommand` で構造化
4. `commandSession` 更新
5. NPC が家のパーツへ向かい、建築完了
6. 全 NPC の指示済み時、建築完了導線へ移行

### 5.3 表示フロー（p0）

1. `commandResultRows` をパネル表示
2. 住居完成時に要約文を HUD へ出力
3. `R` リセット時に初期状態へ

## 6. データモデル（実装寄り）

```javascript
// 主要なデータ群（要約）
state = {
  cameraX,
  clear,
  message,
  walkTime,
  allOrdersReceived,
  houseRevealActive,
  houseRevealDone,
  npcs[],
  commandSession: { active, queue, cursor },
  houseParts[],
  commandResultRows[],
  liveTranscriptLine,
  latestLiveTranscript,
  firstBuilderAudioPaused,
  showCommandResults,
  childInterpretations[]
};
```

## 7. パフォーマンス設計

- 1フレームあたりの更新・描画をシンプルに保つ。
- 音声転写の待ち時間が長くても、レンダーループは停止しない。
- `commandResultRows` を表示行数制限し、HUD 描画負荷を抑える。
- 音声 API 失敗時は再試行と手動再実行の体制を優先。

## 8. 技術スタック

### クライアント
- HTML / CSS / JavaScript（ES6+）
- Canvas API
- `MediaDevices` / `MediaRecorder`

### サーバー
- Python（`mistral_proxy.py`）
- FastAPI（中継）

### 外部
- Mistral Voxtral API
- ElevenLabs（p1）

## 9. 部分的な採用技術判断

| 決定 | 方針 | 理由 |
|------|------|------|
| 単一HTML構成 | 維持 | セットアップコストが低い |
| バニラJS | 維持 | 小規模でも可読性が高い |
| `window` 経由の接続 | 維持 | 実装差分が小さく、検証しやすい |
| プロキシ経由 | 維持 | APIキーの直接露出を避ける |
| ElevenLabs | 一旦保留（p1） | 体験優先事項を後回しにするため |

## 10. 将来拡張（p1）

1. プレイヤー音声の復唱（TTS）
2. スコアリング表示
3. コマンド品質ログの永続化
4. 互換データ形式の整備

## 11. セキュリティ（現行）

- APIキーはブラウザ直書きしない（プロキシ経由）
- 音声データは必要なタイミングのみ API へ送信
- 入力文字列は表示長を制限し、HUD の過大レンダリングを防ぐ

## 文書管理

- 作成日: 2024-02-20
- 最終更新日: 2026-03-01
- バージョン: 1.1
- 状態: ドラフト
- 参照文書: `docs/product-requirements.md`, `docs/functional-design.md`
