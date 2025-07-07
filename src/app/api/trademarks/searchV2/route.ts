import { NextResponse } from "next/server";
import axios, { AxiosResponse } from "axios";
import {
  client as apiClientV1, // Using existing client for cookie jar and auth logic
  getAccessToken,
  APIError,
  logError,
  getXsrfTokenValue,
  updateXsrfTokenValue,
  // clearAuthCache, // Unused
} from "@/lib/inpi-client";

const INPI_API_BASE_URL = "https://api-gateway.inpi.fr/services/apidiffusion";
const ACTUAL_MARQUES_METADATA_ENDPOINT = `${INPI_API_BASE_URL}/api/marques/metadata`;
const ACTUAL_MARQUES_SEARCH_ENDPOINT = `${INPI_API_BASE_URL}/api/marques/search`;

// Define interfaces based on usage in this file and the previous one
interface SearchPayload {
  query: string;
  position: number;
  size: number;
  collections: string[];
  fields: string[];
  sortList: string[];
}

interface InpiField {
  name: string;
  value?: string;
  values?: string[];
}

interface InpiResultItem {
  fields: InpiField[];
  // Define other known properties of a result item if available
}

interface InpiSearchResponseData {
  results: InpiResultItem[];
  // Define other known properties of the response data, e.g., total, page, etc.
}

const clientV2 = axios.create({
  baseURL: INPI_API_BASE_URL,
  withCredentials: true,
  jar: apiClientV1.defaults.jar,
});

