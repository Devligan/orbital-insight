"use client";

/**
 * Comparison view: element tables side by side, a bounded position-delta
 * chart (Recharts), and explicit interpretation notes.
 */

import { useCallback, useEffect, useState } from "react";
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
  const watchlist = useWatchlist();
  const saved = watchlist.has(left);

  const run = useCallback(async (a: string, b: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/compare?left=${encodeURIComponent(a)}&right=${encodeURIComponent(b)}&hours=24&samples=24`);
      const body = (await res.json()) as ComparisonResponse;
      if (!body.ok || !body.data) {
        setError(body.error?.message ?? "The comparison service reported an error");
        return;
      }
      setComparison(body.data);
    } catch {
      setError("Could not reach the comparison service (network error)");
    } finally {
      setBusy(false);
    }
  }, []);

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
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(left, right);
          }}
        >
          <label className="flex min-w-40 flex-col gap-1">
            <span className="label">Left catalog ID</span>
            <input className="input font-mono" value={left} onChange={(e) => setLeft(e.target.value)} />
          </label>
          <label className="flex min-w-40 flex-col gap-1">
            <span className="label">Right catalog ID</span>
            <input className="input font-mono" value={right} onChange={(e) => setRight(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Comparing…" : "Compare"}
          </button>
          <button
            type="button"
            className={saved ? "btn btn-secondary" : "btn btn-secondary"}
            onClick={() => (saved ? watchlist.remove(left) : watchlist.add(left, comparison?.left.name ?? left))}
          >
            {saved ? "★ Left object in watchlist" : "☆ Save left object"}
          </button>
        </form>
      </Panel>

      {busy ? <Loading label="Propagating both element sets…" /> : null}
      {error ? <ErrorState title="Comparison failed" message={error} retry={() => void run(left, right)} /> : null}

      {comparison ? (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
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
                  <Line dataKey="deltaAltitudeKm" name="Δ altitude" stroke="#34d399" dot={false} strokeWidth={1.4} />
                  <Line dataKey="deltaKm" name="Δ range" stroke="#38bdf8" dot={false} strokeWidth={1.4} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 flex flex-col gap-1 text-[11px] text-[var(--color-text-muted)]">
              {comparison.notes.map((note) => (
                <li key={note}>· {note}</li>
              ))}
            </ul>
          </Panel>
        </>
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
