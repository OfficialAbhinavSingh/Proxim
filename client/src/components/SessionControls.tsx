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
      <div className="rounded-xl border border-white/10 bg-proxim-900/60 px-4 py-2 font-mono text-sm text-slate-200">
        Session {active ? formatTime(elapsedSec) : "—:—"}
      </div>
      {!active ? (
        <button
          type="button"
          disabled={!canStart}
          onClick={onStart}
          className="rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-900/30 hover:from-blue-400 hover:to-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Start session
        </button>
      ) : (
        <button
          type="button"
          onClick={onEnd}
          className="rounded-xl border border-rose-400/40 bg-rose-500/15 px-6 py-2.5 text-sm font-semibold text-rose-100 hover:bg-rose-500/25"
        >
          End session
        </button>
      )}
    </div>
  );
}
