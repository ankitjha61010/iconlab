import type { IconCustomization } from '../types/icon';
import type { ColorMode } from './svgUtils';
import { formatSvg } from './svgUtils';

export type SnippetKind = 'svg' | 'html' | 'react' | 'react-native';

export interface Snippet {
  kind: SnippetKind;
  label: string;
  /** Short explanation shown above the code. */
  note: string;
  code: string;
}

interface SnippetInput {
  iconName: string;
  custom: IconCustomization;
  svg: string;
  colorMode: ColorMode;
}

const isQuarterTurn = (deg: number) => deg % 90 === 0;

/** Features of the customization that the Iconify components can't express. */
function unsupportedFeatures(custom: IconCustomization): string[] {
  const list: string[] = [];
  if (!custom.transparent) list.push('background');
  if (custom.padding > 0) list.push('padding');
  if (Object.keys(custom.palette).length) list.push('custom palette');
  return list;
}

function componentName(iconName: string): string {
  const bare = iconName.replace(':', '-');
  return (
    bare
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('')
      .replace(/^(\d)/, 'Icon$1') + 'Icon'
  );
}

function flipValue(custom: IconCustomization): string | null {
  if (custom.hFlip && custom.vFlip) return 'horizontal,vertical';
  if (custom.hFlip) return 'horizontal';
  if (custom.vFlip) return 'vertical';
  return null;
}

function htmlSnippet({ iconName, custom, colorMode }: SnippetInput): Snippet {
  const rotation = ((custom.rotate % 360) + 360) % 360;
  const attrs = [`icon="${iconName}"`, `width="${custom.size}"`, `height="${custom.size}"`];
  const styles: string[] = [];
  if (colorMode !== 'multi') styles.push(`color: ${custom.color}`);
  if (rotation && isQuarterTurn(rotation)) attrs.push(`rotate="${rotation}deg"`);
  else if (rotation) styles.push(`transform: rotate(${rotation}deg)`);
  const flip = flipValue(custom);
  if (flip) attrs.push(`flip="${flip}"`);
  if (styles.length) attrs.push(`style="${styles.join('; ')}"`);

  const skipped = unsupportedFeatures(custom);
  return {
    kind: 'html',
    label: 'HTML',
    note:
      'Iconify web component — loads the icon on demand.' +
      (skipped.length ? ` Not included: ${skipped.join(', ')} (use the SVG tab for an exact copy).` : ''),
    code: [
      '<script src="https://code.iconify.design/iconify-icon/3.0.0/iconify-icon.min.js"></script>',
      '',
      `<iconify-icon ${attrs.join(' ')}></iconify-icon>`,
    ].join('\n'),
  };
}

function reactSnippet({ iconName, custom, colorMode }: SnippetInput): Snippet {
  const rotation = ((custom.rotate % 360) + 360) % 360;
  const props = [`icon="${iconName}"`, `width={${custom.size}}`, `height={${custom.size}}`];
  if (colorMode !== 'multi') props.push(`color="${custom.color}"`);
  if (rotation && isQuarterTurn(rotation)) props.push(`rotate={${rotation / 90}}`);
  if (custom.hFlip) props.push('hFlip');
  if (custom.vFlip) props.push('vFlip');
  if (rotation && !isQuarterTurn(rotation)) props.push(`style={{ transform: 'rotate(${rotation}deg)' }}`);

  const skipped = unsupportedFeatures(custom);
  return {
    kind: 'react',
    label: 'React',
    note:
      'Requires: npm install @iconify/react' +
      (skipped.length ? `. Not included: ${skipped.join(', ')} (use the SVG tab for an exact copy).` : ''),
    code: [
      "import { Icon } from '@iconify/react';",
      '',
      `export function ${componentName(iconName)}() {`,
      '  return (',
      '    <Icon',
      ...props.map((p) => `      ${p}`),
      '    />',
      '  );',
      '}',
    ].join('\n'),
  };
}

function reactNativeSnippet({ iconName, custom, svg }: SnippetInput): Snippet {
  const xml = formatSvg(svg).replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  const indented = xml
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  return {
    kind: 'react-native',
    label: 'React Native',
    note: '@iconify/react does not run on React Native, so this is SVG-based. Requires: npm install react-native-svg',
    code: [
      "import { SvgXml } from 'react-native-svg';",
      '',
      `const xml = \`\n${indented}\n\`;`,
      '',
      `export function ${componentName(iconName)}({ size = ${custom.size} }: { size?: number }) {`,
      '  return <SvgXml xml={xml} width={size} height={size} />;',
      '}',
    ].join('\n'),
  };
}

export function buildSnippets(input: SnippetInput): Snippet[] {
  return [
    { kind: 'svg', label: 'SVG', note: 'Standalone SVG with every customization applied.', code: formatSvg(input.svg) },
    htmlSnippet(input),
    reactSnippet(input),
    reactNativeSnippet(input),
  ];
}
