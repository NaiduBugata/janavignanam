import { apiUrl } from '../../lib/apiBase';

export interface ReportExportParams {
  format: 'pdf' | 'xlsx' | 'csv';
  source?: string;
  sentiment?: string;
  segment?: string;
  division?: string;
  category?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}

export async function downloadNewsReport(params: ReportExportParams, fallbackName: string): Promise<void> {
  const query = new URLSearchParams();
  query.set('format', params.format);
  if (params.source && params.source !== 'all') query.set('source', params.source);
  if (params.sentiment && params.sentiment !== 'all') query.set('sentiment', params.sentiment);
  if (params.segment && params.segment !== 'all') query.set('segment', params.segment);
  if (params.division && params.division !== 'all') query.set('division', params.division);
  if (params.category && params.category !== 'all') query.set('category', params.category);
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  if (params.search) query.set('search', params.search);

  const endpoint = apiUrl(`/api/news/reports/export?${query.toString()}`);
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Report export failed with status ${response.status}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  const contentDisposition = response.headers.get('Content-Disposition') || '';
  const match = /filename="([^"]+)"/.exec(contentDisposition);
  link.href = url;
  link.download = match?.[1] || fallbackName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
