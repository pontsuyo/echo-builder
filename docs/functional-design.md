# 機能設計書 - Echo Builders

## 0. 優先度

- **p0**: 現在の実装で必須
- **p1**: 後続で検討する機能（現行は未実装）

## 1. 概要

この文書は Echo Builders の機能実装の現行方針を定義する。  
対象は「音声入力→子どもの作業指示割り当て→建築進行可視化」の流れを成立させる機能であり、将来拡張（TTS / スコアリング）は p1 として切り分ける。

## 2. システムアーキテクチャ

```
┌───────────────────────────────────────────────────┐
│             フロントエンド（ブラウザ）            │
├──────────────────┬───────────────────────┬────────┤
│ Canvasゲーム基盤 │ 音声認識連携（Voxtral）│ UI/HUD │
└────────┬─────────┴───────┬───────────────┴───────┘
         ▼                 ▼
┌────────────────────────────────────────────────────┐
│          ゲームロジック層（同一実行コンテキスト）   │
├───────────────┬─────────────────┬──────────────────┤
│ コマンド解釈  │ 建築実行エンジン │ コマンド結果表示 │
└───────────────┴─────────────────┴──────────────────┘
         │
         ▼
┌───────────────────────────────────────────────┐
│ 目標選定/採点層                              │
├───────────────────────────────────────────────┤
│ GoalPattern / GoalHint / ScoreEvaluator         │
└───────────────────────────────────────────────┘

（※ElevenLabs APIは現時点で未接続。将来 p1 で検討）
```

## 3. モジュール設計

### 3.1 音声認識モジュール（p0）

#### 機能
- マイク権限取得
- 音声キャプチャ開始 / 停止
- ストリーミング転写（ライブ転写を中心）
- ゲームへの転写結果連携（逐次表示 + コマンド確定時の実行）

#### 外部連携
- `voxtral.js` とゲームロジックは同一フロントエンド内で接続し、`window.setupVoxtralIntegration(api)` で相互参照。
- 連携コールバック:
  - `setMessage(text)`
  - `setLiveTranscript(text)`
  - `setPlayerListening(boolean)` ※実体はプレイヤー入力状態
  - `onPlayerCommand(text)` ※確定テキスト到達時のゲーム側受け口

#### 制御 API（既存公開API）
- `startVoxtralMic()`
- `stopVoxtralMic()`
- `pauseVoxtralMic()`
- `resumeVoxtralMic()`
- `setupVoxtralIntegration(api)`

#### データフロー
1. ユーザーが `ask-voxtral-mic` ボタンまたは M キーで入力を開始。
2. ゲーム側状態に関係なく、`voxtral.js` が `MediaRecorder` で音声を取得し、Voxtral API経由で文字起こし。
3. ライブ文字列を `setLiveTranscript` で画面に反映。
4. 一定条件で確定文を `onPlayerCommand` へ送信。
5. 受け取り側で同一ターン内処理へ直接反映。

### 3.2 コマンド解釈エンジン（p0）

#### 目的
- 転写結果を「建築指示」「非建築指示」に分類。
- 対象部位（屋根/壁/窓/扉/煙突/柱/建築全体）と数量（数詞）を抽出。

#### 機能
- 正規化（小文字化・句読点除去・連続空白圧縮）
- 数量抽出（アラビア数字、日本語数字、英語数詞）
- 部位一致ルール（`BUILD_COMMAND_RULES` / `BUILD_KEYWORDS`）で判定
- 色・屋根形状抽出（`red/blue/green` 等と `triangle/flat/round`）
- 判定結果を次ターンの NPC へ割り当て

#### 判定出力
- `isBuild: boolean`
- `preferredPartType: 'wall'|'roof'|'chimney'|'door'|'window'|'house'|'floor'|'fence'|'column'|null`
- `buildQuantity: number`
- `requestedColor: string|null`
- `requestedRoofShape: 'round'|'triangle'|'flat'|null`
- `interpretation: string`（UI表示用）

