import axios from 'axios';
import { newsApiBase } from '../../lib/apiBase';

const API_BASE = newsApiBase();

const api = axios.create({
  baseURL: API_BASE,
  timeout: 120000,
  headers: { 'Content-Type': 'application/json' },
});

export async function getNews() {
  // Cache-bust with `_t` only. Do NOT send Cache-Control/Pragma — those are
  // non-simple headers and production CORS currently rejects them in preflight
  // ("Request header field cache-control is not allowed"), which breaks the site.
  const { data } = await api.get('/news', {
    params: { _t: Date.now() },
  });
  return {
    articles: data.articles || [],
    count: data.count || 0,
    dataRevision: data.data_revision || null,
  };
}

export async function getStats() {
  const { data } = await api.get('/news/stats');
  return data;
}

export async function getNotificationStatus() {
  const { data } = await api.get('/notifications/status');
  return data;
}

export default api;
