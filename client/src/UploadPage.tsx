import { useEffect, useState } from "react";
import { Building2, CalendarClock, ChevronRight, ClipboardList, Eye, EyeOff, LogOut, MapPin, Menu, MessageSquareWarning, Pencil, Plus, Send, Trash2, Users, X } from "lucide-react";
import { api } from "@/lib/api.ts";
import { CaseRecordForm, type CaseSection } from "@/CaseRecordForm.tsx";
import { emptyPlace, PlaceFilters } from "@/PlaceFilters.tsx";
import { matchesPlace } from "@/places.ts";
import { ReportActions, ReportDownloads } from "@/ReportPage.tsx";
import { SimpleRecordForm, type SimpleSection } from "@/SimpleRecordForm.tsx";

const targets: { id: CaseSection; label: string; icon: typeof Users }[] = [
  { id: "grievances", label: "Grievances", icon: MessageSquareWarning },
  { id: "projects", label: "Projects & reports", icon: Building2 },
  { id: "people", label: "Constituency", icon: Users },
  { id: "campaigns", label: "Campaigns", icon: Send },
  { id: "followups", label: "Follow ups", icon: ClipboardList },
  { id: "schedules", label: "Schedules", icon: CalendarClock },
  { id: "visits", label: "Visits", icon: MapPin },
];

type RecordItem = {
  id: string;
  title: string;
  detail: string;
  status: string;
  date: string;
  srNumber?: string;
  fullName?: string;
  contactNumber?: string;
  address?: string;
  email?: string;
  village?: string;
  mandal?: string;
  division?: string;
  assemblyConstituency?: string;
  dateOfVisit?: string;
  referenceName?: string;
  referenceNumber?: string;
  categories?: string[];
  others?: string;
  actionTaken?: string;
  actionToBeTaken?: string;
  assignedOfficer?: string;
  resolutionStatus?: string;
  deadline?: string;
  place?: string;
  visitDate?: string;
  visitTime?: string;
  leadPhone?: string;
  progressStages?: { name: string; status: string; note: string }[];
};

const UPLOAD_SESSION = "janavignanam.upload";
const SLIP: CaseSection[] = ["grievances", "projects", "people", "followups"];

type Session = { token: string; email: string; name: string };

function readSession(): Session | null {
  try {
    const saved = JSON.parse(localStorage.getItem(UPLOAD_SESSION) ?? "null") as Session | null;
    return saved?.token ? saved : null;
  } catch {
    return null;
  }
}

function isSimple(section: CaseSection): section is SimpleSection {
  return section === "campaigns" || section === "schedules" || section === "visits";
}

function formatWhen(value: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).toLocaleDateString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "Just now";
  return date.toLocaleString();
}

function stageSummary(stages: { status: string }[]): string {
  const completed = stages.filter((stage) => stage.status === "Completed").length;
  const active = stages.filter((stage) => stage.status === "In progress").length;
  const pending = stages.filter((stage) => stage.status === "Pending").length;
  return `${completed} completed, ${active} in progress, ${pending} pending`;
}

function isSample(record: RecordItem): boolean {
  return record.id.startsWith("demo-");
}

