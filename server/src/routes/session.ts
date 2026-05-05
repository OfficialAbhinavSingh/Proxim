import { Router } from "express";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

export const sessionRouter = Router();

/** Optional REST mirror for future clients; primary path is WebSocket. */
sessionRouter.post("/message", (_req, res) => {
  res.status(501).json({ error: "Use WebSocket user_input messages for the live pipeline." });
});

/**
 * MediaRecorder fallback: transcribe short webm clip.
 * Uses OpenAI Whisper when OPENAI_API_KEY is set; otherwise returns 501.
 */
sessionRouter.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    const file = req.file;
    if (!file?.buffer?.length) {
      res.status(400).json({ error: "missing audio" });
      return;
    }
    const openaiKey = process.env.OPENAI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    
    if (!openaiKey && !groqKey) {
      res.status(501).json({
        text: "",
        error: "Whisper fallback not configured (set GROQ_API_KEY or OPENAI_API_KEY).",
      });
      return;
    }

    const form = new FormData();
    const bytes = new Uint8Array(file.buffer);
    const blob = new Blob([bytes], { type: file.mimetype || "audio/webm" });
    form.append("file", blob, file.originalname || "clip.webm");
    
    let url: string;
    let authKey: string;
    
    if (groqKey) {
      url = "https://api.groq.com/openai/v1/audio/transcriptions";
      authKey = groqKey;
      form.append("model", "whisper-large-v3");
    } else {
      url = "https://api.openai.com/v1/audio/transcriptions";
      authKey = openaiKey!;
      form.append("model", "whisper-1");
    }

    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${authKey}` },
      body: form,
    });
    if (!r.ok) {
      const t = await r.text();
      res.status(502).json({ text: "", error: t });
      return;
    }
    const data = (await r.json()) as { text?: string };
    let text = (data.text ?? "").trim();
    console.log(`[Whisper] Raw transcript: "${text}"`);
    
    // Filter out common Whisper silence hallucinations
    const lower = text.toLowerCase();
    if (lower === "you" || lower === "you." || lower === "thank you." || lower === "thank you") {
      text = "";
    }
    
    console.log(`[Whisper] Filtered transcript: "${text}"`);
    res.json({ text });
  } catch (e) {
    res.status(500).json({ text: "", error: e instanceof Error ? e.message : "transcribe failed" });
  }
});