### 3.3 建築実行エンジン（p0）

#### 目的
- 受け取った NPC ごとの指示を順番に実行し、家パーツの完成状態へ反映する。

#### 実装フロー
1. 毎回の音声確定時に、前方優先の NPC 順序で命令キューを作成。
2. `receivePlayerCommand` が入るたびに現在キュー先頭 NPC が指示を受領。
3. 受領 NPC を建築位置へ誘導し、`buildClosestHousePartForNpc` で対象部位を選定。
4. `completeBuildForNpcWithQuantity` により `buildQuantity` 分の部位を建築完了。
5. キュー最終処理時に `allOrdersReceived=true`、完成トリガーへ移行。

#### データ構造（現行）
- NPC: `isBuildCommand / preferredPartType / buildQuantity / lastHeardText / lastInterpretation / commandState / isListeningToPlayer`
- 家パーツ: `houseParts[]`（`type`, `built`, `builtBy`, `assignedTo`）
- セッション: `commandSession.active`, `commandSession.queue`, `commandSession.cursor`

### 3.4 Goal Pattern 管理（p0）

#### 目的
- 開始時（ゲーム開始、`R` リセット）に目標テンプレートを1件選定し、同一セッション内で維持する。

#### 機能
- `GOAL_PATTERNS`（3件以上）定義。
- `selectRandomGoal(seed?)` により1件を選定。
- 選定結果を `activeGoal` として状態保持。
- 選定イベント `goal:selected` を発火。

### 3.5 Goal Hint Renderer（p0）

#### 目的
- ゴールテンプレートの期待形を画面上に可視化。

#### 機能
- 目標の種類（屋根、柱、ドア、色、位置）を UI 上で説明。
- ゲームプレイ中は薄い透過表示（線画 or ガイド）で重複しないよう描画。
- 目標変更は `start/reset` のみ許可（途中で更新しない）。

### 3.6 Score Evaluator（p0）

#### 目的
- 建築完了時（`houseRevealDone`）に目標一致度を1回だけ算出。

#### 機能
- `evaluateGoalScore(activeGoal, houseParts, destroyedParts)` 実行。
- ルール別に数量一致、色一致、位置一致を比率加点。
- 目標外追加を `-5`、破壊は `destroyedParts` ベースで `-10`。
- スコア結果（`score` と `breakdown`）を HUD/ログへ渡す。
- `goal:score.finalized` イベントを発火。

### 3.7 音声合成モジュール（p1）

- 現行は未実装。
- 想定は「建築完了時の復唱音声再生」を追加する設計。
- 検討対象: ElevenLabs 連携の有無と、音声生成コスト/待ち時間の扱い。

### 3.8 UI/UXモジュール（p0）

#### 画面構成
- Canvas本体（ゲーム表示）
- ツールバー
  - `結果確認`（コマンド結果パネル表示）
  - `マイク開始`（音声入力）
  - 開発用テストボタン（3点）
- 音声入力履歴（HUD）
- コマンド結果パネル
- 目標ヒント表示（開始時〜建築完了まで）

#### コマンド結果パネル（表示時のみ）
- 子どもID
- 受信文字列（聞取）
- 解析結果（interpreted）
- 数量
- スコア結果（score modeでは最終表示）

#### コントロール
- 音声入力トリガ:
  - `マイク開始` ボタン
  - `M` キーによる開始/停止
- キーボード移動（左右・ジャンプ）は本仕様から除外（実装対象外）

## 4. データ設計

### 4.1 ゲーム状態（p0）

