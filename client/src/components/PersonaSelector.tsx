import type { Persona } from "../types";

interface PersonaSelectorProps {
  personas: Persona[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

export function PersonaSelector({ personas, selectedId, onSelect, disabled }: PersonaSelectorProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {personas.map((p) => {
        const active = p.id === selectedId;
        return (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(p.id)}
            className={[
              "rounded-2xl border p-4 text-left transition",
              active
                ? "border-proxim-accent bg-proxim-800/80 shadow-lg shadow-blue-500/10 ring-1 ring-proxim-accent/40"
                : "border-white/10 bg-proxim-900/40 hover:border-white/20 hover:bg-proxim-800/50",
              disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
            ].join(" ")}
          >
            <p className="font-display text-lg font-semibold text-white">{p.name}</p>
            <p className="mt-1 text-sm text-sky-200/90">{p.specialty}</p>
            <p className="mt-2 line-clamp-2 text-xs text-slate-400">{p.hospital}</p>
            <p className="mt-2 line-clamp-2 text-xs italic text-slate-500">{p.personality}</p>
            <p className="mt-2 text-[10px] uppercase tracking-wide text-slate-600">Mood: {p.mood}</p>
          </button>
        );
      })}
    </div>
  );
}
