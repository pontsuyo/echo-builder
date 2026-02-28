# 機能設計書 - Echo Builders

## 1. 概要

この文書は、Echo Buildersの機能設計を詳細に記述します。プロダクト要求定義書（PRD）を基に、各機能の具体的な動作、インターフェース、データフローを定義します。

## 2. システムアーキテクチャ

```
┌───────────────────────────────────────────────────┐
│                    フロントエンド (ブラウザ)                    │
├─────────────────┬─────────────────┬───────────────┤
│   音声認識モジュール   │   ゲームエンジン       │   UIモジュール  │
└─────────────────┴─────────────────┴───────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────┐
│                    バックエンド (プロキシ)                     │
├─────────────────┬─────────────────┬───────────────┤
│  Mistral APIプロキシ  │  ElevenLabs APIプロキシ │   データ管理   │
└─────────────────┴─────────────────┴───────────────┘
```

## 3. モジュール設計

### 3.1 音声認識モジュール

#### 機能
- マイク入力の取得と管理
- 音声データのストリーミング送信
- Mistral Voxtral APIとの通信
- リアルタイム転写結果の処理

#### インターフェース

```javascript
class VoiceRecognition {
  // 初期化
  constructor(config) 
  
  // マイクアクセス開始
  async start() 
  
  // マイクアクセス停止
  stop() 
  
  // コールバック登録
  onTranscript(callback) 
  
  // エラーハンドリング
  onError(callback) 
  
  // 現在の状態取得
  getStatus() 
}
```

#### データフロー

```
1. ユーザーがマイクボタンをクリック
2. ブラウザがマイクアクセス許可をリクエスト
3. 音声データをチャンク単位でキャプチャ
4. チャンクをMistral APIプロキシにストリーミング送信
5. 転写結果を受信
6. リアルタイムでUIに表示
7. 完了またはエラー時にコールバックを実行
```

#### 実装詳細

- **音声キャプチャ**: `navigator.mediaDevices.getUserMedia()`
- **ストリーミング**: 2秒間隔でのチャンク送信
- **エラーハンドリング**: 
  - 400エラー: モデル名不整合の可能性
  - 401エラー: 認証エラー
  - 415エラー: オーディオフォーマット不正
  - 500エラー: サーバーエラー
- **フォールバック**: ストリーミング失敗時は非ストリーミングモードに切り替え

### 3.2 建築理解エンジン

#### 機能
- 音声テキストの解析
- 建築パラメータの抽出
- 曖昧理解モデルの適用
- 確信度計算
- 誤解生成

#### インターフェース

```javascript
class BuildingUnderstandingEngine {
  constructor(workerProfile) 
  
  // テキスト解析
  analyze(text) 
  
  // 建築パラメータ取得
  getBuildingParameters() 
  
  // 理解度スコア取得
  getUnderstandingScore() 
  
  // 復唱テキスト生成
  generateRecapText() 
}
```

#### 解析ロジック

```
入力テキスト: "丸い屋根で窓は4つで赤い感じ"

1. トークナイズ
   → ["丸い", "屋根", "で", "窓", "は", "4つ", "で", "赤い", "感じ"]

2. 品詞タグ付け
   → [
     {word: "丸い", pos: "形容詞", confidence: 0.95},
     {word: "屋根", pos: "名詞", confidence: 0.98},
     {word: "窓", pos: "名詞", confidence: 0.92},
     {word: "4つ", pos: "数詞", confidence: 0.88},
     {word: "赤い", pos: "形容詞", confidence: 0.90}
   ]

3. 建築パラメータ抽出
   → {
     shapes: ["丸い"],
     parts: ["屋根", "窓"],
     numbers: [4],
     colors: ["赤い"]
   }

4. 曖昧理解適用（ワーカー属性による変換）
   → {
     roofShape: "round",
     windowCount: 3,  // 数字理解力0.7 → 4→3に変換
     wallColor: "#ff8888",  // "赤い"をオレンジ寄りに解釈
     understandingScore: 0.75
   }

5. 復唱テキスト生成
   → "丸い屋根で、窓は3つ、少し赤い感じだと思いました！"
```

#### 曖昧理解モデル

