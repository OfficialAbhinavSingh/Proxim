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
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      res.status(501).json({
        text: "",
        error: "Whisper fallback not configured (set OPENAI_API_KEY on the server).",
      });
      return;
    }
    const form = new FormData();
    const bytes = new Uint8Array(file.buffer);
    const blob = new Blob([bytes], { type: file.mimetype || "audio/webm" });
    form.append("file", blob, file.originalname || "clip.webm");
    form.append("model", "whisper-1");

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!r.ok) {
      const t = await r.text();
      res.status(502).json({ text: "", error: t });
      return;
    }
    const data = (await r.json()) as { text?: string };
    res.json({ text: data.text ?? "" });
  } catch (e) {
    res.status(500).json({ text: "", error: e instanceof Error ? e.message : "transcribe failed" });
  }
});
