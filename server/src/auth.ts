import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";

const SESSION_COOKIE = "proxim_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// Falls back to a random secret so a missing SESSION_SECRET never silently
// accepts forged tokens signed with a known/default key. The tradeoff:
// sessions don't survive a server restart without SESSION_SECRET set.
const SESSION_SECRET = process.env.SESSION_SECRET ?? crypto.randomBytes(32).toString("hex");

export interface Session {
  username: string;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

export function createSessionToken(username: string): string {
  const payload = Buffer.from(JSON.stringify({ u: username, t: Date.now() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = sign(payload);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      u: string;
      t: number;
    };
    if (Date.now() - data.t > SESSION_TTL_MS) return null;
    return { username: data.u };
  } catch {
    return null;
  }
}

export function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Compare against itself so a length mismatch doesn't short-circuit faster
    // than a real comparison (coarse timing-attack mitigation).
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export const AUTH_COOKIE_NAME = SESSION_COOKIE;
export const AUTH_COOKIE_MAX_AGE_MS = SESSION_TTL_MS;
