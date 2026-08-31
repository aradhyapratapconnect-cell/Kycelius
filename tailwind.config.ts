import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/renderer/**/*.{ts,tsx}',
    './src/renderer/index.html',
  ],
  theme: {
    extend: {
      colors: {
        // Material dark theme tokens, taken verbatim from the reference
        // mockups (test/kycelius-home.html, test/activity.html). The mockups
        // are authoritative for this pass (T-22) and are explicitly dark.
        surface: '#101412',
        'surface-lowest': '#0B0F0D',
        'surface-low': '#181C1A',
        'surface-container': '#1C201E',
        'surface-high': '#272B29',
        'surface-highest': '#323633',
        'surface-variant': '#323633',
        outline: '#879489',
        'outline-variant': '#3E4A41',
        background: '#101412',
        'on-surface': '#E0E3DF',
        'on-surface-variant': '#BDCABE',
        'on-background': '#E0E3DF',
        primary: '#6BDC9B',
        'primary-container': '#2FA66A',
        'primary-fixed': '#88F9B5',
        'primary-fixed-dim': '#6BDC9B',
        'on-primary': '#00391F',
        'on-primary-container': '#00331B',
        secondary: '#8BCFF0',
        'secondary-container': '#005F7B',
        'secondary-fixed': '#BFE9FF',
        'on-secondary': '#003547',
        'on-secondary-container': '#92D6F7',
        tertiary: '#82D8A6',
        'tertiary-container': '#4EA375',
        'tertiary-fixed': '#9EF5C1',
        'on-tertiary': '#003921',
        'on-tertiary-container': '#00331D',
        error: '#FFB4AB',
        'error-container': '#93000A',
        'on-error': '#690005',
        'on-error-container': '#FFDAD6',
        // Legacy semantic names remapped to the dark theme so existing
        // components flip to dark without a parallel color system.
        'sky-light': '#BFE9FF',
        'sky-deep': '#8BCFF0',
        'leaf-primary': '#6BDC9B',
        'leaf-soft': '#88F9B5',
        'leaf-dark': '#2FA66A',
        blossom: '#82D8A6',
        'blossom-deep': '#9EF5C1',
        stone: '#323633',
        bark: '#BDCABE',
        ink: '#E0E3DF',
        mist: '#101412',
        danger: '#FFB4AB',
        success: '#6BDC9B',
        warning: '#D6A24A',
        capsule: '#355044',
      },
      fontFamily: {
        heading: ['Geist', 'sans-serif'],
        body: ['Geist', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      spacing: {
        'base': '4px',
      },
      boxShadow: {
        'glass': '0 20px 40px rgba(0, 0, 0, 0.4)',
        'glass-card': '0 10px 20px rgba(0, 0, 0, 0.2)',
      },
      borderRadius: {
        card: '24px',
      },
    },
  },
  plugins: [],
};

export default config;