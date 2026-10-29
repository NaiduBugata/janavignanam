import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "@/lib/api.ts";
import { apiUrl } from "@/lib/apiBase.ts";

type Stage = { name: string; status: string; note: string };
type ProgressHistoryEntry = {
  status: string;
  remarks?: string;
  department?: string;
  updatedAt: string;
  stages?: Stage[];
};
type Report = {
  id: string;
  title: string;
  detail: string;
  status: string;
  fullName?: string;
  village?: string;
  mandal?: string;
  assemblyConstituency?: string;
  place?: string;
  followUpDepartment?: string;
  department?: string;
  leader?: string;
  progressStages?: Stage[];
  progressRemarks?: string;
  remarks?: string;
  progressHistory?: ProgressHistoryEntry[];
  progressUpdatedAt?: string;
  srNumber?: string;
  actionToBeTaken?: string;
  assignedOfficer?: string;
  deadline?: string;
  categories?: string[];
};

const REPORT_TOKEN = "janavignanam.reportToken";

function sessionToken(): string {
  const keys = [REPORT_TOKEN, "janavignanam.session", "janavignanam.upload"];
  for (const key of keys) {
    try {
      const raw = key === REPORT_TOKEN ? sessionStorage.getItem(key) : localStorage.getItem(key);
      const saved = JSON.parse(raw ?? "null") as { token?: string } | string | null;
      if (typeof saved === "string" && saved) return saved;
      if (saved && typeof saved === "object" && saved.token) return saved.token;
    } catch {
      // Ignore a damaged saved session and try the next one.
    }
  }
  return "";
}

export function ReportActions({ token, id }: { token: string; section: "grievances" | "projects"; id: string }) {
  const [error, setError] = useState("");
  if (id.startsWith("demo-")) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <Link to={`/reports/${id}`} onClick={() => sessionStorage.setItem(REPORT_TOKEN, token)} className="inline-flex h-8 items-center justify-center rounded-lg border bg-background px-3 text-xs font-medium hover:bg-muted">View</Link>
      <button type="button" onClick={() => void downloadFile(`/api/workspace/records/${encodeURIComponent(id)}/pdf`, token, "report.pdf").catch(() => setError("Download failed"))} className="inline-flex h-8 items-center justify-center rounded-lg border bg-background px-3 text-xs font-medium hover:bg-muted">Download</button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}

export function ReportDownloads({ token, section }: { token: string; section: "grievances" | "projects" }) {
  return (
    <span className="flex flex-wrap gap-2">
      <button type="button" onClick={() => void downloadFile(`/api/workspace/reports/export?section=${section}&format=pdf`, token, `${section}-reports.pdf`)} className="h-10 rounded-lg border px-3 text-sm">All reports PDF</button>
      <button type="button" onClick={() => void downloadFile(`/api/workspace/reports/export?section=${section}&format=xlsx`, token, `${section}-reports.xlsx`)} className="h-10 rounded-lg border px-3 text-sm">All reports Excel</button>
    </span>
  );
}

