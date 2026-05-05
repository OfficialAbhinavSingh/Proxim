import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

type Next = () => void;

const __dirname = dirname(fileURLToPath(import.meta.url));

function readInstalledOrtVersion(): string {
  const candidates = [
    join(__dirname, "node_modules", "onnxruntime-web", "package.json"),
    join(__dirname, "node_modules", "@ricky0123", "vad-web", "node_modules", "onnxruntime-web", "package.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const v = JSON.parse(readFileSync(p, "utf8")) as { version?: string };
      if (v.version) return v.version;
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "[proxim] Could not read onnxruntime-web version. Run `npm install` in the client folder (onnxruntime-web is a direct dependency)."
  );
}

const ortWasmVersion = readInstalledOrtVersion();

/**
 * Ready Player Me GLB proxy: browser loads same-origin `/__rpm/<id>.glb?...`,
 * Node fetches `https://models.readyplayer.me/<id>.glb?...`.
 */
function createRpmProxyMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const raw = req.url ?? "";
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!raw.startsWith("/__rpm/") || !raw.includes(".glb")) return next();

    const pathAndQuery = raw.replace(/^\/__rpm/, "");
    const upstream = `https://models.readyplayer.me${pathAndQuery}`;

    void fetch(upstream, {
      method: req.method,
      headers: { Accept: "model/gltf-binary,application/octet-stream,*/*" },
    })
      .then(async (r) => {
        res.statusCode = r.status;
        const ct = r.headers.get("content-type");
        if (ct) res.setHeader("Content-Type", ct);
        const cc = r.headers.get("cache-control");
        if (cc) res.setHeader("Cache-Control", cc);
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(t || `upstream ${r.status}`);
          return;
        }
        const buf = Buffer.from(await r.arrayBuffer());
        res.end(buf);
      })
      .catch((e: unknown) => {
        res.statusCode = 502;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(e instanceof Error ? e.message : "RPM proxy failed");
      });
  };
}

function rpmProxyVitePlugin(): Plugin {
  const handle = createRpmProxyMiddleware();
  const prepend = (server: { middlewares: { use: (fn: unknown) => void; stack?: unknown[] } }) => {
    const stack = server.middlewares.stack;
    if (Array.isArray(stack)) {
      stack.unshift({ route: "", handle } as never);
    } else {
      server.middlewares.use(handle);
    }
  };

  return {
    name: "proxim-rpm-proxy",
    configureServer(server) {
      return () => prepend(server);
    },
    configurePreviewServer(server) {
      return () => prepend(server);
    },
  };
}

export default defineConfig({
  define: {
    "import.meta.env.VITE_ORT_WASM_VERSION": JSON.stringify(ortWasmVersion),
  },
  plugins: [rpmProxyVitePlugin(), react()],
  optimizeDeps: {
    include: ["@ricky0123/vad-web"],
    exclude: ["onnxruntime-web"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  preview: {
    port: 4173,
  },
});
