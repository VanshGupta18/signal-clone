"use client";

import { useLayoutEffect } from "react";

// Light / Dark / System, saved per browser (D89). "system" = no data-theme attribute, so the
// prefers-color-scheme rule in globals.css decides. app/layout.tsx has an inline-script copy of
// applyTheme(getTheme()) that runs before first paint, so a saved Dark never flashes white.
export type Theme = "light" | "dark" | "system";

const THEME_KEY = "signal_theme"; // also read by the inline script in app/layout.tsx

export function getTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === "light" || saved === "dark" ? saved : "system";
}

function applyTheme(theme: Theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

// Rendered once in the root layout. In `next dev`, Strict Mode remounts the root and React
// resets <html>'s attributes, wiping what the inline script set; this puts it back before
// paint. A no-op in production.
export function ThemeSync() {
  useLayoutEffect(() => applyTheme(getTheme()), []);
  return null;
}
