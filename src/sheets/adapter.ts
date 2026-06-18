import { google } from "googleapis";
import { DateTime } from "luxon";

import type { GoogleSheetsAuthConfig } from "../config/index.js";
import { createGoogleSheetsAuth } from "../auth/index.js";
import type {
  LatestMeasurementSet,
  MeasurementPeriod,
} from "../domain/index.js";

interface Logger {
  log(message: string): void;
  error(message: string): void;
}

export type SheetMeasurementField =
  | "weight"
  | "temperature"
  | "systolicBP"
  | "diastolicBP"
  | "heartRate";

export interface SheetColumnMapping {
  readonly dateColumnIndex: number;
  readonly periods: Record<
    MeasurementPeriod,
    Partial<Record<SheetMeasurementField, number>>
  >;
}

export interface UpdateSpreadsheetMeasurementsOptions {
  readonly config: GoogleSheetsAuthConfig;
  readonly latestSet: LatestMeasurementSet;
  readonly timeZone: string;
  readonly logger?: Logger;
}

export async function updateSpreadsheetMeasurements({
  config,
  latestSet,
  timeZone,
  logger = console,
}: UpdateSpreadsheetMeasurementsOptions): Promise<boolean> {
  const auth = await createGoogleSheetsAuth(config);
  const sheets = google.sheets({ version: "v4", auth });
  const sheetName = quoteSheetName(config.sheetName);

  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${sheetName}!1:1`,
  });
  const headerRow = headerResponse.data.values?.[0] ?? [];
  const mapping = buildSheetColumnMapping(headerRow);

  const dateColumn = columnIndexToA1(mapping.dateColumnIndex);
  const dateColumnResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${sheetName}!${dateColumn}:${dateColumn}`,
  });
  const targetDate = DateTime.fromISO(latestSet.capturedAt, {
    zone: "utc",
  }).setZone(timeZone);
  const rowNumber = findTodayRowNumber(
    dateColumnResponse.data.values ?? [],
    targetDate,
  );

  if (!rowNumber) {
    logger.error(
      `No row found in ${config.sheetName} for ${targetDate.toFormat("yyyy-MM-dd")}. Nothing was written.`,
    );
    return false;
  }

  const data = buildMeasurementUpdateData({
    sheetName: config.sheetName,
    rowNumber,
    latestSet,
    mapping,
  });

  if (data.length === 0) {
    logger.log("No defined measurement values matched sheet columns. Nothing was written.");
    return false;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data,
    },
  });

  logger.log(
    `Updated ${data.length} ${latestSet.period} measurement cell(s) in row ${rowNumber}.`,
  );
  return true;
}

export function buildSheetColumnMapping(
  headerRow: readonly unknown[],
): SheetColumnMapping {
  const normalizedHeaders = headerRow.map(normalizeHeader);
  const dateColumnIndex = normalizedHeaders.findIndex((header) => header === "月日");

  if (dateColumnIndex === -1) {
    throw new Error('Sheet header must contain a "月日" column.');
  }

  const mapping: SheetColumnMapping = {
    dateColumnIndex,
    periods: {
      morning: {},
      evening: {},
    },
  };

  for (const [index, header] of normalizedHeaders.entries()) {
    if (header.startsWith("朝")) {
      const field = detectMeasurementField(header.slice(1));
      if (field) {
        mapping.periods.morning[field] = index;
      }
    }

    if (header.startsWith("夜")) {
      const field = detectMeasurementField(header.slice(1));
      if (field) {
        mapping.periods.evening[field] = index;
      }
    }
  }

  return mapping;
}

export function findTodayRowNumber(
  dateColumnValues: readonly (readonly unknown[])[],
  targetDate: DateTime,
): number | undefined {
  for (const [index, row] of dateColumnValues.entries()) {
    if (index === 0) {
      continue;
    }

    if (doesSheetDateMatch(row[0], targetDate)) {
      return index + 1;
    }
  }

  return undefined;
}

