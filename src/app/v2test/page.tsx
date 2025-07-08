"use client";

export const dynamic = "force-dynamic"; // Tell Next.js to always render this page dynamically

import {
  useState,
  KeyboardEvent,
  ChangeEvent,
  useEffect,
  useCallback,
  Suspense, // Import Suspense
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

// Define interfaces for the raw data structure from the API (similar to page.tsx)
interface InpiField {
  name: string;
  value?: string | Record<string, unknown> | Array<Record<string, unknown>>; // Changed any to unknown
  values?: string[];
}

interface RawInpiResultItem {
  fields: InpiField[];
  xml?: { href?: string };
}

// Nice Classification Classes (Hardcoded)
const niceClassesList = [
  { id: 1, title: "Class 1: Chemicals, resins, plastics" },
  { id: 2, title: "Class 2: Paints, colorants, inks" },
  { id: 3, title: "Class 3: Cosmetics, cleaning preparations" },
  { id: 4, title: "Class 4: Industrial oils, greases, fuels" },
  { id: 5, title: "Class 5: Pharmaceuticals, medical supplies" },
  { id: 6, title: "Class 6: Common metals and their alloys" },
  { id: 7, title: "Class 7: Machines and machine tools" },
  { id: 8, title: "Class 8: Hand tools and implements" },
  { id: 9, title: "Class 9: Scientific, electric, electronic apparatus" },
  { id: 10, title: "Class 10: Medical and veterinary apparatus" },
  { id: 11, title: "Class 11: Environmental control apparatus" },
  { id: 12, title: "Class 12: Vehicles" },
  { id: 13, title: "Class 13: Firearms, ammunition, explosives" },
  { id: 14, title: "Class 14: Precious metals, jewellery" },
  { id: 15, title: "Class 15: Musical instruments" },
  { id: 16, title: "Class 16: Paper goods, printed matter" },
  { id: 17, title: "Class 17: Rubber, plastics, insulating materials" },
  { id: 18, title: "Class 18: Leather goods, luggage" },
  { id: 19, title: "Class 19: Building materials (non-metallic)" },
  { id: 20, title: "Class 20: Furniture, mirrors, picture frames" },
  { id: 21, title: "Class 21: Household utensils, glassware" },
  { id: 22, title: "Class 22: Ropes, tents, padding materials" },
  { id: 23, title: "Class 23: Yarns and threads" },
  { id: 24, title: "Class 24: Textiles and textile goods" },
  { id: 25, title: "Class 25: Clothing, footwear, headgear" },
  { id: 26, title: "Class 26: Lace and embroidery, buttons, etc." },
  { id: 27, title: "Class 27: Floor coverings, wall hangings" },
  { id: 28, title: "Class 28: Games, toys, sporting goods" },
  { id: 29, title: "Class 29: Meat, fish, poultry, dairy products" },
  { id: 30, title: "Class 30: Coffee, tea, cocoa, bakery goods" },
  { id: 31, title: "Class 31: Agricultural, horticultural products" },
  { id: 32, title: "Class 32: Beers, non-alcoholic beverages" },
  { id: 33, title: "Class 33: Alcoholic beverages (except beers)" },
  { id: 34, title: "Class 34: Tobacco, smokers' articles" },
  { id: 35, title: "Class 35: Advertising, business management" },
  { id: 36, title: "Class 36: Insurance, financial, real estate" },
  { id: 37, title: "Class 37: Construction, repair, installation" },
  { id: 38, title: "Class 38: Telecommunications" },
  { id: 39, title: "Class 39: Transport, packaging, storage" },
  { id: 40, title: "Class 40: Treatment of materials" },
  { id: 41, title: "Class 41: Education, entertainment, sports" },
  { id: 42, title: "Class 42: Scientific, technological services" },
  { id: 43, title: "Class 43: Services for providing food and drink" },
  { id: 44, title: "Class 44: Medical, veterinary, beauty services" },
  { id: 45, title: "Class 45: Legal, security, personal services" },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _trademarkSchema = z.object({
  // Prefixed with underscore (ensuring this exact state)
  marque: z.string(),
  dateDepot: z.string(),
  produitsServices: z.string(),
  origine: z.string(),
  statut: z.string(),
  noticeUrl: z.string().optional(),
  applicationNumber: z.string().optional(),
});

type Trademark = z.infer<typeof _trademarkSchema>; // Use underscored name

function findFieldValue(
  fields: InpiField[] | undefined, // Use InpiField type
  fieldName: string
): string | undefined {
  if (!Array.isArray(fields)) return undefined;
  const field = fields.find((f) => f.name === fieldName);
  if (field) {
    if (Array.isArray(field.values) && field.values.length > 0) {
      if (fieldName === "PublicationDate") return field.values[0];
      return field.values.join(", ");
    }
    if (typeof field.value === "string") {
      return field.value;
    }
    // If field.value is not a string (e.g., for complex fields),
    // this helper should return undefined as it's for simple string extraction.
    return undefined;
  }
  return undefined;
}

function formatDateDisplay(yyyymmddStr?: string): string {
  if (!yyyymmddStr || yyyymmddStr.length !== 8) return "N/A";
  const year = yyyymmddStr.substring(0, 4);
  const month = yyyymmddStr.substring(4, 6);
  const day = yyyymmddStr.substring(6, 8);
  if (isNaN(parseInt(year)) || isNaN(parseInt(month)) || isNaN(parseInt(day)))
    return "N/A";
  return `${day}/${month}/${year}`;
}

async function searchTrademarksV2(
  query: string,
  niceClasses: number[] = [],
  origin: string | null = null,
  niceLogic: "AND" | "OR" = "AND"
): Promise<Trademark[]> {
  if (!query.trim()) {
    console.log("Frontend V2 Test Page: Empty query, not fetching.");
    return [];
  }
  const params = new URLSearchParams();
  params.append("q", query);

  if (niceClasses.length > 0) {
    params.append("niceClasses", niceClasses.join(","));
    // Always send niceLogic if classes are present
    params.append("niceLogic", niceLogic);
  }
  if (origin) {
    params.append("origin", origin);
  }

  // ***** JULES DEBUG MARK 1 *****
  console.log(
    `[JULES_DEBUG_MARK_1] searchTrademarksV2 called with: query='${query}', niceClasses=[${niceClasses.join(
      ","
    )}] niceLogic='${niceLogic}', origin='${origin}'`
  );
  const finalParamsString = params.toString();
  const apiUrl = `/api/trademarks/searchV2?${finalParamsString}`;
  // ***** JULES DEBUG MARK 2 *****
  console.log(`[JULES_DEBUG_MARK_2] Fetching final apiUrl: ${apiUrl}`);
  const response = await fetch(apiUrl);
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
  // console.log("Frontend V2 Test Page: Raw data received from backend API:", JSON.stringify(rawData, null, 2)); // Optional: too verbose for now
  if (rawData && Array.isArray(rawData.results)) {
    return rawData.results.map((item: RawInpiResultItem) => {
      // Use RawInpiResultItem type
      const fieldsArray: InpiField[] = Array.isArray(item.fields)
        ? item.fields
        : []; // Ensure fieldsArray is InpiField[]
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
            else if (prefix === "EU" || prefix === "EM") origine = "EU";
            else if (prefix === "WO") origine = "WO";
          } else if (
            appNumForOrigin.startsWith("0") &&
            appNumForOrigin.length >= 8 &&
            appNumForOrigin.length <= 9
          ) {
            origine = "EU";
          }
        }
      }
      let produitsServicesText = "N/A";
      const classNumberField = fieldsArray.find(
        (f) => f.name === "ClassNumber"
      );
      if (classNumberField) {
        let classNumbersStrings: string[] = [];
        if (
          typeof classNumberField.value === "string" &&
          classNumberField.value.trim() !== ""
        ) {
          classNumbersStrings = [classNumberField.value.trim()];
        } else if (
          Array.isArray(classNumberField.values) &&
          classNumberField.values.length > 0
        ) {
          // Assuming classNumberField.values are already strings or need filtering/mapping
          // For now, let's assume they are strings as per typical usage for simple values array
          classNumbersStrings = classNumberField.values.filter(
            (v) => typeof v === "string" && v.trim() !== ""
          );
        }

        if (classNumbersStrings.length > 0) {
          produitsServicesText = classNumbersStrings
            .map((cn) => parseInt(cn, 10))
            .filter((cn) => !isNaN(cn))
            .sort((a, b) => a - b)
            .map(String)
            .join(", ");
        }
      }
      let rawDateToFormat = findFieldValue(fieldsArray, "RegistrationDate");
      if (!rawDateToFormat) {
        const pubDateField = fieldsArray.find(
          (f) => f.name === "PublicationDate"
        );
        if (
          pubDateField &&
          Array.isArray(pubDateField.values) &&
          pubDateField.values.length > 0
        )
          rawDateToFormat = pubDateField.values[0];
        else if (pubDateField && typeof pubDateField.value === "string")
          // Check if string
          rawDateToFormat = pubDateField.value;
        // If pubDateField.value is not a string, rawDateToFormat remains unchanged.
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
  } else {
    console.error(
      "Frontend V2 Test Page: API response format error from backend: 'results' array not found or not an array",
      rawData
    );
    return [];
  }
}

// This new component will contain the actual page content and logic
function V2TestPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams(); // searchParams hook is now inside the Suspense boundary

  // Initialize states to default values, will be set by useEffect
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selectedNiceClasses, setSelectedNiceClasses] = useState<number[]>([]);
  const [selectedOrigin, setSelectedOrigin] = useState<string | null>(null);
  const [niceClassLogic, setNiceClassLogic] = useState<"AND" | "OR">("AND");
  const [isMounted, setIsMounted] = useState(false); // Controls query execution

  useEffect(() => {
    const qParam = searchParams.get("q") || "";
    const niceClassesParam = searchParams.get("niceClasses");
    const originParam = searchParams.get("origin");
    const niceLogicParam = searchParams.get("niceLogic");

    setSearchQuery(qParam);
    setSubmittedQuery(qParam);
    setSelectedNiceClasses(
      niceClassesParam
        ? niceClassesParam
            .split(",")
            .map(Number)
            .filter((n) => !isNaN(n) && n > 0)
        : []
    );
    setSelectedOrigin(
      originParam && ["FR", "EU", "WO"].includes(originParam.toUpperCase())
        ? originParam.toUpperCase()
        : null
    );
    setNiceClassLogic(
      niceLogicParam === "OR" || niceLogicParam === "AND"
        ? niceLogicParam
        : "AND"
    );
    setIsMounted(true); // Indicate that params have been processed and component can render fully
  }, [searchParams]);

  const updateUrl = useCallback(
    (newStates: {
      q?: string;
      niceClasses?: number[];
      origin?: string | null;
      niceLogic?: "AND" | "OR";
    }) => {
      const currentParamsFromHook = new URLSearchParams(
        searchParams.toString()
      );
      const finalQ =
        newStates.q !== undefined
          ? newStates.q
          : currentParamsFromHook.get("q");
      const finalNC =
        newStates.niceClasses !== undefined
          ? newStates.niceClasses
          : currentParamsFromHook
              .get("niceClasses")
              ?.split(",")
              .map(Number)
              .filter((n) => !isNaN(n) && n > 0) || [];
      const finalOrigin =
        newStates.origin !== undefined
          ? newStates.origin
          : (currentParamsFromHook.get("origin") as string | null);
      const finalNiceLogic =
        newStates.niceLogic !== undefined
          ? newStates.niceLogic
          : (currentParamsFromHook.get("niceLogic") as "AND" | "OR") || "AND";

      const paramsToSet = new URLSearchParams();
      if (finalQ) paramsToSet.set("q", finalQ);
      if (finalNC.length > 0) {
        paramsToSet.set("niceClasses", finalNC.join(","));
        paramsToSet.set("niceLogic", finalNiceLogic);
      } else {
        paramsToSet.delete("niceLogic");
      }
      if (finalOrigin) paramsToSet.set("origin", finalOrigin);

      const newPath = `/v2test${
        paramsToSet.toString() ? `?${paramsToSet.toString()}` : ""
      }`;
      if (
        typeof window !== "undefined" &&
        window.location.pathname + window.location.search !== newPath
      ) {
        router.push(newPath, { scroll: false });
      }
    },
    [router, searchParams]
  );

  const {
    data: trademarks,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery<Trademark[], Error>({
    queryKey: [
      "trademarksV2Test",
      submittedQuery,
      selectedNiceClasses.join(","),
      selectedOrigin,
      niceClassLogic,
    ],
    queryFn: () => {
      return searchTrademarksV2(
        submittedQuery,
        selectedNiceClasses,
        selectedOrigin,
        niceClassLogic
      );
    },
    enabled: !!submittedQuery && isMounted, // Enable query only when mounted and submittedQuery is present
    retry: 1,
  });

  const handleNiceClassChange = (classId: number) => {
    const newSelectedClasses = selectedNiceClasses.includes(classId)
      ? selectedNiceClasses.filter((id) => id !== classId)
      : [...selectedNiceClasses, classId];
    updateUrl({
      niceClasses: newSelectedClasses,
      q: submittedQuery,
      origin: selectedOrigin,
      niceLogic: niceClassLogic,
    });
  };

  const handleOriginChange = (value: string) => {
    const newOrigin = value === "ALL" ? null : value;
    updateUrl({
      origin: newOrigin,
      q: submittedQuery,
      niceClasses: selectedNiceClasses,
      niceLogic: niceClassLogic,
    });
  };

  const handleNiceClassLogicChange = (value: "AND" | "OR") => {
    updateUrl({
      niceLogic: value,
      q: submittedQuery,
      niceClasses: selectedNiceClasses,
      origin: selectedOrigin,
    });
  };

  const handleSearch = () => {
    const trimmedQuery = searchQuery.trim();
    updateUrl({
      q: trimmedQuery,
      niceClasses: selectedNiceClasses,
      origin: selectedOrigin,
      niceLogic: niceClassLogic,
    });
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

  // Conditional rendering based on isMounted to avoid using params-derived state before hydration
  if (!isMounted) {
    // Render a basic skeleton or loading state before client-side hydration and param processing
    return (
      <main className="container mx-auto p-4 max-w-4xl">
        <h1 className="text-3xl font-bold mb-8 text-center">
          Trademark Search (API V2 Test Page)
        </h1>
        <Skeleton className="h-10 w-full mb-6" /> {/* Input + Button */}
        <Skeleton className="h-40 w-full mb-4" /> {/* Nice Class Filters */}
        <Skeleton className="h-10 w-full mb-6" /> {/* Origin Filters */}
        <ScrollArea className="h-[600px] rounded-md border p-4">
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={`mount-skel-${i}`} className="h-32 w-full" />
            ))}
          </div>
        </ScrollArea>
      </main>
    );
  }

  return (
    <main className="container mx-auto p-4 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8 text-center">
        Trademark Search (API V2 Test Page)
      </h1>

      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-3">
          Filter by Nice Classification
        </h2>
        <ScrollArea className="h-40 rounded-md border p-4 mb-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
            {niceClassesList.map((niceClass) => (
              <div key={niceClass.id} className="flex items-center space-x-2">
                <Checkbox
                  id={`nice-class-${niceClass.id}`}
                  checked={selectedNiceClasses.includes(niceClass.id)}
                  onCheckedChange={() => handleNiceClassChange(niceClass.id)}
                />
                <Label
                  htmlFor={`nice-class-${niceClass.id}`}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  {niceClass.title}
                </Label>
              </div>
            ))}
          </div>
        </ScrollArea>
        <p className="text-sm text-muted-foreground">
          Selected Classes:{" "}
          {selectedNiceClasses.sort((a, b) => a - b).join(", ") || "None"}
        </p>
        <div className="mt-2">
          <RadioGroup
            value={niceClassLogic}
            onValueChange={(value) =>
              handleNiceClassLogicChange(value as "AND" | "OR")
            }
            className="flex space-x-4"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="AND" id="nice-logic-and" />
              <Label htmlFor="nice-logic-and">
                Match ALL selected classes (AND)
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="OR" id="nice-logic-or" />
              <Label htmlFor="nice-logic-or">
                Match ANY selected class (OR)
              </Label>
            </div>
          </RadioGroup>
        </div>
      </div>

      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-3">Filter by Origin</h2>
        <RadioGroup
          value={selectedOrigin || "ALL"}
          onValueChange={handleOriginChange}
          className="flex space-x-4"
        >
          {["ALL", "FR", "EU", "WO"].map((originValue) => (
            <div key={originValue} className="flex items-center space-x-2">
              <RadioGroupItem
                value={originValue}
                id={`origin-${originValue}`}
              />
              <Label htmlFor={`origin-${originValue}`}>{originValue}</Label>
            </div>
          ))}
        </RadioGroup>
      </div>

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
          disabled={isLoading || isFetching || !isMounted}
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
            No results found for &quot;{submittedQuery}&quot; (V2 Test). Try a
            different search term.
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

export default function TrademarkSearchV2TestPage() {
  return (
    <Suspense
      fallback={
        <main className="container mx-auto p-4 max-w-4xl">
          <h1 className="text-3xl font-bold mb-8 text-center">
            Trademark Search (API V2 Test Page)
          </h1>
          <Skeleton className="h-10 w-full mb-6" />{" "}
          {/* Search Input + Button */}
          <Skeleton className="h-40 w-full mb-4" />{" "}
          {/* Nice Class Filters Area */}
          <Skeleton className="h-10 w-full mb-6" /> {/* Origin Filters Area */}
          <ScrollArea className="h-[600px] rounded-md border p-4">
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={`fallback-skel-${i}`} className="h-32 w-full" />
              ))}
            </div>
          </ScrollArea>
        </main>
      }
    >
      <V2TestPageContent />
    </Suspense>
  );
}
