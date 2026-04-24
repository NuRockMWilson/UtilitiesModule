import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // NuRock brand system
        navy: {
          DEFAULT: "#164576",
          50: "#E7EEF6",
          100: "#C4D4E8",
          200: "#9DB7D7",
          300: "#7499C5",
          400: "#4E7FB4",
          500: "#2C66A3",
          600: "#164576", // primary navy
          700: "#103759",
          800: "#0B2840",
          900: "#061A2A",
        },
        tan: {
          DEFAULT: "#B4AE92",
          50: "#F5F4EE",
          100: "#E8E5D6",
          200: "#D9D4BD",
          300: "#CBC4A5",
          400: "#B4AE92", // primary tan
          500: "#9A9474",
          600: "#7F7A5B",
          700: "#625E46",
          800: "#454230",
          900: "#2A281D",
        },
        ink: "#0F1720",
        paper: "#FBFBF8",
        flag: {
          green:  "#1F8A5B",
          yellow: "#D8A31A",
          red:    "#B8372B",
        },
      },
      fontFamily: {
        display: ["Oswald", "system-ui", "sans-serif"],
        sans:    ["Inter",  "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,32,0.04), 0 1px 3px rgba(15,23,32,0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
