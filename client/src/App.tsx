import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareWarning,
  Newspaper,
  Plus,
  Search,
  Send,
  Settings,
  Users,
  X,
} from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { api, ApiError } from "@/lib/api.ts";
import NewsDesk from "@/news/NewsDesk.tsx";
import { CaseRecordForm, type CaseSection } from "@/CaseRecordForm.tsx";
import { ConstituencyDirectory } from "@/ConstituencyDirectory.tsx";
import { emptyPlace, PlaceFilters } from "@/PlaceFilters.tsx";
import { matchesPlace } from "@/places.ts";
import { ReportActions, ReportDownloads } from "@/ReportPage.tsx";
import { SimpleRecordForm } from "@/SimpleRecordForm.tsx";
import { NewsProvider } from "@/mediasphere/context/NewsContext.jsx";
import AnalyticsDashboard from "@/mediasphere/components/analytics/AnalyticsDashboard.tsx";
import { MpRetrievalWindow } from "@/components/MpRetrievalWindow.tsx";

type Section = "overview" | "grievances" | "projects" | "news" | "people" | "campaigns" | "analytics";
type ListSection = "grievances" | "projects" | "people" | "campaigns";
type RecordItem = {
  id: string;
  title: string;
  detail: string;
  status: string;
  date: string;
  followUpDepartment?: string;
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
  deadline?: string;
  place?: string;
  progressStages?: { name: string; status: string; note: string }[];
  progressRemarks?: string;
  progressUpdatedAt?: string;
};
type Session = { token: string; email: string; name: string };
type Summary = { counts: Record<CaseSection, number>; open: number; news: number; mongo: boolean };
type NewsStats = { total?: number; positive_count?: number; negative_count?: number; problem_count?: number };
type ChannelStatus = { status?: string; pending_articles?: number; last_error?: string | null };

const SESSION_KEY = "janavignanam.session";
const LISTED: ListSection[] = ["grievances", "projects", "people", "campaigns"];

const nav: { id: Section; path: string; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", path: "/", label: "Command center", icon: LayoutDashboard },
  { id: "grievances", path: "/grievances", label: "Grievances", icon: MessageSquareWarning },
  { id: "projects", path: "/projects", label: "Projects & reports", icon: Building2 },
  { id: "news", path: "/news", label: "News", icon: Newspaper },
  { id: "people", path: "/people", label: "Constituency", icon: Users },
  { id: "campaigns", path: "/campaigns", label: "Campaigns", icon: Send },
  { id: "analytics", path: "/analytics", label: "Analytics", icon: BarChart3 },
];

function sectionFromPath(pathname: string): Section {
  const match = nav.find((item) => item.path !== "/" && pathname.startsWith(item.path));
  return match?.id ?? "overview";
}

const labels: Record<Section, { title: string; description: string; icon: typeof Activity }> = {
  overview: { title: "Command center", description: "Live counts from the constituency database.", icon: LayoutDashboard },
  grievances: { title: "Grievances", description: "Requests saved in the database.", icon: MessageSquareWarning },
  projects: { title: "Projects & reports", description: "Delivery updates saved in the database.", icon: ClipboardList },
  news: { title: "News", description: "Constituency articles from the news database.", icon: Newspaper },
  people: { title: "Constituency", description: "Palnadu contacts from the master sheet, by division, assembly, and role.", icon: Users },
  campaigns: { title: "Campaigns", description: "Campaign plans saved in the database. Messages are not sent from this screen.", icon: Send },
  analytics: { title: "Analytics", description: "Article totals from the news database.", icon: BarChart3 },
};

function readSession(): Session | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as Session | null;
    return saved?.token ? saved : null;
  } catch {
    return null;
  }
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

function isListSection(section: Section): section is ListSection {
  return (LISTED as readonly string[]).includes(section);
}

