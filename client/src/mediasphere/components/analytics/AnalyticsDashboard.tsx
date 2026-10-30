import React, { useMemo, useState, useEffect } from 'react';
import {
  FileText,
  ThumbsUp,
  ThumbsDown,
  AlertTriangle,
  MinusCircle,
  Calendar,
  Download,
  Filter,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  LayoutGrid,
  Table as TableIcon,
  ExternalLink,
  RotateCcw,
  TrendingUp,
  BarChart2,
  PieChart as PieIcon,
  Check,
  FileSpreadsheet,
  X,
  Loader2,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useNewsContext } from '../../context/NewsContext';
import { divisionNames, divisionForMandal } from '@/places';
import { downloadNewsReport, type ReportExportParams } from '../../services/reportsApi';
import CategoryChip from '../common/CategoryChip';
import SentimentBadge from '../common/SentimentBadge';
import SourceBadge from '../common/SourceBadge';
import NewsModal from '../news/NewsModal';
import { formatRelativeTime, formatDate, truncate } from '../../utils/format';
import { isGrievanceOrProblem, enrichArticles } from '../../utils/derive';

const ASSEMBLY_SEGMENTS = [
  'Narasaraopet',
  'Vinukonda',
  'Chilakaluripet',
  'Macherla',
  'Sattenapalle',
  'Gurazala',
  'Pedakurapadu',
];

const CATEGORY_PALETTE = [
  '#1E3A8A', '#0D9488', '#D97706', '#E11D48', '#7C3AED',
  '#2563EB', '#059669', '#EA580C', '#4F46E5', '#64748B',
];

const SENTIMENT_COLORS: Record<string, string> = {
  Positive: '#16A34A',
  Negative: '#DC2626',
  Statement: '#475569',
  Neutral: '#64748B',
  Problem: '#D97706',
};

export type ReportTabType = 'all' | 'daily' | 'weekly' | 'monthly' | 'custom';

export function formatDateBadge(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function getWeekRange(endDateStr: string): { startStr: string; endStr: string } {
  const [y, m, d] = endDateStr.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1, d));
  const start = new Date(Date.UTC(y, m - 1, d - 6));
  return {
    startStr: start.toISOString().slice(0, 10),
    endStr: endDateStr,
  };
}

