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
import { useMutation, useQueryClient } from "@tanstack/react-query";
// Removed debounce import
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

async function searchTrademarks(
  query: string,
  niceClasses: number[] = [],
  origin: string | null = null,
  niceLogic: "AND" | "OR" = "AND"
): Promise<Trademark[]> {
  if (!query.trim()) {
    console.log("Frontend: Empty query, not fetching.");
    return [];
  }

  const searchPayload = {
    query: {
      type: "brands",
      selectedIds: [],
      sort: "relevance",
      order: "asc",
      nbResultsPerPage: "20",
      page: "1",
      filter: {},
      q: query,
      advancedSearch: {},
      displayStyle: "List",
    },
    aggregations: [
      "markCurrentStatusCode",
      "markFeature",
      "registrationOfficeCode",
      "classDescriptionDetails.class",
    ],
  };

  const apiUrl = `/api/trademarks/searchV2`;
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(searchPayload),
  });

  const rawData = await response.json();
  if (!response.ok) {
    console.error("Frontend: Search API call failed:", {
      status: response.status,
      data: rawData,
    });
    throw new Error(
      rawData.details ||
        rawData.error ||
        "Failed to fetch trademarks from backend V2 API"
    );
  }

  if (rawData && rawData.result && Array.isArray(rawData.result.hits.hits)) {
    return rawData.result.hits.hits.map((item: any) => {
      const source = item._source;
      let produitsServicesText = "N/A";
      if (source.classDescriptionDetails) {
        produitsServicesText = source.classDescriptionDetails
          .map((c: any) => c.class)
          .sort((a: number, b: number) => a - b)
          .join(", ");
      }

      return {
        marque: source.markWordElement || "N/A",
        dateDepot: formatDateDisplay(source.applicationDate),
        produitsServices: produitsServicesText,
        origine: source.registrationOfficeCode || "N/A",
        statut: source.markCurrentStatusCode || "N/A",
        noticeUrl: source.markImageFileName
          ? `/trademarkDetails/${source.applicationNumberWithCountryCode}`
          : undefined,
        applicationNumber: source.applicationNumberWithCountryCode || undefined,
      };
    });
  } else {
    console.error(
      "Frontend: API response format error from backend: 'results' array not found or not an array",
      rawData
    );
    return [];
  }
}

