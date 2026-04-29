interface VoiceInputProps {
  partialTranscript: string;
  listening: boolean;
  mode: string;
  onTapToSpeak: () => void;
  tapBusy?: boolean;
}

export function VoiceInput({
  partialTranscript,
  listening,
  mode,
  onTapToSpeak,
  tapBusy,
}: VoiceInputProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-proxim-900/50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={[
            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium",
            listening ? "bg-emerald-500/20 text-emerald-200" : "bg-slate-700/50 text-slate-300",
          ].join(" ")}
        >
          <span
            className={[
              "h-2 w-2 rounded-full",
              listening ? "animate-pulse bg-emerald-400" : "bg-slate-500",
            ].join(" ")}
          />
          {listening ? "Listening" : "Mic idle"}
        </span>
        <span className="text-[11px] uppercase tracking-wide text-slate-500">
          Mode: {mode === "webspeech" ? "Web Speech API" : mode === "mediarecorder" ? "MediaRecorder" : mode}
        </span>
        <button
          type="button"
          onClick={onTapToSpeak}
          disabled={!!tapBusy}
          className="ml-auto rounded-xl border border-white/15 bg-proxim-800 px-4 py-2 text-sm font-medium text-white hover:bg-proxim-700 disabled:opacity-50 md:hidden"
        >
          Tap to speak
        </button>
      </div>
      <p className="mt-3 min-h-[3rem] text-sm leading-relaxed text-slate-200">
        {partialTranscript ? (
          <span className="italic text-sky-100/90">&ldquo;{partialTranscript}&rdquo;</span>
        ) : (
          <span className="text-slate-500">Live transcript appears here after you speak…</span>
        )}
      </p>
    </div>
  );
}
