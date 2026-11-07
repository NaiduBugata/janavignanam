import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import {
  Send,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  FileText,
  ShieldCheck,
} from "lucide-react";

interface SourceReference {
  document_id: string;
  document_name: string;
  chunk_id: string;
  chunk_index: number;
  score: number;
  content: string;
}

interface AssistantNavigation {
  path: string;
  label: string;
  auto: boolean;
}

interface QueryResponse {
  query_id?: string;
  greeting?: string;
  summary?: string;
  answer: string;
  navigation?: AssistantNavigation | null;
  sources: SourceReference[];
  has_context: boolean;
  engine?: string;
}

export function MpRetrievalWindow() {
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [lastQuery, setLastQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      if (!loading && question.trim()) {
        void handleAsk();
      }
    }
  };

  const copyToClipboard = () => {
    if (!response?.answer) return;
    navigator.clipboard.writeText(response.answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isSmallWord = question.trim().length > 0 && question.trim().length <= 4;

  useEffect(() => {
    const target = response?.navigation;
    if (!target?.auto) return;
    const timer = window.setTimeout(() => navigate(target.path), 2200);
    return () => window.clearTimeout(timer);
  }, [response, navigate]);

  const openPage = (target: AssistantNavigation) => {
    navigate(target.path);
  };

  return (
    <div className="mt-8 rounded-2xl border border-primary/20 bg-gradient-to-br from-card via-card to-primary/5 p-5 shadow-sm transition-all md:p-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/50">
        <div className="flex items-center gap-3">
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
                onKeyDown={handleKeyDown}
                placeholder="Ask any question or type a keyword (e.g., SP, CMRF, water, roads, Yashoda, theft)..."
                rows={2}
                disabled={loading}
                className="w-full resize-none bg-transparent px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
              />
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/40 bg-muted/20 px-3 py-2">
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
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 transition cursor-pointer"
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

          {response && (
            <article className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <header className="flex flex-wrap items-start justify-between gap-3 bg-primary px-4 py-4 text-primary-foreground sm:px-5">
                <div className="min-w-0">
                  <p className="font-display text-lg font-semibold leading-snug">
                    {response.greeting || "Sri. Lavu Sri Krishna Devarayalu Sir."}
                  </p>
                  <p className="mt-1 text-sm text-primary-foreground/80">Asked: {lastQuery}</p>
                </div>
                <button
                  type="button"
                  onClick={copyToClipboard}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary-foreground/15 px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-foreground/25"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </header>

              <div className="space-y-4 p-4 sm:p-5">
                {response.summary && (
                  <section className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                      <ShieldCheck className="size-3.5" />
                      Summary
                    </div>
                    <div className="space-y-1.5">
                      {sentencesOf(response.summary).map((sentence, index) => (
                        <p key={sentence} className={index === 0 ? "text-sm font-medium leading-6 text-foreground" : "text-sm leading-6 text-muted-foreground"}>
                          {sentence}
                        </p>
                      ))}
                    </div>
                  </section>
                )}

                {response.navigation && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 px-3 py-2.5">
                    <p className="text-sm text-muted-foreground">
                      {response.navigation.auto
                        ? `Opening ${response.navigation.label}…`
                        : `The full list is on ${response.navigation.label}.`}
                    </p>
                    <button
                      type="button"
                      onClick={() => openPage(response.navigation as AssistantNavigation)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      <ExternalLink className="size-3.5" />
                      Open {response.navigation.label}
                    </button>
                  </div>
                )}

                <section>
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <FileText className="size-3.5" />
                    Briefing
                  </div>
                  <AnswerBody text={response.answer} />
                </section>

                {response.sources?.length > 0 && (
                  <section className="border-t pt-3">
                    <button
                      type="button"
                      onClick={() => setSourcesOpen(!sourcesOpen)}
                      className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-sm font-medium text-foreground hover:bg-muted/50"
                    >
                      <span className="flex items-center gap-2">
                        <BookOpen className="size-4 text-primary" />
                        Records used
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                          {response.sources.length}
                        </span>
                      </span>
                      {sourcesOpen ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                    </button>
                    {sourcesOpen && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {response.sources.map((src, index) => {
                          const facts = sourceFacts(src.content);
                          return (
                            <div key={src.chunk_id || index} className="rounded-xl border bg-background p-3">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-sm font-semibold leading-snug text-foreground">{src.document_name}</p>
                                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                  {Math.round(src.score * 100)}%
                                </span>
                              </div>
                              {facts.length > 0 ? (
                                <dl className="mt-2 space-y-1">
                                  {facts.slice(0, 4).map((fact) => (
                                    <div key={fact.label} className="grid grid-cols-[88px_1fr] gap-2 text-xs">
                                      <dt className="text-muted-foreground">{fact.label}</dt>
                                      <dd className="text-foreground">{fact.value}</dd>
                                    </div>
                                  ))}
                                </dl>
                              ) : (
                                <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{src.content}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                )}
              </div>
            </article>
          )}
        </div>
      )}
    </div>
  );
}

function sentencesOf(value: string): string[] {
  const parts = value
    .split(/(?<=\.)\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [value];
}

function sourceFacts(content: string): Array<{ label: string; value: string }> {
  return content
    .replace(/\s+/g, " ")
    .split(/\.\s+/)
    .map((part) => {
      const split = part.indexOf(":");
      if (split < 2 || split > 28) return null;
      const label = part.slice(0, split).trim();
      const value = part.slice(split + 1).replace(/\.$/, "").trim();
      if (!label || !value) return null;
      return { label, value };
    })
    .filter((fact): fact is { label: string; value: string } => Boolean(fact));
}

function AnswerBody({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flush = () => {
    if (!bullets.length) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={`list-${blocks.length}`} className="divide-y overflow-hidden rounded-xl border bg-background">
        {items.map((item, index) => (
          <li key={`${index}-${item}`} className="flex gap-3 px-4 py-3 text-sm leading-6 text-foreground">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
            <span>{richText(item)}</span>
          </li>
        ))}
      </ul>,
    );
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      return;
    }
    const bullet = /^(?:[-*•]|\d+[.)])\s+(.+)$/.exec(trimmed);
    if (bullet) {
      bullets.push(bullet[1]);
      return;
    }
    flush();
    const heading = /^\*\*([^*]+)\*\*$/.exec(trimmed);
    if (heading) {
      blocks.push(
        <h3 key={`h-${blocks.length}`} className="font-display text-base font-semibold text-foreground">
          {heading[1]}
        </h3>,
      );
      return;
    }
    blocks.push(
      <p key={`p-${blocks.length}`} className="text-sm leading-6 text-foreground">
        {richText(trimmed)}
      </p>,
    );
  });
  flush();

  if (!blocks.length) {
    return <p className="text-sm text-muted-foreground">No further detail was found for this question.</p>;
  }
  return <div className="space-y-3">{blocks}</div>;
}

function richText(value: string): React.ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/g).filter(Boolean).map((part, index) => {
    const strong = part.startsWith("**") && part.endsWith("**");
    const emphasis = !strong && part.startsWith("*") && part.endsWith("*") && part.length > 2;
    if (strong || emphasis) {
      return (
        <strong key={index} className="font-semibold text-foreground">
          {part.slice(strong ? 2 : 1, strong ? -2 : -1)}
        </strong>
      );
    }
    return <span key={index}>{part}</span>;
  });
}
