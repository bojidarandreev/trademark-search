import { NextResponse } from "next/server";
import axios, { AxiosError, AxiosInstance } from "axios";
import { cookies } from "next/headers";
import { wrapper } from "axios-cookiejar-support";
import tough from "tough-cookie";
import { Cookie } from "tough-cookie";

const INPI_API_BASE_URL = "https://api-gateway.inpi.fr";
const INPI_AUTH_URL = `${INPI_API_BASE_URL}/services/uaa/api/authenticate`;
const INPI_TOKEN_URL = `${INPI_API_BASE_URL}/services/uaa/oauth/token`;
const INPI_SEARCH_URL = `${INPI_API_BASE_URL}/services/apidiffusion/api/marques/search`;

// Cache the access token and XSRF token
let accessToken: string | null = null;
let xsrfToken: string | null = null;
let tokenExpiry: number | null = null;

// Create axios instance with cookie jar support
const cookieJar = new tough.CookieJar();
const client: AxiosInstance = wrapper(
  axios.create({
    jar: cookieJar,
    withCredentials: true,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Next.js/14.0.0",
      Origin: "https://data.inpi.fr",
      Referer: "https://data.inpi.fr/",
    },
  })
);

// Custom error class for API errors
class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: any,
    public headers?: any
  ) {
    super(message);
    this.name = "APIError";
  }
}

// Helper function to log detailed error information
function logError(context: string, error: any) {
  const errorDetails = {
    context,
    message: error.message,
    status: error.response?.status,
    statusText: error.response?.statusText,
    data: error.response?.data,
    headers: error.response?.headers,
    config: {
      url: error.config?.url,
      method: error.config?.method,
      headers: error.config?.headers,
    },
  };
  console.error(`Error in ${context}:`, JSON.stringify(errorDetails, null, 2));
}

