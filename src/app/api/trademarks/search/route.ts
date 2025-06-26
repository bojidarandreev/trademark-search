import { NextResponse } from "next/server";
import axios, { AxiosError, AxiosInstance } from "axios";
// import { cookies } from "next/headers"; // Not used directly for client-side calls by server
import { wrapper } from "axios-cookiejar-support";
import tough from "tough-cookie";
import { Cookie } from "tough-cookie";

const INPI_API_BASE_URL = "https://api-gateway.inpi.fr";
const INPI_COOKIE_SETUP_URL = `${INPI_API_BASE_URL}/login`;
const INPI_JSON_LOGIN_URL = `${INPI_API_BASE_URL}/auth/login`;
const INPI_SEARCH_URL = `${INPI_API_BASE_URL}/services/apidiffusion/api/marques/search`;

let accessToken: string | null = null;
let xsrfTokenValue: string | null = null;
let tokenExpiry: number | null = null;

const cookieJar = new tough.CookieJar();
const client: AxiosInstance = wrapper(
  axios.create({
    jar: cookieJar,
    withCredentials: true,
    headers: {
      Accept: "application/json, text/plain, */*",
    },
  })
);

class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: any,
    public responseHeaders?: any
  ) {
    super(message);
    this.name = "APIError";
  }
}

