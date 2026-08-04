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
          /* Ink that sits on the primary fill — see theme.css. */
          ink: withVar('--primary-ink'),
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
        /* The dark steel nav rail — its own plane, dark in both themes.
           The two `ln` steps are rules drawn on that plane, so they are
           alpha-on-ink rather than token channels. */
        field: {
          DEFAULT: withVar('--field'),
          ink: withVar('--field-ink'),
          'ink-2': withVar('--field-ink-2'),
          'ink-3': withVar('--field-ink-3'),
          accent: withVar('--field-accent'),
          ln: 'rgb(231 234 238 / 0.14)',
          ln2: 'rgb(231 234 238 / 0.3)',
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
        /* Matched to the redesign's own specs: 13.5px body (.sub/.inp), 13px table
           cells (.dc2), 9.5px monospace column labels (.hc/.kick/.cm), 16px card
           titles (.ct), 31px plate figures (.big), 33px page headings (.h1). */
        '3xs': ['0.59375rem', { lineHeight: '1', letterSpacing: '0.14em' }], // 9.5px
        '2xs': ['0.625rem', { lineHeight: '0.875rem', letterSpacing: '0.1em' }], // 10px
        xs: ['0.71875rem', { lineHeight: '1rem' }], // 11.5px
        sm: ['0.8125rem', { lineHeight: '1.15rem' }], // 13px
        base: ['0.84375rem', { lineHeight: '1.5' }], // 13.5px
        lg: ['1rem', { lineHeight: '1.2' }], // 16px
        xl: ['1.25rem', { lineHeight: '1.2' }], // 20px
        '2xl': ['1.5rem', { lineHeight: '1.1' }], // 24px
        '3xl': ['1.9375rem', { lineHeight: '1' }], // 31px — .big
        '4xl': ['2.0625rem', { lineHeight: '1.04' }], // 33px — .h1
      },
      borderRadius: {
        /* Square corners are the system's defining move — one change reskins
           every control and card. */
        control: '0',
        card: '0',
      },
      boxShadow: {
        /* Cards are transparent line drawings in this system, so they carry no
           shadow — only floating surfaces (popovers, dialogs) do. */
        pop: '0 1px 2px rgb(20 22 24 / 0.05), 0 8px 24px -6px rgb(20 22 24 / 0.14)',
        dialog: '0 2px 4px rgb(20 22 24 / 0.07), 0 24px 60px -12px rgb(20 22 24 / 0.28)',
      },
    },
  },
  plugins: [],
} satisfies Config;
