import defaultTheme from 'tailwindcss/defaultTheme';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#f0faf6',
          100: '#d6f0e4',
          200: '#b0e0cb',
          300: '#7ccaab',
          400: '#4aab85',
          500: '#2d8b6a',
          600: '#1a6b4e',
          700: '#0A3D2E',
          800: '#082f23',
          900: '#061f17',
        },
        // Status colors
        status: {
          success: '#16a34a',
          warning: '#d97706',
          danger: '#dc2626',
          info: '#2563eb',
          neutral: '#6b7280',
        },
        // Warm neutral ramp matching the login's paper palette (provisional
        // pending brand identity work) — replaces Tailwind's cool grays app-wide.
        gray: {
          50:  '#faf7f2',
          100: '#f3eee5',
          200: '#e3ddd2',
          300: '#cfc8ba',
          400: '#a49d8f',
          500: '#75705f',
          600: '#6b665c',
          700: '#57534a',
          800: '#3f3a33',
          900: '#1f2721',
          950: '#171b17',
        },
      },
      fontFamily: {
        sans: ['Poppins', 'Inter', ...defaultTheme.fontFamily.sans],
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.03)',
        DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.05)',
        md: '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.03)',
        lg: '0 10px 15px -3px rgb(0 0 0 / 0.05), 0 4px 6px -4px rgb(0 0 0 / 0.03)',
        xl: '0 20px 25px -5px rgb(0 0 0 / 0.05), 0 8px 10px -6px rgb(0 0 0 / 0.03)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
