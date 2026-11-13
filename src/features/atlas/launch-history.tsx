"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { launchHistory, type AtlasPoint } from "@/domain/catalog/atlas";
import { GROUP_COLORS, GROUP_LABELS, GROUP_ORDER } from "./palette";

/**
 * Still-active satellites by launch year, stacked by colour group. Read it as
 * "what's flying today, by when it went up" - not launches per year (failed,
 * decayed and retired objects aren't in the active catalog).
 */

const HEIGHT = 240;
const MARGIN = { top: 16, right: 12, bottom: 30, left: 48 };
const FROM_YEAR = 2000;

function niceMax(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(value, 1)));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * magnitude >= value) return step * magnitude;
  return 10 * magnitude;
}

export function LaunchHistory({ points, asOfYear }: { points: readonly AtlasPoint[]; asOfYear: number }) {
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

  const { bins } = useMemo(() => launchHistory(points, { fromYear: FROM_YEAR, toYear: asOfYear }), [points, asOfYear]);
  const peak = bins.reduce((max, b) => Math.max(max, b.total), 0);
  const yMax = niceMax(peak);
  const plotW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const slot = plotW / bins.length;
  const gap = slot > 10 ? 2 : 1;
  const x = (i: number) => MARGIN.left + i * slot;
  const y = (count: number) => MARGIN.top + plotH - (count / yMax) * plotH;
  const activeBin = active === null ? undefined : bins[active];
  const starlinkStart = bins.findIndex((b) => b.year === 2019);
  const tickEvery = width < 640 ? 5 : 2;

  return (
    <div ref={wrapRef} className="relative w-full">
      {width > 0 ? (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Active satellites by launch year from ${FROM_YEAR} to ${asOfYear}; the busiest year holds ${peak.toLocaleString("en-US")}.`}
          onPointerLeave={() => setActive(null)}
        >
          {[0, 0.5, 1].map((f) => (
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
              <g key={bin.year} opacity={active === null || active === i ? 1 : 0.55}>
                {GROUP_ORDER.map((group) => {
                  const count = bin.counts[group];
                  if (count === 0) return null;
                  const top = y(base + count);
                  const bottom = y(base);
                  base += count;
                  return (
                    <rect
                      key={group}
                      x={x(i) + gap / 2}
                      width={Math.max(slot - gap, 1)}
                      y={top}
                      height={Math.max(bottom - top, 0.5)}
                      fill={GROUP_COLORS[group]}
                    />
                  );
                })}
                <rect
                  x={x(i)}
                  width={slot}
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
          {bins.map((bin, i) =>
            i === 0 || (bin.year - FROM_YEAR) % tickEvery === 0 ? (
              <text key={bin.year} x={x(i) + slot / 2} y={HEIGHT - 12} fill="var(--color-text-muted)" fontSize={11} textAnchor="middle">
                {i === 0 ? `<${FROM_YEAR}` : bin.year}
              </text>
            ) : null,
          )}
          {starlinkStart >= 0 ? (
            <text
              x={x(starlinkStart) + slot / 2}
              y={y(bins[starlinkStart]!.total) - 6}
              fill="var(--color-text-secondary)"
              fontSize={11}
              textAnchor="end"
            >
              First Starlink batch ↘
            </text>
          ) : null}
        </svg>
      ) : (
        <div style={{ height: HEIGHT }} />
      )}
      {activeBin && activeBin.total > 0 ? (
        <div
          role="tooltip"
          className="panel pointer-events-none absolute z-10 w-56 px-3 py-2 text-[12px] shadow-xl"
          style={{ left: Math.min(Math.max(x(active!) - 112, 0), Math.max(width - 224, 0)), top: 0 }}
        >
          <div className="font-semibold">
            {activeBin.label === String(activeBin.year) ? `Launched in ${activeBin.year}` : `Launched ${activeBin.label}`} ·{" "}
            {activeBin.total.toLocaleString("en-US")}
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
