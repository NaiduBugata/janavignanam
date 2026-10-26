import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api.ts";

type StageStatus = "Pending" | "In progress" | "Completed";
type Stage = { name: string; status: StageStatus; note: string };
type Progress = {
  title: string;
  detail: string;
  department: string;
  place: string;
  leader: string;
  status: string;
  stages: Stage[];
  updatedAt: string;
};

const STATUSES: StageStatus[] = ["Pending", "In progress", "Completed"];

export default function ProgressPage() {
  const { token = "" } = useParams();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [nextName, setNextName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<Progress>(`/api/progress/${encodeURIComponent(token)}`)
      .then((row) => {
        if (cancelled) return;
        setProgress(row);
        setStages(row.stages);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "This progress link is not available");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const save = async () => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const row = await api<Progress>(`/api/progress/${encodeURIComponent(token)}`, {
        method: "PATCH",
        body: { stages },
      });
      setProgress(row);
      setStages(row.stages);
      setNotice("Progress saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the progress");
    } finally {
      setSaving(false);
    }
  };

  const completed = stages.filter((stage) => stage.status === "Completed").length;
  const width = stages.length ? Math.round((completed / stages.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background px-4 py-10 text-foreground">
      <main className="mx-auto max-w-3xl">
        <p className="text-sm font-medium uppercase tracking-wider text-primary">Department progress</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Update the work.</h1>
        <p className="mt-3 text-muted-foreground">Mark what has started, what is underway, and what is still pending. This page belongs to this record only.</p>
        {error && <p className="mt-6 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {progress && (
          <section className="mt-8 overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="border-b bg-primary px-6 py-5 text-primary-foreground">
              <p className="text-sm uppercase tracking-wider text-primary-foreground/80">{progress.department}</p>
              <h2 className="mt-1 font-display text-2xl font-semibold">{progress.title}</h2>
            </div>
            <div className="grid gap-4 px-6 py-5 sm:grid-cols-3">
              <Info label="Location" value={progress.place} />
              <Info label="Leader to contact" value={progress.leader} />
              <Info label="Record status" value={progress.status} />
            </div>
            <p className="px-6 pb-6 text-sm leading-6">{progress.detail}</p>
            <div className="border-t px-6 py-5">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium">{completed} of {stages.length} stages completed</span>
                <span className="text-muted-foreground">{width}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
              </div>
            </div>
            <div className="space-y-4 px-6 pb-6">
              {stages.map((stage, index) => (
                <div key={`${stage.name}-${index}`} className="rounded-xl border p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="font-medium">{stage.name}</h3>
                    <select
                      value={stage.status}
                      onChange={(event) => setStages((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, status: event.target.value as StageStatus } : item))}
                      className="h-10 rounded-lg border bg-background px-3 text-sm"
                    >
                      {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </div>
                  <input
                    value={stage.note}
                    onChange={(event) => setStages((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, note: event.target.value } : item))}
                    placeholder="Note for this stage"
                    className="mt-3 h-10 w-full rounded-lg border bg-background px-3 text-sm"
                  />
                </div>
              ))}
              <div className="flex gap-2">
                <input value={nextName} onChange={(event) => setNextName(event.target.value)} placeholder="Add a stage" className="h-10 flex-1 rounded-lg border bg-background px-3 text-sm" />
                <button
                  type="button"
                  onClick={() => {
                    const name = nextName.trim();
                    if (!name || stages.length >= 12) return;
                    setStages((current) => [...current, { name, status: "Pending", note: "" }]);
                    setNextName("");
                  }}
                  className="h-10 rounded-lg border px-4 text-sm"
                >
                  Add
                </button>
              </div>
              {notice && <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{notice}</p>}
              <button disabled={saving} onClick={() => void save()} className="h-11 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {saving ? "Saving…" : "Save progress"}
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value || "—"}</p>
    </div>
  );
}
