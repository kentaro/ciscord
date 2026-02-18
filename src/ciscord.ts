import { query, type SDKMessage, type SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";

const sessions = new Map<string, string>(); // threadId -> sessionId

export type StreamCallback = (chunk: string, done: boolean) => Promise<void>;

export async function ask(
  prompt: string,
  threadId: string,
  onStream?: StreamCallback,
): Promise<string> {
  const existingSessionId = sessions.get(threadId);

  const q = query({
    prompt,
    options: {
      model: "claude-sonnet-4-6",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      tools: [],
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append:
          "You are ciscord, a helpful Discord bot. Keep responses concise and formatted for Discord (use markdown). Max 1900 chars per response.",
      },
      ...(existingSessionId ? { resume: existingSessionId } : {}),
      includePartialMessages: !!onStream,
      maxTurns: 3,
      thinking: { type: "disabled" },
    },
  });

  let result = "";
  let sessionId = "";
  let streamBuffer = "";
  let lastStreamTime = 0;

  for await (const message of q) {
    if ("session_id" in message && message.session_id) {
      sessionId = message.session_id;
    }

    if (onStream && message.type === "stream_event") {
      const event = (message as any).event;
      if (event?.type === "content_block_delta" && event.delta?.text) {
        streamBuffer += event.delta.text;
        const now = Date.now();
        if (now - lastStreamTime > 1000) {
          lastStreamTime = now;
          await onStream(streamBuffer, false);
        }
      }
    }

    if (message.type === "result" && message.subtype === "success") {
      result = (message as SDKResultSuccess).result;
    }
  }

  if (sessionId && threadId) {
    sessions.set(threadId, sessionId);
  }

  if (onStream && streamBuffer) {
    await onStream(result || streamBuffer, true);
  }

  return result;
}

export function clearSession(threadId: string): boolean {
  return sessions.delete(threadId);
}
