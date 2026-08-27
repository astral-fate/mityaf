'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import './dashboard.css';

/**
 * Dashboard shell: a narrow icon rail plus whichever view is mounted.
 *
 * The rail exists because the console stopped being one screen. A map answers
 * "where", but "how many, in which district, over which weeks, and give me
 * the numbers" are different questions and each needs its own view.
 */

const NAV = [
  {
    href: '/dashboard',
    label: 'الخريطة',
    icon: (
      <>
        <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" />
        <path d="M9 4v13.5M15 6.5V20" />
      </>
    ),
  },
  {
    href: '/dashboard/stats',
    label: 'الإحصاءات',
    icon: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </>
    ),
  },
];

export default function DashboardLayout({ children }) {
  const path = usePathname();

  return (
    <div className="dash-shell">
      <nav className="rail" aria-label="أقسام اللوحة">
        {NAV.map((n) => {
          const on = path === n.href;
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`rail-item${on ? ' on' : ''}`}
              aria-current={on ? 'page' : undefined}
            >
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="1.6"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {n.icon}
              </svg>
              <span>{n.label}</span>
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
