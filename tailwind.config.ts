import type { Config } from "tailwindcss";

/**
 * Palette taken from the VedaAI product design.
 *
 * Two colours carry meaning and must not be used decoratively:
 *   brand (orange) = "this is selected"
 *   good  (green)  = "this is the answer" — the region highlight and full marks
 * Everything else is neutral chrome.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F1F1F1",
        surface: "#FFFFFF",
        raised: "#F7F7F8",
        line: "#E8E8E8",
        hairline: "#F0F0F0",

        ink: "#1A1A1A",
        body: "#4A4A4A",
        mute: "#7A7A7A",
        faint: "#A3A3A3",

        brand: {
          DEFAULT: "#FC5E24",
          hover: "#E8511A",
          soft: "#FFEDE4",
          ring: "#FFC6A1",
        },

        good: { DEFAULT: "#16A34A", soft: "#E8F7EE", ring: "#22C55E" },
        warn: { DEFAULT: "#E08600", soft: "#FFF4E0" },
        bad: { DEFAULT: "#E23B2E", soft: "#FDECEA" },
      },
      fontFamily: {
        sans: ["var(--font-ui)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-ui)", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)",
        card: "0 1px 2px rgba(0,0,0,0.05)",
        pop: "0 4px 16px rgba(0,0,0,0.10)",
      },
      borderRadius: {
        xl2: "14px",
      },
      keyframes: {
        twinkle: {
          "0%,100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.45", transform: "scale(0.86)" },
        },
        riseIn: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        markIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        twinkle: "twinkle 1.7s ease-in-out infinite",
        riseIn: "riseIn .28s ease-out both",
        markIn: "markIn .25s ease-out both",
      },
    },
  },
  plugins: [],
};
export default config;
