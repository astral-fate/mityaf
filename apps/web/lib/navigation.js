/**
 * Dashboard navigation, declared rather than hand-wired per page.
 *
 * The console previously had two views behind a narrow rail, which forced one
 * screen to answer questions that are not the same question. "What needs
 * attention today", "where is it", "which district", "which asset" and "give
 * me the numbers" each deserve a page, and each page should be able to say
 * one thing well.
 *
 * Grouped so the sidebar can collapse sections that are not in use, and keyed
 * by id so the active parent can expand itself from the current path.
 */

export const NAV = [
  {
    id: 'overview',
    title: 'نظرة عامة',
    icon: 'grid',
    href: '/dashboard',
  },
  {
    id: 'map',
    title: 'الخريطة التشغيلية',
    icon: 'map',
    href: '/dashboard/map',
  },
  {
    id: 'assets',
    title: 'الأصول',
    icon: 'layers',
    children: [
      { id: 'districts', title: 'الأحياء', icon: 'hash', href: '/dashboard/districts' },
      { id: 'green', title: 'المسطّحات الخضراء', icon: 'leaf', href: '/dashboard/green' },
      { id: 'segments', title: 'مقاطع الشوارع', icon: 'road', href: '/dashboard/segments' },
    ],
  },
  {
    id: 'analysis',
    title: 'التحليل',
    icon: 'chart',
    children: [
      { id: 'stats', title: 'الإحصاءات', icon: 'chart', href: '/dashboard/stats' },
      { id: 'rain', title: 'الأحداث المطرية', icon: 'drop', href: '/dashboard/rain' },
    ],
  },
];

/** Flat list of every leaf, for breadcrumbs and the command palette. */
export const NAV_LEAVES = NAV.flatMap((n) => (n.children ? n.children : [n]));

export function findLeaf(pathname) {
  return NAV_LEAVES.find((l) => l.href === pathname) ?? null;
}

/**
 * Inline SVG rather than an icon package: the whole set is nine glyphs, and a
 * dependency that ships a thousand is a poor trade for that.
 */
export const ICONS = {
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  map: 'M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20zM9 4v13.5M15 6.5V20',
  layers: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  hash: 'M9 4 7 20M17 4l-2 16M4 9h16M3 15h16',
  leaf: 'M11 20A7 7 0 0 1 4 13c0-5 4-9 16-9 0 10-4 15-9 15zM4 20c2-5 5-8 9-9',
  road: 'M4 20 8 4M20 20 16 4M12 5v2M12 11v2M12 17v2',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  drop: 'M12 3s6 6.5 6 10a6 6 0 0 1-12 0c0-3.5 6-10 6-10z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
};
