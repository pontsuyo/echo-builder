# Echo Builder

音声で操作する 2D 建築ゲーム。話すと AI ワーカーがリアルタイムで家を建てます。

---

## 概要

Echo Builder は、音声コマンドで AI ワーカーを操作し、家を建設するブラウザベースのゲームです。話しかけると Mistral Voxtral が音声をテキストに変換し、ワーカーが屋根・壁・窓・ドア・煙突・柱などの部品を配置します。聞き間違いや誤解もデザインの一部で、不完全な解釈でも楽しめます。

---

## 主な機能

- **リアルタイム音声入力**: 自然に話して建築指示を出せます
- **Mistral Voxtral API**: ライブ音声コマンドの音声テキスト変換
- **コマンド解析**: 部品タイプ・個数・色を抽出
- **2D 建築**: ワーカーが屋根・壁・窓・ドア・煙突・柱を配置
- **ゴールとスコア**: 開始時にランダムゴール、建築完了時に個数・色・位置でスコアリング

---

## 技術スタック

- **フロントエンド**: HTML5, CSS3, JavaScript (ES6+), Canvas API
- **音声**: Mistral Voxtral API, MediaRecorder
- **バックエンド**: API キーを安全に扱う Python Flask プロキシ
- **フレームワークなし**: モジュール化されたスクリプトの単一 HTML ページ

---

## Mistral AI の利用方法

Echo Builder は Mistral Voxtral API で音声テキスト変換を行います。ブラウザのマイクからの音声を API にストリーミングし、テキスト化された結果を受け取ります。ゲームはそのテキストを建築コマンドに解析し、AI ワーカーの動作を駆動します。ローカルプロキシサーバーで API キーをブラウザ外で安全に管理します。

---

## 実行方法（ローカル）

1. **Python 簡易サーバーを起動**（ポート 8000）
   ```bash
   python3 -m http.server 8000
   ```

2. **環境変数を設定**
   - `.env.example` をコピーして `.env` を作成し、API キーを設定
   ```bash
   cp .env.example .env
   # .env を編集して設定:
   #   MISTRAL_API_KEY（必須）
   #   ELEVENLABS_API_KEY（任意、TTS 用）
   ```

3. **仮想環境を作成し、プロキシサーバーを起動**（ポート 8001）
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   python3 mistral_proxy.py
   ```

4. **ブラウザで開く**
   - `http://localhost:8000/` にアクセス
   - テストボタンで音声認識を確認
