import { useEffect, useState } from 'react';
import { NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { Heart, Menu, Moon, Search, Sun, X } from 'lucide-react';
import { Logo } from './Logo';
import { IconSearch } from '../icons/IconSearch';
import { useTheme } from '../../hooks/useTheme';
import { useFavorites } from '../../hooks/useFavorites';

const NAV = [
  { to: '/icons', label: 'Icons' },
  { to: '/collections', label: 'Collections' },
  { to: '/favorites', label: 'Favorites' },
  { to: '/background-remover', label: 'Remove Background' },
];

export function Header() {
  const { theme, toggleTheme } = useTheme();
  const { favorites } = useFavorites();
  const location = useLocation();
  const [params] = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const query = location.pathname === '/icons' ? params.get('q') ?? '' : '';
  // Home and the empty /icons page have their own large search bar.
  const isHome = location.pathname === '/' || (location.pathname === '/icons' && !query.trim());
  const isActive = (to: string) =>
    to === '/icons' ? location.pathname === '/icons' || location.pathname.startsWith('/icon/') : location.pathname.startsWith(to);

  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
  }, [location.pathname, location.search]);

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `relative rounded-md px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'text-header-text bg-white/10' : 'text-header-muted hover:text-header-text hover:bg-white/5'
    }`;

  const iconButton =
    'inline-flex h-9 w-9 items-center justify-center rounded-lg text-header-muted hover:bg-white/10 hover:text-header-text';

  return (
    <header className="sticky top-0 z-40 bg-header text-header-text shadow-[0_1px_0_rgb(255_255_255/0.06)]">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Logo className="shrink-0" />

        <nav aria-label="Main" className="ml-4 hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to === '/icons' ? query ? `/icons?q=${encodeURIComponent(query)}` : '/icons' : item.to}
              className={() => navClass({ isActive: isActive(item.to) })}
            >
              {item.label}
              {item.to === '/background-remover' && (
                <span className="ml-1.5 rounded-full bg-accent/20 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-accent">New</span>
              )}
              {item.to === '/favorites' && favorites.length > 0 && (
                <span className="ml-1.5 rounded-full bg-primary px-1.5 py-px text-[11px] font-semibold text-primary-contrast">
                  {favorites.length}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex flex-1 items-center justify-end gap-1.5">
          {!isHome && <IconSearch key={query} defaultQuery={query} className="hidden w-full max-w-md lg:block" />}
          {!isHome && (
            <button
              type="button"
              className={`${iconButton} lg:hidden`}
              onClick={() => setSearchOpen((o) => !o)}
              aria-label={searchOpen ? 'Close search' : 'Open search'}
              aria-expanded={searchOpen}
            >
              {searchOpen ? <X size={19} /> : <Search size={19} />}
            </button>
          )}
          <NavLink to="/favorites" className={`${iconButton} relative md:hidden`} aria-label={`Favorites (${favorites.length})`}>
            <Heart size={19} />
            {favorites.length > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />}
          </NavLink>
          <button
            type="button"
            onClick={toggleTheme}
            className={iconButton}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <button
            type="button"
            className={`${iconButton} md:hidden`}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {searchOpen && !isHome && (
        <div className="border-t border-white/10 px-4 py-3 lg:hidden">
          <IconSearch defaultQuery={query} autoFocus onSubmitted={() => setSearchOpen(false)} />
        </div>
      )}

      {menuOpen && (
        <nav id="mobile-nav" aria-label="Mobile" className="border-t border-white/10 px-4 py-2 md:hidden">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to === '/icons' ? query ? `/icons?q=${encodeURIComponent(query)}` : '/icons' : item.to}
              className={() => `block ${navClass({ isActive: isActive(item.to) })}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  );
}
