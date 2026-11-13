/**
 * Apparent magnitude from a published standard magnitude.
 *
 * The standard-magnitude convention (Mallama 2020, arXiv:2012.05100 §2):
 * m_std is the magnitude at 1 000 km and 90° phase, and the phase term is the
 * illuminated fraction of a sphere, normalized so it vanishes at 90°:
 *
 *      m ≈ m_std − 15 + 5·log₁₀(rangeKm) − 2.5·log₁₀((1 + cos φ)/2) − 0.753
 *
 * (−0.753 = 2.5·log₁₀ 0.5; equivalently Quicksat's "− 15.75".)
 *
 * Pure arithmetic with no imports, so browser code (the sighting worker) can
 * use the same formula as the server's pass predictions without pulling the
 * server-side SGP4 adapter into its bundle.
 */

/** 2.5·log₁₀(0.5): moves the phase term's zero from full phase to 90°. */
const HALF_PHASE_NORMALIZATION = 2.5 * Math.log10(0.5);

/** Apparent magnitude from a standard magnitude (1 000 km, 90° phase), range and phase angle. */
export function estimateMagnitude(stdMag: number, rangeKm: number, phaseDeg: number): number {
  const rangeTerm = 5 * Math.log10(Math.max(rangeKm, 1));
  const cosPhase = Math.cos((phaseDeg * Math.PI) / 180);
  // Illuminated fraction, zeroed at 90°: full phase (φ=0) → −0.75 (brighter),
  // half phase → 0, crescent (φ>90°) → dimmer.
  const phaseTerm = -2.5 * Math.log10(Math.max((1 + cosPhase) / 2, 1e-6)) + HALF_PHASE_NORMALIZATION;
  return stdMag - 15 + rangeTerm + phaseTerm;
}
