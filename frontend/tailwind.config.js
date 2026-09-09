/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--workspace-canvas)', surface: 'var(--workspace-surface)',
        forest: 'var(--workspace-forest)', action: 'var(--workspace-action)',
        sage: 'var(--workspace-sage)', ink: 'var(--workspace-text)',
        brand: {
          50: '#f0f5ef', 100: '#eaf0e9', 200: '#d1dfd0', 300: '#adc5b2',
          400: '#729a81', 500: '#28624e', 600: '#1e503f', 700: '#173e36',
          800: '#14372f', 900: '#102d27',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
        'card-md': '0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.07)',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
