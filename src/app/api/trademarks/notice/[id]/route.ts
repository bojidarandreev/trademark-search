import { NextRequest, NextResponse } from "next/server"; // Import NextRequest
import {
  client,
  getAccessToken,
  APIError,
  logError,
  getXsrfTokenValue, // To send XSRF if available/needed
  // We might need a way to refresh the search-specific XSRF token if this route is hit independently
  // For now, assume getAccessToken followed by a call to metadata (if needed) would be handled
  // by the client-side logic before calling this, or that the login XSRF is sufficient for GETs.
} from "@/lib/inpi-client"; // Adjust path if your lib folder is elsewhere
import { parseStringPromise } from "xml2js";
import axios from "axios"; // For AxiosError type checking

const INPI_API_BASE_URL = "https://api-gateway.inpi.fr";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> } // Destructured params promise
) {
  // To address the "params should be awaited" warning, ensure context.params is accessed correctly.
  // For Route Handlers, context.params is directly available.
  const { id } = await params; // Await the destructured params

  if (!id) {
    return NextResponse.json(
      { error: "Trademark ID is required." },
      { status: 400 }
    );
  }

  console.log(`Fetching notice for trademark ID: ${id}`);

  try {
    const token = await getAccessToken(); // Ensure authenticated session
    const noticeUrl = `${INPI_API_BASE_URL}/services/apidiffusion/api/marques/notice/${id}`;

    // It's good practice to try and get a fresh XSRF token for the service if possible,
    // but for a GET request, it might not be strictly necessary if the Bearer token is enough
    // and the session is established. We'll use whatever is in getXsrfTokenValue().
    // If this notice endpoint is under /services/apidiffusion/, the XSRF token obtained
    // via the metadata endpoint GET in the search flow should ideally be used.
    // However, this route might be called independently.
    // For simplicity now, we rely on the XSRF token already in the jar or set by getAccessToken.
    // A more robust solution might involve a preliminary call here too if XSRF issues arise.

    const currentXsrf = getXsrfTokenValue();
    console.log(
      `Using X-XSRF-TOKEN for notice GET: ${currentXsrf || "None (if not set)"}`
    );

    const response = await client.get(noticeUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/xml", // This endpoint returns XML
        "X-XSRF-TOKEN": currentXsrf || "", // Send if available
        "User-Agent": "Next.js Trademark App/1.0 (Notice Fetcher)",
      },
      responseType: "text", // Get response as text to parse XML
    });

    console.log(
      `Successfully fetched XML notice for ${id}, status: ${response.status}`
    );

    // Parse XML to JSON
    // Options: explicitArray: false to avoid single-element arrays for simple tags.
    // mergeAttrs: true to merge attributes into properties.
    const parsedJson = await parseStringPromise(response.data, {
      explicitArray: false,
      mergeAttrs: true,
      charkey: "_text", // Use _text for text content to avoid conflict with child nodes of same name
      attrkey: "_attrs", // Store attributes in _attrs
      tagNameProcessors: [(name) => name.replace(/-/g, "_")], // Replace hyphens in tag names
    });

    // The root element in INPI's ST66 XML is often <TradeMarkType>
    // xml2js will parse this into an object like { TradeMarkType: { ...details... } }
    // We can return the inner object for cleaner frontend access.
    const noticeData =
      parsedJson.TradeMarkType || parsedJson.FrPatentDocument || parsedJson; // Adjust if root element varies

    return NextResponse.json(noticeData);
  } catch (error: unknown) {
    logError(`noticeRoute-${id}`, error);
    if (error instanceof APIError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.statusCode,
          details: error.details,
          timestamp: new Date().toISOString(),
        },
        { status: error.statusCode }
      );
    }
    if (axios.isAxiosError(error)) {
      return NextResponse.json(
        {
          error: `Failed to fetch notice: ${
            error.response?.data || error.message
          }`,
          code: error.response?.status || 500,
          details: error.response?.data,
          timestamp: new Date().toISOString(),
        },
        { status: error.response?.status || 500 }
      );
    }
    return NextResponse.json(
      {
        error:
          "An unexpected error occurred while fetching the trademark notice.",
        code: "INTERNAL_ERROR",
        details: String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
