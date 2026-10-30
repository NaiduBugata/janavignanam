import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import {
  Sparkles,
  Send,
  Search,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  Bot,
  HelpCircle,
  FileText,
  ShieldCheck,
  Hash,
} from "lucide-react";

interface SourceReference {
  document_id: string;
  document_name: string;
  chunk_id: string;
  chunk_index: number;
  score: number;
  content: string;
}

interface QueryResponse {
  query_id?: string;
  answer: string;
  sources: SourceReference[];
  has_context: boolean;
  engine?: string;
}

const QUICK_TOPICS = [
  { label: "SP", query: "SP", desc: "Superintendent of Police briefing" },
  { label: "CMRF", query: "CMRF", desc: "Medical assistance & relief" },
  { label: "Water", query: "water", desc: "Drinking water & pipelines" },
  { label: "Roads", query: "roads", desc: "Infrastructure & R&B works" },
  { label: "Theft", query: "theft", desc: "Police crime & recoveries" },
  { label: "Yashoda", query: "Yashoda", desc: "Cancer camp & health" },
  { label: "Chirala", query: "Chirala", desc: "RTC bus routes & roads" },
  { label: "Macherla", query: "Macherla", desc: "Constituency updates" },
  { label: "Sanitation", query: "sanitation", desc: "Drainage & civic issues" },
];

const SAMPLE_QUESTIONS = [
  "What are the major drinking water problems in Narasaraopet?",
  "Summarize key infrastructure and road works in Palnadu",
  "What are the top public grievances and pending actions?",
  "Recent constituency news and public sentiment summary",
];

export function MpRetrievalWindow() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [lastQuery, setLastQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleAsk = async (queryText?: string) => {
    const q = (queryText ?? question).trim();
    if (!q) return;

    if (queryText) {
      setQuestion(queryText);
    }

    setLastQuery(q);
    setLoading(true);
    setError(null);

    try {
      const data = await api<QueryResponse>("/api/rag/query", {
        method: "POST",
        body: { question: q },
      });
      setResponse(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error contacting retrieval engine");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (!response?.answer) return;
    navigator.clipboard.writeText(response.answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isSmallWord = question.trim().length > 0 && question.trim().length <= 4;

  return (
    <div className="mt-8 rounded-2xl border border-primary/20 bg-gradient-to-br from-card via-card to-primary/5 p-5 shadow-sm transition-all md:p-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Sparkles className="size-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
              MP Constituency Intelligence Desk
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex items-center gap-1 rounded-lg border border-border/60 bg-background/80 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted transition"
          >
            {isCollapsed ? (
              <>
                <span>Expand</span>
                <ChevronDown className="size-3.5" />
              </>
            ) : (
              <>
                <span>Collapse</span>
                <ChevronUp className="size-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="mt-4 space-y-4">
          {/* Quick Small-Word Topic Chips */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Hash className="size-3.5 text-primary" />
              Instant Topic & Keyword Search:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_TOPICS.map((topic) => (
                <button
                  key={topic.label}
                  type="button"
                  title={topic.desc}
                  onClick={() => handleAsk(topic.query)}
                  disabled={loading}
                  className="inline-flex items-center gap-1 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-medium text-foreground hover:border-primary/50 hover:bg-primary/10 transition disabled:opacity-50"
                >
                  <Search className="size-3 text-primary" />
                  <span>{topic.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Suggested Longer Questions */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <HelpCircle className="size-3.5 text-primary" />
              Suggested MP Queries:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_QUESTIONS.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => handleAsk(sample)}
                  disabled={loading}
                  className="rounded-lg border border-border/60 bg-background/70 px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground transition disabled:opacity-50 text-left"
                >
                  "{sample}"
                </button>
              ))}
            </div>
          </div>

          {/* Question Input Box */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAsk();
            }}
            className="relative"
          >
            <div className="overflow-hidden rounded-xl border border-border bg-background focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask any question or type a keyword (e.g., SP, CMRF, water, roads, Yashoda, theft)..."
                rows={2}
                disabled={loading}
                className="w-full resize-none bg-transparent px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
              />
              <div className="flex items-center justify-between border-t border-border/40 bg-muted/20 px-3 py-2">
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <ShieldCheck className="size-3.5 text-emerald-500" />
                  {isSmallWord
                    ? `Searching exact keyword & synonyms for "${question.trim()}"`
                    : "Grounded with multi-field search & source verification"}
                </span>
                <div className="flex items-center gap-2">
                  {question && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuestion("");
                        setResponse(null);
                        setError(null);
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={loading || !question.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 transition"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="size-3.5 animate-spin" />
                        <span>Searching...</span>
                      </>
                    ) : (
                      <>
                        <Send className="size-3.5" />
                        <span>{isSmallWord ? "Search Word" : "Ask Assistant"}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </form>

          {/* Error Message */}
          {error && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* Response Box */}
          {response && (
            <div className="rounded-xl border border-primary/20 bg-background/95 p-4 shadow-sm animate-in fade-in duration-200">
              <div className="mb-2 flex items-center justify-between border-b border-border/40 pb-2">
                <div className="flex items-center gap-2">
                  <Bot className="size-4 text-primary" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Verified Answer: "{lastQuery}"
                  </span>
                  {response.sources?.length > 0 && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      {response.sources.length} sources matched
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={copyToClipboard}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground rounded px-2 py-0.5 hover:bg-muted transition"
                  >
                    {copied ? (
                      <>
                        <Check className="size-3 text-emerald-500" />
                        <span className="text-emerald-500 font-medium">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="size-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Formatted Answer */}
              <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed whitespace-pre-line text-foreground/90">
                {response.answer}
              </div>

              {/* Retrieved Sources Accordion */}
              {response.sources?.length > 0 && (
                <div className="mt-4 border-t border-border/40 pt-3">
                  <button
                    type="button"
                    onClick={() => setSourcesOpen(!sourcesOpen)}
                    className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    <span className="flex items-center gap-1.5">
                      <BookOpen className="size-3.5 text-primary" />
                      Retrieved Evidence & Sources ({response.sources.length})
                    </span>
                    {sourcesOpen ? (
                      <ChevronUp className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                  </button>

                  {sourcesOpen && (
                    <div className="mt-2.5 space-y-2">
                      {response.sources.map((src, i) => (
                        <div
                          key={src.chunk_id || i}
                          className="rounded-lg border border-border/50 bg-muted/30 p-2.5 text-xs text-muted-foreground transition hover:bg-muted/50"
                        >
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="font-semibold text-foreground line-clamp-1">
                              {i + 1}. {src.document_name}
                            </span>
                            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-mono font-medium text-primary">
                              {(src.score * 100).toFixed(0)}% match
                            </span>
                          </div>
                          <p className="line-clamp-3 text-muted-foreground/90 leading-relaxed font-sans">
                            {src.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
