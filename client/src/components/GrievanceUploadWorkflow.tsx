import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api, apiUpload } from "@/lib/api";
import { apiUrl } from "@/lib/apiBase";
import {
  alignPlace,
  mandalNames,
  PLACES,
  villageNames,
  withCurrent,
} from "@/places";
import {
  ASSEMBLY_CONSTITUENCIES,
  RESOLUTION_STATUSES,
} from "@/CaseRecordForm";

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

export type GrievanceDraft = {
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
  issueDetail: string;
  actionTaken: string;
  actionToBeTaken: string;
  assignedOfficer: string;
  assignedOfficerPhone: string;
  resolutionStatus: string;
  deadline: string;
};

export interface StoredGrievanceResult {
  id: string;
  srNumber?: string;
  fullName?: string;
  title?: string;
  contactNumber?: string;
  division?: string;
  mandal?: string;
  village?: string;
  assemblyConstituency?: string;
  status?: string;
  progressToken?: string;
  categories?: string[];
  documentsCount?: number;
}

interface Props {
  token: string;
  onSuccess?: (stored: StoredGrievanceResult) => void;
  onCancel?: () => void;
}

type WorkflowStep = "upload" | "digitizing" | "review" | "storing" | "success";

function formatBytes(bytes: number): string {
  if (bytes <= 0 || Number.isNaN(bytes)) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

const emptyDraft = (): GrievanceDraft => {
  const today = new Date().toISOString().split("T")[0];
  const autoSr = `00${Math.floor(100 + Math.random() * 900)}`;
  return {
    srNumber: autoSr,
    fullName: "",
    contactNumber: "",
    address: "",
    email: "",
    village: "",
    mandal: "",
    division: "",
    assemblyConstituency: "",
    dateOfVisit: today,
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
  };
};

export function GrievanceUploadWorkflow({ token, onSuccess, onCancel }: Props) {
  const [step, setStep] = useState<WorkflowStep>("upload");

  // Two Upload Sections
  const [grievanceFile, setGrievanceFile] = useState<File | null>(null);
  const [supportingFile, setSupportingFile] = useState<File | null>(null);

  const [grievancePreviewUrl, setGrievancePreviewUrl] = useState<string | null>(null);
  const [supportingPreviewUrl, setSupportingPreviewUrl] = useState<string | null>(null);

  // File Inputs
  const grievanceInputRef = useRef<HTMLInputElement | null>(null);
  const supportingInputRef = useRef<HTMLInputElement | null>(null);

  // Drag states
  const [isGrievanceDragging, setIsGrievanceDragging] = useState(false);
  const [isSupportingDragging, setIsSupportingDragging] = useState(false);

  // Active preview modal
  const [viewingFile, setViewingFile] = useState<{ url: string; name: string; isPdf: boolean } | null>(null);

  // Extracted Scan Data
  const [extractedGrievanceDoc, setExtractedGrievanceDoc] = useState<{
    filename: string;
    extractedText: string;
    structuredData?: Record<string, string>;
  } | null>(null);
  const [extractedSupportingDoc, setExtractedSupportingDoc] = useState<{
    filename: string;
    extractedText: string;
    structuredData?: Record<string, string>;
  } | null>(null);

  // Form State
  const [draft, setDraft] = useState<GrievanceDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [digitizeProgress, setDigitizeProgress] = useState(10);
  const [digitizeStatusText, setDigitizeStatusText] = useState("Preparing documents...");
  const [activeInspectorTab, setActiveInspectorTab] = useState<"doc1" | "doc2">("doc1");
  const [showDocInspector, setShowDocInspector] = useState(true);
  const [copiedText, setCopiedText] = useState(false);

  // Success result
  const [storedResult, setStoredResult] = useState<StoredGrievanceResult | null>(null);

  // Clean up object URLs
  useEffect(() => {
    return () => {
      if (grievancePreviewUrl) URL.revokeObjectURL(grievancePreviewUrl);
      if (supportingPreviewUrl) URL.revokeObjectURL(supportingPreviewUrl);
    };
  }, [grievancePreviewUrl, supportingPreviewUrl]);

  const handleSelectGrievanceFile = (file: File) => {
    setError(null);
    if (!validateFile(file)) return;
    if (grievancePreviewUrl) URL.revokeObjectURL(grievancePreviewUrl);

    setGrievanceFile(file);
    if (file.type.startsWith("image/")) {
      setGrievancePreviewUrl(URL.createObjectURL(file));
    } else {
      setGrievancePreviewUrl(null);
    }
  };

  const handleSelectSupportingFile = (file: File) => {
    setError(null);
    if (!validateFile(file)) return;
    if (supportingPreviewUrl) URL.revokeObjectURL(supportingPreviewUrl);

    setSupportingFile(file);
    if (file.type.startsWith("image/")) {
      setSupportingPreviewUrl(URL.createObjectURL(file));
    } else {
      setSupportingPreviewUrl(null);
    }
  };

  const validateFile = (file: File): boolean => {
    const validExtensions = /\.(pdf|jpe?g|png)$/i;
    const validMimes = [
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
    ];
    if (!validExtensions.test(file.name) && !validMimes.includes(file.type.toLowerCase())) {
      setError(`Unsupported file format for "${file.name}". Please upload a PDF, JPG, JPEG, or PNG file.`);
      return false;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(`File "${file.name}" exceeds 10MB limit. Please upload a smaller document.`);
      return false;
    }
    return true;
  };

  const removeGrievanceFile = () => {
    if (grievancePreviewUrl) URL.revokeObjectURL(grievancePreviewUrl);
    setGrievanceFile(null);
    setGrievancePreviewUrl(null);
    if (grievanceInputRef.current) grievanceInputRef.current.value = "";
  };

  const removeSupportingFile = () => {
    if (supportingPreviewUrl) URL.revokeObjectURL(supportingPreviewUrl);
    setSupportingFile(null);
    setSupportingPreviewUrl(null);
    if (supportingInputRef.current) supportingInputRef.current.value = "";
  };

  // Step 2 Action: "Submit and Review"
  const handleDigitizeAndReview = async () => {
    if (!grievanceFile && !supportingFile) {
      setError("Please upload at least the Primary Grievance Document before reviewing.");
      return;
    }

    setError(null);
    setStep("digitizing");
    setDigitizeProgress(20);
    setDigitizeStatusText("Connecting to Grok AI OCR scanner...");

    try {
      const formData = new FormData();
      if (grievanceFile) formData.append("grievanceFile", grievanceFile);
      if (supportingFile) formData.append("supportingFile", supportingFile);

      setDigitizeProgress(45);
      setDigitizeStatusText("Scanning Telugu and English petition text with Grok AI...");

      let scanResult: {
        structuredData?: Record<string, string>;
        grievanceDoc?: { filename: string; extractedText: string; structuredData?: Record<string, string> };
        supportingDoc?: { filename: string; extractedText: string; structuredData?: Record<string, string> };
      } | null = null;

      try {
        scanResult = await apiUpload("/api/workspace/documents/scan-batch", formData, token);
      } catch (err: unknown) {
        if (grievanceFile) {
          const singleFormData = new FormData();
          singleFormData.append("file", grievanceFile);
          const singleRes = await apiUpload<{
            filename: string;
            extractedText: string;
            structuredData: Record<string, string>;
          }>("/api/workspace/documents/scan-preview", singleFormData, token);

          scanResult = {
            structuredData: singleRes.structuredData,
            grievanceDoc: {
              filename: singleRes.filename,
              extractedText: singleRes.extractedText,
              structuredData: singleRes.structuredData,
            },
          };
        } else {
          throw err;
        }
      }

      setDigitizeProgress(75);
      setDigitizeStatusText("Extracting visitor slip details and matching template fields...");

      if (scanResult?.grievanceDoc) {
        setExtractedGrievanceDoc(scanResult.grievanceDoc);
      }
      if (scanResult?.supportingDoc) {
        setExtractedSupportingDoc(scanResult.supportingDoc);
      }

      const d = scanResult?.structuredData || {};

      // Match Place / Hierarchy
      let detectedDivision = d.division || "";
      let detectedMandal = d.mandal || "";
      let detectedVillage = d.village || "";

      if (detectedMandal) {
        for (const div of PLACES) {
          const foundMandal = div.mandals.find(
            (m) => m.name.toLowerCase() === detectedMandal.toLowerCase() ||
                   detectedMandal.toLowerCase().includes(m.name.toLowerCase())
          );
          if (foundMandal) {
            detectedDivision = div.name;
            detectedMandal = foundMandal.name;
            if (detectedVillage) {
              const foundVillage = foundMandal.villages.find(
                (v) => v.toLowerCase() === detectedVillage.toLowerCase() ||
                       detectedVillage.toLowerCase().includes(v.toLowerCase())
              );
              if (foundVillage) detectedVillage = foundVillage;
            }
            break;
          }
        }
      }

      // Match Assembly Constituency
      let detectedConstituency = d.assemblyConstituency || "";
      if (detectedConstituency) {
        const foundConst = ASSEMBLY_CONSTITUENCIES.find(
          (c) => c.toLowerCase() === detectedConstituency.toLowerCase() ||
                 detectedConstituency.toLowerCase().includes(c.toLowerCase())
        );
        if (foundConst) detectedConstituency = foundConst;
      }

      // Match categories
      const matchedCategories = OFFICIAL_SLIP_CATEGORIES.filter((c) =>
        d.category && (
          d.category.toLowerCase().includes(c.toLowerCase()) ||
          c.toLowerCase().includes(d.category.toLowerCase())
        )
      );

      const visitDate = d.date || new Date().toISOString().split("T")[0];
      const targetDeadline = d.deadline || (() => {
        const dd = new Date(visitDate);
        dd.setDate(dd.getDate() + 14);
        return dd.toISOString().split("T")[0];
      })();

      // Auto-fill template draft with extracted and digitally converted data
      setDraft((current) => ({
        ...current,
        srNumber: d.srNumber || (d.referenceNumber && /^\d+$/.test(d.referenceNumber) ? d.referenceNumber : current.srNumber),
        fullName: d.applicantName || current.fullName,
        contactNumber: d.contactNumber || current.contactNumber,
        address: d.address || current.address,
        email: d.email || current.email,
        referenceName: d.referenceName || current.referenceName,
        referenceNumber: d.referenceNumber || current.referenceNumber,
        dateOfVisit: visitDate,
        division: detectedDivision || current.division,
        mandal: detectedMandal || current.mandal,
        village: detectedVillage || current.village,
        assemblyConstituency: detectedConstituency || current.assemblyConstituency,
        categories: matchedCategories.length ? matchedCategories : current.categories,
        others: d.others || current.others,
        issueDetail: d.issueSummary || current.issueDetail,
        actionTaken: d.actionTaken || current.actionTaken,
        actionToBeTaken: d.actionRequested || current.actionToBeTaken,
        assignedOfficer: d.assignedOfficer || current.assignedOfficer,
        assignedOfficerPhone: d.assignedOfficerPhone || current.assignedOfficerPhone,
        resolutionStatus: d.resolutionStatus || current.resolutionStatus,
        deadline: targetDeadline,
      }));

      setDigitizeProgress(100);
      setDigitizeStatusText("Digital conversion complete!");

      setTimeout(() => {
        setStep("review");
      }, 500);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Grok AI digitization failed. You can still fill the template manually."
      );
      setStep("review");
    }
  };

  const setDraftField = (key: keyof GrievanceDraft) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setDraft((curr) => ({ ...curr, [key]: event.target.value }));
  };

  const toggleCategory = (category: string) => {
    setDraft((current) => {
      const categories = current.categories.includes(category)
        ? current.categories.filter((item) => item !== category)
        : [...current.categories, category];
      return { ...current, categories };
    });
  };

  // Step 5: Final Submission to Database
  const handleFinalSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!draft.fullName.trim()) {
      setError("Please enter FULL NAME.");
      return;
    }
    if (!draft.contactNumber.trim()) {
      setError("Please enter CONTACT NUMBER.");
      return;
    }

    setError(null);
    setStep("storing");

    try {
      const cleanPhone = draft.contactNumber.replace(/[^0-9]/g, "");
      const visitDate = draft.dateOfVisit || new Date().toISOString().split("T")[0];
      const targetDeadline = draft.deadline || (() => {
        const d = new Date(visitDate);
        d.setDate(d.getDate() + 14);
        return d.toISOString().split("T")[0];
      })();

      // Auto-derive division from mandal if empty
      let finalDivision = draft.division;
      if (!finalDivision && draft.mandal) {
        for (const div of PLACES) {
          if (div.mandals.some(m => m.name.toLowerCase() === draft.mandal.toLowerCase())) {
            finalDivision = div.name;
            break;
          }
        }
      }
      if (!finalDivision) finalDivision = "Narasaraopet";

      const officerFormatted = draft.assignedOfficerPhone.trim()
        ? `${draft.assignedOfficer.trim()} (${draft.assignedOfficerPhone.trim()})`
        : draft.assignedOfficer.trim();

      const fullRepresentation = draft.issueDetail.trim() || draft.others.trim() || `${draft.fullName} - ${draft.categories.join(", ")}`;

      const payload = {
        section: "grievances",
        title: draft.fullName.trim(),
        fullName: draft.fullName.trim(),
        srNumber: draft.srNumber.trim() || `00${Math.floor(100 + Math.random() * 900)}`,
        contactNumber: cleanPhone || draft.contactNumber.trim(),
        address: draft.address.trim() || [draft.village, draft.mandal, "Palnadu"].filter(Boolean).join(", ") || "Palnadu",
        email: draft.email && draft.email.includes("@")
          ? draft.email.trim()
          : `${cleanPhone || "citizen"}@gmail.com`,
        village: draft.village.trim() || draft.mandal.trim() || "Palnadu",
        mandal: draft.mandal.trim() || "Narasaraopet",
        division: finalDivision,
        assemblyConstituency: (draft.assemblyConstituency.trim() || "Narasaraopet") as (typeof ASSEMBLY_CONSTITUENCIES)[number],
        dateOfVisit: visitDate,
        referenceName: draft.referenceName.trim() || undefined,
        referenceNumber: draft.referenceNumber.trim() || undefined,
        categories: draft.categories.length ? draft.categories : ["Public Grievance"],
        others: draft.others.trim() || undefined,
        detail: fullRepresentation,
        actionTaken: draft.actionTaken.trim() || "Issue verified and forwarded for action.",
        actionToBeTaken: draft.actionToBeTaken.trim() || "Review representation and take appropriate departmental action",
        assignedOfficer: officerFormatted || "Concerned Officer",
        resolutionStatus: (draft.resolutionStatus || "Pending") as (typeof RESOLUTION_STATUSES)[number],
        status: draft.resolutionStatus || "Pending",
        deadline: targetDeadline,
      };

      const record = await api<StoredGrievanceResult>("/api/workspace/records", {
        method: "POST",
        token,
        body: payload,
      });

      let attachedDocsCount = 0;

      if (grievanceFile && record.id) {
        try {
          const docFormData = new FormData();
          docFormData.append("file", grievanceFile);
          if (extractedGrievanceDoc?.extractedText) {
            docFormData.append("extractedText", extractedGrievanceDoc.extractedText);
          }
          if (extractedGrievanceDoc?.structuredData) {
            docFormData.append("structuredData", JSON.stringify(extractedGrievanceDoc.structuredData));
          }
          await apiUpload(`/api/workspace/records/${encodeURIComponent(record.id)}/documents`, docFormData, token);
          attachedDocsCount++;
        } catch (uploadErr) {
          console.warn("Failed to attach grievance file to record:", uploadErr);
        }
      }

      if (supportingFile && record.id) {
        try {
          const docFormData = new FormData();
          docFormData.append("file", supportingFile);
          if (extractedSupportingDoc?.extractedText) {
            docFormData.append("extractedText", extractedSupportingDoc.extractedText);
          }
          if (extractedSupportingDoc?.structuredData) {
            docFormData.append("structuredData", JSON.stringify(extractedSupportingDoc.structuredData));
          }
          await apiUpload(`/api/workspace/records/${encodeURIComponent(record.id)}/documents`, docFormData, token);
          attachedDocsCount++;
        } catch (uploadErr) {
          console.warn("Failed to attach supporting file to record:", uploadErr);
        }
      }

      const finalResult: StoredGrievanceResult = {
        ...record,
        documentsCount: attachedDocsCount,
      };

      setStoredResult(finalResult);
      setStep("success");
      if (onSuccess) onSuccess(finalResult);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to store grievance in the database.");
      setStep("review");
    }
  };

  const handleReset = () => {
    removeGrievanceFile();
    removeSupportingFile();
    setExtractedGrievanceDoc(null);
    setExtractedSupportingDoc(null);
    setDraft(emptyDraft());
    setError(null);
    setStoredResult(null);
    setStep("upload");
  };

  const copyExtractedText = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  const slipInputClass =
    "h-9 w-full rounded-md border border-border/80 bg-background px-3 text-sm outline-none transition-colors focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  return (
    <div className="w-full">
      {/* Top Banner Notice */}
      <div className="mb-6 rounded-2xl border bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-amber-500 text-xs font-black text-white shadow-xs">
                LSK
              </span>
              <p className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Lavu Sri Krishna Devarayalu • 14-Narasaraopet Constituency
              </p>
            </div>
            <h1 className="mt-1 font-display text-2xl font-black tracking-tight text-foreground md:text-3xl">
              Grievance Visitor Record Portal
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Official MP visitor slip format. Upload grievance documents, let Grok AI digitize all fields into the visitor template, edit any details, and store securely.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-medium">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${
                step === "upload" || step === "digitizing"
                  ? "bg-amber-500 text-white font-bold"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              1. Upload Documents
            </span>
            <ChevronArrow />
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${
                step === "review" || step === "storing"
                  ? "bg-amber-500 text-white font-bold"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              2. Review & Edit Slip
            </span>
            <ChevronArrow />
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${
                step === "success"
                  ? "bg-emerald-600 text-white font-bold"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              3. Submitted
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold">Notice</p>
            <p>{error}</p>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-destructive hover:opacity-75"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* STEP 1: TWO UPLOAD SECTIONS */}
      {step === "upload" && (
        <div className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* UPLOAD SECTION 1: Grievance Petition / Letter */}
            <div className="flex flex-col rounded-2xl border bg-card p-5 shadow-xs transition-all hover:border-amber-500/50">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
                    <FileText className="size-4.5" />
                  </div>
                  <div>
                    <h2 className="font-display text-base font-bold text-foreground">
                      1. Grievance Petition / Letter
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Primary citizen representation, handwritten petition, or grievance slip
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-400">
                  Required
                </span>
              </div>

              {grievanceFile ? (
                <div className="mt-2 flex flex-1 flex-col justify-between rounded-xl border bg-muted/30 p-4">
                  <div className="flex items-start gap-3">
                    {grievancePreviewUrl ? (
                      <img
                        src={grievancePreviewUrl}
                        alt="Grievance Preview"
                        className="size-16 shrink-0 rounded-lg border object-cover shadow-xs"
                      />
                    ) : (
                      <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-600">
                        <FileText className="size-8" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">
                        {grievanceFile.name}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatBytes(grievanceFile.size)} • {grievanceFile.type || "Document"}
                      </p>
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                        <FileCheck className="size-3" /> Ready for AI Scan
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-2 border-t pt-3">
                    <button
                      type="button"
                      onClick={() => {
                        const url = grievancePreviewUrl || URL.createObjectURL(grievanceFile);
                        setViewingFile({
                          url,
                          name: grievanceFile.name,
                          isPdf: grievanceFile.type === "application/pdf" || grievanceFile.name.endsWith(".pdf"),
                        });
                      }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-3 text-xs font-medium hover:bg-muted"
                    >
                      <Eye className="size-3.5" /> Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => grievanceInputRef.current?.click()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-3 text-xs font-medium hover:bg-muted"
                    >
                      <RefreshCw className="size-3.5" /> Replace
                    </button>
                    <button
                      type="button"
                      onClick={removeGrievanceFile}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-destructive/20 bg-background px-3 text-xs font-medium text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3.5" /> Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsGrievanceDragging(true);
                  }}
                  onDragLeave={() => setIsGrievanceDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsGrievanceDragging(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleSelectGrievanceFile(file);
                  }}
                  onClick={() => grievanceInputRef.current?.click()}
                  className={`mt-2 flex flex-1 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-all ${
                    isGrievanceDragging
                      ? "border-amber-500 bg-amber-500/10"
                      : "border-muted-foreground/25 hover:border-amber-500 hover:bg-muted/30"
                  }`}
                >
                  <div className="flex size-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
                    <Upload className="size-6" />
                  </div>
                  <p className="mt-3 font-medium text-foreground">
                    Upload Grievance Document / Petition
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Drag and drop or browse from device
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Accepts PDF, JPG, PNG (Max 10MB)
                  </p>
                  <button
                    type="button"
                    className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 text-xs font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-500/20"
                  >
                    Select File
                  </button>
                </div>
              )}

              <input
                ref={grievanceInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,image/jpeg,image/png,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleSelectGrievanceFile(file);
                }}
              />
            </div>

            {/* UPLOAD SECTION 2: Supporting Document / ID Proof */}
            <div className="flex flex-col rounded-2xl border bg-card p-5 shadow-xs transition-all hover:border-emerald-500/50">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                    <ShieldCheck className="size-4.5" />
                  </div>
                  <div>
                    <h2 className="font-display text-base font-bold text-foreground">
                      2. Supporting Document / Enclosure / ID
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Aadhaar card, certificates, photo, endorsement, or 2nd page
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  Optional
                </span>
              </div>

              {supportingFile ? (
                <div className="mt-2 flex flex-1 flex-col justify-between rounded-xl border bg-muted/30 p-4">
                  <div className="flex items-start gap-3">
                    {supportingPreviewUrl ? (
                      <img
                        src={supportingPreviewUrl}
                        alt="Supporting Preview"
                        className="size-16 shrink-0 rounded-lg border object-cover shadow-xs"
                      />
                    ) : (
                      <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                        <FileSpreadsheet className="size-8" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">
                        {supportingFile.name}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatBytes(supportingFile.size)} • {supportingFile.type || "Document"}
                      </p>
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                        <FileCheck className="size-3" /> Attached as Supporting Enclosure
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-2 border-t pt-3">
                    <button
                      type="button"
                      onClick={() => {
                        const url = supportingPreviewUrl || URL.createObjectURL(supportingFile);
                        setViewingFile({
                          url,
                          name: supportingFile.name,
                          isPdf: supportingFile.type === "application/pdf" || supportingFile.name.endsWith(".pdf"),
                        });
                      }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-3 text-xs font-medium hover:bg-muted"
                    >
                      <Eye className="size-3.5" /> Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => supportingInputRef.current?.click()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-3 text-xs font-medium hover:bg-muted"
                    >
                      <RefreshCw className="size-3.5" /> Replace
                    </button>
                    <button
                      type="button"
                      onClick={removeSupportingFile}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-destructive/20 bg-background px-3 text-xs font-medium text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3.5" /> Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsSupportingDragging(true);
                  }}
                  onDragLeave={() => setIsSupportingDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsSupportingDragging(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleSelectSupportingFile(file);
                  }}
                  onClick={() => supportingInputRef.current?.click()}
                  className={`mt-2 flex flex-1 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-all ${
                    isSupportingDragging
                      ? "border-emerald-500 bg-emerald-500/10"
                      : "border-muted-foreground/25 hover:border-emerald-500 hover:bg-muted/30"
                  }`}
                >
                  <div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                    <ShieldCheck className="size-6" />
                  </div>
                  <p className="mt-3 font-medium text-foreground">
                    Upload Supporting Doc / ID Proof
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Aadhaar, ration card, certificate, photos, or 2nd page
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Accepts PDF, JPG, PNG (Max 10MB)
                  </p>
                  <button
                    type="button"
                    className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400"
                  >
                    Select File
                  </button>
                </div>
              )}

              <input
                ref={supportingInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,image/jpeg,image/png,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleSelectSupportingFile(file);
                }}
              />
            </div>
          </div>

          {/* SUBMIT AND REVIEW BUTTON */}
          <div className="flex flex-col items-center justify-center rounded-2xl border bg-card p-6 text-center shadow-xs">
            <div className="flex items-center gap-2">
              <Sparkles className="size-5 text-amber-500" />
              <h3 className="font-display text-lg font-bold text-foreground">
                Ready to Submit & Review?
              </h3>
            </div>
            <p className="mt-1 max-w-lg text-sm text-muted-foreground">
              Clicking below will scan the uploaded documents with Grok AI, auto-fill every field in the official visitor slip template, and let you review and edit any mistakes.
            </p>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="inline-flex h-11 items-center justify-center rounded-xl border bg-background px-5 text-sm font-medium hover:bg-muted"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                disabled={!grievanceFile && !supportingFile}
                onClick={handleDigitizeAndReview}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-amber-500 px-7 text-sm font-bold text-white shadow-md transition-all hover:bg-amber-600 disabled:opacity-50"
              >
                <ScanLine className="size-4.5" />
                Submit and Review
                <ArrowRight className="size-4.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP: DIGITIZING WITH AI */}
      {step === "digitizing" && (
        <div className="flex flex-col items-center justify-center rounded-2xl border bg-card p-12 text-center shadow-xs">
          <div className="relative flex size-20 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
            <ScanLine className="size-10 animate-pulse text-amber-500" />
            <div className="absolute inset-0 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
          </div>

          <h2 className="mt-6 font-display text-xl font-bold text-foreground">
            Digitizing Grievance Documents with Grok AI
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md">
            {digitizeStatusText}
          </p>

          <div className="mt-6 w-full max-w-md">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-amber-500 transition-all duration-300"
                style={{ width: `${digitizeProgress}%` }}
              />
            </div>
            <p className="mt-2 text-right text-xs text-muted-foreground">
              {digitizeProgress}%
            </p>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-emerald-500" /> Secure Encryption
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-emerald-500" /> Telugu & English OCR
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-emerald-500" /> Official Visitor Slip Template
            </span>
          </div>
        </div>
      )}

      {/* STEP: REVIEW & EDIT THE EXISTING TEMPLATE */}
      {step === "review" && (
        <div className="space-y-6">
          {/* Digitization banner notice */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-foreground">
            <div className="flex items-center gap-2.5">
              <Sparkles className="size-5 shrink-0 text-amber-500" />
              <div>
                <p className="font-bold">
                  Grievance Digitized & Official Template Populated!
                </p>
                <p className="text-xs text-muted-foreground">
                  The fields below match the official MP visitor slip. Review every field, correct any mistakes, and click Submit to store.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowDocInspector(!showDocInspector)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted"
              >
                {showDocInspector ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                {showDocInspector ? "Hide Document Viewer" : "Show Document Viewer"}
              </button>
              <button
                type="button"
                onClick={() => setStep("upload")}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted"
              >
                <ArrowLeft className="size-3.5" /> Change Documents
              </button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            {/* DOCUMENT INSPECTOR & OCR VIEWER PANEL */}
            {showDocInspector && (
              <div className="lg:col-span-4 flex flex-col rounded-2xl border bg-card p-4 shadow-xs h-fit sticky top-24">
                <div className="mb-3 flex items-center justify-between border-b pb-3">
                  <h3 className="font-display text-sm font-bold text-foreground flex items-center gap-2">
                    <FileText className="size-4 text-amber-500" />
                    Uploaded Documents & OCR
                  </h3>
                  <div className="flex rounded-lg bg-muted p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setActiveInspectorTab("doc1")}
                      className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                        activeInspectorTab === "doc1"
                          ? "bg-background text-foreground shadow-xs font-bold"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Petition
                    </button>
                    {supportingFile && (
                      <button
                        type="button"
                        onClick={() => setActiveInspectorTab("doc2")}
                        className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                          activeInspectorTab === "doc2"
                            ? "bg-background text-foreground shadow-xs font-bold"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Enclosure
                      </button>
                    )}
                  </div>
                </div>

                {activeInspectorTab === "doc1" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="truncate text-xs font-medium text-foreground">
                        {grievanceFile?.name || "Primary Petition"}
                      </span>
                      {grievanceFile && (
                        <button
                          type="button"
                          onClick={() => {
                            const url = grievancePreviewUrl || URL.createObjectURL(grievanceFile);
                            setViewingFile({
                              url,
                              name: grievanceFile.name,
                              isPdf: grievanceFile.type === "application/pdf" || grievanceFile.name.endsWith(".pdf"),
                            });
                          }}
                          className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline"
                        >
                          <Eye className="size-3" /> Full view
                        </button>
                      )}
                    </div>

                    {grievancePreviewUrl ? (
                      <div className="overflow-hidden rounded-xl border bg-muted/20 max-h-56">
                        <img
                          src={grievancePreviewUrl}
                          alt="Grievance Doc"
                          className="w-full object-contain cursor-pointer"
                          onClick={() => {
                            setViewingFile({
                              url: grievancePreviewUrl,
                              name: grievanceFile?.name || "Grievance Document",
                              isPdf: false,
                            });
                          }}
                        />
                      </div>
                    ) : grievanceFile ? (
                      <div className="rounded-xl border bg-muted/30 p-4 text-center">
                        <FileText className="mx-auto size-10 text-amber-500" />
                        <p className="mt-2 text-xs font-medium">{grievanceFile.name}</p>
                        <p className="text-[11px] text-muted-foreground">{formatBytes(grievanceFile.size)}</p>
                      </div>
                    ) : null}

                    {/* OCR Text extracted */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                          Extracted OCR Text
                        </span>
                        {extractedGrievanceDoc?.extractedText && (
                          <button
                            type="button"
                            onClick={() => copyExtractedText(extractedGrievanceDoc.extractedText)}
                            className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 hover:underline"
                          >
                            {copiedText ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
                            {copiedText ? "Copied" : "Copy text"}
                          </button>
                        )}
                      </div>
                      <div className="max-h-60 overflow-y-auto rounded-lg border bg-muted/20 p-2.5 text-xs text-foreground font-mono leading-relaxed whitespace-pre-wrap">
                        {extractedGrievanceDoc?.extractedText || "No text extracted from this document."}
                      </div>
                    </div>
                  </div>
                )}

                {activeInspectorTab === "doc2" && supportingFile && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="truncate text-xs font-medium text-foreground">
                        {supportingFile.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const url = supportingPreviewUrl || URL.createObjectURL(supportingFile);
                          setViewingFile({
                            url,
                            name: supportingFile.name,
                            isPdf: supportingFile.type === "application/pdf" || supportingFile.name.endsWith(".pdf"),
                          });
                        }}
                        className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline"
                      >
                        <Eye className="size-3" /> Full view
                      </button>
                    </div>

                    {supportingPreviewUrl ? (
                      <div className="overflow-hidden rounded-xl border bg-muted/20 max-h-56">
                        <img
                          src={supportingPreviewUrl}
                          alt="Supporting Doc"
                          className="w-full object-contain cursor-pointer"
                          onClick={() => {
                            setViewingFile({
                              url: supportingPreviewUrl,
                              name: supportingFile.name,
                              isPdf: false,
                            });
                          }}
                        />
                      </div>
                    ) : (
                      <div className="rounded-xl border bg-muted/30 p-4 text-center">
                        <FileSpreadsheet className="mx-auto size-10 text-emerald-600" />
                        <p className="mt-2 text-xs font-medium">{supportingFile.name}</p>
                        <p className="text-[11px] text-muted-foreground">{formatBytes(supportingFile.size)}</p>
                      </div>
                    )}

                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                          Extracted OCR Text
                        </span>
                        {extractedSupportingDoc?.extractedText && (
                          <button
                            type="button"
                            onClick={() => copyExtractedText(extractedSupportingDoc.extractedText)}
                            className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 hover:underline"
                          >
                            {copiedText ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
                            {copiedText ? "Copied" : "Copy text"}
                          </button>
                        )}
                      </div>
                      <div className="max-h-60 overflow-y-auto rounded-lg border bg-muted/20 p-2.5 text-xs text-foreground font-mono leading-relaxed whitespace-pre-wrap">
                        {extractedSupportingDoc?.extractedText || "No text extracted from this document."}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* MAIN EDITABLE TEMPLATE FORM MATCHING THE PHYSICAL VISITOR SLIP */}
            <div className={showDocInspector ? "lg:col-span-8" : "lg:col-span-12"}>
              <form
                onSubmit={(e) => void handleFinalSubmit(e)}
                className="space-y-6 rounded-2xl border-2 border-border/80 bg-card p-6 md:p-8 shadow-sm"
              >
                {/* OFFICIAL MP HEADER */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-5">
                  <div className="flex items-center gap-3.5">
                    <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 font-display font-black text-white text-xl shadow-sm border-2 border-amber-300">
                      LSK
                    </div>
                    <div>
                      <h1 className="font-display text-lg sm:text-xl font-black tracking-wide text-amber-600 dark:text-amber-400 uppercase">
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
                      onChange={setDraftField("srNumber")}
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
                          onChange={setDraftField("fullName")}
                          required
                          className={slipInputClass}
                          placeholder="Enter full name"
                        />
                      </SlipField>

                      <SlipField label="ADDRESS">
                        <input
                          value={draft.address}
                          onChange={setDraftField("address")}
                          className={slipInputClass}
                          placeholder="Enter house no., street, area"
                        />
                      </SlipField>

                      <SlipField label="VILLAGE">
                        <input
                          value={draft.village}
                          onChange={setDraftField("village")}
                          className={slipInputClass}
                          placeholder="Enter village"
                        />
                      </SlipField>

                      <SlipField label="ASSEMBLY CONSTITUENCY">
                        <select
                          value={draft.assemblyConstituency}
                          onChange={setDraftField("assemblyConstituency")}
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
                          onChange={setDraftField("referenceName")}
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
                          onChange={setDraftField("contactNumber")}
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
                          onChange={setDraftField("email")}
                          className={slipInputClass}
                          placeholder="Enter email address"
                        />
                      </SlipField>

                      <SlipField label="MANDAL">
                        <input
                          value={draft.mandal}
                          onChange={setDraftField("mandal")}
                          className={slipInputClass}
                          placeholder="Enter mandal"
                        />
                      </SlipField>

                      <SlipField label="DATE OF VISIT">
                        <input
                          type="date"
                          value={draft.dateOfVisit}
                          onChange={setDraftField("dateOfVisit")}
                          className={slipInputClass}
                        />
                      </SlipField>

                      <SlipField label="REFERENCE NUMBER">
                        <input
                          value={draft.referenceNumber}
                          onChange={setDraftField("referenceNumber")}
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
                        onChange={setDraftField("others")}
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
                          onChange={setDraftField("issueDetail")}
                          rows={6}
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
                        onChange={setDraftField("actionTaken")}
                        className={slipInputClass}
                        placeholder="Details of action taken"
                      />
                    </SlipField>

                    <SlipField label="ACTION TO BE TAKEN">
                      <input
                        value={draft.actionToBeTaken}
                        onChange={setDraftField("actionToBeTaken")}
                        className={slipInputClass}
                        placeholder="Details of action to be taken"
                      />
                    </SlipField>

                    <div className="grid gap-3 sm:grid-cols-12 items-center">
                      <div className="sm:col-span-8">
                        <SlipField label="ASSIGNED OFFICER">
                          <input
                            value={draft.assignedOfficer}
                            onChange={setDraftField("assignedOfficer")}
                            className={slipInputClass}
                            placeholder="Assigned officer / department"
                          />
                        </SlipField>
                      </div>
                      <div className="sm:col-span-4">
                        <input
                          value={draft.assignedOfficerPhone}
                          onChange={setDraftField("assignedOfficerPhone")}
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
                          {["Pending", "In progress", "Resolved"].map((status) => {
                            const checked = draft.resolutionStatus.toLowerCase() === status.toLowerCase();
                            return (
                              <label
                                key={status}
                                className={`flex items-center gap-1.5 text-xs font-bold uppercase cursor-pointer px-2 py-1 rounded-md transition-colors ${
                                  checked ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                <input
                                  type="radio"
                                  name="resolutionStatus"
                                  value={status}
                                  checked={checked}
                                  onChange={() => setDraft((curr) => ({ ...curr, resolutionStatus: status }))}
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
                          onChange={setDraftField("deadline")}
                          className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* BOTTOM SUBMIT BUTTON BAR */}
                <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="size-4 text-emerald-600" />
                    <span>
                      {grievanceFile ? "Primary document" : "No document"} +{" "}
                      {supportingFile ? "supporting enclosure" : "no enclosure"} attached
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setStep("upload")}
                      className="inline-flex h-11 items-center gap-2 rounded-xl border bg-background px-5 text-sm font-medium hover:bg-muted"
                    >
                      <ArrowLeft className="size-4" />
                      Back to Upload
                    </button>

                    <button
                      type="submit"
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-amber-500 px-8 text-sm font-bold text-white shadow-md transition-all hover:bg-amber-600"
                    >
                      <Check className="size-4.5" />
                      Submit & Store Grievance
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* STEP: STORING IN DATABASE */}
      {step === "storing" && (
        <div className="flex flex-col items-center justify-center rounded-2xl border bg-card p-12 text-center shadow-xs">
          <Loader2 className="size-12 animate-spin text-amber-500" />
          <h2 className="mt-5 font-display text-xl font-bold text-foreground">
            Storing Grievance & Attaching Documents...
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md">
            Recording grievance in constituency database and linking scanned files...
          </p>
        </div>
      )}

      {/* STEP: STORED SUCCESS STATE */}
      {step === "success" && storedResult && (
        <div className="flex flex-col rounded-2xl border border-emerald-500/30 bg-card p-8 shadow-sm">
          <div className="flex flex-col items-center text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-9" />
            </div>

            <h2 className="mt-4 font-display text-2xl font-bold text-foreground">
              Grievance Successfully Submitted and Stored!
            </h2>
            <p className="mt-1 text-sm text-muted-foreground max-w-lg">
              The grievance has been recorded in the JanaVignanam database matching the official visitor slip format with attached digitized documents.
            </p>
          </div>

          {/* Grievance Summary Card */}
          <div className="mt-8 rounded-xl border bg-muted/20 p-6">
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Sr. Number</p>
                <p className="font-display font-semibold text-foreground">
                  {storedResult.srNumber || draft.srNumber}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">Citizen Name</p>
                <p className="font-display font-semibold text-foreground">
                  {storedResult.fullName || draft.fullName}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">Contact Number</p>
                <p className="font-medium text-foreground">
                  {storedResult.contactNumber || draft.contactNumber}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">Location</p>
                <p className="text-sm text-foreground">
                  {[draft.village, draft.mandal].filter(Boolean).join(", ") || "Palnadu"}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">Assembly Constituency</p>
                <p className="text-sm text-foreground">
                  {draft.assemblyConstituency || "—"}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">Status & Documents</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="inline-flex rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                    {draft.resolutionStatus}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {storedResult.documentsCount || 0} doc(s) attached
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-amber-500 px-6 text-sm font-bold text-white shadow-md hover:bg-amber-600"
            >
              <Plus className="size-4.5" />
              Upload Another Grievance
            </button>

            {storedResult.id && (
              <a
                href={apiUrl(`/api/workspace/records/${storedResult.id}/pdf`)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-xl border bg-background px-5 text-sm font-medium hover:bg-muted"
              >
                <Download className="size-4.5 text-amber-500" />
                Download PDF Slip
              </a>
            )}

            {storedResult.progressToken && (
              <a
                href={`/progress/${storedResult.progressToken}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-xl border bg-background px-5 text-sm font-medium hover:bg-muted"
              >
                <ExternalLink className="size-4.5 text-amber-500" />
                Public Progress Tracker
              </a>
            )}

            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex h-11 items-center gap-2 rounded-xl border bg-background px-5 text-sm font-medium hover:bg-muted"
              >
                Back to Records List
              </button>
            )}
          </div>
        </div>
      )}

      {/* FULL PREVIEW MODAL */}
      {viewingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border bg-background shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b px-6">
              <p className="truncate font-display font-semibold text-foreground">
                {viewingFile.name}
              </p>
              <button
                type="button"
                onClick={() => setViewingFile(null)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4 flex items-center justify-center min-h-[400px]">
              {viewingFile.isPdf ? (
                <iframe
                  src={viewingFile.url}
                  title="PDF Preview"
                  className="h-[70vh] w-full rounded-lg border"
                />
              ) : (
                <img
                  src={viewingFile.url}
                  alt={viewingFile.name}
                  className="max-h-[70vh] max-w-full rounded-lg object-contain"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
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
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  );
}

function ChevronArrow() {
  return (
    <svg
      className="size-4 text-muted-foreground/60"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}
