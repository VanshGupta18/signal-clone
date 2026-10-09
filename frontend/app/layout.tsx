import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeSync } from "@/lib/theme";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Signal",
  description: "Signal Desktop clone",
};

// Same as applyTheme(getTheme()) in lib/theme.ts. Written out here because this layout is a
// Server Component, and a "use client" module's exports aren't plain values on the server.
const THEME_SCRIPT = `try{var t=localStorage.getItem("signal_theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

// The inline script applies the saved theme while the HTML is parsed, before the first paint
// (Next's "Preventing flash before hydration" guide). suppressHydrationWarning: the script
// changes <html>'s data-theme before React hydrates, and that difference is expected.
// Explicit type instead of Next's generated global LayoutProps, so `tsc` passes on a fresh clone
// before any `next dev`/`next build` has generated types.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={inter.className}>
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
