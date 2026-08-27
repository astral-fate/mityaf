'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ICONS, NAV } from '@/lib/navigation';

function Icon({ name }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] ?? ICONS.grid} />
    </svg>
  );
}

/**
 * Grouped sidebar.
 *
 * A section containing the current page expands itself on first render rather
 * than waiting to be clicked — landing on a nested page with its own parent
 * collapsed makes the app feel like it has lost track of where you are.
 */
export default function Sidebar() {
  const pathname = usePathname();

  const [open, setOpen] = useState(() => {
    const s = new Set();
    for (const item of NAV) {
      if (item.children?.some((c) => pathname.startsWith(c.href))) s.add(item.id);
    }
    return s;
  });

  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // `/dashboard` would otherwise light up for every nested route.
  const isActive = (href) =>
    href === '/dashboard' ? pathname === href : pathname.startsWith(href);

  return (
    <nav className="sbar" aria-label="أقسام اللوحة">
      {NAV.map((item) => {
        if (!item.children) {
          return (
            <Link
              key={item.id}
              href={item.href}
              className={`sbar-item${isActive(item.href) ? ' on' : ''}`}
              aria-current={isActive(item.href) ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.title}</span>
            </Link>
          );
        }

        const expanded = open.has(item.id);
        const childActive = item.children.some((c) => isActive(c.href));
        return (
          <div key={item.id} className="sbar-group">
            <button
              type="button"
              className={`sbar-item as-group${childActive ? ' has-active' : ''}`}
              aria-expanded={expanded}
              onClick={() => toggle(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.title}</span>
              <svg className={`chev${expanded ? ' open' : ''}`} width="13" height="13"
                   viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            {expanded && (
              <div className="sbar-children">
                {item.children.map((c) => (
                  <Link
                    key={c.id}
                    href={c.href}
                    className={`sbar-child${isActive(c.href) ? ' on' : ''}`}
                    aria-current={isActive(c.href) ? 'page' : undefined}
                  >
                    <Icon name={c.icon} />
                    <span>{c.title}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
