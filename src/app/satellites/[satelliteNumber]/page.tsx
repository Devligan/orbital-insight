import Link from "next/link";
import { notFound } from "next/navigation";
import { GroundTrackPlot } from "@/features/orbit-visualization/ground-track-plot";
import { WatchSaveButton } from "@/features/watchlist/watch-save-button";
import { Badge, DataField } from "@/components/ui/primitives";
import { PAGE, PageHeader } from "@/components/ui/page-header";
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
      <div className={PAGE}>
        <PageHeader eyebrow={`NORAD ${satelliteNumber}`} title="Orbit data unavailable">
          {loadError} The provider (CelesTrak) may be unreachable, and this page says so rather than draw an orbit
          from placeholder data.
        </PageHeader>
        <Link href="/" className="btn btn-secondary">
          Back to the sky
        </Link>
      </div>
    );
  }

  const { record, characteristics, track, lineage, staleElements } = data;
  const tleSource = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${record.catalog.satelliteNumber}`;
  const perigee = Math.round(characteristics.perigeeAltitudeKm);
  const apogee = Math.round(characteristics.apogeeAltitudeKm);
  const height = apogee - perigee <= 5 ? `about ${perigee.toLocaleString()} km up` : `${perigee.toLocaleString()} to ${apogee.toLocaleString()} km up`;

  const figures = [
    { value: perigee === apogee ? `${perigee.toLocaleString()} km` : `${perigee.toLocaleString()}–${apogee.toLocaleString()} km`, label: "altitude, perigee to apogee" },
    { value: `${characteristics.inclinationDeg.toFixed(1)}°`, label: "inclination to the equator" },
    { value: `${characteristics.periodMinutes.toFixed(1)} min`, label: "per orbit" },
    { value: characteristics.eccentricity.toFixed(4), label: "eccentricity" },
  ];

  return (
    <div className={PAGE}>
      <PageHeader
        eyebrow={`NORAD ${record.catalog.satelliteNumber}${record.elementSet.internationalDesignator ? ` · COSPAR ${record.elementSet.internationalDesignator}` : ""}`}
        title={record.catalog.name}
        aside={
          <div className="flex flex-col items-stretch gap-2 sm:w-56">
            <WatchSaveButton satelliteNumber={record.catalog.satelliteNumber} name={record.catalog.name} />
            <Link href={`/conjunctions?id=${record.catalog.satelliteNumber}`} className="btn btn-secondary text-[14px]">
              Screen for close approaches
            </Link>
          </div>
        }
      >
        <p>
          Orbits {height}, inclined {characteristics.inclinationDeg.toFixed(1)}° to the equator, once every{" "}
          {characteristics.periodMinutes.toFixed(1)} minutes.
        </p>
        <p className="mt-3 flex flex-wrap gap-1.5">
          <Badge tone={lineage === "live" ? "good" : lineage === "cached" ? "warn" : "bad"}>{lineageLabel(lineage)}</Badge>
          <Badge tone={staleElements ? "warn" : "good"}>{staleElements ? "Elements older than 36 h" : "Elements fresh"}</Badge>
        </p>
      </PageHeader>

      <section aria-label="The orbit in numbers" className="grid grid-cols-2 border-y border-[var(--color-border-hairline)] md:grid-cols-4">
        {figures.map((figure) => (
          <div key={figure.label} className="border-[var(--color-border-hairline)] py-5 pr-5 md:border-r md:pl-5 md:first:pl-0 md:last:border-r-0">
            <div className="font-mono text-[22px] tracking-tight text-[var(--color-text-primary)]">{figure.value}</div>
            <div className="mt-1 text-[13px] text-[var(--color-text-secondary)]">{figure.label}</div>
          </div>
        ))}
      </section>

      <section aria-labelledby="track-title" className="mt-10">
        <p className="eyebrow mb-2">Next 24 hours</p>
        <h2 id="track-title" className="text-[20px] font-medium tracking-[-0.01em]">
          Where it flies over
        </h2>
        <div className="panel mt-4 p-3">
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
        </div>
        <p className="mt-2 max-w-3xl text-[13px] text-[var(--color-text-muted)]">
          The point on the ground beneath it, predicted with SGP4 from the element set below. A prediction, not a live
          position.
          {staleElements ? " These elements are stale, so the error grows across the day." : ""}{" "}
          <Link href="/methodology" className="link">
            How accurate is this?
          </Link>
        </p>
      </section>

      <section aria-labelledby="elements-title" className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <p className="eyebrow mb-2">Source</p>
          <h2 id="elements-title" className="text-[20px] font-medium tracking-[-0.01em]">
            The element set
          </h2>
          <div className="mt-4 flex flex-col">
            <DataField label="Element epoch" value={formatUtc(record.elementSet.epoch)} />
            <DataField label="Retrieved from source" value={formatUtc(record.provenance.retrievedAt)} />
            <DataField label="Mean motion" value={characteristics.meanMotionRevPerDay.toFixed(4)} unit="rev/day" />
            <DataField
              label="Revolutions at epoch"
              value={
                characteristics.revolutionNumberAtEpoch !== null && characteristics.revolutionNumberAtEpoch > 0
                  ? characteristicRev(characteristics.revolutionNumberAtEpoch)
                  : "unavailable"
              }
            />
            <DataField label="Classification" value={record.elementSet.classification} />
          </div>
        </div>
        <div className="min-w-0">
          <p className="eyebrow mb-2">Two-line elements</p>
          <pre className="panel-inset overflow-x-auto p-3 text-[11.5px] leading-5 text-[var(--color-text-secondary)]">
{record.elementSet.line1}
{"\n"}
{record.elementSet.line2}
          </pre>
          <a className="link mt-2 inline-block text-[13px]" href={tleSource} target="_blank" rel="noreferrer">
            Original GP record on CelesTrak ↗
          </a>
        </div>
      </section>
    </div>
  );
}
function lineageLabel(lineage: string): string {
  if (lineage === "live") return "Live from CelesTrak";
  if (lineage === "cached") return "Cached data";
  return "Stale: provider unavailable";
}

function characteristicRev(rev: number): string {
  return `#${Math.floor(rev)}`;
}
