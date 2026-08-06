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
        border: {
          DEFAULT: withVar('--border'),
          /* The heavier edge: inputs and secondary buttons, which must clear 3:1
             as UI boundaries rather than reading as a hairline rule. */
          strong: withVar('--border-strong'),
        },
        text: {
          DEFAULT: withVar('--text'),
          muted: withVar('--text-muted'),
          /* Never for anything the user must read — see theme.css. */
          faint: withVar('--text-faint'),
        },
        primary: {
          DEFAULT: withVar('--primary'),
          hover: withVar('--primary-hover'),
          active: withVar('--primary-active'),
          subtle: withVar('--primary-subtle'),
          /* Ink that sits on the primary fill — see theme.css. */
          ink: withVar('--primary-ink'),
        },
        accent: {
          DEFAULT: withVar('--accent'),
          subtle: withVar('--accent-subtle'),
          /* The selected row's edge, and the focus ring. */
          border: withVar('--accent-border'),
          focus: withVar('--accent-focus'),
        },
        /* "N filled" — a count that is neither good news nor bad, so it takes
           neither the success nor the danger role. */
        neutral: withVar('--neutral'),
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
          /* The active nav row's fill — a step up off the rail plane. */
          raised: withVar('--field-raised'),
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
        /* The redesign's own scale, stepped up 1px throughout for legibility — its
           13.5px body and 9.5px column labels read small on a real monitor. Sizes
           in the trailing comments are the shipped values; the redesign's originals
           are 1px lower (13.5px body /.sub/.inp, 13px cells /.dc2, 9.5px labels
           /.hc/.kick/.cm, 16px card titles /.ct, 31px figures /.big, 33px h1). */
        '3xs': ['0.65625rem', { lineHeight: '1', letterSpacing: '0.14em' }], // 10.5px
        '2xs': ['0.6875rem', { lineHeight: '0.9375rem', letterSpacing: '0.1em' }], // 11px
        xs: ['0.78125rem', { lineHeight: '1.0625rem' }], // 12.5px
        sm: ['0.875rem', { lineHeight: '1.2rem' }], // 14px
        base: ['0.90625rem', { lineHeight: '1.5' }], // 14.5px
        lg: ['1.0625rem', { lineHeight: '1.2' }], // 17px
        xl: ['1.3125rem', { lineHeight: '1.2' }], // 21px
        '2xl': ['1.5625rem', { lineHeight: '1.1' }], // 25px
        '3xl': ['2rem', { lineHeight: '1' }], // 32px — .big
        '4xl': ['2.125rem', { lineHeight: '1.04' }], // 34px — .h1
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
