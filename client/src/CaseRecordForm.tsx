import { useRef, useState } from "react";
import { CheckCircle2, Loader2, Sparkles, Upload } from "lucide-react";
import { apiUpload } from "@/lib/api";
import {
  alignPlace,
  divisionForMandal,
  divisionNames,
  mandalNames,
  villageNames,
  withCurrent,
} from "@/places.ts";

export const OFFICIAL_SLIP_CATEGORIES = [
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
] as const;

export const ISSUE_CATEGORIES = [
  ...OFFICIAL_SLIP_CATEGORIES,
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

export type CaseSection =
  | "grievances"
  | "projects"
  | "people"
  | "campaigns"
  | "followups"
  | "schedules"
  | "visits"
  | "events";

const SAVE_LABEL: Record<CaseSection, string> = {
  grievances: "Save grievance",
  projects: "Save project",
  people: "Save constituency record",
  campaigns: "Save campaign",
  followups: "Save follow up",
  schedules: "Save schedule",
  visits: "Save visit",
  events: "Save benefit",
};

export type Draft = {
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
  issueDetail?: string;
  actionTaken: string;
  actionToBeTaken: string;
  assignedOfficer: string;
  assignedOfficerPhone?: string;
  resolutionStatus: string;
  deadline: string;
  designation: string;
  followUpKind: string;
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
  dateOfVisit: new Date().toISOString().slice(0, 10),
  referenceName: "",
  referenceNumber: "",
  categories: [],
  others: "",
  issueDetail: "",
  actionTaken: "",
  actionToBeTaken: "",
  assignedOfficer: "",
  assignedOfficerPhone: "",
  resolutionStatus: "Pending",
  deadline: "",
  designation: "",
  followUpKind: "pending",
});

const inputClass =
  "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";
const slipInputClass =
  "h-9 w-full rounded-md border bg-background px-3 text-xs sm:text-sm outline-none transition-colors focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

