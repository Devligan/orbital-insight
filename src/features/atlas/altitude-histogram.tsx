"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { altitudeHistogram, type AtlasPoint, type AltitudeBin } from "@/domain/catalog/atlas";
import { GROUP_COLORS, GROUP_LABELS, GROUP_ORDER } from "./palette";

/**
 * Objects per 10 km of altitude across low Earth orbit, stacked by colour
 * group. At this resolution the individual Starlink shells stand out as
 * spikes: a picture of how crowded specific altitudes have become.
 */

const RANGE = { minKm: 200, maxKm: 1_400, binKm: 10 };
const HEIGHT = 220;
const MARGIN = { top: 10, right: 12, bottom: 30, left: 48 };

function niceMax(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(value, 1)));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

export function AltitudeHistogram({ points }: { points: readonly AtlasPoint[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const bins = useMemo(() => altitudeHistogram(points, RANGE), [points]);
  const peak = useMemo(() => bins.reduce((max, b) => Math.max(max, b.total), 0), [bins]);
  const yMax = niceMax(peak);
  const plotW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const barW = plotW / bins.length;
  const x = (km: number) => MARGIN.left + ((km - RANGE.minKm) / (RANGE.maxKm - RANGE.minKm)) * plotW;
  const y = (count: number) => MARGIN.top + plotH - (count / yMax) * plotH;
  const activeBin: AltitudeBin | undefined = active === null ? undefined : bins[active];

  return (
    <div ref={wrapRef} className="relative w-full">
      {width > 0 ? (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Histogram of active objects per ${RANGE.binKm} km of altitude from ${RANGE.minKm} to ${RANGE.maxKm.toLocaleString("en-US")} km; the tallest band holds ${peak.toLocaleString("en-US")} objects.`}
          onPointerLeave={() => setActive(null)}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(yMax * f)} y2={y(yMax * f)} stroke="var(--color-border-hairline)" />
              <text x={MARGIN.left - 8} y={y(yMax * f)} fill="var(--color-text-muted)" fontSize={11} textAnchor="end" dominantBaseline="middle">
                {Math.round(yMax * f).toLocaleString("en-US")}
              </text>
            </g>
          ))}
          {bins.map((bin, i) => {
            let base = 0;
            return (
              <g key={bin.fromKm} opacity={active === null || active === i ? 1 : 0.55}>
                {GROUP_ORDER.map((group) => {
                  const count = bin.counts[group];
                  if (count === 0) return null;
                  const top = y(base + count);
                  const bottom = y(base);
                  base += count;
                  return (
                    <rect
                      key={group}
                      x={x(bin.fromKm) + 0.25}
                      width={Math.max(barW - 0.5, 0.5)}
                      y={top}
                      height={Math.max(bottom - top, 0.5)}
                      fill={GROUP_COLORS[group]}
                    />
                  );
                })}
                {/* Hit target spans the full column, taller than the bar. */}
                <rect
                  x={x(bin.fromKm)}
                  width={barW}
                  y={MARGIN.top}
                  height={plotH}
                  fill="transparent"
                  onPointerEnter={() => setActive(i)}
                  onClick={() => setActive(i)}
                />
              </g>
            );
          })}
          <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(0)} y2={y(0)} stroke="var(--color-border-strong)" />
          {(width < 640 ? [200, 600, 1_000, 1_400] : [200, 400, 600, 800, 1_000, 1_200, 1_400]).map((km, i, all) => (
            <text
              key={km}
              x={x(km)}
              y={HEIGHT - 12}
              fill="var(--color-text-muted)"
              fontSize={11}
              textAnchor={i === 0 ? "start" : i === all.length - 1 ? "end" : "middle"}
            >
              {km.toLocaleString("en-US")} km
            </text>
          ))}
        </svg>
      ) : (
        <div style={{ height: HEIGHT }} />
      )}
      {activeBin && activeBin.total > 0 ? (
        <div
          role="tooltip"
          className="panel pointer-events-none absolute z-10 w-56 px-3 py-2 text-[12px] shadow-xl"
          style={{ left: Math.min(Math.max(x(activeBin.fromKm) - 112, 0), Math.max(width - 224, 0)), top: 0 }}
        >
          <div className="font-semibold">
            {activeBin.fromKm.toLocaleString("en-US")}–{activeBin.toKm.toLocaleString("en-US")} km ·{" "}
            {activeBin.total.toLocaleString("en-US")} objects
          </div>
          {GROUP_ORDER.filter((g) => activeBin.counts[g] > 0).map((g) => (
            <div key={g} className="flex items-center gap-2 text-[var(--color-text-secondary)]">
              <span aria-hidden="true" className="inline-block size-2 rounded-sm" style={{ background: GROUP_COLORS[g] }} />
              {GROUP_LABELS[g]}
              <span className="ml-auto font-mono text-[var(--color-text-primary)]">{activeBin.counts[g].toLocaleString("en-US")}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
