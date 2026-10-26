import { useState } from "react";

export type SimpleSection = "campaigns" | "schedules" | "visits";

const STATUSES = ["Open", "In progress", "Closed"] as const;

type Draft = {
  title: string;
  detail: string;
  status: string;
  place: string;
  visitDate: string;
  visitTime: string;
  leadPhone: string;
};

const empty = (): Draft => ({ title: "", detail: "", status: "Open", place: "", visitDate: "", visitTime: "", leadPhone: "" });

const inputClass = "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

export function SimpleRecordForm({
  section,
  initial,
  submitLabel,
  onSubmit,
}: {
  section: SimpleSection;
  initial?: Partial<Draft>;
  submitLabel?: string;
  onSubmit: (body: Record<string, string | string[]>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({ ...empty(), ...initial }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const visit = section === "schedules" || section === "visits";
  const set = (key: keyof Draft) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setDraft((current) => ({ ...current, [key]: event.target.value }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onSubmit({
        title: draft.title,
        detail: draft.detail,
        status: section === "campaigns" ? draft.status : "Open",
        ...(visit ? { place: draft.place, visitDate: draft.visitDate, visitTime: draft.visitTime, leadPhone: section === "visits" ? draft.leadPhone : "" } : {}),
      });
      if (!initial) setDraft(empty());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const label = submitLabel || (section === "campaigns" ? "Save campaign" : section === "schedules" ? "Save schedule" : "Save visit");

  return (
    <form onSubmit={(event) => void submit(event)} className="mb-6 space-y-4 rounded-xl border bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={section === "visits" ? "Purpose / Title" : "Title"} required>
          <input value={draft.title} onChange={set("title")} required autoFocus className={inputClass} />
        </Field>
        {section === "campaigns" && (
          <Field label="Status" required>
            <select value={draft.status} onChange={set("status")} required className={inputClass}>
              {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </Field>
        )}
        {visit && (
          <>
            <Field label="Date" required>
              <input type="date" value={draft.visitDate} onChange={set("visitDate")} required className={inputClass} />
            </Field>
            <Field label="Time" required>
              <input value={draft.visitTime} onChange={set("visitTime")} required placeholder="10:30 AM or Anytime" className={inputClass} />
            </Field>
            <Field label="Place" required>
              <input value={draft.place} onChange={set("place")} required className={inputClass} />
            </Field>
          </>
        )}
        {section === "visits" && (
          <Field label="Lead phone">
            <input value={draft.leadPhone} onChange={set("leadPhone")} inputMode="tel" pattern="(\+?91[\s-]?)?\d{10}" title="10-digit phone number" className={inputClass} />
          </Field>
        )}
      </div>
      <Field label="Details" required={section === "campaigns"}>
        <textarea value={draft.detail} onChange={set("detail")} required={section === "campaigns"} rows={3} className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
      </Field>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button disabled={saving} className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
        {saving ? "Saving…" : label}
      </button>
    </form>
  );
}
