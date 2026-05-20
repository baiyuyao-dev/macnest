/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        "card-foreground": "hsl(var(--card-foreground))",
        popover: "hsl(var(--popover))",
        "popover-foreground": "hsl(var(--popover-foreground))",
        primary: "hsl(var(--primary))",
        "primary-foreground": "hsl(var(--primary-foreground))",
        secondary: "hsl(var(--secondary))",
        "secondary-foreground": "hsl(var(--secondary-foreground))",
        muted: "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        accent: "hsl(var(--accent))",
        "accent-foreground": "hsl(var(--accent-foreground))",
        destructive: "hsl(var(--destructive))",
        "destructive-foreground": "hsl(var(--destructive-foreground))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        info: "hsl(var(--info))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "1rem",
        "2xl": "1.25rem",
        "3xl": "1.5rem",
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"SF Pro Display"', '"Helvetica Neue"', '"Segoe UI"', 'sans-serif'],
        mono: ['Menlo', '"DejaVu Sans Mono"', '"Courier New"', 'monospace'],
      },
      boxShadow: {
        glass: "var(--glass-shadow)",
        "glass-lg": "var(--glass-shadow-lg)",
      },
      animation: {
        "page-enter": "pageEnter 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
        "page-leave": "pageLeave 0.3s cubic-bezier(0.4, 0, 1, 1) both",
        "stagger": "staggerFadeIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards",
        shimmer: "shimmer 1.8s ease-in-out infinite",
        spinner: "spinner 0.8s linear infinite",
        "pulse-dot": "pulseDot 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "bounce-in": "bounceIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
        "slide-up": "slideUp 0.4s cubic-bezier(0.22, 1, 0.36, 1) both",
        float: "float 3s ease-in-out infinite",
        glow: "glow 2s ease-in-out infinite",
        "progress-indeterminate": "progressSlide 1.5s ease-in-out infinite",
      },
      keyframes: {
        pageEnter: {
          "0%": { opacity: "0", transform: "scale(0.97) translateY(12px)", filter: "blur(4px)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)", filter: "blur(0)" },
        },
        pageLeave: {
          "0%": { opacity: "1", transform: "scale(1)", filter: "blur(0)" },
          "100%": { opacity: "0", transform: "scale(0.97)", filter: "blur(4px)" },
        },
        staggerFadeIn: {
          "0%": { opacity: "0", transform: "translateY(16px) scale(0.96)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        spinner: {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        pulseDot: {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.5", transform: "scale(1.3)" },
        },
        bounceIn: {
          "0%": { opacity: "0", transform: "scale(0.3)" },
          "50%": { opacity: "1", transform: "scale(1.05)" },
          "70%": { transform: "scale(0.95)" },
          "100%": { transform: "scale(1)" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        glow: {
          "0%, 100%": { boxShadow: "0 0 20px hsl(var(--primary) / 0.15)" },
          "50%": { boxShadow: "0 0 40px hsl(var(--primary) / 0.3)" },
        },
        progressSlide: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(300%)" },
        },
      },
    },
  },
  plugins: [],
};
