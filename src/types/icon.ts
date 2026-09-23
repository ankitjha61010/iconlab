/** Full Iconify identifier, e.g. "mdi:home". */
export type IconName = string;

export interface IconAuthor {
  name: string;
  url?: string;
}

export interface IconLicense {
  title: string;
  spdx?: string;
  url?: string;
}

/** Collection (icon set) metadata as returned by the Iconify API. */
export interface CollectionInfo {
  prefix: string;
  name: string;
  total?: number;
  author?: IconAuthor;
  license?: IconLicense;
  samples?: string[];
  height?: number | number[];
  category?: string;
  tags?: string[];
  palette?: boolean;
  hidden?: boolean;
}

/** Resolved, renderable icon data. */
export interface IconData {
  prefix: string;
  name: string;
  body: string;
  width: number;
  height: number;
  left: number;
  top: number;
  /** Transformations inherited from an alias. */
  rotate?: number;
  hFlip?: boolean;
  vFlip?: boolean;
}

export interface SearchParams {
  query: string;
  page: number;
  pageSize: number;
  prefixes?: string[];
  /** Iconify search keywords appended to the query, e.g. "palette:true". */
  keywords?: string[];
  signal?: AbortSignal;
}

export interface SearchResult {
  icons: IconName[];
  /** Number of matches Iconify reported for the requested window. */
  total: number;
  hasMore: boolean;
  collections: Record<string, CollectionInfo>;
}

export interface CollectionIcons {
  prefix: string;
  title: string;
  total: number;
  info?: CollectionInfo;
  /** Category name → icon names (without prefix). */
  categories: Record<string, string[]>;
  /** All visible icon names (without prefix), in API order. */
  icons: string[];
}

export type ColorFilter = 'black' | 'color' | 'gradient';
export type StyleFilter = 'outline' | 'filled' | 'duotone' | 'lineal' | 'hand-drawn';
export type SortOrder = 'popular' | 'recent';

export interface SearchFilters {
  color: ColorFilter | null;
  style: StyleFilter | null;
  prefixes: string[];
  sort: SortOrder;
}

export interface RecentIcon {
  name: IconName;
  viewedAt: number;
}

export interface IconCustomization {
  color: string;
  /** Replacement map for multicolor icons: original color → new color. */
  palette: Record<string, string>;
  background: string;
  transparent: boolean;
  size: number;
  rotate: number;
  hFlip: boolean;
  vFlip: boolean;
  /** Padding as a percentage of the icon box (0–40). */
  padding: number;
  /** Background corner radius as a percentage (0 = square, 50 = circle). */
  radius: number;
}

export type ExportFormat = 'svg' | 'png' | 'jpeg';
