'use client';

import { useEffect, useState } from 'react';
import { loadDistricts } from '@/lib/data';

/**
 * District and time-window controls, shared by every dashboard view.
 *
 * The district list is read from districts.geojson rather than derived from
 * the 6.8 MB segment file, so the control is usable before the map data has
 * finished arriving — and it carries each district's segment count, which is
 * what tells an operator whether narrowing to it will leave them anything.
 */

const PRESETS = [
  { k: '30', label: 'آخر ٣٠ يوماً', days: 30 },
  { k: '90', label: 'آخر ٣ أشهر', days: 90 },
  { k: '365', label: 'آخر سنة', days: 365 },
  { k: 'all', label: 'الأرشيف كاملاً', days: null },
];

const iso = (d) => d.toISOString().slice(0, 10);

export default function FilterBar({ filters, update, clear, active }) {
  const [districts, setDistricts] = useState([]);

  useEffect(() => {
    loadDistricts().then((d) => {
      const list = (d?.features ?? [])
        .map((f) => f.properties)
        .filter((p) => p.seg > 0)
        .sort((a, b) => b.seg - a.seg);
      setDistricts(list);
    });
  }, []);

  const applyPreset = (p) => {
    if (!p.days) return update({ from: null, to: null });
    const to = new Date();
    const from = new Date(to.getTime() - p.days * 864e5);
    return update({ from: iso(from), to: iso(to) });
  };

  return (
    <div className="fbar">
      <div className="fbar-row">
        <label className="fbar-lab" htmlFor="f-district">الحي</label>
        <select
          id="f-district"
          className="fbar-sel"
          value={filters.district ?? ''}
          onChange={(e) => update({ district: e.target.value || null })}
        >
          <option value="">كل الأحياء ({districts.length})</option>
          {districts.map((d) => (
            <option key={d.id} value={d.name}>
              {d.name} — {d.seg.toLocaleString('en-US')} مقطع
            </option>
          ))}
        </select>
      </div>

      <div className="fbar-row">
        <span className="fbar-lab">المدى الزمني</span>
        <div className="fbar-presets">
          {PRESETS.map((p) => (
            <button
              key={p.k}
              type="button"
              className="fbar-preset"
              onClick={() => applyPreset(p)}
              aria-pressed={p.days ? false : !filters.from && !filters.to}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="fbar-row dates">
        <input
          type="date" className="fbar-date" aria-label="من تاريخ"
          value={filters.from ?? ''}
          onChange={(e) => update({ from: e.target.value || null })}
        />
        <span className="fbar-dash">→</span>
        <input
          type="date" className="fbar-date" aria-label="إلى تاريخ"
          value={filters.to ?? ''}
          onChange={(e) => update({ to: e.target.value || null })}
        />
      </div>

      {active && (
        <button type="button" className="fbar-clear" onClick={clear}>
          مسح المرشّحات
        </button>
      )}
    </div>
  );
}
