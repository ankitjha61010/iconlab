import { Link } from 'react-router-dom';
import { LogoMark } from './Logo';

export function Footer() {
  return (
    <footer className="mt-20 border-t border-border bg-surface">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr] lg:px-8">
        <div>
          <div className="flex items-center gap-2 font-extrabold">
            <LogoMark size={24} /> IconLab
          </div>
          <p className="mt-3 max-w-sm text-sm text-muted">
            Discover. Customize. Download. Icons are served by the open-source{' '}
            <a href="https://iconify.design" target="_blank" rel="noreferrer" className="font-medium text-text underline-offset-2 hover:underline">
              Iconify
            </a>{' '}
            API. Each icon set has its own license — check the icon source before using an icon in your project.
          </p>
        </div>
        <nav aria-label="Footer">
          <h2 className="text-sm font-semibold">Explore</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li><Link className="hover:text-text" to="/icons">Icons</Link></li>
            <li><Link className="hover:text-text" to="/collections">Collections</Link></li>
            <li><Link className="hover:text-text" to="/favorites">Favorites</Link></li>
            <li><Link className="hover:text-text" to="/background-remover">Remove Background</Link></li>
          </ul>
        </nav>
        <div>
          <h2 className="text-sm font-semibold">Privacy</h2>
          <p className="mt-3 text-sm text-muted">
            No account, no tracking. Favorites and history stay in this browser. All editing and exporting happens on your device.
          </p>
        </div>
      </div>
      <div className="border-t border-border py-4 text-center text-xs text-muted">© {new Date().getFullYear()} IconLab</div>
    </footer>
  );
}
