import { google } from "googleapis";

import type { GoogleSheetsAuthConfig } from "../config/index.js";
import { createGoogleSheetsAuth } from "../auth/index.js";
import type { SpreadsheetRow } from "../domain/index.js";
import { spreadsheetColumns } from "../domain/index.js";

export async function appendSpreadsheetRow(
  config: GoogleSheetsAuthConfig,
  row: SpreadsheetRow,
): Promise<void> {
  const auth = await createGoogleSheetsAuth(config);
  const sheets = google.sheets({ version: "v4", auth });
  const sheetName = quoteSheetName(config.sheetName);

  await ensureHeaderRow(config);

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: `${sheetName}!A:I`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [spreadsheetRowToValues(row)],
    },
  });
}

export async function ensureHeaderRow(
  config: GoogleSheetsAuthConfig,
): Promise<void> {
  const auth = await createGoogleSheetsAuth(config);
  const sheets = google.sheets({ version: "v4", auth });
  const sheetName = quoteSheetName(config.sheetName);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${sheetName}!A1:I1`,
  });

  const existing = response.data.values?.[0] ?? [];
  if (spreadsheetColumns.every((column, index) => existing[index] === column)) {
    return;
  }

  if (existing.length > 0) {
    throw new Error(
      `Header row already exists in ${config.sheetName} but does not match scale2sheet columns.`,
    );
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.spreadsheetId,
    range: `${sheetName}!A1:I1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[...spreadsheetColumns]],
    },
  });
}

export function spreadsheetRowToValues(row: SpreadsheetRow): unknown[] {
  return [
    row.date,
    row.time,
    row.periodLabel,
    row.weightKg,
    row.bodyTemperatureCelsius,
    row.bloodPressureSystolicMmHg,
    row.bloodPressureDiastolicMmHg,
    row.pulseBpm,
    row.source,
  ];
}

function quoteSheetName(sheetName: string): string {
  return `'${sheetName.replaceAll("'", "''")}'`;
}
