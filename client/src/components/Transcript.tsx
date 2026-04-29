import type { Message } from "../types";

interface TranscriptProps {
  open: boolean;
  onToggle: () => void;
  messages: Message[];
  streamingAssistant: string;
}

export function Transcript({ open, onToggle, messages, streamingAssistant }: TranscriptProps) {
  return (
    <aside
      className={[
        "flex flex-col border-white/10 bg-proxim-950/80 transition-[width] duration-200",
        open ? "w-full border-t md:w-80 md:border-l md:border-t-0" : "w-0 overflow-hidden border-0",
      ].join(" ")}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Transcript
        </span>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-lg px-2 py-1 text-xs text-slate-300 hover:bg-white/5"
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {messages.map((m, i) => (
          <div
            key={`${m.timestamp}-${i}`}
            className={m.role === "user" ? "text-right" : "text-left"}
          >
            <div
              className={[
                "inline-block max-w-[95%] rounded-2xl px-3 py-2",
                m.role === "user"
                  ? "bg-proxim-accent/25 text-slate-100"
                  : "bg-proxim-800 text-slate-100 ring-1 ring-white/10",
              ].join(" ")}
            >
              <p className="text-[10px] uppercase tracking-wide text-slate-500">
                {m.role === "user" ? "You" : m.emotion ? `HCP · ${m.emotion}` : "HCP"}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{m.content}</p>
            </div>
          </div>
        ))}
        {streamingAssistant ? (
          <div className="text-left">
            <div className="inline-block max-w-[95%] rounded-2xl bg-proxim-800/70 px-3 py-2 italic text-slate-200 ring-1 ring-dashed ring-white/15">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">HCP · typing</p>
              <p className="mt-1 whitespace-pre-wrap">{streamingAssistant}</p>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