```javascript
// ワーカー属性例
const workerProfile = {
  id: "worker-01",
  name: "タロウ",
  understandingBias: {
    numbers: 0.7,    // 数字理解力
    colors: 0.8,     // 色理解力
    shapes: 0.9,     // 形状理解力
    abstract: 0.6    // 抽象語理解力
  }
};

// 曖昧理解関数
function applyAmbiguousUnderstanding(params, profile) {
  const result = {};
  
  // 屋根形状（形状理解力が高いのでほぼ正確）
  result.roofShape = interpretShape(params.shapes[0], profile.understandingBias.shapes);
  
  // 窓の数（数字理解力が低いので誤解が発生）
  result.windowCount = applyNumberMisunderstanding(
    params.numbers[0], 
    profile.understandingBias.numbers
  );
  
  // 壁の色（色理解力が中程度）
  result.wallColor = interpretColor(
    params.colors[0], 
    profile.understandingBias.colors
  );
  
  // 理解度スコア計算
  result.understandingScore = calculateScore(params, profile);
  
  return result;
}
```

### 3.3 建築生成システム

#### 機能
- 建築パラメータに基づく建物生成
- 2Dピクセルアート描画
- アニメーション制御
- パーツ別描画管理

#### インターフェース

```javascript
class BuildingGenerator {
  constructor(canvasContext) 
  
  // 建物生成
  generate(parameters) 
  
  // アニメーション更新
  update(deltaTime) 
  
  // 描画
  draw() 
  
  // 完了状態取得
  isComplete() 
  
  // 現在の進捗取得
  getProgress() 
}
```

#### 建築パラメータ

```javascript
{
  // 基本パラメータ
  roofShape: "round" | "triangle" | "flat",  // 屋根形状
  wallColor: "string",  // 16進数カラーコード
  windowCount: "number",  // 窓の数
  floors: "number",  // 階数
  
  // オプションパラメータ
  doorType: "normal" | "double" | "sliding",  // ドアタイプ
  decorations: [  // 装飾リスト
    {
      type: "flower" | "flag" | "chimney",
      position: "string",
      color: "string"
    }
  ],
  
  // メタデータ
  understandingScore: "number",  // 0-1の理解度
  workerId: "string"  // ワーカーID
}
```

#### 描画ロジック

```javascript
// 屋根描画
function drawRoof(ctx, x, y, width, shape, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  
  switch(shape) {
    case "round":
      // 半円の屋根
      ctx.arc(x + width/2, y, width/2, Math.PI, 0, false);
      ctx.lineTo(x + width, y);
      break;
    case "triangle":
      // 三角の屋根
      ctx.moveTo(x, y);
      ctx.lineTo(x + width/2, y - width/2);
      ctx.lineTo(x + width, y);
      break;
    case "flat":
      // 平らな屋根
      ctx.rect(x, y - 20, width, 20);
      break;
  }
  
  ctx.closePath();
  ctx.fill();
}

// 窓描画
function drawWindow(ctx, x, y, size, color) {
  // 窓枠
  ctx.fillStyle = "#5e4839";
  ctx.fillRect(x, y, size, size);
  
  // ガラス部分
  ctx.fillStyle = color;
  ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
}
```

### 3.4 音声合成モジュール

#### 機能
- ElevenLabs APIとの通信
- 音声データの生成
- 音声再生
- ワーカー個性に応じた声の選択

#### インターフェース

```javascript
class VoiceSynthesis {
  constructor(apiKey) 
  
  // 音声生成
  async generateSpeech(text, voiceId) 
  
  // 音声再生
  play(audioData) 
  
  // 停止
  stop() 
  
  // 現在の状態取得
  getStatus() 
}
```

#### データフロー

```
1. 建築完了イベント発生
2. 復唱テキストを生成
3. ワーカーの声IDを取得
4. ElevenLabs APIにリクエスト送信
5. 音声データを受信
6. オーディオ要素を作成
7. 音声再生
8. 再生完了イベントを発火
```

#### ワーカーと声のマッピング

```javascript
const WORKER_VOICES = {
  "worker-01": {
    voiceId: "elevenlabs-voice-id-01",
    name: "タロウ",
    description: "若い男性の声、やや早口",
    understandingBias: {
      numbers: 0.7,
      colors: 0.8,
      shapes: 0.9,
      abstract: 0.6
    }
  },
  "worker-02": {
    voiceId: "elevenlabs-voice-id-02",
    name: "ハナコ",
    description: "落ち着いた女性の声、丁寧",
    understandingBias: {
      numbers: 0.9,
      colors: 0.95,
      shapes: 0.8,
      abstract: 0.85
    }
  }
};
```

### 3.5 UI/UXモジュール

#### コンポーネント構成

