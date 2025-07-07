"use client";

import { useState, KeyboardEvent, ChangeEvent } from "react";
import { useRouter } from "next/navigation"; // Import useRouter
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

// Types for the trademark search results
const trademarkSchema = z.object({
  marque: z.string(),
  dateDepot: z.string(),
  produitsServices: z.string(),
  origine: z.string(),
  statut: z.string(),
  noticeUrl: z.string().optional(), // URL to the INPI XML notice e.g. .../notice/EU13333497
  applicationNumber: z.string().optional(), // The numeric part or prefixed part
  // documentId might be more consistent for routing if it includes prefix
  // For now, we'll derive the ID for the detail page from noticeUrl
});

type Trademark = z.infer<typeof trademarkSchema>;

function findFieldValue(
  fields:
    | Array<{ name: string; value?: string; values?: string[] }>
    | undefined,
  fieldName: string
): string | undefined {
  if (!Array.isArray(fields)) {
    return undefined;
  }
  const field = fields.find((f) => f.name === fieldName);
  if (field) {
    if (Array.isArray(field.values) && field.values.length > 0) {
      // For PublicationDate, we want the first one. For DEPOSANT, join them.
      if (fieldName === "PublicationDate") return field.values[0];
      return field.values.join(", ");
    }
    return field.value;
  }
  return undefined;
}

function formatDateDisplay(yyyymmddStr?: string): string {
  if (!yyyymmddStr || yyyymmddStr.length !== 8) {
    return "N/A";
  }
  const year = yyyymmddStr.substring(0, 4);
  const month = yyyymmddStr.substring(4, 6);
  const day = yyyymmddStr.substring(6, 8);
  if (isNaN(parseInt(year)) || isNaN(parseInt(month)) || isNaN(parseInt(day))) {
    return "N/A";
  }
  return `${day}/${month}/${year}`;
}

async function searchTrademarks(query: string): Promise<Trademark[]> {
  if (!query.trim()) {
    console.log("Frontend: Empty query, not fetching.");
    return [];
  }

  console.log(`Frontend: Fetching /api/trademarks/search?q=${query}`);
  const response = await fetch(
    `/api/trademarks/search?q=${encodeURIComponent(query)}`
  );
  const rawData = await response.json();

  if (!response.ok) {
    console.error("Frontend: Search API call failed:", {
      status: response.status,
      data: rawData,
    });
    throw new Error(
      rawData.details ||
        rawData.error ||
        "Failed to fetch trademarks from backend API"
    );
  }

  console.log("Frontend: Raw data received from backend API:", rawData);

  if (rawData && Array.isArray(rawData.results)) {
    const mappedResults: Trademark[] = rawData.results.map((item: any) => {
      const fieldsArray = Array.isArray(item.fields) ? item.fields : [];

      let origine = "N/A";
      const ukey = findFieldValue(fieldsArray, "ukey");
      if (ukey) {
        if (ukey.startsWith("FMARK")) origine = "FR";
        else if (ukey.startsWith("CTMARK")) origine = "EU";
        else if (ukey.startsWith("TMINT")) origine = "WO";
      }
      if (origine === "N/A") {
        const appNumForOrigin = findFieldValue(
          fieldsArray,
          "ApplicationNumber"
        );
        if (appNumForOrigin) {
          if (
            appNumForOrigin.length > 2 &&
            /^[A-Z]{2}/.test(appNumForOrigin.substring(0, 2))
          ) {
            const prefix = appNumForOrigin.substring(0, 2).toUpperCase();
            if (prefix === "FR") origine = "FR";
            else if (prefix === "EU") origine = "EU";
            else if (prefix === "WO") origine = "WO";
          } else if (appNumForOrigin.startsWith("0")) {
            origine = "EU";
          }
        }
      }

      let produitsServicesText = "N/A";
      const niceClassField = fieldsArray.find(
        (f) => f.name === "NiceClassDetails"
      );
      if (niceClassField) {
        if (
          typeof niceClassField.value === "object" &&
          niceClassField.value !== null
        ) {
          try {
            const niceClassesInput = niceClassField.value;
            if (Array.isArray(niceClassesInput)) {
              const classNumbers = niceClassesInput
                .map((nc: any) => nc.classNumber)
                .filter(
                  (cn: any) => cn !== null && cn !== undefined && cn !== ""
                )
                .sort((a: string, b: string) => {
                  const numA = parseInt(a, 10);
                  const numB = parseInt(b, 10);
                  if (isNaN(numA) && isNaN(numB)) return 0;
                  if (isNaN(numA)) return 1; // Put non-numeric last
                  if (isNaN(numB)) return -1; // Put non-numeric last
                  return numA - numB;
                });

              if (classNumbers.length > 0) {
                produitsServicesText = `Classes: ${classNumbers.join(", ")}`;
              } else {
                // produitsServicesText remains 'N/A' (default) or we can set 'Classes: N/A'
                // Keeping 'N/A' if no numbers found for cleaner fallback.
              }
            } else if (
              typeof niceClassesInput === "object" &&
              niceClassesInput.classNumber
            ) {
              if (niceClassesInput.classNumber) {
                produitsServicesText = `Classes: ${niceClassesInput.classNumber}`;
              } // else produitsServicesText remains 'N/A'
            } else if (
              typeof niceClassesInput === "string" &&
              niceClassesInput.trim() !== ""
            ) {
              // If it's a pre-formatted string, use it directly.
              // This might happen if the API sometimes returns it differently.
              produitsServicesText = niceClassesInput;
            } else if (niceClassesInput) {
              // Catch other non-null, non-array, non-object-with-classNumber cases
              produitsServicesText = JSON.stringify(niceClassesInput);
            } // else produitsServicesText remains 'N/A'
          } catch (e) {
            console.error("Error parsing Nice classes in search results:", e);
            produitsServicesText = "Error parsing classes"; // More specific error
          }
        } else if (niceClassField.value) {
          produitsServicesText = niceClassField.value;
        } else if (
          Array.isArray(niceClassField.values) &&
          niceClassField.values.length > 0
        ) {
          produitsServicesText = niceClassField.values.join(", ");
        }
      }

      let rawDateToFormat = findFieldValue(fieldsArray, "RegistrationDate");
      if (!rawDateToFormat) {
        // findFieldValue for PublicationDate needs to be adjusted to return first value if it's an array
        const pubDateField = fieldsArray.find(
          (f) => f.name === "PublicationDate"
        );
        if (
          pubDateField &&
          Array.isArray(pubDateField.values) &&
          pubDateField.values.length > 0
        ) {
          rawDateToFormat = pubDateField.values[0];
        } else if (pubDateField && pubDateField.value) {
          rawDateToFormat = pubDateField.value;
        }
      }

      return {
        marque: findFieldValue(fieldsArray, "Mark") || "N/A",
        dateDepot: formatDateDisplay(rawDateToFormat),
        produitsServices: produitsServicesText,
        origine: origine,
        statut: findFieldValue(fieldsArray, "MarkCurrentStatusCode") || "N/A",
        noticeUrl: item.xml?.href, // This contains the full ID like EU13333497
        applicationNumber:
          findFieldValue(fieldsArray, "ApplicationNumber") || undefined,
      };
    });
    console.log("Frontend: Mapped results:", mappedResults);
    return mappedResults;
  } else {
    console.error(
      "Frontend: API response format error from backend: 'results' array not found or not an array",
      rawData
    );
    return [];
  }
}