export default function ReportPage() {
  const token = sessionToken();
  const { id = "" } = useParams();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [downloadError, setDownloadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api<Report>(`/api/workspace/records/${encodeURIComponent(id)}`, { token })
      .then((row) => {
        if (!cancelled) setReport(row);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not open this report");
      });
    const timer = window.setInterval(() => {
      api<Report>(`/api/workspace/records/${encodeURIComponent(id)}`, { token })
        .then((row) => {
          if (!cancelled) setReport(row);
        })
        .catch(() => undefined);
    }, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id, token]);

  const stages = report?.progressStages || [];
  const completed = stages.filter((stage) => stage.status === "Completed").length;
  const pending = stages.filter((stage) => stage.status === "Pending").length;
  const active = stages.filter((stage) => stage.status === "In progress").length;
  const width = stages.length ? Math.round((completed / stages.length) * 100) : 0;
  const place = [report?.village, report?.mandal, report?.assemblyConstituency].filter(Boolean).join(", ") || report?.place || "—";

  return (
    <div className="min-h-screen bg-[#f4f1ea] text-[#1c1915]">
      <header className="border-b border-[#e4dccb] bg-white/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-3xl justify-end">
          <button onClick={() => void downloadFile(`/api/workspace/records/${encodeURIComponent(id)}/pdf`, token, "report.pdf").then(() => setDownloadError("")).catch(() => setDownloadError("Download failed"))} className="h-10 rounded-lg bg-[#1f4d3a] px-4 text-sm font-medium text-white">
            Download PDF
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {downloadError && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{downloadError}</p>}
        {report && (
          <article className="rounded-2xl border border-[#e4dccb] bg-white shadow-sm">
            <div className="border-b border-[#e4dccb] px-8 py-8">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#1f4d3a]">JanaVignanam report</p>
              <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">{report.fullName || report.title}</h1>
              {report.srNumber ? <p className="mt-2 text-sm text-[#6b6256]">Sr. {report.srNumber}</p> : null}
            </div>
            <div className="grid gap-6 px-8 py-6 sm:grid-cols-2">
              <Field label="Department" value={report.department || report.followUpDepartment || "—"} />
              <Field label="Location" value={place} />
              <Field label="Leader to contact" value={report.leader || "—"} />
              <Field label="Status" value={report.status} />
              <Field label="Assigned officer" value={report.assignedOfficer || "—"} />
            </div>
            <div className="px-8 pb-8">
              <h2 className="font-display text-lg font-semibold">Issue</h2>
              {report.categories?.length ? <p className="mt-2 leading-7 text-[#3d3832]">{report.categories.join(", ")}</p> : <p className="mt-2 leading-7 text-[#3d3832]">{report.detail || "—"}</p>}
              {report.actionToBeTaken ? <p className="mt-3 text-sm">Action to be taken: {report.actionToBeTaken}</p> : null}
              {report.deadline ? <p className="mt-1 text-sm">Deadline: {report.deadline}</p> : null}
              {(report.progressRemarks || report.remarks) ? (
                <div className="mt-4 rounded-xl border border-[#e4dccb] bg-[#faf8f5] p-4">
                  <p className="text-xs uppercase tracking-wider text-[#8a8174]">Latest Department Remarks</p>
                  <p className="mt-1 text-sm leading-6 text-[#1c1915]">{report.progressRemarks || report.remarks}</p>
                </div>
              ) : null}
            </div>
            <div className="border-t border-[#e4dccb] px-8 py-8">
              <div className="flex items-end justify-between">
                <h2 className="font-display text-lg font-semibold">Work progress</h2>
                <p className="text-sm text-[#6b6256]">{completed} completed · {active} in progress · {pending} pending</p>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#efe8da]">
                <div className="h-full rounded-full bg-[#1f4d3a]" style={{ width: `${width}%` }} />
              </div>
              <ol className="mt-6 space-y-3">
                {stages.map((stage, index) => (
                  <li key={`${stage.name}-${index}`} className="flex items-start justify-between gap-4 rounded-xl border border-[#efe8da] px-4 py-3">
                    <div>
                      <p className="font-medium">{index + 1}. {stage.name}</p>
                      {stage.note ? <p className="mt-1 text-sm text-[#6b6256]">{stage.note}</p> : null}
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${stage.status === "Completed" ? "bg-[#e5f2eb] text-[#1f4d3a]" : stage.status === "In progress" ? "bg-[#fff4d6] text-[#8a5a00]" : "bg-[#f3f1ec] text-[#6b6256]"}`}>{stage.status}</span>
                  </li>
                ))}
              </ol>
              {report.progressUpdatedAt ? <p className="mt-4 text-xs text-[#6b6256]">Last update {new Date(report.progressUpdatedAt).toLocaleString()}</p> : null}

              {report.progressHistory && report.progressHistory.length > 0 && (
                <div className="mt-8 border-t border-[#e4dccb] pt-6">
                  <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-[#8a8174]">Progress Audit Trail</h3>
                  <div className="mt-4 space-y-3">
                    {report.progressHistory.slice(-5).reverse().map((entry, idx) => (
                      <div key={idx} className="rounded-xl border border-[#efe8da] bg-[#faf8f5] p-3 text-xs">
                        <div className="flex items-center justify-between text-[#6b6256]">
                          <span className="font-medium text-[#1c1915]">{entry.department || report.department || "Department"}</span>
                          <span>{new Date(entry.updatedAt).toLocaleString()}</span>
                        </div>
                        <p className="mt-1.5 font-semibold text-[#1f4d3a]">Status: {entry.status}</p>
                        {entry.remarks && <p className="mt-1 text-[#3d3832]">{entry.remarks}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </article>
        )}
      </main>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-[#8a8174]">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

export async function downloadFile(path: string, token: string, fallbackName: string) {
  const response = await fetch(apiUrl(path), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error("Download failed");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const header = response.headers.get("Content-Disposition") || "";
  const named = /filename="([^"]+)"/.exec(header);
  link.href = url;
  link.download = named?.[1] || fallbackName;
  link.click();
  URL.revokeObjectURL(url);
}