```
┌───────────────────────────────────────────────────┐
│                    ヘッダー                       │
├─────────────────┬─────────────────┬───────────────┤
│   スコア表示     │   マイクコントロール     │   設定ボタン  │
├─────────────────┴─────────────────┴───────────────┤
│                    キャンバス（ゲームエリア）      │
├───────────────────────────────────────────────────┤
│                    フッター                       │
├─────────────────┬─────────────────┬───────────────┤
│   音声転写表示   │   進捗バー             │   アクションボタン│
└─────────────────┴─────────────────┴───────────────┘
```

#### 主要UI要素

1. **マイクコントロール**
   - マイクオン/オフトグル
   - 録音中インジケーター
   - 音量メーター

2. **音声転写表示エリア**
   - リアルタイム転写テキスト
   - 自動スクロール
   - 履歴表示（最大5行）

3. **建築進捗表示**
   - 進捗バー（0-100%）
   - 現在の工程表示
   - 残り時間推定

4. **スコア表示**
   - 理解度スコア（0-100%）
   - ワーカー幸福度
   - ボーナスポイント

5. **アクションボタン**
   - リセットボタン
   - 再生ボタン
   - 共有ボタン
   - 設定ボタン

#### 状態遷移

```
┌─────────┐
│   初期状態  │
└─────────┘
       │
       ▼
┌─────────┐
│  音声入力中  │
└─────────┘
       │
       ▼
┌─────────┐
│  建築中    │
└─────────┘
       │
       ▼
┌─────────┐
│  復唱中    │
└─────────┘
       │
       ▼
┌─────────┐
│  完了状態  │
└─────────┘
       │
       ▼
┌─────────┐
│   リセット   │
└─────────┘
```

## 4. データ設計

### 4.1 ゲーム状態

```javascript
{
  // 現在のゲーム状態
  state: "idle" | "listening" | "building" | "reciting" | "completed",
  
  // 音声認識
  voiceRecognition: {
    isActive: boolean,
    transcript: string,
    history: string[],
    error: string | null
  },
  
  // 建築データ
  building: {
    parameters: BuildingParameters,
    progress: number,  // 0-1
    isComplete: boolean,
    startTime: number,
    endTime: number | null
  },
  
  // ワーカー情報
  worker: {
    id: string,
    name: string,
    voiceId: string,
    understandingBias: UnderstandingBias
  },
  
  // スコア
  score: {
    understanding: number,  // 0-1
    happiness: number,      // 0-1
    bonus: number           // 0-1
  },
  
  // 設定
  settings: {
    microphoneVolume: number,
    voiceVolume: number,
    showDebugInfo: boolean
  }
}
```

### 4.2 イベント設計

| イベント名 | データ | 発火タイミング |
|------------|-------|----------------|
| `voice:start` | `{ timestamp }` | 音声入力開始時 |
| `voice:transcript` | `{ text, isFinal }` | 転写結果更新時 |
| `voice:end` | `{ finalText }` | 音声入力終了時 |
| `voice:error` | `{ error }` | エラー発生時 |
| `building:start` | `{ parameters }` | 建築開始時 |
| `building:progress` | `{ progress }` | 建築進捗更新時 |
| `building:complete` | `{ building }` | 建築完了時 |
| `recite:start` | `{ text }` | 復唱開始時 |
| `recite:end` | `{}` | 復唱終了時 |
| `game:reset` | `{}` | ゲームリセット時 |

## 5. API設計

### 5.1 Mistral Voxtral APIラッパー

```javascript
class MistralVoxtralAPI {
  constructor(proxyUrl, apiKey = null) 
  
  // 音声認識リクエスト
  async transcribe(audioBlob, model = "voxtral-mini-2602") 
  
  // ストリーミング転写
  async streamTranscribe(audioStream, model = "voxtral-mini-2602") 
  
  // エラーハンドリング
  handleError(error) 
}
```

### 5.2 ElevenLabs APIラッパー

```javascript
class ElevenLabsAPI {
  constructor(apiKey) 
  
  // 音声合成
  async generateSpeech(text, voiceId, options = {}) 
  
  // 声の一覧取得
  async listVoices() 
  
  // エラーハンドリング
  handleError(error) 
}
```

## 6. エラーハンドリング

### 6.1 エラー種類と対応

