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
  const complianceClause = persona.complianceMode
    ? `\n\nCOMPLIANCE GUARDRAIL: If the sales representative makes any off-label claim, cites unapproved data, or promotes a product outside its approved indication, respond with appropriate physician skepticism (e.g., "I'm not aware of that being an approved use — can you share the label details?"). Note the compliance concern naturally in your response.`
    : "";

  return `You are ${persona.name}, a ${persona.specialty} at ${persona.hospital}.
Personality: ${persona.personality}
Current mood: ${persona.mood}

You are in a meeting with a pharmaceutical sales representative. Respond naturally as this HCP would — be realistic, sometimes skeptical, sometimes curious. Keep responses to 2–4 sentences unless asked something complex.

IMPORTANT: Begin every response with an emotion tag on its own line in this exact format:
[EMOTION:neutral] or [EMOTION:engaged] or [EMOTION:skeptical] or [EMOTION:positive]
Then your response text on the next line. The frontend strips this tag before displaying.${complianceClause}`;
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

// ── Scorecard evaluation ──────────────────────────────────────────────────────

import type { ScoreCard } from "../types/index.js";

const SCORECARD_PROMPT = `You are an expert pharmaceutical sales trainer evaluating a practice call transcript.
Analyze the SALES REP turns only and return a JSON object (no markdown, no extra text) with this exact shape:
{
  "score": <integer 0-100>,
  "readiness": <one of: "Field Ready" | "Almost Ready" | "Needs Practice" | "Not Ready">,
  "items": [
    { "label": "<criterion>", "status": <"pass" | "warn" | "fail"> }
  ],
  "summary": "<one coaching sentence>"
}

Always include exactly these 5 criteria in items (evaluate each from the rep's dialogue):
1. Clinical data cited
2. Objections handled
3. Side effect profile addressed
4. Dosing / administration covered
5. Compliant messaging (no off-label claims)

Score reflects overall call quality. Readiness: 80-100=Field Ready, 60-79=Almost Ready, 40-59=Needs Practice, <40=Not Ready.`;

/**
 * Evaluates a completed conversation and returns a structured score card.
 * Uses Groq (free) as primary, falls back to Anthropic.
 * Returns null if no LLM key is configured — caller must handle gracefully.
 */
export async function generateScoreCard(
  messages: import("../types/index.js").Message[]
): Promise<ScoreCard | null> {
  const groqKey = process.env.GROQ_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  // Build a readable transcript of only the conversation (no system)
  const transcript = messages
    .map((m) => `${m.role === "user" ? "REP" : "HCP"}: ${m.content}`)
    .join("\n");

  if (!transcript.trim() || messages.filter((m) => m.role === "user").length === 0) {
    return null; // Not enough conversation to score
  }

  const userContent = `Here is the call transcript:\n\n${transcript}\n\nReturn only the JSON object.`;

  try {
    let rawJson = "";

    if (groqKey) {
      const client = new Groq({ apiKey: groqKey });
      const res = await client.chat.completions.create({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: SCORECARD_PROMPT },
          { role: "user", content: userContent },
        ],
        max_tokens: 512,
        stream: false,
      });
      rawJson = res.choices[0]?.message?.content ?? "";
    } else if (anthropicKey) {
      const client = new Anthropic({ apiKey: anthropicKey });
      const res = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 512,
        system: SCORECARD_PROMPT,
        messages: [{ role: "user", content: userContent }],
      });
      const block = res.content[0];
      rawJson = block.type === "text" ? block.text : "";
    } else {
      return null; // No LLM configured
    }

    // Strip possible markdown fences
    const cleaned = rawJson.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned) as ScoreCard;

    // Basic validation
    if (
      typeof parsed.score !== "number" ||
      !parsed.readiness ||
      !Array.isArray(parsed.items) ||
      !parsed.summary
    ) {
      console.warn("[ScoreCard] LLM returned unexpected shape:", cleaned);
      return null;
    }

    return parsed;
  } catch (err) {
    console.warn("[ScoreCard] Evaluation failed (non-fatal):", err instanceof Error ? err.message : err);
    return null;
  }
}
