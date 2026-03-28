/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#EAF3DE',
          100: '#C8E6A0',
          500: '#4A7A23',
          600: '#2D5016',
          700: '#1E3A0F',
        },
      },
      fontFamily: {
        sans: ['Source Sans 3', 'Source Sans Pro', 'sans-serif'],
        heading: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
