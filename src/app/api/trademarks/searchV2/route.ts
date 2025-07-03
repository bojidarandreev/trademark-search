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

// It's important that apiClientV1.defaults.jar is initialized when inpi-client is imported.
// We assume it is, as per the structure of inpi-client.ts
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
    "<<<<<< performSearchV2 - JULY 2ND - V9 (Backend Filtering Strategy) >>>>>>"
  );

  let currentGlobalXsrfToken = getXsrfTokenValue();
  console.log(
    `PERFORM_SEARCH_V2: Initial global XSRF token before metadata GET: '${
      currentGlobalXsrfToken || "None"
    }'`
  );
  console.log(
    `PERFORM_SEARCH_V2: Attempting preliminary GET to ${ACTUAL_MARQUES_METADATA_ENDPOINT} for search-specific XSRF token.`
  );

  let xsrfTokenForPostRequest = currentGlobalXsrfToken;

  try {
    const metadataResponse = await clientV2.get("/api/marques/metadata", {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: "application/json",
        "X-XSRF-TOKEN": currentGlobalXsrfToken || "",
      },
    });
    console.log(
      `PERFORM_SEARCH_V2: Preliminary GET to ${ACTUAL_MARQUES_METADATA_ENDPOINT} completed. Status: ${metadataResponse.status}`
    );

    const metadataSetCookieHeader = metadataResponse.headers["set-cookie"];
    let identifiedNewXsrfTokenFromHeader;
    if (metadataSetCookieHeader) {
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
      updateXsrfTokenValue(xsrfTokenForPostRequest);
      await clientV2.defaults.jar!.setCookie(
        `XSRF-TOKEN=${xsrfTokenForPostRequest}; Path=/`,
        ACTUAL_MARQUES_SEARCH_ENDPOINT
      );
    } else {
      const cookiesInJarAfterMetadataGet =
        await clientV2.defaults.jar!.getCookies(
          ACTUAL_MARQUES_METADATA_ENDPOINT
        );
      const specificSearchXsrfCookieFromJar = cookiesInJarAfterMetadataGet.find(
        (c) => c.key === "XSRF-TOKEN" && c.path === "/"
      );
      if (specificSearchXsrfCookieFromJar?.value) {
        const tokenFromJar = decodeURIComponent(
          specificSearchXsrfCookieFromJar.value
        );
        if (tokenFromJar !== xsrfTokenForPostRequest) {
          xsrfTokenForPostRequest = tokenFromJar;
          updateXsrfTokenValue(xsrfTokenForPostRequest);
        }
      } else {
        console.warn(
          `PERFORM_SEARCH_V2: No new XSRF-TOKEN found. Using previous: '${
            xsrfTokenForPostRequest || "None"
          }'`
        );
        if (xsrfTokenForPostRequest)
          updateXsrfTokenValue(xsrfTokenForPostRequest);
      }
    }
  } catch (metaError) {
    logError("performSearchV2_preliminaryGetToMetadata", metaError);
    console.warn(
      `PERFORM_SEARCH_V2: Preliminary GET to metadata failed. Proceeding with XSRF token: '${
        xsrfTokenForPostRequest || "None"
      }'`
    );
    if (xsrfTokenForPostRequest) updateXsrfTokenValue(xsrfTokenForPostRequest);
  }

  console.log(
    `PERFORM_SEARCH_V2: X-XSRF-TOKEN to be used in POST header: '${
      xsrfTokenForPostRequest || "None"
    }'`
  );
  console.log(
    "PERFORM_SEARCH_V2: Search Payload for INPI:",
    JSON.stringify(searchPayload, null, 2)
  );

  let searchPostCookieHeader = "";
  try {
    const allCookiesForSearchUrl = await clientV2.defaults.jar!.getCookies(
      ACTUAL_MARQUES_SEARCH_ENDPOINT
    );
    const otherCookieStrings = allCookiesForSearchUrl
      .filter((cookie) => cookie.key !== "XSRF-TOKEN")
      .map((cookie) => cookie.cookieString());
    const finalCookieParts = [...otherCookieStrings];
    if (xsrfTokenForPostRequest)
      finalCookieParts.push(`XSRF-TOKEN=${xsrfTokenForPostRequest}`);
    searchPostCookieHeader = finalCookieParts.join("; ");
  } catch (e) {
    console.error(
      "PERFORM_SEARCH_V2: Error constructing cookie header from jar:",
      e
    );
    if (xsrfTokenForPostRequest)
      searchPostCookieHeader = `XSRF-TOKEN=${xsrfTokenForPostRequest}`;
  }

  const requestHeaders: Record<string, string> = {
    Authorization: `Bearer ${bearerToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent":
      "Next.js Trademark Search App/1.0 (Backend Filtering Strategy)",
  };
  if (xsrfTokenForPostRequest)
    requestHeaders["X-XSRF-TOKEN"] = xsrfTokenForPostRequest;
  if (searchPostCookieHeader) requestHeaders["Cookie"] = searchPostCookieHeader;

  return clientV2.post("/api/marques/search", searchPayload, {
    headers: requestHeaders,
  });
}

export async function GET(request: Request) {
  console.log(
    "<<<<<< GET HANDLER - JULY 2ND - V9 (Backend Filtering Strategy) >>>>>>"
  );
  try {
    const { searchParams } = new URL(request.url);
    const queryFromUser = searchParams.get("q");
    const pageFromUser = searchParams.get("page") || "1";
    const nbResultsPerPageFromUser =
      searchParams.get("nbResultsPerPage") || "20";
    let sortFieldFromUrl = searchParams.get("sort") || "relevance";
    let orderFromUrl = searchParams.get("order") || "asc";
    const niceClassesParam = searchParams.get("niceClasses");
    const originParam = searchParams.get("origin"); // Get Origin param

    if (!queryFromUser) {
      return NextResponse.json(
        { error: "Search query is required", code: "MISSING_QUERY" },
        { status: 400 }
      );
    }

    let processedQuery = queryFromUser.trim();
    if (processedQuery.includes(" ")) {
      processedQuery = `"${processedQuery.replace(/"/g, '\\"')}"`;
    }

    const solrQueryForINPI = `[Mark=${processedQuery}]`;

    let niceClassesForBackendFilter: number[] = [];
    if (niceClassesParam) {
      niceClassesForBackendFilter = niceClassesParam
        .split(",")
        .map((nc) => parseInt(nc.trim(), 10))
        .filter((nc) => !isNaN(nc) && nc > 0 && nc <= 45);
      if (niceClassesForBackendFilter.length > 0) {
        console.log(
          "GET HANDLER: Nice Classes selected for backend filtering:",
          niceClassesForBackendFilter.join(", ")
        );
      }
    }

    console.log(
      "GET HANDLER: Original user query:",
      queryFromUser,
      "Processed mark query for INPI:",
      processedQuery,
      "Final Solr Query to INPI:",
      solrQueryForINPI
    );

    let token = await getAccessToken();
    const parsedPage = parseInt(pageFromUser);
    const parsedNbResultsPerPage = parseInt(nbResultsPerPageFromUser);
    let finalSortField: string;
    let finalSortOrder: string =
      orderFromUrl.toLowerCase() === "desc" ? "desc" : "asc";

    if (sortFieldFromUrl.toLowerCase() === "relevance") {
      finalSortField = "APPLICATION_DATE"; // Defaulting to this, INPI might use something like 'score'
      finalSortOrder = "desc";
    } else {
      finalSortField = sortFieldFromUrl.toUpperCase();
    }

    const searchPayload: any = {
      query: solrQueryForINPI,
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

      let responseData = response.data;

      // Perform backend filtering
      if (responseData && Array.isArray(responseData.results)) {
        const hasNiceClassFilter = niceClassesForBackendFilter.length > 0;
        const hasOriginFilter =
          originParam && ["FR", "EU", "WO"].includes(originParam);

        if (hasNiceClassFilter || hasOriginFilter) {
          console.log(
            `GET HANDLER: Initial INPI results: ${responseData.results.length}`
          );
          if (hasNiceClassFilter)
            console.log(
              `Filtering by Nice Classes: ${niceClassesForBackendFilter.join(
                ", "
              )}`
            );
          if (hasOriginFilter)
            console.log(`Filtering by Origin: ${originParam}`);

          responseData.results = responseData.results.filter((item: any) => {
            let matchesNiceClass = !hasNiceClassFilter; // Default to true if no class filter
            if (hasNiceClassFilter) {
              const classNumberField = Array.isArray(item.fields)
                ? item.fields.find((f: any) => f.name === "ClassNumber")
                : null;
              if (classNumberField) {
                let itemClassesRaw: string[] = [];
                if (classNumberField.value)
                  itemClassesRaw = [classNumberField.value];
                else if (Array.isArray(classNumberField.values))
                  itemClassesRaw = classNumberField.values;

                const itemClassNumbers = itemClassesRaw
                  .map((cn) => parseInt(cn, 10))
                  .filter((cn) => !isNaN(cn));
                matchesNiceClass = niceClassesForBackendFilter.every(
                  (selectedCn) => itemClassNumbers.includes(selectedCn)
                );
              } else {
                matchesNiceClass = false; // No ClassNumber field, doesn't match if filter active
              }
            }

            let matchesOrigin = !hasOriginFilter; // Default to true if no origin filter
            if (hasOriginFilter) {
              // The 'origine' field is added by our frontend mapping logic, but that runs client-side.
              // We need to derive origin from INPI fields here, similar to how frontend does.
              // Or, more simply, assume the frontend mapping of `item.origine` would be available if we passed all fields.
              // For now, let's assume the 'ukey' or 'ApplicationNumber' prefix logic is needed here.
              // This is a simplified version based on 'ukey' for demonstration.
              // A more robust solution would replicate the frontend's origin derivation logic.
              let derivedOrigin = "N/A";
              const ukeyField = Array.isArray(item.fields)
                ? item.fields.find((f: any) => f.name === "ukey")
                : null;
              if (ukeyField && ukeyField.value) {
                if (ukeyField.value.startsWith("FMARK")) derivedOrigin = "FR";
                else if (ukeyField.value.startsWith("CTMARK"))
                  derivedOrigin = "EU";
                else if (ukeyField.value.startsWith("TMINT"))
                  derivedOrigin = "WO";
              }
              // Add more robust origin detection if needed, like from ApplicationNumber prefix
              if (derivedOrigin === "N/A") {
                const appNumForOriginField = Array.isArray(item.fields)
                  ? item.fields.find((f: any) => f.name === "ApplicationNumber")
                  : null;
                if (appNumForOriginField && appNumForOriginField.value) {
                  const appNum = appNumForOriginField.value;
                  if (
                    appNum.length > 2 &&
                    /^[A-Z]{2}/.test(appNum.substring(0, 2))
                  ) {
                    const prefix = appNum.substring(0, 2).toUpperCase();
                    if (prefix === "FR") derivedOrigin = "FR";
                    else if (prefix === "EM" || prefix === "EU")
                      derivedOrigin = "EU"; // EUIPO uses EM for EUTM
                    else if (prefix === "WO") derivedOrigin = "WO";
                  } else if (
                    appNum.startsWith("0") &&
                    appNum.length >= 8 &&
                    appNum.length <= 9
                  ) {
                    // Older CTMs start with 0
                    derivedOrigin = "EU";
                  }
                }
              }
              matchesOrigin = derivedOrigin === originParam;
            }
            return matchesNiceClass && matchesOrigin;
          });
          console.log(
            `GET HANDLER: ${responseData.results.length} results remaining after backend filtering.`
          );
        }
      }

      console.log(
        "GET HANDLER: Final response data to frontend (first 1000 chars):",
        JSON.stringify(responseData, null, 2).substring(0, 1000)
      );
      return NextResponse.json(responseData);
    } catch (error: unknown) {
      logError("GET_handler_searchRequest_catch", error);
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 401 || error.response?.status === 403)
      ) {
        clearAuthCache();
        // Consider a single retry attempt here if appropriate, or just fail.
        // For now, failing to avoid complex retry logic here.
        throw new APIError(
          `INPI Auth Error on Search: ${
            error.response?.data?.error_description || error.message
          }`,
          error.response?.status || 500,
          error.response?.data
        );
      }
      if (axios.isAxiosError(error)) {
        throw new APIError(
          `INPI Search Failed: ${
            error.response?.data?.error_description ||
            error.response?.data ||
            error.message
          }`,
          error.response?.status || 500,
          error.response?.data
        );
      }
      throw new APIError("Unexpected error during INPI search", 500, {
        errorDetails: String(error),
      });
    }
  } catch (error: unknown) {
    logError("GET_handler_main_catch", error);
    if (error instanceof APIError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.statusCode === 401 ? "UNAUTHORIZED" : "INTERNAL_ERROR",
          details: error.details,
        },
        { status: error.statusCode }
      );
    }
    return NextResponse.json(
      {
        error: "An unexpected internal error occurred in GET handler.",
        code: "INTERNAL_ERROR",
        details: String(error),
      },
      { status: 500 }
    );
  }
}
