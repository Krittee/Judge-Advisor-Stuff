import type { Metadata, Viewport } from "next";
import { ThemeToggle } from "@/components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "Judge Queue",
  description: "Request a judge interview and track its status live.",
  applicationName: "Judge Queue",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Judge Queue",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
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
        {process.env.NODE_ENV === "production" ? (
          <script dangerouslySetInnerHTML={{ __html: serviceWorkerRegistration }} />
        ) : (
          <script dangerouslySetInnerHTML={{ __html: serviceWorkerCleanup }} />
        )}
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

/** Production only: development stays free of persistent browser caches. */
const serviceWorkerRegistration = `
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch((error) => console.error("Service worker registration failed:", error));
    });
  }
`;

/** Remove a worker left by `next start` when the same localhost runs `next dev`. */
const serviceWorkerCleanup = `
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        if (registration.active?.scriptURL.endsWith("/sw.js")) registration.unregister();
      }
    });
    caches.keys().then((keys) => {
      for (const key of keys) {
        if (key.startsWith("judge-queue-")) caches.delete(key);
      }
    });
  }
`;
