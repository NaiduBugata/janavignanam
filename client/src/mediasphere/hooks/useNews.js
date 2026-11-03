import { useCallback, useEffect, useRef, useState } from 'react';
import { getNews } from '../services/api';
import { sortByDateDesc } from '../utils/format';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let cachedNewsArticles = null;
let cachedDataRevision = null;

export function useNews() {
  const [articles, setArticles] = useState(() => cachedNewsArticles || []);
  const [loading, setLoading] = useState(() => !cachedNewsArticles);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(() => cachedNewsArticles ? new Date() : null);
  const [dataRevision, setDataRevision] = useState(() => cachedDataRevision);
  const dataRevisionRef = useRef(cachedDataRevision);

  const fetchNews = useCallback(async (options = {}) => {
    const isCached = cachedNewsArticles !== null;
    const { silent = isCached } = options;
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await getNews();
      const nextRevision = data.dataRevision || null;
      const revisionChanged =
        nextRevision != null && nextRevision !== dataRevisionRef.current;

      const sorted = sortByDateDesc(data.articles || []);
      cachedNewsArticles = sorted;
      cachedDataRevision = nextRevision;
      setArticles(sorted);
      setLastUpdated(new Date());
      if (nextRevision != null) {
        dataRevisionRef.current = nextRevision;
        setDataRevision(nextRevision);
      }

      // Revision is informational for consumers; payload already refreshed.
      if (silent && revisionChanged) {
        // Explicit no-op branch kept for clarity: silent poll already replaced articles.
      }
    } catch (err) {
      setError(err?.message || 'Failed to load news data');
      if (!silent) {
        setArticles([]);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchNews();

    const intervalId = setInterval(() => {
      fetchNews({ silent: true });
    }, REFRESH_INTERVAL_MS);

    const handleFocus = () => {
      fetchNews({ silent: true });
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchNews]);

  return {
    articles,
    loading,
    error,
    lastUpdated,
    dataRevision,
    refresh: fetchNews,
  };
}
