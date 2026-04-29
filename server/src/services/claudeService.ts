import Anthropic from "@anthropic-ai/sdk";
import Groq from "groq-sdk";
import type { Emotion, Message, Persona } from "../types/index.js";

/**
 * LLM provider selection:
 *  - If GROQ_API_KEY is set → use Groq (free tier, Llama 3.3 70B, very fast)
 *  - Else if ANTHROPIC_API_KEY is set → use Anthropic Claude Sonnet
 *  - Otherwise → yield the "no key" fallback message
 *
 * Set GROQ_API_KEY in server/.env to use Groq for free:
 *   https://console.groq.com/keys
 */

const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const GROQ_MODEL = "llama-3.3-70b-versatile";

function buildSystemPrompt(persona: Persona): string {
  return `You are ${persona.name}, a ${persona.specialty} at ${persona.hospital}.
Personality: ${persona.personality}
Current mood: ${persona.mood}

You are in a meeting with a pharmaceutical sales representative. Respond naturally as this HCP would — be realistic, sometimes skeptical, sometimes curious. Keep responses to 2–4 sentences unless asked something complex.

IMPORTANT: Begin every response with an emotion tag on its own line in this exact format:
[EMOTION:neutral] or [EMOTION:engaged] or [EMOTION:skeptical] or [EMOTION:positive]
Then your response text on the next line. The frontend strips this tag before displaying.`;
}

const EMOTION_RE = /^\[EMOTION:(neutral|engaged|skeptical|positive)\]\s*\n?/i;

export function stripEmotionTag(raw: string): { emotion: Emotion; displayText: string } {
  const m = raw.match(EMOTION_RE);
  if (!m) return { emotion: "neutral", displayText: raw.trim() };
  const emotion = m[1].toLowerCase() as Emotion;
  const displayText = raw.replace(EMOTION_RE, "").trim();
  return { emotion, displayText };
}

// ── Groq streaming ────────────────────────────────────────────────────────────

async function* streamGroqResponse(
  apiKey: string,
  persona: Persona,
  history: Message[]
): AsyncGenerator<{ textDelta: string }> {
  const client = new Groq({ apiKey });
  const system = `${buildSystemPrompt(persona)}\n\nAdditional persona notes:\n${persona.systemPrompt}`;

  const messages = [
    { role: "system" as const, content: system },
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const stream = await client.chat.completions.create({
    model: GROQ_MODEL,
    messages,
    max_tokens: 1024,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield { textDelta: delta };
  }
}

// ── Anthropic streaming ───────────────────────────────────────────────────────

async function* streamAnthropicResponse(
  apiKey: string,
  persona: Persona,
  history: Message[]
): AsyncGenerator<{ textDelta: string }> {
  const client = new Anthropic({ apiKey });
  const system = `${buildSystemPrompt(persona)}\n\nAdditional persona notes:\n${persona.systemPrompt}`;

  const anthropicMessages = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const stream = await client.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system,
    messages: anthropicMessages,
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield { textDelta: event.delta.text };
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function* streamClaudeResponse(
  apiKey: string | undefined,
  persona: Persona,
  history: Message[]
): AsyncGenerator<{ textDelta: string }> {
  const groqKey = process.env.GROQ_API_KEY;

  // Prefer Groq (free) if its key is set
  if (groqKey) {
    console.log("[LLM] Using Groq (llama-3.3-70b-versatile)");
    yield* streamGroqResponse(groqKey, persona, history);
    return;
  }

  // Fall back to Anthropic
  if (apiKey) {
    console.log("[LLM] Using Anthropic Claude Sonnet");
    yield* streamAnthropicResponse(apiKey, persona, history);
    return;
  }

  // No key configured
  yield {
    textDelta:
      "[EMOTION:neutral]\nI'm having trouble reaching my reasoning service right now. Please set GROQ_API_KEY or ANTHROPIC_API_KEY in server/.env",
  };
}
