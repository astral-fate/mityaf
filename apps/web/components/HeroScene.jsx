'use client';

import { useEffect, useRef } from 'react';

/**
 * The hero overlay: our real street network drawn on the real Sentinel-2
 * raster underneath it.
 *
 * The two share a frame because tools/build_hero_layer.py baked the segments
 * into normalised coordinates of that exact crop, so all this has to do is
 * reproduce the CSS `object-fit: cover` transform the <img> is using. Any
 * drift between the two would be immediately visible — roads not sitting on
 * roads — which is also why it is worth doing rather than faking.
 *
 * Redrawing 5,842 polylines every frame would be wasteful, so the lines are
 * compiled once into Path2D chunks ordered outward from the city centre.
 * A frame then strokes ~48 paths instead of ~6,000, and the reveal is just a
 * question of how many chunks are in play.
 */

const OBJECT_POSITION = [0.5, 0.42]; // must match .lp-hero-media img
const IMG_ASPECT = 16 / 9;
const CHUNKS = 48;
const LOOP_MS = 16000;

const SEV = ['#e8d6bb', '#f5c15c', '#f08a5a', '#e8596b'];
const WASTE = '#50ff4a';

/** Deterministic picks: the hero must look the same on every load. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export default function HeroScene() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let data = null;
    let chunks = [];
    let marks = [];
    let raf = 0;
    let start = 0;
    let alive = true;

    /** Reproduce object-fit: cover so vectors land on the pixels they describe. */
    function frame() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      let dw = w;
      let dh = w / IMG_ASPECT;
      if (dh < h) {
        dh = h;
        dw = h * IMG_ASPECT;
      }
      return {
        w,
        h,
        dw,
        dh,
        ox: (w - dw) * OBJECT_POSITION[0],
        oy: (h - dh) * OBJECT_POSITION[1],
      };
    }

    function compile() {
      if (!data) return;
      const f = frame();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(f.w * dpr);
      canvas.height = Math.round(f.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const px = (ux) => f.ox + ux * f.dw;
      const py = (uy) => f.oy + uy * f.dh;

      // Order outward from the optical centre so the reveal grows from the
      // middle of the city rather than wiping across it.
      const ordered = data.lines
        .map((pts) => {
          const cx = pts[0];
          const cy = pts[1];
          return { pts, d: Math.hypot(cx - 0.5, cy - 0.5) };
        })
        .sort((a, b) => a.d - b.d);

      chunks = [];
      const per = Math.ceil(ordered.length / CHUNKS);
      for (let c = 0; c < CHUNKS; c += 1) {
        const path = new Path2D();
        for (const { pts } of ordered.slice(c * per, (c + 1) * per)) {
          path.moveTo(px(pts[0]), py(pts[1]));
          for (let i = 2; i < pts.length; i += 2) path.lineTo(px(pts[i]), py(pts[i + 1]));
        }
        chunks.push(path);
      }

      // Detections: a handful of green assets for the waste module and a
      // handful of street points for the flood module, biased to the side of
      // the frame the headline does not cover.
      const rnd = lcg(20260828);
      const greens = data.green
        .filter((g) => g[0] > 0.06 && g[0] < 0.58 && g[1] > 0.12 && g[1] < 0.9)
        .sort((a, b) => b[2] - a[2])
        .slice(0, 40);
      const streets = ordered
        .map((o) => o.pts)
        .filter((p) => p[0] > 0.06 && p[0] < 0.58 && p[1] > 0.1 && p[1] < 0.92);

      marks = [];
      for (let i = 0; i < 5 && greens.length; i += 1) {
        const g = greens[Math.floor(rnd() * greens.length)];
        marks.push({ x: px(g[0]), y: py(g[1]), color: WASTE, kind: 'waste', t: rnd() });
      }
      for (let i = 0; i < 11 && streets.length; i += 1) {
        const s = streets[Math.floor(rnd() * streets.length)];
        marks.push({
          x: px(s[0]),
          y: py(s[1]),
          color: SEV[Math.min(3, Math.floor(rnd() * 4))],
          kind: 'flood',
          t: rnd(),
        });
      }
      marks.sort((a, b) => a.t - b.t);
    }

    function paint(now) {
      if (!alive || !data) return;
      const f = frame();
      const p = reduce ? 1 : ((now - start) % LOOP_MS) / LOOP_MS;
      ctx.clearRect(0, 0, f.w, f.h);

      // 0 → .22 draw the network in; it then stays.
      const reveal = reduce ? 1 : Math.min(1, p / 0.22);
      const live = Math.ceil(reveal * CHUNKS);
      ctx.lineWidth = 1.05;
      ctx.lineCap = 'round';
      for (let c = 0; c < live; c += 1) {
        const edge = c === live - 1 ? 0.55 : 1;
        ctx.strokeStyle = `rgba(47, 216, 239, ${0.3 * edge})`;
        ctx.stroke(chunks[c]);
      }

      // .3 → .52 a rain front crosses the frame, brightening what it passes.
      const rain = reduce ? -1 : (p - 0.3) / 0.22;
      if (rain > 0 && rain < 1) {
        const x = f.ox + rain * f.dw;
        const band = f.dw * 0.3;
        const g = ctx.createLinearGradient(x - band, 0, x + band * 0.25, 0);
        g.addColorStop(0, 'rgba(47, 216, 239, 0)');
        g.addColorStop(0.72, 'rgba(47, 216, 239, 0.13)');
        g.addColorStop(1, 'rgba(160, 220, 255, 0.02)');
        ctx.fillStyle = g;
        ctx.fillRect(x - band, 0, band * 1.25, f.h);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x - band, 0, band * 1.25, f.h);
        ctx.clip();
        ctx.strokeStyle = 'rgba(120, 235, 255, 0.5)';
        for (let c = 0; c < live; c += 1) ctx.stroke(chunks[c]);
        ctx.restore();
      }

      // .5 → 1 detections resolve, staggered, and hold.
      marks.forEach((m, i) => {
        const at = 0.5 + m.t * 0.22;
        const age = reduce ? 1 : (p - at) / 0.1;
        if (age <= 0) return;
        const a = Math.min(1, age);

        if (i % 3 === 0) {
          const ring = ((now / 1000 + i) % 2.4) / 2.4;
          ctx.beginPath();
          ctx.arc(m.x, m.y, 6 + ring * 26, 0, Math.PI * 2);
          ctx.strokeStyle = `${m.color}${Math.round((1 - ring) * a * 90).toString(16).padStart(2, '0')}`;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(m.x, m.y, m.kind === 'waste' ? 4.2 : 3.4, 0, Math.PI * 2);
        ctx.fillStyle = m.color;
        ctx.globalAlpha = a;
        ctx.shadowColor = m.color;
        ctx.shadowBlur = 14;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      });

      raf = requestAnimationFrame(paint);
    }

    fetch('/data/hero-layer.json')
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return;
        data = json;
        compile();
        start = performance.now();
        raf = requestAnimationFrame(paint);
      })
      .catch(() => {
        /* the raster and the headline carry the hero on their own */
      });

    const ro = new ResizeObserver(() => {
      compile();
    });
    ro.observe(canvas);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="lp-hero-canvas" aria-hidden="true" />;
}
