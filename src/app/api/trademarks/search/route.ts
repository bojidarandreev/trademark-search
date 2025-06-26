import { NextResponse } from "next/server";
import axios, { AxiosError, AxiosInstance } from "axios";
import { wrapper } from "axios-cookiejar-support";
import tough from "tough-cookie";
import { Cookie } from "tough-cookie";

const INPI_API_BASE_URL = "https://api-gateway.inpi.fr";
const INPI_COOKIE_SETUP_URL = `${INPI_API_BASE_URL}/login`;
const INPI_JSON_LOGIN_URL = `${INPI_API_BASE_URL}/auth/login`;
const INPI_SEARCH_URL = `${INPI_API_BASE_URL}/services/apidiffusion/api/marques/search`;
const INPI_MARQUES_METADATA_URL = `${INPI_API_BASE_URL}/services/apidiffusion/api/marques/metadata`;

let accessToken: string | null = null;
let xsrfTokenValue: string | null = null;
let tokenExpiry: number | null = null;

const cookieJar = new tough.CookieJar();
const client: AxiosInstance = wrapper(
  axios.create({
    jar: cookieJar,
    withCredentials: true,
    headers: { Accept: "application/json, text/plain, */*" },
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
        { stage: "login-xsrf-cookie-extraction" }
      );
    }
    const loginXsrfToken = decodeURIComponent(xsrfCookie.value);
    console.log("Extracted XSRF-TOKEN cookie value for login:", loginXsrfToken);
    xsrfTokenValue = loginXsrfToken;

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

async function performSearch(
  bearerToken: string,
  searchPayload: any
): Promise<any> {
  let currentSearchXsrfToken = xsrfTokenValue;
  console.log(
    `Attempting preliminary GET to ${INPI_MARQUES_METADATA_URL} for search-specific XSRF token.`
  );
  try {
    await client.get(INPI_MARQUES_METADATA_URL, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: "application/json",
      },
    });
    console.log(`Preliminary GET to ${INPI_MARQUES_METADATA_URL} completed.`);
    const cookiesForSearch = await cookieJar.getCookies(
      INPI_MARQUES_METADATA_URL
    );
    const specificSearchXsrfCookie = cookiesForSearch.find(
      (c) => c.key === "XSRF-TOKEN"
    );
    if (specificSearchXsrfCookie?.value) {
      currentSearchXsrfToken = decodeURIComponent(
        specificSearchXsrfCookie.value
      );
      console.log(
        "Updated XSRF-TOKEN value after metadata call for search:",
        currentSearchXsrfToken
      );
    } else {
      console.warn(
        `No new XSRF-TOKEN found from metadata call. Using previous XSRF: ${currentSearchXsrfToken}`
      );
    }
  } catch (metaError) {
    logError("preliminaryGetToMetadataForSearch", metaError);
    console.warn(
      `Preliminary GET to metadata failed. Proceeding with XSRF token from login: ${currentSearchXsrfToken}`
    );
  }

  xsrfTokenValue = currentSearchXsrfToken;
  console.log(`Using X-XSRF-TOKEN for search: ${xsrfTokenValue || "None"}`);
  return client.post(INPI_SEARCH_URL, searchPayload, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-XSRF-TOKEN": xsrfTokenValue || "",
      "User-Agent": "Next.js Trademark Search App/1.0",
    },
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const queryFromUser = searchParams.get("q");
    const pageFromUser = searchParams.get("page") || "1";
    const nbResultsPerPageFromUser =
      searchParams.get("nbResultsPerPage") || "20";
    let sortFieldFromUrl = searchParams.get("sort") || "relevance";
    let orderFromUrl = searchParams.get("order") || "asc";

    if (!queryFromUser) {
      return NextResponse.json(
        { error: "Search query is required", code: "MISSING_QUERY" },
        { status: 400 }
      );
    }

    console.log(
      "User query:",
      queryFromUser,
      "Requested Sort by:",
      sortFieldFromUrl,
      "Order:",
      orderFromUrl
    );
    let token = await getAccessToken();
    console.log("Got access token, preparing search request...");

    const parsedPage = parseInt(pageFromUser);
    const parsedNbResultsPerPage = parseInt(nbResultsPerPageFromUser);

    let finalSortField: string;
    let finalSortOrder: string =
      orderFromUrl.toLowerCase() === "desc" ? "desc" : "asc";

    if (sortFieldFromUrl.toLowerCase() === "relevance") {
      finalSortField = "APPLICATION_DATE"; // Default valid field, UPPERCASE
      finalSortOrder = "desc"; // Default order for relevance mapping
      console.log(
        `Sort by 'relevance' requested, mapping to '${finalSortField} ${finalSortOrder}'`
      );
    } else {
      finalSortField = sortFieldFromUrl.toUpperCase(); // Convert user-provided field to UPPERCASE
      console.log(`Using user sort: '${finalSortField} ${finalSortOrder}'`);
    }

    const searchPayload: any = {
      // Add 'any' to allow conditional sortList
      query: `[Mark=${queryFromUser}]`,
      position: (parsedPage - 1) * parsedNbResultsPerPage,
      size: parsedNbResultsPerPage,
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
      // Only include sortList if a sort field is determined (always true with current logic)
      sortList: [`${finalSortField} ${finalSortOrder}`],
    };
    // Example: to make sortList truly optional if no sort params are given by user
    // if (searchParams.has("sort")) { // Or some other condition
    //   searchPayload.sortList = [`${finalSortField} ${finalSortOrder}`];
    // }

    console.log(
      "Constructed search payload:",
      JSON.stringify(searchPayload, null, 2)
    );

    try {
      const response = await performSearch(token, searchPayload);
      console.log("Search response status from INPI:", response.status);

      console.log("Data received from INPI (type):", typeof response.data);
      console.log(
        "Is INPI data.results an array?",
        Array.isArray(response.data?.results)
      );
      try {
        console.log(
          "Snippet of INPI data (first 1000 chars):",
          JSON.stringify(response.data, null, 2).substring(0, 1000)
        );
      } catch (e: any) {
        console.error(
          "Could not stringify response.data from INPI:",
          e.message
        );
        console.log("Raw response.data from INPI:", response.data);
      }

      return NextResponse.json(response.data);
    } catch (error: unknown) {
      logError("searchRequest", error);
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 401 || error.response?.status === 403)
      ) {
        console.log(
          "Access token or XSRF token invalid for search, clearing cache and retrying search once..."
        );
        accessToken = null;
        xsrfTokenValue = null;
        tokenExpiry = null;
        try {
          const newToken = await getAccessToken();
          // Re-construct payload for retry, ensuring sort handling is consistent
          // (using finalSortField, finalSortOrder from the outer scope for consistency in retry)
          const retrySearchPayload = {
            ...searchPayload, // Uses the payload from the first attempt, including its sortList
          };
          console.log(
            "Constructed retry search payload:",
            JSON.stringify(retrySearchPayload, null, 2)
          );
          const retryResponse = await performSearch(
            newToken,
            retrySearchPayload
          );

          console.log(
            "Retry search response status from INPI:",
            retryResponse.status
          );
          console.log(
            "Data received from INPI on retry (type):",
            typeof retryResponse.data
          );
          console.log(
            "Is INPI data.results an array on retry?",
            Array.isArray(retryResponse.data?.results)
          );
          try {
            console.log(
              "Snippet of INPI data on retry (first 1000 chars):",
              JSON.stringify(retryResponse.data, null, 2).substring(0, 1000)
            );
          } catch (e: any) {
            console.error(
              "Could not stringify retryResponse.data from INPI:",
              e.message
            );
            console.log(
              "Raw retryResponse.data from INPI:",
              retryResponse.data
            );
          }

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
          `Search failed: ${
            error.response?.data?.error_description ||
            error.response?.data ||
            error.message
          }`,
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
