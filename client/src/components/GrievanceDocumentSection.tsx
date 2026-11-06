import React, { useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileImage,
  FileText,
  Loader2,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { api, apiUpload } from "@/lib/api";
import { apiUrl } from "@/lib/apiBase";

export interface GrievanceExtractedData {
  applicantName?: string;
  contactNumber?: string;
  referenceNumber?: string;
  date?: string;
  category?: string;
  village?: string;
  mandal?: string;
  division?: string;
  assemblyConstituency?: string;
  assignedOfficer?: string;
  actionRequested?: string;
  issueSummary?: string;
  rawJson?: Record<string, unknown>;
}

export interface ScannedDocument {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  status: "processing" | "completed" | "failed";
  extractedText?: string;
  structuredData?: GrievanceExtractedData;
  errorMessage?: string;
}

export interface GrievanceItemLike {
  id: string;
  fullName?: string;
  title?: string;
  detail?: string;
  status?: string;
  scannedDocuments?: ScannedDocument[];
}

interface Props {
  record: GrievanceItemLike;
  token: string;
  onUpdateRecord: (updated: Partial<GrievanceItemLike>) => void;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0 || Number.isNaN(bytes)) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function GrievanceDocumentSection({
  record,
  token,
  onUpdateRecord,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const docs = record.scannedDocuments || [];

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = "";
    await uploadFile(file);
  };

  const uploadFile = async (file: File) => {
    setUploadError("");

    const validExtensions = /\.(pdf|jpe?g|png)$/i;
    const validMimes = [
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
    ];

    if (!validExtensions.test(file.name) && !validMimes.includes(file.type.toLowerCase())) {
      setUploadError(
        "Unsupported file format. Please upload a PDF, JPG, JPEG, or PNG document.",
      );
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setUploadError("File size exceeds 10MB limit. Please upload a smaller document.");
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const result = await apiUpload<{
        document: ScannedDocument;
        record: GrievanceItemLike;
      }>(`/api/workspace/records/${encodeURIComponent(record.id)}/documents`, formData, token);

      if (result.record) {
        onUpdateRecord(result.record);
        setExpandedDocId(result.document.id);
      }
    } catch (err: unknown) {
      setUploadError(
        err instanceof Error
          ? err.message
          : "Failed to upload and scan document. Please check xAI Grok API configuration.",
      );
    } finally {
      setUploading(false);
    }
  };

  const copyExtractedText = (docId: string, textToCopy: string) => {
    void navigator.clipboard.writeText(textToCopy);
    setCopiedId(docId);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const deleteDoc = async (docId: string) => {
    if (!window.confirm("Are you sure you want to delete this scanned document?")) {
      return;
    }
    setDeletingDocId(docId);
    try {
      const updated = await api<GrievanceItemLike>(
        `/api/workspace/records/${encodeURIComponent(record.id)}/documents/${encodeURIComponent(docId)}`,
        { method: "DELETE", token },
      );
      onUpdateRecord(updated);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Failed to delete document.");
    } finally {
      setDeletingDocId(null);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-dashed border-border/80 bg-muted/20 p-3.5 text-xs">
      {/* Header and Upload Trigger */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Sparkles className="size-3.5" />
          </div>
          <div>
            <span className="font-semibold text-foreground">
              Document Scan & Extraction (Grok AI)
            </span>
            <span className="ml-2 text-muted-foreground">
              ({docs.length} {docs.length === 1 ? "document" : "documents"})
            </span>
          </div>
        </div>

        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,image/jpeg,image/png,application/pdf"
            className="hidden"
            onChange={handleFileChange}
            disabled={uploading}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary/10 px-2.5 font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                Scanning with Grok AI…
              </>
            ) : (
              <>
                <Upload className="size-3" />
                Upload Document
              </>
            )}
          </button>
        </div>
      </div>

      {/* Uploading Status Banner */}
      {uploading && (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-primary/5 p-2.5 text-primary">
          <Loader2 className="size-4 animate-spin shrink-0" />
          <p className="leading-tight">
            Scanning document with official <strong>xAI Grok Vision API</strong>…
            Preserving headings, tables, dates, reference numbers, and structured fields.
          </p>
        </div>
      )}

      {/* Error Banner */}
      {uploadError && (
        <div className="mt-2.5 flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-destructive">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">{uploadError}</p>
            <p className="mt-0.5 text-[11px] opacity-80">
              Supported formats: PDF, JPG, JPEG, PNG (scanned or digital, up to 10MB).
            </p>
          </div>
        </div>
      )}

      {/* Success Notification */}
      {/* Documents List */}
      {docs.length > 0 ? (
        <div className="mt-3 space-y-2.5">
          {docs.map((doc) => {
            const isExpanded = expandedDocId === doc.id;
            const isPdf =
              doc.mimeType === "application/pdf" || doc.filename.endsWith(".pdf");
            const fileUrl = apiUrl(
              `/api/workspace/records/${encodeURIComponent(record.id)}/documents/${encodeURIComponent(doc.id)}/file?token=${encodeURIComponent(token)}`,
            );

            return (
              <div
                key={doc.id}
                className="overflow-hidden rounded-md border bg-card text-card-foreground shadow-xs"
              >
                {/* Document Top Row */}
                <div className="flex items-center justify-between gap-3 p-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    {isPdf ? (
                      <FileText className="size-4 shrink-0 text-red-500" />
                    ) : (
                      <FileImage className="size-4 shrink-0 text-blue-500" />
                    )}
                    <span className="truncate font-medium text-foreground" title={doc.filename}>
                      {doc.filename}
                    </span>
                    <span className="text-muted-foreground whitespace-nowrap">
                      ({formatBytes(doc.sizeBytes)})
                    </span>

                    {doc.status === "processing" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-400">
                        <Loader2 className="size-2.5 animate-spin" />
                        Processing
                      </span>
                    )}
                    {doc.status === "failed" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                        <AlertCircle className="size-2.5" />
                        Scan Failed
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-primary hover:bg-primary/10"
                      title="View original document"
                    >
                      <ExternalLink className="size-3" />
                      View Original
                    </a>

                    <button
                      type="button"
                      disabled={deletingDocId === doc.id}
                      onClick={() => deleteDoc(doc.id)}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="Delete document"
                    >
                      <Trash2 className="size-3" />
                    </button>

                    {(doc.extractedText || doc.structuredData) && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedDocId((current) => (current === doc.id ? null : doc.id))
                        }
                        className="rounded p-1 text-muted-foreground hover:bg-muted"
                        title={isExpanded ? "Collapse extracted details" : "Expand extracted details"}
                      >
                        {isExpanded ? (
                          <ChevronUp className="size-3.5" />
                        ) : (
                          <ChevronDown className="size-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Error reason if scan failed */}
                {doc.status === "failed" && doc.errorMessage && (
                  <div className="border-t bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
                    <strong>Error:</strong> {doc.errorMessage}
                  </div>
                )}

                {/* Expanded Extracted Details & Structured Data */}
                {isExpanded && (
                  <div className="border-t bg-muted/10 p-3 space-y-3">
                    {/* Structured Grievance Information Grid */}
                    {doc.structuredData && (
                      <div>
                        <div className="mb-2 flex items-center justify-between">
                          <span className="font-semibold text-foreground">
                            Structured Grievance Information
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            Generated by xAI Grok
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {doc.structuredData.applicantName && (
                            <div className="rounded border bg-card p-2">
                              <p className="text-[10px] text-muted-foreground">Applicant Name</p>
                              <p className="font-medium text-foreground">
                                {doc.structuredData.applicantName}
                              </p>
                            </div>
                          )}
                          {doc.structuredData.contactNumber && (
                            <div className="rounded border bg-card p-2">
                              <p className="text-[10px] text-muted-foreground">Contact Number</p>
                              <p className="font-medium text-foreground">
                                {doc.structuredData.contactNumber}
                              </p>
                            </div>
                          )}
                          {doc.structuredData.referenceNumber && (
                            <div className="rounded border bg-card p-2">
                              <p className="text-[10px] text-muted-foreground">Reference / Slip No.</p>
                              <p className="font-medium text-foreground">
                                {doc.structuredData.referenceNumber}
                              </p>
                            </div>
                          )}
                          {doc.structuredData.date && (
                            <div className="rounded border bg-card p-2">
                              <p className="text-[10px] text-muted-foreground">Petition Date</p>
                              <p className="font-medium text-foreground">
                                {doc.structuredData.date}
                              </p>
                            </div>
                          )}
                          {doc.structuredData.category && (
                            <div className="rounded border bg-card p-2">
                              <p className="text-[10px] text-muted-foreground">Issue Category</p>
                              <p className="font-medium text-foreground">
                                {doc.structuredData.category}
                              </p>
                            </div>
                          )}
                          {(doc.structuredData.village ||
                            doc.structuredData.mandal ||
                            doc.structuredData.division ||
                            doc.structuredData.assemblyConstituency) && (
                            <div className="rounded border bg-card p-2">
                              <p className="text-[10px] text-muted-foreground">Location</p>
                              <p className="font-medium text-foreground">
                                {[
                                  doc.structuredData.village,
                                  doc.structuredData.mandal,
                                  doc.structuredData.division,
                                  doc.structuredData.assemblyConstituency,
                                ]
                                  .filter(Boolean)
                                  .join(", ")}
                              </p>
                            </div>
                          )}
                          {doc.structuredData.assignedOfficer && (
                            <div className="rounded border bg-card p-2">
                              <p className="text-[10px] text-muted-foreground">Assigned Officer</p>
                              <p className="font-medium text-foreground">
                                {doc.structuredData.assignedOfficer}
                              </p>
                            </div>
                          )}
                          {doc.structuredData.actionRequested && (
                            <div className="col-span-2 sm:col-span-3 rounded border bg-card p-2">
                              <p className="text-[10px] text-muted-foreground">Action Requested</p>
                              <p className="font-medium text-foreground">
                                {doc.structuredData.actionRequested}
                              </p>
                            </div>
                          )}
                          {doc.structuredData.issueSummary && (
                            <div className="col-span-2 sm:col-span-3 rounded border bg-card p-2">
                              <p className="text-[10px] text-muted-foreground">Issue Summary</p>
                              <p className="font-medium text-foreground">
                                {doc.structuredData.issueSummary}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Extracted Document Text */}
                    {doc.extractedText && (
                      <div>
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="font-semibold text-foreground">
                            Extracted Document Text & Layout
                          </span>
                          <button
                            type="button"
                            onClick={() => copyExtractedText(doc.id, doc.extractedText || "")}
                            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            {copiedId === doc.id ? (
                              <>
                                <Check className="size-2.5 text-emerald-600" />
                                Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="size-2.5" />
                                Copy Text
                              </>
                            )}
                          </button>
                        </div>
                        <div className="max-h-60 overflow-y-auto rounded border bg-background p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground selection:bg-primary/20">
                          {doc.extractedText}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        !uploading && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            No documents scanned yet. Upload grievance petition slips, recommendation letters, or photo proofs (PDF, JPG, PNG) to automatically scan and extract details using Grok AI.
          </p>
        )
      )}
    </div>
  );
}
