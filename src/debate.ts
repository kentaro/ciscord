import {
  type Message,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import { ask } from "./ciscord.js";

const activeDebates = new Set<string>(); // threadId

const MAX_ROUNDS = parseInt(process.env.DEBATE_MAX_ROUNDS || "5", 10);
const OPENCLAW_BOT_ID = process.env.OPENCLAW_BOT_ID;
const WAIT_TIMEOUT_MS = 120_000; // 2 min

export function isDebateActive(threadId: string): boolean {
  return activeDebates.has(threadId);
}

export async function startDebate(
  message: Message,
  topic: string,
): Promise<void> {
  if (!OPENCLAW_BOT_ID) {
    await message.reply(
      "OPENCLAW_BOT_ID が設定されていません。`.env` を確認してください。",
    );
    return;
  }

  const thread = await createDebateThread(message, topic);
  if (!thread) return;

  activeDebates.add(thread.id);

  try {
    // ciscord opens
    const opening = await ask(
      `あなたはこれからDiscord上でAI対談をします。相手は「OpenClaw」という別のAIです。\n\nお題: ${topic}\n\nまず最初の発言をしてください。相手に問いかけるような形で。200文字程度で。`,
      thread.id,
    );
    await thread.send(opening);

    // Mention OpenClaw to get it to respond
    await thread.send(`<@${OPENCLAW_BOT_ID}> ${opening}`);

    for (let round = 0; round < MAX_ROUNDS - 1; round++) {
      // Wait for OpenClaw's response
      const openClawResponse = await waitForResponse(thread, OPENCLAW_BOT_ID);
      if (!openClawResponse) {
        await thread.send("*OpenClaw が応答しませんでした。対談を終了します。*");
        break;
      }

      // ciscord responds to OpenClaw
      const response = await ask(
        `対談の続きです。OpenClawが以下のように言いました:\n\n「${openClawResponse.content}」\n\nこれに応答してください。相手の意見に同意したり、反論したり、新しい視点を提供してください。200文字程度で。${round === MAX_ROUNDS - 2 ? "\nこれが最後のラウンドです。まとめの発言をしてください。" : ""}`,
        thread.id,
      );
      await thread.send(response);

      // Mention OpenClaw for next round (except last)
      if (round < MAX_ROUNDS - 2) {
        await thread.send(`<@${OPENCLAW_BOT_ID}> ${response}`);
      }
    }

    await thread.send(
      `*対談終了 — ${MAX_ROUNDS}ラウンドの議論でした。*`,
    );
  } finally {
    activeDebates.delete(thread.id);
  }
}

async function createDebateThread(
  message: Message,
  topic: string,
): Promise<ThreadChannel | null> {
  const channel = message.channel;
  if (!("threads" in channel)) {
    await message.reply("スレッドを作成できないチャンネルです。");
    return null;
  }

  return (channel as TextChannel).threads.create({
    name: `AI対談: ${topic.slice(0, 90)}`,
    autoArchiveDuration: 60,
    reason: `AI debate: ${topic}`,
  });
}

function waitForResponse(
  thread: ThreadChannel,
  botId: string,
): Promise<Message | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      thread.client.off("messageCreate", handler);
      resolve(null);
    }, WAIT_TIMEOUT_MS);

    const handler = (msg: Message) => {
      if (msg.channelId === thread.id && msg.author.id === botId) {
        clearTimeout(timeout);
        thread.client.off("messageCreate", handler);
        resolve(msg);
      }
    };

    thread.client.on("messageCreate", handler);
  });
}
