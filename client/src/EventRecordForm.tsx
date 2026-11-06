import { useState } from "react";
import { ASSEMBLY_CONSTITUENCIES } from "@/CaseRecordForm.tsx";
import { divisionNames, mandalNames, villageNames, withCurrent } from "@/places.ts";

export const BENEFITS = [
  "CMRF / Medical Assistance",
  "MPLADS",
  "Housing",
  "Education / Fee Concession",
  "Pension & Social Welfare",
  "TTD Recommendation Letter",
  "Nominated Posts",
  "Other benefit",
] as const;

type Draft = {
  fullName: string;
  contactNumber: string;
  designation: string;
  benefit: string;
  division: string;
  mandal: string;
  village: string;
  assemblyConstituency: string;
  dateOfVisit: string;
  detail: string;
};

const empty = (): Draft => ({
  fullName: "",
  contactNumber: "",
  designation: "",
  benefit: "CMRF / Medical Assistance",
  division: "",
  mandal: "",
  village: "",
  assemblyConstituency: "",
  dateOfVisit: new Date().toISOString().slice(0, 10),
  detail: "",
});

const inputClass = "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium">{label}<span className="text-destructive"> *</span></span>
      {children}
    </label>
  );
}

export function EventRecordForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  className,
}: {
  initial?: Partial<Draft>;
  submitLabel?: string;
  onSubmit: (body: Record<string, string | string[]>) => Promise<void>;
  onCancel?: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({ ...empty(), ...initial }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onSubmit({
        title: draft.fullName,
        fullName: draft.fullName,
        contactNumber: draft.contactNumber,
        designation: draft.designation,
        status: draft.benefit,
        categories: [draft.benefit],
        division: draft.division,
        mandal: draft.mandal,
        village: draft.village,
        assemblyConstituency: draft.assemblyConstituency,
        dateOfVisit: draft.dateOfVisit,
        detail: draft.detail,
      });
      if (!initial) setDraft(empty());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className={className || "mb-6 space-y-4 rounded-xl border bg-card p-5"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Person">
          <input value={draft.fullName} onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))} required autoFocus className={inputClass} />
        </Field>
        <Field label="Phone">
          <input value={draft.contactNumber} onChange={(event) => setDraft((current) => ({ ...current, contactNumber: event.target.value }))} required inputMode="tel" pattern="(\+?91[\s-]?)?\d{10}" title="10-digit phone number" className={inputClass} />
        </Field>
        <Field label="Designation">
          <input value={draft.designation} onChange={(event) => setDraft((current) => ({ ...current, designation: event.target.value }))} required className={inputClass} />
        </Field>
        <Field label="Benefit">
          <select value={draft.benefit} onChange={(event) => setDraft((current) => ({ ...current, benefit: event.target.value }))} required className={inputClass}>
            {BENEFITS.map((benefit) => <option key={benefit} value={benefit}>{benefit}</option>)}
          </select>
        </Field>
        <Field label="Constituency">
          <select value={draft.assemblyConstituency} onChange={(event) => setDraft((current) => ({ ...current, assemblyConstituency: event.target.value }))} required className={inputClass}>
            <option value="">Select constituency</option>
            {ASSEMBLY_CONSTITUENCIES.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </Field>
        <Field label="Division">
          <select value={draft.division} onChange={(event) => setDraft((current) => ({ ...current, division: event.target.value, mandal: "", village: "" }))} required className={inputClass}>
            <option value="">Select division</option>
            {divisionNames().map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </Field>
        <Field label="Mandal">
          <select value={draft.mandal} onChange={(event) => setDraft((current) => ({ ...current, mandal: event.target.value, village: "" }))} required className={inputClass}>
            <option value="">Select mandal</option>
            {withCurrent(mandalNames(draft.division), draft.mandal).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </Field>
        <Field label="Village">
          <select value={draft.village} onChange={(event) => setDraft((current) => ({ ...current, village: event.target.value }))} required className={inputClass}>
            <option value="">Select village</option>
            {withCurrent(villageNames(draft.division, draft.mandal), draft.village).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </Field>
        <Field label="Date given">
          <input type="date" value={draft.dateOfVisit} onChange={(event) => setDraft((current) => ({ ...current, dateOfVisit: event.target.value }))} required className={inputClass} />
        </Field>
      </div>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Notes</span>
        <textarea value={draft.detail} onChange={(event) => setDraft((current) => ({ ...current, detail: event.target.value }))} rows={3} className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <button disabled={saving} className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
          {saving ? "Saving…" : submitLabel || "Save benefit"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={saving} className="h-10 rounded-lg border bg-background px-4 text-sm font-medium hover:bg-muted disabled:opacity-60">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
