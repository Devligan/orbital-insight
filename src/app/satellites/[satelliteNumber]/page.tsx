import Link from "next/link";
import { notFound } from "next/navigation";
import { GroundTrackPlot } from "@/features/orbit-visualization/ground-track-plot";
import { WatchSaveButton } from "@/features/watchlist/watch-save-button";
import { Badge, DataField, Panel, PanelHeader } from "@/components/ui/primitives";
import { loadSatelliteDetail, type SatelliteDetailData } from "@/server/detail-loader";
import { AppError, isAppError } from "@/lib/errors";
import { formatUtc } from "@/lib/units";

export const dynamic = "force-dynamic";

export default async function SatelliteDetailPage({ params }: { params: Promise<{ satelliteNumber: string }> }) {
  const { satelliteNumber } = await params;
  if (!/^[0-9]{1,5}$/.test(satelliteNumber)) notFound();

  let data: SatelliteDetailData | undefined;
  let loadError: string | null = null;
  try {
    data = await loadSatelliteDetail(satelliteNumber);
  } catch (error) {
    if (isAppError(error) && error.kind === "not-found") notFound();
    loadError = error instanceof AppError ? error.message : "The analysis service failed";
  }

  if (!data) {
    return (
      <div className="p-6">
        <Panel>
          <PanelHeader title="Satellite data unavailable" />
          <p className="text-[13px] text-[var(--color-text-secondary)]">{loadError}</p>
          <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
            The upstream provider (CelesTrak) may be unreachable. This failure is shown honestly rather than presenting
            cached or placeholder orbital data.
          </p>
          <Link href="/" className="btn btn-secondary mt-3 inline-flex">Back to explorer</Link>
        </Panel>
      </div>
    );
  }

  const { record, characteristics, track, lineage, staleElements } = data;
  const tleSource = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${record.catalog.satelliteNumber}`;

  return (
    // minmax(0, …) columns: the implicit `auto` column sized itself to the
    // unbreakable TLE lines and pushed the page off-screen on phones.
    <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-[380px_minmax(0,1fr)]">
      <Panel className="flex flex-col gap-3">
        <div>
          <h1 className="text-[16px] font-semibold">{record.catalog.name}</h1>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            NORAD {record.catalog.satelliteNumber}
            {record.elementSet.internationalDesignator ? ` · COSPAR ${record.elementSet.internationalDesignator}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge tone={lineage === "live" ? "good" : lineage === "cached" ? "warn" : "bad"}>{lineageLabel(lineage)}</Badge>
          <Badge tone={staleElements ? "warn" : "good"}>
            {staleElements ? "Elements older than 36 h" : "Elements fresh"}
          </Badge>
          <Badge tone="neutral">CelesTrak</Badge>
        </div>

        <div className="flex flex-col">
          <DataField label="Classification" value={record.elementSet.classification} />
          <DataField label="Element epoch" value={formatUtc(record.elementSet.epoch)} />
          <DataField label="Retrieved from source" value={formatUtc(record.provenance.retrievedAt)} />
          <DataField label="Inclination (approx)" value={characteristics.inclinationDeg.toFixed(4)} unit="deg" />
          <DataField label="Eccentricity" value={characteristics.eccentricity.toFixed(7)} />
          <DataField label="Mean motion (approx)" value={characteristics.meanMotionRevPerDay.toFixed(4)} unit="rev/day" />
          <DataField label="Period (approx)" value={characteristics.periodMinutes.toFixed(2)} unit="min" />
          <DataField label="Perigee altitude (approx)" value={characteristics.perigeeAltitudeKm.toFixed(0)} unit="km" />
          <DataField label="Apogee altitude (approx)" value={characteristics.apogeeAltitudeKm.toFixed(0)} unit="km" />
          <DataField label="Revolutions at epoch" value={characteristics.revolutionNumberAtEpoch !== null && characteristics.revolutionNumberAtEpoch > 0 ? characteristicRev(characteristics.revolutionNumberAtEpoch) : "unavailable"} />
        </div>

        <WatchSaveButton satelliteNumber={record.catalog.satelliteNumber} name={record.catalog.name} />

        <div className="mt-auto flex flex-col gap-1 border-t border-[var(--color-border-hairline)] pt-2 text-[11px] text-[var(--color-text-muted)]">
          <p>Source orbital elements (TLE, columns per CelesTrak GP format):</p>
          <pre className="panel-inset overflow-x-auto p-2 text-[10px] leading-4 text-[var(--color-text-secondary)]">
{record.elementSet.line1}
{"\n"}
{record.elementSet.line2}
          </pre>
          <a className="text-[var(--color-accent)] hover:underline" href={tleSource} target="_blank" rel="noreferrer">
            Original GP record on CelesTrak ↗
          </a>
        </div>
      </Panel>

      <div className="flex min-w-0 flex-col gap-3">
        <Panel>
          <PanelHeader title="Ground track — next 24 hours (predicted)" />
          <GroundTrackPlot
            name={record.catalog.name}
            segments={track.segments.map((segment) =>
              segment.points.map((p) => ({
                time: p.time.toISOString(),
                latitudeDeg: p.latitudeDeg,
                longitudeDeg: p.longitudeDeg,
                altitudeKm: p.altitudeKm,
              })),
            )}
            height={360}
          />
          <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
            Sub-satellite points computed by SGP4 from the element set above. Predictions — not measured positions.
            {staleElements ? " Elements are stale; expect increasing error across the prediction window." : ""}
          </p>
        </Panel>

        <Panel>
          <PanelHeader title="Predicted current position" />
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            The satellite&apos;s position at the page-view time is an SGP4 prediction based on the published element set,
            accurate to within the limits described on the{" "}
            <Link href="/methodology" className="text-[var(--color-accent)] hover:underline">methodology page</Link>.
            It is not a live telemetry feed.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function lineageLabel(lineage: string): string {
  if (lineage === "live") return "Live from CelesTrak";
  if (lineage === "cached") return "Cached data";
  return "Stale — provider unavailable";
}

function characteristicRev(rev: number): string {
  return `#${Math.floor(rev)}`;
}
