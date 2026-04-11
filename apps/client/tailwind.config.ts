import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        paper: "#f7f4ed",
        blush: "#ffc7a2",
        moss: "#275b52",
        sky: "#94d2ff",
        ember: "#f97316"
      },
      boxShadow: {
        pane: "0 24px 60px rgba(15, 23, 42, 0.12)"
      },
      fontFamily: {
        sans: ["Manrope", "ui-sans-serif", "system-ui"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular"]
      }
    }
  },
  plugins: []
} satisfies Config;
