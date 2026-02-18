import type { MessageReaction, PartialMessageReaction, User } from "discord.js";
import { ask } from "./ciscord.js";

type ReactionAction = {
  prompt: (content: string) => string;
  label: string;
};

const REACTION_MAP: Record<string, ReactionAction> = {
  "\u{1F50D}": {
    // 🔍
    prompt: (content) =>
      `以下のメッセージについて詳しく調べてください:\n\n${content}`,
    label: "調査中...",
  },
  "\u{1F4DD}": {
    // 📝
    prompt: (content) =>
      `以下のメッセージを簡潔に要約してください:\n\n${content}`,
    label: "要約中...",
  },
  "\u{1F41B}": {
    // 🐛
    prompt: (content) =>
      `以下のコードのバグや問題点を指摘してください:\n\n${content}`,
    label: "デバッグ中...",
  },
  "\u{1F1EF}\u{1F1F5}": {
    // 🇯🇵
    prompt: (content) =>
      `以下のメッセージを日本語に翻訳してください:\n\n${content}`,
    label: "翻訳中...",
  },
  "\u{1F1EC}\u{1F1E7}": {
    // 🇬🇧
    prompt: (content) =>
      `以下のメッセージを英語に翻訳してください:\n\n${content}`,
    label: "Translating...",
  },
};

export async function handleReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User,
  allowedUserIds: Set<string>,
): Promise<void> {
  if (user.bot) return;
  if (allowedUserIds.size > 0 && !allowedUserIds.has(user.id)) return;

  const emoji = reaction.emoji.name;
  if (!emoji || !(emoji in REACTION_MAP)) return;

  const action = REACTION_MAP[emoji];
  const message = reaction.message;

  if (message.partial) {
    try {
      await message.fetch();
    } catch {
      return;
    }
  }

  const content = message.content;
  if (!content) return;

  const threadId = message.channelId;
  const reply = await message.reply(`*${action.label}*`);

  try {
    const result = await ask(action.prompt(content), threadId);
    await reply.edit(result || "応答を生成できませんでした。");
  } catch (error) {
    await reply.edit(`エラーが発生しました: ${error}`);
  }
}
