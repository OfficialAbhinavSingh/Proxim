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
                ? "border-accent/60 bg-surface2/85"
                : "border-border bg-surface/70 hover:bg-surface2/70",
              disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-lg font-semibold text-fg">{p.name}</p>
                <p className="mt-1 text-sm" style={{ color: "rgb(var(--c-accent2))" }}>
                  {p.specialty}
                </p>
              </div>
              {active ? (
                <span
                  className="chip"
                  style={{
                    borderColor: "transparent",
                    background: "rgb(var(--c-accent) / 0.14)",
                    color: "rgb(var(--c-accent))",
                  }}
                >
                  Selected
                </span>
              ) : null}
            </div>
            <p className="mt-2 line-clamp-2 text-xs text-muted">{p.hospital}</p>
            <p className="mt-2 line-clamp-2 text-xs italic text-muted/80">{p.personality}</p>
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-subtle">
              Mood: {p.mood}
            </p>
          </button>
        );
      })}
    </div>
  );
}
