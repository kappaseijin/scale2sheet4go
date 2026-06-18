import { google } from "googleapis";

import type { GoogleSheetsAuthConfig } from "../config/index.js";

export const googleSheetsScopes = [
  "https://www.googleapis.com/auth/spreadsheets",
] as const;

export async function createGoogleSheetsAuth(
  config: GoogleSheetsAuthConfig,
): Promise<InstanceType<typeof google.auth.GoogleAuth>> {
  return new google.auth.GoogleAuth({
    keyFile: config.applicationCredentialsPath,
    scopes: [...googleSheetsScopes],
  });
}
