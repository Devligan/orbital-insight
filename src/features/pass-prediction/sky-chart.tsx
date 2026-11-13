/**
 * "Where to look" — one pass on a chart of the observer's sky.
 *
 * Centre is straight up, the rim is the horizon, rings mark 30° and 60° of
 * elevation, and east sits on the left (the sky seen from below; see
 * ./sky-chart-geometry). The whole pass is a faint dashed arc; the stretch a
 * person can actually see — satellite sunlit, sky dark — is the bright line,
 * starting at a dot and ending in an arrow, or in a hollow ring where the
 * satellite slips into Earth's shadow mid-sky.
 *
 * Pure SVG, server-renderable, no chart library: it sits in lists of a
 * dozen passes and in table cells.
 */

import { compassPoint, type PassCardData } from "./sky-words";
import { projectSky, skyChartModel } from "./sky-chart-geometry";

const CARDINALS = [
  { label: "N", azimuthDeg: 0 },
  { label: "E", azimuthDeg: 90 },
  { label: "S", azimuthDeg: 180 },
  { label: "W", azimuthDeg: 270 },
] as const;

/** Below this size the chart drops its compass letters and rings (table cells). */
const LABELLED_MIN_SIZE = 80;

function describe(pass: PassCardData): string {
  const rise = pass.azimuthAtRiseDeg !== null ? `rises in the ${compassPoint(pass.azimuthAtRiseDeg)}, ` : "";
  const set = pass.azimuthAtSetDeg !== null ? `, sets in the ${compassPoint(pass.azimuthAtSetDeg)}` : "";
  const window = pass.visibility?.visibleWindow;
  const seen = window
    ? `; visible from ${Math.round(window.start.elevationDeg)}° up in the ${compassPoint(window.start.azimuthDeg)} to ${Math.round(window.end.elevationDeg)}° up in the ${compassPoint(window.end.azimuthDeg)}`
    : "; not visible to the eye";
  return `Sky chart: ${rise}highest ${Math.round(pass.maxElevationDeg)}° in the ${compassPoint(pass.azimuthAtMaxDeg)}${set}${seen}.`;
}

export function SkyChart({ pass, size = 112 }: { pass: PassCardData; size?: number }) {
  const labelled = size >= LABELLED_MIN_SIZE;
  const fontSize = Math.max(8, size / 12);
  // Compass letters sit outside the rim, where no path (or arrowhead) can reach them.
  const pad = labelled ? fontSize + 1 : 1.5;
  const radius = size / 2 - pad;
  const model = skyChartModel(pass, radius);
  if (!model) return null;

  const stroke = Math.max(1.25, size / 64);
  const arrow = Math.max(3.5, size / 22);

  return (
    <svg
      viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={describe(pass)}
      className="shrink-0"
      data-testid="sky-chart"
      data-visible={model.visible ? "true" : "false"}
    >
      <title>{describe(pass)}</title>
      {/* The dome: horizon rim, 30° and 60° rings, zenith tick. */}
      <circle
        r={radius}
        style={{ fill: "color-mix(in oklab, var(--color-accent) 5%, var(--color-bg-inset))", stroke: "var(--color-border-strong)" }}
      />
      {labelled ? (
        <>
          {[30, 60].map((el) => (
            <circle
              key={el}
              r={(radius * (90 - el)) / 90}
              fill="none"
              stroke="var(--color-border-hairline)"
              strokeDasharray="2 3"
            />
          ))}
          <path d="M-2.5 0H2.5M0 -2.5V2.5" stroke="var(--color-border-strong)" />
        </>
      ) : null}

      {/* The whole geometric pass, seen or not. */}
      <path
        d={model.track}
        fill="none"
        stroke="var(--color-text-muted)"
        strokeWidth={stroke * 0.8}
        strokeDasharray={`${stroke * 1.6} ${stroke * 2}`}
        strokeLinecap="round"
      />

      {/* The part a person can actually see. */}
      {model.visible ? (
        <path
          d={model.visible}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={stroke * 1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          data-testid="sky-chart-visible"
        />
      ) : null}
      {model.visibleStart ? (
        <circle cx={model.visibleStart.x} cy={model.visibleStart.y} r={stroke * 1.5} fill="var(--color-accent)" />
      ) : null}

      {/* How it ends: a ring where it slips into Earth's shadow (dot → ring
          already reads as a direction), otherwise an arrowhead. */}
      {model.endsInShadow && model.visibleEnd ? (
        <circle
          cx={model.visibleEnd.x}
          cy={model.visibleEnd.y}
          r={stroke * 2.6}
          fill="none"
          stroke="var(--color-text-primary)"
          strokeWidth={stroke * 0.8}
          data-testid="sky-chart-shadow-entry"
        />
      ) : (
        <path
          d={`M0 0L${-arrow} ${-arrow * 0.6}L${-arrow} ${arrow * 0.6}Z`}
          transform={`translate(${model.heading.tip.x.toFixed(1)} ${model.heading.tip.y.toFixed(1)}) rotate(${model.heading.angleDeg.toFixed(1)})`}
          fill={model.visible ? "var(--color-accent)" : "var(--color-text-muted)"}
        />
      )}

      {labelled
        ? CARDINALS.map((c) => {
            const p = projectSky(c.azimuthDeg, 0, radius + fontSize * 0.55);
            return (
              <text
                key={c.label}
                x={p.x}
                y={p.y}
                fontSize={fontSize}
                textAnchor="middle"
                dominantBaseline="central"
                fill={c.label === "N" ? "var(--color-text-secondary)" : "var(--color-text-muted)"}
                fontWeight={c.label === "N" ? 600 : 400}
              >
                {c.label}
              </text>
            );
          })
        : null}
    </svg>
  );
}
