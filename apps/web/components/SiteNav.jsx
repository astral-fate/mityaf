'use client';

import { useEffect, useState } from 'react';
import ThemeToggle from './ThemeToggle';

/**
 * Site nav. It rides transparent over the hero raster and picks up its
 * background once you leave it, so the satellite image reads full-bleed
 * instead of starting under a bar.
 */

const LINKS = [
  { href: '/', label: 'الرئيسية' },
  { href: '/#stack', label: 'كيف يعمل' },
  { href: '/method', label: 'المنهجية والحدود' },
];

export default function SiteNav() {
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav className={`topnav${solid ? '' : ' ghost'}`}>
      <a className="brandmark" href="/">
        <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="4.2" r="2.1" fill="var(--neon)" />
          <path d="M5 11a9 9 0 0 1 14 0" fill="none" stroke="var(--neon)" strokeWidth="1.7" strokeLinecap="round" opacity="0.75" />
          <path d="M7.5 16a6 6 0 0 1 9 0" fill="none" stroke="var(--cyan)" strokeWidth="1.7" strokeLinecap="round" opacity="0.7" />
          <path d="M10 20.6a3 3 0 0 1 4 0" fill="none" stroke="var(--cyan)" strokeWidth="1.7" strokeLinecap="round" opacity="0.5" />
        </svg>
        <span className="brand-name">مِطياف</span>
        <span className="brand-sub">أمانة منطقة المدينة المنورة</span>
      </a>

      <div className="navlinks">
        {LINKS.map((l) => (
          <a key={l.href} href={l.href}>{l.label}</a>
        ))}
      </div>

      <ThemeToggle />
      <a className="nav-cta" href="/dashboard">لوحة الرصد</a>
    </nav>
  );
}
