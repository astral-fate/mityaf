'use client';

import { useEffect, useState } from 'react';

/**
 * Light / dark switch for the console.
 *
 * Light is the product default — this tool is read in daylight and in
 * meetings — so the toggle only ever writes an explicit choice; there is no
 * "system" state to fall back into. The choice is stamped on <html> as
 * data-theme and persisted, and the inline script in layout.jsx applies it
 * before first paint so a returning visitor never sees the light console flash
 * before their dark one arrives.
 *
 * Renders a placeholder until mounted: the server has no way to know what is
 * in localStorage, and rendering the wrong icon then correcting it is the same
 * flash one level down.
 */
const STORAGE_KEY = 'mityaf-theme';

export default function ThemeToggle() {
  const [theme, setTheme] = useState(null);

  useEffect(() => {
    const stamped = document.documentElement.getAttribute('data-theme');
    setTheme(stamped === 'dark' ? 'dark' : 'light');
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode: the theme still applies for this session */
    }
  }

  const dark = theme === 'dark';

  return (
    <button
      type="button"
      className="theme-tgl"
      onClick={toggle}
      aria-label={dark ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن'}
      title={dark ? 'الوضع الفاتح' : 'الوضع الداكن'}
      suppressHydrationWarning
    >
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
           fill="none" stroke="currentColor" strokeWidth="1.8"
           strokeLinecap="round" strokeLinejoin="round">
        {dark ? (
          /* moon — currently dark, click for light */
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
          </>
        )}
      </svg>
      <span>{theme === null ? '' : dark ? 'داكن' : 'فاتح'}</span>
    </button>
  );
}
