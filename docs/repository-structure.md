# リポジトリ構造設計書 - Echo Builders

## 1. 概要

この文書は、Echo Buildersプロジェクトのリポジトリ構造を定義します。ファイルとディレクトリの組織化、命名規則、バージョン管理戦略について説明します。

## 2. リポジトリ構造

```
echo-builders/  # ルートディレクトリ
├── .git/        # Gitメタデータ（自動生成）
├── .github/     # GitHub固有の設定
│   ├── ISSUE_TEMPLATE/  # イシューテンプレート
│   ├── PULL_REQUEST_TEMPLATE.md  # プルリクエストテンプレート
│   └── workflows/  # GitHub Actionsワークフロー
├── .vibe/       # Mistral Vibe設定（既存）
├── docs/        # ドキュメント
│   ├── ideas/   # アイデアやメモ
│   ├── architecture.md  # アーキテクチャ設計書
│   ├── development-guidelines.md  # 開発ガイドライン
│   ├── functional-design.md  # 機能設計書
│   ├── glossary.md  # 用語集
│   ├── product-requirements.md  # プロダクト要求定義書
│   └── repository-structure.md  # リポジトリ構造設計書
├── public/      # 静的アセット（本番用）
│   ├── css/     # CSSファイル
│   ├── js/      # JavaScriptファイル
│   ├── images/  # 画像アセット
│   ├── sounds/  # 音声アセット
│   └── fonts/   # フォント
├── src/         # ソースコード
│   ├── client/   # クライアントサイドコード
│   │   ├── core/ # コアモジュール
│   │   │   ├── game.js  # ゲームエンジン
│   │   │   ├── voice.js  # 音声認識
│   │   │   ├── building.js  # 建築理解
│   │   │   ├── render.js  # 描画エンジン
│   │   │   └── audio.js  # 音声合成
│   │   ├── ui/   # UIコンポーネント
│   │   │   ├── controls.js  # コントロール
│   │   │   ├── hud.js  # HUD表示
│   │   │   ├── dialog.js  # ダイアログ
│   │   │   └── notifications.js  # 通知
│   │   ├── utils/  # ユーティリティ
│   │   │   ├── helpers.js  # ヘルパー関数
│   │   │   ├── constants.js  # 定数
│   │   │   └── types.js  # タイプ定義
│   │   └── data/  # データ
│   │       ├── workers.js  # ワーカー定義
│   │       ├── buildings.js  # 建築定義
│   │       └── voices.js  # 音声定義
│   └── server/   # サーバーサイドコード
│       ├── proxy/  # プロキシサーバー
│       │   ├── main.py  # メインエントリポイント
│       │   ├── routes/  # ルーティング
│       │   │   ├── voxtral.py  # Voxtral APIルート
│       │   │   └── elevenlabs.py  # ElevenLabs APIルート
│       │   ├── services/  # サービス
│       │   │   ├── voxtral_service.py  # Voxtralサービス
│       │   │   └── elevenlabs_service.py  # ElevenLabsサービス
│       │   ├── models/  # データモデル
│       │   │   ├── request.py  # リクエストモデル
│       │   │   └── response.py  # レスポンスモデル
│       │   └── config/  # 設定
│       │       ├── settings.py  # 設定
│       │       └── logging.py  # ロギング設定
│       └── scripts/  # ユーティリティスクリプト
│           ├── deploy.py  # デプロイスクリプト
│           └── test_data.py  # テストデータ生成
├── tests/       # テスト
│   ├── unit/     # ユニットテスト
│   │   ├── client/  # クライアントサイドテスト
│   │   └── server/  # サーバーサイドテスト
│   ├── integration/  # 統合テスト
│   └── e2e/      # E2Eテスト
├── tools/       # 開発ツール
│   ├── build/    # ビルドスクリプト
│   ├── lint/     # リント設定
│   └── format/   # フォーマット設定
├── .gitignore   # Git無視ファイル
├── .env.example  # 環境変数テンプレート
├── .editorconfig  # エディタ設定
├── .eslintrc.js  # ESLint設定
├── .prettierrc  # Prettier設定
├── package.json  # Node.js設定
├── requirements.txt  # Python依存関係
├── README.md     # プロジェクト概要
├── CONTRIBUTING.md  # コントリビューションガイド
├── LICENSE       # ライセンス
└── CHANGELOG.md  # 変更履歴
```

