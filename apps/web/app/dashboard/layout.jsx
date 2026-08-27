'use client';

import './dashboard.css';
import Sidebar from '@/components/Sidebar';

/**
 * Dashboard shell: a grouped sidebar and whichever view is mounted.
 *
 * The console had outgrown one screen. A map answers "where"; "what needs
 * attention", "which district", "which asset" and "give me the numbers" are
 * separate questions, and each now has a page that answers it directly
 * instead of one view trying to serve all of them at once.
 */
export default function DashboardLayout({ children }) {
  return (
    <div className="dash-shell">
      <Sidebar />
      <div className="dash-view">{children}</div>
    </div>
  );
}
