import "dotenv/config";
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
} from "discord.js";
import { ask, clearSession } from "./ciscord.js";
import { startDebate, isDebateActive } from "./debate.js";
import { handleReaction } from "./reactions.js";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN is required");
  process.exit(1);
}

const ALLOWED_USER_IDS = new Set(
  (process.env.ALLOWED_USER_IDS || "").split(",").filter(Boolean),
);

// Channel history buffer: channelId -> messages[]
const channelHistory = new Map<string, string[]>();
const MAX_HISTORY = 50;

function recordMessage(channelId: string, author: string, content: string) {
  if (!channelHistory.has(channelId)) {
    channelHistory.set(channelId, []);
  }
  const history = channelHistory.get(channelId)!;
  history.push(`${author}: ${content}`);
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

function getHistory(channelId: string): string {
  return (channelHistory.get(channelId) || []).join("\n");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Reaction],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

client.on(Events.MessageCreate, async (message: Message) => {
  // Skip own messages
  if (message.author.id === client.user?.id) return;

  const channelId = message.channel.isThread()
    ? message.channel.id
    : message.channelId;

  // Record all messages from allowed users
  if (ALLOWED_USER_IDS.size === 0 || ALLOWED_USER_IDS.has(message.author.id)) {
    recordMessage(channelId, message.author.displayName, message.content);
  }

  if (ALLOWED_USER_IDS.size > 0 && !ALLOWED_USER_IDS.has(message.author.id)) {
    return;
  }

  const botMention = `<@${client.user?.id}>`;
  const content = message.content.trim();

  // Only respond to mentions or DMs
  const isDM = !message.guild;
  const isMentioned = content.includes(botMention);
  if (!isDM && !isMentioned) return;

  // Strip mention from content
  const prompt = content.replace(botMention, "").trim();
  if (!prompt) return;

  console.log(`[msg] from=${message.author.tag} prompt="${prompt.slice(0, 80)}"`);

  // Commands
  if (prompt.startsWith("!debate ")) {
    const args = prompt.slice("!debate ".length).trim();
    if (args) {
      await startDebate(message, args);
      return;
    }
  }

  if (prompt === "!clear") {
    clearSession(channelId);
    channelHistory.delete(channelId);
    await (message.channel as any).send("セッションをクリアしました。");
    return;
  }

  // Skip if this thread has an active debate
  if (
    message.channel.isThread() &&
    isDebateActive(message.channel.id)
  ) {
    return;
  }

  // Typing indicator
  const channel = message.channel;
  const sendTyping = () => {
    if ("sendTyping" in channel) {
      (channel as any).sendTyping().catch(() => {});
    }
  };
  const typingInterval = setInterval(sendTyping, 5000);
  sendTyping();

  try {
    const history = getHistory(channelId);
    const fullPrompt = history
      ? `[チャンネルの直近の会話]\n${history}\n\n[あなたへの質問]\n${prompt}`
      : prompt;

    const result = await ask(fullPrompt, channelId);
    const finalText = truncateForDiscord(result);

    // Record bot's own response
    recordMessage(channelId, "ciscord", finalText);

    await (message.channel as any).send(finalText || "応答を生成できませんでした。");
  } catch (error) {
    console.error("Error:", error);
    await (message.channel as any).send(`エラーが発生しました: ${error}`).catch(() => {});
  } finally {
    clearInterval(typingInterval);
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.partial) {
    try {
      await user.fetch();
    } catch {
      return;
    }
  }
  await handleReaction(reaction, user as any, ALLOWED_USER_IDS);
});

function truncateForDiscord(text: string): string {
  if (text.length <= 2000) return text;
  return text.slice(0, 1997) + "...";
}

client.login(DISCORD_TOKEN);
