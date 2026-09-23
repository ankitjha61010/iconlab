export const POPULAR_SEARCHES = ['user', 'business', 'food', 'technology', 'security', 'education', 'home', 'social'];

/** Home page categories. Each one runs a live Iconify search for its query. */
export const CATEGORIES: Array<{ label: string; query: string }> = [
  { label: 'Interface', query: 'settings' },
  { label: 'Business', query: 'business' },
  { label: 'People', query: 'people' },
  { label: 'Technology', query: 'technology' },
  { label: 'Communication', query: 'chat' },
  { label: 'Education', query: 'education' },
  { label: 'E-commerce', query: 'shopping' },
  { label: 'Social', query: 'social' },
  { label: 'Travel', query: 'travel' },
  { label: 'Food', query: 'food' },
  { label: 'Medical', query: 'medical' },
  { label: 'Finance', query: 'finance' },
];

/** Well-known icon sets offered as quick collection filters. */
export const FEATURED_PREFIXES = [
  'mdi',
  'material-symbols',
  'fa6-solid',
  'tabler',
  'heroicons',
  'bi',
  'ph',
  'lucide',
  'solar',
  'ri',
  'fluent',
  'carbon',
];

/** Collections highlighted on the home page. */
export const HOME_COLLECTIONS = ['mdi', 'tabler', 'solar', 'ph', 'fluent-emoji-flat', 'logos', 'material-symbols', 'heroicons'];