// This new component will contain the actual page content and logic
function TrademarkSearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams(); // searchParams hook is now inside the Suspense boundary
  const queryClient = useQueryClient();

  // Initialize states to default values, will be set by useEffect
  const [searchQuery, setSearchQuery] = useState(""); // For the input field
  const [selectedNiceClasses, setSelectedNiceClasses] = useState<number[]>([]); // For interactive filter selection
  const [selectedOrigin, setSelectedOrigin] = useState<string | null>(null); // For interactive filter selection
  const [niceClassLogic, setNiceClassLogic] = useState<"AND" | "OR">("AND"); // For interactive filter selection

  // This state is still useful to know if a search has been submitted, for UI messages
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [isMounted, setIsMounted] = useState(false); // Controls query execution

  const searchMutation = useMutation<
    Trademark[],
    Error,
    {
      query: string;
      niceClasses: number[];
      origin: string | null;
      niceLogic: "AND" | "OR";
    }
  >({
    mutationFn: ({ query, niceClasses, origin, niceLogic }) =>
      searchTrademarks(query, niceClasses, origin, niceLogic),
    onSuccess: (data) => {
      queryClient.setQueryData(
        [
          "trademarks",
          submittedQuery,
          selectedNiceClasses.join(","),
          selectedOrigin,
          niceClassLogic,
        ],
        data
      );
    },
  });

  useEffect(() => {
    const qParam = searchParams.get("q") || "";
    const niceClassesParam = searchParams.get("niceClasses");
    const originParam = searchParams.get("origin");
    const niceLogicParam = searchParams.get("niceLogic");

    // Update interactive states
    setSearchQuery(qParam);
    const initialNiceClasses = niceClassesParam
      ? niceClassesParam
          .split(",")
          .map(Number)
          .filter((n) => !isNaN(n) && n > 0)
      : [];
    setSelectedNiceClasses(initialNiceClasses);
    const initialOrigin =
      originParam && ["FR", "EU", "WO"].includes(originParam.toUpperCase())
        ? originParam.toUpperCase()
        : null;
    setSelectedOrigin(initialOrigin);
    const initialNiceLogic =
      niceLogicParam === "OR" || niceLogicParam === "AND"
        ? niceLogicParam
        : "AND";
    setNiceClassLogic(initialNiceLogic);

    // Set submittedQuery if qParam exists, to control 'enabled' and UI messages
    if (qParam) {
      setSubmittedQuery(qParam);
      searchMutation.mutate({
        query: qParam,
        niceClasses: initialNiceClasses,
        origin: initialOrigin,
        niceLogic: initialNiceLogic,
      });
    }

    setIsMounted(true); // Indicate that params have been processed and component can render fully
  }, [searchParams, queryClient]);

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

      const newPath = `/${
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

  const handleNiceClassChange = (classId: number) => {
    const newSelectedClasses = selectedNiceClasses.includes(classId)
      ? selectedNiceClasses.filter((id) => id !== classId)
      : [...selectedNiceClasses, classId];
    setSelectedNiceClasses(newSelectedClasses);
  };

  const handleOriginChange = (value: string) => {
    const newOrigin = value === "ALL" ? null : value;
    setSelectedOrigin(newOrigin);
  };

  const handleNiceClassLogicChange = (value: "AND" | "OR") => {
    setNiceClassLogic(value);
  };

  const applySearchAndFilters = () => {
    const trimmedQuery = searchQuery.trim();
    setSubmittedQuery(trimmedQuery);
    updateUrl({
      q: trimmedQuery,
      niceClasses: selectedNiceClasses,
      origin: selectedOrigin,
      niceLogic: niceClassLogic,
    });
    searchMutation.mutate({
      query: trimmedQuery,
      niceClasses: selectedNiceClasses,
      origin: selectedOrigin,
      niceLogic: niceClassLogic,
    });
  };

  const handleSearch = () => {
    applySearchAndFilters();
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

  if (!isMounted) {
    return (
      <main className="container mx-auto p-4 max-w-4xl">
        <h1 className="text-3xl font-bold mb-8 text-center">
          Trademark Search
        </h1>
        <Skeleton className="h-10 w-full mb-6" />
        <Skeleton className="h-40 w-full mb-4" />
        <Skeleton className="h-10 w-full mb-6" />
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
      <h1 className="text-3xl font-bold mb-8 text-center">Trademark Search</h1>

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

      <div className="flex flex-col sm:flex-row gap-2 mb-6 items-center">
        <Input
          type="text"
          placeholder="Enter brand name..."
          value={searchQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          className="flex-1"
        />
        <div className="flex gap-2 mt-2 sm:mt-0">
          <Button
            onClick={handleSearch}
            disabled={searchMutation.isPending || !isMounted}
            className="w-full sm:w-auto"
          >
            <Search className="w-4 h-4 mr-2" />
            {searchMutation.isPending ? "Searching..." : "Search"}
          </Button>
          <Button
            onClick={applySearchAndFilters}
            disabled={searchMutation.isPending || !isMounted}
            variant="outline" // Or another style you prefer
            className="w-full sm:w-auto"
          >
            Apply Filters
          </Button>
        </div>
      </div>

      <ScrollArea className="h-[600px] rounded-md border p-4">
        {searchMutation.isPending ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : searchMutation.isError ? (
          <div className="text-red-500 text-center p-4">
            <p className="font-semibold">Error loading results</p>
            <p className="text-sm mt-2">{searchMutation.error.message}</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() =>
                searchMutation.mutate({
                  query: submittedQuery,
                  niceClasses: selectedNiceClasses,
                  origin: selectedOrigin,
                  niceLogic: niceClassLogic,
                })
              }
              disabled={searchMutation.isPending}
            >
              Try Again
            </Button>
          </div>
        ) : searchMutation.isSuccess && searchMutation.data.length > 0 ? (
          <div className="space-y-4">
            {searchMutation.data.map((trademark: Trademark, index: number) => (
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
        ) : submittedQuery && !searchMutation.isPending ? (
          <div className="text-center p-4 text-gray-500">
            No results found for &quot;{submittedQuery}&quot;. Try a different
            search term.
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

export default function TrademarkSearchPage() {
  return (
    <Suspense
      fallback={
        <main className="container mx-auto p-4 max-w-4xl">
          <h1 className="text-3xl font-bold mb-8 text-center">
            Trademark Search
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
      <TrademarkSearchPageContent />
    </Suspense>
  );
}
