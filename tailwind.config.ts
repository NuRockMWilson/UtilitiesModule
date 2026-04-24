import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        nurock: {
          navy:         "#164576",
          "navy-dark":  "#0F3557",
          "navy-light": "#1E5A94",
          tan:          "#B4AE92",
          "tan-light":  "#C9C3A8",
          "tan-dark":   "#8F8A6F",
          black:        "#101828",
          slate:        "#475467",
          "slate-light":"#667085",
          gray:         "#F4F4F4",
          offwhite:     "#F2F2F2",
          border:       "#E4E7EC",
          bg:           "#F7F8FA",
        },
        // Legacy aliases — map to the new system so existing className references
        // throughout the codebase keep working.
        navy: {
          DEFAULT: "#164576",
          50:  "#EFF4FB",
          100: "#DCE6F2",
          200: "#B8CCE4",
          300: "#7FA1CC",
          400: "#4E7FB4",
          500: "#2C66A3",
          600: "#164576",
          700: "#0F3557",
          800: "#0B2840",
          900: "#061A2A",
        },
        tan: {
          DEFAULT: "#B4AE92",
          50:  "#F8F7F2",
          100: "#F5F3ED",
          200: "#E8E5D6",
          300: "#D9D4BD",
          400: "#C9C3A8",
          500: "#B4AE92",
          600: "#8F8A6F",
          700: "#625E46",
          800: "#454230",
          900: "#2A281D",
        },
        ink:   "#101828",
        paper: "#F7F8FA",
        flag: {
          green:  "#027A48",
          yellow: "#B54708",
          red:    "#B42318",
          "green-bg": "#ECFDF3",
          "amber-bg": "#FFFAEB",
          "red-bg":   "#FEF3F2",
          "navy-bg":  "#EFF4FB",
          "slate-bg": "#F2F4F7",
        },
      },
      fontFamily: {
        display: ["Oswald",         "ui-sans-serif", "system-ui", "sans-serif"],
        sans:    ["Inter",          "ui-sans-serif", "system-ui", "sans-serif"],
        body:    ["Inter",          "ui-sans-serif", "system-ui", "sans-serif"],
        mono:    ["JetBrains Mono", "ui-monospace",  "monospace"],
      },
      boxShadow: {
        card:     "0 1px 2px 0 rgba(16, 24, 40, 0.04)",
        "card-h": "0 1px 3px 0 rgba(16, 24, 40, 0.08), 0 1px 2px 0 rgba(16, 24, 40, 0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
