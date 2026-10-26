import { useState } from "react";
import { alignPlace, divisionNames, mandalNames, villageNames, withCurrent } from "@/places.ts";

export const ISSUE_CATEGORIES = [
  "CMRF / Medical Assistance",
  "Recommendation / Request Letter",
  "Banking & Financial Issues",
  "Irrigation & Water Resources",
  "Agriculture",
  "Party / Organizational Matter",
  "TTD Recommendation Letter",
  "MPLADS",
  "Roads & Infrastructure",
  "Housing",
  "Police / Law & Order",
  "Nominated Posts",
  "Education / Fee Concession",
  "Employee Transfer",
  "Electricity",
  "Revenue & Land Issues",
  "Pension & Social Welfare",
  "Public Grievance",
  "Others",
] as const;

export const ASSEMBLY_CONSTITUENCIES = [
  "Pedakurapadu",
  "Chilakaluripet",
  "Narasaraopet",
  "Sattenapalle",
  "Vinukonda",
  "Gurazala",
  "Macherla",
] as const;

export const RESOLUTION_STATUSES = ["Pending", "In progress", "Resolved"] as const;

export type CaseSection = "grievances" | "projects" | "people" | "campaigns" | "followups" | "schedules" | "visits";

const SAVE_LABEL: Record<CaseSection, string> = {
  grievances: "Save grievance",
  projects: "Save project",
  people: "Save constituency record",
  campaigns: "Save campaign",
  followups: "Save follow up",
  schedules: "Save schedule",
  visits: "Save visit",
};

type Draft = {
  srNumber: string;
  fullName: string;
  contactNumber: string;
  address: string;
  email: string;
  village: string;
  mandal: string;
  division: string;
  assemblyConstituency: string;
  dateOfVisit: string;
  referenceName: string;
  referenceNumber: string;
  categories: string[];
  others: string;
  actionTaken: string;
  actionToBeTaken: string;
  assignedOfficer: string;
  resolutionStatus: string;
  deadline: string;
};

const empty = (): Draft => ({
  srNumber: "",
  fullName: "",
  contactNumber: "",
  address: "",
  email: "",
  village: "",
  mandal: "",
  division: "",
  assemblyConstituency: "",
  dateOfVisit: "",
  referenceName: "",
  referenceNumber: "",
  categories: [],
  others: "",
  actionTaken: "",
  actionToBeTaken: "",
  assignedOfficer: "",
  resolutionStatus: "",
  deadline: "",
});

const inputClass = "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium">
        {label}
        {optional ? null : <span className="text-destructive"> *</span>}
      </span>
      {children}
    </label>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-primary">{children}</h3>;
}

