'use client';

import { useEffect, useState } from 'react';
import { loadDistricts } from '@/lib/data';
import { MECHANISMS, MECHANISM_ORDER } from '@/lib/mechanisms';

/**
 * Filters, on one horizontal row.
 *
 * The first version stacked a select, four preset buttons and two date inputs
 * down a 300 px column, which spent a third of the screen on controls nobody
 * looks at twice. Everything here is either a dropdown or collapses into one,
 * so the row is a strip and the data gets the space.
 */

const PRESETS = [
  { k: 'all', label: 'الأرشيف كاملاً', days: null },
  { k: '30', label: 'آخر ٣٠ يوماً', days: 30 },
  { k: '90', label: 'آخر ٣ أشهر', days: 90 },
  { k: '365', label: 'آخر سنة', days: 365 },
  { k: 'custom', label: 'مدى مخصّص', days: 'custom' },
];

const iso = (d) => d.toISOString().slice(0, 10);

export default function FilterBar({
  filters, update, clear, active, extra = null, showMechanism = false,
}) {
  const [districts, setDistricts] = useState([]);
  const [custom, setCustom] = useState(false);

  useEffect(() => {
    loadDistricts().then((d) => {
      setDistricts((d?.features ?? [])
        .map((f) => f.properties)
        .filter((p) => p.seg > 0)
        .sort((a, b) => b.seg - a.seg));
    });
  }, []);

  // A stored range that matches no preset is a custom range; reflect that on
  // load so a shared link does not open showing "الأرشيف كاملاً".
  useEffect(() => {
    if (filters.from || filters.to) setCustom(true);
  }, [filters.from, filters.to]);

  const onPreset = (v) => {
    const p = PRESETS.find((x) => x.k === v);
    if (!p) return;
    if (p.days === 'custom') { setCustom(true); return; }
    setCustom(false);
    if (!p.days) return update({ from: null, to: null });
    const to = new Date();
    return update({ from: iso(new Date(to.getTime() - p.days * 864e5)), to: iso(to) });
  };

  const presetValue = custom ? 'custom'
    : (!filters.from && !filters.to) ? 'all'
      : 'custom';

  return (
    <div className="hbar-row">
      <label className="hf">
        <span>الحي</span>
        <select
          value={filters.district ?? ''}
          onChange={(e) => update({ district: e.target.value || null })}
        >
          <option value="">كل الأحياء ({districts.length})</option>
          {districts.map((d) => (
            <option key={d.id} value={d.name}>{d.name} — {d.seg} مقطع</option>
          ))}
        </select>
      </label>

      <label className="hf">
        <span>المدى الزمني</span>
        <select value={presetValue} onChange={(e) => onPreset(e.target.value)}>
          {PRESETS.map((p) => <option key={p.k} value={p.k}>{p.label}</option>)}
        </select>
      </label>

      {custom && (
        <label className="hf dates">
          <span>من / إلى</span>
          <span className="hf-dates">
            <input type="date" value={filters.from ?? ''} aria-label="من تاريخ"
                   onChange={(e) => update({ from: e.target.value || null })} />
            <input type="date" value={filters.to ?? ''} aria-label="إلى تاريخ"
                   onChange={(e) => update({ to: e.target.value || null })} />
          </span>
        </label>
      )}

      {showMechanism && (
        <div className="hf">
          <span>الآلية</span>
          <div className="chiprow" role="group" aria-label="التصفية حسب الآلية">
            <button
              type="button"
              className="chip2"
              aria-pressed={(filters.mechanism ?? 'all') === 'all'}
              onClick={() => update({ mechanism: 'all' })}
            >
              الكل
            </button>
            {MECHANISM_ORDER.map((k) => (
              <button
                key={k}
                type="button"
                className="chip2"
                aria-pressed={filters.mechanism === k}
                style={filters.mechanism === k
                  ? { color: MECHANISMS[k].color, borderColor: MECHANISMS[k].color }
                  : undefined}
                title={MECHANISMS[k].hint}
                onClick={() => update({ mechanism: k })}
              >
                <i style={{ background: MECHANISMS[k].color }} />
                {MECHANISMS[k].ar}
              </button>
            ))}
          </div>
        </div>
      )}

      {extra}

      {active && (
        <button type="button" className="hf-clear" onClick={() => { setCustom(false); clear(); }}>
          مسح
        </button>
      )}
    </div>
  );
}