function logError(context: string, error: any) {
  const errorDetails: any = { context, message: error.message };
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

async function getAccessToken(): Promise<string> {
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
    console.log("Using cached access token and XSRF token value");
    return accessToken;
  }

  accessToken = null;
  xsrfTokenValue = null;
  tokenExpiry = null;
  console.log("Requesting new access token via /auth/login flow...");
  const browserUserAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

  try {
    console.log(
      `Attempting initial GET to ${INPI_COOKIE_SETUP_URL} to obtain session cookies.`
    );
    try {
      await client.get(INPI_COOKIE_SETUP_URL, {
        headers: {
          "User-Agent": browserUserAgent,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        },
      });
      console.log(`Initial GET to ${INPI_COOKIE_SETUP_URL} completed.`);
    } catch (error) {
      logError("initialGetToCookieSetupUrl", error);
    }

    const cookiesFromJar = await cookieJar.getCookies(INPI_COOKIE_SETUP_URL);
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
        {
          stage: "xsrf-cookie-extraction",
          retrievedCookiesCount: cookiesFromJar.length,
        }
      );
    }
    xsrfTokenValue = decodeURIComponent(xsrfCookie.value);
    console.log("Extracted XSRF-TOKEN cookie value:", xsrfTokenValue);

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
          "X-XSRF-TOKEN": xsrfTokenValue,
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

    if (!loginResponse.data || !loginResponse.data.access_token) {
      throw new APIError("No access_token in response from /auth/login", 500, {
        responseData: loginResponse.data,
        stage: "token-extraction",
      });
    }
    accessToken = loginResponse.data.access_token;
    tokenExpiry = Date.now() + (loginResponse.data.expires_in || 3600) * 1000;
    console.log("Successfully obtained access_token.");
    return accessToken;
  } catch (error: unknown) {
    logError("getAccessToken", error);
    accessToken = null;
    xsrfTokenValue = null;
    tokenExpiry = null;
    if (error instanceof APIError) throw error;
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message =
        error.response?.data?.error_description ||
        error.response?.data?.error ||
        error.message;
      throw new APIError(
        `Authentication failed: ${message}`,
        status || 500,
        error.response?.data,
        error.response?.headers
      );
    }
    throw new APIError("Unexpected error during authentication process", 500, {
      errorDetails: String(error),
    });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const queryFromUser = searchParams.get("q");
    const pageFromUser = searchParams.get("page") || "1";
    const nbResultsPerPageFromUser =
      searchParams.get("nbResultsPerPage") || "20";
    const sortFromUser = searchParams.get("sort") || "relevance"; // Default sort field
    const orderFromUser = searchParams.get("order") || "asc"; // Default sort order

    if (!queryFromUser) {
      return NextResponse.json(
        { error: "Search query is required", code: "MISSING_QUERY" },
        { status: 400 }
      );
    }

    console.log("User query:", queryFromUser);
    const token = await getAccessToken();
    console.log("Got access token, preparing search request...");

    // Construct the search payload according to TrademarkQuery schema from Swagger
    const parsedPage = parseInt(pageFromUser);
    const parsedNbResultsPerPage = parseInt(nbResultsPerPageFromUser);

    const searchPayload = {
      query: `[Mark=${queryFromUser}]`, // Basic SolR query syntax
      position: (parsedPage - 1) * parsedNbResultsPerPage,
      size: parsedNbResultsPerPage,
      sortList: [`${sortFromUser} ${orderFromUser}`],
      collections: ["FR", "EU", "WO"], // Default collections
      fields: [
        // Default fields to retrieve
        "ApplicationNumber",
        "Mark",
        "MarkCurrentStatusCode",
        "DEPOSANT",
        "AGENT_NAME", // Applicant and Representative
        "ukey",
        "PublicationDate",
        "RegistrationDate",
        "ExpiryDate",
        "NiceClassDetails",
        "MarkImageFilename", // Nice classes and image filename
      ],
      withFacets: false, // Optional: set to true if you want facet data
      // facetsList: [], // Optional: specify facets if withFacets is true
      // withCTMRevendication: false, // Optional
    };
    console.log(
      "Constructed search payload:",
      JSON.stringify(searchPayload, null, 2)
    );

    try {
      const response = await client.post(INPI_SEARCH_URL, searchPayload, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-XSRF-TOKEN": xsrfTokenValue || "",
          "User-Agent": "Next.js Trademark Search App/1.0",
        },
      });
      console.log("Search response status:", response.status);
      return NextResponse.json(response.data);
    } catch (error: unknown) {
      logError("searchRequest", error);
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 401 || error.response?.status === 403)
      ) {
        console.log(
          "Access token invalid for search, clearing cache and retrying search once..."
        );
        accessToken = null;
        xsrfTokenValue = null;
        tokenExpiry = null;
        try {
          const newToken = await getAccessToken();
          // Reconstruct payload for retry, as local vars might be out of scope/changed
          const retrySearchPayload = {
            query: `[Mark=${queryFromUser}]`,
            position: (parsedPage - 1) * parsedNbResultsPerPage,
            size: parsedNbResultsPerPage,
            sortList: [`${sortFromUser} ${orderFromUser}`],
            collections: ["FR", "EU", "WO"],
            fields: [
              "ApplicationNumber",
              "Mark",
              "MarkCurrentStatusCode",
              "DEPOSANT",
              "AGENT_NAME",
              "ukey",
              "PublicationDate",
              "RegistrationDate",
              "ExpiryDate",
              "NiceClassDetails",
              "MarkImageFilename",
            ],
            withFacets: false,
          };
          const retryResponse = await client.post(
            INPI_SEARCH_URL,
            retrySearchPayload,
            {
              headers: {
                Authorization: `Bearer ${newToken}`,
                "Content-Type": "application/json",
                Accept: "application/json",
                "X-XSRF-TOKEN": xsrfTokenValue || "",
                "User-Agent": "Next.js Trademark Search App/1.0",
              },
            }
          );
          console.log("Search retry successful.");
          return NextResponse.json(retryResponse.data);
        } catch (retryError: unknown) {
          logError("searchRetry", retryError);
          let rStatus = 500;
          let rDetails: any = {};
          if (retryError instanceof APIError) {
            rStatus = retryError.statusCode;
            rDetails = retryError.details;
          } else if (axios.isAxiosError(retryError)) {
            rStatus = retryError.response?.status || 500;
            rDetails = retryError.response?.data;
          }
          throw new APIError(
            `Failed to retry search: ${
              retryError instanceof Error
                ? retryError.message
                : String(retryError)
            }`,
            rStatus,
            {
              originalSearchError: { message: (error as Error).message },
              retryAttemptError: { data: rDetails },
            }
          );
        }
      }
      if (axios.isAxiosError(error))
        throw new APIError(
          `Search failed: ${error.response?.data || error.message}`,
          error.response?.status || 500,
          error.response?.data,
          error.response?.headers
        );
      throw new APIError("Unexpected error during search", 500, {
        errorDetails: String(error),
      });
    }
  } catch (error: unknown) {
    logError("searchRouteHandler", error);
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
        error: "An unexpected internal error occurred.",
        code: "INTERNAL_ERROR",
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
