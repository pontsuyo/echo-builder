# 2D Dot Action (No Framework)

2D のドット風アクションゲーム（HTML + Canvas + JavaScript）。

## 構成
- `index.html`
- `game.js`
- `voxtral.js`

## 実行方法
ローカルで開くだけで動きます。

- `index.html` をブラウザで開く
- もしくは簡易サーバーを使う
  - `python3 -m http.server`
  - `http://localhost:8000`

## 操作
- 左右移動: `←` `→`（または `A` `D`）
- ジャンプ: `Z`（または `Space`）
- リトライ: `R`
- ヒント取得: `H` または「Voxtralでヒント取得」ボタン

## Voxtral API の呼び出し方（重要）
`voxtral.js` は `window` 変数を読み込むだけで動作します。

- 開発では `window.__MISTRAL_API_KEY` でも動かせます（※ブラウザにキーが載るため本番非推奨）
- 本番は `window.__MISTRAL_PROXY_URL` 経由でトークンを隠してください（推奨）

### すぐ使える最低手順
`index.html` の `voxtral.js` より前に次を置いてください。

```html
<script>
  // 開発用（直接キー）
  // window.__MISTRAL_API_KEY = 'sk-...';
  // window.__MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';

  // 本番用（推奨）
  window.__MISTRAL_PROXY_URL = 'https://your-proxy.example.com/mistral';

  // 共通
  window.__MISTRAL_API_MODEL = 'voxtral-mini';
</script>
<script src="voxtral.js" defer></script>
<script src="game.js" defer></script>
```

ポイント:
- `window.__MISTRAL_PROXY_URL` を設定すると、`VOXTRAL_API_KEY` が不要になります。
- `window.__MISTRAL_API_KEY` を使う場合は `window.__MISTRAL_API_URL` も必要です。

## 2つの設定パターン

### 1) 推奨: プロキシ経由
1. プロキシサーバーを用意（例: `/mistral`）
2. `index.html` の設定箇所に URL を設定

```html
<script>
  window.__MISTRAL_PROXY_URL = 'https://your-proxy.example.com/mistral';
</script>
```

### 2) 開発検証: 直書きキー
```html
<script>
  window.__MISTRAL_API_KEY = 'sk-...';
  window.__MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
</script>
```

### 3) ローカルファイルで分離（管理しやすい）
- `index.html` で先に `local-mistral-config.js` を読み込む
- `local-mistral-config.js` は `.gitignore` で除外して、共有しない

```html
<script src="local-mistral-config.js" defer></script>
<script src="voxtral.js" defer></script>
<script src="game.js" defer></script>
```

```js
// local-mistral-config.js
window.__MISTRAL_API_KEY = 'sk-...';
window.__MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
window.__MISTRAL_API_MODEL = 'voxtral-mini';
```

## 補足
- この実装は `stream: true` を使ったレスポンス（ストリーミング）を優先し、
  `text/event-stream` 以外が返る場合は通常 JSON 形式として fallback します。
- `model` 名は環境差があるため、実際の Mistral 側仕様に合わせて置き換えてください（ここは不確実なので必ず確認）。
