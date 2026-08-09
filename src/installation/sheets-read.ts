import { DateTime } from "luxon";
import { google } from "googleapis";

import type { GoogleSheetsAuthConfig } from "../config/index.js";
import { createGoogleSheetsAuth } from "../auth/index.js";

/**
 * design INSTALLATION_DESIGN.md §モジュール境界: the only Google Sheets
 * access `doctor.ts` is allowed. It has no cell-update, row-append, or
 * sheet-creation method — that omission from the type is the read-only
 * guarantee (plan §5 N-1). Deliberately does not extend or wrap
 * `src/sheets/adapter.ts`, which exposes write methods.
 */
export interface SheetsReadPort {
  authenticate(): Promise<void>;
  readHeaderRow(): Promise<readonly unknown[]>;
  findTodayRow(dateColumnIndex: number, today: DateTime): Promise<number | undefined>;
}

function quoteSheetName(sheetName: string): string {
  return `'${sheetName.replaceAll("'", "''")}'`;
}

function columnIndexToA1(index: number): string {
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

function parseSheetDate(value: unknown, targetDate: DateTime): DateTime | undefined {
  const text = String(value ?? "").trim();
  const zone = targetDate.zoneName ?? "UTC";
  if (text.length === 0) {
    return undefined;
  }

  const yearMonthDay = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  if (yearMonthDay) {
    return DateTime.fromObject(
      { year: Number(yearMonthDay[1]), month: Number(yearMonthDay[2]), day: Number(yearMonthDay[3]) },
      { zone },
    );
  }

  const monthDay =
    /^(\d{1,2})\/(\d{1,2})$/.exec(text) ??
    /^(\d{1,2})月(\d{1,2})日?$/.exec(text);
  if (monthDay) {
    return DateTime.fromObject(
      { year: targetDate.year, month: Number(monthDay[1]), day: Number(monthDay[2]) },
      { zone },
    );
  }

  return undefined;
}

/**
 * Pure, read-only lookup — no network access. Row 1 is treated as the
 * header and skipped; the return value is a 1-indexed sheet row number,
 * matching how `sheets/adapter.ts`'s own date-column search behaves, so
 * `doctor` reports against the same row the pipeline would transfer to.
 */
export function findTodayRowNumber(
  dateColumnValues: readonly (readonly unknown[])[],
  targetDate: DateTime,
): number | undefined {
  for (const [index, row] of dateColumnValues.entries()) {
    if (index === 0) {
      continue;
    }
    const parsed = parseSheetDate(row[0], targetDate);
    if (parsed?.hasSame(targetDate, "day")) {
      return index + 1;
    }
  }
  return undefined;
}

/** Production adapter: `googleapis` Sheets client, values.get only. */
export class GoogleSheetsReadAdapter implements SheetsReadPort {
  private sheetsClient: ReturnType<typeof google.sheets> | undefined;

  constructor(private readonly config: GoogleSheetsAuthConfig) {}

  async authenticate(): Promise<void> {
    const auth = await createGoogleSheetsAuth(this.config);
    this.sheetsClient = google.sheets({ version: "v4", auth });
  }

  private requireClient(): ReturnType<typeof google.sheets> {
    if (!this.sheetsClient) {
      throw new Error("SheetsReadPort: authenticate() must be called before reading");
    }
    return this.sheetsClient;
  }

  async readHeaderRow(): Promise<readonly unknown[]> {
    const response = await this.requireClient().spreadsheets.values.get({
      spreadsheetId: this.config.spreadsheetId,
      range: `${quoteSheetName(this.config.sheetName)}!1:1`,
    });
    return response.data.values?.[0] ?? [];
  }

  async findTodayRow(dateColumnIndex: number, today: DateTime): Promise<number | undefined> {
    const column = columnIndexToA1(dateColumnIndex);
    const response = await this.requireClient().spreadsheets.values.get({
      spreadsheetId: this.config.spreadsheetId,
      range: `${quoteSheetName(this.config.sheetName)}!${column}:${column}`,
    });
    return findTodayRowNumber(response.data.values ?? [], today);
  }
}
