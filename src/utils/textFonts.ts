/**
 * Fonts offered for added text. They're web fonts (Google Fonts), so text
 * looks the same on every device and can be matched against the lettering in
 * an image. They load only when first needed (see loadTextFonts).
 */

export type FontGroup = 'Sans' | 'Rounded' | 'Display' | 'Serif' | 'Mono' | 'Script';

export interface TextFont {
  label: string;
  /** CSS font-family stack. */
  value: string;
  group: FontGroup;
  /** Weights the font really has (only 400 means bold is faked by the browser). */
  weights: readonly number[];
}

const BOTH = [400, 700] as const;
const REGULAR = [400] as const;

/** `family` is the Google Fonts name; `fallback` the generic stack after it. */
const font = (family: string, group: FontGroup, fallback: string, weights: readonly number[] = BOTH, label = family): TextFont => ({
  label,
  value: `${/\s/.test(family) ? `"${family}"` : family}, ${fallback}`,
  group,
  weights,
});

const SANS = 'Arial, sans-serif';
const SERIF = 'Georgia, serif';

export const TEXT_FONTS: readonly TextFont[] = [
  font('Inter', 'Sans', '"Helvetica Neue", Arial, sans-serif'),
  font('Roboto', 'Sans', SANS),
  font('Open Sans', 'Sans', SANS),
  font('Lato', 'Sans', SANS),
  font('Poppins', 'Sans', SANS),
  font('Montserrat', 'Sans', SANS),
  font('Raleway', 'Sans', SANS),
  font('Source Sans 3', 'Sans', SANS),
  font('Work Sans', 'Sans', SANS),
  font('DM Sans', 'Sans', SANS),
  font('Manrope', 'Sans', SANS),
  font('Ubuntu', 'Sans', SANS),
  font('Rubik', 'Sans', SANS),
  font('Mulish', 'Sans', SANS),
  font('Barlow', 'Sans', SANS),
  font('Josefin Sans', 'Sans', SANS),
  font('Exo 2', 'Sans', SANS),
  font('Nunito', 'Rounded', '"Trebuchet MS", sans-serif'),
  font('Quicksand', 'Rounded', SANS),
  font('Varela Round', 'Rounded', SANS, REGULAR),
  font('Comfortaa', 'Rounded', SANS),
  font('Fredoka', 'Rounded', SANS),
  font('Baloo 2', 'Rounded', SANS),
  font('M PLUS Rounded 1c', 'Rounded', SANS, BOTH, 'M PLUS Rounded'),
  font('Oswald', 'Display', '"Arial Narrow", sans-serif'),
  font('Anton', 'Display', 'Impact, sans-serif', REGULAR),
  font('Bebas Neue', 'Display', 'Impact, sans-serif', REGULAR),
  font('Archivo Black', 'Display', '"Arial Black", sans-serif', REGULAR),
  font('Righteous', 'Display', SANS, REGULAR),
  font('Teko', 'Display', '"Arial Narrow", sans-serif'),
  font('Playfair Display', 'Serif', SERIF, BOTH, 'Playfair'),
  font('Merriweather', 'Serif', SERIF),
  font('Lora', 'Serif', SERIF),
  font('PT Serif', 'Serif', SERIF),
  font('Roboto Slab', 'Serif', SERIF),
  font('Zilla Slab', 'Serif', SERIF),
  font('Libre Baskerville', 'Serif', SERIF),
  font('EB Garamond', 'Serif', SERIF),
  font('Cormorant Garamond', 'Serif', SERIF, BOTH, 'Cormorant'),
  font('Roboto Mono', 'Mono', '"Courier New", monospace'),
  font('Space Mono', 'Mono', '"Courier New", monospace'),
  font('Source Code Pro', 'Mono', '"Courier New", monospace'),
  font('Dancing Script', 'Script', 'cursive'),
  font('Pacifico', 'Script', 'cursive', REGULAR),
  font('Lobster', 'Script', 'cursive', REGULAR),
  font('Caveat', 'Script', 'cursive'),
  font('Great Vibes', 'Script', 'cursive', REGULAR),
  font('Satisfy', 'Script', 'cursive', REGULAR),
  font('Kaushan Script', 'Script', 'cursive', REGULAR),
];

export const FONT_GROUPS: readonly FontGroup[] = ['Sans', 'Rounded', 'Display', 'Serif', 'Mono', 'Script'];

/** The Google Fonts family name at the front of a stack. */
const familyOf = (f: TextFont) => f.value.split(',')[0].trim().replace(/^"|"$/g, '');

// Inter is already loaded by the site itself.
const STYLESHEET = `https://fonts.googleapis.com/css2?${TEXT_FONTS.filter((f) => f.label !== 'Inter')
  .map((f) => `family=${familyOf(f).replace(/ /g, '+')}${f.weights.length > 1 ? `:wght@${f.weights.join(';')}` : ''}`)
  .join('&')}&display=swap`;

let ready: Promise<void> | null = null;

/** Adds the font stylesheet (once) and resolves when every font is ready to draw on a canvas. */
export function loadTextFonts(): Promise<void> {
  if (ready) return ready;
  let link = document.querySelector<HTMLLinkElement>(`link[href="${STYLESHEET}"]`);
  if (!link) {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = STYLESHEET;
    document.head.appendChild(link);
  }
  const sheet = link;
  const loaded = new Promise<void>((resolve) => {
    if (sheet.sheet) resolve();
    else {
      sheet.addEventListener('load', () => resolve(), { once: true });
      sheet.addEventListener('error', () => resolve(), { once: true });
    }
  });
  ready = loaded
    .then(() => Promise.all(TEXT_FONTS.flatMap((f) => f.weights.map((weight) => document.fonts.load(`${weight} 32px ${f.value}`).catch(() => [])))))
    .then(() => undefined);
  return ready;
}
