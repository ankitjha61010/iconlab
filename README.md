# IconLab

**Discover. Customize. Download.** A frontend-only icon search and customization app built on the public [Iconify API](https://iconify.design/docs/api/).

## Stack
React 19 · TypeScript · Vite · Tailwind CSS v4 · React Router · Lucide (UI icons). No backend, no database, no API keys.

## Scripts
```bash
npm install
npm run dev       # local dev server
npm run build     # type-check + production build → dist/
npm run preview   # serve the production build
```

## Deploying to Netlify
`netlify.toml` sets the build command (`npm run build`) and publish directory (`dist`).
`public/_redirects` (`/* /index.html 200`) makes deep links like `/icon/mdi/home` work after a refresh.

## Architecture
- `src/services/iconifyService.ts`: every Iconify request. It batches icon loads per set, caches results in memory and sessionStorage, falls back to mirror hosts when the primary host is down, and turns errors into typed, user-friendly messages.
- `src/utils/svgUtils.ts`: safe SVG transforms. Only `currentColor` is recolored. Fixed colors in multicolor icons are kept unless the user remaps a specific color. Transforms wrap the original body without rewriting it.
- `src/utils/imageExport.ts`: SVG → Image → Canvas → PNG/JPEG, all in the browser.
- `src/pages/BackgroundRemover.tsx` + `src/utils/backgroundRemoval.ts`: in-browser background removal (edge flood-fill from the detected background color, click to erase/restore, anti-aliased edges with color decontamination), recolor, background, trim and PNG/JPG/WebP export.
- `src/hooks/`: search with pagination and AbortController (`useIcons`), plus localStorage-backed favorites, recent icons, recent searches and theme.

## Filters
Filters map onto what the Iconify API supports:
- **Black / Colors:** `palette:false` / `palette:true`
- **Outline / Filled:** `style:stroke` / `style:fill`
- **Duotone / Lineal:** matched on icon names
- **Hand drawn:** limited to freehand/pencil icon sets
- **Gradient:** checked against the actual SVG bodies
- **Recent:** sorts by each icon set's last-modified date

## Licensing
Each icon set has its own license. The editor shows the set, author and license with a link to it. IconLab makes no licensing claims of its own.

## API keys
The Iconify public API needs no key. If a future icon provider requires a secret key, route it through a backend or proxy. Never ship it in frontend code.
