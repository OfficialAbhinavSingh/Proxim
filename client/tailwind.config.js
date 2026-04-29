/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
        display: ["Outfit", "system-ui", "sans-serif"],
      },
      colors: {
        proxim: {
          950: "#0a0f1a",
          900: "#0f1729",
          800: "#152238",
          700: "#1e3354",
          accent: "#3b82f6",
          mint: "#34d399",
        },
      },
    },
  },
  plugins: [],
};
