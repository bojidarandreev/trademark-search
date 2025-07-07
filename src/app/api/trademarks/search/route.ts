import { NextResponse } from "next/server";
import axios, { AxiosResponse } from "axios"; // AxiosError might be needed for type checks
import {
  client,
  getAccessToken,
  APIError,
  logError,
  getXsrfTokenValue,
  updateXsrfTokenValue,
  clearAuthCache,
} from "@/lib/inpi-client"; // Assuming @/lib path alias is configured or use relative path
// import { Cookie } from "tough-cookie"; // Still needed if performSearch inspects cookies directly, but likely not

// INPI API Base URL - can be local or imported if also shared, but usually static per route context
const INPI_API_BASE_URL = "https://api-gateway.inpi.fr";
// Specific URLs for this route
const INPI_SEARCH_URL = `${INPI_API_BASE_URL}/services/apidiffusion/api/marques/search`;
const INPI_MARQUES_METADATA_URL = `${INPI_API_BASE_URL}/services/apidiffusion/api/marques/metadata`;

interface SearchPayload {
  query: string;
  position: number;
  size: number;
  collections: string[];
  fields: string[];
  sortList: string[];
}

async function performSearch(
  bearerToken: string,
  searchPayload: SearchPayload
): Promise<AxiosResponse<unknown>> {
  // Changed any to unknown
  let currentSearchXsrfToken = getXsrfTokenValue();
  console.log(
    `Attempting preliminary GET to ${INPI_MARQUES_METADATA_URL} for search-specific XSRF token.`
  );
  try {
    // Use the imported client which has the shared cookieJar
    await client.get(INPI_MARQUES_METADATA_URL, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: "application/json",
      },
    });
    console.log(`Preliminary GET to ${INPI_MARQUES_METADATA_URL} completed.`);
    // client.jar is the cookieJar from inpi-client.ts
    const cookiesForSearch = await client.defaults.jar!.getCookies(
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

  updateXsrfTokenValue(currentSearchXsrfToken); // Update the shared token value
  console.log(
    `Using X-XSRF-TOKEN for search: ${getXsrfTokenValue() || "None"}`
  );
  return client.post(INPI_SEARCH_URL, searchPayload, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-XSRF-TOKEN": getXsrfTokenValue() || "",
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
    const sortFieldFromUrl = searchParams.get("sort") || "relevance";
    const orderFromUrl = searchParams.get("order") || "asc";

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
    const token = await getAccessToken(); // Uses shared getAccessToken
    console.log("Got access token, preparing search request...");

    const parsedPage = parseInt(pageFromUser);
    const parsedNbResultsPerPage = parseInt(nbResultsPerPageFromUser);

    let finalSortField: string;
    let finalSortOrder: string =
      orderFromUrl.toLowerCase() === "desc" ? "desc" : "asc";

    if (sortFieldFromUrl.toLowerCase() === "relevance") {
      finalSortField = "APPLICATION_DATE";
      finalSortOrder = "desc";
      console.log(
        `Sort by 'relevance' requested, mapping to '${finalSortField} ${finalSortOrder}'`
      );
    } else {
      finalSortField = sortFieldFromUrl.toUpperCase();
      console.log(`Using user sort: '${finalSortField} ${finalSortOrder}'`);
    }

    const searchPayload: SearchPayload = {
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
      sortList: [`${finalSortField} ${finalSortOrder}`],
    };
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
      } catch (e: unknown) {
        console.error(
          "Could not stringify response.data from INPI:",
          e instanceof Error ? e.message : String(e)
        );
        console.log("Raw response.data from INPI:", response.data);
      }

      return NextResponse.json(response.data);
    } catch (error: unknown) {
      logError("searchRequest", error); // Uses shared logError
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 401 || error.response?.status === 403)
      ) {
        console.log(
          "Access token or XSRF token invalid for search, clearing auth cache and retrying search once..."
        );
        clearAuthCache(); // Use shared cache clearing
        try {
          const newToken = await getAccessToken(); // Re-authenticates

          // Re-calculate sort for retry payload
          // No need to redefine retrySortField, retrySortOrder as sortFieldFromUrl, orderFromUrl are const
          // finalSortField and finalSortOrder are already calculated correctly based on them.
          // The payload needs to use the correct finalSortField and finalSortOrder from the outer scope.

          const retrySearchPayload: SearchPayload = {
            // Use SearchPayload type
            ...searchPayload, // Spread the original payload
            // Ensure sortList uses the correctly determined finalSortField and finalSortOrder
            sortList: [`${finalSortField} ${finalSortOrder}`],
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
          } catch (e: unknown) {
            console.error(
              "Could not stringify retryResponse.data from INPI:",
              e instanceof Error ? e.message : String(e)
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
          let rDetails: unknown = {}; // Use unknown
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
              originalSearchError: {
                message: error instanceof Error ? error.message : String(error),
              }, // Handle error type
              retryAttemptError: { data: rDetails },
            }
          );
        }
      }
      if (axios.isAxiosError(error))
        throw new APIError(
          `Search failed: ${
            error.response?.data?.error_description ||
            error.response?.data || // data could be anything, stringify might be safer if not an object
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