function UploadDesk({
  session,
  onSignOut,
}: {
  session: { token: string; name: string; email: string };
  onSignOut: () => void;
}) {
  const [section, setSection] = useState<CaseSection>("grievances");
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RecordItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [approving, setApproving] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [place, setPlace] = useState(emptyPlace);
  const current = targets.find((item) => item.id === section) ?? targets[0];
  const located = section === "grievances" || section === "projects";
  const shown = located ? records.filter((item) => matchesPlace(item, place)) : records;

  useEffect(() => {
    let cancelled = false;
    setRecords([]);
    setLoading(true);
    api<RecordItem[]>(`/api/workspace/records?section=${section}`, { token: session.token })
      .then((rows) => {
        if (!cancelled) {
          setRecords(rows);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load records");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section, session.token]);

  const approve = async (id: string) => {
    setApproving(id);
    setNotice("");
    setError("");
    try {
      const result = await api<{ record: RecordItem; notice: string }>(`/api/workspace/records/${encodeURIComponent(id)}/approve`, {
        method: "POST",
        token: session.token,
      });
      setRecords((currentRows) => currentRows.map((item) => (item.id === id ? { ...item, ...result.record } : item)));
      setNotice(result.notice);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval was not sent");
    } finally {
      setApproving("");
    }
  };

  const choose = (next: CaseSection) => {
    setSection(next);
    setPlace(emptyPlace);
    setAdding(false);
    setEditing(null);
    setPendingDelete(null);
    setNotice("");
    setMenuOpen(false);
  };

  const save = async (body: Record<string, string | string[]>) => {
    const payload = { section, ...body };
    if (editing) {
      const row = await api<RecordItem>(`/api/workspace/records/${editing.id}`, {
        method: "PATCH",
        token: session.token,
        body: payload,
      });
      setRecords((currentRows) => currentRows.map((item) => (item.id === row.id ? row : item)));
      setEditing(null);
      setNotice("Changes saved.");
      return;
    }
    const row = await api<RecordItem>("/api/workspace/records", {
      method: "POST",
      token: session.token,
      body: payload,
    });
    setRecords((currentRows) => [row, ...currentRows]);
    setAdding(false);
    setNotice(`Saved to ${current.label}.`);
  };

  const remove = async (id: string) => {
    try {
      await api(`/api/workspace/records/${id}`, { method: "DELETE", token: session.token });
      setRecords((currentRows) => currentRows.filter((item) => item.id !== id));
      setPendingDelete(null);
      setNotice("Record deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the record");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {menuOpen && <button className="fixed inset-0 z-30 bg-black/20 md:hidden" onClick={() => setMenuOpen(false)} aria-label="Close menu" />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r bg-sidebar transition-transform md:translate-x-0 ${menuOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-20 items-center justify-between border-b px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary font-display font-bold text-primary-foreground">JV</div>
            <div>
              <p className="font-display font-semibold">Upload data</p>
              <p className="text-xs text-muted-foreground">Visitor records</p>
            </div>
          </div>
          <button className="md:hidden" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X className="size-5" /></button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {targets.map((item) => {
            const Icon = item.icon;
            const active = item.id === section;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => choose(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"}`}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="border-t p-4">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{session.name.slice(0, 2).toUpperCase()}</div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{session.name}</p>
              <p className="truncate text-xs text-muted-foreground">{session.email}</p>
            </div>
          </div>
          <button onClick={onSignOut} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"><LogOut className="size-4" />Sign out</button>
        </div>
      </aside>
      <main className="md:pl-72">
        <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b bg-background/90 px-5 backdrop-blur md:px-10">
          <button className="md:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
          <p className="text-sm text-muted-foreground">Add, view, edit, and delete records</p>
        </header>
        <div className="mx-auto max-w-7xl p-5 md:p-10">
          <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="mb-2 text-sm font-medium uppercase tracking-wider text-primary">Upload data</p>
              <h1 className="font-display text-3xl font-semibold tracking-tight">{current.label}</h1>
              <p className="mt-2 text-muted-foreground">{section === "campaigns" ? "Title, details, and status." : isSimple(section) ? "Date, time, place, and details." : "Visitor slip for this record."}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(section === "grievances" || section === "projects") && <ReportDownloads token={session.token} section={section} />}
            <button
              onClick={() => {
                setAdding((open) => !open);
                setEditing(null);
                setNotice("");
              }}
              className="flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="size-4" />
              Add record
            </button>
            </div>
          </div>
          {notice && <p className="mb-4 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{notice}</p>}
          {error && <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          {adding && isSimple(section) && <SimpleRecordForm key={`add-${section}`} section={section} onSubmit={save} />}
          {adding && !isSimple(section) && <CaseRecordForm key={`add-${section}`} section={section} onSubmit={save} />}
          {editing && isSimple(section) && (
            <SimpleRecordForm
              key={editing.id}
              section={section}
              submitLabel="Save changes"
              initial={{
                title: editing.title,
                detail: editing.detail,
                status: editing.status || "Open",
                place: editing.place || "",
                visitDate: editing.visitDate || "",
                visitTime: editing.visitTime || "",
                leadPhone: editing.leadPhone || "",
              }}
              onSubmit={save}
            />
          )}
          {editing && !isSimple(section) && (
            <CaseRecordForm
              key={editing.id}
              section={section}
              submitLabel="Save changes"
              initial={{
                srNumber: editing.srNumber || "",
                fullName: editing.fullName || editing.title || "",
                contactNumber: editing.contactNumber || "",
                address: editing.address || "",
                email: editing.email || "",
                village: editing.village || "",
                mandal: editing.mandal || "",
                division: editing.division || "",
                assemblyConstituency: editing.assemblyConstituency || "",
                dateOfVisit: editing.dateOfVisit || "",
                referenceName: editing.referenceName || "",
                referenceNumber: editing.referenceNumber || "",
                categories: editing.categories || [],
                others: editing.others || "",
                actionTaken: editing.actionTaken || "",
                actionToBeTaken: editing.actionToBeTaken || "",
                assignedOfficer: editing.assignedOfficer || "",
                resolutionStatus: editing.resolutionStatus || (["Pending", "In progress", "Resolved"].includes(editing.status) ? editing.status : ""),
                deadline: editing.deadline || "",
              }}
              onSubmit={save}
            />
          )}
          {located && <PlaceFilters value={place} onChange={setPlace} />}
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading records…</p>
          ) : shown.length ? (
            <div className="overflow-hidden rounded-xl border bg-card">
              {shown.map((item) => (
                <div key={item.id} className="border-b px-5 py-4 last:border-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="truncate font-medium">{item.fullName || item.title}</h2>
                      {item.srNumber ? <p className="mt-1 text-sm text-muted-foreground">Sr. {item.srNumber}</p> : null}
                      <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">{[item.visitTime, item.division, item.mandal, item.village, item.assemblyConstituency].filter(Boolean).join(", ") || item.detail}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 pt-0.5">
                      <span className="inline-flex h-6 items-center rounded-full bg-primary/10 px-2.5 text-xs font-medium text-primary">{item.status}</span>
                      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{formatWhen(item.date)}</span>
                    </div>
                  </div>
                  {item.categories?.length ? <p className="mt-2 truncate text-sm">{item.categories.map((category) => (category === "Others" && item.others ? item.others : category)).join(", ")}</p> : null}
                  {item.actionToBeTaken ? <p className="mt-1 truncate text-sm">Action to be taken: {item.actionToBeTaken}</p> : null}
                  {item.assignedOfficer ? <p className="mt-1 truncate text-sm">Assigned officer: {item.assignedOfficer}</p> : null}
                  {item.deadline ? <p className="mt-1 text-sm">Deadline: {formatWhen(item.deadline)}</p> : null}
                  {item.progressStages?.length ? <p className="mt-1 text-sm text-muted-foreground">{stageSummary(item.progressStages)}</p> : null}
                  <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                    {(section === "grievances" || section === "projects") && <ReportActions token={session.token} section={section} id={item.id} />}
                    {section === "grievances" && !isSample(item) && item.status !== "Approved" && (
                      <button type="button" disabled={approving === item.id} onClick={() => void approve(item.id)} className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                        {approving === item.id ? "Approving…" : "Approve"}
                      </button>
                    )}
                    {isSample(item) ? (
                      <span className="text-xs text-muted-foreground">Sample</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(item);
                            setAdding(false);
                            setPendingDelete(null);
                            setNotice("");
                          }}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border bg-background px-3 text-xs font-medium hover:bg-muted"
                        >
                          <Pencil className="size-3.5" />
                          Edit
                        </button>
                        {pendingDelete === item.id ? (
                          <span className="inline-flex items-center gap-2">
                            <button type="button" onClick={() => void remove(item.id)} className="inline-flex h-8 items-center rounded-lg bg-destructive px-3 text-xs font-medium text-white">Delete</button>
                            <button type="button" onClick={() => setPendingDelete(null)} className="inline-flex h-8 items-center rounded-lg border bg-background px-3 text-xs font-medium">Cancel</button>
                          </span>
                        ) : (
                          <button type="button" onClick={() => setPendingDelete(item.id)} className="inline-flex h-8 items-center gap-1 rounded-lg border bg-background px-3 text-xs font-medium hover:bg-muted">
                            <Trash2 className="size-3.5" />
                            Delete
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : records.length ? (
            <div className="rounded-xl border border-dashed p-12 text-center">
              <current.icon className="mx-auto size-8 text-muted-foreground" />
              <h2 className="mt-3 font-medium">No records in this place</h2>
              <p className="mt-1 text-sm text-muted-foreground">Choose another division, mandal, or village.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-12 text-center">
              <current.icon className="mx-auto size-8 text-muted-foreground" />
              <h2 className="mt-3 font-medium">Nothing saved yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">Add a record and it is stored in the database.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function UploadLogin({ onLogin }: { onLogin: (session: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const next = await api<{ token: string; user: { email: string; name: string } }>("/api/workspace/login", { method: "POST", body: { email, password } });
      const saved: Session = { token: next.token, email: next.user.email, name: next.user.name };
      localStorage.setItem(UPLOAD_SESSION, JSON.stringify(saved));
      onLogin(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary font-display text-lg font-bold text-primary-foreground">UP</div>
          <div>
            <h1 className="font-display text-xl font-semibold">Upload data</h1>
            <p className="text-sm text-muted-foreground">Separate sign-in for record entry</p>
          </div>
        </div>
        <h2 className="font-display text-2xl font-semibold">Sign in to upload</h2>
        <p className="mt-1 text-sm text-muted-foreground">This sign-in is only for the upload page.</p>
        <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4">
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="Email address" />
          <div className="relative">
            <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required className="h-11 w-full rounded-lg border bg-background px-3 pr-10 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="Password (8+ characters)" />
            <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((current) => !current)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button disabled={loading} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {loading ? "Signing in...." : "Sign in"}
            {loading ? null : <ChevronRight className="size-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function UploadPage() {
  const [session, setSession] = useState<Session | null>(readSession);
  if (!session) return <UploadLogin onLogin={setSession} />;
  return (
    <UploadDesk
      session={session}
      onSignOut={() => {
        localStorage.removeItem(UPLOAD_SESSION);
        setSession(null);
      }}
    />
  );
}