async function getAccessToken() {
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

  // Return cached token if it's still valid (with 5-minute buffer)
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry - 5 * 60 * 1000) {
    console.log("Using cached access token");
    return accessToken;
  }

  try {
    console.log("Requesting new access token...");

    // Step 1: Make a preliminary request to establish session and hopefully get XSRF token.
    // Previously, this was INPI_AUTH_URL, but it seems to require authentication itself.
    // Trying INPI_TOKEN_URL with a GET request as it's the endpoint for the subsequent POST.
    // Alternatively, INPI_API_BASE_URL or a specific /login or /csrf endpoint might be needed.
    console.log(
      `Attempting initial GET to ${INPI_TOKEN_URL} to obtain session/XSRF token.`
    );
    try {
      await client.get(INPI_TOKEN_URL);
    } catch (error) {
      // Log this error but proceed, as the main goal is to get cookies set by this attempt,
      // even if the GET request itself doesn't return 200 (e.g., might return 405 Method Not Allowed,
      // but could still set cookies).
      logError("preliminaryGetToTokenUrl", error);
    }

    // Get cookies from jar - use INPI_TOKEN_URL as the domain for cookie retrieval
    const cookies = cookieJar.getCookiesSync(INPI_TOKEN_URL);
    const xsrfCookie = cookies.find((c: Cookie) => c.key === "XSRF-TOKEN");

    if (!xsrfCookie?.value) {
      throw new APIError("Failed to obtain CSRF token", 500, {
        cookies: cookies.map((c: Cookie) => `${c.key}=${c.value}`),
      });
    }

    xsrfToken = decodeURIComponent(xsrfCookie.value);
    console.log("Extracted XSRF token:", xsrfToken);

    // Step 2: Get OAuth token using the XSRF token
    const tokenResponse = await client.post(
      INPI_TOKEN_URL,
      new URLSearchParams({
        grant_type: "password", // Changed from client_credentials to password
        username: process.env.INPI_USERNAME!,
        password: process.env.INPI_PASSWORD!,
        scope: "openid profile email marques",
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-XSRF-TOKEN": xsrfToken,
        },
      }
    );

    console.log("Token response:", tokenResponse.data);

    if (!tokenResponse.data.access_token) {
      throw new APIError("No access token in response", 500, {
        response: tokenResponse.data,
      });
    }

    accessToken = tokenResponse.data.access_token;
    // Set token expiry based on expires_in from response (default to 1 hour if not provided)
    tokenExpiry = Date.now() + (tokenResponse.data.expires_in || 3600) * 1000;

    return accessToken;
  } catch (error: unknown) {
    logError("getAccessToken", error);

    // Clear cached tokens on error
    accessToken = null;
    xsrfToken = null;
    tokenExpiry = null;

    if (error instanceof APIError) {
      throw error;
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.error_description || error.message;

      if (status === 401) {
        throw new APIError(
          "Authentication failed: Invalid credentials",
          401,
          error.response?.data,
          error.response?.headers
        );
      } else if (status === 403) {
        throw new APIError(
          "Authentication failed: Insufficient permissions",
          403,
          error.response?.data,
          error.response?.headers
        );
      }

      throw new APIError(
        `Authentication failed: ${message}`,
        status || 500,
        error.response?.data,
        error.response?.headers
      );
    }

    throw new APIError("Unexpected error during authentication", 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");
    const page = searchParams.get("page") || "1";
    const nbResultsPerPage = searchParams.get("nbResultsPerPage") || "20";
    const sort = searchParams.get("sort") || "relevance";
    const order = searchParams.get("order") || "asc";

    if (!query) {
      return NextResponse.json(
        {
          error: "Search query is required",
          code: "MISSING_QUERY",
        },
        { status: 400 }
      );
    }

    console.log("Searching for:", query);

    // Get access token
    const token = await getAccessToken();
    console.log("Got access token, making search request...");

    try {
      const response = await axios.post(
        INPI_SEARCH_URL,
        {
          query,
          page: parseInt(page),
          nbResultsPerPage: parseInt(nbResultsPerPage),
          sort,
          order,
          type: "brands",
          advancedSearch: {},
          filter: {},
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-XSRF-TOKEN": xsrfToken || "",
          },
          withCredentials: true,
        }
      );

      console.log("Search response status:", response.status);
      console.log("Search response headers:", response.headers);

      return NextResponse.json(response.data);
    } catch (error: unknown) {
      logError("searchRequest", error);

      if (axios.isAxiosError(error)) {
        const status = error.response?.status;

        // Handle token invalidation
        if (status === 401 || status === 403) {
          console.log("Token invalid, clearing cache and retrying...");
          accessToken = null;
          xsrfToken = null;
          tokenExpiry = null;

          try {
            const newToken = await getAccessToken();

            // Retry the search with new token
            const retryResponse = await axios.post(
              INPI_SEARCH_URL,
              {
                query,
                page: parseInt(page),
                nbResultsPerPage: parseInt(nbResultsPerPage),
                sort,
                order,
                type: "brands",
                advancedSearch: {},
                filter: {},
              },
              {
                headers: {
                  Authorization: `Bearer ${newToken}`,
                  "Content-Type": "application/json",
                  Accept: "application/json",
                  "X-XSRF-TOKEN": xsrfToken || "", // Ensure xsrfToken is current if getAccessToken refreshed it
                },
                withCredentials: true,
              }
            );

            return NextResponse.json(retryResponse.data);
          } catch (retryError: unknown) {
            logError("searchRetry", retryError);
            let retryStatus = 500;
            let retryDetails: any = {
              message:
                retryError instanceof Error
                  ? retryError.message
                  : String(retryError),
            };
            let retryResponseMessage =
              "Failed to retry search after token refresh";

            if (retryError instanceof APIError) {
              retryStatus = retryError.statusCode;
              retryDetails = retryError.details || retryDetails;
              retryResponseMessage = `Failed to retry search: ${retryError.message}`;
            } else if (axios.isAxiosError(retryError)) {
              retryStatus = retryError.response?.status || 500;
              retryDetails = retryError.response?.data || retryDetails;
              retryResponseMessage = `Failed to retry search: ${retryError.message}`;
            }

            throw new APIError(retryResponseMessage, retryStatus, {
              originalError: {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data,
              },
              retryError: {
                message:
                  retryError instanceof Error
                    ? retryError.message
                    : String(retryError),
                status: retryStatus, // This is the status of the retry attempt error
                data: retryDetails,
              },
            });
          }
        }

        // Handle other API errors
        const message =
          error.response?.data?.error_description || error.message;
        throw new APIError(
          `Search failed: ${message}`,
          status || 500,
          error.response?.data,
          error.response?.headers
        );
      }

      throw new APIError("Unexpected error during search", 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } catch (error: unknown) {
    logError("searchRoute", error);

    if (error instanceof APIError) {
      return NextResponse.json(
        {
          error: error.message,
          code:
            error.statusCode === 401
              ? "UNAUTHORIZED"
              : error.statusCode === 403
              ? "FORBIDDEN"
              : "INTERNAL_ERROR",
          details: error.details,
          timestamp: new Date().toISOString(),
        },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      {
        error: "Failed to search trademarks",
        code: "INTERNAL_ERROR",
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
