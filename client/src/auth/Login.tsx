import { useCallback, useState } from "react";
import { login } from "./api";

interface LoginProps {
  onSuccess: (username: string) => void;
}

export function Login({ onSuccess }: LoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setSubmitting(true);
      try {
        await login(username.trim(), password);
        onSuccess(username.trim());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Login failed");
      } finally {
        setSubmitting(false);
      }
    },
    [username, password, onSuccess]
  );

  return (
    <div className="app-shell flex min-h-screen items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="panel-strong w-full max-w-sm p-6">
        <p className="kicker mb-1">Proxim</p>
        <h1 className="mb-6 text-lg font-semibold text-fg">Sign in to start a practice call</h1>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-muted">Username</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-[rgb(var(--c-accent)/0.45)]"
          />
        </label>

        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-muted">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-[rgb(var(--c-accent)/0.45)]"
          />
        </label>

        {error && (
          <p className="mb-4 text-sm" style={{ color: "rgb(var(--c-danger))" }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting} className="btn btn-primary w-full justify-center">
          {submitting ? "Signing in…" : "Sign in"}
        </button>

        <p className="mt-4 text-xs text-muted">
          Demo access: ask the person who shared this link for the current username/password.
        </p>
      </form>
    </div>
  );
}
