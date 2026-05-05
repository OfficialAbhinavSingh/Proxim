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
          Mode:{" "}
          {mode === "webspeech"
            ? "Web Speech API"
            : mode === "vad_whisper"
              ? "VAD + Whisper (fast phrase end)"
              : mode === "server_stt"
                ? "Server Whisper (silence splits)"
                : mode}
        </span>
        <button
          type="button"
          onClick={onTapToSpeak}
          disabled={!!tapBusy || mode === "webspeech"}
          title={
            mode === "webspeech"
              ? "Hands-free: pause ~0.5s after speaking to send"
              : mode === "vad_whisper"
                ? "Flush current speech segment to Whisper immediately"
                : undefined
          }
          className="btn ml-auto px-4 py-2 text-sm"
        >
          {listening && (mode === "server_stt" || mode === "vad_whisper") ? "Send now" : "Tap to speak"}
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