## 3. ディレクトリ構造の詳細

### 3.1 ルートディレクトリ

| ファイル/ディレクトリ | 目的 |
|----------------------|------|
| `.git/` | Gitメタデータ（自動生成） |
| `.github/` | GitHub固有の設定 |
| `.vibe/` | Mistral Vibe設定（既存） |
| `docs/` | プロジェクトドキュメント |
| `public/` | 静的アセット（本番用） |
| `src/` | ソースコード |
| `tests/` | テストコード |
| `tools/` | 開発ツール |
| `.gitignore` | Git無視ファイル |
| `.env.example` | 環境変数テンプレート |
| `.editorconfig` | エディタ設定 |
| `package.json` | Node.js設定 |
| `requirements.txt` | Python依存関係 |
| `README.md` | プロジェクト概要 |
| `CONTRIBUTING.md` | コントリビューションガイド |
| `LICENSE` | ライセンス |
| `CHANGELOG.md` | 変更履歴 |

### 3.2 ドキュメントディレクトリ (`docs/`)

```
docs/
├── ideas/          # アイデアやメモ
│   ├── building-mechanics.md  # 建築メカニズムのアイデア
│   ├── worker-personalities.md  # ワーカーの個性
│   └── game-modes.md  # ゲームモード
├── architecture.md  # アーキテクチャ設計書
├── development-guidelines.md  # 開発ガイドライン
├── functional-design.md  # 機能設計書
├── glossary.md  # 用語集
├── product-requirements.md  # プロダクト要求定義書
└── repository-structure.md  # リポジトリ構造設計書
```

### 3.3 クライアントサイドソース (`src/client/`)

```
src/client/
├── core/          # コアモジュール
│   ├── game.js     # ゲームエンジン
│   ├── voice.js    # 音声認識
│   ├── building.js # 建築理解
│   ├── render.js   # 描画エンジン
│   └── audio.js    # 音声合成
├── ui/            # UIコンポーネント
│   ├── controls.js # コントロール
│   ├── hud.js      # HUD表示
│   ├── dialog.js   # ダイアログ
│   └── notifications.js  # 通知
├── utils/         # ユーティリティ
│   ├── helpers.js  # ヘルパー関数
│   ├── constants.js  # 定数
│   └── types.js    # タイプ定義
└── data/          # データ
    ├── workers.js  # ワーカー定義
    ├── buildings.js  # 建築定義
    └── voices.js    # 音声定義
```

### 3.4 サーバーサイドソース (`src/server/`)

```
src/server/
├── proxy/          # プロキシサーバー
│   ├── main.py     # メインエントリポイント
│   ├── routes/     # ルーティング
│   │   ├── voxtral.py  # Voxtral APIルート
│   │   └── elevenlabs.py  # ElevenLabs APIルート
│   ├── services/   # サービス
│   │   ├── voxtral_service.py  # Voxtralサービス
│   │   └── elevenlabs_service.py  # ElevenLabsサービス
│   ├── models/     # データモデル
│   │   ├── request.py  # リクエストモデル
│   │   └── response.py  # レスポンスモデル
│   └── config/     # 設定
│       ├── settings.py  # 設定
│       └── logging.py  # ロギング設定
└── scripts/        # ユーティリティスクリプト
    ├── deploy.py    # デプロイスクリプト
    └── test_data.py  # テストデータ生成
```

### 3.5 テストディレクトリ (`tests/`)

```
tests/
├── unit/          # ユニットテスト
│   ├── client/    # クライアントサイドテスト
│   │   ├── game.test.js  # ゲームエンジンゆニットテスト
│   │   ├── voice.test.js  # 音声認識ユニットテスト
│   │   ├── building.test.js  # 建築理解ユニットテスト
│   │   ├── render.test.js  # 描画エンジンウニットテスト
│   │   └── audio.test.js  # 音声合成ユニットテスト
│   └── server/    # サーバーサイドテスト
│       ├── voxtral_service.test.py  # Voxtralサービステスト
│       └── elevenlabs_service.test.py  # ElevenLabsサービステスト
├── integration/   # 統合テスト
│   ├── client-server.test.js  # クライアント-サーバー統合テスト
│   └── api-flow.test.js  # APIフローテスト
└── e2e/           # E2Eテスト
    ├── gameplay.test.js  # ゲームプレイE2Eテスト
    └── ui-flow.test.js  # UIフローテスト
```

