'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * How one alert is assembled, as an exploded stack of the layers that go into
 * it — satellite pass, water index, rain gate, terrain, ranking, alert.
 *
 * Every coordinate here is hard-coded rather than generated. The component
 * renders on the server first, so anything random would differ between the
 * server pass and the client pass and blow up hydration; fixed geometry also
 * means the figure looks identical to every viewer, which is what you want
 * from a diagram.
 */

const DWELL = 2800;

const STEPS = [
  {
    t: 'مرور القمر',
    d: 'يمرّ Sentinel-2 البصري فوق المدينة كل خمسة أيام، ويمرّ Sentinel-1 الراداري خلال السحب وفي الليل — وهو ما نحتاجه بالضبط ساعة المطر.',
    src: 'Copernicus · 10 م لكل بكسل · أرشيف منذ 2014',
  },
  {
    t: 'مؤشر الماء',
    d: 'نحسب MNDWI لكل بكسل، ونقارنه بالخط القاعدي لهذا الموقع نفسه عبر السنوات — لا بعتبة عامة تصلح لمدينة ولا تصلح لأخرى.',
    src: '(B3 − B11) ÷ (B3 + B11)',
  },
  {
    t: 'بوابة المطر',
    d: 'السؤال الذي يفصل مشكلتين عن بعضهما: هل أمطرت خلال 72 ساعة؟ الإجابة تحوّل البكسل نفسه من «هدر ريّ» إلى «ضعف تصريف».',
    src: 'Open-Meteo · حدث 25–26 مارس 2026 · 28.7 مم',
  },
  {
    t: 'التضاريس',
    d: 'انحدار وتراكم جريان ومنخفضات مغلقة من نموذج الارتفاع الرقمي. هذه الطبقة تشرح لماذا يتجمّع الماء هنا تحديداً وليس في الشارع المجاور.',
    src: 'Copernicus DEM GLO-30 · TWI · HAND',
  },
  {
    t: 'الترتيب',
    d: 'درجة أولوية لكل مقطع شارع تجمع الشكل الحضري بالتضاريس بتاريخ الغرق المرصود من الأرشيف الراداري.',
    src: 'نموذج مُتحقَّق عليه بتجزئة مكانية، لا بتجزئة عشوائية',
  },
  {
    t: 'التنبيه',
    d: 'المخرج ليس خريطة ملوّنة، بل أمر تشغيل: أي مقطع، وما الدليل الذي بُني عليه، وما الإجراء الموصى به.',
    src: 'يُصدَّر إلى فرق الصيانة قبل الحدث القادم',
  },
];

/* ── layer geometry, fixed on purpose ────────────────────── */
const WATER = [
  [26, 34, 13, 8], [58, 27, 9, 6], [71, 55, 11, 7],
  [38, 63, 15, 9], [17, 72, 8, 5], [63, 78, 10, 6],
];
const CONTOURS = [
  'M4 74 C 22 62, 34 78, 52 66 S 78 52, 96 60',
  'M4 60 C 24 50, 36 66, 54 54 S 80 40, 96 47',
  'M4 46 C 26 38, 38 53, 56 42 S 82 29, 96 35',
  'M4 32 C 28 26, 40 40, 58 30 S 84 18, 96 23',
  'M4 88 C 20 76, 32 92, 50 80 S 76 66, 96 74',
];
const RISK = [
  ['M8 22 L 38 26 L 52 20', '#e8d6bb', 1.4],
  ['M12 44 L 44 48 L 74 40', '#f5c15c', 1.8],
  ['M20 62 L 46 66 L 78 58', '#f08a5a', 2.2],
  ['M14 80 L 48 84 L 82 76', '#e8596b', 2.6],
  ['M60 12 L 66 40 L 62 68', '#f5c15c', 1.8],
  ['M84 20 L 88 50 L 80 82', '#e8d6bb', 1.4],
];
const PINS = [
  [46, 66, '#e8596b', 1], [78, 58, '#f08a5a', 0], [20, 62, '#f08a5a', 0],
  [48, 84, '#e8596b', 1], [66, 40, '#f5c15c', 0],
];

