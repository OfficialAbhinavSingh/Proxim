/**
 * Resolves an avatar URL from the persona config.
 *
 * - Full HTTPS/HTTP URLs are returned as-is.
 *   For Ready Player Me URLs only, the morphTargets query param is appended if missing so Oculus visemes are available.
 * - Local /avatars/*.glb paths fall back to VITE_DEFAULT_AVATAR_GLB or the bundled RPM demo.
 * - VITE_DEFAULT_AVATAR_GLB env var lets you swap in any GLB at build time.
 */
// Public RPM sample avatar (docs) — guaranteed to exist and can be requested with morphTargets.
// If you have your own RPM avatar, set `VITE_DEFAULT_AVATAR_GLB` to it.
const DEMO_RPM =
  import.meta.env.VITE_DEFAULT_AVATAR_GLB ??
  "https://models.readyplayer.me/6185a4acfb622cf1cdc49348.glb";

const VISEME_QUERY = "morphTargets=ARKit,Oculus%20Visemes";
// Maximum-compatibility settings: disable optional mesh compression that requires extra decoders.
// (RPM may enable meshopt when requesting morph targets; forcing false avoids loader issues.)
const RPM_COMPAT_QUERY = "useMeshOptCompression=false&useDracoMeshCompression=false";

function ensureRpmQuery(url: string): string {
  const hasVisemes = url.includes("morphTargets=");
  const hasCompat =
    /(?:^|[?&])useMeshOptCompression=/i.test(url) || /(?:^|[?&])useDracoMeshCompression=/i.test(url);

  const parts: string[] = [];
  if (!hasVisemes) parts.push(VISEME_QUERY);
  if (!hasCompat) parts.push(RPM_COMPAT_QUERY);
  if (!parts.length) return url;
  return url.includes("?") ? `${url}&${parts.join("&")}` : `${url}?${parts.join("&")}`;
}

function toLocalRpmProxy(url: string): string {
  // If you deploy the server elsewhere, set VITE_HTTP_SERVER_URL accordingly.
  const serverBase = (import.meta.env.VITE_HTTP_SERVER_URL as string | undefined) ?? "http://localhost:3001";
  try {
    const u = new URL(url);
    const m = /^\/([a-zA-Z0-9]+)\.glb$/.exec(u.pathname);
    if (!m) return url;
    const id = m[1];
    // Preserve query string (already includes morphTargets + compat params).
    return `${serverBase.replace(/\/+$/, "")}/assets/rpm/${id}.glb${u.search}`;
  } catch {
    return url;
  }
}

export function resolveAvatarUrl(avatarUrl: string): string {
  // Allow local override (uploaded avatar) without rebuilding.
  try {
    const override = window.localStorage.getItem("proxim.avatarOverrideUrl");
    if (override && override.trim()) return override.trim();
  } catch {
    // ignore
  }
  if (!avatarUrl) return DEMO_RPM;
  if (avatarUrl.startsWith("http://") || avatarUrl.startsWith("https://")) {
    // Only Ready Player Me supports this parameter. Appending it to other hosts can break downloads.
    if (/^https?:\/\/models\.readyplayer\.me\//i.test(avatarUrl)) {
      // Route through our server proxy so browser network/CORS blockers don't kill avatar loading.
      return toLocalRpmProxy(ensureRpmQuery(avatarUrl));
    }
    return avatarUrl;
  }
  // Local asset path (e.g. /avatars/*.glb). Use as-is so we don't depend on external CDNs.
  if (avatarUrl.startsWith("/")) return avatarUrl;
  return avatarUrl;
}