function App() {
  const [session, setSession] = useState<Session | null>(readSession);
  const [loginNotice, setLoginNotice] = useState("");
  const { pathname } = useLocation();
  const section = sectionFromPath(pathname);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [stats, setStats] = useState<NewsStats | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<"notifications" | "settings" | null>(null);
  const [panelBody, setPanelBody] = useState("");

  const expireOn401 = (err: unknown): boolean => {
    if (!(err instanceof ApiError) || err.status !== 401) return false;
    localStorage.removeItem(SESSION_KEY);
    setLoginNotice("Your session expired. Please sign in again.");
    setSession(null);
    return true;
  };

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [nextSummary, nextStats] = await Promise.all([
          api<Summary>("/api/workspace/summary", { token: session.token }),
          api<NewsStats>("/api/news/stats"),
        ]);
        if (!cancelled) {
          setSummary(nextSummary);
          setStats(nextStats);
          setNotice(null);
        }
      } catch (err) {
        if (cancelled || expireOn401(err)) return;
        setNotice(err instanceof Error ? err.message : "Could not reach the database");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [session, records.length]);

  useEffect(() => {
    if (!session || !isListSection(section)) return;
    let cancelled = false;
    api<RecordItem[]>(`/api/workspace/records?section=${section}`, { token: session.token })
      .then((rows) => {
        if (!cancelled) setRecords(rows);
      })
      .catch((err: unknown) => {
        if (cancelled || expireOn401(err)) return;
        setNotice(err instanceof Error ? err.message : "Could not load records");
      });
    return () => {
      cancelled = true;
    };
  }, [session, section]);

  if (!session) return <Login notice={loginNotice} onLogin={(next) => { setLoginNotice(""); setNotice(null); setSession(next); }} />;

  const signOut = () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  };

  const approveRecord = async (id: string) => {
    const result = await api<{ record: RecordItem; notice: string }>(`/api/workspace/records/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      token: session.token,
    });
    setRecords((current) => current.map((item) => (item.id === id ? { ...item, ...result.record } : item)));
    return result.notice;
  };

  const addRecord = async (target: CaseSection, body: Record<string, string | string[]>) => {
    try {
      const row = await api<RecordItem>("/api/workspace/records", {
        method: "POST",
        token: session.token,
        body: { section: target, ...body },
      });
      if (section === target) setRecords((current) => [row, ...current]);
    } catch (err) {
      if (!expireOn401(err)) throw err;
    }
  };

  const openPanel = async (next: "notifications" | "settings") => {
    setPanel((current) => (current === next ? null : next));
    try {
      if (next === "notifications") {
        const status = await api<{ email: ChannelStatus; whatsapp: ChannelStatus }>("/api/notifications/status");
        setPanelBody(`Email: ${status.email.status || "unknown"}\nWhatsApp: ${status.whatsapp.status || "unknown"}`);
      } else {
        const health = await api<{ status: string; mongo: boolean }>("/api/health");
        setPanelBody(`API: ${health.status}\nDatabase: ${health.mongo ? "connected" : "disconnected"}`);
      }
    } catch (err) {
      setPanelBody(err instanceof Error ? err.message : "Unavailable");
    }
  };

  const loaded = session && isListSection(section) ? records : [];
  const visible = loaded.filter((item) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    const haystack = [item.title, item.detail, item.status, item.fullName, item.village, item.mandal, item.division, item.contactNumber, item.srNumber, ...(item.categories || [])].join(" ");
    return haystack.toLowerCase().includes(needle);
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      {sidebarOpen && <button className="fixed inset-0 z-30 bg-black/20 md:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close menu" />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r bg-sidebar transition-transform md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-20 items-center justify-between border-b px-6">
          <div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-primary font-display font-bold text-primary-foreground">JV</div><div><p className="font-display font-semibold">JanaVignanam</p><p className="text-xs text-muted-foreground">Constituency database</p></div></div>
          <button className="md:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X className="size-5" /></button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-4">{nav.map((item) => { const Icon = item.icon; return <NavLink key={item.id} to={item.path} end={item.path === "/"} onClick={() => setSidebarOpen(false)} className={({ isActive }) => `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${isActive ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"}`}><Icon className="size-4" />{item.label}</NavLink>; })}</nav>
        <div className="border-t p-4"><div className="mb-3 flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{session.name.slice(0, 2).toUpperCase()}</div><div className="min-w-0"><p className="truncate text-sm font-medium">{session.name}</p><p className="truncate text-xs text-muted-foreground">{session.email}</p></div></div><button onClick={signOut} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"><LogOut className="size-4" />Sign out</button></div>
      </aside>
      <main className="md:pl-72">
        <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b bg-background/90 px-5 backdrop-blur md:px-10">
          <button className="md:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
          <div className="relative hidden w-80 md:block"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 w-full rounded-lg border bg-muted/30 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="Search saved records" /></div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{summary?.mongo ? "Database connected" : "Checking database"}</span>
            <button className="flex size-9 items-center justify-center rounded-lg border text-muted-foreground hover:bg-muted" aria-label="Notifications" onClick={() => void openPanel("notifications")}><Bell className="size-4" /></button>
            <button className="flex size-9 items-center justify-center rounded-lg border text-muted-foreground hover:bg-muted" aria-label="Settings" onClick={() => void openPanel("settings")}><Settings className="size-4" /></button>
          </div>
        </header>
        {panel && <div className="border-b bg-card px-5 py-3 text-sm whitespace-pre-line text-muted-foreground md:px-10">{panelBody}</div>}
        {notice && <div className="border-b bg-destructive/10 px-5 py-3 text-sm text-destructive md:px-10">{notice}</div>}
        <div className={section === "news" ? "h-[calc(100vh-5rem)]" : "mx-auto max-w-7xl p-5 md:p-10"}>
          <Workspace section={section} records={visible} summary={summary} stats={stats} token={session.token} onAdd={(body) => addRecord(section as CaseSection, body)} onApprove={approveRecord} />
        </div>
      </main>
    </div>
  );
}

function Login({ notice, onLogin }: { notice?: string; onLogin: (session: Session) => void }) {
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
      localStorage.setItem(SESSION_KEY, JSON.stringify(saved));
      onLogin(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-accent/30 via-background to-background p-6">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm">
        <div className="mb-8 flex items-center gap-3"><div className="flex size-12 items-center justify-center rounded-xl bg-primary font-display text-lg font-bold text-primary-foreground">JV</div><div><h1 className="font-display text-xl font-semibold">JanaVignanam</h1><p className="text-sm text-muted-foreground">Constituency intelligence</p></div></div>
        <h2 className="font-display text-2xl font-semibold">Welcome back</h2>
        <p className="mt-1 text-sm text-muted-foreground">Sign in with the account stored in the database.</p>
        {notice && <p className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700">{notice}</p>}
        <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4">
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="Email address" />
          <div className="relative">
            <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required className="h-11 w-full rounded-lg border bg-background px-3 pr-10 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="Password (8+ characters)" />
            <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((current) => !current)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button disabled={loading} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{loading ? "Signing in...." : "Sign in"}{loading ? null : <ChevronRight className="size-4" />}</button>
        </form>
      </div>
    </div>
  );
}

function Workspace({ section, records, summary, stats, token, onAdd, onApprove }: { section: Section; records: RecordItem[]; summary: Summary | null; stats: NewsStats | null; token: string; onAdd: (body: Record<string, string | string[]>) => Promise<void>; onApprove: (id: string) => Promise<string> }) {
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [approving, setApproving] = useState("");
  const [approveNote, setApproveNote] = useState("");
  const [place, setPlace] = useState(emptyPlace);
  const meta = labels[section];
  const Icon = meta.icon;
  const located = section === "grievances" || section === "projects";
  const shown = located ? records.filter((item) => matchesPlace(item, place)) : records;
  const open = shown.filter((item) => item.status === "Open" || item.status === "Pending" || item.status === "In progress").length;
  useEffect(() => setPlace(emptyPlace), [section]);
  const tracked = useMemo(() => (summary ? Object.values(summary.counts).reduce((sum, value) => sum + value, 0) : 0), [summary]);

  if (section === "news") {
    return <NewsDesk />;
  }

  if (section === "overview") {
    return (
      <>
        <div className="mb-10">
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-primary">Command center</p>
          <h1 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">Good morning.</h1>
          <p className="mt-3 max-w-xl text-muted-foreground">Counts below come from the constituency database. News articles stay in the news collection.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Open items", value: summary?.open ?? "—", icon: Activity },
            { label: "Saved records", value: tracked, icon: FileText },
            { label: "News articles", value: summary?.news ?? stats?.total ?? "—", icon: Newspaper },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border bg-card p-5"><card.icon className="mb-8 size-5 text-primary" /><p className="text-sm text-muted-foreground">{card.label}</p><p className="mt-1 font-display text-3xl font-semibold">{card.value}</p></div>
          ))}
        </div>

        {/* MP Retrieval Engine & Intelligence Desk */}
        <MpRetrievalWindow />

        <div className="mt-8 rounded-xl border bg-card p-6">
          <h2 className="font-display text-lg font-semibold">Open a workflow</h2>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">{nav.slice(1, 6).map((item) => <button key={item.id} onClick={() => navigate(item.path)} className="flex items-center justify-between rounded-lg border p-3 text-left text-sm hover:bg-muted"><span className="flex items-center gap-2"><item.icon className="size-4 text-primary" />{item.label}</span><ChevronRight className="size-4 text-muted-foreground" /></button>)}</div>
        </div>
      </>
    );
  }

  if (section === "people") {
    return <ConstituencyDirectory token={token} />;
  }

  if (section === "analytics") {
    return (
      <NewsProvider>
        <AnalyticsDashboard />
      </NewsProvider>
    );
  }

  return (
    <>
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <SectionHeading meta={meta} />
        <div className="flex flex-wrap gap-2">
          {(section === "grievances" || section === "projects") && <ReportDownloads token={token} section={section} />}
          <button onClick={() => setShowForm(!showForm)} className="flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"><Plus className="size-4" />Add record</button>
        </div>
      </div>
      {showForm && section === "campaigns" && <SimpleRecordForm key={section} section="campaigns" onSubmit={onAdd} />}
      {showForm && isListSection(section) && section !== "campaigns" && <CaseRecordForm key={section} section={section} onSubmit={onAdd} />}
      {located && <PlaceFilters value={place} onChange={setPlace} />}
      <div className="mb-4 flex items-center gap-4 text-sm text-muted-foreground"><span>{shown.length} records</span><span>{open} active</span></div>
      {approveNote && <p className="mb-4 rounded-lg bg-primary/10 px-3 py-2 text-sm">{approveNote}</p>}
      {shown.length ? (
        <div className="overflow-hidden rounded-xl border bg-card">
          {shown.map((item) => (
            <div key={item.id} className="border-b px-5 py-4 last:border-0">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="truncate font-medium">{item.fullName || item.title}</h2>
                  {item.srNumber ? <p className="mt-1 text-sm text-muted-foreground">Sr. {item.srNumber}</p> : null}
                  <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">{[item.division, item.mandal, item.village, item.assemblyConstituency].filter(Boolean).join(", ") || item.detail}</p>
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
              {item.progressRemarks ? <p className="mt-1 text-sm text-muted-foreground"><span className="font-medium text-foreground">Remarks:</span> {item.progressRemarks}</p> : null}
              {item.status === "Reviewed" && item.followUpDepartment ? <p className="mt-1 text-sm text-muted-foreground">Follow up sent to {item.followUpDepartment}.</p> : null}
              {item.status === "Approved" && item.followUpDepartment ? <p className="mt-1 text-sm text-muted-foreground">The department, the leader, and the person who raised it were messaged.</p> : null}
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {(section === "grievances" || section === "projects") && <ReportActions token={token} section={section} id={item.id} />}
                {section === "grievances" && !item.id.startsWith("demo-") && item.status !== "Approved" && (
                  <button
                    type="button"
                    disabled={approving === item.id}
                    onClick={() => {
                      setApproving(item.id);
                      void onApprove(item.id).then((note) => setApproveNote(note)).catch((err: unknown) => setApproveNote(err instanceof Error ? err.message : "Approval was not sent")).finally(() => setApproving(""));
                    }}
                    className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  >
                    {approving === item.id ? "Approving…" : "Approve"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : records.length ? (
        <div className="rounded-xl border border-dashed p-12 text-center"><Icon className="mx-auto size-8 text-muted-foreground" /><h2 className="mt-3 font-medium">No records in this place</h2><p className="mt-1 text-sm text-muted-foreground">Choose another division, mandal, or village.</p></div>
      ) : (
        <div className="rounded-xl border border-dashed p-12 text-center"><Icon className="mx-auto size-8 text-muted-foreground" /><h2 className="mt-3 font-medium">Nothing saved yet</h2><p className="mt-1 text-sm text-muted-foreground">Add a record and it is stored in the database.</p></div>
      )}
    </>
  );
}

function SectionHeading({ meta }: { meta: { title: string; description: string; icon: typeof Activity } }) {
  const Icon = meta.icon;
  return (
    <div>
      <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></div>
      <h1 className="font-display text-3xl font-semibold tracking-tight">{meta.title}</h1>
      <p className="mt-2 text-muted-foreground">{meta.description}</p>
    </div>
  );
}

export default App;
