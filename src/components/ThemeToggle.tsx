"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "judge-queue-theme";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "light" ? "#f4f5f9" : "#0a0a0f");
}

/** A device-local display preference; it never touches event data. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const rootTheme = document.documentElement.dataset.theme;
    const initial: Theme = rootTheme === "light" ? "light" : "dark";
    setTheme(initial);
    applyTheme(initial);

    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const followSystem = (event: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem(STORAGE_KEY)) return;
      } catch {
        /* Storage can be disabled; the toggle still works for this page. */
      }
      const next = event.matches ? "dark" : "light";
      setTheme(next);
      applyTheme(next);
    };
    preference.addEventListener("change", followSystem);
    return () => preference.removeEventListener("change", followSystem);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Keep the in-page preference even when storage is unavailable. */
    }
    setTheme(next);
    applyTheme(next);
  }

  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      className="theme-toggle"
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.4 15.2A8.5 8.5 0 0 1 8.8 3.6 8.5 8.5 0 1 0 20.4 15.2Z" />
    </svg>
  );
}
