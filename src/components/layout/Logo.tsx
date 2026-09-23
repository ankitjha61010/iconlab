import { Link } from 'react-router-dom';

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="iconlab-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6d5dfc" />
          <stop offset="1" stopColor="#2fb3ff" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#iconlab-logo)" />
      <rect x="7" y="7" width="8" height="8" rx="2" fill="#fff" />
      <circle cx="21" cy="11" r="4" fill="#fff" fillOpacity=".7" />
      <path d="M7 25l4-7 4 7z" fill="#fff" fillOpacity=".7" />
      <rect x="17" y="17" width="8" height="8" rx="4" fill="#fff" />
    </svg>
  );
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2 rounded-lg ${className}`} aria-label="IconLab home">
      <LogoMark />
      <span className="text-lg font-extrabold tracking-tight">
        Icon<span className="text-[#8fd8ff]">Lab</span>
      </span>
    </Link>
  );
}
