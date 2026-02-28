# 先頭子供点滅表示 - 設計

## 設計概要

### 実装アプローチ

#### 1. 点滅状態管理
- `game-engine.js` に点滅状態を管理する変数を追加
- 点滅タイマーを使用して、一定間隔で表示/非表示を切り替える
- 点滅対象は子供の配列の先頭要素

#### 2. 点滅ロジック
- `drawChildren()` 関数内で点滅処理を実装
- 点滅中の子供は透明度を切り替えて表示
- 点滅間隔: 500ms（0.5秒）

#### 3. 点滅制御
- 子供の並びが変更されたときに点滅対象を更新
- 点滅は常に先頭の子供を対象とする
- 子供が1人以下の場合は点滅を停止

### 技術的詳細

#### 点滅状態管理
```javascript
// game-engine.js に追加
let blinkTimer = null;
let isBlinking = false;
let blinkCounter = 0;
```

#### 点滅関数
```javascript
function startBlinking() {
  if (isBlinking) return;
  isBlinking = true;
  blinkCounter = 0;
  blinkTimer = setInterval(() => {
    blinkCounter++;
  }, 500);
}

function stopBlinking() {
  if (blinkTimer) {
    clearInterval(blinkTimer);
    blinkTimer = null;
  }
  isBlinking = false;
  blinkCounter = 0;
}
```

#### 点滅表示ロジック
```javascript
function drawChildren() {
  if (children.length === 0) return;
  
  // 点滅対象は常に先頭の子供
  const firstChild = children[0];
  
  children.forEach((child, index) => {
    // 先頭の子供のみ点滅対象
    const isFirstChild = index === 0;
    
    if (isFirstChild && isBlinking) {
      // 点滅中は透明度を切り替え
      const opacity = (blinkCounter % 2 === 0) ? 1.0 : 0.5;
      drawChild(child, opacity);
    } else {
      // 通常表示
      drawChild(child, 1.0);
    }
  });
}
```

### 統合ポイント

1. **ゲーム初期化**: `init()` 関数で点滅状態を初期化
2. **子供追加/削除**: `addChild()` と `removeChild()` で点滅制御を更新
3. **ゲームループ**: `update()` 関数で点滅状態を更新
4. **描画**: `drawChildren()` 関数で点滅表示を実装

### 考慮事項

- 点滅が目立つように、透明度の切り替えを使用
- 点滅速度は視認性とストレスのバランスを考慮
- 点滅は常に先頭の子供を対象とするため、並び順の変更が自動的に反映される
- パフォーマンス影響を最小限に抑えるため、点滅処理は描画時にのみ実行
