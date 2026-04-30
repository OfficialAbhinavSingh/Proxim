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
    <div className="panel p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={[
            "chip",
            listening ? "text-fg" : "text-muted",
          ].join(" ")}
          style={listening ? { background: "rgb(var(--c-success) / 0.14)", borderColor: "rgb(var(--c-success) / 0.35)" } : undefined}
        >
          <span
            className={[
              "h-2 w-2 rounded-full",
              listening ? "animate-pulse" : "",
            ].join(" ")}
            style={{
              background: listening ? "rgb(var(--c-success))" : "rgb(var(--c-subtle))",
            }}
          />
          {listening ? "Listening" : "Mic idle"}
        </span>
        <span className="kicker">
          Mode: {mode === "webspeech" ? "Web Speech API" : mode === "mediarecorder" ? "MediaRecorder" : mode}
        </span>
        <button
          type="button"
          onClick={onTapToSpeak}
          disabled={!!tapBusy}
          className="btn ml-auto px-4 py-2 text-sm md:hidden"
        >
          Tap to speak
        </button>
      </div>
      <p className="mt-3 min-h-[3rem] text-sm leading-relaxed text-fg">
        {partialTranscript ? (
          <span className="italic" style={{ color: "rgb(var(--c-accent2))" }}>
            &ldquo;{partialTranscript}&rdquo;
          </span>
        ) : (
          <span className="text-muted">Live transcript appears here after you speak…</span>
        )}
      </p>
    </div>
  );
}