export function CaseRecordForm({
  section,
  initial,
  submitLabel,
  onSubmit,
}: {
  section: CaseSection;
  initial?: Partial<Draft>;
  submitLabel?: string;
  onSubmit: (body: Record<string, string | string[]>) => Promise<void>;
}) {
  const located = section === "grievances" || section === "projects";
  const [draft, setDraft] = useState<Draft>(() => {
    const base = { ...empty(), ...initial, categories: initial?.categories ?? [] };
    if (section === "grievances" || section === "projects") {
      const place = alignPlace(base);
      base.division = place.division;
      base.mandal = place.mandal;
      base.village = place.village;
    }
    return base;
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const othersChecked = draft.categories.includes("Others");

  const set = (key: keyof Draft) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setDraft((current) => ({ ...current, [key]: event.target.value }));
  };

  const toggleCategory = (category: string) => {
    setDraft((current) => {
      const categories = current.categories.includes(category)
        ? current.categories.filter((item) => item !== category)
        : [...current.categories, category];
      return { ...current, categories, others: categories.includes("Others") ? current.others : "" };
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.categories.length) {
      setError("Choose at least one category.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSubmit({
        ...draft,
        title: draft.fullName,
        status: draft.resolutionStatus,
        categories: draft.categories,
        others: othersChecked ? draft.others : "",
      });
      if (!initial) setDraft(empty());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="mb-6 space-y-6 rounded-xl border bg-card p-5">
      <SectionTitle>Visitor information</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Sr. number">
          <input value={draft.srNumber} onChange={set("srNumber")} required className={inputClass} />
        </Field>
        <Field label="Full name">
          <input value={draft.fullName} onChange={set("fullName")} required autoFocus className={inputClass} />
        </Field>
        <Field label="Contact number">
          <input value={draft.contactNumber} onChange={set("contactNumber")} required inputMode="tel" pattern="(\+?91[\s-]?)?\d{10}" title="10-digit contact number" className={inputClass} />
        </Field>
        <Field label="Email">
          <input type="email" value={draft.email} onChange={set("email")} required className={inputClass} />
        </Field>
        <Field label="Address">
          <input value={draft.address} onChange={set("address")} required className={inputClass} />
        </Field>
        {located ? (
          <>
            <Field label="Division">
              <select
                value={draft.division}
                required
                onChange={(event) => setDraft((current) => ({ ...current, division: event.target.value, mandal: "", village: "" }))}
                className={inputClass}
              >
                <option value="">Select division</option>
                {divisionNames().map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </Field>
            <Field label="Mandal">
              <select
                value={draft.mandal}
                required
                onChange={(event) => setDraft((current) => ({ ...current, mandal: event.target.value, village: "" }))}
                className={inputClass}
              >
                <option value="">Select mandal</option>
                {withCurrent(mandalNames(draft.division), draft.mandal).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </Field>
            <Field label="Village">
              <select
                value={draft.village}
                required
                onChange={set("village")}
                className={inputClass}
              >
                <option value="">Select village</option>
                {withCurrent(villageNames(draft.division, draft.mandal), draft.village).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </Field>
          </>
        ) : (
          <>
            <Field label="Village">
              <input value={draft.village} onChange={set("village")} required className={inputClass} />
            </Field>
            <Field label="Mandal">
              <input value={draft.mandal} onChange={set("mandal")} required className={inputClass} />
            </Field>
          </>
        )}
        <Field label="Assembly constituency">
          <select value={draft.assemblyConstituency} onChange={set("assemblyConstituency")} required className={inputClass}>
            <option value="">Select constituency</option>
            {ASSEMBLY_CONSTITUENCIES.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </Field>
        <Field label="Date of visit" optional>
          <input type="date" value={draft.dateOfVisit} onChange={set("dateOfVisit")} className={inputClass} />
        </Field>
        <Field label="Reference name" optional>
          <input value={draft.referenceName} onChange={set("referenceName")} className={inputClass} />
        </Field>
        <Field label="Reference number" optional>
          <input value={draft.referenceNumber} onChange={set("referenceNumber")} className={inputClass} />
        </Field>
      </div>

      <SectionTitle>Issue description</SectionTitle>
      <fieldset>
        <legend className="mb-3 text-sm font-medium">
          Category
          <span className="text-destructive"> *</span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ISSUE_CATEGORIES.map((category) => (
            <label key={category} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.categories.includes(category)}
                onChange={() => toggleCategory(category)}
                className="mt-0.5"
              />
              <span>{category}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {othersChecked && (
        <Field label="Others">
          <input value={draft.others} onChange={set("others")} required className={inputClass} />
        </Field>
      )}

      <SectionTitle>Action details</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Action taken">
          <textarea value={draft.actionTaken} onChange={set("actionTaken")} required rows={2} className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </Field>
        <Field label="Action to be taken">
          <textarea value={draft.actionToBeTaken} onChange={set("actionToBeTaken")} required rows={2} className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </Field>
        <Field label="Assigned officer">
          <input value={draft.assignedOfficer} onChange={set("assignedOfficer")} required className={inputClass} />
        </Field>
        <Field label="Resolution status">
          <select value={draft.resolutionStatus} onChange={set("resolutionStatus")} required className={inputClass}>
            <option value="">Select status</option>
            {RESOLUTION_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </Field>
        <Field label="Deadline">
          <input type="date" value={draft.deadline} onChange={set("deadline")} required className={inputClass} />
        </Field>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <button disabled={saving} className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
        {saving ? "Saving…" : submitLabel || SAVE_LABEL[section]}
      </button>
    </form>
  );
}
