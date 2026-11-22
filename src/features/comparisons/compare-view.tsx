"use client";

/**
 * Comparison view: element tables side by side, a bounded position-delta
 * chart (Recharts), and explicit interpretation notes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { canonicalCatalogNumber, COMPARE_MESSAGES } from "@/contracts/catalog-number";

type Side = "left" | "right";
import Link from "next/link";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, DataField, ErrorState, Loading, Panel, PanelHeader } from "@/components/ui/primitives";
import { useWatchlist } from "@/features/watchlist/local-store";
import { formatUtc } from "@/lib/units";

interface ComparisonSide {
  satelliteNumber: string;
  name: string;
  lineage: string;
  epoch: string;
  retrievedAt: string;
  tleLine1: string;
  tleLine2: string;
  characteristics: {
    inclinationDeg: number;
    eccentricity: number;
    meanMotionRevPerDay: number;
    periodMinutes: number;
    semiMajorAxisKm: number;
    perigeeAltitudeKm: number;
    apogeeAltitudeKm: number;
  };
}

interface ComparisonResponse {
  ok: boolean;
  data?: {
    left: ComparisonSide;
    right: ComparisonSide;
    positionDeltas: { time: string; deltaKm: number; deltaAltitudeKm: number }[];
    notes: string[];
  };
  error?: { kind: string; message: string };
}

export function CompareView({ initialLeft, initialRight }: { initialLeft: string; initialRight: string }) {
  const [left, setLeft] = useState(initialLeft);
  const [right, setRight] = useState(initialRight);
  const [comparison, setComparison] = useState<ComparisonResponse["data"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A field's problem shows after a submit, then follows the typing.
  const [attempted, setAttempted] = useState(false);
  const inputRefs = useRef<Record<Side, HTMLInputElement | null>>({ left: null, right: null });
  const watchlist = useWatchlist();
  // Only an object that actually loaded can be saved, never the raw text in the box.
  const shownLeft = comparison?.left ?? null;
  const saved = shownLeft ? watchlist.has(shownLeft.satelliteNumber) : false;

  const ids: Record<Side, string | null> = { left: canonicalCatalogNumber(left), right: canonicalCatalogNumber(right) };
  const fieldError = (side: Side) => (attempted && ids[side] === null ? COMPARE_MESSAGES[side] : undefined);

  const run = useCallback(async (a: string, b: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/compare?left=${encodeURIComponent(a)}&right=${encodeURIComponent(b)}&hours=24&samples=24`);
      const body = (await res.json()) as ComparisonResponse;
      if (!body.ok || !body.data) {
        // The last result no longer matches what was asked for: don't leave it under the error.
        setComparison(null);
        setError(body.error?.message ?? "The comparison service reported an error");
        return;
      }
      setComparison(body.data);
    } catch {
      setComparison(null);
      setError("Could not reach the comparison service (network error)");
    } finally {
      setBusy(false);
    }
  }, []);

  function submit() {
    setAttempted(true);
    const first = (["left", "right"] as const).find((side) => ids[side] === null);
    if (first) {
      inputRefs.current[first]?.focus();
      return; // nothing is sent while a side is wrong
    }
    void run(ids.left!, ids.right!);
  }

  useEffect(() => {
    // Defer via a timer: setState happens in a callback, not synchronously
    // within the effect body.
    const t = setTimeout(() => void run(initialLeft, initialRight), 0);
    return () => clearTimeout(t);
  }, [initialLeft, initialRight, run]);

  return (
    <div className="flex flex-col gap-3">
      <Panel>
        <PanelHeader
          title="Select objects"
          right={
            comparison && !error ? <Badge tone="neutral">{`${comparison.positionDeltas.length} common samples`}</Badge> : undefined
          }
        />
        <form
          className="flex flex-wrap items-start gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {(["left", "right"] as const).map((side) => {
            const problem = fieldError(side);
            return (
              <div key={side} className="flex w-full flex-col gap-1 sm:w-56">
                <label className="flex flex-col gap-1">
                  <span className="label">{side === "left" ? "Left" : "Right"} catalog ID</span>
                  <input
                    ref={(el) => {
                      inputRefs.current[side] = el;
                    }}
                    className="input font-mono"
                    value={side === "left" ? left : right}
                    onChange={(e) => (side === "left" ? setLeft : setRight)(e.target.value)}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={problem ? true : undefined}
                    aria-describedby={problem ? `compare-${side}-error` : undefined}
                  />
                </label>
                {problem ? (
                  <p id={`compare-${side}-error`} className="text-[12px] text-[var(--color-status-bad)]" data-testid={`compare-${side}-error`}>
                    {problem}
                  </p>
                ) : null}
              </div>
            );
          })}
          {/* Buttons sit on the inputs' line (label height + gap), not under a wrapped error. */}
          <div className="flex flex-wrap gap-3 sm:mt-[22px]">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Comparing…" : "Compare"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!shownLeft || busy}
              onClick={() => {
                if (!shownLeft) return;
                if (saved) watchlist.remove(shownLeft.satelliteNumber);
                else watchlist.add(shownLeft.satelliteNumber, shownLeft.name);
              }}
            >
              {saved ? "★ Left object in watchlist" : "☆ Save left object"}
            </button>
          </div>
        </form>
      </Panel>

      {busy ? <Loading label="Propagating both element sets…" /> : null}
      {error ? <ErrorState title="Comparison failed" message={error} retry={submit} /> : null}

      {comparison ? (
        <div
          className={"flex flex-col gap-3 transition-opacity " + (busy ? "opacity-40" : "")}
          aria-busy={busy}
          data-testid="comparison-result"
        >
          {/* minmax(0, 1fr) columns, so the unbreakable TLE lines scroll instead of widening the page. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <SidePanel side={comparison.left} tag="Left" />
            <SidePanel side={comparison.right} tag="Right" />
          </div>

          <Panel className="min-w-0">
            <PanelHeader title="Propagated position delta (TEME, km)" />
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={comparison.positionDeltas} margin={{ top: 6, right: 12, bottom: 24, left: 6 }}>
                  <CartesianGrid stroke="var(--color-border-hairline)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="time"
                    tickFormatter={(t) => `${new Date(String(t)).toISOString().slice(11, 16)}Z`}
                    stroke="var(--color-text-muted)"
                    fontSize={10}
                    minTickGap={40}
                  />
                  <YAxis
                    stroke="var(--color-text-muted)"
                    fontSize={10}
                    label={{ value: "km", position: "insideTopLeft", dy: -24, fill: "var(--color-text-muted)", fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{ background: "var(--color-bg-panel)", border: "1px solid var(--color-border-strong)", fontSize: 12 }}
                    labelFormatter={(label) => formatUtc(new Date(String(label)))}
                    formatter={(value) => [`${Number(value).toFixed(2)} km`, "Δ position"]}
                  />
                  <Line dataKey="deltaAltitudeKm" name="Δ altitude" stroke="var(--color-text-primary)" dot={false} strokeWidth={1.4} />
                  <Line dataKey="deltaKm" name="Δ range" stroke="var(--color-accent)" dot={false} strokeWidth={1.4} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 flex flex-col gap-1 text-[11px] text-[var(--color-text-muted)]">
              {comparison.notes.map((note) => (
                <li key={note}>· {note}</li>
              ))}
            </ul>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}

function SidePanel({ side, tag }: { side: ComparisonSide; tag: string }) {
  return (
    <Panel>
      <PanelHeader
        title={`${tag}: ${side.name}`}
        right={
          <Link href={`/satellites/${side.satelliteNumber}`} className="text-[11px] text-[var(--color-accent)] hover:underline">
            details →
          </Link>
        }
      />
      <div className="flex flex-col">
        <DataField label="Catalog ID" value={side.satelliteNumber} />
        <DataField label="Element epoch" value={formatUtc(new Date(side.epoch))} />
        <DataField label="Retrieved" value={formatUtc(new Date(side.retrievedAt))} />
        <DataField label="Inclination" value={`${side.characteristics.inclinationDeg.toFixed(4)}°`} />
        <DataField label="Eccentricity" value={side.characteristics.eccentricity.toFixed(7)} />
        <DataField label="Mean motion" value={`${side.characteristics.meanMotionRevPerDay.toFixed(4)} rev/day`} />
        <DataField label="Period" value={`${side.characteristics.periodMinutes.toFixed(2)} min`} />
        <DataField label="Semi-major axis" value={`${side.characteristics.semiMajorAxisKm.toFixed(1)} km`} />
        <DataField label="Perigee (approx)" value={`${side.characteristics.perigeeAltitudeKm.toFixed(0)} km`} />
        <DataField label="Apogee (approx)" value={`${side.characteristics.apogeeAltitudeKm.toFixed(0)} km`} />
      </div>
      <pre className="panel-inset mt-2 overflow-x-auto p-2 text-[10px] leading-4 text-[var(--color-text-secondary)]">
{side.tleLine1}
{"\n"}
{side.tleLine2}
      </pre>
    </Panel>
  );
}
