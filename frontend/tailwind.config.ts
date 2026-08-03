import type { Config } from 'tailwindcss';

// Colors are driven by CSS custom properties (see src/styles/theme.css) so light/dark
// is a single `data-theme` swap on <html>. Channels are stored as space-separated RGB
// triplets, which lets Tailwind's `<alpha-value>` keep opacity utilities working.
const withVar = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: withVar('--canvas'),
        surface: {
          DEFAULT: withVar('--surface'),
          2: withVar('--surface-2'),
        },
        border: withVar('--border'),
        text: {
          DEFAULT: withVar('--text'),
          muted: withVar('--text-muted'),
        },
        primary: {
          DEFAULT: withVar('--primary'),
          hover: withVar('--primary-hover'),
          subtle: withVar('--primary-subtle'),
        },
        accent: {
          DEFAULT: withVar('--accent'),
          subtle: withVar('--accent-subtle'),
        },
        success: {
          DEFAULT: withVar('--success'),
          subtle: withVar('--success-subtle'),
        },
        warning: {
          DEFAULT: withVar('--warning'),
          subtle: withVar('--warning-subtle'),
        },
        danger: {
          DEFAULT: withVar('--danger'),
          subtle: withVar('--danger-subtle'),
        },
        /* The dark steel nav rail — its own plane, dark in both themes. */
        field: {
          DEFAULT: withVar('--field'),
          ink: withVar('--field-ink'),
          'ink-2': withVar('--field-ink-2'),
          'ink-3': withVar('--field-ink-3'),
          accent: withVar('--field-accent'),
        },
      },
      fontFamily: {
        /* Barlow Condensed headings over Barlow body, self-hosted via @fontsource
           (see styles/index.css) — no render-blocking CDN import. */
        sans: ['Barlow', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        heading: ['Barlow Condensed', 'Barlow', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        /* Industry runs tighter than the previous scale: 13.5px body, and headings
           that lean on the condensed face rather than on size alone. */
        '2xs': ['0.625rem', { lineHeight: '0.875rem', letterSpacing: '0.1em' }],
        xs: ['0.6875rem', { lineHeight: '1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.15rem' }],
        base: ['0.84375rem', { lineHeight: '1.3rem' }],
        lg: ['1rem', { lineHeight: '1.2' }],
        xl: ['1.25rem', { lineHeight: '1.2' }],
        '2xl': ['1.5rem', { lineHeight: '1.1' }],
        '3xl': ['2.0625rem', { lineHeight: '1.04' }],
      },
      borderRadius: {
        /* Square corners are the system's defining move — one change reskins
           every control and card. */
        control: '0',
        card: '0',
      },
      boxShadow: {
        card: '0 1px 2px rgb(20 22 24 / 0.05)',
        pop: '0 1px 2px rgb(20 22 24 / 0.05), 0 8px 24px -6px rgb(20 22 24 / 0.14)',
        dialog: '0 2px 4px rgb(20 22 24 / 0.07), 0 24px 60px -12px rgb(20 22 24 / 0.28)',
      },
    },
  },
  plugins: [],
} satisfies Config;
