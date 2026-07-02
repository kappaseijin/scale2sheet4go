import type {
  MeasurementReading,
  MeasurementSource,
} from "../domain/index.js";

export type MeasurementSourceOption =
  | "scale-exporter"
  | "google-fit"
  | "apple-health";

export interface MeasurementSourceReader {
  readonly source: Exclude<MeasurementSource, "mixed">;
  readLatestMeasurements(referenceTime: Date): Promise<MeasurementReading[]>;
}

export function sourceOptionToMeasurementSource(
  source: Exclude<MeasurementSourceOption, "scale-exporter">,
): Exclude<MeasurementSource, "mixed"> {
  return source === "google-fit" ? "google_fit" : "apple_health_export";
}
