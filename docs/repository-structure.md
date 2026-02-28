# リポジトリ構造設計書 - Echo Builders

## 1. 目的

本ドキュメントは、現行の Echo Builders リポジトリ構成を定義し、主要ファイルの責務を明確化する。

## 2. 優先度

- **p0**: 実装・運用の前提となる現行構成
- **p1**: 将来整理（現行では必須ではない）

## 3. リポジトリ構成（現行）

```
2dgame-mock/
├─ .env
├─ .env.example
├─ .vibe/
│  ├─ README.md
│  ├─ commands/
│  ├─ prompts/
│  ├─ agents/
│  ├─ commit_rules.md
│  ├─ config.toml
│  └─ setup-project.toml
├─ .git
├─ .gitignore
├─ README.md
├─ requirements.txt
├─ plan.md
├─ improvement-todo.md
├─ memo-for-presen.md
├─ index.html
├─ game-engine.js
├─ game-data.js
├─ game-commands.js
├─ voxtral.js
├─ mistral_proxy.py
├─ ref/
├─ wav/
├─ favicon.ico
├─ favicon.svg
└─ docs/
   ├─ product-requirements.md
   ├─ functional-design.md
   ├─ architecture.md
   ├─ repository-structure.md
   ├─ development-guidelines.md
   ├─ glossary.md
   └─ ideas/
```

## 4. 主要ファイル責務

### 4.1 クライアント本体

- `index.html`
  - `<canvas>` とUIボタン（マイク、結果パネル、デバッグテスト）
  - スクリプト起点
  - 初期設定（プロキシURLなど）をインラインで保持

- `game-data.js`
  - 定数・設定（速度、画面、NPC/NPC関連数値）
  - NPCや家パーツの初期データ

- `game-commands.js`
  - 音声テキストの解釈
  - NPCへの指示割当
  - 建築進捗ロジック（数量付き建築含む）
  - 結果ログの生成

- `game-engine.js`
  - 描画ループ
  - NPCと世界状態の更新
  - リセット/ゲーム進行制御
  - Voxtral連携ハンドシェイク

- `voxtral.js`
  - 音声録音制御
  - Voxtral への文字起こしリクエスト
  - ライブ文字列の管理（HUD）
  - ゲームAPIとの結合

- `mistral_proxy.py`
  - 音声転写のためのバックエンドプロキシ

### 4.2 補助

- `docs/*`
  - 仕様・設計ドキュメント

- `improvement-todo.md`
  - 未実装や検討事項のメモ（p0/p1管理）

- `ref/*` / `wav/*`
  - 開発参照素材（現時点では運用限定）

## 5. 命名規則

- JavaScript: `kebab-case.js` を原則（例: `game-engine.js`）
- Python: `snake_case.py` を原則（例: `mistral_proxy.py`）
- ドキュメント: 小文字ハイフンの識別名（`functional-design.md` 等）

## 6. 設計方針（構造）

1. **最小構成維持**
   - 1つのHTMLと複数JSで構成し、ビルド工程は不要
2. **高結合は段階的に切り離す**
   - まず `game-*` と `voxtral.js` を分離し、責務境界を明確化
3. **実験機能は p1**
   - TTS/スコアリング等は当面未実装として `docs` と `improvement-todo.md` に分離管理

## 7. 依存関係管理

### 7.1 クライアント
- 外部フレームワーク不使用
- 音声 API 利用はブラウザ標準 + `window` 経由の薄い API 連携

### 7.2 サーバー
- `requirements.txt` のみで管理（FastAPI ベース）

## 8. 運用上の前提

- 開発実行はローカルの Python プロキシ前提
- `index.html` が主要配布エントリ
- `game-commands.js` の仕様変更は、`docs/functional-design.md` と同期して更新

## 9. コード規約・変更ルール（概要）

### コミット
- ドキュメント更新: `docs: ...`
- 機能修正: `feat:` / `fix:`

### レビュー観点（最低ライン）
- 既存フロー（音声→解釈→建築）を壊していないこと
- p0/p1 の境界が曖昧にならないこと
- 新規依存の追加理由があること

## 文書管理

- 作成日: 2024-02-20
- 最終更新日: 2026-03-01
- バージョン: 1.1
- 状態: ドラフト
- 参照文書: `docs/product-requirements.md`, `docs/functional-design.md`, `docs/architecture.md`
