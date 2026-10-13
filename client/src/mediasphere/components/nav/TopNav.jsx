import { Menu, RefreshCw, Search, User, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useNewsContext } from '../../context/NewsContext';
import { formatDateTime } from '../../utils/format';
import ThemeToggle from './ThemeToggle';

const NAV_ITEMS = [
  { to: '/news', label: 'News', end: true },
  { to: '/news/problems', label: 'Problems', badge: 'problems' },
  { to: '/news/analytics', label: 'Analytics' },
  { to: '/news/departments', label: 'Departments', badge: 'departments' },
];

function linkClass({ isActive }) {
  return [
    'relative inline-flex items-center whitespace-nowrap px-3.5 py-2 text-[15px] font-medium transition-colors duration-200',
    isActive
      ? 'text-primary after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary'
      : 'text-msmuted hover:text-app',
  ].join(' ');
}

function NavBadge({ count }) {
  if (!count) return null;
  return (
    <span className="ml-1.5 inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">
      {count}
    </span>
  );
}

export default function TopNav() {
  const navigate = useNavigate();
  const { lastUpdated, refresh, refreshing, stats, departments } = useNewsContext();
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onBack = (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      setMenuOpen(false);
    };
    window.addEventListener('janavignanam-back', onBack);
    return () => window.removeEventListener('janavignanam-back', onBack);
  }, [menuOpen]);

  const highCount = stats?.problemPriorityCounts?.High || 0;
  const deptsWithHigh = useMemo(
    () => (departments || []).filter((d) => d.high > 0).length,
    [departments]
  );

  const badges = {
    problems: highCount,
    departments: deptsWithHigh,
  };

  const submitSearch = (e) => {
    e?.preventDefault?.();
    const q = search.trim();
    navigate(q ? `/news?q=${encodeURIComponent(q)}` : '/news');
    setMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-msline/80 bg-navbar/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-navbar/90 shadow-soft">
      <div className="mx-auto w-full max-w-none px-6">
        <div className="flex h-[4.25rem] items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3 min-w-0 shrink-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary text-white font-bold text-sm tracking-wide shadow-soft">
              MS
            </div>
            <div className="min-w-0 hidden sm:block">
              <h1 className="truncate text-lg font-bold text-app tracking-tight leading-tight">
                MediaSphere
              </h1>
              <p className="truncate text-[12px] text-msmuted leading-snug mt-0.5">
                AI Powered Constituency Intelligence Platform
              </p>
            </div>
          </Link>

          <nav
            className="hidden lg:flex items-center gap-1 flex-1 justify-center"
            aria-label="Primary"
          >
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
                {item.label}
                {item.badge ? <NavBadge count={badges[item.badge]} /> : null}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <form onSubmit={submitSearch} className="relative hidden md:block w-44 xl:w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-msmuted" />
              <input
                type="search"
                placeholder="Search news..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input-field !py-2 !pl-9 !pr-3 !text-sm"
              />
            </form>

            <ThemeToggle />

            {typeof stats?.total === 'number' ? (
              <span
                className="hidden sm:inline-flex items-center rounded-control border border-msline bg-surface px-2 py-1 text-xs font-semibold text-msmuted"
                title="Articles loaded from API"
              >
                {stats.total} news
              </span>
            ) : null}

            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              title={lastUpdated ? `Updated ${formatDateTime(lastUpdated)}` : 'Refresh'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-control border border-msline bg-surface text-app hover:bg-msbg transition-colors duration-200 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>

            <Link
              to="/news/profile"
              title="Constituency profile"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-msline bg-msbg text-msmuted hover:text-primary hover:border-primary/30 transition-colors duration-200"
            >
              <User className="h-4 w-4" />
            </Link>

            <button
              type="button"
              className="lg:hidden inline-flex h-11 w-11 items-center justify-center rounded-control border border-msline bg-surface text-app"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Toggle navigation"
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="md:hidden pb-3">
          <form onSubmit={submitSearch} className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-msmuted" />
            <input
              type="search"
              placeholder="Search news..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field !py-2 !pl-9"
            />
          </form>
        </div>

        <div className={`lg:hidden pb-3 ${menuOpen ? 'block' : 'hidden sm:block'}`}>
          <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Primary mobile">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={linkClass}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
                {item.badge ? <NavBadge count={badges[item.badge]} /> : null}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
