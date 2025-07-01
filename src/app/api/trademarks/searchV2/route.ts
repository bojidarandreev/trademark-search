import { NextResponse } from "next/server";
import axios, { AxiosError } from "axios";
import {
  client as apiClientV1, // Using existing client for cookie jar and auth logic
  getAccessToken,
  APIError,
  logError,
  getXsrfTokenValue,
  updateXsrfTokenValue,
  clearAuthCache,
} from "@/lib/inpi-client";

const INPI_API_V2_BASE_URL =
  "https://api-gateway.inpi.fr/services/apidiffusion/v2";
const INPI_V2_MARQUES_SEARCH_ENDPOINT = `${INPI_API_V2_BASE_URL}/marques/search`;
const INPI_V2_MARQUES_METADATA_ENDPOINT = `${INPI_API_V2_BASE_URL}/marques/metadata`;

const clientV2 = axios.create({
  baseURL: INPI_API_V2_BASE_URL,
  withCredentials: true,
  jar: apiClientV1.defaults.jar,
});

async function performSearchV2(
  bearerToken: string,
  searchPayload: any
): Promise<any> {
  let currentSearchXsrfToken = getXsrfTokenValue();
  console.log(
    `V2 Backend: Attempting preliminary GET to ${INPI_V2_MARQUES_METADATA_ENDPOINT} for search-specific XSRF token.`
  );
  try {
    await clientV2.get("/marques/metadata", {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: "application/json",
      },
    });
    console.log(
      `V2 Backend: Preliminary GET to ${INPI_V2_MARQUES_METADATA_ENDPOINT} completed.`
    );

    const cookiesForSearch = await clientV2.defaults.jar!.getCookies(
      INPI_V2_MARQUES_METADATA_ENDPOINT
    );
    const specificSearchXsrfCookie = cookiesForSearch.find(
      (c) => c.key === "XSRF-TOKEN"
    );

    if (specificSearchXsrfCookie?.value) {
      currentSearchXsrfToken = decodeURIComponent(
        specificSearchXsrfCookie.value
      );
      console.log(
        "V2 Backend: Updated XSRF-TOKEN value after metadata call for search:",
        currentSearchXsrfToken
      );
    } else {
      console.warn(
        `V2 Backend: No new XSRF-TOKEN found from V2 metadata call. Using previous XSRF: ${
          currentSearchXsrfToken || "None"
        }`
      );
    }
  } catch (metaError) {
    logError("v2_backend_preliminaryGetToMetadata", metaError);
    console.warn(
      `V2 Backend: Preliminary GET to V2 metadata failed. Proceeding with XSRF token: ${
        currentSearchXsrfToken || "None"
      }`
    );
  }

  updateXsrfTokenValue(currentSearchXsrfToken);
  console.log(
    `V2 Backend: Using X-XSRF-TOKEN for search: ${
      getXsrfTokenValue() || "None"
    }`
  );

  console.log(
    "V2 Backend: Making POST request to V2 search endpoint:",
    INPI_V2_MARQUES_SEARCH_ENDPOINT
  );
  console.log(
    "V2 Backend: Search Payload for INPI V2:",
    JSON.stringify(searchPayload, null, 2)
  );

  return clientV2.post("/marques/search", searchPayload, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-XSRF-TOKEN": getXsrfTokenValue() || "",
      "User-Agent": "Next.js Trademark Search App/1.0 (API V2 Test)",
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
      "V2 Backend Route: User query:",
      queryFromUser,
      "Requested Sort by:",
      sortFieldFromUrl,
      "Order:",
      orderFromUrl
    );
    let token = await getAccessToken();
    console.log(
      "V2 Backend Route: Got access token, preparing V2 search request..."
    );

    const parsedPage = parseInt(pageFromUser);
    const parsedNbResultsPerPage = parseInt(nbResultsPerPageFromUser);

    let finalSortField: string;
    let finalSortOrder: string =
      orderFromUrl.toLowerCase() === "desc" ? "desc" : "asc";

    if (sortFieldFromUrl.toLowerCase() === "relevance") {
      finalSortField = "APPLICATION_DATE";
      finalSortOrder = "desc";
      console.log(
        `V2 Backend Route: Sort by 'relevance' requested, mapping to '${finalSortField} ${finalSortOrder}'`
      );
    } else {
      finalSortField = sortFieldFromUrl.toUpperCase();
      console.log(
        `V2 Backend Route: Using user sort: '${finalSortField} ${finalSortOrder}'`
      );
    }

    const searchPayload: any = {
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
        "ClassNumber",
        "classNumbers",
        "niceClasses",
        "nice_class_numbers",
        "GoodsServicesDetails",
        "MarkImageFilename",
      ],
      sortList: [`${finalSortField} ${finalSortOrder}`],
    };
    console.log(
      "V2 Backend Route: Constructed search payload for INPI V2:",
      JSON.stringify(searchPayload, null, 2)
    );

    try {
      const response = await performSearchV2(token, searchPayload);
      console.log(
        "V2 Backend Route: Search response status from INPI V2:",
        response.status
      );
      console.log(
        "V2 Backend Route: Raw response data from INPI V2 (Full):",
        JSON.stringify(response.data, null, 2)
      );
      return NextResponse.json(response.data);
    } catch (error: unknown) {
      logError("v2_backend_searchRequest", error);
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 401 || error.response?.status === 403)
      ) {
        console.log(
          "V2 Backend Route: Access token or XSRF token invalid for V2 search, clearing auth cache and retrying search once..."
        );
        clearAuthCache();
        try {
          const newToken = await getAccessToken();
          const retryResponse = await performSearchV2(newToken, searchPayload);

          console.log(
            "V2 Backend Route: Retry search response status from INPI V2:",
            retryResponse.status
          );
          console.log(
            "V2 Backend Route: Raw response data from INPI V2 on retry (Full):",
            JSON.stringify(retryResponse.data, null, 2)
          );
          return NextResponse.json(retryResponse.data);
        } catch (retryError: unknown) {
          logError("v2_backend_searchRetry", retryError);
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
            `V2 Backend Route: Failed to retry search: ${
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
          `V2 Backend Search failed: ${
            error.response?.data?.error_description ||
            error.response?.data ||
            error.message
          }`,
          error.response?.status || 500,
          error.response?.data,
          error.response?.headers
        );
      throw new APIError("V2 Backend: Unexpected error during search", 500, {
        errorDetails: String(error),
      });
    }
  } catch (error: unknown) {
    logError("v2_backend_searchRouteHandler", error);
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
        error: "V2 Backend: An unexpected internal error occurred.",
        code: "INTERNAL_ERROR",
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
