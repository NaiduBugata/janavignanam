import { NavLink, Outlet, useSearchParams } from 'react-router-dom';
import TopNav from '../components/nav/TopNav';
import NewsModal from '../components/news/NewsModal';
import Spinner from '../components/common/Spinner';
import ErrorState from '../components/common/ErrorState';
import EmptyState from '../components/common/EmptyState';
import { SkeletonCard } from '../components/common/Skeleton';
import { useNewsContext } from '../context/NewsContext';

const sections = [
  { to: '/news', label: 'Articles', end: true },
  { to: '/news/problems', label: 'Problems', end: false },
  { to: '/news/analytics', label: 'Analytics', end: false },
  { to: '/news/departments', label: 'Departments', end: false },
];

export default function AppShell({ embed: embedProp = false }) {
  const {
    articles,
    loading,
    error,
    refresh,
    selectedArticle,
    modalOpen,
    closeArticle,
  } = useNewsContext();
  const [searchParams] = useSearchParams();
  const embed = embedProp || searchParams.get('embed') === '1';

  if (loading && articles.length === 0) {
    return (
      <div className="min-h-screen bg-msbg">
        {!embed && <div className="h-[4.25rem] border-b border-msline bg-navbar" />}
        <main className="mx-auto max-w-none w-full px-6 py-6 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
          <Spinner label="Loading constituency data..." />
        </main>
      </div>
    );
  }

  if (error && articles.length === 0) {
    return (
      <div className="min-h-screen bg-msbg">
        {!embed && <div className="h-[4.25rem] border-b border-msline bg-navbar" />}
        <main className="mx-auto max-w-none w-full px-6 py-6">
          <ErrorState message={error} onRetry={refresh} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-msbg flex flex-col">
      {!embed && <TopNav />}
      {embed && (
        <nav className="flex gap-2 border-b border-msline px-6 py-3">
          {sections.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-primary text-white' : 'text-msmuted hover:bg-mssurface'}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}

      <main className="mx-auto w-full max-w-none flex-1 px-6 pt-4 pb-4">
        {!loading && articles.length === 0 ? (
          <EmptyState
            title="No news data yet"
            message="Run the analysis pipeline to collect and categorize constituency news."
          />
        ) : (
          <div className="page-enter h-full">
            <Outlet />
          </div>
        )}
      </main>

      <NewsModal article={selectedArticle} isOpen={modalOpen} onClose={closeArticle} />
    </div>
  );
}