async function performSearchV2(
  bearerToken: string,
  searchPayload: SearchPayload
): Promise<AxiosResponse<InpiSearchResponseData>> {
  console.log(
    "<<<<<< performSearchV2 - Re-implementation (Backend Filtering Strategy V11) >>>>>>"
  );

  const currentGlobalXsrfToken = getXsrfTokenValue(); // Should be const
  // console.log( // Too verbose for regular operation
  //   `PERFORM_SEARCH_V2: Initial global XSRF token before metadata GET: '${currentGlobalXsrfToken || "None"}'`
  // );

  let xsrfTokenForPostRequest = currentGlobalXsrfToken; // This one is potentially reassigned

  try {
    const metadataResponse = await clientV2.get("/api/marques/metadata", {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: "application/json",
        "X-XSRF-TOKEN": currentGlobalXsrfToken || "",
      },
    });
    // console.log( // Too verbose
    //   `PERFORM_SEARCH_V2: Preliminary GET to ${ACTUAL_MARQUES_METADATA_ENDPOINT} completed. Status: ${metadataResponse.status}`
    // );

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
      // console.log("PERFORM_SEARCH_V2: Using XSRF-TOKEN directly from metadata Set-Cookie header:", xsrfTokenForPostRequest); // Too verbose
      updateXsrfTokenValue(xsrfTokenForPostRequest);
      if (clientV2.defaults.jar) {
        await clientV2.defaults.jar.setCookie(
          `XSRF-TOKEN=${xsrfTokenForPostRequest}; Path=/`,
          ACTUAL_MARQUES_SEARCH_ENDPOINT
        );
      }
    } else {
      if (clientV2.defaults.jar) {
        const cookiesInJarAfterMetadataGet =
          await clientV2.defaults.jar.getCookies(
            ACTUAL_MARQUES_METADATA_ENDPOINT
          );
        const specificSearchXsrfCookieFromJar =
          cookiesInJarAfterMetadataGet.find(
            (c) => c.key === "XSRF-TOKEN" && c.path === "/"
          );
        if (specificSearchXsrfCookieFromJar?.value) {
          const tokenFromJar = decodeURIComponent(
            specificSearchXsrfCookieFromJar.value
          );
          if (tokenFromJar !== xsrfTokenForPostRequest) {
            xsrfTokenForPostRequest = tokenFromJar;
            updateXsrfTokenValue(xsrfTokenForPostRequest);
            // console.log("PERFORM_SEARCH_V2: Updated XSRF token from JAR."); // Too verbose
          }
        } else {
          console.warn(
            `PERFORM_SEARCH_V2: No new XSRF-TOKEN found from JAR. Using previous: '${
              xsrfTokenForPostRequest || "None"
            }'`
          );
        }
      } else {
        console.warn(
          `PERFORM_SEARCH_V2: Cookie jar not available on clientV2. Skipping XSRF update from jar.`
        );
      }
      if (xsrfTokenForPostRequest)
        updateXsrfTokenValue(xsrfTokenForPostRequest);
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

  // console.log(`PERFORM_SEARCH_V2: X-XSRF-TOKEN to be used in POST header: '${ xsrfTokenForPostRequest || "None"}'`); // Too verbose
  // console.log("PERFORM_SEARCH_V2: Search Payload for INPI:", JSON.stringify(searchPayload, null, 2)); // Too verbose

  let searchPostCookieHeader = "";
  if (clientV2.defaults.jar) {
    try {
      const allCookiesForSearchUrl = await clientV2.defaults.jar.getCookies(
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
  } else {
    console.warn(
      `PERFORM_SEARCH_V2: Cookie jar not available on clientV2. Manual XSRF may be needed if not already in global headers.`
    );
    if (xsrfTokenForPostRequest)
      searchPostCookieHeader = `XSRF-TOKEN=${xsrfTokenForPostRequest}`;
  }

  const requestHeaders: Record<string, string> = {
    Authorization: `Bearer ${bearerToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent":
      "Next.js Trademark Search App/1.0 (Backend Filtering Strategy - V11)", // Keep V11 for now or update if we make more backend changes
  };
  if (xsrfTokenForPostRequest)
    requestHeaders["X-XSRF-TOKEN"] = xsrfTokenForPostRequest;
  if (searchPostCookieHeader) requestHeaders["Cookie"] = searchPostCookieHeader;
  else if (xsrfTokenForPostRequest && !searchPostCookieHeader) {
    requestHeaders["Cookie"] = `XSRF-TOKEN=${xsrfTokenForPostRequest}`;
  }

  return clientV2.post("/api/marques/search", searchPayload, {
    headers: requestHeaders,
  });
}

export async function GET(request: Request) {
  console.log(
    "<<<<<< GET HANDLER - Backend Filtering Strategy (Confirmed V11 equivalent) >>>>>>"
  );
  try {
    const { searchParams } = new URL(request.url);
    const queryFromUser = searchParams.get("q");
    const pageFromUser = searchParams.get("page") || "1";
    const nbResultsPerPageFromUser =
      searchParams.get("nbResultsPerPage") || "20";
    const sortFieldFromUrl = searchParams.get("sort") || "relevance"; // prefer-const
    const orderFromUrl = searchParams.get("order") || "asc"; // prefer-const

    const niceClassesParam = searchParams.get("niceClasses");
    const originParam = searchParams.get("origin");
    const niceLogicFromUrl = searchParams.get("niceLogic");

    // Correctly parse niceLogicParam: default to 'AND'
    const niceLogicParam: "AND" | "OR" =
      niceLogicFromUrl?.toUpperCase() === "OR" ? "OR" : "AND";

    console.log(
      `GET HANDLER: Received niceLogicFromUrl: '${niceLogicFromUrl}', Parsed niceLogicParam: '${niceLogicParam}'`
    );

    if (!queryFromUser) {
      return NextResponse.json(
        { error: "Search query is required", code: "MISSING_QUERY" },
        { status: 400 }
      );
    }

    let processedQuery = queryFromUser.trim();
    if (processedQuery.includes(" ")) {
      processedQuery = `"${processedQuery.replace(/"/g, '"')}"`;
    }

    const solrQueryForINPI = `[Mark=${processedQuery}]`;

    let niceClassesForBackendFilter: number[] = [];
    if (niceClassesParam) {
      niceClassesForBackendFilter = niceClassesParam
        .split(",")
        .map((nc) => parseInt(nc.trim(), 10))
        .filter((nc) => !isNaN(nc) && nc > 0 && nc <= 45);
    }

    if (niceClassesForBackendFilter.length > 0) {
      console.log(
        "GET HANDLER: Nice Classes for backend filtering:",
        niceClassesForBackendFilter.join(", ")
      );
      console.log("GET HANDLER: Applying Nice Class logic:", niceLogicParam); // Log the logic being applied
    }
    if (originParam) {
      console.log("GET HANDLER: Origin for backend filtering:", originParam);
    }
    console.log("GET HANDLER: Solr Query to INPI:", solrQueryForINPI);

    const token = await getAccessToken(); // prefer-const
    const parsedPage = parseInt(pageFromUser);
    const parsedNbResultsPerPage = parseInt(nbResultsPerPageFromUser);
    let finalSortField: string;
    let finalSortOrder: string =
      orderFromUrl.toLowerCase() === "desc" ? "desc" : "asc";

    if (sortFieldFromUrl.toLowerCase() === "relevance") {
      finalSortField = "APPLICATION_DATE";
      finalSortOrder = "desc";
    } else {
      finalSortField = sortFieldFromUrl.toUpperCase();
    }

    const searchPayload: SearchPayload = {
      // Use SearchPayload type
      query: solrQueryForINPI,
      position: (parsedPage - 1) * parsedNbResultsPerPage,
      size: parsedNbResultsPerPage, // Fetch more for backend filtering if needed, or implement pagination on filtered results later
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

    // console.log("GET HANDLER: Payload for INPI:", JSON.stringify(searchPayload, null, 2).substring(0, 500) + "..."); // Too verbose

    try {
      const response = await performSearchV2(token, searchPayload);
      // console.log("GET HANDLER: INPI response status:", response.status); // Too verbose

      let responseData = response.data;

      if (responseData && Array.isArray(responseData.results)) {
        const initialCount = responseData.results.length;
        const hasNiceClassFilter = niceClassesForBackendFilter.length > 0;
        const hasOriginFilter =
          originParam && ["FR", "EU", "WO"].includes(originParam.toUpperCase());

        if (hasNiceClassFilter || hasOriginFilter) {
          responseData.results = responseData.results.filter(
            (item: InpiResultItem) => {
              // Use InpiResultItem type
              let matchesNiceClass = !hasNiceClassFilter; // Default to true if no Nice Class filter
              if (hasNiceClassFilter) {
                const classNumberField = Array.isArray(item.fields)
                  ? item.fields.find((f: InpiField) => f.name === "ClassNumber") // Use InpiField type
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

                  if (niceLogicParam === "OR") {
                    matchesNiceClass = niceClassesForBackendFilter.some(
                      (selectedCn) => itemClassNumbers.includes(selectedCn)
                    );
                  } else {
                    // Default to AND
                    matchesNiceClass = niceClassesForBackendFilter.every(
                      (selectedCn) => itemClassNumbers.includes(selectedCn)
                    );
                  }
                } else {
                  matchesNiceClass = false; // Item has no class numbers, so cannot match if filter is active
                }
              }

              let matchesOrigin = !hasOriginFilter; // Default to true if no Origin filter
              if (hasOriginFilter) {
                let derivedOrigin = "N/A";
                const ukeyField = Array.isArray(item.fields)
                  ? item.fields.find((f: InpiField) => f.name === "ukey") // Use InpiField type
                  : null;
                if (ukeyField && ukeyField.value) {
                  if (ukeyField.value.startsWith("FMARK")) derivedOrigin = "FR";
                  else if (ukeyField.value.startsWith("CTMARK"))
                    derivedOrigin = "EU";
                  else if (ukeyField.value.startsWith("TMINT"))
                    derivedOrigin = "WO";
                }
                if (derivedOrigin === "N/A") {
                  // Fallback if ukey is not definitive
                  const appNumField = Array.isArray(item.fields)
                    ? item.fields.find(
                        (f: InpiField) => f.name === "ApplicationNumber"
                      ) // Use InpiField type
                    : null;
                  if (appNumField && appNumField.value) {
                    const appNum = appNumField.value;
                    if (
                      appNum.length > 2 &&
                      /^[A-Z]{2}/.test(appNum.substring(0, 2))
                    ) {
                      const prefix = appNum.substring(0, 2).toUpperCase();
                      if (prefix === "FR") derivedOrigin = "FR";
                      else if (prefix === "EM" || prefix === "EU")
                        derivedOrigin = "EU";
                      else if (prefix === "WO") derivedOrigin = "WO";
                    } else if (
                      appNum.startsWith("0") &&
                      appNum.length >= 8 &&
                      appNum.length <= 9
                    ) {
                      // EUIPO numbers can start with 0
                      derivedOrigin = "EU";
                    }
                  }
                }
                matchesOrigin = derivedOrigin === originParam;
              }
              return matchesNiceClass && matchesOrigin;
            }
          );
          console.log(
            `GET HANDLER: Filtered ${initialCount} INPI results down to ${
              responseData.results.length
            }. Filters: Nice=[${niceClassesForBackendFilter.join(
              ","
            )}] (Logic: ${niceLogicParam}), Origin=[${originParam || "All"}]`
          );
        }
      } else {
        // Ensure results is always an array, even if API returns something else or it's missing
        responseData = { ...responseData, results: [] };
      }

      return NextResponse.json(responseData);
    } catch (error: unknown) {
      logError("GET_handler_searchRequest_catch", error);
      if (error instanceof APIError) throw error;
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
      throw new APIError(
        "Unexpected error during INPI search processing",
        500,
        { errorDetails: String(error) }
      );
    }
  } catch (error: unknown) {
    logError("GET_handler_main_catch", error);
    if (error instanceof APIError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.statusCode === 401 ? "UNAUTHORIZED" : "INTERNAL_ERROR",
          details: error.details,
          timestamp: new Date().toISOString(),
        },
        { status: error.statusCode }
      );
    }
    return NextResponse.json(
      {
        error: "An unexpected internal error occurred in GET handler.",
        code: "INTERNAL_ERROR",
        details: String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
