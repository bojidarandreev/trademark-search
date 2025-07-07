import { NextRequest, NextResponse } from "next/server"; // Added NextRequest back
import {
  client,
  getAccessToken,
  getXsrfTokenValue,
  logError,
  APIError,
} from "@/lib/inpi-client";
import axios from "axios";

const INPI_IMAGE_BASE_URL =
  "https://api-gateway.inpi.fr/services/apidiffusion/api/marques/image";

export async function GET(
  request: NextRequest, // Changed Request to NextRequest
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json(
      { error: "Trademark ID is required for image." },
      { status: 400 }
    );
  }

  console.log(`Fetching image for trademark ID: ${id}`);

  try {
    const token = await getAccessToken();
    const imageUrl = `${INPI_IMAGE_BASE_URL}/${id}/std`;
    const currentXsrf = getXsrfTokenValue();

    console.log(`Proxying image request to: ${imageUrl}`);
    console.log(
      `Using X-XSRF-TOKEN for image GET: ${currentXsrf || "None (if not set)"}`
    );

    const response = await client.get(imageUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-XSRF-TOKEN": currentXsrf || "",
        "User-Agent": "Next.js Trademark App/1.0 (Image Proxy)",
        // Important: Ensure the INPI API knows we can handle the image type
        Accept: "image/jpeg, image/png, image/*,*/*;q=0.8",
      },
      responseType: "arraybuffer", // Crucial for getting the image data as a buffer
    });

    console.log(
      `Successfully fetched image for ${id} from INPI, status: ${response.status}`
    );

    // Determine content type from INPI's response if available, otherwise default or try to infer
    const contentType = response.headers["content-type"] || "image/jpeg"; // Defaulting to jpeg

    // Return the image data with the correct content type
    // NextResponse cannot directly stream. We send the buffer.
    // For true streaming, one would use ReadableStream directly with new Response.
    return new NextResponse(response.data, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400", // Cache for a day
      },
    });
  } catch (error: unknown) {
    logError(`trademarkImageRoute-${id}`, error);
    if (error instanceof APIError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.statusCode,
          details: error.details,
        },
        { status: error.statusCode }
      );
    }
    if (axios.isAxiosError(error)) {
      // Log the actual error response from INPI if available
      console.error(
        "Axios error details:",
        error.response?.data
          ? Buffer.from(error.response.data).toString()
          : error.message
      );
      return NextResponse.json(
        {
          error: `Failed to fetch image: ${error.message}`,
          code: error.response?.status || 500,
        },
        { status: error.response?.status || 500 }
      );
    }
    return NextResponse.json(
      {
        error:
          "An unexpected error occurred while fetching the trademark image.",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    );
  }
}
