"use client";

/**
 * Client-side aggregation of the /positions + /ground-track API payloads
 * into the shapes the globe and track components consume. Pure data shaping
 * (no physics) - propagation lives in the domain, computed server-side.
 */

import type { EciSample } from "./sample-types";

export interface GroundTrackResponse {
  ok: boolean;
  data?: {
    satelliteNumber: string;
    name: string;
    segments: { points: { time: string; latitudeDeg: number; longitudeDeg: number; altitudeKm: number }[] }[];
    sampleIntervalSeconds: number;
    windowStart: string;
    windowEnd: string;
  };
  error?: { kind: string; message: string };
}

export interface PositionsResponse {
  ok: boolean;
  data?: {
    satelliteNumber: string;
    name: string;
    lineage: string;
    positions: {
      time: string;
      teme: { x: number; y: number; z: number };
      ecf: { x: number; y: number; z: number };
      latitudeDeg: number;
      longitudeDeg: number;
      altitudeKm: number;
    }[];
  };
  error?: { kind: string; message: string };
}

export type SampleList = EciSample[];

export function toEciSamples(positions: NonNullable<PositionsResponse["data"]>["positions"]): SampleList {
  return positions.map((p) => ({
    time: p.time,
    teme: p.teme,
    ecf: p.ecf,
    latitudeDeg: p.latitudeDeg,
    longitudeDeg: p.longitudeDeg,
    altitudeKm: p.altitudeKm,
  }));
}

export function toTrackSegments(track: GroundTrackResponse["data"]): [number, number][][] {
  return (track?.segments ?? []).map((segment) =>
    segment.points.map((p) => [p.latitudeDeg, p.longitudeDeg] as [number, number]),
  );
}

export function toTrackPointTimes(track: GroundTrackResponse["data"]): { time: string; lat: number; lon: number; alt: number }[] {
  return (track?.segments ?? []).flatMap((segment) =>
    segment.points.map((p) => ({ time: p.time, lat: p.latitudeDeg, lon: p.longitudeDeg, alt: p.altitudeKm })),
  );
}
