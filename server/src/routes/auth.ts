import { Router } from "express";
import {
  AUTH_COOKIE_MAX_AGE_MS,
  AUTH_COOKIE_NAME,
  createSessionToken,
  readCookie,
  timingSafeStringEqual,
  verifySessionToken,
} from "../auth.js";

export const authRouter = Router();

function expectedCredentials() {
  return {
    username: process.env.AUTH_USERNAME ?? "demo",
    password: process.env.AUTH_PASSWORD ?? "proxim-demo",
  };
}

authRouter.post("/login", (req, res) => {
  const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
  const expected = expectedCredentials();

  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    !timingSafeStringEqual(username, expected.username) ||
    !timingSafeStringEqual(password, expected.password)
  ) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const token = createSessionToken(username);
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
    path: "/",
  });
  res.json({ ok: true, username });
});

authRouter.get("/me", (req, res) => {
  const session = verifySessionToken(readCookie(req, AUTH_COOKIE_NAME));
  if (!session) {
    res.status(401).json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, username: session.username });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});
