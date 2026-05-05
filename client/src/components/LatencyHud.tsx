import { useSessionStore } from "../store/sessionStore";

export function LatencyHud() {
  const latency = useSessionStore((s) => s.latency);

  if (latency.llmMs == null && latency.audioMs == null && !latency.active) return null;

  return (
    <div
      className="pointer-events-none absolute left-3 top-3 z-10 rounded-md border border-border px-2 py-1.5 text-[10px] font-mono tabular-nums"
      style={{
        background: "rgb(var(--c-surface) / 0.88)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="text-muted">Round-trip (this turn)</div>
      <div className="text-fg">
        LLM first text:{" "}
        <span style={{ color: "rgb(var(--c-accent2))" }}>{latency.llmMs != null ? `${latency.llmMs} ms` : "—"}</span>
      </div>
      <div className="text-fg">
        First TTS chunk:{" "}
        <span style={{ color: "rgb(var(--c-accent))" }}>{latency.audioMs != null ? `${latency.audioMs} ms` : "—"}</span>
      </div>
    </div>
  );
}
