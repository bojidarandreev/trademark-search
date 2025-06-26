'use client';

import { useState, KeyboardEvent, ChangeEvent } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

// Types for the trademark search results
const trademarkSchema = z.object({
  marque: z.string(),
  dateDepot: z.string(), // Corresponds to PublicationDate or RegistrationDate from INPI
  produitsServices: z.string(), // Corresponds to NiceClassDetails (needs parsing if complex)
  origine: z.string(), // Derived from ApplicationNumber prefix or a specific field if available
  statut: z.string(), // Corresponds to MarkCurrentStatusCode
  noticeUrl: z.string().optional(), // From item.xml.href
  applicationNumber: z.string().optional(), // Added for completeness
});

type Trademark = z.infer<typeof trademarkSchema>;

// Helper to find a field value from INPI's fields array
function findFieldValue(
  fields: Array<{name: string, value?: string, values?: string[]}> | undefined,
  fieldName: string
): string | undefined {
  if (!Array.isArray(fields)) {
    return undefined;
  }
  const field = fields.find(f => f.name === fieldName);
  if (field) {
    // If 'values' array exists and has items, join them. Otherwise, use 'value'.
    if (Array.isArray(field.values) && field.values.length > 0) {
      return field.values.join(', ');
    }
    return field.value;
  }
  return undefined;
}

// API function to search trademarks
async function searchTrademarks(query: string): Promise<Trademark[]> {
  if (!query.trim()) { // Prevent fetch if query is empty or just whitespace
    console.log("Frontend: Empty query, not fetching.");
    return [];
  }

  console.log(`Frontend: Fetching /api/trademarks/search?q=${query}`);
  const response = await fetch(`/api/trademarks/search?q=${encodeURIComponent(query)}`);
  const rawData = await response.json();
  
  if (!response.ok) {
    console.error('Frontend: Search API call failed:', {
      status: response.status,
      data: rawData,
    });
    throw new Error(rawData.details || rawData.error || 'Failed to fetch trademarks from backend API');
  }
  
  console.log("Frontend: Raw data received from backend API:", rawData);

  if (rawData && Array.isArray(rawData.results)) {
    const mappedResults: Trademark[] = rawData.results.map((item: any) => {
      const fieldsArray = Array.isArray(item.fields) ? item.fields : [];

      // Determine 'origine' - example: from ApplicationNumber prefix if it's like 'FR', 'EU', 'WO'
      let origine = 'N/A';
      const appNum = findFieldValue(fieldsArray, 'ApplicationNumber');
      if (appNum) {
        if (appNum.startsWith('FR')) origine = 'FR';
        else if (appNum.startsWith('EU') || item.ukey?.startsWith('CTMARK')) origine = 'EU';
        else if (appNum.startsWith('WO') || item.ukey?.startsWith('TMINT')) origine = 'WO';
      }
      if (item.ukey?.startsWith('FMARK')) origine = 'FR';


      // NiceClassDetails might be complex, joining for now if it's an array of strings,
      // or needs more specific parsing if it's an array of objects.
      // For simplicity, if NiceClassDetails is an object, we might stringify it or extract key parts.
      let produitsServicesText = findFieldValue(fieldsArray, 'NiceClassDetails') || 'N/A';
      const niceClassField = fieldsArray.find(f => f.name === 'NiceClassDetails');
      if (typeof niceClassField?.value === 'object' && niceClassField.value !== null) {
         // Attempt to extract class numbers if it's an object/array of objects
        try {
            const niceClasses = JSON.parse(JSON.stringify(niceClassField.value)); // Deep clone to be safe
            if (Array.isArray(niceClasses)) {
                produitsServicesText = niceClasses.map(nc => `Class ${nc.classNumber}: ${nc.classDescription?.descriptionText || ''}`).join('; ');
            } else if (typeof niceClasses === 'object' && niceClasses.classNumber) {
                 produitsServicesText = `Class ${niceClasses.classNumber}: ${niceClasses.classDescription?.descriptionText || ''}`;
            } else {
                produitsServicesText = JSON.stringify(niceClassField.value);
            }
        } catch(e) {
            produitsServicesText = "Error parsing Nice classes";
        }
      } else if (typeof niceClassField?.values !== 'undefined') { // If it's an array of strings (less likely for complex data)
        produitsServicesText = (niceClassField.values || []).join(', ');
      }


      return {
        marque: findFieldValue(fieldsArray, 'Mark') || 'N/A',
        dateDepot: findFieldValue(fieldsArray, 'RegistrationDate') || findFieldValue(fieldsArray, 'PublicationDate') || 'N/A',
        produitsServices: produitsServicesText,
        origine: origine,
        statut: findFieldValue(fieldsArray, 'MarkCurrentStatusCode') || 'N/A',
        noticeUrl: item.xml?.href,
        applicationNumber: appNum || undefined,
      };
    });
    console.log("Frontend: Mapped results:", mappedResults);
    return mappedResults;
  } else {
    console.error("Frontend: API response format error from backend: 'results' array not found or not an array", rawData);
    return [];
  }
}

export default function TrademarkSearch() {
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState(''); // To trigger query only on submit

  // useQuery will now depend on submittedQuery
  const { data: trademarks, isLoading, error, refetch, isFetching } = useQuery<Trademark[], Error>({
    queryKey: ['trademarks', submittedQuery], // Use submittedQuery for the queryKey
    queryFn: () => searchTrademarks(submittedQuery),
    enabled: !!submittedQuery, // Enable only when submittedQuery is not empty
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
    if (e.key === 'Enter') {
      e.preventDefault(); // Prevent form submission if it's in a form
      handleSearch();
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
        <Button onClick={handleSearch} disabled={!searchQuery.trim() || isLoading || isFetching}>
          <Search className="w-4 h-4 mr-2" />
          {isLoading || isFetching ? 'Searching...' : 'Search'}
        </Button>
      </div>

      <ScrollArea className="h-[600px] rounded-md border p-4">
        {(isLoading || isFetching) && submittedQuery ? ( // Show skeletons only if a search is active
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
              <Card key={`${trademark.applicationNumber}-${index}`} className="p-4"> {/* Use a more unique key */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h3 className="font-semibold">Marque</h3>
                    <p>{trademark.marque}</p>
                  </div>
                  <div>
                    <h3 className="font-semibold">Date de dépôt / Publication</h3>
                    <p>{trademark.dateDepot}</p>
                  </div>
                  <div className="md:col-span-2">
                    <h3 className="font-semibold">Produits et services / Classification de Nice</h3>
                    <p className="text-sm whitespace-pre-wrap">{trademark.produitsServices}</p>
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
                        variant="link" // Changed to link for less emphasis, or keep as outline
                        className="p-0 h-auto text-blue-600 hover:underline"
                        onClick={() => window.open(trademark.noticeUrl, '_blank')}
                      >
                        Voir la notice complète (INPI)
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        ) : submittedQuery && !isLoading && !isFetching ? ( // Show "No results" only after a search has been submitted and is not loading
          <div className="text-center p-4 text-gray-500">
            No results found for "{submittedQuery}". Try a different search term.
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
