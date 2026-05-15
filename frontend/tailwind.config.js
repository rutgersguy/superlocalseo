/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef3ff',
          100: '#dce8ff',
          200: '#bdd1ff',
          300: '#86aeff',
          400: '#4d87fb',
          500: '#1360fa',
          600: '#0a4de0',
          700: '#083db3',
          800: '#082e87',
          900: '#0a2266',
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
