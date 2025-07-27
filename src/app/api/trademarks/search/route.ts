import { NextResponse } from "next/server";
import { performSearch } from "@/lib/inpi-search";
import { APIError, logError } from "@/lib/inpi-client";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");
    const page = searchParams.get("page") || "1";
    const nbResultsPerPage = searchParams.get("nbResultsPerPage") || "20";

    if (!query) {
      return NextResponse.json(
        { error: "Search query is required" },
        { status: 400 }
      );
    }

    const searchResults = await performSearch(
      query,
      parseInt(page),
      parseInt(nbResultsPerPage)
    );

    return NextResponse.json(searchResults);
  } catch (error) {
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
        error: "An unexpected internal error occurred.",
        code: "INTERNAL_ERROR",
        details: String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
