import "dotenv/config";
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
  type TextBasedChannel,
} from "discord.js";
import { ask, clearSession, summarize } from "./ciscord.js";
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

type ChannelMemory = {
  summary: string;
  recent: string[];
};

const channelHistory = new Map<string, ChannelMemory>();
const backfilledChannels = new Set<string>();
const COMPACTION_THRESHOLD = 30;
const COMPACT_COUNT = 20;
const BACKFILL_LIMIT = 50;

function getOrCreateMemory(channelId: string): ChannelMemory {
  let memory = channelHistory.get(channelId);
  if (!memory) {
    memory = { summary: "", recent: [] };
    channelHistory.set(channelId, memory);
  }
  return memory;
}

function recordMessage(channelId: string, author: string, content: string) {
  const memory = getOrCreateMemory(channelId);
  memory.recent.push(`${author}: ${content}`);

  if (memory.recent.length >= COMPACTION_THRESHOLD) {
    triggerCompaction(channelId, memory);
  }
}

function triggerCompaction(channelId: string, memory: ChannelMemory) {
  const messagesToCompact = memory.recent.splice(0, COMPACT_COUNT);
  console.log(
    `[compaction] channelId=${channelId} compacting=${messagesToCompact.length} remaining=${memory.recent.length}`,
  );

  summarize(memory.summary, messagesToCompact)
    .then((newSummary) => {
      memory.summary = newSummary;
      console.log(
        `[compaction] channelId=${channelId} done summary=${newSummary.length} chars`,
      );
    })
    .catch((err) => {
      console.error(`[compaction] channelId=${channelId} error:`, err);
      // Restore messages on failure so we don't lose them
      memory.recent.unshift(...messagesToCompact);
    });
}

function getHistory(channelId: string): string {
  const memory = channelHistory.get(channelId);
  if (!memory) return "";

  const parts: string[] = [];
  if (memory.summary) {
    parts.push(`[これまでの要約]\n${memory.summary}`);
  }
  if (memory.recent.length > 0) {
    parts.push(`[直近の会話]\n${memory.recent.join("\n")}`);
  }
  return parts.join("\n\n");
}

async function backfillFromChannel(
  channelId: string,
  channel: TextBasedChannel,
  botId: string,
): Promise<void> {
  if (backfilledChannels.has(channelId)) return;
  backfilledChannels.add(channelId);

  try {
    const fetched = await channel.messages.fetch({ limit: BACKFILL_LIMIT });
    // fetched is newest-first, reverse to chronological order
    const messages = [...fetched.values()].reverse();
    const memory = getOrCreateMemory(channelId);

    for (const msg of messages) {
      if (msg.author.id === botId) {
        memory.recent.push(`ciscord: ${msg.content}`);
      } else {
        memory.recent.push(`${msg.author.displayName}: ${msg.content}`);
      }
    }

    console.log(
      `[backfill] channelId=${channelId} loaded=${messages.length} messages`,
    );

    if (memory.recent.length >= COMPACTION_THRESHOLD) {
      triggerCompaction(channelId, memory);
    }
  } catch (err) {
    console.error(`[backfill] channelId=${channelId} error:`, err);
  }
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

  // Backfill channel history on first access after startup
  await backfillFromChannel(channelId, message.channel as TextBasedChannel, client.user!.id);

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
    backfilledChannels.delete(channelId);
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
      ? `${history}\n\n[あなたへの質問]\n${prompt}`
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
