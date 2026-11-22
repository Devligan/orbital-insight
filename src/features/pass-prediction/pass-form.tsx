"use client";

/**
 * Pass-prediction workflow UI.
 *
 * Every field is checked here against the same limits the server enforces
 * (`contracts/pass-request.ts`), so a bad value is named next to its field
 * and nothing is sent; the server still re-validates everything.
 * Results distinguish predicted passes from visibility guarantees and label
 * truncated passes honestly. CSV export encodes exactly the returned data.
 */

import { useCallback, useEffect, useId, useRef, useState, type InputHTMLAttributes } from "react";
import {
  checkPassForm,
  type PassFormField,
  type PassFormValues as FormValues,
  type PassRequestFields,
} from "@/contracts/pass-request";
import Link from "next/link";
import { PlaceSearch, type ChosenSpot } from "@/features/observer/place-search";
import { rememberSpot, useRememberedSpot } from "@/features/observer/spot-store";
import { useWatchlist } from "@/features/watchlist/local-store";
import { PassCard, type PassCardData as PassEntry } from "@/features/pass-prediction/pass-cards";
import { observerClock, observerZoneNote } from "@/features/pass-prediction/sky-words";
import { SkyChart } from "@/features/pass-prediction/sky-chart";
import { passesCsv, passesCsvFileName } from "@/features/pass-prediction/pass-csv";
import { Badge, EmptyState, ErrorState, Loading, Panel, PanelHeader } from "@/components/ui/primitives";
import { downloadFile } from "@/lib/download";
import { formatUtc } from "@/lib/units";

interface PassSatelliteResult {
  satelliteNumber: string;
  name: string;
  passes: PassEntry[];
  failure?: { reason: string; message: string };
  lineage?: string;
}

interface PassResponse {
  ok: boolean;
  data?: {
    results: PassSatelliteResult[];
    windowStart: string;
    windowEnd: string;
    minElevationDeg: number;
    /** IANA zone at the observer's coordinates (server-resolved). */
    observerTimeZone: string | null;
  };
  error?: { kind: string; message: string };
}

/** Bright, well-known objects people ask about, one tap each. */
const QUICK_PICKS = [
  { satelliteNumber: "25544", name: "ISS" },
  { satelliteNumber: "48274", name: "Tiangong" },
  { satelliteNumber: "20580", name: "Hubble" },
] as const;

/** Field order on screen, so the first wrong one gets focus. */
const FIELD_ORDER: PassFormField[] = ["latitudeDeg", "longitudeDeg", "altitudeMeters", "satellites", "windowHours", "minElevationDeg"];

const DEFAULT_SPOT = { lat: "51.5072", lon: "-0.1276", altitudeMeters: "11", label: "London, England, United Kingdom" };

