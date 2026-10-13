/**
 * GET /api/satellites/:satelliteNumber
 *
 * Full detail for one satellite: catalog identity, validated element set,
 * derived approximate characteristics, provenance (source, epoch, retrieval
 * timestamp) and data-lineage flags.
 */

import { z } from "zod";
import { jsonFail, jsonOk } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { satelliteService, type DataLineage } from "@/server/satellites";
import { compileElementSet } from "@/domain/orbit/propagation";
import { computeCharacteristics } from "@/domain/orbit/characteristics";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ satelliteNumber: string }> }): Promise<Response> {
  try {
    const { satelliteNumber } = await context.params;
    const parsedId = z.string().regex(/^[0-9]{1,5}$/).parse(satelliteNumber);

    const { record, lineage } = await satelliteService.get(parsedId);
    const compiled = compileElementSet(record.elementSet);
    const characteristics = computeCharacteristics(compiled);

    return jsonOk({
      satelliteNumber: record.catalog.satelliteNumber,
      name: record.catalog.name,
      group: record.catalog.group ?? null,
      internationalDesignator: record.elementSet.internationalDesignator,
      classification: record.elementSet.classification,
      epoch: record.elementSet.epoch.toISOString(),
      retrievedAt: record.provenance.retrievedAt.toISOString(),
      lineage: lineage satisfies DataLineage,
      stale: Date.now() - compiled.epoch.getTime() > STALE_WARNING_MS,
      sourceName: "CelesTrak",
      tleLine1: record.elementSet.line1,
      tleLine2: record.elementSet.line2,
      characteristics,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonFail(new AppError("validation", "Invalid satellite identifier"));
    }
    return jsonFail(error);
  }
}

/**
 * Element data older than this is flagged in the UI. SGP4 accuracy degrades
 * with time from epoch; for LEO objects the published guidance (CelesTrak)
 * is that differences from the *next* element set begin to matter within
 * days. We flag age rather than inventing a hard accuracy cutoff.
 */
const STALE_WARNING_MS = 36 * 60 * 60 * 1000;
