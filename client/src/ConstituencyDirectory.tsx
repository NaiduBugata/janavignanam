import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api.ts";
import { ConstituencyMap } from "./constituency/ConstituencyMap";
import { ConstituencyStatsCard, type ContactStats } from "./constituency/ConstituencyStatsCard";
import { getConstituency } from "./constituency/constituency-data";
import { MapPin, Search, X } from "lucide-react";

type Contact = {
  name?: string;
  phone?: string;
  designation?: string;
  party?: string;
  important?: string;
  assembly?: string;
  mandal?: string;
  village?: string;
  division?: string;
  membershipId?: string;
  sources?: string;
  variants?: string;
  notes?: string;
};

type Facet = { name: string; count: number };

type Page = {
  total: number;
  page: number;
  pageSize: number;
  divisions: Facet[];
  assemblies: Facet[];
  mandals?: Facet[];
  roles: Facet[];
  stats?: ContactStats;
  rows: Contact[];
};

const ASSEMBLY_ORDER = [
  "Pedakurapadu",
  "Chilakaluripet",
  "Narasaraopet",
  "Sattenapalli",
  "Vinukonda",
  "Gurazala",
  "Macherla",
  "Unassigned",
];
const DIVISION_ORDER = [
  "Narasaraopet",
  "Sattenapalli",
  "Gurazala",
  "No division",
];

function marked(value: string | undefined): boolean {
  const text = (value || "").trim();
  return Boolean(text) && !/^(n|no|false|0)$/i.test(text);
}

