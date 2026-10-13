import { useEffect, useMemo, useState } from "react";
import { getNews } from "@/mediasphere/services/api.js";

type Article = {
  _id?: string;
  post_id?: string;
  title?: string;
  summary?: string;
  source?: string;
  sentiment?: string;
  category?: string;
  assembly_segment?: string;
  created_on?: string;
  source_url?: string;
};

function when(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

/** Read-only phone screen. One GET of articles already stored by the API. */
export default function PhoneNews() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    getNews()
      .then((data: { articles?: Article[] }) => {
        setArticles(data.articles || []);
      })
      .catch((err: unknown) => {
        setArticles([]);
        setError(err instanceof Error ? err.message : "Could not load articles");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let cancelled = false;
    getNews()
      .then((data: { articles?: Article[] }) => {
        if (!cancelled) setArticles(data.articles || []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setArticles([]);
        setError(err instanceof Error ? err.message : "Could not load articles");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return articles;
    return articles.filter((article) =>
      `${article.title || ""} ${article.summary || ""} ${article.assembly_segment || ""} ${article.source || ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [articles, query]);

  if (selected) {
    return (
      <div className="min-h-screen bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-foreground">
        <button type="button" onClick={() => setSelected(null)} className="text-sm font-medium text-primary">
          Back
        </button>
        <p className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">
          {[selected.assembly_segment, selected.source, selected.sentiment].filter(Boolean).join(" · ")}
        </p>
        <h1 className="mt-2 font-display text-2xl font-semibold leading-snug">{selected.title}</h1>
        <p className="mt-2 text-xs text-muted-foreground">{when(selected.created_on)}</p>
        <p className="mt-4 whitespace-pre-line text-sm leading-6">{selected.summary}</p>
        {selected.source_url ? (
          <a
            href={selected.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Open original
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-lg font-semibold">JanaVignanam</h1>
          <button type="button" onClick={load} className="min-h-11 px-2 text-sm text-primary" disabled={loading}>
            {loading ? "Loading" : "Reload"}
          </button>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search loaded articles"
          className="mt-2 h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </header>
      <main className="px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <p>{error}</p>
            <button type="button" onClick={load} className="mt-3 min-h-11 font-medium">
              Try again
            </button>
          </div>
        ) : null}
        {!loading && !error && visible.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No articles to show.</p>
        ) : null}
        <ul className="space-y-3">
          {visible.map((article) => (
            <li key={article._id || article.post_id || article.title}>
              <button
                type="button"
                onClick={() => setSelected(article)}
                className="w-full rounded-xl border bg-card p-4 text-left"
              >
                <p className="text-xs text-muted-foreground">
                  {[article.assembly_segment, article.category, article.sentiment].filter(Boolean).join(" · ")}
                </p>
                <h2 className="mt-1 font-medium leading-snug">{article.title}</h2>
                <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{article.summary}</p>
                <p className="mt-2 text-xs text-muted-foreground">{when(article.created_on)}</p>
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
