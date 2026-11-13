"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  atlasPoint,
  constellationProfiles,
  constellationRule,
  summarize,
  type AtlasPoint,
  type ConstellationId,
} from "@/domain/catalog/atlas";
import { ErrorState, Loading } from "@/components/ui/primitives";
import { AltitudeHistogram } from "./altitude-histogram";
import { LaunchHistory } from "./launch-history";
import { OrbitScatter } from "./orbit-scatter";
import { GROUP_COLORS } from "./palette";

interface CatalogResponse {
  ok: boolean;
  data?: { generatedAt: string; stale: boolean; count: number; entries: { i: string; n: string; l1: string; l2: string }[] };
  error?: { message: string };
}

type LoadState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; points: AtlasPoint[]; skipped: number; generatedAt: Date; stale: boolean };

const percent = (fraction: number) => `${(fraction * 100).toFixed(fraction < 0.1 ? 1 : 0)}%`;
const count = (n: number) => n.toLocaleString("en-US");

function ageLabel(generatedAt: Date): string {
  const minutes = Math.max(0, Math.round((Date.now() - generatedAt.getTime()) / 60_000));
  if (minutes < 90) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

export function AtlasView() {
  const [load, setLoad] = useState<LoadState>({ state: "loading" });
  const [focus, setFocus] = useState<ConstellationId | null>(null);
  /** Bumped by Retry to re-run the load. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/sky/catalog", { signal: abort.signal });
        const body = (await res.json()) as CatalogResponse;
        if (!res.ok || !body.ok || !body.data) {
          setLoad({ state: "error", message: body.error?.message ?? "The active catalog couldn't load right now." });
          return;
        }
        const points: AtlasPoint[] = [];
        for (const entry of body.data.entries) {
          const point = atlasPoint(entry.i, entry.n, entry.l2, entry.l1);
          if (point) points.push(point);
        }
        setLoad({
          state: "ready",
          points,
          skipped: body.data.entries.length - points.length,
          generatedAt: new Date(body.data.generatedAt),
          stale: body.data.stale,
        });
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setLoad({ state: "error", message: "The active catalog couldn't load right now." });
      }
    })();
    return () => abort.abort();
  }, [attempt]);

  const points = load.state === "ready" ? load.points : null;
  const summary = useMemo(() => (points ? summarize(points) : null), [points]);
  const profiles = useMemo(() => (points ? constellationProfiles(points) : []), [points]);
  /** Share of objects with a known launch year that launched in the last five calendar years (incl. this one). */
  const recentShare = useMemo(() => {
    if (load.state !== "ready") return null;
    const year = load.generatedAt.getUTCFullYear();
    const dated = load.points.filter((p) => p.launchYear !== null);
    if (dated.length === 0) return null;
    return dated.filter((p) => p.launchYear! > year - 5).length / dated.length;
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10">
      <header className="pt-8 pb-6">
        <h1 className="heading-display text-[30px] md:text-[40px]">Who&apos;s in orbit</h1>
        <p className="lede mt-2 max-w-2xl text-[16px]">
          Every active satellite in the public catalog, placed by the shape of its orbit.{" "}
          {/* While loading, the sentence's space is held so nothing below moves when the figure arrives. */}
          <span className={summary ? undefined : "invisible"} aria-hidden={summary ? undefined : true}>
            One company now flies{" "}
            <strong className="text-[var(--color-text-primary)]">
              {summary ? percent(summary.byConstellation.starlink / summary.total) : "00%"}
            </strong>{" "}
            of them.
          </span>
        </p>
      </header>

      {/* The charts below are ~3 000 px tall. Holding a screen's height while the catalog loads keeps the footer
          out of view, so the page doesn't lurch when they arrive (Lighthouse measured CLS 0.85 without it). */}
      {load.state === "loading" ? (
        <div className="min-h-[100svh]">
          <Loading label="Loading the active catalog…" />
        </div>
      ) : null}
      {load.state === "error" ? (
        <div className="panel">
          <ErrorState
            title="The catalog couldn't be loaded"
            message={load.message}
            retry={() => {
              setLoad({ state: "loading" });
              setAttempt((n) => n + 1);
            }}
          />
        </div>
      ) : null}

      {load.state === "ready" && summary ? (
        <>
          <section aria-label="Catalog at a glance" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile value={count(summary.total)} label="active objects tracked" />
            <StatTile value={percent(summary.byConstellation.starlink / summary.total)} label={`are Starlink (${count(summary.byConstellation.starlink)})`} />
            <StatTile value={percent(summary.byRegime.LEO / summary.total)} label="fly in low Earth orbit" />
            <StatTile value={count(summary.byRegime.GEO)} label="hold the geostationary belt" />
          </section>
          <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
            CelesTrak active catalog, fetched {ageLabel(load.generatedAt)}
            {load.stale ? ". The provider is unreachable, so this is the last good copy" : ""}.
            {load.skipped > 0 ? ` ${count(load.skipped)} rows with unreadable elements left out.` : ""}
          </p>

          <section className="panel mt-6 p-4" aria-labelledby="scatter-title">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="scatter-title" className="text-[17px] font-semibold">
                Every orbit, by height and tilt
              </h2>
              <p className="text-[12px] text-[var(--color-text-muted)]">Hover a dot · click to pin and open it</p>
            </div>
            <p className="mt-1 max-w-3xl text-[13px] text-[var(--color-text-secondary)]">
              Constellations show up as tight clusters: a company launches many satellites into the same few
              planes. The vertical streak near 98° is the sun-synchronous band, where Earth-imaging satellites
              cross every spot at the same local time.
            </p>

            <div role="group" aria-label="Spotlight a constellation" className="mt-4 flex flex-wrap gap-2">
              <FocusChip active={focus === null} onClick={() => setFocus(null)} label="All" />
              {profiles
                .filter((p) => p.id !== "other")
                .map((p) => {
                  const rule = constellationRule(p.id);
                  return (
                    <FocusChip
                      key={p.id}
                      active={focus === p.id}
                      onClick={() => setFocus(focus === p.id ? null : p.id)}
                      label={rule.id === "gnss" ? "Navigation" : rule.label}
                      swatch={GROUP_COLORS[rule.group]}
                      count={p.count}
                    />
                  );
                })}
            </div>

            <div className="mt-3">
              <OrbitScatter points={load.points} focus={focus} />
            </div>
            <Legend />
          </section>

          <section className="panel mt-6 p-4" aria-labelledby="histogram-title">
            <h2 id="histogram-title" className="text-[17px] font-semibold">
              How crowded each altitude is
            </h2>
            <p className="mt-1 max-w-3xl text-[13px] text-[var(--color-text-secondary)]">
              Objects per 10 km band of low Earth orbit. Each spike is a constellation shell: hundreds of satellites
              sharing one altitude, keeping their spacing through precise station-keeping.
            </p>
            <div className="mt-3">
              <AltitudeHistogram points={load.points} />
            </div>
            <Legend />
          </section>

          <section className="panel mt-6 p-4" aria-labelledby="launch-title">
            <h2 id="launch-title" className="text-[17px] font-semibold">
              The launch boom
            </h2>
            <p className="mt-1 max-w-3xl text-[13px] text-[var(--color-text-secondary)]">
              Today&apos;s active satellites by the year they went up.{" "}
              {recentShare !== null ? (
                <>
                  <strong className="text-[var(--color-text-primary)]">{percent(recentShare)}</strong> of them launched in
                  the last five years.
                </>
              ) : null}{" "}
              Older years look thin partly because satellites retire and re-enter; this counts what is still flying, and{" "}
              {load.generatedAt.getUTCFullYear()} is the year so far.
            </p>
            <div className="mt-3">
              <LaunchHistory points={load.points} asOfYear={load.generatedAt.getUTCFullYear()} />
            </div>
            <Legend />
          </section>

          <section className="panel mt-6 overflow-x-auto p-4" aria-labelledby="table-title">
            <h2 id="table-title" className="text-[17px] font-semibold">
              The constellations
            </h2>
            <table className="table-technical mt-3">
              <thead>
                <tr>
                  <th scope="col">Constellation</th>
                  <th scope="col" className="hidden md:table-cell">Operator</th>
                  <th scope="col" className="text-right">Active</th>
                  <th scope="col" className="text-right">Share</th>
                  <th scope="col" className="text-right">Median altitude</th>
                  <th scope="col">Main orbital planes</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => {
                  const rule = constellationRule(p.id);
                  return (
                    <tr key={p.id}>
                      <td className="font-sans">
                        <span
                          aria-hidden="true"
                          className="mr-2 inline-block size-2.5 rounded-sm align-middle"
                          style={{ background: GROUP_COLORS[rule.group] }}
                        />
                        {rule.id === "gnss" ? "Navigation (GNSS)" : rule.label}
                      </td>
                      <td className="hidden font-sans text-[var(--color-text-secondary)] md:table-cell">{rule.operator}</td>
                      <td className="text-right">{count(p.count)}</td>
                      <td className="text-right">{percent(p.share)}</td>
                      <td className="text-right">{count(Math.round(p.medianAltitudeKm))} km</td>
                      <td>{p.id === "other" ? "—" : p.inclinations.map((i) => `${i.deg}°`).join(" · ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-[12px] text-[var(--color-text-muted)]">
              Membership comes from the provider&apos;s object names (the rules are listed on{" "}
              <Link href="/methodology#atlas" className="text-[var(--color-accent)] hover:underline">
                the methodology page
              </Link>
              ); altitudes are Keplerian approximations from each element set&apos;s mean motion.
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-[26px] font-bold tracking-tight text-[var(--color-text-primary)] md:text-[30px]">{value}</div>
      <div className="text-[13px] text-[var(--color-text-secondary)]">{label}</div>
    </div>
  );
}

function FocusChip({
  active,
  onClick,
  label,
  swatch,
  count: n,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  swatch?: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="choice gap-2"
    >
      {swatch ? <span aria-hidden="true" className="inline-block size-2.5 rounded-sm" style={{ background: swatch }} /> : null}
      {label}
      {n !== undefined ? <span className="font-mono text-[11px] text-[var(--color-text-muted)]">{count(n)}</span> : null}
    </button>
  );
}

function Legend() {
  const items = [
    ["starlink", "Starlink"],
    ["broadband", "OneWeb · Kuiper · Qianfan · Guowang · Iridium"],
    ["navigation", "Navigation"],
    ["other", "Everything else"],
  ] as const;
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[var(--color-text-secondary)]" aria-label="Colour key">
      {items.map(([group, label]) => (
        <li key={group} className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-sm" style={{ background: GROUP_COLORS[group] }} />
          {label}
        </li>
      ))}
    </ul>
  );
}
