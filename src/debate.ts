import {
  type Message,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import { ask } from "./ciscord.js";

const activeDebates = new Set<string>(); // threadId

const MAX_ROUNDS = parseInt(process.env.DEBATE_MAX_ROUNDS || "5", 10);
const WAIT_TIMEOUT_MS = 120_000; // 2 min

export function isDebateActive(threadId: string): boolean {
  return activeDebates.has(threadId);
}

export async function startDebate(
  message: Message,
  args: string,
): Promise<void> {
  // Extract mention and topic: "!debate @someone topic here"
  const mentionMatch = args.match(/^<@!?(\d+)>\s+(.+)/s);
  if (!mentionMatch) {
    await message.reply(
      "使い方: `!debate @相手 お題`\n例: `!debate @OpenClaw AIは意識を持てるか`",
    );
    return;
  }

  const targetId = mentionMatch[1];
  const topic = mentionMatch[2].trim();
  const targetMention = `<@${targetId}>`;

  const thread = await createDebateThread(message, topic);
  if (!thread) return;

  activeDebates.add(thread.id);

  try {
    // ciscord opens
    const opening = await ask(
      `あなたはこれからDiscord上でAI対談をします。相手は別のAIです。\n\nお題: ${topic}\n\nまず最初の発言をしてください。相手に問いかけるような形で。200文字程度で。`,
      thread.id,
    );
    await thread.send(opening);
    await thread.send(`${targetMention} ${opening}`);

    for (let round = 0; round < MAX_ROUNDS - 1; round++) {
      const reply = await waitForResponse(thread, targetId);
      if (!reply) {
        await thread.send("*相手が応答しませんでした。対談を終了します。*");
        break;
      }

      const response = await ask(
        `対談の続きです。相手が以下のように言いました:\n\n「${reply.content}」\n\nこれに応答してください。相手の意見に同意したり、反論したり、新しい視点を提供してください。200文字程度で。${round === MAX_ROUNDS - 2 ? "\nこれが最後のラウンドです。まとめの発言をしてください。" : ""}`,
        thread.id,
      );
      await thread.send(response);

      if (round < MAX_ROUNDS - 2) {
        await thread.send(`${targetMention} ${response}`);
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
  userId: string,
): Promise<Message | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      thread.client.off("messageCreate", handler);
      resolve(null);
    }, WAIT_TIMEOUT_MS);

    const handler = (msg: Message) => {
      if (msg.channelId === thread.id && msg.author.id === userId) {
        clearTimeout(timeout);
        thread.client.off("messageCreate", handler);
        resolve(msg);
      }
    };

    thread.client.on("messageCreate", handler);
  });
}