function Layer({ i }) {
  if (i === 0) {
    return <img src="/img/madinah-core.jpg" alt="" />;
  }
  if (i === 1) {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <filter id="lp-soft" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
        </defs>
        <g filter="url(#lp-soft)" opacity="0.85">
          {WATER.map(([x, y, rx, ry], k) => (
            <ellipse key={k} cx={x} cy={y} rx={rx} ry={ry} fill="#2fd8ef" opacity={0.28 + k * 0.07} />
          ))}
        </g>
      </svg>
    );
  }
  if (i === 2) {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <g stroke="#8fd8ff" strokeWidth="0.6" opacity="0.5">
          {Array.from({ length: 22 }, (_, k) => (
            <line key={k} x1={k * 5 - 8} y1="-4" x2={k * 5 - 20} y2="104" />
          ))}
        </g>
        <rect x="22" y="41" width="56" height="18" rx="5" fill="#020614" opacity="0.86" stroke="#2fd8ef" strokeWidth="0.5" />
        <text x="50" y="53" textAnchor="middle" fill="#2fd8ef" fontSize="8.5" fontWeight="700" fontFamily="system-ui, sans-serif">
          28.7 mm / 48h
        </text>
      </svg>
    );
  }
  if (i === 3) {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <g fill="none" stroke="#c39a6d" strokeWidth="0.7" opacity="0.72">
          {CONTOURS.map((d, k) => <path key={k} d={d} />)}
        </g>
        <g fill="#e8d6bb" opacity="0.55">
          <circle cx="46" cy="66" r="3.4" />
          <circle cx="78" cy="58" r="2.4" />
          <circle cx="20" cy="62" r="2" />
        </g>
      </svg>
    );
  }
  if (i === 4) {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <g fill="none" strokeLinecap="round">
          {RISK.map(([d, c, w], k) => <path key={k} d={d} stroke={c} strokeWidth={w} opacity="0.92" />)}
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      {PINS.map(([x, y, c, big], k) => (
        <g key={k}>
          <circle cx={x} cy={y} r={big ? 9 : 6} fill={c} opacity="0.16" />
          <circle cx={x} cy={y} r={big ? 3.4 : 2.4} fill={c} />
        </g>
      ))}
    </svg>
  );
}

export default function AlertStack() {
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);
  const hostRef = useRef(null);

  // Only animate while the figure is actually on screen — a stack cycling
  // through six steps in a viewport nobody is looking at is just battery.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const io = new IntersectionObserver(
      ([e]) => setRunning(e.isIntersecting),
      { threshold: 0.25 },
    );
    io.observe(host);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!running) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStep(STEPS.length - 1);
      return undefined;
    }
    const id = setTimeout(() => setStep((s) => (s + 1) % STEPS.length), DWELL);
    return () => clearTimeout(id);
  }, [running, step]);

  return (
    <div className="lp-stack" ref={hostRef}>
      <div className="lp-scene">
        <div className="lp-planes">
          {STEPS.map((s, i) => (
            <div
              key={s.t}
              className={`lp-plane${i <= step ? ' shown' : ''}${i === step ? ' live' : ''}`}
              style={{ '--i': i }}
            >
              <Layer i={i} />
              <span className="lp-plane-tag">{s.t}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <ul className="lp-steps">
          {STEPS.map((s, i) => (
            <li key={s.t}>
              <button
                type="button"
                className="lp-step"
                aria-current={i === step}
                onClick={() => setStep(i)}
              >
                <span className="n">{i + 1}</span>
                <span>
                  <h4>{s.t}</h4>
                  <p>{s.d}</p>
                  <span className="src">{s.src}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="lp-progress">
          <i
            key={step}
            style={{
              animationDuration: `${DWELL}ms`,
              animationPlayState: running ? 'running' : 'paused',
            }}
          />
        </div>

        <div className={`lp-alert${step === STEPS.length - 1 ? ' on' : ''}`}>
          <div className="lp-alert-h">
            <span>أولوية عالية · مقطع SEG-1042</span>
            <span style={{ color: 'var(--lp-fg-3)', fontWeight: 500 }}>مثال على بنية التنبيه</span>
          </div>
          <div className="lp-alert-b">
            <div className="ttl">مقطع شارع ٤٠٠ م — حوض تصريف شرق المدينة</div>
            <div className="lp-ev">
              <div><span>درجة الأولوية</span><b className="num">0.87</b></div>
              <div><span>مساحة الجريان الوارد</span><b className="num">2.1 هكتار</b></div>
              <div><span>أقرب عبّارة معروفة</span><b className="num">340 م</b></div>
              <div><span>غرق مرصود من الأرشيف</span><b className="num">6 من 19 حدثاً</b></div>
              <div><span>تغطية الرصد</span><b className="num">74٪</b></div>
            </div>
            <p className="lp-rec">
              الإجراء المقترح: مصائد وشبكة تصريف سطحي، ودراسة ربط بالعبّارة المصبّية.
              التوصية تحدّد النوع والموقع والمبرّر — أمّا الأقطار ومعدّلات التصريف فتبقى
              لمهندس هيدروليكي.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
