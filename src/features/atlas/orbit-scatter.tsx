"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { constellationRule, type AtlasPoint, type ConstellationId } from "@/domain/catalog/atlas";
import { GROUP_COLORS } from "./palette";

/**
 * Inclination × altitude scatter of the whole active catalog (~16k points).
 *
 * Canvas, not SVG: 16k DOM nodes would make hover janky on phones. Altitude
 * is logarithmic so low orbit (where nearly everything is) gets room while the
 * navigation belt and the geostationary ring still fit. Hover/tap uses a
 * screen-space grid index, so the nearest point is found in O(1) per move.
 */

const MARGIN = { top: 14, right: 18, bottom: 44, left: 64 };
const ALTITUDE_TICKS = [200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000];
const HIT_RADIUS_PX = 9;
const CELL_PX = 12;

interface Scales {
  width: number;
  height: number;
  xMax: number;
  yMinLog: number;
  yMaxLog: number;
  x: (inclinationDeg: number) => number;
  y: (altitudeKm: number) => number;
}

function makeScales(width: number, height: number, points: readonly AtlasPoint[]): Scales {
  let maxIncl = 0;
  let minAlt = Infinity;
  let maxAlt = 0;
  for (const p of points) {
    if (p.inclinationDeg > maxIncl) maxIncl = p.inclinationDeg;
    if (p.meanAltitudeKm < minAlt) minAlt = p.meanAltitudeKm;
    if (p.meanAltitudeKm > maxAlt) maxAlt = p.meanAltitudeKm;
  }
  // Domain follows the data (nothing clipped), rounded to friendly ticks.
  const xMax = Math.max(105, Math.ceil(maxIncl / 15) * 15);
  const yMinLog = Math.log10(Math.max(100, Math.min(150, minAlt * 0.9)));
  const yMaxLog = Math.log10(Math.max(60_000, maxAlt * 1.15));
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  return {
    width,
    height,
    xMax,
    yMinLog,
    yMaxLog,
    x: (incl) => MARGIN.left + (incl / xMax) * plotW,
    y: (alt) =>
      MARGIN.top + plotH - ((Math.log10(Math.max(alt, 1)) - yMinLog) / (yMaxLog - yMinLog)) * plotH,
  };
}

function formatKm(km: number): string {
  return km >= 10_000 ? `${Math.round(km / 1000)}k` : km.toLocaleString("en-US");
}

export interface OrbitScatterProps {
  points: readonly AtlasPoint[];
  /** Spotlight one constellation: it keeps its colour, everything else goes neutral. */
  focus: ConstellationId | null;
}

