import { Router } from "express";
import multer from "multer";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const avatarProxyRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/**
 * Upload a local avatar GLB so the client can load it from localhost even when external CDNs are blocked.
 *
 * POST /assets/upload-avatar (multipart/form-data, field name: `file`)
 * -> { url: "/avatars/uploaded-avatar.glb" }
 */
avatarProxyRouter.post("/upload-avatar", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file?.buffer?.length) {
      res.status(400).json({ error: "missing file" });
      return;
    }
    const extOk = (file.originalname || "").toLowerCase().endsWith(".glb") || file.mimetype === "model/gltf-binary";
    if (!extOk) {
      res.status(400).json({ error: "please upload a .glb file" });
      return;
    }

    // Write into the Vite public folder so the client can fetch it directly.
    // Repo layout: server/src/routes -> ../../.. -> repo root -> client/public/avatars
    const publicDir = join(process.cwd(), "..", "client", "public", "avatars");
    mkdirSync(publicDir, { recursive: true });
    const filename = "uploaded-avatar.glb";
    const targetPath = join(publicDir, filename);
    writeFileSync(targetPath, file.buffer);

    res.json({ url: `/avatars/${filename}` });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "upload failed" });
  }
});

/**
 * Proxies Ready Player Me GLB downloads through our server.
 *
 * Why: some networks block the browser from fetching `https://models.readyplayer.me/...`
 * which makes the avatar appear "missing". Fetching server-side avoids those browser
 * restrictions and keeps the client on same-origin `localhost:3001`.
 *
 * Usage:
 *   GET /assets/rpm/<avatarId>.glb?<original query params>
 */
avatarProxyRouter.get("/rpm/:id.glb", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!/^[a-zA-Z0-9]+$/.test(id)) {
      res.status(400).send("invalid avatar id");
      return;
    }

    // Forward all query params to RPM.
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (v == null) continue;
      if (Array.isArray(v)) {
        for (const one of v) qs.append(k, String(one));
      } else {
        qs.append(k, String(v));
      }
    }
    const url = `https://models.readyplayer.me/${id}.glb${qs.toString() ? `?${qs.toString()}` : ""}`;

    const upstream = await fetch(url, {
      // RPM responds with glb bytes; explicitly accept binary.
      headers: { Accept: "model/gltf-binary,application/octet-stream,*/*" },
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      res.status(upstream.status).send(text || `RPM proxy failed: ${upstream.status}`);
      return;
    }

    // Content type: GLB.
    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") ?? "model/gltf-binary"
    );
    // Allow the client to cache for a while.
    res.setHeader("Cache-Control", "public, max-age=3600");

    // Stream body if available (runtime may expose web streams or node streams).
    const body = upstream.body as unknown;
    if (body && typeof (body as any).pipe === "function") {
      // Node stream
      (body as any).pipe(res);
      return;
    }
    if (body && typeof (body as any).getReader === "function") {
      const reader = (body as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) res.write(Buffer.from(value));
      }
      res.end();
      return;
    }

    // Fallback: buffer.
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch (e) {
    res.status(502).send(e instanceof Error ? e.message : "RPM proxy failed");
  }
});

