interface SessionControlsProps {
  active: boolean;
  elapsedSec: number;
  canStart: boolean;
  onStart: () => void;
  onEnd: () => void;
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function SessionControls({ active, elapsedSec, canStart, onStart, onEnd }: SessionControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="rounded-xl border border-border bg-surface2/70 px-4 py-2 font-mono text-sm text-fg">
        Session {active ? formatTime(elapsedSec) : "—:—"}
      </div>
      {!active ? (
        <button
          type="button"
          disabled={!canStart}
          onClick={onStart}
          className="btn-primary px-6 py-2.5 text-sm"
        >
          Start session
        </button>
      ) : (
        <button
          type="button"
          onClick={onEnd}
          className="btn-danger px-6 py-2.5 text-sm"
        >
          End session
        </button>
      )}
    </div>
  );
}