export function OrbitScatter({ points, focus }: OrbitScatterProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [hover, setHover] = useState<{ index: number; pinned: boolean } | null>(null);
  const [plotted, setPlotted] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry!.contentRect.width);
      setSize({ width, height: width < 640 ? 380 : 500 });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scales = useMemo(() => (size ? makeScales(size.width, size.height, points) : null), [size, points]);

  // Screen positions + grid index, rebuilt only when layout or data change.
  const layout = useMemo(() => {
    if (!scales) return null;
    const xs = new Float32Array(points.length);
    const ys = new Float32Array(points.length);
    const grid = new Map<number, number[]>();
    points.forEach((p, i) => {
      const x = scales.x(p.inclinationDeg);
      const y = scales.y(p.meanAltitudeKm);
      xs[i] = x;
      ys[i] = y;
      const key = Math.floor(x / CELL_PX) * 10_000 + Math.floor(y / CELL_PX);
      const cell = grid.get(key);
      if (cell) cell.push(i);
      else grid.set(key, [i]);
    });
    return { xs, ys, grid };
  }, [scales, points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !scales || !layout) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = scales.width * dpr;
    canvas.height = scales.height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, scales.width, scales.height);

    const plotLeft = MARGIN.left;
    const plotRight = scales.width - MARGIN.right;
    const plotTop = MARGIN.top;
    const plotBottom = scales.height - MARGIN.bottom;

    // Sun-synchronous band: the one inclination range that means something on its own.
    ctx.fillStyle = "rgba(143, 163, 189, 0.06)";
    ctx.fillRect(scales.x(96), plotTop, scales.x(100) - scales.x(96), plotBottom - plotTop);

    // Recessive grid + tick labels.
    ctx.strokeStyle = "#232327";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#8a8983";
    ctx.font = "11px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const tick of ALTITUDE_TICKS) {
      const logTick = Math.log10(tick);
      if (logTick < scales.yMinLog || logTick > scales.yMaxLog) continue;
      const y = Math.round(scales.y(tick)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotRight, y);
      ctx.stroke();
      ctx.fillText(formatKm(tick), plotLeft - 8, y);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const inclStep = scales.width < 640 ? 30 : 15;
    for (let incl = 0; incl <= scales.xMax; incl += inclStep) {
      const x = Math.round(scales.x(incl)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotBottom);
      ctx.stroke();
      ctx.fillText(`${incl}°`, x, plotBottom + 6);
    }
    // Axis titles.
    ctx.fillStyle = "#b0afa8";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText("Inclination: angle of the orbit to the equator", (plotLeft + plotRight) / 2, plotBottom + 24);
    ctx.save();
    ctx.translate(14, (plotTop + plotBottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "middle";
    ctx.fillText("Altitude (km, log scale)", 0, 0);
    ctx.restore();

    // Points: neutral first, focused/coloured last so they sit on top.
    const background: number[] = [];
    const foreground: number[] = [];
    points.forEach((p, i) => {
      const rule = constellationRule(p.constellation);
      const emphasized = focus ? p.constellation === focus : rule.group !== "other";
      (emphasized ? foreground : background).push(i);
    });
    const size = scales.width < 640 ? 2 : 2.5;
    const draw = (indices: number[], alpha: number, colorOf: (p: AtlasPoint) => string) => {
      ctx.globalAlpha = alpha;
      let current = "";
      for (const i of indices) {
        const color = colorOf(points[i]!);
        if (color !== current) {
          ctx.fillStyle = color;
          current = color;
        }
        ctx.fillRect(layout.xs[i]! - size / 2, layout.ys[i]! - size / 2, size, size);
      }
    };
    draw(background, focus ? 0.35 : 0.6, () => GROUP_COLORS.other);
    // Plain compositing on purpose: additive blending saturated dense shells
    // to white, and white belongs to no group — colour must keep identity.
    draw(foreground, 0.85, (p) => GROUP_COLORS[constellationRule(p.constellation).group]);
    ctx.globalAlpha = 1;

    // Direct labels for the landmarks a visitor can place.
    ctx.font = "11px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#b0afa8";
    const label = (text: string, incl: number, alt: number, dx = 8) => {
      const x = scales.x(incl) + dx;
      const y = scales.y(alt);
      if (x > plotRight - 40 || y < plotTop || y > plotBottom) return;
      ctx.fillText(text, x, y);
    };
    label("Geostationary belt", 16, 35_786);
    label("Navigation (GPS, Galileo…)", 66, 21_000);
    label("Sun-synchronous", scales.x(100) > plotRight - 120 ? 80 : 100.5, 180, 0);
    const iss = points.findIndex((p) => p.id === "25544");
    if (iss >= 0) {
      const x = layout.xs[iss]!;
      const y = layout.ys[iss]!;
      ctx.strokeStyle = "#ecebe6";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#ecebe6";
      ctx.fillText("ISS", x - 26, y + 1);
    }

    setPlotted(points.length);
  }, [scales, layout, points, focus]);

  const nearest = useCallback(
    (clientX: number, clientY: number): number | null => {
      const canvas = canvasRef.current;
      if (!canvas || !layout) return null;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const cx = Math.floor(x / CELL_PX);
      const cy = Math.floor(y / CELL_PX);
      let best: number | null = null;
      let bestD = HIT_RADIUS_PX * HIT_RADIUS_PX;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const i of layout.grid.get((cx + dx) * 10_000 + (cy + dy)) ?? []) {
            // With a spotlight on, only spotlighted points answer the pointer.
            if (focus && points[i]!.constellation !== focus) continue;
            const d = (layout.xs[i]! - x) ** 2 + (layout.ys[i]! - y) ** 2;
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
      }
      return best;
    },
    [layout, focus, points],
  );

  const hovered = hover ? points[hover.index] : undefined;
  const tooltipPos =
    hover && layout && size
      ? {
          left: Math.min(Math.max(layout.xs[hover.index]! + 12, 8), size.width - 248),
          top: Math.max(layout.ys[hover.index]! - 96, 4),
        }
      : null;

  return (
    <div ref={wrapRef} className="relative w-full select-none" style={{ height: size?.height ?? 500 }}>
      <canvas
        ref={canvasRef}
        data-testid="atlas-plot"
        data-plotted={plotted}
        // Rendered scale, published for e2e (same pattern as the globe's data-clock-*).
        data-margins={`${MARGIN.left},${MARGIN.right},${MARGIN.top},${MARGIN.bottom}`}
        data-x-max={scales?.xMax}
        data-y-log-domain={scales ? `${scales.yMinLog},${scales.yMaxLog}` : undefined}
        role="img"
        aria-label={`Scatter plot of ${points.length.toLocaleString("en-US")} active satellites by orbital inclination and altitude. The constellation table below lists the same data.`}
        className="block h-full w-full cursor-crosshair"
        style={{ width: size?.width ?? "100%", height: size?.height ?? 500 }}
        onPointerMove={(e) => {
          if (e.pointerType !== "mouse" || hover?.pinned) return;
          const i = nearest(e.clientX, e.clientY);
          setHover(i === null ? null : { index: i, pinned: false });
        }}
        onPointerLeave={() => {
          if (!hover?.pinned) setHover(null);
        }}
        onClick={(e) => {
          const i = nearest(e.clientX, e.clientY);
          setHover(i === null ? null : { index: i, pinned: true });
        }}
      />
      {hovered && tooltipPos ? (
        <div
          role="tooltip"
          className="panel pointer-events-auto absolute z-10 w-60 px-3 py-2 text-[12px] shadow-xl"
          style={tooltipPos}
        >
          <div className="font-semibold text-[var(--color-text-primary)]">{hovered.name}</div>
          <div className="text-[var(--color-text-secondary)]">{constellationRule(hovered.constellation).label}</div>
          <div className="mt-1 font-mono text-[11px] text-[var(--color-text-secondary)]">
            {Math.round(hovered.perigeeKm).toLocaleString("en-US")}–{Math.round(hovered.apogeeKm).toLocaleString("en-US")} km ·{" "}
            {hovered.inclinationDeg.toFixed(1)}° · {hovered.periodMinutes < 300 ? `${hovered.periodMinutes.toFixed(0)} min` : `${(hovered.periodMinutes / 60).toFixed(1)} h`}
          </div>
          {hover?.pinned ? (
            <Link href={`/satellites/${hovered.id}`} className="mt-1 inline-block text-[var(--color-accent)] hover:underline">
              Open details →
            </Link>
          ) : (
            <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">Click to pin · open details</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
