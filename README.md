# 2D Dot Action (No Framework)

2D のドット風アクションゲーム（HTML + Canvas + JavaScript）。

## 構成
- `index.html`
- `game.js`
- `voxtral.js`

## 実行方法

### 開発環境セットアップ

1. **Python簡易サーバーを起動**（ポート8000）
   ```bash
   python3 -m http.server 8000
   ```

2. **環境変数を設定**
   - `.env.example` をコピーして `.env` ファイルを作成し、Mistral APIキーを設定してください
   ```bash
   cp .env.example .env
   # .env ファイルを編集して MISTRAL_API_KEY を設定
   ```

3. **プロキシサーバーを起動**（ポート8001）
   ```bash
   source .venv/bin/activate  # 仮想環境をアクティベート
   python3 mistral_proxy.py
   ```

4. **ブラウザで開く**
   - `http://localhost:8000/` にアクセス
   - テストボタンを使って音声認識をテスト

### 本番環境

- プロキシサーバーをデプロイ

## 操作
- プレイヤー移動: なし（固定位置）
- リトライ: `R`
- AI支援: `M` でマイク開始/停止（話した内容でコマンド判定）
- **テストボタン**: 事前録音された音声ファイルを使ってテスト
  - 「テスト:赤い屋根」: "Build a red roof"を送信
  - 「テスト:窓2つ」: "Put two windows"を送信

## Voxtral API の呼び出し方（重要）
`voxtral.js` は `window` 変数を読み込むだけで動作します。

- 開発では `window.__MISTRAL_API_KEY` でも動かせます（※ブラウザにキーが載るため本番非推奨）
- 本番は `window.__MISTRAL_PROXY_URL` 経由でトークンを隠してください（推奨）
- `window.__MISTRAL_DEBUG = true` にすると、コンソールへリクエスト/レスポンスの詳細が出力されます。
- `voxtral-mini` は現行APIでは無効なモデル名で 400 が出る可能性があるため、`..._MODEL` は `...-latest` 系（`voxtral-mini-latest` 等）を優先しています。

### すぐ使える最低手順
`index.html` の `voxtral.js` より前に次を置いてください。

```html
<script>
  // 開発用（Pythonプロキシ）
  window.__MISTRAL_PROXY_URL = 'http://127.0.0.1:8001';
  // window.__MISTRAL_DEBUG = true; // 詳細ログを有効化
  // 共通
  window.__MISTRAL_API_MODEL = 'mistral-small-latest';
  window.__MISTRAL_AUDIO_TRANSCRIPT_MODEL = 'voxtral-mini-latest';
</script>
<script src="voxtral.js" defer></script>
<script src="game.js" defer></script>
```

ポイント:
- `window.__MISTRAL_PROXY_URL` を設定すると、`window.__MISTRAL_API_KEY` は不要です。
- 開発時の本番相当運用として、ブラウザにはキーを出しません。
- 直書きキーでも動作確認できますが、`window.__MISTRAL_API_URL` の設定も必要です。

## 2つの設定パターン

### 1) 推奨: プロキシ経由
1. Pythonプロキシを起動

```bash
cd /Users/uchida/code/hackason-mistral/2dgame-mock
python3 -m pip install -r requirements-proxy.txt
# .env ファイルを作成して MISTRAL_API_KEY を設定
cp .env.example .env
# .env ファイルを編集して MISTRAL_API_KEY を設定
source .venv/bin/activate
python3 mistral_proxy.py
```

2. `http://127.0.0.1:8001` が起動し、次を中継します
- `POST /v1/chat/completions`
- `POST /v1/audio/transcriptions`

3. `index.html` の設定に合わせる（`http://127.0.0.1:8001`）

```html
<script>
  window.__MISTRAL_PROXY_URL = 'http://127.0.0.1:8001';
</script>
```

環境変数（`.env` ファイルで設定可能）：
- `MISTRAL_API_KEY`（必須、Mistral APIキー）
- `MISTRAL_API_BASE`（任意、既定: `https://api.mistral.ai`）
- `MISTRAL_PROXY_HOST`（任意、既定: `127.0.0.1`）
- `MISTRAL_PROXY_PORT`（任意、既定: `8001`）
- `MISTRAL_PROXY_CORS_ORIGIN`（任意、既定: `*`）
- `MISTRAL_PROXY_LOG_LEVEL`（任意、既定: `DEBUG`）



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
// 開発: ローカルPythonプロキシを使う場合（推奨）
window.__MISTRAL_PROXY_URL = 'http://127.0.0.1:8001';
window.__MISTRAL_API_MODEL = 'mistral-small-latest';
window.__MISTRAL_AUDIO_TRANSCRIPT_MODEL = 'voxtral-mini-latest';

// 直書き（非推奨）
// window.__MISTRAL_API_KEY = 'sk-...';
// window.__MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
```

## 補足
- この実装は `stream: true` を使ったレスポンス（ストリーミング）を優先し、
  `text/event-stream` 以外が返る場合は通常 JSON 形式として fallback します。
- 文字起こし・チャットの両方で、`Invalid model` が返る場合は自動的に `...-latest` 系モデルへ再試行します。
- `model` 名は環境差があるため、実際の Mistral 側仕様に合わせて置き換えてください（ここは不確実なので必ず確認）。

### 文字起こしが動かない場合のログ
- `window.__MISTRAL_DEBUG = true` の場合、ブラウザコンソールに以下が出ます。
  - `audio request start` / `audio request failed` / `audio request failed detail`
  - `audio stream fallback retry`（ストリーミングで失敗した時の再試行）
  - `media recorder chunk available` / `final transcript`
- `audio decode failure detected`（`Audio input could not be decoded` 対応時）
- まずこのログを確認して、空のチャンクが大量に出る、もしくは 400/401/415 エラーが出るか確認してください。
- `Audio input could not be decoded` が続く場合は、録音データを全件まとめて非ストリーミング再送するフォールバックが走るはずです。  
  その後も出るときは、ブラウザ側で `webm/opus` 以外の `MediaRecorder` MIME が使われている可能性を疑い、  
  `chooseAudioMimeType` の候補順（`audio/mp4` など）を入れ替えてください。
