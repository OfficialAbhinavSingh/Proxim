/**
 * Resolves an avatar URL from the persona config.
 *
 * - Full HTTPS/HTTP URLs (Ready Player Me CDN or custom host) are returned as-is.
 *   The morphTargets query param is appended if missing so Oculus visemes are available.
 * - Local /avatars/*.glb paths fall back to VITE_DEFAULT_AVATAR_GLB or the bundled RPM demo.
 * - VITE_DEFAULT_AVATAR_GLB env var lets you swap in any GLB at build time.
 */
const DEMO_RPM =
  import.meta.env.VITE_DEFAULT_AVATAR_GLB ?? "/avatars/dr_chen.glb";

const VISEME_QUERY = "morphTargets=ARKit,Oculus%20Visemes";

function ensureVisemeQuery(url: string): string {
  if (url.includes("morphTargets")) return url;
  return url.includes("?") ? `${url}&${VISEME_QUERY}` : `${url}?${VISEME_QUERY}`;
}

export function resolveAvatarUrl(avatarUrl: string): string {
  if (!avatarUrl) return DEMO_RPM;
  if (avatarUrl.startsWith("http://") || avatarUrl.startsWith("https://")) {
    return ensureVisemeQuery(avatarUrl);
  }
  // Local asset path (e.g. /avatars/*.glb). Use as-is so we don't depend on external CDNs.
  if (avatarUrl.startsWith("/")) return avatarUrl;
  return avatarUrl;
}