export function ConstituencyDirectory({ token }: { token: string }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState("");
  const [assembly, setAssembly] = useState("");
  const [mandal, setMandal] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Debounce search query
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  // Fetch contacts with active filters
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      q: query,
      division,
      assembly,
      mandal,
      role,
      page: String(page),
    });
    api<Page>(`/api/workspace/contacts?${params.toString()}`, { token })
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setError("");
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Could not load contacts");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, query, division, assembly, mandal, role, page]);

  const divisions = useMemo(() => {
    const rows = data?.divisions || [];
    return [...rows].sort(
      (a, b) =>
        DIVISION_ORDER.indexOf(a.name) - DIVISION_ORDER.indexOf(b.name)
    );
  }, [data]);

  const assemblies = useMemo(() => {
    const rows = data?.assemblies || [];
    return [...rows].sort((a, b) => {
      const ai = ASSEMBLY_ORDER.indexOf(a.name);
      const bi = ASSEMBLY_ORDER.indexOf(b.name);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [data]);

  const assemblyCounts = useMemo(() => {
    const map: Record<string, number> = {};
    (data?.assemblies || []).forEach((item) => {
      map[item.name] = item.count;
    });
    return map;
  }, [data]);

  const totalAll = assemblies.reduce((sum, item) => sum + item.count, 0);
  const pages = Math.max(1, Math.ceil((data?.total || 0) / (data?.pageSize || 40)));
  const roleLabel = role === "__none__" ? "No designation" : role;

  const chooseDivision = (name: string) => {
    setDivision(name);
    setAssembly("");
    setMandal("");
    setPage(1);
  };

  const chooseAssembly = (name: string) => {
    setAssembly(name);
    setMandal("");
    setPage(1);
  };

  const chooseMandal = (name: string) => {
    setMandal(name);
    setPage(1);
  };

  const chooseRole = (value: string) => {
    setRole(value === "No designation" ? "__none__" : value);
    setPage(1);
  };

  const clearAllFilters = () => {
    setQ("");
    setQuery("");
    setDivision("");
    setAssembly("");
    setMandal("");
    setRole("");
    setPage(1);
  };

  const hasActiveFilters = Boolean(
    q || division || assembly || mandal || role
  );

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <MapPin className="h-4 w-4" />
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Constituency Directory
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground max-w-3xl leading-relaxed">
              Interactive spatial exploration of 27,528 verified contacts across the seven Assembly Constituencies in Palnadu / Narasaraopet Parliamentary Constituency. Click any region on the map or use the division, assembly, and mandal filters below to query local leaders and representatives.
            </p>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="inline-flex items-center gap-1.5 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Clear all filters
            </button>
          )}
        </div>
      </div>

      {/* Interactive Map & Statistics Summary Grid */}
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <ConstituencyMap
          selectedAssembly={assembly}
          selectedDivision={division}
          assemblyCounts={assemblyCounts}
          totalAll={totalAll}
          onSelectAssembly={chooseAssembly}
          onClearSelection={() => chooseAssembly("")}
        />

        <ConstituencyStatsCard
          selectedAssembly={assembly}
          selectedDivision={division}
          selectedMandal={mandal}
          stats={data?.stats}
          totalAll={totalAll}
          mandals={data?.mandals}
          onSelectAssembly={chooseAssembly}
          onSelectMandal={chooseMandal}
          onClearMandal={() => chooseMandal("")}
          onClearSelection={() => chooseAssembly("")}
        />
      </div>

      {/* Filter Controls Row */}
      <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
        {/* Division Filter Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-1">
            Divisions:
          </span>
          <button
            type="button"
            onClick={() => chooseDivision("")}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
              division === ""
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            All divisions
          </button>
          {divisions.map((item) => (
            <button
              key={item.name}
              type="button"
              onClick={() => chooseDivision(item.name)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                division === item.name
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {item.name} · {item.count.toLocaleString()}
            </button>
          ))}
        </div>

        {/* Assembly Filter Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-1">
            Assemblies:
          </span>
          <button
            type="button"
            onClick={() => chooseAssembly("")}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
              assembly === ""
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            All assemblies{totalAll ? ` · ${totalAll.toLocaleString()}` : ""}
          </button>
          {assemblies.map((item) => {
            const meta = getConstituency(item.name);
            return (
              <button
                key={item.name}
                type="button"
                onClick={() => chooseAssembly(item.name)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                  assembly === item.name
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {meta?.color && (
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-full ring-1 ring-border"
                    style={{ backgroundColor: meta.color }}
                  />
                )}
                <span>{item.name}</span>
                {meta && <span className="ml-1 text-[10px] opacity-75">({meta.acNo})</span>}
                <span className="ml-1.5 opacity-80">· {item.count.toLocaleString()}</span>
              </button>
            );
          })}
        </div>

        {/* Active Mandal Indicator Pill */}
        {mandal && (
          <div className="flex items-center gap-2 pt-1 border-t">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Active Mandal:
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-0.5 text-xs font-medium text-primary">
              <span>{mandal}</span>
              <button
                type="button"
                onClick={() => chooseMandal("")}
                className="hover:text-destructive"
                title="Remove mandal filter"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}

        {/* Search & Role Inputs */}
        <div className="grid gap-3 pt-2 md:grid-cols-[1fr_280px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search sheet: name, phone, role, party, assembly, mandal, village, notes..."
              className="h-10 w-full rounded-xl border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring transition-shadow"
            />
          </div>
          <input
            list="constituency-roles"
            value={roleLabel}
            onChange={(event) => chooseRole(event.target.value)}
            placeholder="All roles / designations"
            className="h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring transition-shadow"
          />
          <datalist id="constituency-roles">
            <option value="No designation" />
            {(data?.roles || [])
              .filter((item) => item.name !== "No designation")
              .map((item) => (
                <option
                  key={item.name}
                  value={item.name}
                >{`${item.name} (${item.count})`}</option>
              ))}
          </datalist>
        </div>
      </div>

      {/* Results Header with Counts and Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">
          {loading && !data ? (
            "Loading contacts…"
          ) : (
            <>
              <span className="tabular-nums font-bold text-foreground">
                {(data?.total || 0).toLocaleString()}
              </span>{" "}
              contacts
              {assembly ? ` in ${assembly}` : ""}
              {mandal ? ` · ${mandal} Mandal` : ""}
              {roleLabel ? ` · ${roleLabel}` : ""}
            </>
          )}
        </span>

        <span className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="rounded-lg border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40 transition-colors"
          >
            Previous
          </button>
          <span className="text-xs">
            Page {Math.min(page, pages)} of {pages}
          </span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => setPage((current) => current + 1)}
            className="rounded-lg border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40 transition-colors"
          >
            Next
          </button>
        </span>
      </div>

      {error && (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive border border-destructive/20">
          {error}
        </p>
      )}

      {/* Contacts Table */}
      {data && data.rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-12 text-center bg-card">
          <h2 className="text-base font-semibold text-foreground">No contacts match your query</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Try choosing another constituency, mandal, clearing the role filter, or modifying the search terms.
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl border bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Reset all filters
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card shadow-sm">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {[
                  "Name",
                  "Phone",
                  "Role",
                  "Party",
                  "Assembly",
                  "Mandal",
                  "Village / ward",
                  "Division",
                  "Membership",
                  "Sources",
                  "Notes",
                ].map((heading) => (
                  <th key={heading} className="px-3.5 py-3 font-semibold">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.rows || []).map((row, index) => (
                <tr
                  key={`${row.phone}-${row.name}-${index}`}
                  className="border-b align-top last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-3.5 py-3">
                    <p className="font-semibold text-foreground">{row.name || "—"}</p>
                    {marked(row.important) ? (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                        Imp
                      </span>
                    ) : null}
                    {row.variants &&
                    row.variants.trim().toLowerCase() !==
                      (row.name || "").trim().toLowerCase() ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{row.variants}</p>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3.5 py-3 tabular-nums font-medium">
                    {row.phone || "—"}
                  </td>
                  <td className="px-3.5 py-3">{row.designation || "No designation"}</td>
                  <td className="px-3.5 py-3">{row.party || "—"}</td>
                  <td className="px-3.5 py-3 font-medium text-foreground">
                    {row.assembly || "Unassigned"}
                  </td>
                  <td className="px-3.5 py-3">{row.mandal || "—"}</td>
                  <td className="px-3.5 py-3">{row.village || "—"}</td>
                  <td className="px-3.5 py-3">{row.division || "—"}</td>
                  <td className="px-3.5 py-3 tabular-nums">{row.membershipId || "—"}</td>
                  <td className="px-3.5 py-3 text-xs">{row.sources || "—"}</td>
                  <td className="max-w-[240px] px-3.5 py-3 text-xs text-muted-foreground">
                    {row.notes || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
