import { NextResponse } from "next/server";
import axios, { AxiosError } from "axios";

const INPI_API_BASE_URL = "https://api-gateway.inpi.fr";
const INPI_AUTH_URL = `${INPI_API_BASE_URL}/services/uaa/api/authenticate`;
const INPI_TOKEN_URL = `${INPI_API_BASE_URL}/services/uaa/oauth/token`;
const INPI_SEARCH_URL = `${INPI_API_BASE_URL}/services/apidiffusion/api/marques/search`;

// Cache the access token and XSRF token
let accessToken: string | null = null;
let xsrfToken: string | null = null;
let tokenExpiry: number | null = null;

// Custom error class for API errors
class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: any,
    public headers?: any
  ) {
    super(message);
    this.name = 'APIError';
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
  // Return cached token if it's still valid (with 5-minute buffer)
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry - 5 * 60 * 1000) {
    console.log("Using cached access token");
    return accessToken;
  }

  try {
    console.log("Requesting new access token...");

    // Step 1: Initial authentication with Basic Auth
    const authResponse = await axios.post(
      INPI_AUTH_URL,
      {},
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from("galaparicheva@oolith.eu:Waters36023702??").toString("base64")}`,
        },
        withCredentials: true,
      }
    );

    // Extract XSRF token from response headers
    const xsrfTokenHeader = authResponse.headers["x-csrf-token"];
    if (!xsrfTokenHeader) {
      throw new APIError(
        "Failed to obtain CSRF token",
        500,
        { headers: authResponse.headers }
      );
    }

    xsrfToken = xsrfTokenHeader;
    console.log("Extracted XSRF token:", xsrfToken);

    // Step 2: Get OAuth token
    const tokenResponse = await axios.post(
      INPI_TOKEN_URL,
      new URLSearchParams({
        grant_type: "client_credentials",
        scope: "openid profile email marques",
      }).toString(),
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "X-XSRF-TOKEN": xsrfToken,
          Authorization: `Basic ${Buffer.from("galaparicheva@oolith.eu:Waters36023702??").toString("base64")}`,
        },
        withCredentials: true,
      }
    );

    console.log("Token response:", tokenResponse.data);

    if (!tokenResponse.data.access_token) {
      throw new APIError(
        "No access token in response",
        500,
        { response: tokenResponse.data }
      );
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

    throw new APIError(
      "Unexpected error during authentication",
      500,
      { error: error instanceof Error ? error.message : String(error) }
    );
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
          code: "MISSING_QUERY"
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
                  "X-XSRF-TOKEN": xsrfToken || "",
                },
                withCredentials: true,
              }
            );

            return NextResponse.json(retryResponse.data);
          } catch (retryError: unknown) {
            logError("searchRetry", retryError);
            throw new APIError(
              "Failed to retry search after token refresh",
              500,
              { 
                originalError: error instanceof Error ? error.message : String(error),
                retryError: retryError instanceof Error ? retryError.message : String(retryError)
              }
            );
          }
        }

        // Handle other API errors
        const message = error.response?.data?.error_description || error.message;
        throw new APIError(
          `Search failed: ${message}`,
          status || 500,
          error.response?.data,
          error.response?.headers
        );
      }

      throw new APIError(
        "Unexpected error during search",
        500,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  } catch (error: unknown) {
    logError("searchRoute", error);

    if (error instanceof APIError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.statusCode === 401 ? "UNAUTHORIZED" : 
                error.statusCode === 403 ? "FORBIDDEN" : "INTERNAL_ERROR",
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