### 3.6 パブリックディレクトリ (`public/`)

```
public/
├── css/          # CSSファイル
│   ├── main.css   # メインスタイル
│   ├── reset.css  # リセットスタイル
│   └── components/  # コンポーネントスタイル
├── js/           # JavaScriptファイル（ビルド済み）
│   ├── bundle.js  # バンドル済みコード
│   └── vendors/  # ベンダーファイル
├── images/       # 画像アセット
│   ├── sprites/  # スプライトシート
│   ├── ui/       # UI画像
│   └── backgrounds/  # 背景画像
├── sounds/       # 音声アセット
│   ├── effects/  # 効果音
│   └── voices/   # 音声
└── fonts/        # フォント
    ├── pixel-font.woff2  # ピクセルフォント
    └── ui-font.woff2     # UIフォント
```

## 4. ファイル命名規則

### 4.1 一般的な命名規則

| タイプ | 規則 | 例 |
|--------|------|----|
| ディレクトリ | kebab-case | `src/client/core/` |
| JavaScriptファイル | kebab-case.js | `game-engine.js` |
| Pythonファイル | snake_case.py | `voxtral_service.py` |
| CSSファイル | kebab-case.css | `main-styles.css` |
| テストファイル | [原ファイル名].test.[ext] | `game.test.js` |
| コンポーネント | kebab-case | `voice-recognition/` |
| ユーティリティ | kebab-case | `string-helpers.js` |
| 定数 | UPPER_SNAKE_CASE | `GAME_CONSTANTS.js` |

### 4.2 特定の命名規則

#### 4.2.1 JavaScriptファイル

- **コアモジュール**: `[機能名].js` (例: `game.js`, `voice.js`)
- **ユーティリティ**: `[機能]-helpers.js` (例: `string-helpers.js`)
- **定数**: `[領域]-constants.js` (例: `game-constants.js`)
- **タイプ**: `[領域]-types.js` (例: `game-types.js`)
- **テスト**: `[原ファイル名].test.js` (例: `game.test.js`)

#### 4.2.2 Pythonファイル

- **メインファイル**: `main.py`
- **ルート**: `[api名]_routes.py` (例: `voxtral_routes.py`)
- **サービス**: `[api名]_service.py` (例: `voxtral_service.py`)
- **モデル**: `[領域]_models.py` (例: `request_models.py`)
- **設定**: `[領域]_settings.py` (例: `api_settings.py`)
- **テスト**: `test_[原ファイル名].py` (例: `test_voxtral_service.py`)

#### 4.2.3 CSSファイル

- **メインスタイル**: `main.css`
- **リセット**: `reset.css`
- **コンポーネント**: `[コンポーネント名].css` (例: `hud.css`)
- **ユーティリティ**: `_utilities.css`
- **変数**: `_variables.css`

## 5. バージョン管理

### 5.1 Gitブランチ戦略

**ブランチ種類**:

| ブランチ | 目的 |命名規則 |
|----------|------|---------|
| main | 本番リリースタグ | `main` |
| develop | 開発用メインブランチ | `develop` |
| feature | 新機能開発 | `feature/[機能名]` |
| bugfix | バグ修正 | `bugfix/[問題概要]` |
| hotfix | 本番環境の緊急修正 | `hotfix/[問題概要]` |
| release | リリース準備 | `release/[バージョン]` |
| docs | ドキュメント更新 | `docs/[トピック]` |
| refactor | リファクタリング | `refactor/[領域]` |

**例**:
- `feature/voice-recognition`
- `bugfix/transcript-display`
- `hotfix/microphone-permission`
- `release/v1.0.0`
- `docs/architecture`
- `refactor/game-engine`

### 5.2 コミットメッセージ規則

**フォーマット**: `<タイプ>(<スコープ>): <サブジェクト>`

**タイプ**:
- `feat`: 新機能
- `fix`: バグ修正
- `docs`: ドキュメントのみの変更
- `style`: コードの意味に影響しない変更（フォーマット、セミコロンなど）
- `refactor`: バグ修正でも新機能でもないコード変更
- `perf`: パフォーマンス向上に関するコード変更
- `test`: テストの追加または修正
- `chore`: ビルドプロセスや補助ツールの変更
- `revert`: コミットの取り消し

