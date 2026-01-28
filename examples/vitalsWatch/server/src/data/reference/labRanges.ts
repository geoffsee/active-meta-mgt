/**
 * Lab reference ranges derived from CDC NHANES population data.
 *
 * Ranges are stored in data/reference-ranges.json and loaded at runtime.
 * Each range includes source attribution for audit traceability.
 */

import referenceRanges from "../../../data/reference-ranges.json";

export interface LabRange {
  critLow: number;
  low: number;
  high: number;
  critHigh: number;
  unit: string;
  label: string;
  source: string;
  sampleSize: number;
}

export const labRanges: Record<string, LabRange> = referenceRanges as Record<
  string,
  LabRange
>;

export type Severity = "low" | "medium" | "high" | "critical";

/**
 * Score the severity of a lab value based on reference ranges.
 *
 * Severity levels:
 * - critical: value <= critLow or value >= critHigh (0.5th / 99.5th percentile)
 * - high: value < low or value > high (2.5th / 97.5th percentile)
 * - medium: within normal range but > 30% from midpoint
 * - low: within normal range and close to midpoint
 */
export function scoreSeverity(value: number, range: LabRange): Severity {
  if (value <= range.critLow || value >= range.critHigh) return "critical";
  if (value < range.low || value > range.high) return "high";

  // Within normal range - score by distance from midpoint
  const mid = (range.low + range.high) / 2;
  const halfRange = (range.high - range.low) / 2;
  const dist = Math.abs(value - mid) / halfRange;

  return dist > 0.6 ? "medium" : "low";
}

/**
 * Get a human-readable interpretation of a lab value.
 */
export function interpretLabValue(
  labName: string,
  value: number
): { severity: Severity; interpretation: string } | null {
  const range = labRanges[labName];
  if (!range) return null;

  const severity = scoreSeverity(value, range);

  let interpretation: string;
  if (value <= range.critLow) {
    interpretation = `${range.label}: ${value} ${range.unit} (critically low)`;
  } else if (value >= range.critHigh) {
    interpretation = `${range.label}: ${value} ${range.unit} (critically high)`;
  } else if (value < range.low) {
    interpretation = `${range.label}: ${value} ${range.unit} (low)`;
  } else if (value > range.high) {
    interpretation = `${range.label}: ${value} ${range.unit} (high)`;
  } else {
    interpretation = `${range.label}: ${value} ${range.unit} (normal)`;
  }

  return { severity, interpretation };
}

/**
 * Get all available lab names.
 */
export function getLabNames(): string[] {
  return Object.keys(labRanges);
}

/**
 * Get range for a specific lab.
 */
export function getLabRange(labName: string): LabRange | undefined {
  return labRanges[labName];
}
