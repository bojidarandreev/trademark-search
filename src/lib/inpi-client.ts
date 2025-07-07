import axios, { AxiosInstance } from "axios"; // Removed AxiosError
import { wrapper } from "axios-cookiejar-support";
import * as tough from "tough-cookie";
import { Cookie } from "tough-cookie";

// Constants from the original file that getAccessToken might need
const INPI_API_BASE_URL = "https://api-gateway.inpi.fr";
const INPI_COOKIE_SETUP_URL = `${INPI_API_BASE_URL}/login`;
const INPI_JSON_LOGIN_URL = `${INPI_API_BASE_URL}/auth/login`;

// State variables for authentication - these maintain state across calls to getAccessToken
export let accessToken: string | null = null;
export let xsrfTokenValue: string | null = null;
export let tokenExpiry: number | null = null;

// Cookie Jar and Axios Client - also stateful
export const cookieJar = new tough.CookieJar();
export const client: AxiosInstance = wrapper(
  axios.create({
    jar: cookieJar,
    withCredentials: true,
    headers: { Accept: "application/json, text/plain, */*" },
  })
);

// Custom error class for API errors
export class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown, // Changed to unknown
    public responseHeaders?: Record<string, unknown> // Changed to Record<string, unknown>
  ) {
    super(message);
    this.name = "APIError";
  }
}

// Helper function to log detailed error information
export function logError(context: string, error: unknown) {
  // Changed to unknown
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

// getAccessToken function, adapted to use exported state variables
export async function getAccessToken(): Promise<string> {
  if (!process.env.INPI_USERNAME || !process.env.INPI_PASSWORD) {
    console.error(
      "INPI_USERNAME or INPI_PASSWORD environment variables are not set."
    );
    throw new APIError(
      "Authentication configuration error: Missing credentials.",
      500,
      {
        reason:
          "INPI_USERNAME or INPI_PASSWORD environment variables are not set.",
      }
    );
  }
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry - 5 * 60 * 1000) {
    console.log("Using cached access token.");
    return accessToken;
  }

  // Reset state variables before attempting new login
  accessToken = null;
  xsrfTokenValue = null; // This will be set here
  tokenExpiry = null;

  console.log("Requesting new access token via /auth/login flow...");
  const browserUserAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
  try {
    // More explicit logging for the URL being used
    const actualCookieSetupUrl = INPI_COOKIE_SETUP_URL;
    console.log(
      `DEBUG: INPI_COOKIE_SETUP_URL constant is: ${INPI_COOKIE_SETUP_URL}`
    );
    console.log(
      `Attempting initial GET to actualCookieSetupUrl: ${actualCookieSetupUrl} to obtain session cookies.`
    );

    try {
      await client.get(actualCookieSetupUrl, {
        headers: {
          "User-Agent": browserUserAgent,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        },
      });
      console.log(`Initial GET to ${actualCookieSetupUrl} completed.`);
    } catch (error) {
      logError("initialGetToCookieSetupUrl", error);
      // If this initial GET fails, we cannot proceed to get an XSRF token from its cookies.
      // This was a bug: the original code would continue and fail later.
      throw new APIError(
        `Failed initial GET to ${actualCookieSetupUrl} to obtain session cookies. Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        500,
        { stage: "initial-cookie-setup-get", nestedError: error }
      );
    }

    const cookiesFromJar = await cookieJar.getCookies(actualCookieSetupUrl);
    const xsrfCookie = cookiesFromJar.find(
      (c: Cookie) => c.key === "XSRF-TOKEN"
    );
    if (!xsrfCookie?.value) {
      const currentCookiesDesc =
        cookiesFromJar
          .map((c) => `${c.key}=${c.value}; Path=${c.path}; Domain=${c.domain}`)
          .join("; ") || "None";
      console.error(
        `Cookies found for ${INPI_COOKIE_SETUP_URL} after GET: ${currentCookiesDesc}`
      );
      throw new APIError(
        `Failed to obtain XSRF-TOKEN cookie after GET to ${INPI_COOKIE_SETUP_URL}.`,
        500,
        { stage: "login-xsrf-cookie-extraction" }
      );
    }
    const loginXsrfToken = decodeURIComponent(xsrfCookie.value);
    console.log("Extracted XSRF-TOKEN cookie value for login:", loginXsrfToken);
    xsrfTokenValue = loginXsrfToken; // Update module-level xsrfTokenValue

    console.log(
      `Attempting POST to ${INPI_JSON_LOGIN_URL} with JSON payload and XSRF token.`
    );
    const loginResponse = await client.post(
      INPI_JSON_LOGIN_URL,
      {
        username: process.env.INPI_USERNAME!,
        password: process.env.INPI_PASSWORD!,
        rememberMe: false,
      },
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
    console.log(
      "Login POST to INPI_JSON_LOGIN_URL successful, status:",
      loginResponse.status
    );

    // Ensure access_token is a non-empty string and expires_in is handled as a number
    const responseData = loginResponse.data as {
      access_token?: unknown;
      expires_in?: unknown;
    };

    if (
      !responseData ||
      typeof responseData.access_token !== "string" ||
      !responseData.access_token
    ) {
      logError("getAccessTokenShared", {
        message: "No valid access_token string in response from /auth/login",
        responseData,
      });
      throw new APIError(
        "No valid access_token string in response from /auth/login",
        500,
        {
          responseData,
          stage: "token-extraction",
        }
      );
    }
    accessToken = responseData.access_token; // Now definitely a non-empty string

    const expiresIn =
      typeof responseData.expires_in === "number"
        ? responseData.expires_in
        : 3600;
    tokenExpiry = Date.now() + expiresIn * 1000;

    console.log("Successfully obtained access_token.");
    return accessToken; // Guaranteed to be a string here
  } catch (error: unknown) {
    // Ensure accessToken is nullified on any error before rethrowing or throwing new
    accessToken = null;
    xsrfTokenValue = null;
    tokenExpiry = null;
    logError("getAccessTokenShared", error); // Log after nullifying
    // accessToken = null; // Already done above
    xsrfTokenValue = null;
    tokenExpiry = null; // Reset on error
    if (error instanceof APIError) throw error;
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message =
        error.response?.data?.error_description ||
        error.response?.data?.error ||
        error.message;
      throw new APIError(
        `Authentication failed (shared): ${message}`,
        status || 500,
        error.response?.data,
        error.response?.headers
      );
    }
    throw new APIError(
      "Unexpected error during shared authentication process",
      500,
      { errorDetails: String(error) }
    );
  }
}

// Function to update the shared xsrfTokenValue, e.g., after metadata call
export function updateXsrfTokenValue(newTokenValue: string | null) {
  xsrfTokenValue = newTokenValue;
}

// Function to get the current shared xsrfTokenValue
export function getXsrfTokenValue(): string | null {
  return xsrfTokenValue;
}

// Function to clear shared auth state, e.g. on token invalidation
export function clearAuthCache() {
  accessToken = null;
  xsrfTokenValue = null;
  tokenExpiry = null;
  console.log("Shared authentication cache cleared.");
}
