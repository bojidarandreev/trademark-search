import { NextResponse } from "next/server";
import axios, { AxiosResponse } from "axios";
import { getCacheService } from "@/lib/cache-service"; // Import the cache service
import {
  client as apiClientV1, // Using existing client for cookie jar and auth logic
  getAccessToken,
  APIError,
  logError,
  getXsrfTokenValue,
  updateXsrfTokenValue,
  // clearAuthCache, // Unused
} from "@/lib/inpi-client";

const INPI_API_BASE_URL = "https://data.inpi.fr";
const ACTUAL_MARQUES_METADATA_ENDPOINT = `${INPI_API_BASE_URL}/api/marques/metadata`;
const ACTUAL_MARQUES_SEARCH_ENDPOINT = `${INPI_API_BASE_URL}/search`;

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
  searchPayload: any
): Promise<AxiosResponse<InpiSearchResponseData>> {
  console.log("<<<<<< performSearchV2 - Bila Hotfix >>>>>>");

  const requestHeaders: Record<string, string> = {
    "Content-Type": "text/plain;charset=UTF-8",
    Accept: "*/*",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  };

  return clientV2.post("/search", searchPayload, {
    headers: requestHeaders,
  });
}

export async function POST(request: Request) {
  console.log("<<<<<< POST HANDLER - Bila Hotfix >>>>>>");
  const cache = getCacheService(); // Get cache service instance

  try {
    const body = await request.json();
    const { query, aggregations } = body;
    const {
      q,
      page,
      nbResultsPerPage,
      sort,
      order,
      niceClasses,
      origin,
      niceLogic,
    } = query;

    // Construct a cache key from all relevant parameters
    // Ensure consistent ordering and stringification for cache key stability
    const cacheKeyParams = new URLSearchParams();
    if (q) cacheKeyParams.set("q", q);
    if (page) cacheKeyParams.set("page", page);
    if (nbResultsPerPage)
      cacheKeyParams.set("nbResultsPerPage", nbResultsPerPage);
    if (sort) cacheKeyParams.set("sort", sort);
    if (order) cacheKeyParams.set("order", order);
    if (niceClasses) cacheKeyParams.set("niceClasses", niceClasses);
    if (origin) cacheKeyParams.set("origin", origin);
    if (niceLogic) cacheKeyParams.set("niceLogic", niceLogic); // Use the original value from URL for cache key

    const cacheKey = `searchV2:${cacheKeyParams.toString()}`;

    const cachedData = cache.get<InpiSearchResponseData>(cacheKey);
    if (cachedData) {
      console.log(`[CACHE_SERVICE] Cache hit for key: ${cacheKey}`);
      return NextResponse.json(cachedData);
    }
    console.log(
      `[CACHE_SERVICE] Cache miss for key: ${cacheKey}. Fetching from INPI.`
    );

    if (!q) {
      return NextResponse.json(
        { error: "Search query is required", code: "MISSING_QUERY" },
        { status: 400 }
      );
    }

    const token = await getAccessToken();

    const searchPayload = {
      query: {
        type: "brands",
        selectedIds: [],
        sort: sort,
        order: order,
        nbResultsPerPage: nbResultsPerPage.toString(),
        page: page.toString(),
        filter: {},
        q: q,
        advancedSearch: {},
        displayStyle: "List",
      },
      aggregations: aggregations,
    };

    const response = await performSearchV2(
      token,
      JSON.stringify(searchPayload)
    );

    let responseData = response.data;

    const niceClassesForBackendFilter = niceClasses
      ? niceClasses
          .split(",")
          .map((nc: string) => parseInt(nc.trim(), 10))
          .filter((nc: number) => !isNaN(nc) && nc > 0 && nc <= 45)
      : [];
    const niceLogicParam = niceLogic?.toUpperCase() === "OR" ? "OR" : "AND";
    const originParam = origin;

    if (responseData && Array.isArray(responseData.result.hits.hits)) {
      const initialCount = responseData.result.hits.hits.length;
      const hasNiceClassFilter = niceClassesForBackendFilter.length > 0;
      const hasOriginFilter =
        originParam && ["FR", "EU", "WO"].includes(originParam.toUpperCase());

      if (hasNiceClassFilter || hasOriginFilter) {
        responseData.result.hits.hits = responseData.result.hits.hits.filter(
          (item: any) => {
            let matchesNiceClass = !hasNiceClassFilter;
            if (hasNiceClassFilter) {
              const classDescriptionDetails =
                item._source.classDescriptionDetails;
              if (classDescriptionDetails) {
                const itemClassesRaw = classDescriptionDetails.map(
                  (c: any) => c.class
                );
                const itemClassNumbers = itemClassesRaw
                  .map((cn: any) => parseInt(cn, 10))
                  .filter((cn: any) => !isNaN(cn));

                if (niceLogicParam === "OR") {
                  matchesNiceClass = niceClassesForBackendFilter.some(
                    (selectedCn: number) =>
                      itemClassNumbers.includes(selectedCn)
                  );
                } else {
                  matchesNiceClass = niceClassesForBackendFilter.every(
                    (selectedCn: number) =>
                      itemClassNumbers.includes(selectedCn)
                  );
                }
              } else {
                matchesNiceClass = false;
              }
            }

            let matchesOrigin = !hasOriginFilter;
            if (hasOriginFilter) {
              let derivedOrigin = "N/A";
              const registrationOfficeCode =
                item._source.registrationOfficeCode;
              if (registrationOfficeCode) {
                derivedOrigin = registrationOfficeCode;
              }
              matchesOrigin = derivedOrigin === originParam;
            }
            return matchesNiceClass && matchesOrigin;
          }
        );
        console.log(
          `POST HANDLER: Filtered ${initialCount} INPI results down to ${
            responseData.result.hits.hits.length
          }. Filters: Nice=[${niceClassesForBackendFilter.join(
            ","
          )}] (Logic: ${niceLogicParam}), Origin=[${originParam || "All"}]`
        );
      }
    } else {
      responseData = { ...responseData, result: { hits: { hits: [] } } };
    }

    cache.set(cacheKey, responseData, undefined);
    console.log(`[CACHE_SERVICE] Data stored in cache for key: ${cacheKey}`);

    return NextResponse.json(responseData);
  } catch (error: unknown) {
    logError("POST_handler_main_catch", error);
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
    console.log("error in post", error);
    return NextResponse.json(
      {
        error: "An unexpected internal error occurred in POST handler.",
        code: "INTERNAL_ERROR",
        details: String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
