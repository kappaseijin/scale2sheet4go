import { google } from "googleapis";
import type { fitness_v1 } from "googleapis";

import type { GoogleFitAuthConfig } from "../../config/index.js";
import type {
  MeasurementKind,
  MeasurementReading,
  MeasurementUnit,
} from "../../domain/index.js";
import { loadGoogleFitOAuthClient } from "../../auth/index.js";
import type { GoogleFitOAuthClient } from "../../auth/index.js";

interface GoogleFitQuery {
  readonly dataTypeName: string;
  readonly optional?: boolean;
  extractReadings(point: fitness_v1.Schema$DataPoint): MeasurementReading[];
}

const googleFitQueries: readonly GoogleFitQuery[] = [
  {
    dataTypeName: "com.google.weight",
    extractReadings: (point) =>
      singleValueReading(point, "weight", "kg", point.value?.[0]),
  },
  {
    dataTypeName: "com.google.body.temperature",
    optional: true,
    extractReadings: (point) =>
      singleValueReading(
        point,
        "body_temperature",
        "celsius",
        point.value?.[0],
      ),
  },
  {
    dataTypeName: "com.google.blood_pressure",
    extractReadings: (point) => [
      ...singleValueReading(
        point,
        "blood_pressure_systolic",
        "mmHg",
        point.value?.[0],
      ),
      ...singleValueReading(
        point,
        "blood_pressure_diastolic",
        "mmHg",
        point.value?.[1],
      ),
    ],
  },
  {
    dataTypeName: "com.google.heart_rate.bpm",
    extractReadings: (point) =>
      singleValueReading(point, "pulse", "bpm", point.value?.[0]),
  },
];

export async function readGoogleFitLatestMeasurements(
  config: GoogleFitAuthConfig,
  referenceTime: Date = new Date(),
): Promise<MeasurementReading[]> {
  return latestByKind(await readGoogleFitMeasurements(config, referenceTime));
}

export async function readGoogleFitMeasurements(
  config: GoogleFitAuthConfig,
  referenceTime: Date = new Date(),
): Promise<MeasurementReading[]> {
  const auth = await loadGoogleFitOAuthClient(config);
  return readGoogleFitMeasurementsWithAuth(config, auth, referenceTime);
}

export async function readGoogleFitLatestMeasurementsWithAuth(
  config: Pick<GoogleFitAuthConfig, "lookbackDays">,
  auth: GoogleFitOAuthClient,
  referenceTime: Date = new Date(),
): Promise<MeasurementReading[]> {
  return latestByKind(
    await readGoogleFitMeasurementsWithAuth(config, auth, referenceTime),
  );
}

export async function readGoogleFitMeasurementsWithAuth(
  config: Pick<GoogleFitAuthConfig, "lookbackDays">,
  auth: GoogleFitOAuthClient,
  referenceTime: Date = new Date(),
): Promise<MeasurementReading[]> {
  const fitness = google.fitness({ version: "v1", auth });
  const endTimeMillis = referenceTime.getTime();
  const startTimeMillis =
    endTimeMillis - config.lookbackDays * 24 * 60 * 60 * 1000;
  const readings: MeasurementReading[] = [];

  for (const query of googleFitQueries) {
    try {
      const points = await readDataPointsForDataType(
        fitness,
        query.dataTypeName,
        startTimeMillis,
        endTimeMillis,
      );
      const sortedPoints = points
        .filter((point) => point.value?.length)
        .sort((left, right) => toMillis(left) - toMillis(right));

      for (const point of sortedPoints) {
        readings.push(...query.extractReadings(point));
      }
    } catch (error) {
      if (query.optional && isGoogleFitMissingDataTypeError(error)) {
        continue;
      }

      throw error;
    }
  }

  return readings;
}

function latestByKind(
  readings: readonly MeasurementReading[],
): MeasurementReading[] {
  const latestByKind = new Map<MeasurementKind, MeasurementReading>();

  for (const reading of readings) {
    const current = latestByKind.get(reading.kind);
    if (
      !current ||
      Date.parse(reading.measuredAt) > Date.parse(current.measuredAt)
    ) {
      latestByKind.set(reading.kind, reading);
    }
  }

  return [...latestByKind.values()];
}

async function readDataPointsForDataType(
  fitness: fitness_v1.Fitness,
  dataTypeName: string,
  startTimeMillis: number,
  endTimeMillis: number,
): Promise<fitness_v1.Schema$DataPoint[]> {
  const dataSourcesResponse = await fitness.users.dataSources.list({
    userId: "me",
    dataTypeName: [dataTypeName],
  });
  const dataSources = dataSourcesResponse.data.dataSource ?? [];
  const datasetId = `${startTimeMillis * 1_000_000}-${endTimeMillis * 1_000_000}`;
  const points: fitness_v1.Schema$DataPoint[] = [];

  for (const dataSource of dataSources) {
    if (!dataSource.dataStreamId) {
      continue;
    }

    let pageToken: string | undefined;
    do {
      const params: fitness_v1.Params$Resource$Users$Datasources$Datasets$Get =
        {
          userId: "me",
          dataSourceId: dataSource.dataStreamId,
          datasetId,
          limit: 1000,
        };
      if (pageToken) {
        params.pageToken = pageToken;
      }
      const response = await fitness.users.dataSources.datasets.get(params);
      points.push(...(response.data.point ?? []));
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  return points;
}

function singleValueReading(
  point: fitness_v1.Schema$DataPoint,
  kind: MeasurementKind,
  unit: MeasurementUnit,
  value: fitness_v1.Schema$Value | undefined,
): MeasurementReading[] {
  const numberValue = readGoogleFitNumber(value);
  const measuredAt = new Date(toMillis(point)).toISOString();

  return numberValue === undefined
    ? []
    : [
        {
          kind,
          value: numberValue,
          unit,
          measuredAt,
          source: "google_fit",
          ...stringField("sourceRecordId", point.originDataSourceId),
        },
      ];
}

function stringField<Key extends string>(
  key: Key,
  value: string | null | undefined,
): Partial<Record<Key, string>> {
  return value ? ({ [key]: value } as Record<Key, string>) : {};
}

function readGoogleFitNumber(
  value: fitness_v1.Schema$Value | undefined,
): number | undefined {
  const numberValue = value?.fpVal ?? value?.intVal;
  return typeof numberValue === "number" && Number.isFinite(numberValue)
    ? numberValue
    : undefined;
}

function toMillis(point: fitness_v1.Schema$DataPoint): number {
  const nanos = point.endTimeNanos ?? point.startTimeNanos;
  if (!nanos) {
    return 0;
  }

  return Math.trunc(Number(nanos) / 1_000_000);
}

function isGoogleFitMissingDataTypeError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  const code = (error as { readonly code?: unknown }).code;
  return code === 400 || code === 404;
}