export function buildMeasurementUpdateData({
  sheetName,
  rowNumber,
  latestSet,
  mapping,
}: {
  readonly sheetName: string;
  readonly rowNumber: number;
  readonly latestSet: LatestMeasurementSet;
  readonly mapping: SheetColumnMapping;
}): Array<{ range: string; values: unknown[][] }> {
  const periodColumns = mapping.periods[latestSet.period];
  const valuesByField = new Map<SheetMeasurementField, number>();
  setDefinedValue(valuesByField, "weight", latestSet.weightKg);
  setDefinedValue(
    valuesByField,
    "temperature",
    latestSet.bodyTemperatureCelsius,
  );
  setDefinedValue(
    valuesByField,
    "systolicBP",
    latestSet.bloodPressureSystolicMmHg,
  );
  setDefinedValue(
    valuesByField,
    "diastolicBP",
    latestSet.bloodPressureDiastolicMmHg,
  );
  setDefinedValue(valuesByField, "heartRate", latestSet.pulseBpm);
  const data: Array<{ range: string; values: unknown[][] }> = [];

  for (const field of sheetMeasurementFields) {
    const value = valuesByField.get(field);
    const columnIndex = periodColumns[field];
    if (value === undefined || columnIndex === undefined) {
      continue;
    }

    data.push({
      range: `${quoteSheetName(sheetName)}!${columnIndexToA1(columnIndex)}${rowNumber}`,
      values: [[value]],
    });
  }

  return data;
}

export function doesSheetDateMatch(
  value: unknown,
  targetDate: DateTime,
): boolean {
  const parsed = parseSheetDate(value, targetDate);
  return parsed?.hasSame(targetDate, "day") ?? false;
}

export function parseSheetDate(
  value: unknown,
  targetDate: DateTime,
): DateTime | undefined {
  const text = String(value ?? "").trim();
  const zone = targetDate.zoneName ?? "UTC";
  if (text.length === 0) {
    return undefined;
  }

  const yearMonthDay = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  if (yearMonthDay) {
    return dateFromParts(
      Number(yearMonthDay[1]),
      Number(yearMonthDay[2]),
      Number(yearMonthDay[3]),
      zone,
    );
  }

  const monthDay =
    /^(\d{1,2})\/(\d{1,2})$/.exec(text) ??
    /^(\d{1,2})月(\d{1,2})日?$/.exec(text);
  if (monthDay) {
    return dateFromParts(
      targetDate.year,
      Number(monthDay[1]),
      Number(monthDay[2]),
      zone,
    );
  }

  return undefined;
}

export function columnIndexToA1(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("Column index must be a non-negative integer.");
  }

  let column = "";
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    value = Math.floor((value - 1) / 26);
  }

  return column;
}

const sheetMeasurementFields = [
  "weight",
  "temperature",
  "systolicBP",
  "diastolicBP",
  "heartRate",
] as const satisfies readonly SheetMeasurementField[];

function setDefinedValue(
  valuesByField: Map<SheetMeasurementField, number>,
  field: SheetMeasurementField,
  value: number | undefined,
): void {
  if (value !== undefined) {
    valuesByField.set(field, value);
  }
}

function detectMeasurementField(
  header: string,
): SheetMeasurementField | undefined {
  if (header.includes("体重")) {
    return "weight";
  }

  if (header.includes("体温")) {
    return "temperature";
  }

  if (header.includes("血圧上") || header.includes("血圧(上)")) {
    return "systolicBP";
  }

  if (header.includes("血圧下") || header.includes("血圧(下)")) {
    return "diastolicBP";
  }

  if (header.includes("脈拍")) {
    return "heartRate";
  }

  return undefined;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "").replaceAll(/\s/g, "").trim();
}

function dateFromParts(
  year: number,
  month: number,
  day: number,
  zone: string,
): DateTime | undefined {
  const date = DateTime.fromObject({ year, month, day }, { zone });
  return date.isValid ? date : undefined;
}

function quoteSheetName(sheetName: string): string {
  return `'${sheetName.replaceAll("'", "''")}'`;
}