```javascript
{
  cameraX: number,
  message: string,
  clear: boolean,
  walkTime: number,
  firstBuilderAudioPaused: boolean,

  npcs: [
    {
      id,
      x,
      y,
      w,
      h,
      homeX,
      homeY,
      vx,
      vy,
      dir,
      state, // walk | idle
      walkPhase,
      walkTimer,
      idleTimer,
      minX,
      maxX,
      commandState, // queued | returnHome | completed | roam
      lineSlot,
      commandMarkUntil,
      isBuildCommand,
      isListeningToPlayer,
      preferredPartType,
      requestedBuildQuantity,
      lastBuiltQuantity,
      assignedBuildPartId,
      buildQuantity,
      lastHeardText,
      lastInterpretation,
      commandTargetX,
      commandTargetY
    }
  ],

  commandSession: {
    active,
    queue: [], // NPC参照の配列
    cursor
  },

  houseParts: [
    {
      id,
      type, // wall | roof | chimney | door | window | column
      x,
      y,
      w,
      h,
      built,
      builtBy,
      assignedTo,
      isDynamic,
      colorHex,
      roofShape,
      destroyed,
    }
  ],

  buildingProgress: {
    allOrdersReceived,
    houseRevealActive,
    houseRevealDone
  },

  commandResultRows: [
    {
      childId,
      heard,
      interpreted,
      quantity
    }
  ],

  commandLine: {
    spacing,
    queueSpeed,
    returnSpeed,
    workSpeed
  },

  childInterpretations: [
    { childId, interpretation }
  ],

  activeGoal,
  lastGoalId,
  goalScore,
  goalScoreBreakdown,
  scoreVisible,

  ui: {
    showCommandResults
  },

  voice: {
    liveTranscriptLine,
    latestLiveTranscript,
    playerListening
  }
}
```

### 4.2 イベント（p0）

| イベント名 | データ | 発火タイミング |
|------------|--------|----------------|
| `voice:transcript` | `{ text, isFinal }` | 転写結果更新時 |
| `voice:toggle` | `{ active }` | マイク開始/停止時 |
| `command:session.created` | `{ queueSize }` | 音声確定時にキューを新規作成した時 |
| `command:session.assign` | `{ childId, isBuild, interpreted, quantity, preferredPartType }` | 子どもにコマンドを割当時 |
| `command:session.next` | `{ nextChildId }` | 次の子どもへコマンド待ち時 |
| `command:build.complete` | `{ childId, builtCount, partIds }` | 部位が建築完了時 |
| `goal:selected` | `{ goalId, version, selectedAt }` | ゲーム開始・リセット時にゴールを選定時 |
| `goal:score.finalized` | `{ goalId, score, breakdown, extraPenalty, idealMatchRate }` | スコア確定時 |
| `game:reset` | `{ reason }` | リセット時 |

## 5. API設計

### 5.1 Mistral Voxtral APIラッパー（p0）

#### 設定
- 音声転写エンドポイント: `POST /v1/audio/transcriptions`
- モデル: `voxtral-mini-latest` 系（実行時環境で調整）
- 文字起こし言語: 英語優先の運用

#### 役割
- ブラウザ側録音データを `FormData(file)` として API に送信
- 転写失敗時はフォールバック（再試行/代替 MIME）を実施
- 成功した文字列をゲームのイベントとして再注入

### 5.2 Goal/Score API（p0）

#### 目的
- 開始時ランダムゴール選定と、建築完了時の一致度評価を標準インターフェース化。

#### 候補 API
- `selectRandomGoal(seed?)` → `activeGoal`
- `evaluateGoalScore(activeGoal, houseParts, optionalDestroyedParts)` → `{ score, breakdown }`
- `getActiveGoalForUi()` → `activeGoal`

### 5.3 ElevenLabsラッパー（p1）

- 現行実装なし。
- 音声復唱を追加する際の拡張ポイントとして将来定義。

## 6. スコア計算ロジック

### 6.1 ルール
- `GoalPattern` の各 `parts` を照合し、以下を加点。
  - `countMatchScore = min(doneCount, requiredCount) / requiredCount * countWeight`
  - `colorMatchScore = matchedColorCount / targetCount * colorWeight`
  - `positionMatchScore = clamp(1 - abs(dx)/tolerancePx, 0, 1) * positionWeight`
