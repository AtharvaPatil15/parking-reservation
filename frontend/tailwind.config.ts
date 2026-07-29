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
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.25rem', { lineHeight: '1.75rem' }],
        xl: ['1.5rem', { lineHeight: '2rem' }],
        '2xl': ['1.875rem', { lineHeight: '2.25rem' }],
      },
      borderRadius: {
        control: '0.375rem',
        card: '0.5rem',
      },
      boxShadow: {
        card: '0 1px 2px rgb(16 24 40 / 0.04), 0 4px 12px rgb(16 24 40 / 0.06)',
        pop: '0 8px 24px rgb(16 24 40 / 0.12)',
      },
    },
  },
  plugins: [],
} satisfies Config;
