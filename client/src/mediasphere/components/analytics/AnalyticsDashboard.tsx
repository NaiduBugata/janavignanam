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
import { downloadNewsReport } from '../../services/reportsApi';
import CategoryChip from '../common/CategoryChip';
import SentimentBadge from '../common/SentimentBadge';
import SourceBadge from '../common/SourceBadge';
import NewsModal from '../news/NewsModal';
import { formatRelativeTime, formatDate, truncate } from '../../utils/format';
import { isGrievanceOrProblem } from '../../utils/derive';

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

export default function AnalyticsDashboard() {
  const context = (useNewsContext?.() || {}) as NewsContextType;
  const articles: ArticleData[] = useMemo(() => (context.articles || []), [context.articles]);
  const loading = context.loading;
  const error = context.error;
  const stats = context.stats;

  // Compute earliest and latest available dates
  const availableDates = useMemo(() => {
    if (articles.length === 0) {
      return { latest: '2026-10-28', earliest: '2026-10-01' };
    }
    const dates = articles
      .map((a) => (a.created_on || a.first_seen_at || '').slice(0, 10))
      .filter(Boolean)
      .sort();
    return {
      latest: dates.length > 0 ? dates[dates.length - 1] : '2026-10-28',
      earliest: dates.length > 0 ? dates[0] : '2026-10-01',
    };
  }, [articles]);

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

  // Periodic Report Mode & Dates
  const [reportTab, setReportTab] = useState<'daily' | 'weekly' | 'monthly' | 'custom'>('daily');
  const [dailyDateState, setDailyDateState] = useState<string | null>(null);
  const [weeklyEndDateState, setWeeklyEndDateState] = useState<string | null>(null);
  const [monthlyYearMonthState, setMonthlyYearMonthState] = useState<string | null>(null);
  const [customStartDateState, setCustomStartDateState] = useState<string | null>(null);
  const [customEndDateState, setCustomEndDateState] = useState<string | null>(null);

  const dailyDate = dailyDateState || availableDates.latest;
  const weeklyEndDate = weeklyEndDateState || availableDates.latest;
  const monthlyYearMonth = monthlyYearMonthState || availableDates.latest.slice(0, 7);
  const customStartDate = customStartDateState || availableDates.earliest;
  const customEndDate = customEndDateState || availableDates.latest;

  const setDailyDate = (d: string) => setDailyDateState(d);
  const setWeeklyEndDate = (d: string) => setWeeklyEndDateState(d);
  const setMonthlyYearMonth = (ym: string) => setMonthlyYearMonthState(ym);
  const setCustomStartDate = (d: string) => setCustomStartDateState(d);
  const setCustomEndDate = (d: string) => setCustomEndDateState(d);

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

  // Overall categories from data
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    articles.forEach((a) => {
      if (a.category) set.add(a.category);
    });
    return Array.from(set).sort();
  }, [articles]);

  // Overall article counts by category tab
  const categoryCounts = useMemo(() => {
    const total = articles.length;
    const positive = articles.filter((a) => a.sentiment === 'Positive').length;
    const negative = articles.filter((a) => a.sentiment === 'Negative').length;
    const neutral = articles.filter((a) => a.sentiment === 'Statement' || a.sentiment === 'Neutral').length;
    const problems = articles.filter((a) => isGrievanceOrProblem(a)).length;

    return {
      all: total,
      positive,
      negative,
      problems,
      neutral,
    };
  }, [articles]);

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

  // Filtered articles list based on active filters
  const filteredArticles = useMemo(() => {
    return articles.filter((art: ArticleData) => {
      // 1. Category Tab Filter
      if (activeCategory === 'positive' && art.sentiment !== 'Positive') return false;
      if (activeCategory === 'negative' && art.sentiment !== 'Negative') return false;
      if (activeCategory === 'neutral' && art.sentiment !== 'Statement' && art.sentiment !== 'Neutral') return false;
      if (activeCategory === 'problems' && !isGrievanceOrProblem(art)) return false;

      // 2. Assembly Segment Filter
      if (selectedSegment !== 'all' && (art.assembly_segment || '').toLowerCase() !== selectedSegment.toLowerCase()) {
        return false;
      }

      // 3. Division Filter (using project's places model)
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
    articles,
    activeCategory,
    selectedSegment,
    selectedDivision,
    selectedSource,
    selectedNewsCategory,
    searchQuery,
  ]);

  // Periodic report calculations
  const periodicReportData = useMemo(() => {
    let dataset = articles;
    let title = '';
    let description = '';

    if (reportTab === 'daily') {
      dataset = articles.filter((a: ArticleData) => (a.created_on || a.first_seen_at || '').slice(0, 10) === dailyDate);
      title = `Daily News Report (${dailyDate})`;
      description = `Articles and public grievances published on ${dailyDate}`;
    } else if (reportTab === 'weekly') {
      const end = new Date(weeklyEndDate);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      const startStr = start.toISOString().slice(0, 10);
      dataset = articles.filter((a: ArticleData) => {
        const d = (a.created_on || a.first_seen_at || '').slice(0, 10);
        return d && d >= startStr && d <= weeklyEndDate;
      });
      title = `Weekly Analysis (${startStr} to ${weeklyEndDate})`;
      description = `7-day constituency trend, sentiment distribution, and category patterns`;
    } else if (reportTab === 'monthly') {
      dataset = articles.filter((a: ArticleData) => (a.created_on || a.first_seen_at || '').startsWith(monthlyYearMonth));
      const [year, month] = monthlyYearMonth.split('-');
      const monthName = new Date(Number(year), Number(month) - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
      title = `Monthly Constituency Report - ${monthName}`;
      description = `Comprehensive monthly coverage and issue distribution for ${monthName}`;
    } else if (reportTab === 'custom') {
      dataset = articles.filter((a: ArticleData) => {
        const d = (a.created_on || a.first_seen_at || '').slice(0, 10);
        return d && d >= customStartDate && d <= customEndDate;
      });
      title = `Custom Date Range (${customStartDate} to ${customEndDate})`;
      description = `Constituency analysis for custom timeframe`;
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
  }, [articles, reportTab, dailyDate, weeklyEndDate, monthlyYearMonth, customStartDate, customEndDate]);

  // Paginated articles for the results section
  const totalPages = Math.ceil(filteredArticles.length / itemsPerPage) || 1;
  const paginatedArticles = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredArticles.slice(start, start + itemsPerPage);
  }, [filteredArticles, currentPage]);

  // Handle Download Report
  const handleExport = async (format: 'pdf' | 'xlsx' | 'csv') => {
    try {
      setDownloading(true);
      setDownloadMenuOpen(false);
      setDownloadStatus(`Generating ${format.toUpperCase()} report...`);

      const params = {
        format,
        sentiment: activeCategory !== 'all' ? activeCategory : undefined,
        segment: selectedSegment !== 'all' ? selectedSegment : undefined,
        division: selectedDivision !== 'all' ? selectedDivision : undefined,
        category: selectedNewsCategory !== 'all' ? selectedNewsCategory : undefined,
        source: selectedSource !== 'all' ? selectedSource : undefined,
        search: searchQuery.trim() || undefined,
        startDate: reportTab === 'daily' ? dailyDate : reportTab === 'custom' ? customStartDate : undefined,
        endDate: reportTab === 'daily' ? dailyDate : reportTab === 'custom' ? customEndDate : undefined,
      };

      const dateStr = new Date().toISOString().slice(0, 10);
      const catStr = activeCategory !== 'all' ? activeCategory : 'analytics';
      const fallback = `janavignanam_${catStr}_report_${dateStr}.${format}`;

      await downloadNewsReport(params, fallback);
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
              <Download className="size-4" />
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
                  <FileText className="size-4 text-red-600" />
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
                  <FileSpreadsheet className="size-4 text-green-600" />
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
                  <TableIcon className="size-4 text-blue-600" />
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
            <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1">
              <button
                type="button"
                onClick={() => setReportTab('daily')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  reportTab === 'daily'
                    ? 'bg-card text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Daily Report
              </button>
              <button
                type="button"
                onClick={() => setReportTab('weekly')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  reportTab === 'weekly'
                    ? 'bg-card text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Weekly Report
              </button>
              <button
                type="button"
                onClick={() => setReportTab('monthly')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  reportTab === 'monthly'
                    ? 'bg-card text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Monthly Report
              </button>
              <button
                type="button"
                onClick={() => setReportTab('custom')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  reportTab === 'custom'
                    ? 'bg-card text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Custom Range
              </button>
            </div>
          </div>

          {/* Date Selectors for the active tab */}
          <div className="flex flex-wrap items-center gap-3">
            {reportTab === 'daily' && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">Select Date:</span>
                <input
                  type="date"
                  value={dailyDate}
                  onChange={(e) => setDailyDate(e.target.value)}
                  className="h-8 rounded-lg border bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}

            {reportTab === 'weekly' && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">Week Ending:</span>
                <input
                  type="date"
                  value={weeklyEndDate}
                  onChange={(e) => setWeeklyEndDate(e.target.value)}
                  className="h-8 rounded-lg border bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}

            {reportTab === 'monthly' && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">Select Month:</span>
                <input
                  type="month"
                  value={monthlyYearMonth}
                  onChange={(e) => setMonthlyYearMonth(e.target.value)}
                  className="h-8 rounded-lg border bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}

            {reportTab === 'custom' && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">From:</span>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="h-8 rounded-lg border bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                />
                <span className="text-xs font-semibold text-muted-foreground">To:</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="h-8 rounded-lg border bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}

            <div className="ml-auto text-xs text-muted-foreground font-medium">
              Found <strong className="text-foreground">{periodicReportData.total}</strong> articles in this period
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

          {/* Interactive Recharts Visualizations */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
            {/* Chart 1: Daily Trend */}
            <div className="rounded-xl border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <TrendingUp className="size-4 text-primary" />
                Publication Timeline Trend
              </h3>
              <div className="h-64 w-full">
                {periodicReportData.trendData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={periodicReportData.trendData}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1E293B',
                          borderColor: '#334155',
                          borderRadius: '8px',
                          color: '#fff',
                          fontSize: '12px',
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="count"
                        name="Articles"
                        stroke="#1E3A8A"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: '#1E3A8A' }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    No timeline data for this period
                  </div>
                )}
              </div>
            </div>

            {/* Chart 2: Sentiment Distribution Donut */}
            <div className="rounded-xl border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <PieIcon className="size-4 text-primary" />
                Sentiment Breakdown
              </h3>
              <div className="h-64 w-full">
                {periodicReportData.sentimentData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={periodicReportData.sentimentData}
                        dataKey="count"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={80}
                        paddingAngle={3}
                        label={({ name, percent }: { name?: string; percent?: number }) => `${name} ${(((percent as number) || 0) * 100).toFixed(0)}%`}
                      >
                        {periodicReportData.sentimentData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1E293B',
                          borderColor: '#334155',
                          borderRadius: '8px',
                          color: '#fff',
                          fontSize: '12px',
                        }}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    No sentiment data for this period
                  </div>
                )}
              </div>
            </div>

            {/* Chart 3: Constituency-Wise Distribution */}
            <div className="rounded-xl border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <BarChart2 className="size-4 text-primary" />
                Constituency Assembly Segments
              </h3>
              <div className="h-64 w-full">
                {periodicReportData.segmentData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={periodicReportData.segmentData} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1E293B',
                          borderColor: '#334155',
                          borderRadius: '8px',
                          color: '#fff',
                          fontSize: '12px',
                        }}
                      />
                      <Bar dataKey="count" name="Articles" fill="#1E3A8A" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    No constituency data for this period
                  </div>
                )}
              </div>
            </div>

            {/* Chart 4: Top News Categories */}
            <div className="rounded-xl border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <BarChart2 className="size-4 text-primary" />
                Top News Categories
              </h3>
              <div className="h-64 w-full">
                {periodicReportData.categoryData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={periodicReportData.categoryData} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1E293B',
                          borderColor: '#334155',
                          borderRadius: '8px',
                          color: '#fff',
                          fontSize: '12px',
                        }}
                      />
                      <Bar dataKey="count" name="Articles" fill="#0D9488" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    No category data for this period
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 5: ARTICLE RESULTS LIST & TABLE (Sections 3 & 5) */}
      {isNavActive && (
        <div className="space-y-4">
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