export default function TrademarkSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const router = useRouter(); // Initialize router

  const {
    data: trademarks,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery<Trademark[], Error>({
    queryKey: ["trademarks", submittedQuery],
    queryFn: () => searchTrademarks(submittedQuery),
    enabled: !!submittedQuery,
    retry: 1,
  });

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setSubmittedQuery(searchQuery.trim());
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
  };

  const handleViewNotice = (noticeUrl?: string) => {
    if (noticeUrl) {
      const parts = noticeUrl.split("/");
      const noticeId = parts[parts.length - 1]; // Extracts "EU13333497" or "FR123456"
      if (noticeId) {
        router.push(`/trademarkDetails/${noticeId}`);
      } else {
        console.error("Could not extract noticeId from URL:", noticeUrl);
      }
    }
  };

  return (
    <main className="container mx-auto p-4 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8 text-center">Trademark Search</h1>

      <div className="flex gap-2 mb-6">
        <Input
          type="text"
          placeholder="Enter brand name..."
          value={searchQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          className="flex-1"
        />
        <Button
          onClick={handleSearch}
          disabled={!searchQuery.trim() || isLoading || isFetching}
        >
          <Search className="w-4 h-4 mr-2" />
          {isLoading || isFetching ? "Searching..." : "Search"}
        </Button>
      </div>

      <ScrollArea className="h-[600px] rounded-md border p-4">
        {(isLoading || isFetching) && submittedQuery ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="text-red-500 text-center p-4">
            <p className="font-semibold">Error loading results</p>
            <p className="text-sm mt-2">{error.message}</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => refetch()}
              disabled={isLoading || isFetching}
            >
              Try Again
            </Button>
          </div>
        ) : trademarks && trademarks.length > 0 ? (
          <div className="space-y-4">
            {trademarks.map((trademark: Trademark, index: number) => (
              <Card
                key={`${trademark.applicationNumber}-${index}-${trademark.marque}`}
                className="p-4"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h3 className="font-semibold">Marque</h3>
                    <p>{trademark.marque}</p>
                  </div>
                  <div>
                    <h3 className="font-semibold">
                      Date de dépôt / Publication
                    </h3>
                    <p>{trademark.dateDepot}</p>
                  </div>
                  <div className="md:col-span-2">
                    <h3 className="font-semibold">
                      Produits et services / Classification de Nice
                    </h3>
                    <p className="text-sm whitespace-pre-wrap">
                      {trademark.produitsServices}
                    </p>
                  </div>
                  <div>
                    <h3 className="font-semibold">Origine</h3>
                    <p>{trademark.origine}</p>
                  </div>
                  <div>
                    <h3 className="font-semibold">Statut</h3>
                    <p>{trademark.statut}</p>
                  </div>
                  {trademark.applicationNumber && (
                    <div>
                      <h3 className="font-semibold">N° Demande</h3>
                      <p>{trademark.applicationNumber}</p>
                    </div>
                  )}
                  {trademark.noticeUrl && (
                    <div className="md:col-span-2">
                      <Button
                        variant="link"
                        className="p-0 h-auto text-blue-600 hover:underline"
                        onClick={() => handleViewNotice(trademark.noticeUrl)}
                      >
                        Voir la notice complète (INPI)
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        ) : submittedQuery && !isLoading && !isFetching ? (
          <div className="text-center p-4 text-gray-500">
            No results found for "{submittedQuery}". Try a different search
            term.
          </div>
        ) : (
          <div className="text-center p-4 text-gray-400">
            Enter a brand name and click Search.
          </div>
        )}
      </ScrollArea>
    </main>
  );
}