**スコープ**: 変更が影響する領域（オプショナル）
- `game`: ゲームエンジン
- `voice`: 音声認識
- `ui`: ユーザーインターフェース
- `server`: サーバーサイド
- `docs`: ドキュメント

**例**:
- `feat(voice): add real-time transcript display`
- `fix(game): correct building animation timing`
- `docs: update architecture diagram`
- `refactor(ui): reorganize component structure`
- `test(voice): add microphone permission tests`

### 5.3 プルリクエスト規則

**タイトル**: `<タイプ>: <簡潔な説明>`

**本文**:
```markdown
## 概要
- 変更の簡潔な説明

## 変更内容
- 具体的な変更点1
- 具体的な変更点2
- 具体的な変更点3

## 関連イシュー
- Fixes #123
- Related to #456

## テスト
- 実施したテストの説明
- テスト結果

## スクリーンショット（必要に応じて）
```

**例**:
```markdown
## 概要
音声認識のリアルタイム転写表示機能を追加

## 変更内容
- VoiceRecognitionモジュールにonTranscriptコールバックを追加
- UIモジュールに転写表示エリアを実装
- ゲームエンジンとの統合

## 関連イシュー
- Fixes #42
- Related to #56

## テスト
- マイク入力テストを実施
- 転写表示がリアルタイムで更新されることを確認
- エラーケースをテスト
```

## 6. 依存関係管理

### 6.1 クライアントサイド依存関係

**管理方法**: CDNまたはnpmパッケージ

**主要依存関係**:
- 現在のプロジェクトではバニラJSを使用
- 将来的な依存関係は`package.json`で管理

**例** (`package.json`):
```json
{
  "name": "echo-builders",
  "version": "1.0.0",
  "description": "AI-powered building game with voice commands",
  "main": "public/js/bundle.js",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "devDependencies": {
    "eslint": "^8.40.0",
    "prettier": "^2.8.8"
  }
}
```

### 6.2 サーバーサイド依存関係

**管理方法**: `requirements.txt`

**例** (`requirements.txt`):
```
fastapi==0.95.2
uvicorn==0.22.0
python-dotenv==1.0.0
httpx==0.23.3
python-multipart==0.0.6
cors-headers==0.1.0
```

**開発依存関係** (`requirements-dev.txt`):
```
pytest==7.3.1
black==23.3.0
flake8==6.0.0
mypy==1.3.0
```

## 7. ビルドとデプロイメント

### 7.1 ビルドプロセス

**クライアントサイド**:
```bash
# 開発モード
# 単一HTMLファイルのため、特別なビルドは不要
# 直接index.htmlを開く

# 本番モード（将来的）
# npm run build
```

**サーバーサイド**:
```bash
# 開発モード
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python src/server/proxy/main.py

# 本番モード
pip install -r requirements.txt --no-dev
gunicorn -k uvicorn.workers.UvicornWorker src.server.proxy.main:app
```

### 7.2 デプロイメントプロセス

**開発環境**:
```bash
# ローカル開発
1. Pythonプロキシサーバーを起動
   python src/server/proxy/main.py

2. index.htmlをブラウザで開く
   open public/index.html

3. API設定を確認
   - window.__MISTRAL_PROXY_URL = 'http://localhost:8000'
```

**本番環境**:
```bash
# Heroku例
1. Heroku CLIをインストール
2. Herokuにログイン
   heroku login

3. アプリを作成
   heroku create echo-builders

4. 環境変数を設定
   heroku config:set MISTRAL_API_KEY=your_api_key

5. デプロイ
   git push heroku main

6. データベース設定（必要に応じて）
   heroku addons:create heroku-postgresql:hobby-dev
```

## 8. コード品質管理

### 8.1 リントとフォーマット

**JavaScript**:
- ESLint: `.eslintrc.js`
- Prettier: `.prettierrc`

**Python**:
- Black: `pyproject.toml`
- Flake8: `.flake8`
- mypy: `mypy.ini`

### 8.2 テスト

**テストカバレッジ目標**: 80%

**テスト実行**:
```bash
# クライアントサイドテスト
npm test

# サーバーサイドテスト
pytest tests/

# カバレッジレポート
pytest --cov=src/server tests/ --cov-report=html
```

### 8.3 コードレビュー

**チェックリスト**:
- [ ] コードが機能要件を満たしている
- [ ] テストが追加されている
- [ ] ドキュメントが更新されている
- [ ] コードスタイルが一貫している
- [ ] パフォーマンスが考慮されている
- [ ] セキュリティが考慮されている
- [ ] エラーハンドリングが適切である
- [ ] 依存関係が更新されている