export function getMonthRange(yearMonth: string): { startStr: string; endStr: string; monthLabel: string } {
  const [year, month] = yearMonth.split('-').map(Number);
  const startStr = `${yearMonth}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endStr = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return { startStr, endStr, monthLabel: monthName };
}

export function validateSelectedFilter(
  type: ReportTabType,
  dailyDate: string,
  weeklyEndDate: string,
  monthlyYM: string,
  customStart: string,
  customEnd: string,
): string | null {
  if (type === 'daily') {
    if (!dailyDate) return 'Please select a date for the Daily Report.';
  } else if (type === 'weekly') {
    if (!weeklyEndDate) return 'Please select a week-ending date for the Weekly Report.';
  } else if (type === 'monthly') {
    if (!monthlyYM) return 'Please select a month for the Monthly Report.';
  } else if (type === 'custom') {
    if (!customStart || !customEnd) return 'Please select both start and end dates.';
    if (customStart > customEnd) return 'Start date cannot be later than end date.';
  }
  return null;
}

export interface ArticleData {
  _id?: string;
  id?: string;
  post_id?: string;
  title: string;
  description?: string;
  summary?: string;
  snippet?: string;
  source?: string;
  url?: string;
  sentiment?: string;
  category?: string;
  assembly_segment?: string;
  division?: string;
  created_on?: string;
  first_seen_at?: string;
  is_problem?: boolean;
  priority?: string;
  [key: string]: unknown;
}

interface NewsContextType {
  articles?: ArticleData[];
  loading?: boolean;
  error?: string | null;
  stats?: Record<string, unknown>;
}

interface TwoChartsProps {
  articles: ArticleData[];
  trendView: 'timeline' | 'constituency';
  setTrendView: (v: 'timeline' | 'constituency') => void;
  activeCategory?: string;
}

function AnalyticsTwoCharts({
  articles,
  trendView,
  setTrendView,
  activeCategory = 'all',
}: TwoChartsProps) {
  const chartData = useMemo(() => {
    const total = articles.length;
    const pos = articles.filter((a) => a.sentiment === 'Positive').length;
    const neg = articles.filter((a) => a.sentiment === 'Negative').length;
    const neut = articles.filter((a) => a.sentiment === 'Statement' || a.sentiment === 'Neutral').length;
    const prob = articles.filter((a) => isGrievanceOrProblem(a)).length;

    // Daily volume trend
    const dateCounts: Record<string, number> = {};
    articles.forEach((a) => {
      const d = (a.created_on || a.first_seen_at || '').slice(0, 10);
      if (d) dateCounts[d] = (dateCounts[d] || 0) + 1;
    });
    const trendData = Object.keys(dateCounts)
      .sort()
      .map((date) => ({ date, count: dateCounts[date] }));

    // Constituency breakdown (7 assembly segments)
    const segCounts: Record<string, number> = {};
    articles.forEach((a) => {
      const s = a.assembly_segment || 'Narasaraopet';
      segCounts[s] = (segCounts[s] || 0) + 1;
    });
    const segmentData = Object.entries(segCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    // Sentiment / Category distribution for Donut Chart
    let donutTitle = 'Sentiment Distribution';
    let donutItems: { name: string; count: number; fill: string }[] = [];

    if (activeCategory === 'all') {
      donutTitle = 'Sentiment Distribution';
      donutItems = [
        { name: 'Positive', count: pos, fill: '#10B981' },
        { name: 'Negative', count: neg, fill: '#EF4444' },
        { name: 'Problems', count: prob, fill: '#F59E0B' },
        { name: 'Statements', count: neut, fill: '#64748B' },
      ].filter((s) => s.count > 0);
    } else {
      // Category Breakdown within the filtered sentiment
      const catCounts: Record<string, number> = {};
      articles.forEach((a) => {
        const c = a.category || 'Other';
        catCounts[c] = (catCounts[c] || 0) + 1;
      });
      const palette = ['#0D9488', '#2563EB', '#F59E0B', '#EF4444', '#8B5CF6', '#10B981', '#64748B'];
      donutTitle = `${activeCategory.charAt(0).toUpperCase() + activeCategory.slice(1)}: Topic Breakdown`;
      donutItems = Object.entries(catCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, count], idx) => ({
          name,
          count,
          fill: palette[idx % palette.length],
        }));
    }

    return { total, pos, neg, neut, prob, trendData, segmentData, donutTitle, donutItems };
  }, [articles, activeCategory]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* CHART 1: Sentiment / Category Donut Chart */}
      <div className="rounded-xl border bg-card p-4.5 shadow-xs flex flex-col justify-between">
        <div className="flex items-center justify-between pb-2 border-b">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <PieIcon className="size-3.5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">
                {chartData.donutTitle}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Proportion and volume across active records
              </p>
            </div>
          </div>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-foreground">
            {chartData.total} Articles
          </span>
        </div>

        <div className="h-60 w-full mt-3">
          {chartData.donutItems.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData.donutItems}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={3}
                >
                  {chartData.donutItems.map((entry, index) => (
                    <Cell key={`donut-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload as { name: string; count: number; fill: string };
                      const pct = chartData.total > 0 ? ((data.count / chartData.total) * 100).toFixed(1) : 0;
                      return (
                        <div className="rounded-lg bg-[#0F172A] border border-slate-700 p-2 text-white text-xs shadow-lg">
                          <p className="font-bold flex items-center gap-1.5">
                            <span className="size-2 rounded-full inline-block" style={{ backgroundColor: data.fill }} />
                            {data.name}
                          </p>
                          <p className="text-slate-300 mt-0.5">
                            {data.count} articles ({pct}%)
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              No distribution data available for current selection
            </div>
          )}
        </div>

        {/* Legend with percentages and counts */}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-2 border-t text-xs">
          {chartData.donutItems.map((item) => {
            const pct = chartData.total > 0 ? Math.round((item.count / chartData.total) * 100) : 0;
            return (
              <div key={item.name} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: item.fill }} />
                <span className="text-muted-foreground">{item.name}:</span>
                <span className="font-semibold text-foreground">
                  {item.count} ({pct}%)
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* CHART 2: News Trends (Bar Chart with Toggle) */}
      <div className="rounded-xl border bg-card p-4.5 shadow-xs flex flex-col justify-between">
        <div className="flex items-center justify-between pb-2 border-b">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <BarChart2 className="size-3.5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">
                News Trends & Volume
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {trendView === 'timeline' ? 'Daily publication trend' : 'Constituency assembly comparison'}
              </p>
            </div>
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => setTrendView('timeline')}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-all ${
                trendView === 'timeline'
                  ? 'bg-card text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Volume Trend
            </button>
            <button
              type="button"
              onClick={() => setTrendView('constituency')}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-all ${
                trendView === 'constituency'
                  ? 'bg-card text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              By Constituency
            </button>
          </div>
        </div>

        <div className="h-64 w-full mt-3">
          {trendView === 'timeline' ? (
            chartData.trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData.trendData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0F172A',
                      borderColor: '#334155',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="count" name="Articles" fill="#1E3A8A" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                No timeline data available for this filter
              </div>
            )
          ) : (
            chartData.segmentData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData.segmentData} layout="vertical" margin={{ left: 15 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={85} tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0F172A',
                      borderColor: '#334155',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="count" name="Articles" fill="#2563EB" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                No constituency data available for this filter
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default function AnalyticsDashboard() {
  const context = (useNewsContext?.() || {}) as NewsContextType;
  const initialArticles: ArticleData[] = useMemo(() => (context.articles || []), [context.articles]);
  const loading = context.loading;
  const error = context.error;
  const stats = context.stats;

  // Compute earliest and latest available dates
  const availableDates = useMemo(() => {
    if (initialArticles.length === 0) {
      return { latest: '2026-10-30', earliest: '2026-10-01' };
    }
    const dates = initialArticles
      .map((a) => (a.created_on || a.first_seen_at || '').slice(0, 10))
      .filter(Boolean)
      .sort();
    return {
      latest: dates.length > 0 ? dates[dates.length - 1] : '2026-10-30',
      earliest: dates.length > 0 ? dates[0] : '2026-10-01',
    };
  }, [initialArticles]);

  // Navigation & View Mode
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [isNavActive, setIsNavActive] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Multi-dimensional Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSegment, setSelectedSegment] = useState('all');
  const [selectedDivision, setSelectedDivision] = useState('all');
  const [selectedSource, setSelectedSource] = useState('all');
  const [selectedNewsCategory, setSelectedNewsCategory] = useState('all');

  // Periodic Report Mode & Dates (Draft / Selected State)
  const [selectedReportTab, setSelectedReportTab] = useState<ReportTabType>('all');
  const [trendView, setTrendView] = useState<'timeline' | 'constituency'>('timeline');
  const [selectedDailyDateState, setSelectedDailyDateState] = useState<string | null>(null);
  const [selectedWeeklyEndDateState, setSelectedWeeklyEndDateState] = useState<string | null>(null);
  const [selectedMonthlyYearMonthState, setSelectedMonthlyYearMonthState] = useState<string | null>(null);
  const [selectedCustomStartDateState, setSelectedCustomStartDateState] = useState<string | null>(null);
  const [selectedCustomEndDateState, setSelectedCustomEndDateState] = useState<string | null>(null);

  const selectedDailyDate = selectedDailyDateState || availableDates.latest;
  const selectedWeeklyEndDate = selectedWeeklyEndDateState || availableDates.latest;
  const selectedMonthlyYearMonth = selectedMonthlyYearMonthState || availableDates.latest.slice(0, 7);
  const selectedCustomStartDate = selectedCustomStartDateState || availableDates.earliest;
  const selectedCustomEndDate = selectedCustomEndDateState || availableDates.latest;

  const [dateValidationError, setDateValidationError] = useState<string | null>(null);
  const [periodicDownloading, setPeriodicDownloading] = useState(false);
  const [periodicError, setPeriodicError] = useState<string | null>(null);

  // Dynamic button label based on selected periodic report tab
  const periodicDownloadButtonLabel = useMemo(() => {
    switch (selectedReportTab) {
      case 'all':
        return 'Download All Records';
      case 'daily':
        return 'Download Daily Report';
      case 'weekly':
        return 'Download Weekly Report';
      case 'monthly':
        return 'Download Monthly Report';
      case 'custom':
        return 'Download Custom Report';
      default:
        return 'Download Report';
    }
  }, [selectedReportTab]);

  // Periodic Report Download Handler (Validates & downloads matching report directly)
  const handlePeriodicDownload = async (format: 'pdf' | 'xlsx' | 'csv' = 'pdf') => {
    const validationMsg = validateSelectedFilter(
      selectedReportTab,
      selectedDailyDate,
      selectedWeeklyEndDate,
      selectedMonthlyYearMonth,
      selectedCustomStartDate,
      selectedCustomEndDate,
    );
    if (validationMsg) {
      setDateValidationError(validationMsg);
      return;
    }
    setDateValidationError(null);
    setPeriodicError(null);
    setPeriodicDownloading(true);

    try {
      let startDate: string | undefined;
      let endDate: string | undefined;
      const todayStr = new Date().toISOString().slice(0, 10);
      let filename: string;

      if (selectedReportTab === 'daily') {
        startDate = selectedDailyDate;
        endDate = selectedDailyDate;
        filename = `Analytics_Daily_${selectedDailyDate}.${format}`;
      } else if (selectedReportTab === 'weekly') {
        const { startStr, endStr } = getWeekRange(selectedWeeklyEndDate);
        startDate = startStr;
        endDate = endStr;
        filename = `Analytics_Weekly_${startStr}_to_${endStr}.${format}`;
      } else if (selectedReportTab === 'monthly') {
        const { startStr, endStr } = getMonthRange(selectedMonthlyYearMonth);
        startDate = startStr;
        endDate = endStr;
        filename = `Analytics_Monthly_${selectedMonthlyYearMonth}.${format}`;
      } else if (selectedReportTab === 'custom') {
        startDate = selectedCustomStartDate;
        endDate = selectedCustomEndDate;
        filename = `Analytics_Custom_${selectedCustomStartDate}_to_${selectedCustomEndDate}.${format}`;
      } else {
        startDate = undefined;
        endDate = undefined;
        filename = `Analytics_All_Records_${todayStr}.${format}`;
      }

      const params: ReportExportParams = {
        format,
        periodType: selectedReportTab,
        startDate,
        endDate,
      };

      await downloadNewsReport(params, filename);
      setDownloadStatus(`${periodicDownloadButtonLabel} downloaded successfully!`);
      setTimeout(() => setDownloadStatus(null), 3500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to download report';
      setPeriodicError(msg);
      setTimeout(() => setPeriodicError(null), 5000);
    } finally {
      setPeriodicDownloading(false);
    }
  };

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  // Modal & Download states
  const [modalArticle, setModalArticle] = useState<ArticleData | null>(null);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);

  // Administrative Divisions
  const divisions = useMemo(() => divisionNames(), []);

  // Overall categories from initial dataset
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    initialArticles.forEach((a) => {
      if (a.category) set.add(a.category);
    });
    return Array.from(set).sort();
  }, [initialArticles]);

  // Overall article counts by category tab for main dashboard
  const categoryCounts = useMemo(() => {
    const total = initialArticles.length;
    const positive = initialArticles.filter((a) => a.sentiment === 'Positive').length;
    const negative = initialArticles.filter((a) => a.sentiment === 'Negative').length;
    const neutral = initialArticles.filter((a) => a.sentiment === 'Statement' || a.sentiment === 'Neutral').length;
    const problems = initialArticles.filter((a) => isGrievanceOrProblem(a)).length;

    return {
      all: total,
      positive,
      negative,
      problems,
      neutral,
    };
  }, [initialArticles]);

  // Handle card click -> smooth transition to filtered results
  const handleCardClick = (category: string) => {
    setActiveCategory(category);
    setIsNavActive(true);
    setCurrentPage(1);
  };

  const handleBackToOverview = () => {
    setIsNavActive(false);
    setActiveCategory('all');
    setCurrentPage(1);
  };

  // Filtered articles list based on active filters (powered by initialArticles)
  const filteredArticles = useMemo(() => {
    return initialArticles.filter((art: ArticleData) => {
      // 1. Category Tab Filter
      if (activeCategory === 'positive' && art.sentiment !== 'Positive') return false;
      if (activeCategory === 'negative' && art.sentiment !== 'Negative') return false;
      if (activeCategory === 'neutral' && art.sentiment !== 'Statement' && art.sentiment !== 'Neutral') return false;
      if (activeCategory === 'problems' && !isGrievanceOrProblem(art)) return false;

      // 2. Assembly Segment Filter
      if (selectedSegment !== 'all' && (art.assembly_segment || '').toLowerCase() !== selectedSegment.toLowerCase()) {
        return false;
      }

      // 3. Division Filter
      if (selectedDivision !== 'all') {
        const artLocation = art.location as { mandal?: string } | undefined;
        const artMandal = artLocation?.mandal || '';
        const artDivision = divisionForMandal(artMandal);
        if (artDivision.toLowerCase() !== selectedDivision.toLowerCase()) {
          return false;
        }
      }

      // 4. Source Filter
      if (selectedSource !== 'all' && (art.source || 'lokal').toLowerCase() !== selectedSource.toLowerCase()) {
        return false;
      }

      // 5. News Category Filter
      if (selectedNewsCategory !== 'all' && (art.category || '').toLowerCase() !== selectedNewsCategory.toLowerCase()) {
        return false;
      }

      // 6. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesTitle = (art.title || '').toLowerCase().includes(q);
        const matchesSummary = (art.summary || '').toLowerCase().includes(q);
        const matchesSegment = (art.assembly_segment || '').toLowerCase().includes(q);
        if (!matchesTitle && !matchesSummary && !matchesSegment) return false;
      }

      return true;
    });
  }, [
    initialArticles,
    activeCategory,
    selectedSegment,
    selectedDivision,
    selectedSource,
    selectedNewsCategory,
    searchQuery,
  ]);

  // Periodic report filtered articles based on selected tab and date controls
  const periodicFilteredArticles = useMemo(() => {
    if (selectedReportTab === 'all') {
      return initialArticles;
    }
    const getDate = (a: ArticleData) => (a.created_on || a.first_seen_at || '').slice(0, 10);

    if (selectedReportTab === 'daily') {
      return initialArticles.filter((a) => getDate(a) === selectedDailyDate);
    }
    if (selectedReportTab === 'weekly') {
      const { startStr, endStr } = getWeekRange(selectedWeeklyEndDate);
      return initialArticles.filter((a) => {
        const d = getDate(a);
        return d && d >= startStr && d <= endStr;
      });
    }
    if (selectedReportTab === 'monthly') {
      return initialArticles.filter((a) => getDate(a).startsWith(selectedMonthlyYearMonth));
    }
    if (selectedReportTab === 'custom') {
      return initialArticles.filter((a) => {
        const d = getDate(a);
        return d && d >= selectedCustomStartDate && d <= selectedCustomEndDate;
      });
    }
    return initialArticles;
  }, [
    initialArticles,
    selectedReportTab,
    selectedDailyDate,
    selectedWeeklyEndDate,
    selectedMonthlyYearMonth,
    selectedCustomStartDate,
    selectedCustomEndDate,
  ]);

  // Periodic report calculations for Section 4 preview metrics and charts
  const periodicReportData = useMemo(() => {
    const dataset = periodicFilteredArticles;
    let title = 'Overall Constituency Intelligence';
    let description = 'Constituency news intelligence for All Records';

    if (selectedReportTab === 'daily') {
      title = `Daily News Report (${formatDateBadge(selectedDailyDate)})`;
      description = `Constituency news intelligence for ${formatDateBadge(selectedDailyDate)}`;
    } else if (selectedReportTab === 'weekly') {
      const { startStr, endStr } = getWeekRange(selectedWeeklyEndDate);
      title = `Weekly Analysis (${formatDateBadge(startStr)} to ${formatDateBadge(endStr)})`;
      description = `Constituency news intelligence for ${formatDateBadge(startStr)} to ${formatDateBadge(endStr)}`;
    } else if (selectedReportTab === 'monthly') {
      const { monthLabel } = getMonthRange(selectedMonthlyYearMonth);
      title = `Monthly Constituency Report - ${monthLabel}`;
      description = `Constituency news intelligence for ${monthLabel}`;
    } else if (selectedReportTab === 'custom') {
      title = `Custom Date Range (${formatDateBadge(selectedCustomStartDate)} to ${formatDateBadge(selectedCustomEndDate)})`;
      description = `Constituency news intelligence from ${formatDateBadge(selectedCustomStartDate)} to ${formatDateBadge(selectedCustomEndDate)}`;
    }

    const total = dataset.length;
    const pos = dataset.filter((a: ArticleData) => a.sentiment === 'Positive').length;
    const neg = dataset.filter((a: ArticleData) => a.sentiment === 'Negative').length;
    const neut = dataset.filter((a: ArticleData) => a.sentiment === 'Statement' || a.sentiment === 'Neutral').length;
    const prob = dataset.filter((a: ArticleData) => isGrievanceOrProblem(a)).length;

    // Daily distribution trend
    const dateCounts: Record<string, number> = {};
    dataset.forEach((a: ArticleData) => {
      const d = (a.created_on || a.first_seen_at || '').slice(0, 10);
      if (d) dateCounts[d] = (dateCounts[d] || 0) + 1;
    });
    const trendData = Object.keys(dateCounts)
      .sort()
      .map((dt) => ({ date: dt, count: dateCounts[dt] }));

    // Constituency breakdown
    const segCounts: Record<string, number> = {};
    dataset.forEach((a: ArticleData) => {
      const s = a.assembly_segment || 'Narasaraopet';
      segCounts[s] = (segCounts[s] || 0) + 1;
    });
    const segmentData = Object.entries(segCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    // Source breakdown
    const srcCounts: Record<string, number> = {};
    dataset.forEach((a: ArticleData) => {
      const s = a.source || 'lokal';
      srcCounts[s] = (srcCounts[s] || 0) + 1;
    });
    const sourceData = Object.entries(srcCounts).map(([name, count]) => ({ name, count }));

    // Category breakdown
    const catCounts: Record<string, number> = {};
    dataset.forEach((a: ArticleData) => {
      const c = a.category || 'Other';
      catCounts[c] = (catCounts[c] || 0) + 1;
    });
    const categoryData = Object.entries(catCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    // Sentiment breakdown
    const sentimentData = [
      { name: 'Positive', count: pos, fill: SENTIMENT_COLORS.Positive },
      { name: 'Negative', count: neg, fill: SENTIMENT_COLORS.Negative },
      { name: 'Statements', count: neut, fill: SENTIMENT_COLORS.Statement },
      { name: 'Problems', count: prob, fill: SENTIMENT_COLORS.Problem },
    ].filter((s) => s.count > 0);

    return {
      title,
      description,
      articles: dataset,
      total,
      pos,
      neg,
      neut,
      prob,
      trendData,
      segmentData,
      sourceData,
      categoryData,
      sentimentData,
    };
  }, [
    periodicFilteredArticles,
    selectedReportTab,
    selectedDailyDate,
    selectedWeeklyEndDate,
    selectedMonthlyYearMonth,
    selectedCustomStartDate,
    selectedCustomEndDate,
  ]);

  // Paginated articles for the results section
  const totalPages = Math.ceil(filteredArticles.length / itemsPerPage) || 1;
  const paginatedArticles = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredArticles.slice(start, start + itemsPerPage);
  }, [filteredArticles, currentPage]);

  // Top Action Bar Download Report (Maintains existing complete dataset download functionality)
  const handleExport = async (format: 'pdf' | 'xlsx' | 'csv') => {
    try {
      setDownloading(true);
      setDownloadMenuOpen(false);
      setDownloadStatus(`Generating ${format.toUpperCase()} report...`);

      const params: ReportExportParams = {
        format,
        periodType: 'all',
        sentiment: activeCategory !== 'all' ? activeCategory : undefined,
        segment: selectedSegment !== 'all' ? selectedSegment : undefined,
        division: selectedDivision !== 'all' ? selectedDivision : undefined,
        category: selectedNewsCategory !== 'all' ? selectedNewsCategory : undefined,
        source: selectedSource !== 'all' ? selectedSource : undefined,
        search: searchQuery.trim() || undefined,
      };

      const todayStr = new Date().toISOString().slice(0, 10);
      const filename = `Analytics_All_Records_${todayStr}.${format}`;

      await downloadNewsReport(params, filename);
      setDownloadStatus(`${format.toUpperCase()} report downloaded successfully!`);
      setTimeout(() => setDownloadStatus(null), 3500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error generating report';
      setDownloadStatus(`Export failed: ${msg}`);
      setTimeout(() => setDownloadStatus(null), 4000);
    } finally {
      setDownloading(false);
    }
  };

  const resetAllFilters = () => {
    setSearchQuery('');
    setSelectedSegment('all');
    setSelectedDivision('all');
    setSelectedSource('all');
    setSelectedNewsCategory('all');
    setCurrentPage(1);
  };

  return (
    <div className="space-y-6">
      {/* SECTION 1: HEADER & OVERVIEW / ACTIONS */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground font-display">
              Analytics Dashboard
            </h1>
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              Live DB
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Constituency trends, grievance tracking, and periodic legislative analysis
          </p>
        </div>

        {/* Action Controls & Download Button */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {/* Download Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setDownloadMenuOpen(!downloadMenuOpen)}
              disabled={downloading}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-60"
            >
              {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              <span>{downloading ? 'Exporting...' : 'Download Report'}</span>
            </button>

            {downloadMenuOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-xl border bg-card p-1.5 shadow-xl z-30">
                <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b mb-1">
                  Export Options
                </div>
                <button
                  type="button"
                  onClick={() => handleExport('pdf')}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-muted transition-colors"
                >
                  <FileText className="size-4 text-red-600 shrink-0" />
                  <div>
                    <p className="font-medium">Download PDF Report</p>
                    <p className="text-xs text-muted-foreground">Formatted summary & records</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('xlsx')}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-muted transition-colors"
                >
                  <FileSpreadsheet className="size-4 text-green-600 shrink-0" />
                  <div>
                    <p className="font-medium">Download Excel (.xlsx)</p>
                    <p className="text-xs text-muted-foreground">Structured multi-sheet report</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('csv')}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-muted transition-colors"
                >
                  <TableIcon className="size-4 text-blue-600 shrink-0" />
                  <div>
                    <p className="font-medium">Download CSV</p>
                    <p className="text-xs text-muted-foreground">Plain comma-separated data</p>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Download Alert Toast */}
      {downloadStatus && (
        <div className="rounded-lg bg-primary/10 border border-primary/20 px-4 py-2.5 text-sm font-medium text-primary flex items-center justify-between">
          <span>{downloadStatus}</span>
          <button type="button" onClick={() => setDownloadStatus(null)} className="text-primary hover:opacity-75">
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* SECTION 2: CARD-TO-NAVIGATION ANIMATION (Section 4) */}
      {!isNavActive ? (
        /* STATE A: Full Overview Cards */
        <div className="transition-all duration-300 ease-in-out">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
            {/* Card 1: Total Articles */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => handleCardClick('all')}
              className="rounded-xl border bg-card p-4 sm:p-5 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Articles
                </span>
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <FileText className="size-4" />
                </div>
              </div>
              <p className="mt-2 text-2xl sm:text-3xl font-bold font-display text-foreground">
                {categoryCounts.all.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Total constituency news</p>
            </div>

            {/* Card 2: Positive */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => handleCardClick('positive')}
              className="rounded-xl border bg-card p-4 sm:p-5 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Positive
                </span>
                <div className="flex size-8 items-center justify-center rounded-lg bg-green-500/10 text-green-600 group-hover:bg-green-600 group-hover:text-white transition-colors">
                  <ThumbsUp className="size-4" />
                </div>
              </div>
              <p className="mt-2 text-2xl sm:text-3xl font-bold font-display text-foreground">
                {categoryCounts.positive.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Developments & achievements</p>
            </div>

            {/* Card 3: Negative */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => handleCardClick('negative')}
              className="rounded-xl border bg-card p-4 sm:p-5 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Negative
                </span>
                <div className="flex size-8 items-center justify-center rounded-lg bg-red-500/10 text-red-600 group-hover:bg-red-600 group-hover:text-white transition-colors">
                  <ThumbsDown className="size-4" />
                </div>
              </div>
              <p className="mt-2 text-2xl sm:text-3xl font-bold font-display text-foreground">
                {categoryCounts.negative.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Critical reports & issues</p>
            </div>

            {/* Card 4: Problems & Grievances */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => handleCardClick('problems')}
              className="rounded-xl border bg-card p-4 sm:p-5 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Problems
                </span>
                <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 group-hover:bg-amber-600 group-hover:text-white transition-colors">
                  <AlertTriangle className="size-4" />
                </div>
              </div>
              <p className="mt-2 text-2xl sm:text-3xl font-bold font-display text-foreground">
                {categoryCounts.problems.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Public grievances & civic issues</p>
            </div>

            {/* Card 5: Neutral / Statements */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => handleCardClick('neutral')}
              className="rounded-xl border bg-card p-4 sm:p-5 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer group col-span-2 sm:col-span-1"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Neutral
                </span>
                <div className="flex size-8 items-center justify-center rounded-lg bg-slate-500/10 text-slate-600 group-hover:bg-slate-700 group-hover:text-white transition-colors">
                  <MinusCircle className="size-4" />
                </div>
              </div>
              <p className="mt-2 text-2xl sm:text-3xl font-bold font-display text-foreground">
                {categoryCounts.neutral.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Official releases & statements</p>
            </div>
          </div>
        </div>
      ) : (
        /* STATE B: Compact Horizontal Animated Navigation Bar */
        <div className="sticky top-20 z-20 rounded-xl border bg-card/95 backdrop-blur p-2 shadow-sm transition-all duration-300 ease-in-out">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Back Button & Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
              <button
                type="button"
                onClick={handleBackToOverview}
                className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors mr-1"
              >
                <ArrowLeft className="size-3.5" />
                <span>Overview</span>
              </button>

              {/* Navigation Pill 1: All Articles */}
              <button
                type="button"
                onClick={() => { setActiveCategory('all'); setCurrentPage(1); }}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  activeCategory === 'all'
                    ? 'bg-[#fbf7ee] text-primary border border-[#d4af37]/60 shadow-xs dark:bg-[#2a2418] dark:text-[#f5eedc]'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <FileText className="size-3.5" />
                <span>All Articles</span>
                <span className="rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] font-bold">
                  {categoryCounts.all}
                </span>
              </button>

              {/* Navigation Pill 2: Positive */}
              <button
                type="button"
                onClick={() => { setActiveCategory('positive'); setCurrentPage(1); }}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  activeCategory === 'positive'
                    ? 'bg-[#fbf7ee] text-primary border border-[#d4af37]/60 shadow-xs dark:bg-[#2a2418] dark:text-[#f5eedc]'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <ThumbsUp className="size-3.5 text-green-600" />
                <span>Positive</span>
                <span className="rounded-full bg-green-500/10 px-1.5 py-0.2 text-[10px] font-bold text-green-600">
                  {categoryCounts.positive}
                </span>
              </button>

              {/* Navigation Pill 3: Negative */}
              <button
                type="button"
                onClick={() => { setActiveCategory('negative'); setCurrentPage(1); }}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  activeCategory === 'negative'
                    ? 'bg-[#fbf7ee] text-primary border border-[#d4af37]/60 shadow-xs dark:bg-[#2a2418] dark:text-[#f5eedc]'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <ThumbsDown className="size-3.5 text-red-600" />
                <span>Negative</span>
                <span className="rounded-full bg-red-500/10 px-1.5 py-0.2 text-[10px] font-bold text-red-600">
                  {categoryCounts.negative}
                </span>
              </button>

              {/* Navigation Pill 4: Problems */}
              <button
                type="button"
                onClick={() => { setActiveCategory('problems'); setCurrentPage(1); }}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  activeCategory === 'problems'
                    ? 'bg-[#fbf7ee] text-primary border border-[#d4af37]/60 shadow-xs dark:bg-[#2a2418] dark:text-[#f5eedc]'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <AlertTriangle className="size-3.5 text-amber-600" />
                <span>Problems</span>
                <span className="rounded-full bg-amber-500/10 px-1.5 py-0.2 text-[10px] font-bold text-amber-600">
                  {categoryCounts.problems}
                </span>
              </button>

              {/* Navigation Pill 5: Neutral */}
              <button
                type="button"
                onClick={() => { setActiveCategory('neutral'); setCurrentPage(1); }}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  activeCategory === 'neutral'
                    ? 'bg-[#fbf7ee] text-primary border border-[#d4af37]/60 shadow-xs dark:bg-[#2a2418] dark:text-[#f5eedc]'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <MinusCircle className="size-3.5 text-slate-500" />
                <span>Neutral</span>
                <span className="rounded-full bg-slate-500/10 px-1.5 py-0.2 text-[10px] font-bold text-slate-600">
                  {categoryCounts.neutral}
                </span>
              </button>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center gap-1 border-l pl-2">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md ${viewMode === 'grid' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title="Grid view"
              >
                <LayoutGrid className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded-md ${viewMode === 'table' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title="Table view"
              >
                <TableIcon className="size-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: MULTI-DIMENSIONAL FILTER CONTROLS */}
      {isNavActive && (
        <div className="rounded-xl border bg-card p-4 shadow-xs space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                placeholder="Search headline or summary..."
                className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-xs outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Assembly Segment Dropdown (7 Segments) */}
            <div>
              <select
                value={selectedSegment}
                onChange={(e) => { setSelectedSegment(e.target.value); setCurrentPage(1); }}
                className="h-9 w-full rounded-lg border bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="all">All Assembly Segments</option>
                {ASSEMBLY_SEGMENTS.map((seg) => (
                  <option key={seg} value={seg}>
                    {seg}
                  </option>
                ))}
              </select>
            </div>

            {/* Administrative Division Dropdown */}
            <div>
              <select
                value={selectedDivision}
                onChange={(e) => { setSelectedDivision(e.target.value); setCurrentPage(1); }}
                className="h-9 w-full rounded-lg border bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="all">All Administrative Divisions</option>
                {divisions.map((div) => (
                  <option key={div} value={div}>
                    {div} Division
                  </option>
                ))}
              </select>
            </div>

            {/* News Source Dropdown */}
            <div>
              <select
                value={selectedSource}
                onChange={(e) => { setSelectedSource(e.target.value); setCurrentPage(1); }}
                className="h-9 w-full rounded-lg border bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="all">All News Sources</option>
                <option value="sakshi">Sakshi Telugu</option>
                <option value="youtube">YouTube Channels</option>
                <option value="lokal">Lokal App</option>
              </select>
            </div>

            {/* Category Dropdown */}
            <div>
              <select
                value={selectedNewsCategory}
                onChange={(e) => { setSelectedNewsCategory(e.target.value); setCurrentPage(1); }}
                className="h-9 w-full rounded-lg border bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="all">All News Categories</option>
                {availableCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Filter Status Bar & Reset */}
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t">
            <span>
              Showing <strong className="text-foreground">{filteredArticles.length}</strong> matching articles
              {activeCategory !== 'all' && ` in ${activeCategory}`}
            </span>
            <button
              type="button"
              onClick={resetAllFilters}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              <RotateCcw className="size-3" />
              Reset all filters
            </button>
          </div>
        </div>
      )}

      {/* SECTION 4: PERIODIC REPORTS SECTION (Section 7) */}
      {!isNavActive && (
        <div className="rounded-xl border bg-card p-5 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b pb-4">
            <div>
              <h2 className="text-lg font-bold text-foreground font-display">
                Date-Analysis & Periodic Reports
              </h2>
              <p className="text-xs text-muted-foreground">
                Daily, weekly, and monthly aggregate intelligence from the news database
              </p>
            </div>

            {/* Report Tabs */}
            <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setSelectedReportTab('all');
                  setDateValidationError(null);
                }}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  selectedReportTab === 'all'
                    ? 'bg-card text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                All Records
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedReportTab('daily');
                  setDateValidationError(null);
                }}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  selectedReportTab === 'daily'
                    ? 'bg-card text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Daily Report
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedReportTab('weekly');
                  setDateValidationError(null);
                }}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  selectedReportTab === 'weekly'
                    ? 'bg-card text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Weekly Report
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedReportTab('monthly');
                  setDateValidationError(null);
                }}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  selectedReportTab === 'monthly'
                    ? 'bg-card text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Monthly Report
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedReportTab('custom');
                  setDateValidationError(null);
                }}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  selectedReportTab === 'custom'
                    ? 'bg-card text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Custom Range
              </button>
            </div>
          </div>

          {/* Date Selectors & Download Button for the active tab */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              {selectedReportTab === 'all' && (
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Calendar className="size-4 text-primary shrink-0" />
                  <span>Displaying all available records across the entire constituency repository.</span>
                </div>
              )}

              {selectedReportTab === 'daily' && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">Select Date:</span>
                  <input
                    type="date"
                    value={selectedDailyDate}
                    onChange={(e) => {
                      setSelectedDailyDateState(e.target.value);
                      setDateValidationError(null);
                    }}
                    className="h-8 rounded-lg border bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                  />
                  {selectedDailyDate && (
                    <span className="text-xs text-muted-foreground">
                      ({formatDateBadge(selectedDailyDate)})
                    </span>
                  )}
                </div>
              )}

              {selectedReportTab === 'weekly' && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">Week Ending:</span>
                  <input
                    type="date"
                    value={selectedWeeklyEndDate}
                    onChange={(e) => {
                      setSelectedWeeklyEndDateState(e.target.value);
                      setDateValidationError(null);
                    }}
                    className="h-8 rounded-lg border bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                  />
                  {selectedWeeklyEndDate && (() => {
                    const { startStr, endStr } = getWeekRange(selectedWeeklyEndDate);
                    return (
                      <span className="text-xs text-muted-foreground">
                        ({formatDateBadge(startStr)} to {formatDateBadge(endStr)})
                      </span>
                    );
                  })()}
                </div>
              )}

              {selectedReportTab === 'monthly' && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">Select Month:</span>
                  <input
                    type="month"
                    value={selectedMonthlyYearMonth}
                    onChange={(e) => {
                      setSelectedMonthlyYearMonthState(e.target.value);
                      setDateValidationError(null);
                    }}
                    className="h-8 rounded-lg border bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                  />
                  {selectedMonthlyYearMonth && (() => {
                    const { monthLabel } = getMonthRange(selectedMonthlyYearMonth);
                    return (
                      <span className="text-xs text-muted-foreground">
                        ({monthLabel})
                      </span>
                    );
                  })()}
                </div>
              )}

              {selectedReportTab === 'custom' && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">From:</span>
                  <input
                    type="date"
                    value={selectedCustomStartDate}
                    onChange={(e) => {
                      setSelectedCustomStartDateState(e.target.value);
                      setDateValidationError(null);
                    }}
                    className="h-8 rounded-lg border bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                  />
                  <span className="text-xs font-semibold text-muted-foreground">To:</span>
                  <input
                    type="date"
                    value={selectedCustomEndDate}
                    onChange={(e) => {
                      setSelectedCustomEndDateState(e.target.value);
                      setDateValidationError(null);
                    }}
                    className="h-8 rounded-lg border bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}

              {/* Exact position where Submit Filter was: Context-Aware Download Button */}
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePeriodicDownload('pdf')}
                  disabled={periodicDownloading}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-all shadow-xs disabled:opacity-60"
                >
                  {periodicDownloading ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      <span>Downloading...</span>
                    </>
                  ) : (
                    <>
                      <Download className="size-3.5" />
                      <span>{periodicDownloadButtonLabel}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Validation & Error Banners */}
            {dateValidationError && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs font-medium text-red-600 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  {dateValidationError}
                </span>
                <button
                  type="button"
                  onClick={() => setDateValidationError(null)}
                  className="text-red-600 hover:opacity-75"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}

            {periodicError && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs font-medium text-red-600 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  {periodicError}
                </span>
                <button
                  type="button"
                  onClick={() => setPeriodicError(null)}
                  className="text-red-600 hover:opacity-75"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}

            {/* Period record count */}
            <div className="text-xs text-muted-foreground pt-1 border-t flex items-center justify-between">
              <span>
                Found <strong className="text-foreground">{periodicReportData.total}</strong> articles in this period
              </span>
            </div>
          </div>

          {/* Period Summary Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="rounded-lg border bg-muted/20 p-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Total Articles
              </span>
              <p className="text-xl font-bold font-display text-foreground mt-1">
                {periodicReportData.total}
              </p>
            </div>
            <div className="rounded-lg border bg-green-500/5 border-green-500/20 p-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-green-700 dark:text-green-400">
                Positive News
              </span>
              <p className="text-xl font-bold font-display text-green-700 dark:text-green-400 mt-1">
                {periodicReportData.pos}
              </p>
            </div>
            <div className="rounded-lg border bg-red-500/5 border-red-500/20 p-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-red-700 dark:text-red-400">
                Negative News
              </span>
              <p className="text-xl font-bold font-display text-red-700 dark:text-red-400 mt-1">
                {periodicReportData.neg}
              </p>
            </div>
            <div className="rounded-lg border bg-amber-500/5 border-amber-500/20 p-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Problems
              </span>
              <p className="text-xl font-bold font-display text-amber-700 dark:text-amber-400 mt-1">
                {periodicReportData.prob}
              </p>
            </div>
            <div className="rounded-lg border bg-slate-500/5 border-slate-500/20 p-3 col-span-2 sm:col-span-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-400">
                Statements
              </span>
              <p className="text-xl font-bold font-display text-slate-700 dark:text-slate-400 mt-1">
                {periodicReportData.neut}
              </p>
            </div>
          </div>

          {/* Interactive Recharts Visualizations: At most 2 charts */}
          <div className="pt-2">
            <AnalyticsTwoCharts
              articles={periodicReportData.articles}
              trendView={trendView}
              setTrendView={setTrendView}
              activeCategory="all"
            />
          </div>
        </div>
      )}

      {/* SECTION 5: ARTICLE RESULTS LIST & TABLE (Sections 3 & 5) */}
      {isNavActive && (
        <div className="space-y-4">
          {/* Context-aware 2 Charts reflecting active filters */}
          <AnalyticsTwoCharts
            articles={filteredArticles}
            trendView={trendView}
            setTrendView={setTrendView}
            activeCategory={activeCategory}
          />
          {filteredArticles.length === 0 ? (
            <div className="rounded-xl border bg-card p-12 text-center">
              <AlertTriangle className="size-8 mx-auto text-muted-foreground mb-3" />
              <h3 className="text-base font-semibold text-foreground">No articles match your filters</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                Try selecting a different assembly segment, category, or clear search keywords.
              </p>
              <button
                type="button"
                onClick={resetAllFilters}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Reset Filters
              </button>
            </div>
          ) : viewMode === 'grid' ? (
            /* Card Grid View */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {paginatedArticles.map((art: ArticleData) => (
                <div
                  key={(art._id as string) || (art.post_id as string) || (art.id as string)}
                  onClick={() => setModalArticle(art)}
                  className="rounded-xl border bg-card p-4 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer flex flex-col justify-between group"
                >
                  <div className="space-y-2.5">
                    {/* Meta row: Badges */}
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <CategoryChip category={art.category as string} />
                        <SentimentBadge sentiment={art.sentiment as string} />
                      </div>
                      <SourceBadge source={art.source as string} />
                    </div>

                    {/* Headline */}
                    <h3 className="text-sm font-bold text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                      {art.title}
                    </h3>

                    {/* Summary */}
                    <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                      {art.summary || 'Summary unavailable'}
                    </p>
                  </div>

                  {/* Footer: Segment, Location, Date & Link */}
                  <div className="mt-4 pt-3 border-t flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground bg-muted/60 px-2 py-0.5 rounded">
                      {art.assembly_segment || 'Narasaraopet'}
                    </span>
                    <div className="flex items-center gap-2">
                      <span>{formatDate(art.created_on || art.first_seen_at)}</span>
                      {Boolean(art.source_url) && (
                        <a
                          href={art.source_url as string}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-primary hover:text-primary/80"
                          title="Open original link"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Table View */
            <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/40 border-b text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Title</th>
                    <th className="py-3 px-3 font-semibold">Source</th>
                    <th className="py-3 px-3 font-semibold">Sentiment</th>
                    <th className="py-3 px-3 font-semibold">Category</th>
                    <th className="py-3 px-3 font-semibold">Assembly Segment</th>
                    <th className="py-3 px-3 font-semibold">Date</th>
                    <th className="py-3 px-3 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {paginatedArticles.map((art: ArticleData) => (
                    <tr
                      key={(art._id as string) || (art.post_id as string) || (art.id as string)}
                      onClick={() => setModalArticle(art)}
                      className="hover:bg-muted/20 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 max-w-sm">
                        <p className="font-medium text-foreground line-clamp-1">{art.title}</p>
                        <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{art.summary as string}</p>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <SourceBadge source={art.source as string} />
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <SentimentBadge sentiment={art.sentiment as string} />
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <CategoryChip category={art.category as string} />
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap font-medium text-foreground">
                        {art.assembly_segment || '—'}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap text-muted-foreground">
                        {formatDate(art.created_on || art.first_seen_at)}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap text-right">
                        {Boolean(art.source_url) ? (
                          <a
                            href={art.source_url as string}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
                          >
                            <span>Link</span>
                            <ExternalLink className="size-3" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">
                Page <strong className="text-foreground">{currentPage}</strong> of <strong>{totalPages}</strong> (
                {filteredArticles.length} total articles)
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
                >
                  <ChevronLeft className="size-3.5" />
                  Previous
                </button>
                <div className="hidden sm:flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum = i + 1;
                    if (totalPages > 5 && currentPage > 3) {
                      pageNum = Math.min(currentPage - 2 + i, totalPages - (4 - i));
                    }
                    return (
                      <button
                        key={pageNum}
                        type="button"
                        onClick={() => setCurrentPage(pageNum)}
                        className={`size-7 rounded-md text-xs font-medium ${
                          currentPage === pageNum
                            ? 'bg-primary text-primary-foreground font-semibold'
                            : 'border text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
                >
                  Next
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SECTION 6: ARTICLE MODAL VIEWER */}
      {modalArticle && (
        <NewsModal
          article={modalArticle}
          isOpen={Boolean(modalArticle)}
          onClose={() => setModalArticle(null)}
        />
      )}
    </div>
  );
}
