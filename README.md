# ciscord

[Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) を使った Discord Bot。メンションで話しかけると Claude が応答する。

## 特徴

### AI対談モード

`@ciscord !debate AIは意識を持てるか` のようにお題を投げると、スレッドを作成して別の AI Bot（OpenClaw など）と自動で対談を始める。交互にメンションし合いながら数ラウンドの議論を繰り広げる。

### リアクション駆動

メッセージに絵文字リアクションを付けるだけで Claude が動く。

| リアクション | 動作 |
|---|---|
| 🔍 | 調査・深堀り |
| 📝 | 要約 |
| 🐛 | バグ・問題点の指摘 |
| 🇯🇵 | 日本語に翻訳 |
| 🇬🇧 | 英語に翻訳 |

### スレッド = セッション

Discord のスレッドごとにセッションを保持。同じスレッド内なら会話の文脈が引き継がれる。`!clear` でリセット。

### ストリーミング応答

生成中のメッセージをリアルタイムで編集表示。待ち時間のストレスを軽減。

## セットアップ

### 前提

- Node.js 18+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) がインストール済みで認証済み、または Anthropic API キー

### インストール

```bash
git clone https://github.com/kentaro/ciscord.git
cd ciscord
npm install
```

### 環境変数

`.env.example` をコピーして `.env` を作成：

```bash
cp .env.example .env
```

```env
# Discord Bot トークン（必須）
DISCORD_TOKEN=your-discord-bot-token

# 応答を許可するユーザーID（カンマ区切り、空なら全員に応答）
ALLOWED_USER_IDS=

# 認証（どちらか一方）
ANTHROPIC_API_KEY=sk-ant-...
# or
CLAUDE_CODE_OAUTH_TOKEN=oauth-token

# AI対談モード（任意）
OPENCLAW_BOT_ID=openclaw-bot-user-id
DEBATE_MAX_ROUNDS=5
```

### Discord Bot の作成

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーションを作成
2. **Bot** タブで Bot を作成、トークンをコピー
3. **Bot** タブで以下を有効化：
   - Message Content Intent
   - Server Members Intent（任意）
4. サーバーへの招待：

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=274877975552&scope=bot
```

### 起動

```bash
# 開発
npm run dev

# ビルド & 本番
npm run build
npm start
```

## 使い方

```
@ciscord こんにちは              # 普通に会話
@ciscord !debate 自由意志とは     # AI対談モードを開始
@ciscord !clear                  # セッションをリセット
```

リアクションはメッセージに絵文字を付けるだけ。

## Raspberry Pi で動かす

64-bit Raspberry Pi OS + 64-bit Node.js が必要。

```bash
# nvm で Node.js をインストール
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 22

# arch が arm64 であることを確認
node -e "console.log(process.arch)"  # arm64

# あとは通常通り
npm install && npm run build && npm start
```

## ライセンス

MIT