function Field({
  label,
  optional,
  children,
}: {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
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
  return (
    <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-primary">
      {children}
    </h3>
  );
}

function SlipField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
      <span className="text-xs font-bold uppercase tracking-wider text-foreground sm:w-44 shrink-0">
        {label} :
        {required && <span className="text-destructive"> *</span>}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

export function CaseRecordForm({
  section,
  initial,
  submitLabel,
  token,
  onSubmit,
  onCancel,
  className,
}: {
  section: CaseSection;
  initial?: Partial<Draft>;
  submitLabel?: string;
  token?: string;
  onSubmit: (body: Record<string, string | string[]>) => Promise<void>;
  onCancel?: () => void;
  className?: string;
}) {
  const located =
    section === "grievances" ||
    section === "projects" ||
    section === "followups";
  const [draft, setDraft] = useState<Draft>(() => {
    const base = {
      ...empty(),
      ...initial,
      categories: initial?.categories ?? [],
    };
    if (
      section === "grievances" ||
      section === "projects" ||
      section === "followups"
    ) {
      const place = alignPlace(base);
      base.division = place.division;
      base.mandal = place.mandal;
      base.village = place.village;
    }
    return base;
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);

  const handleScanFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (scanInputRef.current) scanInputRef.current.value = "";
    setScanning(true);
    setScanNotice(null);
    setError("");
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await apiUpload<{
        filename: string;
        extractedText: string;
        structuredData: Record<string, string>;
      }>("/api/workspace/documents/scan-preview", formData, token);

      const d = res.structuredData || {};
      setDraft((current) => {
        const matchedCategories = OFFICIAL_SLIP_CATEGORIES.filter(
          (c) =>
            d.category &&
            (d.category.toLowerCase().includes(c.toLowerCase()) ||
              c.toLowerCase().includes(d.category.toLowerCase())),
        );
        const nextCategories = matchedCategories.length
          ? matchedCategories
          : current.categories.length
            ? current.categories
            : ["Public Grievance"];
        return {
          ...current,
          srNumber: d.srNumber || current.srNumber,
          fullName: d.applicantName || current.fullName,
          contactNumber: d.contactNumber || current.contactNumber,
          address: d.address || current.address,
          email: d.email || current.email,
          village: d.village || current.village,
          mandal: d.mandal || current.mandal,
          division: d.division || current.division,
          assemblyConstituency:
            d.assemblyConstituency || current.assemblyConstituency,
          referenceName: d.referenceName || current.referenceName,
          referenceNumber: d.referenceNumber || current.referenceNumber,
          dateOfVisit: d.date || current.dateOfVisit,
          assignedOfficer: d.assignedOfficer || current.assignedOfficer,
          assignedOfficerPhone:
            d.assignedOfficerPhone || current.assignedOfficerPhone,
          actionTaken: d.actionTaken || current.actionTaken,
          actionToBeTaken: d.actionRequested || current.actionToBeTaken,
          resolutionStatus: d.resolutionStatus || current.resolutionStatus,
          deadline: d.deadline || current.deadline,
          categories: nextCategories,
          others: d.others || current.others,
          issueDetail: d.issueSummary || current.issueDetail,
        };
      });
      setScanNotice(`Scanned "${res.filename}" with Grok AI! Form fields auto-filled below.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Document scan failed.");
    } finally {
      setScanning(false);
    }
  };

  const set = (key: keyof Draft) => (
    event: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) => {
    setDraft((current) => ({ ...current, [key]: event.target.value }));
  };

  const toggleCategory = (category: string) => {
    setDraft((current) => {
      const categories = current.categories.includes(category)
        ? current.categories.filter((item) => item !== category)
        : [...current.categories, category];
      return { ...current, categories };
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (section === "grievances") {
      if (!draft.categories.length && !draft.others) {
        setError("Choose at least one category or specify in Others.");
        return;
      }
    } else {
      if (!draft.categories.length) {
        setError("Choose at least one category.");
        return;
      }
    }
    setError("");
    setSaving(true);
    try {
      const derivedDivision =
        draft.division || divisionForMandal(draft.mandal) || "Narasaraopet";
      await onSubmit({
        ...draft,
        division: derivedDivision,
        title: draft.fullName,
        status: draft.resolutionStatus || "Pending",
        categories: draft.categories.length
          ? draft.categories
          : ["Public Grievance"],
        others: draft.others || "",
        issueDetail: draft.issueDetail || "",
        detail: draft.issueDetail || draft.others || "",
        actionTaken: draft.actionTaken || "Forwarded to department",
        actionToBeTaken: draft.actionToBeTaken || "Verify and resolve",
        assignedOfficer: draft.assignedOfficer || "Tahsildar / RDO",
        assignedOfficerPhone: draft.assignedOfficerPhone || "",
        resolutionStatus: draft.resolutionStatus || "Pending",
        deadline:
          draft.deadline ||
          new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      });
      if (!initial) setDraft(empty());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // If section is grievances, render the exact official MP visitor slip layout
  if (section === "grievances") {
    return (
      <form
        onSubmit={(event) => void submit(event)}
        className={className || "mb-6 space-y-6 rounded-2xl border-2 border-border/80 bg-card p-5 sm:p-7 shadow-sm"}
      >
        {token && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-semibold text-foreground">
                  Auto-fill from Grievance Document (Grok AI)
                </span>
              </div>
              <div>
                <input
                  ref={scanInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,image/jpeg,image/png,application/pdf"
                  className="hidden"
                  onChange={handleScanFile}
                  disabled={scanning}
                />
                <button
                  type="button"
                  disabled={scanning}
                  onClick={() => scanInputRef.current?.click()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {scanning ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Scanning with Grok AI…
                    </>
                  ) : (
                    <>
                      <Upload className="size-3.5" />
                      Upload & Auto-fill Form
                    </>
                  )}
                </button>
              </div>
            </div>
            {scanNotice && (
              <div className="mt-2 flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5" />
                {scanNotice}
              </div>
            )}
          </div>
        )}

        {/* OFFICIAL MP HEADER */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-5">
          <div className="flex items-center gap-3.5">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 font-display font-black text-white text-xl shadow-sm border-2 border-amber-300">
              LSK
            </div>
            <div>
              <h1 className="font-display text-base sm:text-xl font-black tracking-wide text-amber-600 dark:text-amber-400 uppercase">
                LAVU SRI KRISHNA DEVARAYALU
              </h1>
              <p className="text-xs font-bold text-foreground/90 uppercase tracking-wider">
                MEMBER OF PARLIAMENT (LS) 14-NARASARAOPET CONSTITUENCY-A.P.
              </p>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                FLOOR LEADER, TELUGU DESAM PARLIAMENTARY PARTY
              </p>
            </div>
          </div>

          {/* SR. NUMBER */}
          <div className="flex items-center gap-2 self-end sm:self-auto bg-muted/40 px-3 py-1.5 rounded-xl border">
            <span className="text-xs sm:text-sm font-black tracking-wider uppercase text-foreground whitespace-nowrap">
              SR. NUMBER :
            </span>
            <input
              value={draft.srNumber}
              onChange={set("srNumber")}
              className="h-9 w-28 rounded-md border bg-background px-2.5 font-mono font-bold text-sm outline-none focus:ring-2 focus:ring-amber-500"
              placeholder="e.g. 00173"
            />
          </div>
        </div>

        {/* 1. VISITOR INFORMATION */}
        <div className="overflow-hidden rounded-xl border">
          <div className="bg-black px-4 py-2.5 text-amber-400 font-black text-xs sm:text-sm uppercase tracking-wider">
            VISITOR INFORMATION
          </div>

          <div className="p-4 bg-card grid gap-4 md:grid-cols-2">
            {/* LEFT COLUMN */}
            <div className="space-y-3.5">
              <SlipField label="FULL NAME" required>
                <input
                  value={draft.fullName}
                  onChange={set("fullName")}
                  required
                  className={slipInputClass}
                  placeholder="Enter full name"
                />
              </SlipField>

              <SlipField label="ADDRESS">
                <input
                  value={draft.address}
                  onChange={set("address")}
                  className={slipInputClass}
                  placeholder="Enter house no., street, area"
                />
              </SlipField>

              <SlipField label="VILLAGE">
                <input
                  value={draft.village}
                  onChange={set("village")}
                  className={slipInputClass}
                  placeholder="Enter village"
                />
              </SlipField>

              <SlipField label="ASSEMBLY CONSTITUENCY">
                <select
                  value={draft.assemblyConstituency}
                  onChange={set("assemblyConstituency")}
                  className={slipInputClass}
                >
                  <option value="">Select Constituency</option>
                  {ASSEMBLY_CONSTITUENCIES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </SlipField>

              <SlipField label="REFERENCE NAME">
                <input
                  value={draft.referenceName}
                  onChange={set("referenceName")}
                  className={slipInputClass}
                  placeholder="Enter reference name"
                />
              </SlipField>
            </div>

            {/* RIGHT COLUMN */}
            <div className="space-y-3.5">
              <SlipField label="CONTACT NUMBER" required>
                <input
                  value={draft.contactNumber}
                  onChange={set("contactNumber")}
                  required
                  inputMode="tel"
                  className={slipInputClass}
                  placeholder="10-digit mobile number"
                />
              </SlipField>

              <SlipField label="EMAIL">
                <input
                  type="email"
                  value={draft.email}
                  onChange={set("email")}
                  className={slipInputClass}
                  placeholder="Enter email address"
                />
              </SlipField>

              <SlipField label="MANDAL">
                <input
                  value={draft.mandal}
                  onChange={set("mandal")}
                  className={slipInputClass}
                  placeholder="Enter mandal"
                />
              </SlipField>

              <SlipField label="DATE OF VISIT">
                <input
                  type="date"
                  value={draft.dateOfVisit}
                  onChange={set("dateOfVisit")}
                  className={slipInputClass}
                />
              </SlipField>

              <SlipField label="REFERENCE NUMBER">
                <input
                  value={draft.referenceNumber}
                  onChange={set("referenceNumber")}
                  className={slipInputClass}
                  placeholder="Enter reference number"
                />
              </SlipField>
            </div>
          </div>
        </div>

        {/* 2. ISSUE DESCRIPTION */}
        <div className="overflow-hidden rounded-xl border">
          <div className="bg-black px-4 py-2.5 text-amber-400 font-black text-xs sm:text-sm uppercase tracking-wider">
            ISSUE DESCRIPTION
          </div>

          <div className="p-4 bg-card space-y-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                CATEGORY (check all that apply)
              </p>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                {OFFICIAL_SLIP_CATEGORIES.map((cat) => {
                  const checked = draft.categories.includes(cat);
                  return (
                    <label
                      key={cat}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-xs transition-colors ${
                        checked
                          ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-bold"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCategory(cat)}
                        className="size-4 rounded text-amber-600 focus:ring-amber-500"
                      />
                      <span>{cat}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-2 border-t">
              <span className="text-xs font-bold text-foreground uppercase tracking-wider whitespace-nowrap sm:w-24 shrink-0">
                Others :
              </span>
              <input
                value={draft.others}
                onChange={set("others")}
                className={slipInputClass}
                placeholder="Specify other issue category"
              />
            </div>

            <div className="pt-2">
              <label className="block">
                <span className="text-xs font-bold text-foreground uppercase tracking-wider mb-1.5 block">
                  Representation / Detailed Grievance Description
                </span>
                <textarea
                  value={draft.issueDetail}
                  onChange={set("issueDetail")}
                  rows={5}
                  className="w-full rounded-xl border bg-background px-3.5 py-3 text-sm outline-none transition-colors focus:border-amber-500 focus:ring-1 focus:ring-amber-500 leading-relaxed"
                  placeholder="Enter detailed grievance representation / description submitted by citizen..."
                />
              </label>
            </div>
          </div>
        </div>

        {/* 3. ACTION DETAILS */}
        <div className="overflow-hidden rounded-xl border">
          <div className="bg-black px-4 py-2.5 text-amber-400 font-black text-xs sm:text-sm uppercase tracking-wider">
            ACTION DETAILS
          </div>

          <div className="p-4 bg-card space-y-4">
            <SlipField label="ACTION TAKEN">
              <input
                value={draft.actionTaken}
                onChange={set("actionTaken")}
                className={slipInputClass}
                placeholder="Details of action taken"
              />
            </SlipField>

            <SlipField label="ACTION TO BE TAKEN">
              <input
                value={draft.actionToBeTaken}
                onChange={set("actionToBeTaken")}
                className={slipInputClass}
                placeholder="Details of action to be taken"
              />
            </SlipField>

            <div className="grid gap-3 sm:grid-cols-12 items-center">
              <div className="sm:col-span-8">
                <SlipField label="ASSIGNED OFFICER">
                  <input
                    value={draft.assignedOfficer}
                    onChange={set("assignedOfficer")}
                    className={slipInputClass}
                    placeholder="Assigned officer / department"
                  />
                </SlipField>
              </div>
              <div className="sm:col-span-4">
                <input
                  value={draft.assignedOfficerPhone}
                  onChange={set("assignedOfficerPhone")}
                  inputMode="tel"
                  className={slipInputClass}
                  placeholder="Officer phone number"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t">
              <div className="flex flex-wrap items-center gap-4">
                <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                  RESOLUTION STATUS :
                </span>
                <div className="flex items-center gap-3">
                  {RESOLUTION_STATUSES.map((status) => {
                    const checked =
                      draft.resolutionStatus.toLowerCase() ===
                      status.toLowerCase();
                    return (
                      <label
                        key={status}
                        className={`flex items-center gap-1.5 text-xs font-bold uppercase cursor-pointer px-2 py-1 rounded-md transition-colors ${
                          checked
                            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <input
                          type="radio"
                          name="resolutionStatus"
                          value={status}
                          checked={checked}
                          onChange={() =>
                            setDraft((curr) => ({
                              ...curr,
                              resolutionStatus: status,
                            }))
                          }
                          className="size-4 text-amber-600 focus:ring-amber-500"
                        />
                        <span>{status}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-foreground uppercase tracking-wider whitespace-nowrap">
                  DEADLINE :
                </span>
                <input
                  type="date"
                  value={draft.deadline}
                  onChange={set("deadline")}
                  className="h-9 rounded-md border bg-background px-3 text-xs sm:text-sm outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center justify-end gap-3 pt-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="h-10 rounded-xl border bg-background hover:bg-muted px-5 text-sm font-semibold transition-colors disabled:opacity-60"
            >
              Cancel
            </button>
          )}
          <button
            disabled={saving}
            className="h-10 rounded-xl bg-amber-600 hover:bg-amber-700 px-6 text-sm font-bold text-white shadow-sm transition-colors disabled:opacity-60"
          >
            {saving ? "Saving…" : submitLabel || SAVE_LABEL[section]}
          </button>
        </div>
      </form>
    );
  }

  // Generic form layout for projects, people, campaigns, schedules, etc.
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className={className || "mb-6 space-y-6 rounded-xl border bg-card p-5"}
    >
      <SectionTitle>Record information</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title / Name">
          <input
            value={draft.fullName}
            onChange={set("fullName")}
            required
            autoFocus
            className={inputClass}
          />
        </Field>
        <Field label="Contact number">
          <input
            value={draft.contactNumber}
            onChange={set("contactNumber")}
            required
            inputMode="tel"
            pattern="(\+?91[\s-]?)?\d{10}"
            title="10-digit contact number"
            className={inputClass}
          />
        </Field>
        {section === "followups" && (
          <>
            <Field label="Designation">
              <input
                value={draft.designation}
                onChange={set("designation")}
                required
                placeholder="Sarpanch, teacher, party worker"
                className={inputClass}
              />
            </Field>
            <Field label="Follow-up group">
              <select
                value={draft.followUpKind}
                onChange={set("followUpKind")}
                required
                className={inputClass}
              >
                <option value="frequent">Frequently contacted</option>
                <option value="recent">Recently contacted</option>
                <option value="pending">Not followed up</option>
              </select>
            </Field>
          </>
        )}
        <Field label="Email" optional>
          <input
            type="email"
            value={draft.email}
            onChange={set("email")}
            className={inputClass}
          />
        </Field>
        <Field label="Address" optional>
          <input
            value={draft.address}
            onChange={set("address")}
            className={inputClass}
          />
        </Field>
        {located ? (
          <>
            <Field label="Division">
              <select
                value={draft.division}
                required
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    division: event.target.value,
                    mandal: "",
                    village: "",
                  }))
                }
                className={inputClass}
              >
                <option value="">Select division</option>
                {divisionNames().map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Mandal">
              <select
                value={draft.mandal}
                required
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    mandal: event.target.value,
                    village: "",
                  }))
                }
                className={inputClass}
              >
                <option value="">Select mandal</option>
                {withCurrent(
                  mandalNames(draft.division),
                  draft.mandal,
                ).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
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
                {withCurrent(
                  villageNames(draft.division, draft.mandal),
                  draft.village,
                ).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : (
          <>
            <Field label="Village" optional>
              <input
                value={draft.village}
                onChange={set("village")}
                className={inputClass}
              />
            </Field>
            <Field label="Mandal" optional>
              <input
                value={draft.mandal}
                onChange={set("mandal")}
                className={inputClass}
              />
            </Field>
          </>
        )}
        <Field label="Assembly constituency">
          <select
            value={draft.assemblyConstituency}
            onChange={set("assemblyConstituency")}
            required
            className={inputClass}
          >
            <option value="">Select constituency</option>
            {ASSEMBLY_CONSTITUENCIES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date" optional>
          <input
            type="date"
            value={draft.dateOfVisit}
            onChange={set("dateOfVisit")}
            className={inputClass}
          />
        </Field>
      </div>

      <SectionTitle>Details & Status</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Assigned officer / lead" optional>
          <input
            value={draft.assignedOfficer}
            onChange={set("assignedOfficer")}
            className={inputClass}
          />
        </Field>
        <Field label="Status">
          <select
            value={draft.resolutionStatus}
            onChange={set("resolutionStatus")}
            required
            className={inputClass}
          >
            <option value="">Select status</option>
            {RESOLUTION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description / Summary">
            <textarea
              value={draft.issueDetail}
              onChange={set("issueDetail")}
              rows={3}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          disabled={saving}
          className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {saving ? "Saving…" : submitLabel || SAVE_LABEL[section]}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="h-10 rounded-lg border bg-background px-4 text-sm font-medium hover:bg-muted disabled:opacity-60"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