export function PassPredictionsForm() {
  const watchlist = useWatchlist();
  // Where you are comes from the spot remembered on the home page (or a place
  // picked here); typing coordinates by hand overrides it for this page.
  const remembered = useRememberedSpot();
  const [typed, setTyped] = useState<{ latitude: string; longitude: string; altitudeMeters: string } | null>(null);
  const [satelliteInput, setSatelliteInput] = useState("25544");
  const [windowHours, setWindowHours] = useState("24");
  const [minElevationDeg, setMinElevationDeg] = useState("10");
  // The last answer and the request that produced it. The CSV is named for
  // that request, not for whatever is in the boxes now.
  const [answer, setAnswer] = useState<{ data: NonNullable<PassResponse["data"]>; request: PassRequestFields } | null>(null);
  const results = answer?.data ?? null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Drops a slower, superseded answer (e.g. the opening run vs. a quick re-run).
  const requestRef = useRef(0);
  // A field's problem shows once it has been left, or after a submit.
  const [touched, setTouched] = useState<ReadonlySet<PassFormField>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const formElRef = useRef<HTMLFormElement>(null);

  const latitude = typed?.latitude ?? (remembered ? remembered.lat.toFixed(4) : DEFAULT_SPOT.lat);
  const longitude = typed?.longitude ?? (remembered ? remembered.lon.toFixed(4) : DEFAULT_SPOT.lon);
  // A geocoded place has no useful height for this; sea level is within the model's slack.
  const altitudeMeters = typed?.altitudeMeters ?? (remembered ? "0" : DEFAULT_SPOT.altitudeMeters);
  const spotLabel = typed ? null : remembered ? remembered.label : DEFAULT_SPOT.label;
  const form: FormValues = { satellites: satelliteInput, latitude, longitude, altitudeMeters, windowHours, minElevationDeg };
  const check = checkPassForm(form);
  const fieldErrors = check.ok ? {} : check.errors;
  const shownError = (field: PassFormField) => (attempted || touched.has(field) ? fieldErrors[field] : undefined);
  const leave = (field: PassFormField) => () => setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));

  // Uses only setters and refs, so it's stable and effects can depend on it.
  const run = useCallback(async (values: FormValues) => {
    const checked = checkPassForm(values);
    if (!checked.ok) {
      // Nothing is sent: say which fields are wrong, and start at the first.
      // Nothing from before stays up as if it answered these inputs either:
      // the last results go, and a run still in flight is retired.
      requestRef.current += 1;
      setBusy(false);
      setError(null);
      setAnswer(null);
      setAttempted(true);
      const first = FIELD_ORDER.find((field) => checked.errors[field]);
      formElRef.current?.querySelector<HTMLInputElement>(`[data-field="${first}"]`)?.focus();
      return;
    }
    const request = ++requestRef.current;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const response = await fetch("/api/passes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...checked.request, windowStartIso: new Date().toISOString() }),
      });
      const body = (await response.json()) as PassResponse;
      if (request !== requestRef.current) return;
      if (!body.ok || !body.data) {
        setError(body.error?.message ?? "The pass-prediction service reported an error");
        return;
      }
      setAnswer({ data: body.data, request: checked.request });
    } catch {
      if (request === requestRef.current) setError("Could not reach the pass-prediction service (network error)");
    } finally {
      if (request === requestRef.current) setBusy(false);
    }
  }, []);

  // The latest form, for the effect below (refs are written in effects, not during render).
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  });

  // Open on an answer, not an empty panel, and answer again whenever the spot
  // changes (a place picked here, or on the home page in another tab).
  const spotKey = remembered ? `${remembered.lat},${remembered.lon}` : "default";
  useEffect(() => {
    void run(formRef.current);
  }, [run, spotKey]);

  function choosePlace(spot: ChosenSpot) {
    setTyped(null);
    rememberSpot({ lat: spot.lat, lon: spot.lon, label: spot.label, source: spot.source });
  }

  function editSpot(field: "latitude" | "longitude" | "altitudeMeters", value: string) {
    setTyped({ latitude, longitude, altitudeMeters, [field]: value });
  }

  function submit() {
    void run(form);
  }
  const watchlistQuick = watchlist.items.slice(0, 4);

  return (
    <div className="grid gap-3 lg:grid-cols-[340px_1fr]">
      <Panel>
        <PanelHeader title="Observation setup" />
        <form
          ref={formElRef}
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1">
            <span className="label">Where you&apos;re watching from</span>
            <PlaceSearch onChoose={choosePlace} label="Find a place by name, postcode, or coordinates" />
            <span className="text-[12px] text-[var(--color-text-secondary)]" data-testid="passes-spot">
              {spotLabel ?? "Coordinates as typed below"}
            </span>
          </div>
          <div className="grid grid-cols-2 items-start gap-2">
            <Field
              label="Latitude (±90°)"
              field="latitudeDeg"
              error={shownError("latitudeDeg")}
              onBlur={leave("latitudeDeg")}
              value={latitude}
              onChange={(e) => editSpot("latitude", e.target.value)}
              name="latitude"
              inputMode="decimal"
            />
            <Field
              label="Longitude (±180°)"
              field="longitudeDeg"
              error={shownError("longitudeDeg")}
              onBlur={leave("longitudeDeg")}
              value={longitude}
              onChange={(e) => editSpot("longitude", e.target.value)}
              name="longitude"
              inputMode="decimal"
            />
          </div>
          <Field
            label="Altitude above sea level (m, ≤ 10,000)"
            field="altitudeMeters"
            error={shownError("altitudeMeters")}
            onBlur={leave("altitudeMeters")}
            value={altitudeMeters}
            onChange={(e) => editSpot("altitudeMeters", e.target.value)}
            name="altitude"
            inputMode="decimal"
          />
          <Field
            label="Catalog IDs (up to 25, space-separated)"
            field="satellites"
            error={shownError("satellites")}
            onBlur={leave("satellites")}
            value={satelliteInput}
            onChange={(e) => setSatelliteInput(e.target.value)}
            name="satellites"
            className="font-mono"
          />
          <div className="-mt-1 flex flex-wrap gap-1">
            {QUICK_PICKS.map((pick) => (
              <button
                type="button"
                key={pick.satelliteNumber}
                className="badge text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]"
                onClick={() => setSatelliteInput((prev) => addId(prev, pick.satelliteNumber))}
              >
                + {pick.name}
              </button>
            ))}
          </div>
          <Field
            label="Prediction window (hours, ≤ 720)"
            field="windowHours"
            error={shownError("windowHours")}
            onBlur={leave("windowHours")}
            value={windowHours}
            onChange={(e) => setWindowHours(e.target.value)}
            name="window"
            inputMode="decimal"
          />
          <Field
            label="Minimum elevation (°, 0–85)"
            field="minElevationDeg"
            error={shownError("minElevationDeg")}
            onBlur={leave("minElevationDeg")}
            value={minElevationDeg}
            onChange={(e) => setMinElevationDeg(e.target.value)}
            name="minElevation"
            inputMode="decimal"
          />

          {watchlistQuick.length > 0 ? (
            <div>
              <span className="label">From your browser watchlist</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {watchlistQuick.map((item) => (
                  <button
                    type="button"
                    key={item.satelliteNumber}
                    className="badge text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]"
                    onClick={() => setSatelliteInput((prev) => addId(prev, item.satelliteNumber))}
                  >
                    + {item.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Calculating…" : "Predict passes"}
          </button>
        </form>

        <p className="mt-3 text-[11px] text-[var(--color-text-muted)]">
          Every pass is a geometry calculation. Sunlight geometry (Earth&apos;s shadow and the observer&apos;s sky
          darkness) is modeled. Brightness is estimated only for objects with a published standard magnitude
          (others read &ldquo;brightness unknown&rdquo;), and is rough even then. Clouds and eyesight are not
          modeled. See the{" "}
          <Link href="/methodology" className="text-[var(--color-accent)] hover:underline">methodology</Link>.
        </p>
      </Panel>

      <Panel className="min-w-0">
        <PanelHeader
          title="Predicted passes"
          right={
            answer ? (
              <button className="btn btn-secondary" onClick={() => exportCsv(answer)}>
                Export CSV
              </button>
            ) : undefined
          }
        />

        {busy ? <Loading label="Propagating passes…" /> : null}
        {error ? <ErrorState title="Pass prediction failed" message={error} retry={submit} /> : null}
        {!busy && !error && !results ? (
          <EmptyState
            title="No predictions yet"
            hint={
              attempted && !check.ok
                ? "Fix the fields named in the form, then predict again."
                : "Configure the observation parameters and run a prediction."
            }
          />
        ) : null}

        {results ? (
          <div className="flex flex-col gap-3">
            <p className="text-[11px] text-[var(--color-text-muted)]">
              Window {formatUtc(new Date(results.windowStart))} → {formatUtc(new Date(results.windowEnd))} ·
              minimum elevation {results.minElevationDeg}°
              {(() => {
                const note = observerZoneNote(
                  results.observerTimeZone,
                  Intl.DateTimeFormat().resolvedOptions().timeZone,
                  new Date(results.windowStart),
                );
                return note ? ` · ${note.replace(/^Times are/, "Local times are")}` : "";
              })()}
            </p>
            {results.results.map((sat) => (
              <div key={sat.satelliteNumber} className="panel-inset p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Link href={`/satellites/${sat.satelliteNumber}`} className="text-[13px] font-medium text-[var(--color-text-primary)] hover:underline">
                    {sat.name || `NORAD ${sat.satelliteNumber}`}
                  </Link>
                  <span className="data-value text-[11px] text-[var(--color-text-muted)]">{sat.satelliteNumber}</span>
                  {(sat.lineage === "provider-unavailable-stale" || sat.lineage === "cached") ? (
                    <Badge tone="warn">{sat.lineage === "cached" ? "Cached elements" : "Stale elements"}</Badge>
                  ) : null}
                  {sat.failure ? <Badge tone="bad">{sat.failure.reason}</Badge> : null}
                </div>

                {sat.failure ? (
                  <p className="text-[12px] text-[var(--color-status-bad)]">{sat.failure.message}</p>
                ) : sat.passes.length === 0 ? (
                  <p className="text-[12px] text-[var(--color-text-muted)]">
                    No passes above {results.minElevationDeg}° in this window.
                  </p>
                ) : (
                  <>
                    {/* Phones read cards; desktop keeps the technical table. */}
                    <div className="flex flex-col gap-2 md:hidden">
                    {sat.passes.map((pass, i) => (
                      <PassCard key={`${sat.satelliteNumber}-${i}`} pass={pass} timeZone={results.observerTimeZone} />
                    ))}
                  </div>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="table-technical">
                      <thead>
                        <tr>
                          <th>Sky</th>
                          <th>Peak (local)</th>
                          <th>Rise (UTC)</th>
                          <th>Rise az</th>
                          <th>Max elevation</th>
                          <th>Apex az</th>
                          <th>Set (UTC)</th>
                          <th>Set az</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sat.passes.map((pass, i) => (
                          <tr key={`${sat.satelliteNumber}-${i}`}>
                            <td className="!py-1">
                              <SkyChart pass={pass} size={44} />
                            </td>
                            <td>{observerClock(pass.maxTime, results.observerTimeZone)}</td>
                            <td>{pass.riseTime ? formatUtc(new Date(pass.riseTime)) : "before window"}</td>
                            <td>{pass.azimuthAtRiseDeg !== null ? `${pass.azimuthAtRiseDeg.toFixed(1)}°` : "—"}</td>
                            <td>{pass.maxElevationDeg.toFixed(1)}°</td>
                            <td>{pass.azimuthAtMaxDeg.toFixed(1)}°</td>
                            <td>{pass.setTime ? formatUtc(new Date(pass.setTime)) : "after window"}</td>
                            <td>{pass.azimuthAtSetDeg !== null ? `${pass.azimuthAtSetDeg.toFixed(1)}°` : "—"}</td>
                            <td>
                              {pass.truncated === "none" ? "" : `pass ${pass.truncated} outside window`}
                              {pass.visibility
                                ? pass.visibility.fromGround
                                  ? pass.visibility.bestEstimatedMagnitude !== null
                                    ? ` visible (≈ mag ${pass.visibility.bestEstimatedMagnitude.toFixed(1)})`
                                    : " visible (brightness unknown)"
                                  : " not visible " + (pass.visibility.reasonIfNotVisible ?? "")
                                : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function exportCsv({ data, request }: { data: NonNullable<PassResponse["data"]>; request: PassRequestFields }): void {
  downloadFile(passesCsv(data.results), passesCsvFileName(data.windowStart, request.observer), "text/csv;charset=utf-8");
}

/**
 * One labelled input whose refusal reason sits under it, tied to it for
 * screen readers (aria-invalid + aria-describedby). The reason stays outside
 * the <label> so the field's accessible name doesn't change when it appears.
 */
function Field({
  label,
  field,
  error,
  className,
  ...input
}: { label: string; field: PassFormField; error?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "id">) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="label">{label}</span>
        <input
          {...input}
          className={className ? `input ${className}` : "input"}
          data-field={field}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </label>
      {error ? (
        <p id={errorId} className="text-[12px] text-[var(--color-status-bad)]" data-testid={`error-${field}`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Append a catalog id unless it's already listed. */
function addId(list: string, id: string): string {
  return list.split(/[\s,]+/).includes(id) ? list : `${list} ${id}`.trim();
}
