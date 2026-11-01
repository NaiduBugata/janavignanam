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
  FileImage,
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
  divisionNames,
  mandalNames,
  PLACES,
  villageNames,
  withCurrent,
} from "@/places";
import {
  ASSEMBLY_CONSTITUENCIES,
  ISSUE_CATEGORIES,
  RESOLUTION_STATUSES,
} from "@/CaseRecordForm";

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
  actionTaken: string;
  actionToBeTaken: string;
  assignedOfficer: string;
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
  const autoSr = `SR-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
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
    categories: ["Public Grievance"],
    others: "",
    actionTaken: "",
    actionToBeTaken: "Review representation and take appropriate departmental action",
    assignedOfficer: "",
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

  // Existing Template Draft state
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

  // Handle Grievance File Change
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

  // Handle Supporting File Change
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

  // Step 2 Action: "Submit and Review" -> triggers Grok AI Digitization & auto-fills template
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
        // Try the batch endpoint first
        scanResult = await apiUpload("/api/workspace/documents/scan-batch", formData, token);
      } catch (err: unknown) {
        // If scan-batch fails, fallback to scan-preview on grievanceFile
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
      setDigitizeStatusText("Extracting citizen identity, administrative hierarchy & category...");

      if (scanResult?.grievanceDoc) {
        setExtractedGrievanceDoc(scanResult.grievanceDoc);
      }
      if (scanResult?.supportingDoc) {
        setExtractedSupportingDoc(scanResult.supportingDoc);
      }

      const d = scanResult?.structuredData || {};

      // Match Place / Hierarchy intelligently against PLACES database
      let detectedDivision = d.division || "";
      let detectedMandal = d.mandal || "";
      let detectedVillage = d.village || "";

      // Try smart match if mandal was extracted
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
      const matchedCategories = ISSUE_CATEGORIES.filter((c) =>
        d.category && (
          d.category.toLowerCase().includes(c.toLowerCase()) ||
          c.toLowerCase().includes(d.category.toLowerCase())
        )
      );
      const nextCategories = matchedCategories.length
        ? matchedCategories
        : ["Public Grievance"];

      // Calculate default deadline: 14 days from visit date
      const visitDate = d.date || new Date().toISOString().split("T")[0];
      const targetDeadline = new Date(visitDate);
      targetDeadline.setDate(targetDeadline.getDate() + 14);
      const formattedDeadline = targetDeadline.toISOString().split("T")[0];

      // Auto-fill template draft with extracted and digitally converted data
      setDraft((current) => ({
        ...current,
        srNumber: d.referenceNumber ? `SR-${d.referenceNumber}` : current.srNumber,
        fullName: d.applicantName || current.fullName,
        contactNumber: d.contactNumber || current.contactNumber,
        referenceNumber: d.referenceNumber || current.referenceNumber,
        dateOfVisit: visitDate,
        division: detectedDivision || current.division,
        mandal: detectedMandal || current.mandal,
        village: detectedVillage || current.village,
        assemblyConstituency: detectedConstituency || current.assemblyConstituency,
        categories: nextCategories,
        others: d.issueSummary || current.others,
        actionToBeTaken: d.actionRequested || current.actionToBeTaken,
        assignedOfficer: d.assignedOfficer || current.assignedOfficer,
        deadline: formattedDeadline,
      }));

      setDigitizeProgress(100);
      setDigitizeStatusText("Digital conversion complete!");

      // Transition to template review step
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

  // Handle template input changes
  const setDraftField = (key: keyof GrievanceDraft) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setDraft((curr) => ({ ...curr, [key]: event.target.value }));
  };

  // Toggle Category selection
  const toggleCategory = (category: string) => {
    setDraft((current) => {
      const categories = current.categories.includes(category)
        ? current.categories.filter((item) => item !== category)
        : [...current.categories, category];
      return {
        ...current,
        categories: categories.length ? categories : ["Public Grievance"],
      };
    });
  };

  // Step 5: Final Submission to Database
  const handleFinalSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!draft.fullName.trim()) {
      setError("Please enter the citizen's full name.");
      return;
    }
    if (!draft.contactNumber.trim()) {
      setError("Please enter a valid 10-digit contact number.");
      return;
    }
    if (!draft.categories.length) {
      setError("Please select at least one grievance category.");
      return;
    }

    setError(null);
    setStep("storing");

    try {
      // 1. Create the grievance record in the database with robust field fallbacks
      const cleanPhone = draft.contactNumber.replace(/[^0-9]/g, "");
      const visitDate = draft.dateOfVisit || new Date().toISOString().split("T")[0];
      const targetDeadline = draft.deadline || (() => {
        const d = new Date(visitDate);
        d.setDate(d.getDate() + 14);
        return d.toISOString().split("T")[0];
      })();

      const payload = {
        section: "grievances",
        title: draft.fullName.trim(),
        fullName: draft.fullName.trim(),
        srNumber: draft.srNumber.trim() || `SR-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        contactNumber: cleanPhone || draft.contactNumber.trim(),
        address: draft.address.trim() || [draft.village, draft.mandal, "Palnadu"].filter(Boolean).join(", ") || "Palnadu",
        email: draft.email && draft.email.includes("@")
          ? draft.email.trim()
          : `${cleanPhone || "citizen"}@janavignanam.org`,
        village: draft.village.trim() || draft.mandal.trim() || "Palnadu",
        mandal: draft.mandal.trim() || "Narasaraopet",
        division: draft.division.trim() || "Narasaraopet",
        assemblyConstituency: (draft.assemblyConstituency.trim() || "Narasaraopet") as (typeof ASSEMBLY_CONSTITUENCIES)[number],
        dateOfVisit: visitDate,
        referenceName: draft.referenceName.trim() || undefined,
        referenceNumber: draft.referenceNumber.trim() || undefined,
        categories: draft.categories.length ? draft.categories : ["Public Grievance"],
        others: draft.others.trim() || `${draft.fullName} - ${draft.categories.join(", ")}`,
        detail: draft.others.trim() || `${draft.fullName} - ${draft.categories.join(", ")}`,
        actionTaken: draft.actionTaken.trim() || "Grievance received and registered digitally",
        actionToBeTaken: draft.actionToBeTaken.trim() || "Review representation and take appropriate departmental action",
        assignedOfficer: draft.assignedOfficer.trim() || "Concerned Departmental Officer",
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

      // 2. Attach Primary Grievance Document if provided
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

      // 3. Attach Supporting Document if provided
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

  // Reset workflow for uploading another grievance
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

  const inputClass =
    "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-colors focus:ring-2 focus:ring-primary/40 focus:border-primary";

  return (
    <div className="w-full">
      {/* Step Banner / Progress Header */}
      <div className="mb-6 rounded-2xl border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
                JV
              </span>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                Constituency Intelligence & Grievance Portal
              </p>
            </div>
            <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-foreground md:text-3xl">
              Grievance Digitization & Submission Desk
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload physical petitions or supporting docs, let Grok AI auto-fill the official visitor template, review & edit, and securely store the record.
            </p>
          </div>

          {/* Stepper Indicator */}
          <div className="flex items-center gap-2 text-xs font-medium">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${
                step === "upload" || step === "digitizing"
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              1. Upload Documents
            </span>
            <ChevronArrow />
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${
                step === "review" || step === "storing"
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              2. Review & Edit Template
            </span>
            <ChevronArrow />
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${
                step === "success"
                  ? "bg-emerald-600 text-white font-semibold"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              3. Stored
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
            <div className="flex flex-col rounded-2xl border bg-card p-5 shadow-xs transition-all hover:border-primary/50">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileText className="size-4.5" />
                  </div>
                  <div>
                    <h2 className="font-display text-base font-semibold text-foreground">
                      1. Grievance Petition / Letter
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Primary petition, representation, or grievance letter
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
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
                      ? "border-primary bg-primary/10"
                      : "border-muted-foreground/25 hover:border-primary hover:bg-muted/30"
                  }`}
                >
                  <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Upload className="size-6" />
                  </div>
                  <p className="mt-3 font-medium text-foreground">
                    Upload Main Grievance Document
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Drag and drop or browse from device
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Accepts PDF, JPG, PNG (Max 10MB)
                  </p>
                  <button
                    type="button"
                    className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/20"
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
            <div className="flex flex-col rounded-2xl border bg-card p-5 shadow-xs transition-all hover:border-primary/50">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                    <ShieldCheck className="size-4.5" />
                  </div>
                  <div>
                    <h2 className="font-display text-base font-semibold text-foreground">
                      2. Supporting Document / Enclosure / ID
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Aadhaar card, certificate, photos, 2nd page, or evidence
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
              <Sparkles className="size-5 text-primary" />
              <h3 className="font-display text-lg font-semibold text-foreground">
                Ready to Digitize & Review?
              </h3>
            </div>
            <p className="mt-1 max-w-lg text-sm text-muted-foreground">
              Clicking below will scan both uploaded documents using Grok AI, automatically extract applicant details, constituency hierarchy, and grievance issue, and populate the official template for your review and editing.
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
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-7 text-sm font-semibold text-primary-foreground shadow-md transition-all hover:bg-primary/90 disabled:opacity-50"
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
          <div className="relative flex size-20 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ScanLine className="size-10 animate-pulse text-primary" />
            <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
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
                className="h-full bg-primary transition-all duration-300"
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
              <CheckCircle2 className="size-3.5 text-emerald-500" /> Automatic Field Mapping
            </span>
          </div>
        </div>
      )}

      {/* STEP: REVIEW & EDIT THE EXISTING TEMPLATE */}
      {step === "review" && (
        <div className="space-y-6">
          {/* Digitization banner notice */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-900 dark:text-emerald-300">
            <div className="flex items-center gap-2.5">
              <Sparkles className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="font-semibold">
                  Grievance Digitized & Template Populated!
                </p>
                <p className="text-xs text-emerald-800 dark:text-emerald-400">
                  All details have been converted digitally from your uploaded documents. Review every field below, correct any mistakes or add missing details, then click Submit to save.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowDocInspector(!showDocInspector)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-background px-3 text-xs font-medium text-foreground hover:bg-muted"
              >
                {showDocInspector ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                {showDocInspector ? "Hide Document Viewer" : "Show Document Viewer"}
              </button>
              <button
                type="button"
                onClick={() => setStep("upload")}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-background px-3 text-xs font-medium text-foreground hover:bg-muted"
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
                  <h3 className="font-display text-sm font-semibold text-foreground flex items-center gap-2">
                    <FileText className="size-4 text-primary" />
                    Uploaded Documents & OCR
                  </h3>
                  <div className="flex rounded-lg bg-muted p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setActiveInspectorTab("doc1")}
                      className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                        activeInspectorTab === "doc1"
                          ? "bg-background text-foreground shadow-xs"
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
                            ? "bg-background text-foreground shadow-xs"
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
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
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
                        <FileText className="mx-auto size-10 text-primary" />
                        <p className="mt-2 text-xs font-medium">{grievanceFile.name}</p>
                        <p className="text-[11px] text-muted-foreground">{formatBytes(grievanceFile.size)}</p>
                      </div>
                    ) : null}

                    {/* OCR Text extracted */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Extracted Text
                        </span>
                        {extractedGrievanceDoc?.extractedText && (
                          <button
                            type="button"
                            onClick={() => copyExtractedText(extractedGrievanceDoc.extractedText)}
                            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
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
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
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
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Extracted Text
                        </span>
                        {extractedSupportingDoc?.extractedText && (
                          <button
                            type="button"
                            onClick={() => copyExtractedText(extractedSupportingDoc.extractedText)}
                            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
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

            {/* MAIN EDITABLE TEMPLATE FORM */}
            <div className={showDocInspector ? "lg:col-span-8" : "lg:col-span-12"}>
              <form
                onSubmit={(e) => void handleFinalSubmit(e)}
                className="space-y-6 rounded-2xl border bg-card p-6 shadow-xs"
              >
                <div className="flex items-center justify-between border-b pb-4">
                  <div>
                    <h2 className="font-display text-lg font-bold text-foreground">
                      Grievance Visitor Record Template
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Edit any fields below to correct any OCR mistakes before final storage.
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    Editable Form
                  </span>
                </div>

                {/* SECTION 1: CITIZEN INFORMATION */}
                <div>
                  <h3 className="mb-3 font-display text-xs font-semibold uppercase tracking-wider text-primary">
                    1. Citizen Information
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Sr. Number" required>
                      <input
                        value={draft.srNumber}
                        onChange={setDraftField("srNumber")}
                        required
                        className={inputClass}
                        placeholder="e.g. SR-2026-1042"
                      />
                    </Field>

                    <Field label="Full Name (Applicant)" required>
                      <input
                        value={draft.fullName}
                        onChange={setDraftField("fullName")}
                        required
                        autoFocus
                        className={inputClass}
                        placeholder="Citizen's full name"
                      />
                    </Field>

                    <Field label="Contact Number" required>
                      <input
                        value={draft.contactNumber}
                        onChange={setDraftField("contactNumber")}
                        required
                        inputMode="tel"
                        className={inputClass}
                        placeholder="10-digit mobile number"
                      />
                    </Field>

                    <Field label="Email Address">
                      <input
                        type="email"
                        value={draft.email}
                        onChange={setDraftField("email")}
                        className={inputClass}
                        placeholder="applicant@example.com (optional)"
                      />
                    </Field>

                    <div className="sm:col-span-2">
                      <Field label="Residential Address">
                        <input
                          value={draft.address}
                          onChange={setDraftField("address")}
                          className={inputClass}
                          placeholder="House No, Street, Landmark"
                        />
                      </Field>
                    </div>
                  </div>
                </div>

                {/* SECTION 2: ADMINISTRATIVE & CONSTITUENCY HIERARCHY */}
                <div className="border-t pt-5">
                  <h3 className="mb-3 font-display text-xs font-semibold uppercase tracking-wider text-primary">
                    2. Constituency & Location Hierarchy (Palnadu District)
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Division" required>
                      <select
                        value={draft.division}
                        onChange={(e) =>
                          setDraft((curr) => ({
                            ...curr,
                            division: e.target.value,
                            mandal: "",
                            village: "",
                          }))
                        }
                        required
                        className={inputClass}
                      >
                        <option value="">Select Division</option>
                        {divisionNames().map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Mandal" required>
                      <select
                        value={draft.mandal}
                        onChange={(e) =>
                          setDraft((curr) => ({
                            ...curr,
                            mandal: e.target.value,
                            village: "",
                          }))
                        }
                        required
                        className={inputClass}
                      >
                        <option value="">Select Mandal</option>
                        {withCurrent(mandalNames(draft.division), draft.mandal).map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Village / Habitation" required>
                      <select
                        value={draft.village}
                        onChange={setDraftField("village")}
                        required
                        className={inputClass}
                      >
                        <option value="">Select Village</option>
                        {withCurrent(villageNames(draft.division, draft.mandal), draft.village).map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <div className="sm:col-span-2 lg:col-span-3">
                      <Field label="Assembly Constituency" required>
                        <select
                          value={draft.assemblyConstituency}
                          onChange={setDraftField("assemblyConstituency")}
                          required
                          className={inputClass}
                        >
                          <option value="">Select Assembly Constituency</option>
                          {ASSEMBLY_CONSTITUENCIES.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                  </div>
                </div>

                {/* SECTION 3: REFERENCES & VISIT DATES */}
                <div className="border-t pt-5">
                  <h3 className="mb-3 font-display text-xs font-semibold uppercase tracking-wider text-primary">
                    3. Official References & Submission Date
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Date of Visit / Representation">
                      <input
                        type="date"
                        value={draft.dateOfVisit}
                        onChange={setDraftField("dateOfVisit")}
                        className={inputClass}
                      />
                    </Field>

                    <Field label="Reference / Referred By">
                      <input
                        value={draft.referenceName}
                        onChange={setDraftField("referenceName")}
                        className={inputClass}
                        placeholder="Leader, MLA, or Officer"
                      />
                    </Field>

                    <Field label="Reference / Petition No.">
                      <input
                        value={draft.referenceNumber}
                        onChange={setDraftField("referenceNumber")}
                        className={inputClass}
                        placeholder="e.g. PET-2026-90"
                      />
                    </Field>
                  </div>
                </div>

                {/* SECTION 4: ISSUE CATEGORIZATION & DESCRIPTION */}
                <div className="border-t pt-5">
                  <h3 className="mb-2 font-display text-xs font-semibold uppercase tracking-wider text-primary">
                    4. Grievance Category & Citizen's Representation
                  </h3>

                  <div className="mb-4">
                    <span className="mb-2 block text-xs font-medium text-foreground">
                      Select Issue Categories <span className="text-destructive">*</span>
                    </span>
                    <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                      {ISSUE_CATEGORIES.map((category) => {
                        const checked = draft.categories.includes(category);
                        return (
                          <label
                            key={category}
                            className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-xs transition-colors ${
                              checked
                                ? "border-primary bg-primary/10 text-primary font-medium"
                                : "border-border hover:bg-muted"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleCategory(category)}
                              className="size-3.5 rounded border-muted-foreground text-primary focus:ring-primary"
                            />
                            <span>{category}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <Field label="Detailed Grievance Representation / Problem Summary" required>
                    <textarea
                      value={draft.others}
                      onChange={setDraftField("others")}
                      required
                      rows={4}
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-primary/40 focus:border-primary"
                      placeholder="Explain the grievance details, citizen's request, background, and specific relief sought..."
                    />
                  </Field>
                </div>

                {/* SECTION 5: ACTION & RESOLUTION PLAN */}
                <div className="border-t pt-5">
                  <h3 className="mb-3 font-display text-xs font-semibold uppercase tracking-wider text-primary">
                    5. Action Plan & Department Assignment
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Action Taken so far">
                      <textarea
                        value={draft.actionTaken}
                        onChange={setDraftField("actionTaken")}
                        rows={2}
                        className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-primary/40 focus:border-primary"
                        placeholder="Endorsed to department, acknowledgment issued, etc."
                      />
                    </Field>

                    <Field label="Action to be Taken (Directive)">
                      <textarea
                        value={draft.actionToBeTaken}
                        onChange={setDraftField("actionToBeTaken")}
                        rows={2}
                        className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-primary/40 focus:border-primary"
                        placeholder="Action requested from the executive officer or department"
                      />
                    </Field>

                    <Field label="Assigned Officer / Department">
                      <input
                        value={draft.assignedOfficer}
                        onChange={setDraftField("assignedOfficer")}
                        className={inputClass}
                        placeholder="e.g. Tahsildar, MPDO, RDO, or Electricity DE"
                      />
                    </Field>

                    <Field label="Resolution Status" required>
                      <select
                        value={draft.resolutionStatus}
                        onChange={setDraftField("resolutionStatus")}
                        required
                        className={inputClass}
                      >
                        {RESOLUTION_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Target Resolution Deadline">
                      <input
                        type="date"
                        value={draft.deadline}
                        onChange={setDraftField("deadline")}
                        className={inputClass}
                      />
                    </Field>
                  </div>
                </div>

                {/* BOTTOM SUBMIT BUTTON BAR */}
                <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-5">
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
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-8 text-sm font-semibold text-primary-foreground shadow-md transition-all hover:bg-primary/90"
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
          <Loader2 className="size-12 animate-spin text-primary" />
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
              The grievance has been recorded in the JanaVignanam database with full administrative hierarchy and attached digitized documents.
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
                  {[draft.village, draft.mandal, draft.division].filter(Boolean).join(", ") || "Palnadu"}
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
                  <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
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
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-md hover:bg-primary/90"
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
                <Download className="size-4.5 text-primary" />
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
                <ExternalLink className="size-4.5 text-primary" />
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

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      {children}
    </label>
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
