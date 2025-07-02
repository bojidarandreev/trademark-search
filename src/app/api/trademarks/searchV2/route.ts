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

const INPI_API_BASE_URL = "https://api-gateway.inpi.fr/services/apidiffusion";

const ACTUAL_MARQUES_METADATA_ENDPOINT = `${INPI_API_BASE_URL}/api/marques/metadata`;
const ACTUAL_MARQUES_SEARCH_ENDPOINT = `${INPI_API_BASE_URL}/api/marques/search`;

const clientV2 = axios.create({
  baseURL: INPI_API_BASE_URL,
  withCredentials: true,
  jar: apiClientV1.defaults.jar,
});

async function performSearchV2(
  bearerToken: string,
  searchPayload: any
): Promise<any> {
  console.log(
    "<<<<<< CHECKING LATEST LOGGING CODE - JULY 1ST - V8 (Corrected XSRF Logic) >>>>>>"
  );

  let currentGlobalXsrfToken = getXsrfTokenValue(); // Token from login or previous op
  console.log(
    `PERFORM_SEARCH_V2: Initial global XSRF token before metadata GET: '${
      currentGlobalXsrfToken || "None"
    }'`
  );
  console.log(
    `PERFORM_SEARCH_V2: Attempting preliminary GET to ${ACTUAL_MARQUES_METADATA_ENDPOINT} for search-specific XSRF token.`
  );

  let xsrfTokenForPostRequest = currentGlobalXsrfToken; // Default to current global/login token

  try {
    const preMetadataCookies = await clientV2.defaults.jar!.getCookieString(
      ACTUAL_MARQUES_METADATA_ENDPOINT
    );
    console.log(
      `PERFORM_SEARCH_V2: Cookies TO BE SENT with metadata GET to ${ACTUAL_MARQUES_METADATA_ENDPOINT}: [${
        preMetadataCookies || "NONE"
      }]`
    );

    const metadataResponse = await clientV2.get("/api/marques/metadata", {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: "application/json",
        // It's generally good practice to send the current XSRF token if we have one, even for a GET that might refresh it
        "X-XSRF-TOKEN": currentGlobalXsrfToken || "",
      },
    });
    console.log(
      `PERFORM_SEARCH_V2: Preliminary GET to ${ACTUAL_MARQUES_METADATA_ENDPOINT} completed. Status: ${metadataResponse.status}`
    );

    const metadataSetCookieHeader = metadataResponse.headers["set-cookie"];
    let identifiedNewXsrfTokenFromHeader;
    if (metadataSetCookieHeader) {
      console.log(
        `PERFORM_SEARCH_V2: Set-Cookie headers FROM metadata GET response:`,
        metadataSetCookieHeader
      );
      for (const cookieStr of metadataSetCookieHeader) {
        if (cookieStr.startsWith("XSRF-TOKEN=")) {
          identifiedNewXsrfTokenFromHeader = cookieStr
            .substring("XSRF-TOKEN=".length)
            .split(";")[0];
          break;
        }
      }
    }

    if (identifiedNewXsrfTokenFromHeader) {
      xsrfTokenForPostRequest = decodeURIComponent(
        identifiedNewXsrfTokenFromHeader
      );
      console.log(
        "PERFORM_SEARCH_V2: Using XSRF-TOKEN directly from metadata Set-Cookie header:",
        xsrfTokenForPostRequest
      );
      updateXsrfTokenValue(xsrfTokenForPostRequest); // Update global cache

      // Explicitly set the new XSRF-TOKEN cookie in the jar for the search domain
      // This is the critical fix: ensuring the cookie jar has the *exact* token
      // that the metadata endpoint just provided.
      try {
        await clientV2.defaults.jar!.setCookie(
          `XSRF-TOKEN=${xsrfTokenForPostRequest}; Path=/`,
          ACTUAL_MARQUES_SEARCH_ENDPOINT // Ensure it's set for the domain of the search endpoint
        );
        console.log(
          `PERFORM_SEARCH_V2: Successfully set XSRF-TOKEN=${xsrfTokenForPostRequest} in cookie jar for ${ACTUAL_MARQUES_SEARCH_ENDPOINT}`
        );
      } catch (e) {
        console.error(
          "PERFORM_SEARCH_V2: Error setting XSRF-TOKEN cookie in jar:",
          e
        );
      }
    } else {
      // Fallback logic (less likely path based on current logs, but kept for robustness)
      const cookiesInJarAfterMetadataGet =
        await clientV2.defaults.jar!.getCookies(
          ACTUAL_MARQUES_METADATA_ENDPOINT
        );
      console.log(
        `PERFORM_SEARCH_V2: Cookies IN JAR AFTER metadata GET (for ${ACTUAL_MARQUES_METADATA_ENDPOINT}): [${
          cookiesInJarAfterMetadataGet
            .map((c) => c.cookieString())
            .join("; ") || "NONE"
        }]`
      );
      const specificSearchXsrfCookieFromJar = cookiesInJarAfterMetadataGet.find(
        (c) => c.key === "XSRF-TOKEN" && c.path === "/"
      );
      if (specificSearchXsrfCookieFromJar?.value) {
        const tokenFromJar = decodeURIComponent(
          specificSearchXsrfCookieFromJar.value
        );
        console.log(
          "PERFORM_SEARCH_V2: XSRF-TOKEN found in JAR after metadata GET:",
          tokenFromJar
        );
        // Only update if it's genuinely different and should be the one used
        if (tokenFromJar !== xsrfTokenForPostRequest) {
          xsrfTokenForPostRequest = tokenFromJar;
          updateXsrfTokenValue(xsrfTokenForPostRequest);
          console.log("PERFORM_SEARCH_V2: Updated XSRF token from JAR.");
        } else {
          console.log(
            "PERFORM_SEARCH_V2: XSRF token in JAR same as one from metadata header, no change from JAR."
          );
        }
      } else {
        console.warn(
          `PERFORM_SEARCH_V2: No new XSRF-TOKEN found from metadata Set-Cookie or JAR. Using initial/previous: '${
            xsrfTokenForPostRequest || "None"
          }'`
        );
        if (xsrfTokenForPostRequest) {
          updateXsrfTokenValue(xsrfTokenForPostRequest);
        }
      }
    }
  } catch (metaError) {
    logError("performSearchV2_preliminaryGetToMetadata", metaError);
    console.warn(
      `PERFORM_SEARCH_V2: Preliminary GET to metadata failed. Proceeding with initial XSRF token: '${
        xsrfTokenForPostRequest || "None"
      }'`
    );
    if (xsrfTokenForPostRequest) {
      updateXsrfTokenValue(xsrfTokenForPostRequest);
    } else {
      // If there was no initial token and metadata failed, it's problematic.
      // Consider if clearing auth cache is right or if we should throw.
      // For now, matching existing logic:
      // clearAuthCache(); // This was present in original, but might be too aggressive if login token was valid
    }
  }

  console.log(
    `PERFORM_SEARCH_V2: X-XSRF-TOKEN to be used in POST header (after all checks): '${
      xsrfTokenForPostRequest || "None"
    }'`
  );

  console.log(
    "PERFORM_SEARCH_V2: Making POST request to search endpoint:",
    ACTUAL_MARQUES_SEARCH_ENDPOINT
  );
  console.log(
    "PERFORM_SEARCH_V2: Search Payload for INPI:",
    JSON.stringify(searchPayload, null, 2)
  );

  // Manually construct the Cookie header for the search POST
  let searchPostCookieHeader = "";
  try {
    const allCookiesForSearchUrl = await clientV2.defaults.jar!.getCookies(
      ACTUAL_MARQUES_SEARCH_ENDPOINT
    );

    const otherCookieStrings = allCookiesForSearchUrl
      .filter((cookie) => cookie.key !== "XSRF-TOKEN")
      .map((cookie) => cookie.cookieString());

    const finalCookieParts = [...otherCookieStrings];
    if (xsrfTokenForPostRequest) {
      finalCookieParts.push(`XSRF-TOKEN=${xsrfTokenForPostRequest}`);
    }
    searchPostCookieHeader = finalCookieParts.join("; ");
  } catch (e) {
    console.error(
      "PERFORM_SEARCH_V2: Error constructing cookie header string from jar:",
      e
    );
    // Fallback: if jar operations fail, just use the XSRF token if available
    if (xsrfTokenForPostRequest) {
      searchPostCookieHeader = `XSRF-TOKEN=${xsrfTokenForPostRequest}`;
    } else {
      searchPostCookieHeader = ""; // No cookies if jar fails and no XSRF token
    }
  }

  console.log(
    `PERFORM_SEARCH_V2: Manually constructed Cookie header for search POST: [${
      searchPostCookieHeader || "NONE"
    }]`
  );

  const requestHeaders: Record<string, string> = {
    Authorization: `Bearer ${bearerToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent":
      "Next.js Trademark Search App/1.0 (API Test with Corrected XSRF Logic V8)",
  };
  if (xsrfTokenForPostRequest) {
    requestHeaders["X-XSRF-TOKEN"] = xsrfTokenForPostRequest;
  }
  // Only set the Cookie header if we have something to send
  if (searchPostCookieHeader) {
    requestHeaders["Cookie"] = searchPostCookieHeader;
  } else {
    // If searchPostCookieHeader is empty, we might not want to send an empty Cookie header.
    // Axios might behave differently if 'Cookie' is present but empty vs. not present at all.
    // For now, let's omit it if it's empty.
    console.log(
      "PERFORM_SEARCH_V2: No cookies to send in Cookie header for search POST."
    );
  }

  return clientV2.post("/api/marques/search", searchPayload, {
    headers: requestHeaders,
  });
} // This closing brace was likely the source of the syntax error. It correctly closes performSearchV2.

export async function GET(request: Request) {
  console.log(
    "<<<<<< GET HANDLER - JULY 1ST - V8 (Corrected XSRF Logic) >>>>>>"
  );
  try {
    if (!apiClientV1.defaults.jar) {
      console.error(
        "GET HANDLER: apiClientV1.defaults.jar is not initialized! This indicates a critical setup issue."
      );
    } else {
      try {
        const allCookiesInJar = await apiClientV1.defaults.jar.getCookies(
          INPI_API_BASE_URL
        );
        console.log(
          "GET HANDLER: Cookies in shared apiClientV1.defaults.jar at start of GET request (domain: " +
            INPI_API_BASE_URL +
            "): [",
          allCookiesInJar.map((c) => c.cookieString()).join("; ") || "NONE",
          "]"
        );
      } catch (e) {
        console.error(
          "GET HANDLER: Error fetching cookies from jar for INPI_API_BASE_URL",
          e
        );
      }
    }

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
      "GET HANDLER: User query:",
      queryFromUser,
      "Requested Sort by:",
      sortFieldFromUrl,
      "Order:",
      orderFromUrl
    );
    let token = await getAccessToken();
    console.log("GET HANDLER: Got access token, preparing search request...");

    const parsedPage = parseInt(pageFromUser);
    const parsedNbResultsPerPage = parseInt(nbResultsPerPageFromUser);

    let finalSortField: string;
    let finalSortOrder: string =
      orderFromUrl.toLowerCase() === "desc" ? "desc" : "asc";

    if (sortFieldFromUrl.toLowerCase() === "relevance") {
      finalSortField = "APPLICATION_DATE";
      finalSortOrder = "desc";
      console.log(
        `GET HANDLER: Sort by 'relevance' requested, mapping to '${finalSortField} ${finalSortOrder}'`
      );
    } else {
      finalSortField = sortFieldFromUrl.toUpperCase();
      console.log(
        `GET HANDLER: Using user sort: '${finalSortField} ${finalSortOrder}'`
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
      "GET HANDLER: Constructed search payload for INPI:",
      JSON.stringify(searchPayload, null, 2)
    );

    try {
      const response = await performSearchV2(token, searchPayload);
      console.log(
        "GET HANDLER: Search response status from INPI:",
        response.status
      );
      console.log(
        "GET HANDLER: Raw response data from INPI (Full):",
        JSON.stringify(response.data, null, 2)
      );
      return NextResponse.json(response.data);
    } catch (error: unknown) {
      logError("GET_handler_searchRequest_catch", error);
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 401 || error.response?.status === 403)
      ) {
        console.log(
          "GET HANDLER: Access token or XSRF token invalid for search, clearing auth cache and retrying search once..."
        );
        clearAuthCache();
        try {
          const newToken = await getAccessToken();
          const retryResponse = await performSearchV2(newToken, searchPayload);

          console.log(
            "GET HANDLER: Retry search response status from INPI:",
            retryResponse.status
          );
          console.log(
            "GET HANDLER: Raw response data from INPI on retry (Full):",
            JSON.stringify(retryResponse.data, null, 2)
          );
          return NextResponse.json(retryResponse.data);
        } catch (retryError: unknown) {
          logError("GET_handler_searchRetry_catch", retryError);
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
            `GET HANDLER: Failed to retry search: ${
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
          `GET HANDLER: Search failed: ${
            error.response?.data?.error_description ||
            error.response?.data ||
            error.message
          }`,
          error.response?.status || 500,
          error.response?.data,
          error.response?.headers
        );
      throw new APIError("GET HANDLER: Unexpected error during search", 500, {
        errorDetails: String(error),
      });
    }
  } catch (error: unknown) {
    logError("GET_handler_main_catch", error);
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
        error: "GET HANDLER: An unexpected internal error occurred.",
        code: "INTERNAL_ERROR",
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
