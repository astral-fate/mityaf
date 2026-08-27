'use client';

import { useRef, useState } from 'react';
import { ImportError, importFile } from '@/lib/importLayers';

/**
 * Drop the Amanah's own layers onto the map.
 *
 * Written for someone who has a file and a question, not for someone who knows
 * what a projection is: the copy names the documents they actually hold
 * ("شبكة التصريف", "حدود المشروع") rather than the formats, and every failure
 * says what to do next instead of what went wrong internally.
 */
export default function DropZone({ onAdd }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function take(files) {
    setError(null);
    for (const file of Array.from(files ?? [])) {
      setBusy(file.name);
      try {
        onAdd(await importFile(file));
      } catch (err) {
        setError(
          err instanceof ImportError
            ? `${file.name} — ${err.message}`
            : `${file.name} — تعذّرت قراءة الملف. تأكّد أنه غير تالف.`,
        );
      } finally {
        setBusy(null);
      }
    }
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="dcard">
      <div className="dcard-h">
        <span>طبقاتك</span>
        <span className="c">تبقى على جهازك</span>
      </div>

      <div
        className={`dzone${over ? ' over' : ''}${busy ? ' busy' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".geojson,.json,.kml,.tif,.tiff"
          hidden
          onChange={(e) => take(e.target.files)}
        />

        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>

        {busy ? (
          <>
            <b>جارٍ قراءة {busy}…</b>
            <small>الملفات الكبيرة قد تستغرق لحظات</small>
          </>
        ) : (
          <>
            <b>أسقِط ملفاً هنا للبدء</b>
            <small>أو اضغط للاختيار · GeoJSON · KML · GeoTIFF</small>
          </>
        )}
      </div>

      <p className="dzone-hint">
        شبكة التصريف · حدود المشاريع المنفّذة · مخططات معتمدة · صور جوية أو طائرة مسيّرة.
        تُقرأ في متصفّحك ولا تُرفع إلى أي خادم.
      </p>

      {error && (
        <p className="dzone-err" role="alert">{error}</p>
      )}
    </div>
  );
}