| エラータイプ | 原因 | 対応 |
|--------------|------|------|
| `MicrophonePermissionDenied` | マイク許可拒否 | ユーザーに許可を促すメッセージ表示 |
| `MicrophoneNotFound` | マイク未接続 | 代替入力方法を提案 |
| `NetworkError` | ネットワークエラー | リトライボタン表示 |
| `ApiLimitExceeded` | APIレートリミット | クールダウン表示 |
| `InvalidModel` | 無効なモデル名 | フォールバックモデル使用 |
| `AudioDecodeFailure` | オーディオデコード失敗 | チャンク再送信 |

### 6.2 エラーリカバリ戦略

1. **マイクエラー**
   - 3回までリトライ
   - テキスト入力フォールバックを提示
   - 設定画面へのリンク表示

2. **APIエラー**
   - 500ms待機後リトライ（最大3回）
   - フォールバックエンドポイント使用
   - オフラインモード提案

3. **理解エラー**
   - 確信度が低い場合は聞き返し
   - 複数の理解候補を提示
   - デフォルト値を使用

## 7. テスト設計

### 7.1 テストケース

#### 音声認識モジュール
- マイク許可が得られること
- 音声が正しくキャプチャされること
- 転写結果がリアルタイムで表示されること
- エラーが適切にハンドリングされること

#### 建築理解エンジン
- テキストから正しくパラメータが抽出されること
- 曖昧理解が適用されること
- 理解度スコアが計算されること
- 復唱テキストが生成されること

#### 建築生成システム
- パラメータに基づいて正しく建物が生成されること
- アニメーションがスムーズに表示されること
- 進捗が正しく更新されること

#### 音声合成モジュール
- 音声が正しく生成されること
- 再生が正しく行われること
- エラーが適切にハンドリングされること

### 7.2 テストデータ

```javascript
// 音声認識テストデータ
const voiceTestCases = [
  {
    input: "丸い屋根で窓は4つで赤い感じ",
    expected: {
      shapes: ["丸い"],
      parts: ["屋根", "窓"],
      numbers: [4],
      colors: ["赤い"]
    }
  },
  {
    input: "高い塔を3つ作って",
    expected: {
      shapes: ["高い"],
      parts: ["塔"],
      numbers: [3]
    }
  }
];

// 建築パラメータテストデータ
const buildingTestCases = [
  {
    input: {
      roofShape: "round",
      windowCount: 4,
      wallColor: "#ff0000"
    },
    worker: workerProfiles["worker-01"],
    expected: {
      roofShape: "round",
      windowCount: 3,  // 数字理解力0.7で誤解
      wallColor: "#ff8888",  // 色理解力0.8で少しズレる
      understandingScore: 0.75
    }
  }
];
```

## 8. パフォーマンス設計

### 8.1 パフォーマンス目標
- 音声認識レスポンスタイム: <500ms
- 建築生成時間: <2秒
- フレームレート: 60fps維持
- メモリ使用量: <200MB

### 8.2 最適化戦略
1. **音声認識**
   - チャンクサイズの最適化（2秒）
   - ストリーミングの並列処理
   - キャッシュの活用

2. **描画**
   - オフスクリーンキャンバスの使用
   - パーツのプリレンダリング
   - 描画呼び出しのバッチ処理

3. **メモリ管理**
   - 不要なオーディオデータの解放
   - イベントリスナーのクリーンアップ
   - ガベージコレクションのトリガー

## 9. セキュリティ設計

### 9.1 セキュリティ要件
- APIキーの安全な管理
- ユーザーデータの保護
- XSS対策
- CSRF対策

### 9.2 実装方針
1. **APIキー管理**
   - プロキシサーバー経由でのアクセス
   - クライアントサイドでのキーの直接使用禁止
   - 環境変数による管理

2. **データ保護**
   - ローカルストレージの使用制限
   - セッションデータの暗号化
   - データの定期的なクリア

3. **入力検証**
   - ユーザー入力のサニタイズ
   - APIレスポンスの検証
   - エラーメッセージのマスク

## 10. 依存関係

### 10.1 外部依存
- Mistral Voxtral API
- ElevenLabs API
- ブラウザのWeb Audio API
- ブラウザのMediaDevices API

### 10.2 内部依存
```
音声認識モジュール
   │
   ▼
建築理解エンジン ← ワーカープロファイル
   │
   ▼
建築生成システム
   │
   ▼
音声合成モジュール → ElevenLabs API
   │
   ▼
UI/UXモジュール → ユーザーインタラクション
```

---

**文書管理**
- 作成日: 2024-02-20
- 最終更新日: 2024-02-20
- バージョン: 1.0
- 状態: ドラフト
- 参照文書: プロダクト要求定義書 (PRD) v1.0