## 9. 移行計画

### 9.1 現行構造からの移行

**現行構造**:
```
2dgame-mock/
├── game.js
├── index.html
├── voxtral.js
├── mistral_proxy.py
└── requirements.txt
```

**移行ステップ**:

1. **ディレクトリ構造の整理**
   ```bash
   mkdir -p src/client/core src/server/proxy public/js public/css
   mv game.js src/client/core/
   mv voxtral.js src/client/core/audio.js
   mv mistral_proxy.py src/server/proxy/main.py
   ```

2. **HTMLファイルの移動**
   ```bash
   mv index.html public/
   ```

3. **依存関係ファイルの更新**
   ```bash
   # requirements.txtをsrc/server/に移動
   mv requirements.txt src/server/
   ```

4. **パスの更新**
   - `public/index.html`内のスクリプトパスを更新
   - `src/client/core/*.js`内の相対パスを更新

5. **ドキュメントの整理**
   ```bash
   mkdir -p docs/ideas
   # 既存のドキュメントをdocs/に移動
   ```

### 9.2 移行後の構造

```
echo-builders/
├── docs/
│   ├── ideas/
│   └── (その他のドキュメント)
├── public/
│   ├── index.html
│   ├── css/
│   └── js/
├── src/
│   ├── client/
│   │   └── core/
│   │       ├── game.js
│   │       ├── voice.js
│   │       ├── building.js
│   │       ├── render.js
│   │       └── audio.js (旧voxtral.js)
│   └── server/
│       └── proxy/
│           └── main.py (旧mistral_proxy.py)
└── (その他のファイル)
```

## 10. 運用と保守

### 10.1 ロギング

**クライアントサイド**:
- `console.log()`: デバッグログ
- `console.warn()`: 警告
- `console.error()`: エラー
- デバッグモードフラグ: `window.__DEBUG__`

**サーバーサイド**:
- 構造化ロギング
- ログレベル: DEBUG, INFO, WARNING, ERROR, CRITICAL
- ログファイル: `/var/log/echo-builders/app.log`

### 10.2 モニタリング

**メトリクス**:
- リクエスト数
- エラーレート
- レスポンスタイム
- API呼び出し数
- ユーザーセッション

**アラート**:
- エラーレートしきい値超過
- レスポンスタイム遅延
- APIエラー
- サーバーダウン

### 10.3 バックアップ

**バックアップ対象**:
- ソースコード（Gitで管理）
- 設定ファイル
- ログファイル（必要に応じて）

**バックアップ頻度**:
- ソースコード: コミットごと
- 設定ファイル: 変更ごと
- ログファイル: 日次

## 11. 参照リポジトリ構造

### 11.1 類似プロジェクトの構造

1. **Phaser 3プロジェクト**
   ```
   phaser-project/
   ├── src/
   │   ├── scenes/
   │   ├── objects/
   │   └── main.js
   ├── assets/
   │   ├── images/
   │   ├── sounds/
   │   └── sprites/
   └── index.html
   ```

2. **Three.jsプロジェクト**
   ```
   threejs-project/
   ├── src/
   │   ├── components/
   │   ├── systems/
   │   └── main.js
   ├── public/
   │   ├── assets/
   │   └── index.html
   └── package.json
   ```

3. **FastAPIプロジェクト**
   ```
   fastapi-project/
   ├── app/
   │   ├── main.py
   │   ├── routes/
   │   ├── services/
   │   └── models/
   ├── tests/
   └── requirements.txt
   ```

### 11.2 ベストプラクティス

1. **単一責任原則**: 各ディレクトリとファイルには明確な責務を持たせる
2. **一貫性**: 命名規則と構造をプロジェクト全体で一貫させる
3. **スケーラビリティ**: 将来的な拡張を考慮した構造にする
4. **発見可能性**: 新しい開発者が容易に理解できる構造にする
5. **保守性**: 変更が容易でテスト可能な構造にする

---

**文書管理**
- 作成日: 2024-02-20
- 最終更新日: 2024-02-20
- バージョン: 1.0
- 状態: ドラフト
- 参照文書: 
  - プロダクト要求定義書 (PRD) v1.0
  - 機能設計書 v1.0
  - アーキテクチャ設計書 v1.0
