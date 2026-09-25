import type { Metadata, Viewport } from "next";
import { Archivo, Fira_Sans } from "next/font/google";
import { ThemeToggle } from "@/components/ThemeToggle";
import "./globals.css";

/**
 * Two faces, each picked for a job this app actually has.
 *
 * Archivo carries the headings and every large figure. It is a grotesque
 * with institutional weight and even, unambiguous numerals, and its
 * variable width axis is what lets the board stretch a team number to
 * fill a projector rather than merely scaling it up.
 *
 * Fira Sans sets the interface. It was drawn for small screens in poor
 * conditions and keeps `1 l I` and `0 O` clearly apart -- which is a
 * correctness feature here, not a preference, because the things people
 * read off these screens are identifiers like 9882K and getting one
 * wrong sends a judge to the wrong team.
 */
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

const fira = Fira_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-fira",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Judge Queue",
  description: "Request a judge interview and track its status live.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximumScale: capping it blocks pinch-zoom, and someone squinting at
  // a team number on a phone in a loud hall needs to be able to zoom in.
  themeColor: "#15151c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${archivo.variable} ${fira.variable}`}
    >
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
