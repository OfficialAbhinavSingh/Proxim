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
              <div className="flex-1 min-w-0">
                <p className="font-display text-lg font-semibold text-fg truncate">{p.name}</p>
                <p className="mt-1 text-sm" style={{ color: "rgb(var(--c-accent2))" }}>
                  {p.specialty}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
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
                {p.complianceMode ? (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      padding: "2px 5px",
                      borderRadius: 3,
                      background: "rgba(34,197,94,0.13)",
                      color: "#22c55e",
                      border: "1px solid rgba(34,197,94,0.28)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    MLR-Safe
                  </span>
                ) : null}
              </div>
            </div>
            <p className="mt-2 line-clamp-1 text-xs text-muted">{p.hospital}</p>
            <p className="mt-1 line-clamp-2 text-xs italic text-muted/80">{p.personality}</p>
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-subtle">
              {p.gender ? <>Gender: {p.gender} · </> : null}
              Mood: {p.mood}
            </p>
          </button>
        );
      })}
    </div>
  );
}