- 付加点は `base` を起点に加算。
- ペナルティ:
  - `extraPenalty = -5 * extraCount`
  - `destroyPenalty = -10 * destroyedCount`（現時点で破壊イベント未実装のため 0）
- `clamp` で `0..100` に収束。

### 6.2 `column` と位置
- 柱は `partType: column` として扱い、まずは本数ベース（count）で評価。
- ドア中央は `positionRule: x-center` として許容誤差（既定 8px）で減衰評価。

## 7. エラーハンドリング

### 7.1 種類と対処

- マイク権限拒否  
  - メッセージ表示、再許可の導線を示す
- マイク/MediaRecorder未対応  
  - エラーログ表示＋機能利用ガイド
- 音声送信失敗（ネットワーク/API）  
  - エラーログ + 連続試行回数を調整して再試行可否判断
- 無効コマンド  
  - `isBuild=false` として受理し、次ターン処理へ進む
- 建築対象不足  
  - 指示数と利用可能部位不足を考慮し `isBuildCommand=false` にフォールバック

### 7.2 フォールバックポリシー
- 文字起こしの未確定値は画面表示のみ維持し、確定時にコマンド登録。
- 非建築として判定された文字列でもゲーム進行は停止させず継続。
- API連携失敗時はゲーム全体停止はしない。

## 7.3 テスト設計

### 7.3.1 機能テスト（現行）
- 音声セッション開始/停止
- ライブ転写文字列の反映
- 建築指示の識別
- キュー順（子どもの前方順）での割当
- 建築完了後の結果ログ表示
- リセット時の状態初期化
- ゴール選定（start/reset）とヒント表示

### 7.3.2 スコアシナリオ（p0）
- 3パターン以上のうち少なくとも1件が開始時に選択されること
- 完全一致時に高得点帯へ入ること（高点）
- 1〜2項目未達で中間点が出ること
- 目標外追加1つで `-5` が反映
- ドア中央判定が減点へ反映（許容誤差 8px）
- 破壊未実装時は `destroyPenalty` が 0 と明記されること

### 7.4 検証サンプル（p0）

```javascript
const voiceSamples = [
  'add 2 windows',
  'put a red roof',
];
```

```javascript
const goalScoreSamples = [
  { goalId: 'goal-red-roof-3columns-door', doneCount: { roof: 1, column: 3, door: 1 }, extra: 0 },
  { goalId: 'goal-blue-flat-roof-window2', doneCount: { roof: 1, window: 1 }, extra: 1 },
];
```

## 8. パフォーマンス設計

- フレーム処理は軽量レンダリングを優先し、入力・描画の体感を切れ目なく維持する。
- 転写失敗やAPI遅延時でも、UIがフリーズしないことを優先する。
- 建築結果ログは履歴長を制限し、描画負荷を抑える。

## 9. セキュリティ設計

- APIキーはブラウザへ直接埋め込まず、プロキシ経由で運用する方針を維持。
- 音声入力と API 通信を分離し、必要最小情報のみをやり取りする。
- UI側表示文字列は最小限に制限し、想定外の長大入力に対して切り捨てを行う。

## 10. 依存関係

### 10.1 外部依存
- Mistral Voxtral API（音声文字起こし）
- ブラウザ: `MediaDevices`, `MediaRecorder`, `Canvas API`

### 10.2 内部依存
- `voxtral.js`（音声入力層）
- `game-commands.js`（コマンド解釈・割当）
- `game-engine.js`（状態更新と描画）
- `game-data.js`（定数・NPC/部品データ）

---

**文書管理**
- 作成日: 2024-02-20
- 最終更新日: 2026-03-01
- バージョン: 1.2
- 状態: ドラフト
- 参照文書: `docs/product-requirements.md`
