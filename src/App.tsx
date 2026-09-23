import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { ToastProvider } from './components/common/Toast';
import { useTheme } from './hooks/useTheme';
import Home from './pages/Home';

const SearchResults = lazy(() => import('./pages/SearchResults'));
const IconDetails = lazy(() => import('./pages/IconDetails'));
const Collections = lazy(() => import('./pages/Collections'));
const CollectionDetail = lazy(() => import('./pages/CollectionDetail'));
const Favorites = lazy(() => import('./pages/Favorites'));
const BackgroundRemover = lazy(() => import('./pages/BackgroundRemover'));
const NotFound = lazy(() => import('./pages/NotFound'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

function PageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-muted" role="status">
      <Loader2 className="animate-spin" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export default function App() {
  useTheme();
  return (
    <ToastProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[300] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-contrast"
      >
        Skip to content
      </a>
      <ScrollToTop />
      <div className="flex min-h-screen flex-col">
        <Header />
        <main id="main" className="flex-1">
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/icons" element={<SearchResults />} />
              <Route path="/icon/:collection/:icon" element={<IconDetails />} />
              <Route path="/collections" element={<Collections />} />
              <Route path="/collections/:prefix" element={<CollectionDetail />} />
              <Route path="/favorites" element={<Favorites />} />
              <Route path="/background-remover" element={<BackgroundRemover />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </main>
        <Footer />
      </div>
    </ToastProvider>
  );
}
