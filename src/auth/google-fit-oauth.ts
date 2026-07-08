import { createServer } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { URL } from "node:url";

import { Auth, google } from "googleapis";

import type { GoogleFitAuthConfig } from "../config/index.js";

export type GoogleFitOAuthClient = InstanceType<typeof google.auth.OAuth2>;

export const googleFitScopes = [
  "https://www.googleapis.com/auth/fitness.body.read",
  "https://www.googleapis.com/auth/fitness.blood_pressure.read",
  "https://www.googleapis.com/auth/fitness.heart_rate.read",
] as const;

export function createGoogleFitOAuthClient(
  config: GoogleFitAuthConfig,
): GoogleFitOAuthClient {
  return new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  );
}

export async function loadGoogleFitOAuthClient(
  config: GoogleFitAuthConfig,
): Promise<GoogleFitOAuthClient> {
  const client = createGoogleFitOAuthClient(config);
  const tokenText = await readFile(config.tokenPath, "utf8");
  client.setCredentials(JSON.parse(tokenText));
  return client;
}

export interface RunGoogleFitAuthOptions {
  readonly logger?: Pick<Console, "log" | "error">;
}

export async function runGoogleFitAuthFlow(
  config: GoogleFitAuthConfig,
  options: RunGoogleFitAuthOptions = {},
): Promise<void> {
  const logger = options.logger ?? console;
  const oauthClient = createGoogleFitOAuthClient(config);
  const redirectUrl = new URL(config.redirectUri);

  if (!["localhost", "127.0.0.1"].includes(redirectUrl.hostname)) {
    throw new Error(
      "GOOGLE_FIT_REDIRECT_URI must use localhost or 127.0.0.1 for CLI auth.",
    );
  }

  const state = randomUUID();
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const authUrl = oauthClient.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [...googleFitScopes],
    state,
    code_challenge: codeChallenge,
    code_challenge_method: Auth.CodeChallengeMethod.S256,
  });

  await new Promise<void>((resolve, reject) => {
    const server = createServer(async (request, response) => {
      try {
        if (!request.url) {
          response.writeHead(400);
          response.end("Missing URL.");
          return;
        }

        const requestUrl = new URL(request.url, config.redirectUri);
        if (requestUrl.pathname !== redirectUrl.pathname) {
          response.writeHead(404);
          response.end("Not found.");
          return;
        }

        if (requestUrl.searchParams.get("state") !== state) {
          response.writeHead(400);
          response.end("Invalid state.");
          return;
        }

        const code = requestUrl.searchParams.get("code");
        if (!code) {
          response.writeHead(400);
          response.end("Missing authorization code.");
          return;
        }

        const tokenResponse = await oauthClient.getToken({
          code,
          codeVerifier,
        });
        await mkdir(dirname(config.tokenPath), { recursive: true });
        await writeFile(
          config.tokenPath,
          JSON.stringify(tokenResponse.tokens, null, 2),
          { encoding: "utf8", mode: 0o600 },
        );

        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end("Google Fit authorization completed. You can close this tab.");
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      } catch (error) {
        response.writeHead(500);
        response.end("Authorization failed.");
        server.close(() => reject(error));
      }
    });

    server.on("error", reject);
    server.listen(Number(redirectUrl.port || 80), redirectUrl.hostname, () => {
      logger.log("Open this URL in your browser to authorize Google Fit:");
      logger.log(authUrl);
      logger.log(`Waiting for callback on ${config.redirectUri}`);
    });
  });

  logger.log(`Saved Google Fit token to ${config.tokenPath}`);
}
