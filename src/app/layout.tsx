import type { Metadata, Viewport } from "next";
import { ThemeToggle } from "@/components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "Judge Queue",
  description: "Request a judge interview and track its status live.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximumScale: capping it blocks pinch-zoom, and someone squinting at
  // a team number on a phone in a loud hall needs to be able to zoom in.
  themeColor: "#0a0a0f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializer }} />
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <ThemeToggle />
      </body>
    </html>
  );
}

/** Set the saved or system theme before the page paints, avoiding a bright flash. */
const themeInitializer = `
  (() => {
    try {
      const saved = localStorage.getItem("judge-queue-theme");
      const theme = saved === "light" || saved === "dark"
        ? saved
        : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    } catch (_) {
      document.documentElement.dataset.theme = "dark";
    }
  })();
`;
