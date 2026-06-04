import axios, { AxiosInstance } from "axios";
import { wrapper } from "axios-cookiejar-support";
import * as tough from "tough-cookie";
import { Cookie } from "tough-cookie";
import fs from "fs/promises";
import path from "path";
import os from "os";

// --- HMR-safe global cache for in-flight request promise ---
const globalWithInFlightPromise = globalThis as typeof globalThis & {
  inpiTokenPromise: Promise<string> | null;
};

if (!globalWithInFlightPromise.inpiTokenPromise) {
  globalWithInFlightPromise.inpiTokenPromise = null;
}
// --- End HMR-safe cache ---

// --- File-based cache for auth state ---
const CACHE_FILE_PATH = path.join(os.tmpdir(), "inpi-auth-cache.json");

interface AuthCache {
  accessToken: string;
  tokenExpiry: number;
  cookieJar: tough.CookieJar.Serialized;
}

async function readCache(): Promise<AuthCache | null> {
  try {
    const data = await fs.readFile(CACHE_FILE_PATH, "utf-8");
    const parsed = JSON.parse(data) as AuthCache;
    // Basic validation
    if (parsed && typeof parsed.accessToken === 'string' && typeof parsed.tokenExpiry === 'number' && parsed.cookieJar) {
      return parsed;
    }
    return null;
  } catch (error) {
    return null; // File doesn't exist or is invalid
  }
}

async function writeCache(cache: AuthCache): Promise<void> {
  try {
    await fs.writeFile(CACHE_FILE_PATH, JSON.stringify(cache), "utf-8");
  } catch (error) {
    console.error("Failed to write to INPI auth cache:", error);
  }
}
// --- End File-based cache ---

const INPI_API_BASE_URL = "https://api-gateway.inpi.fr";
const INPI_COOKIE_SETUP_URL = `${INPI_API_BASE_URL}/login`;
const INPI_JSON_LOGIN_URL = `${INPI_API_BASE_URL}/auth/login`;

// This client is initialized dynamically with the appropriate cookie jar.
export let client: AxiosInstance;

export class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown,
    public responseHeaders?: Record<string, unknown>
  ) {
    super(message);
    this.name = "APIError";
  }
}

export function logError(context: string, error: unknown) {
  const errorDetails: {
    context: string;
    message?: string;
    [key: string]: unknown;
  } = { context };
  if (error instanceof Error) {
    errorDetails.message = error.message;
  }

  if (axios.isAxiosError(error)) {
    errorDetails.status = error.response?.status;
    errorDetails.statusText = error.response?.statusText;
    errorDetails.data = error.response?.data;
    errorDetails.responseHeaders = error.response?.headers;
    errorDetails.config = {
      url: error.config?.url,
      method: error.config?.method,
      requestHeaders: error.config?.headers,
    };
  } else if (error instanceof APIError) {
    errorDetails.statusCode = error.statusCode;
    errorDetails.details = error.details;
    if (error.responseHeaders)
      errorDetails.responseHeaders = error.responseHeaders;
  } else {
    errorDetails.details = String(error);
  }
  console.error(`Error in ${context}:`, JSON.stringify(errorDetails, null, 2));
}

const performLogin = async (): Promise<string> => {
  try {
    const cookieJar = new tough.CookieJar();
    client = wrapper(
      axios.create({
        jar: cookieJar,
        withCredentials: true,
        headers: { Accept: "application/json, text/plain, */*" },
      })
    );

    if (!process.env.INPI_USERNAME || !process.env.INPI_PASSWORD) {
      throw new APIError("Authentication configuration error: Missing credentials.", 500, {
        reason: "INPI_USERNAME or INPI_PASSWORD environment variables are not set.",
      });
    }

    console.log("Requesting new access token via /auth/login flow...");
    const browserUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

    await client.get(INPI_COOKIE_SETUP_URL, {
      headers: {
        "User-Agent": browserUserAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      },
    });

    const cookiesFromJar = await cookieJar.getCookies(INPI_COOKIE_SETUP_URL);
    const xsrfCookie = cookiesFromJar.find((c: Cookie) => c.key === "XSRF-TOKEN");
    if (!xsrfCookie?.value) {
      throw new APIError(`Failed to obtain XSRF-TOKEN cookie.`, 500, { stage: "login-xsrf-cookie-extraction" });
    }
    const loginXsrfToken = decodeURIComponent(xsrfCookie.value);

    const loginResponse = await client.post(INPI_JSON_LOGIN_URL,
      { username: process.env.INPI_USERNAME!, password: process.env.INPI_PASSWORD!, rememberMe: false },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/plain, */*",
          "X-XSRF-TOKEN": loginXsrfToken,
          Origin: INPI_API_BASE_URL,
          Referer: INPI_COOKIE_SETUP_URL,
          "User-Agent": browserUserAgent,
        },
      }
    );

    const responseData = loginResponse.data as { access_token?: unknown; expires_in?: unknown };
    if (!responseData || typeof responseData.access_token !== 'string' || !responseData.access_token) {
      throw new APIError("No valid access_token string in response from /auth/login", 500, { responseData, stage: "token-extraction" });
    }

    const newAccessToken = responseData.access_token;
    const expiresIn = typeof responseData.expires_in === "number" ? responseData.expires_in : 3600;
    const newExpiry = Date.now() + expiresIn * 1000;

    await writeCache({
      accessToken: newAccessToken,
      tokenExpiry: newExpiry,
      cookieJar: cookieJar.toJSON(),
    });

    console.log("Successfully obtained and cached access_token.");
    return newAccessToken;
  } catch (error) {
    await clearAuthCache();
    logError("getAccessTokenShared", error);
    if (error instanceof APIError) throw error;
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.error_description || error.response?.data?.error || error.message;
      throw new APIError(`Authentication failed (shared): ${message}`, status || 500, error.response?.data, error.response?.headers);
    }
    throw new APIError("Unexpected error during shared authentication process", 500, { errorDetails: String(error) });
  } finally {
    globalWithInFlightPromise.inpiTokenPromise = null;
  }
};

export const getAccessToken = async (): Promise<string> => {
  const cachedState = await readCache();

  if (cachedState && Date.now() < cachedState.tokenExpiry - 5 * 60 * 1000) {
    console.log("Using file-cached access token.");
    const cookieJar = tough.CookieJar.fromJSON(JSON.stringify(cachedState.cookieJar));
    client = wrapper(axios.create({ jar: cookieJar, withCredentials: true }));
    return cachedState.accessToken;
  }

  if (globalWithInFlightPromise.inpiTokenPromise) {
    console.log("Waiting for in-flight access token request.");
    return globalWithInFlightPromise.inpiTokenPromise;
  }

  globalWithInFlightPromise.inpiTokenPromise = performLogin();
  return globalWithInFlightPromise.inpiTokenPromise;
};


export async function clearAuthCache() {
  try {
    await fs.unlink(CACHE_FILE_PATH);
    console.log("Shared authentication file cache cleared.");
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      console.error("Error clearing auth cache file:", error);
    }
  }
}

// These XSRF functions are likely no longer needed as the cookie jar is now
// managed alongside the token in the file cache. They are kept for now to avoid
// breaking other parts of the application that might still use them.
let xsrfTokenValue: string | null = null;
export function updateXsrfTokenValue(newTokenValue: string | null) {
    xsrfTokenValue = newTokenValue;
}
export function getXsrfTokenValue(): string | null {
    return xsrfTokenValue;
}
