"use client";

import { useState, KeyboardEvent, ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

// Types for the trademark search results (assuming same structure for now)
const trademarkSchema = z.object({
  marque: z.string(),
  dateDepot: z.string(),
  produitsServices: z.string(),
  origine: z.string(),
  statut: z.string(),
  noticeUrl: z.string().optional(),
  applicationNumber: z.string().optional(),
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
      if (fieldName === "PublicationDate") return field.values[0];
      return field.values.join(", ");
    }
    return field.value;
  }
  return undefined;
}

/*************  ✨ Windsurf Command ⭐  *************/
/**
 * Formats a date string from "YYYYMMDD" format to "DD/MM/YYYY" format.
 *
 * @param {string} [yyyymmddStr] - The input date string in "YYYYMMDD" format.
 * @returns {string} - The formatted date string in "DD/MM/YYYY" format.
 *                     Returns "N/A" if the input is invalid or not in the expected format.
 */

/*******  9b77e6df-8389-4a62-b6c0-2b642584fc21  *******/ function formatDateDisplay(
  yyyymmddStr?: string
): string {
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

async function searchTrademarksV2(query: string): Promise<Trademark[]> {
  if (!query.trim()) {
    console.log("Frontend V2 Test Page: Empty query, not fetching.");
    return [];
  }

  console.log(
    `Frontend V2 Test Page: Fetching /api/trademarks/searchV2?q=${query}`
  );
  const response = await fetch(
    `/api/trademarks/searchV2?q=${encodeURIComponent(query)}`
  );
  const rawData = await response.json();

  if (!response.ok) {
    console.error("Frontend V2 Test Page: Search API call failed:", {
      status: response.status,
      data: rawData,
    });
    throw new Error(
      rawData.details ||
        rawData.error ||
        "Failed to fetch trademarks from backend V2 API"
    );
  }

  console.log(
    "Frontend V2 Test Page: Raw data received from backend API:",
    JSON.stringify(rawData, null, 2)
  );

  if (rawData && Array.isArray(rawData.results)) {
    const mappedResults: Trademark[] = rawData.results.map((item: any) => {
      const fieldsArray = Array.isArray(item.fields) ? item.fields : [];
      console.log(
        `Frontend V2 Test Page: Processing item with fieldsArray:`,
        JSON.stringify(fieldsArray, null, 2)
      );

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

      let produitsServicesText = "N/A"; // Default text
      const classNumberField = fieldsArray.find(
        (f) => f.name === "ClassNumber"
      );

      if (classNumberField) {
        let classNumbers: string[] = [];
        if (classNumberField.value) {
          // Handles single value case
          classNumbers = [classNumberField.value];
        } else if (
          Array.isArray(classNumberField.values) &&
          classNumberField.values.length > 0
        ) {
          // Handles array of values
          classNumbers = [...classNumberField.values];
        }

        if (classNumbers.length > 0) {
          // Sort numbers numerically before joining
          const sortedClassNumbers = classNumbers
            .map((cn) => parseInt(cn, 10)) // Convert to numbers for correct sorting
            .filter((cn) => !isNaN(cn)) // Filter out any NaN values if parsing fails
            .sort((a, b) => a - b) // Sort numerically
            .map((cn) => cn.toString()); // Convert back to strings
          produitsServicesText = sortedClassNumbers.join(", ");
        } else {
          console.log(
            "Frontend V2 Test Page: 'ClassNumber' field found but contained no usable values."
          );
          // produitsServicesText remains "N/A"
        }
      } else {
        console.log(
          "Frontend V2 Test Page: No 'ClassNumber' field found for this item."
        );
        // produitsServicesText remains "N/A"
      }

      console.log(
        "Frontend V2 Test Page: Final produitsServicesText (Nice Classification):",
        produitsServicesText
      );

      let rawDateToFormat = findFieldValue(fieldsArray, "RegistrationDate");
      if (!rawDateToFormat) {
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
        noticeUrl: item.xml?.href,
        applicationNumber:
          findFieldValue(fieldsArray, "ApplicationNumber") || undefined,
      };
    });
    console.log("Frontend V2 Test Page: Mapped results:", mappedResults);
    return mappedResults;
  } else {
    console.error(
      "Frontend V2 Test Page: API response format error from backend: 'results' array not found or not an array",
      rawData
    );
    return [];
  }
}

export default function TrademarkSearchV2TestPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const router = useRouter();

  const {
    data: trademarks,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery<Trademark[], Error>({
    queryKey: ["trademarksV2Test", submittedQuery],
    queryFn: () => searchTrademarksV2(submittedQuery),
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
      const noticeId = parts[parts.length - 1];
      if (noticeId) {
        router.push(`/trademarkDetails/${noticeId}`);
      } else {
        console.error("Could not extract noticeId from URL:", noticeUrl);
      }
    }
  };

  return (
    <main className="container mx-auto p-4 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8 text-center">
        Trademark Search (API V2 Test Page)
      </h1>

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
          {isLoading || isFetching ? "Searching (V2)..." : "Search (V2)"}
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
            <p className="font-semibold">Error loading results (V2)</p>
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
                key={`${trademark.applicationNumber}-${index}-${trademark.marque}-v2test`}
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
                      Produits et services / Classification de Nice (V2 Test)
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
            No results found for "{submittedQuery}" (V2 Test). Try a different
            search term.
          </div>
        ) : (
          <div className="text-center p-4 text-gray-400">
            Enter a brand name and click Search (V2) to test API V2.
          </div>
        )}
      </ScrollArea>
    </main>
  );
}
