"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { separationProfile, type CloseApproach, type ScreeningResult } from "@/domain/conjunction/screening";
import { ErrorState, Loading } from "@/components/ui/primitives";
import type { CatalogRow, ScreenRequest, ScreenWorkerMessage } from "./screening-worker";
import { sgp4Body } from "./sgp4-body";

/**
 * Close approaches: screen one object against the whole active catalog, in
 * the visitor's browser. The page owns the catalog and the controls; a worker
 * owns the ~10⁶ SGP4 propagations (domain/conjunction/screening.ts).
 */

/**
 * Quick picks resolve against the live catalog: fixed ids for the landmarks,
 * and "a Starlink" is the first one found in the 53° shell — a hardcoded
 * Starlink id would eventually point at a deorbited satellite.
 */
const QUICK_PICKS: { label: string; resolve: (rows: CatalogRow[], byId: Map<string, CatalogRow>) => string | undefined }[] = [
  { label: "ISS", resolve: (_, byId) => (byId.has("25544") ? "25544" : undefined) },
  { label: "Tiangong", resolve: (_, byId) => (byId.has("48274") ? "48274" : undefined) },
  { label: "Hubble", resolve: (_, byId) => (byId.has("20580") ? "20580" : undefined) },
  {
    label: "A Starlink",
    resolve: (rows) =>
      rows.find((r) => r.n.startsWith("STARLINK") && Math.abs(Number(r.l2.slice(8, 16)) - 53.05) < 0.25)?.i,
  },
];
const WINDOWS = [
  { hours: 24, label: "Next 24 h" },
  { hours: 72, label: "Next 3 days" },
] as const;
const THRESHOLDS = [5, 10, 25] as const;
const DEFAULT_ID = "25544";

type CatalogState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; rows: CatalogRow[]; byId: Map<string, CatalogRow>; generatedAt: Date };

type RunState =
  | { state: "idle" }
  | { state: "running"; done: number; total: number }
  | { state: "done"; result: ScreeningResult; elapsedMs: number; unusable: number; receivedAtMs: number }
  | { state: "error"; message: string };

const n = (value: number) => value.toLocaleString("en-US");

function untilLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `in ${h} h ${String(minutes % 60).padStart(2, "0")} min`;
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function utcLabel(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export function ConjunctionsView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const targetId = params.get("id")?.replace(/\D/g, "") || DEFAULT_ID;
  const [hours, setHours] = useState<number>(24);
  const [thresholdKm, setThresholdKm] = useState<number>(25);
  const [catalog, setCatalog] = useState<CatalogState>({ state: "loading" });
  const [run, setRun] = useState<RunState>({ state: "idle" });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/sky/catalog", { signal: abort.signal });
        const body = (await res.json()) as {
          ok: boolean;
          data?: { generatedAt: string; entries: CatalogRow[] };
          error?: { message: string };
        };
        if (!res.ok || !body.ok || !body.data) {
          setCatalog({ state: "error", message: body.error?.message ?? "The active catalog couldn't load right now." });
          return;
        }
        const rows = body.data.entries;
        setCatalog({ state: "ready", rows, byId: new Map(rows.map((r) => [r.i, r])), generatedAt: new Date(body.data.generatedAt) });
      } catch (error) {
        if ((error as Error).name !== "AbortError") setCatalog({ state: "error", message: "The active catalog couldn't load right now." });
      }
    })();
    return () => abort.abort();
  }, [attempt]);

  const target = catalog.state === "ready" ? catalog.byId.get(targetId) : undefined;

  // One worker per run; a new target or option cancels the old run.
  const workerRef = useRef<Worker | null>(null);
  useEffect(() => {
    if (catalog.state !== "ready" || !target) return;
    const worker = new Worker(new URL("./screening-worker.ts", import.meta.url));
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<ScreenWorkerMessage>) => {
      const message = event.data;
      if (message.type === "progress") setRun({ state: "running", done: message.done, total: message.total });
      else if (message.type === "result") {
        setRun({ state: "done", result: message.result, elapsedMs: message.elapsedMs, unusable: message.unusable, receivedAtMs: Date.now() });
        worker.terminate();
      } else {
        setRun({ state: "error", message: message.message });
        worker.terminate();
      }
    };
    worker.onerror = () => setRun({ state: "error", message: "The screening worker stopped unexpectedly." });
    const request: ScreenRequest = {
      type: "screen",
      target,
      catalog: catalog.rows,
      startMs: Math.floor(Date.now() / 60_000) * 60_000,
      durationMinutes: hours * 60,
      thresholdKm,
    };
    worker.postMessage(request);
    return () => {
      worker.terminate();
      workerRef.current = null;
      setRun({ state: "idle" });
      setExpanded(null);
    };
  }, [catalog, target, hours, thresholdKm]);

  const matches = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (catalog.state !== "ready" || q.length < 2) return [];
    const out: CatalogRow[] = [];
    for (const row of catalog.rows) {
      if (row.n.toUpperCase().includes(q) || row.i === q) out.push(row);
      if (out.length >= 8) break;
    }
    return out;
  }, [catalog, query]);

  const picks = useMemo(() => {
    if (catalog.state !== "ready") return [];
    return QUICK_PICKS.flatMap((pick) => {
      const id = pick.resolve(catalog.rows, catalog.byId);
      return id ? [{ id, label: pick.label }] : [];
    });
  }, [catalog]);

  const choose = (id: string) => {
    setQuery("");
    router.replace(`${pathname}?id=${id}`, { scroll: false });
  };

  const targetName = target?.n ?? `#${targetId}`;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10">
      <header className="pt-8 pb-5">
        <h1 className="heading-display text-[30px] md:text-[40px]">Close approaches</h1>
        <p className="lede mt-2 max-w-2xl text-[16px]">
          Pick any satellite and your browser screens it against every other active satellite: which ones pass
          within a few kilometres in the coming days, exactly when, and from which direction.
        </p>
      </header>

      <section className="panel p-4" aria-label="Screening setup">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label mr-1">Screen</span>
          {picks.map((pick) => (
            <button
              key={pick.id}
              type="button"
              aria-pressed={targetId === pick.id}
              onClick={() => choose(pick.id)}
              className="choice"
            >
              {pick.label}
            </button>
          ))}
          <div className="relative min-w-[220px] flex-1">
            <input
              className="input"
              placeholder="…or search any active satellite"
              aria-label="Search the active catalog"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {matches.length > 0 ? (
              <ul className="panel absolute z-20 mt-1 w-full overflow-hidden py-1 shadow-xl" role="listbox" aria-label="Matching satellites">
                {matches.map((row) => (
                  <li key={row.i} role="option" aria-selected={false}>
                    <button
                      type="button"
                      className="flex w-full justify-between px-3 py-1.5 text-left text-[13px] hover:bg-[var(--color-bg-inset)]"
                      onClick={() => choose(row.i)}
                    >
                      <span>{row.n}</span>
                      <span className="font-mono text-[11px] text-[var(--color-text-muted)]">{row.i}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
          <Segmented label="Window" value={hours} options={WINDOWS.map((w) => ({ value: w.hours, label: w.label }))} onChange={setHours} />
          <Segmented
            label="Closer than"
            value={thresholdKm}
            options={THRESHOLDS.map((km) => ({ value: km, label: `${km} km` }))}
            onChange={setThresholdKm}
          />
        </div>
      </section>

      {catalog.state === "loading" ? <Loading label="Loading the active catalog…" /> : null}
      {catalog.state === "error" ? (
        <div className="panel mt-4">
          <ErrorState
            title="The catalog couldn't be loaded"
            message={catalog.message}
            retry={() => {
              setCatalog({ state: "loading" });
              setAttempt((a) => a + 1);
            }}
          />
        </div>
      ) : null}
      {catalog.state === "ready" && !target ? (
        <div className="panel mt-4 p-4 text-[14px] text-[var(--color-text-secondary)]">
          Catalog number {targetId} isn&apos;t in the active catalog (it may be debris, a rocket body, or decayed).
          Screening covers active satellites only.
        </div>
      ) : null}

      {target ? (
        <section className="mt-5" aria-live="polite" aria-busy={run.state === "running" || run.state === "idle"}>
          <h2 className="text-[20px] font-semibold">
            {targetName}
            <Link href={`/satellites/${target.i}`} className="ml-3 align-middle text-[13px] font-normal text-[var(--color-accent)] hover:underline">
              details →
            </Link>
          </h2>

          {run.state === "running" || run.state === "idle" ? (
            <Progress done={run.state === "running" ? run.done : 0} total={run.state === "running" ? run.total : 0} />
          ) : null}
          {run.state === "error" ? <ErrorState title="Screening failed" message={run.message} /> : null}
          {run.state === "done" ? (
            <Results
              result={run.result}
              elapsedMs={run.elapsedMs}
              receivedAtMs={run.receivedAtMs}
              unusable={run.unusable}
              thresholdKm={thresholdKm}
              hours={hours}
              targetRow={target}
              byId={catalog.state === "ready" ? catalog.byId : new Map()}
              expanded={expanded}
              onToggle={(key) => setExpanded(expanded === key ? null : key)}
            />
          ) : null}
        </section>
      ) : null}

      <section className="mt-8 max-w-3xl text-[13px] text-[var(--color-text-secondary)]" aria-labelledby="caveats">
        <h2 id="caveats" className="text-[15px] font-semibold text-[var(--color-text-primary)]">
          What this is, and isn&apos;t
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Screening against <strong>active satellites only</strong>. The public catalog&apos;s active feed leaves out
            debris and spent rocket bodies, which are most of what operators actually dodge.
          </li>
          <li>
            Positions come from public element sets (TLEs) propagated with SGP4. Those carry errors of roughly a
            kilometre or more and no uncertainty estimate, so this finds approaches worth a look. It can&apos;t give a
            collision probability, which needs operators&apos; precision orbits and covariance.
          </li>
          <li>
            Objects that stay together (docked modules, visiting vehicles, formation flyers) are listed separately,
            not as approaches. The method, filters and limits are on{" "}
            <Link href="/methodology#conjunctions" className="text-[var(--color-accent)] hover:underline">
              the methodology page
            </Link>
            .
          </li>
        </ul>
      </section>
    </div>
  );
}

function Segmented<T extends number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2">
      <span className="label">{label}</span>
      <div className="flex rounded-[3px] border border-[var(--color-border-strong)] p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
            className={
              "rounded-[2px] px-2.5 py-1 " +
              (option.value === value
                ? "bg-[var(--color-bg-raised)] font-medium text-[var(--color-text-primary)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]")
            }
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const fraction = total > 0 ? done / total : 0;
  return (
    <div className="panel mt-3 p-4" role="status">
      <div className="text-[13px] text-[var(--color-text-secondary)]">
        {total > 0 ? `Propagating ${n(total)} candidates with SGP4… ${Math.round(fraction * 100)}%` : "Compiling element sets…"}
      </div>
      <div className="mt-2 h-1 overflow-hidden bg-[var(--color-bg-inset)]">
        <div className="h-full bg-[var(--color-accent)] transition-[width]" style={{ width: `${fraction * 100}%` }} />
      </div>
    </div>
  );
}

function Results({
  result,
  elapsedMs,
  receivedAtMs,
  unusable,
  thresholdKm,
  hours,
  targetRow,
  byId,
  expanded,
  onToggle,
}: {
  result: ScreeningResult;
  elapsedMs: number;
  /** When the result arrived: countdowns are relative to it (render stays pure). */
  receivedAtMs: number;
  unusable: number;
  thresholdKm: number;
  hours: number;
  targetRow: CatalogRow;
  byId: Map<string, CatalogRow>;
  expanded: string | null;
  onToggle: (key: string) => void;
}) {
  const { stats, approaches, coOrbiting } = result;
  const now = receivedAtMs;
  return (
    <>
      <ol className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Screening funnel" data-testid="screening-funnel">
        <FunnelStep value={n(stats.catalogSize)} label="active objects" />
        <FunnelStep value={n(stats.afterRadiusFilter)} label="share its altitude range" />
        <FunnelStep value={n(stats.minimaRefined)} label="near passes refined" />
        <FunnelStep value={n(approaches.length)} label={`closer than ${thresholdKm} km`} highlight />
      </ol>
      <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
        {n(stats.propagations)} SGP4 propagations in {(elapsedMs / 1000).toFixed(1)} s on this device · window{" "}
        {utcLabel(stats.windowStartMs)} → {hours} h · {stats.stepSeconds} s sweep, refined to under a millisecond
        {unusable > 0 ? ` · ${n(unusable)} element sets SGP4 couldn't use` : ""}
        {stats.propagationFailures > 0 ? ` · ${n(stats.propagationFailures)} objects dropped out mid-window (decaying)` : ""}
      </p>

      {approaches.length === 0 ? (
        <div className="panel mt-4 p-4 text-[14px] text-[var(--color-text-secondary)]" data-testid="no-approaches">
          Nothing comes within {thresholdKm} km of {targetRow.n} in the next {hours} hours. That&apos;s the usual
          answer: space is big, even in crowded shells. Try a wider distance or a longer window.
        </div>
      ) : (
        <div className="panel mt-4 overflow-x-auto">
          <table className="table-technical" data-testid="approaches-table">
            <thead>
              <tr>
                <th scope="col">When (your time)</th>
                <th scope="col">Object</th>
                <th scope="col" className="text-right">Miss distance</th>
                <th scope="col" className="hidden text-right md:table-cell">Radial</th>
                <th scope="col" className="hidden text-right md:table-cell">In-track</th>
                <th scope="col" className="hidden text-right md:table-cell">Cross-track</th>
                <th scope="col" className="text-right">Closing speed</th>
              </tr>
            </thead>
            <tbody>
              {approaches.map((a) => {
                const key = `${a.id}-${a.tcaMs}`;
                const open = expanded === key;
                return (
                  <Fragment key={key}>
                    <tr
                      className="cursor-pointer hover:bg-[var(--color-bg-inset)]"
                      onClick={() => onToggle(key)}
                      aria-expanded={open}
                    >
                      <td className="font-sans">
                        <div>{timeLabel(a.tcaMs)}</div>
                        <div className="text-[11px] text-[var(--color-text-muted)]" title={utcLabel(a.tcaMs)}>
                          {untilLabel(a.tcaMs - now)}
                        </div>
                      </td>
                      <td className="font-sans">
                        <Link href={`/satellites/${a.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                          {a.name}
                        </Link>
                      </td>
                      <td className="text-right font-semibold">{a.missKm.toFixed(2)} km</td>
                      <td className="hidden text-right md:table-cell">{a.radialKm.toFixed(2)}</td>
                      <td className="hidden text-right md:table-cell">{a.inTrackKm.toFixed(2)}</td>
                      <td className="hidden text-right md:table-cell">{a.crossTrackKm.toFixed(2)}</td>
                      <td className="text-right">{a.relativeSpeedKmS.toFixed(2)} km/s</td>
                    </tr>
                    {open ? (
                      <tr>
                        <td colSpan={7} className="whitespace-normal bg-[var(--color-bg-inset)] font-sans">
                          <EncounterDetail approach={a} targetRow={targetRow} other={byId.get(a.id)} thresholdKm={thresholdKm} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
            Select a row for the encounter profile. Radial / in-track / cross-track (km) split the miss in{" "}
            {targetRow.n}&apos;s own frame: up, along its motion, and sideways.
          </p>
        </div>
      )}

      {coOrbiting.length > 0 ? (
        <details className="mt-3 text-[13px] text-[var(--color-text-secondary)]">
          <summary className="cursor-pointer">
            {n(coOrbiting.length)} object{coOrbiting.length === 1 ? "" : "s"} fly with {targetRow.n} (docked or in formation), not
            counted as approaches
          </summary>
          <ul className="mt-2 list-disc pl-5">
            {coOrbiting.map((c) => (
              <li key={c.id}>
                {c.name} <span className="font-mono text-[12px]">· closest {c.closestKm.toFixed(2)} km</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

function FunnelStep({ value, label, highlight = false }: { value: string; label: string; highlight?: boolean }) {
  return (
    <li className={"panel px-4 py-3 " + (highlight ? "border-[var(--color-accent-dim)]" : "")}>
      <div className="text-[24px] font-bold tracking-tight md:text-[28px]">{value}</div>
      <div className="text-[13px] text-[var(--color-text-secondary)]">{label}</div>
    </li>
  );
}

/**
 * Half-width of the profile window: long enough for the pair to drift ~10×
 * the screening distance apart at their closing speed, so the closest
 * approach and the threshold share a readable scale. (A fixed ±10 min spans
 * ~8,000 km at 14 km/s and flattens a 4 km miss into the baseline.)
 */
function profileHalfWindowMs(relativeSpeedKmS: number, thresholdKm: number): number {
  const seconds = (10 * thresholdKm) / Math.max(relativeSpeedKmS, 0.05);
  return Math.min(Math.max(seconds, 10), 600) * 1000;
}

function offsetLabel(ms: number): string {
  if (ms === 0) return "closest";
  const sign = ms > 0 ? "+" : "−";
  const seconds = Math.abs(ms) / 1000;
  return seconds >= 120 ? `${sign}${Math.round(seconds / 60)} min` : `${sign}${Math.round(seconds)} s`;
}

/** Separation vs time around the TCA, computed on demand for just this pair. */
function EncounterDetail({
  approach,
  targetRow,
  other,
  thresholdKm,
}: {
  approach: CloseApproach;
  targetRow: CatalogRow;
  other: CatalogRow | undefined;
  thresholdKm: number;
}) {
  const halfWindowMs = profileHalfWindowMs(approach.relativeSpeedKmS, thresholdKm);
  const profile = useMemo(() => {
    const t = sgp4Body(targetRow.i, targetRow.n, targetRow.l1, targetRow.l2);
    const o = other ? sgp4Body(other.i, other.n, other.l1, other.l2) : null;
    return t && o ? separationProfile(t, o, approach.tcaMs, halfWindowMs, halfWindowMs / 60) : [];
  }, [approach.tcaMs, targetRow, other, halfWindowMs]);

  const W = 640;
  const H = 180;
  const M = { top: 12, right: 12, bottom: 28, left: 52 };
  const finite = profile.filter((p) => Number.isFinite(p.km));
  if (finite.length < 2) return <p className="p-2 text-[13px]">The encounter profile couldn&apos;t be computed.</p>;
  const yMax = Math.max(...finite.map((p) => p.km), thresholdKm) * 1.05;
  const x = (tMs: number) => M.left + ((tMs - approach.tcaMs + halfWindowMs) / (2 * halfWindowMs)) * (W - M.left - M.right);
  const y = (km: number) => M.top + (1 - km / yMax) * (H - M.top - M.bottom);
  const path = finite.map((p, i) => `${i ? "L" : "M"}${x(p.tMs).toFixed(1)},${y(p.km).toFixed(1)}`).join("");

  return (
    <div className="flex flex-col gap-3 p-2 md:flex-row md:items-center">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[640px]" role="img" aria-label={`Separation between ${targetRow.n} and ${approach.name} from ${offsetLabel(-halfWindowMs).slice(1)} before to ${offsetLabel(halfWindowMs).slice(1)} after closest approach; minimum ${approach.missKm.toFixed(2)} km.`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={M.left} x2={W - M.right} y1={y(yMax * f)} y2={y(yMax * f)} stroke="#232327" />
            <text x={M.left - 6} y={y(yMax * f)} fill="#8a8983" fontSize={11} textAnchor="end" dominantBaseline="middle">
              {n(Math.round(yMax * f))} km
            </text>
          </g>
        ))}
        <line x1={M.left} x2={W - M.right} y1={y(thresholdKm)} y2={y(thresholdKm)} stroke="#8a8983" strokeDasharray="4 4" />
        <text x={W - M.right} y={y(thresholdKm) - 5} fill="#b0afa8" fontSize={11} textAnchor="end">
          {thresholdKm} km
        </text>
        <line x1={x(approach.tcaMs)} x2={x(approach.tcaMs)} y1={M.top} y2={H - M.bottom} stroke="#36363c" />
        <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" />
        <circle cx={x(approach.tcaMs)} cy={y(approach.missKm)} r={4} fill="var(--color-accent)" stroke="var(--color-bg-inset)" strokeWidth={2} />
        {[-1, -0.5, 0, 0.5, 1].map((f, i, all) => (
          <text
            key={f}
            x={x(approach.tcaMs + f * halfWindowMs)}
            y={H - 8}
            fill="#8a8983"
            fontSize={11}
            textAnchor={i === 0 ? "start" : i === all.length - 1 ? "end" : "middle"}
          >
            {offsetLabel(f * halfWindowMs)}
          </text>
        ))}
      </svg>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] md:w-64 md:grid-cols-1">
        <Detail term="Closest" value={`${approach.missKm.toFixed(3)} km`} />
        <Detail term="At" value={utcLabel(approach.tcaMs)} />
        <Detail term="Radial · in-track · cross" value={`${approach.radialKm.toFixed(2)} · ${approach.inTrackKm.toFixed(2)} · ${approach.crossTrackKm.toFixed(2)} km`} />
        <Detail term="Closing speed" value={`${approach.relativeSpeedKmS.toFixed(2)} km/s (${n(Math.round(approach.relativeSpeedKmS * 3600))} km/h)`} />
      </dl>
    </div>
  );
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">{term}</dt>
      <dd className="font-mono text-[12px] text-[var(--color-text-primary)]">{value}</dd>
    </div>
  );
}
