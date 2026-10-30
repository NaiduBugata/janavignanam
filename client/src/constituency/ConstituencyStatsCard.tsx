import { Building2, Compass, Landmark, Star, Users, X } from "lucide-react";
import { getConstituency } from "./constituency-data";

export interface ContactFacet {
  name: string;
  count: number;
}

export interface ContactStats {
  totalContacts: number;
  mandalsCount: number;
  villagesCount: number;
  importantCount: number;
  withDesignationCount: number;
  parties: ContactFacet[];
}

interface ConstituencyStatsCardProps {
  selectedAssembly: string;
  selectedDivision: string;
  selectedMandal: string;
  stats?: ContactStats | null;
  totalAll: number;
  mandals?: ContactFacet[];
  onSelectAssembly: (assemblyName: string) => void;
  onSelectMandal: (mandalName: string) => void;
  onClearMandal: () => void;
  onClearSelection: () => void;
}

export function ConstituencyStatsCard({
  selectedAssembly,
  selectedDivision,
  selectedMandal,
  stats,
  totalAll,
  mandals = [],
  onSelectMandal,
  onClearMandal,
  onClearSelection,
}: ConstituencyStatsCardProps) {
  const constituency = getConstituency(selectedAssembly);

  const displayTotal = stats?.totalContacts ?? (selectedAssembly ? 0 : totalAll);
  const mandalsCount = stats?.mandalsCount ?? 0;
  const villagesCount = stats?.villagesCount ?? 0;
  const importantCount = stats?.importantCount ?? 0;
  const withDesignationCount = stats?.withDesignationCount ?? 0;

  return (
    <div className="flex flex-col justify-between rounded-2xl border bg-card p-5 shadow-sm transition-all">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-3 border-b pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-3 w-3 rounded-full ring-2 ring-background"
                style={{ backgroundColor: constituency?.color || "#1E3A8A" }}
              />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {selectedAssembly ? "Assembly Segment" : "District Overview"}
              </span>
              {constituency && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  AC #{constituency.acNo}
                </span>
              )}
            </div>

            <h3 className="mt-1 text-xl font-bold tracking-tight text-foreground">
              {selectedAssembly ? (
                <>
                  {selectedAssembly}
                  {constituency?.teluguName && (
                    <span className="ml-2 font-normal text-muted-foreground text-base">
                      ({constituency.teluguName})
                    </span>
                  )}
                </>
              ) : (
                "Palnadu / Narasaraopet PC"
              )}
            </h3>

            <p className="mt-0.5 text-xs text-muted-foreground">
              {selectedAssembly
                ? `Revenue Division: ${constituency?.division || selectedDivision || "Palnadu"}`
                : "7 Assembly Constituencies in Palnadu District"}
            </p>
          </div>

          {selectedAssembly && (
            <button
              type="button"
              onClick={onClearSelection}
              className="inline-flex items-center gap-1 rounded-lg border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Clear assembly selection to view all"
            >
              <X className="h-3.5 w-3.5" />
              Reset
            </button>
          )}
        </div>

        {/* 2x2 Metric Cards */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border bg-background/50 p-3.5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Users className="h-4 w-4 text-blue-600" />
              <span className="text-xs font-medium">Contacts</span>
            </div>
            <p className="mt-1 text-2xl font-bold tracking-tight text-foreground tabular-nums">
              {displayTotal.toLocaleString()}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {totalAll > 0
                ? `${((displayTotal / totalAll) * 100).toFixed(1)}% of total sheet`
                : "Database contacts"}
            </p>
          </div>

          <div className="rounded-xl border bg-background/50 p-3.5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Building2 className="h-4 w-4 text-emerald-600" />
              <span className="text-xs font-medium">Mandals</span>
            </div>
            <p className="mt-1 text-2xl font-bold tracking-tight text-foreground tabular-nums">
              {mandalsCount}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {selectedAssembly ? "Administrative mandals" : "Across district"}
            </p>
          </div>

          <div className="rounded-xl border bg-background/50 p-3.5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Landmark className="h-4 w-4 text-purple-600" />
              <span className="text-xs font-medium">Villages & Wards</span>
            </div>
            <p className="mt-1 text-2xl font-bold tracking-tight text-foreground tabular-nums">
              {villagesCount}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Habitations mapped</p>
          </div>

          <div className="rounded-xl border bg-background/50 p-3.5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Star className="h-4 w-4 text-amber-500 fill-amber-500/20" />
              <span className="text-xs font-medium">VIP / Key Contacts</span>
            </div>
            <p className="mt-1 text-2xl font-bold tracking-tight text-foreground tabular-nums">
              {importantCount}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {withDesignationCount} with designation
            </p>
          </div>
        </div>

        {/* Mandals Distribution */}
        {mandals.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Mandals in {selectedAssembly || "Selection"}
              </span>
              {selectedMandal && (
                <button
                  type="button"
                  onClick={onClearMandal}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Clear mandal filter
                </button>
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5 max-h-[140px] overflow-y-auto pr-1">
              {mandals.map((m) => {
                const isMandalActive = selectedMandal.toLowerCase() === m.name.toLowerCase();
                return (
                  <button
                    key={m.name}
                    type="button"
                    onClick={() =>
                      isMandalActive ? onClearMandal() : onSelectMandal(m.name)
                    }
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                      isMandalActive
                        ? "border-primary bg-primary text-primary-foreground font-medium"
                        : "border-border bg-background hover:bg-muted text-foreground"
                    }`}
                  >
                    <span>{m.name}</span>
                    <span
                      className={`rounded px-1 text-[10px] tabular-nums ${
                        isMandalActive
                          ? "bg-primary-foreground/20 text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {m.count.toLocaleString()}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer Info Callout */}
      <div className="mt-4 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Compass className="h-3.5 w-3.5 text-primary" />
          <span>Interactive Assembly Navigation</span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed">
          {selectedAssembly
            ? `Viewing filtered records for ${selectedAssembly}. Click another constituency on the map or use the reset button to return to the full district view.`
            : "Click any constituency region on the map to filter contacts, examine mandal distributions, and view local representatives."}
        </p>
      </div>
    </div>
  );
}
