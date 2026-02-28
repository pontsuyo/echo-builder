# Design: 音声入力自動停止

## アーキテクチャ概要

### 現在のシステム構成
- `voxtral.js`: 音声認識と入力制御のメインロジック
- `game-engine.js`: ゲームエンジンと画面遷移管理
- `game-commands.js`: コマンド処理とセッション管理

### 提案設計

#### 1. イベント駆動型アプローチ
```
[画面遷移イベント] → [音声入力停止ハンドラー] → [音声入力停止]
```

#### 2. 具体的実装

**Option A: イベントリスナー追加（推奨）**
- `game-engine.js` に画面遷移イベントを発火する
- `voxtral.js` にイベントリスナーを追加し、家の画面遷移時に音声入力を停止

**Option B: 直接呼び出し**
- `game-engine.js` の画面遷移ロジック内で直接音声入力停止関数を呼び出す
- 結合度が高くなるため、Option Aを優先

#### 3. 実装詳細

**必要な変更:**
1. `game-engine.js` に画面遷移イベントを発火するコードを追加
2. `voxtral.js` にイベントリスナーを追加
3. 音声入力停止関数を作成（既存の停止ロジックを再利用）

**新規関数:**
```javascript
// voxtral.js
function stopVoiceInput() {
  if (isVoiceInputActive()) {
    // 現在のセッションを完了させるか、強制停止する
    // 自然な終了を優先する
  }
}

function onScreenTransition(screenId) {
  if (screenId === 'home' || screenId === 'house') {
    stopVoiceInput();
  }
}
```

**イベント発火:**
```javascript
// game-engine.js
function transitionToScreen(screenId) {
  // 既存の遷移ロジック
  
  // イベント発火
  window.dispatchEvent(new CustomEvent('screenTransition', {
    detail: { screenId }
  }));
}
```

#### 4. 設定オプション
```javascript
// 設定オブジェクトに追加
const config = {
  autoStopVoiceInputOnHome: true,  // デフォルトで有効
  // その他既存設定
};
```

## 技術的考慮事項

1. **音声入力の状態管理**
   - 現在の音声入力状態を正確に把握する必要がある
   - `isVoiceInputActive()` 関数を追加するか、既存の状態管理を利用する

2. **画面IDの特定**
   - 家の画面のIDを特定する必要がある
   - 既存の画面管理システムを調査する

3. **非同期処理**
   - 画面遷移と音声入力停止は非同期で処理する
   - ユーザー体験を損なわないように注意する

4. **エラーハンドリング**
   - 音声入力停止に失敗した場合の処理を考慮する
   - ログ出力やフォールバック処理を実装する

## テスト戦略

1. **単体テスト**
   - `stopVoiceInput()` 関数のテスト
   - `onScreenTransition()` 関数のテスト

2. **統合テスト**
   - 画面遷移と音声入力停止の連携テスト
   - 設定オプションの有効/無効切り替えテスト

3. **ユーザー体験テスト**
   - 実際の画面遷移時に音声入力が正しく停止するか確認
   - 自然な終了が行われているか確認
