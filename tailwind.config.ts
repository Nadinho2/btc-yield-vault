import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./hooks/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "#05020b",
        "background-soft": "#0b0616",
        primary: {
          DEFAULT: "#7C3AED",
          foreground: "#F9FAFB"
        },
        accent: {
          DEFAULT: "#F97316",
          foreground: "#0B0616"
        },
        muted: "#111827",
        border: "#1F2933"
      },
      boxShadow: {
        "elevated": "0 24px 60px rgba(15, 23, 42, 0.75)"
      },
      borderRadius: {
        xl: "1.25rem",
        "2xl": "1.75rem"
      }
    }
  },
  plugins: []
};

export default config;
