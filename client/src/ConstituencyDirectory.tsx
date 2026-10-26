import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api.ts";

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
  roles: Facet[];
  rows: Contact[];
};

const ASSEMBLY_ORDER = ["Pedakurapadu", "Chilakaluripet", "Narasaraopet", "Sattenapalli", "Vinukonda", "Gurazala", "Macherla", "Unassigned"];
const DIVISION_ORDER = ["Narasaraopet", "Sattenapalli", "Gurazala", "No division"];

function marked(value: string | undefined): boolean {
  const text = (value || "").trim();
  return Boolean(text) && !/^(n|no|false|0)$/i.test(text);
}

export function ConstituencyDirectory({ token }: { token: string }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState("");
  const [assembly, setAssembly] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ q: query, division, assembly, role, page: String(page) });
    api<Page>(`/api/workspace/contacts?${params.toString()}`, { token })
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setError("");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load contacts");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, query, division, assembly, role, page]);

  const divisions = useMemo(() => {
    const rows = data?.divisions || [];
    return [...rows].sort((a, b) => DIVISION_ORDER.indexOf(a.name) - DIVISION_ORDER.indexOf(b.name));
  }, [data]);
  const assemblies = useMemo(() => {
    const rows = data?.assemblies || [];
    return [...rows].sort((a, b) => {
      const ai = ASSEMBLY_ORDER.indexOf(a.name);
      const bi = ASSEMBLY_ORDER.indexOf(b.name);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [data]);
  const totalAll = assemblies.reduce((sum, item) => sum + item.count, 0);
  const pages = Math.max(1, Math.ceil((data?.total || 0) / (data?.pageSize || 40)));
  const roleLabel = role === "__none__" ? "No designation" : role;

  const chooseDivision = (name: string) => {
    setDivision(name);
    setAssembly("");
    setPage(1);
  };

  const chooseAssembly = (name: string) => {
    setAssembly(name);
    setPage(1);
  };

  const chooseRole = (value: string) => {
    setRole(value === "No designation" ? "__none__" : value);
    setPage(1);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => chooseDivision("")} className={`rounded-full border px-3 py-1.5 text-sm ${division === "" ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
          All divisions
        </button>
        {divisions.map((item) => (
          <button key={item.name} type="button" onClick={() => chooseDivision(item.name)} className={`rounded-full border px-3 py-1.5 text-sm ${division === item.name ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
            {item.name} · {item.count.toLocaleString()}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => chooseAssembly("")} className={`rounded-full border px-3 py-1.5 text-sm ${assembly === "" ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
          All assemblies{totalAll ? ` · ${totalAll.toLocaleString()}` : ""}
        </button>
        {assemblies.map((item) => (
          <button key={item.name} type="button" onClick={() => chooseAssembly(item.name)} className={`rounded-full border px-3 py-1.5 text-sm ${assembly === item.name ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
            {item.name} · {item.count.toLocaleString()}
          </button>
        ))}
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_280px]">
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search the full sheet: name, phone, role, party, assembly, mandal, village, division, membership, sources, notes"
          className="h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          list="constituency-roles"
          value={roleLabel}
          onChange={(event) => chooseRole(event.target.value)}
          placeholder="All roles"
          className="h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <datalist id="constituency-roles">
          <option value="No designation" />
          {(data?.roles || []).filter((item) => item.name !== "No designation").map((item) => (
            <option key={item.name} value={item.name}>{`${item.name} (${item.count})`}</option>
          ))}
        </datalist>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{loading && !data ? "Loading contacts…" : `${(data?.total || 0).toLocaleString()} contacts${assembly ? ` in ${assembly}` : ""}${roleLabel ? ` · ${roleLabel}` : ""}`}</span>
        <span className="flex items-center gap-2">
          <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border bg-card px-3 py-1.5 disabled:opacity-40">Previous</button>
          <span>Page {Math.min(page, pages)} of {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage((current) => current + 1)} className="rounded-lg border bg-card px-3 py-1.5 disabled:opacity-40">Next</button>
        </span>
      </div>
      {error && <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {data && data.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <h2 className="font-medium">No contacts match</h2>
          <p className="mt-1 text-sm text-muted-foreground">Try another assembly, role, or search.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {["Name", "Phone", "Role", "Party", "Assembly", "Mandal", "Village / ward", "Division", "Membership", "Sources", "Notes"].map((heading) => (
                  <th key={heading} className="px-3 py-3 font-medium">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.rows || []).map((row, index) => (
                <tr key={`${row.phone}-${row.name}-${index}`} className="border-b align-top last:border-0">
                  <td className="px-3 py-3">
                    <p className="font-medium">{row.name || "—"}</p>
                    {marked(row.important) ? <span className="mt-1 inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700">Imp</span> : null}
                    {row.variants && row.variants.trim().toLowerCase() !== (row.name || "").trim().toLowerCase() ? <p className="mt-1 text-xs text-muted-foreground">{row.variants}</p> : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{row.phone || "—"}</td>
                  <td className="px-3 py-3">{row.designation || "No designation"}</td>
                  <td className="px-3 py-3">{row.party || "—"}</td>
                  <td className="px-3 py-3">{row.assembly || "Unassigned"}</td>
                  <td className="px-3 py-3">{row.mandal || "—"}</td>
                  <td className="px-3 py-3">{row.village || "—"}</td>
                  <td className="px-3 py-3">{row.division || "—"}</td>
                  <td className="px-3 py-3">{row.membershipId || "—"}</td>
                  <td className="px-3 py-3">{row.sources || "—"}</td>
                  <td className="max-w-[240px] px-3 py-3 text-muted-foreground">{row.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
