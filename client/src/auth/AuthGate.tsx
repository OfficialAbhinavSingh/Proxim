import { useEffect, useState } from "react";
import { Login } from "./Login";
import { fetchMe, logout } from "./api";

type Status = "checking" | "authenticated" | "anonymous";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((res) => {
      if (cancelled) return;
      if (res.authenticated) {
        setUsername(res.username ?? null);
        setStatus("authenticated");
      } else {
        setStatus("anonymous");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "checking") {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center">
        <p className="text-muted text-sm">Checking session…</p>
      </div>
    );
  }

  if (status === "anonymous") {
    return (
      <Login
        onSuccess={(name) => {
          setUsername(name);
          setStatus("authenticated");
        }}
      />
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          void logout().then(() => {
            setStatus("anonymous");
            setUsername(null);
          });
        }}
        className="btn fixed left-3 top-3 z-50 px-3 py-1.5 text-xs"
        title={username ? `Signed in as ${username}` : undefined}
      >
        Sign out
      </button>
      {children}
    </div>
  );
}
