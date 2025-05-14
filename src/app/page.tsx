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
  dateDepot: z.string(),
  produitsServices: z.string(),
  origine: z.string(),
  statut: z.string(),
  noticeUrl: z.string().optional(),
});

type Trademark = z.infer<typeof trademarkSchema>;

// API function to search trademarks
async function searchTrademarks(query: string): Promise<Trademark[]> {
  const response = await fetch(`/api/trademarks/search?q=${encodeURIComponent(query)}`);
  const data = await response.json();
  
  if (!response.ok) {
    console.error('Search failed:', {
      status: response.status,
      data: data,
    });
    throw new Error(data.details || data.error || 'Failed to fetch trademarks');
  }
  
  return data;
}

export default function TrademarkSearch() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const { data: trademarks, isLoading, error, refetch } = useQuery({
    queryKey: ['trademarks', searchQuery],
    queryFn: () => searchTrademarks(searchQuery),
    enabled: isSearching && searchQuery.length > 0,
    retry: 1, // Only retry once on failure
  });

  const handleSearch = () => {
    setIsSearching(true);
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <main className="container mx-auto p-4 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8 text-center">Trademark Search</h1>
      
      {/* Search Bar */}
      <div className="flex gap-2 mb-6">
        <Input
          type="text"
          placeholder="Enter brand name..."
          value={searchQuery}
          onChange={handleInputChange}
          className="flex-1"
          onKeyDown={handleKeyDown}
        />
        <Button onClick={handleSearch} disabled={!searchQuery}>
          <Search className="w-4 h-4 mr-2" />
          Search
        </Button>
      </div>

      {/* Results Area */}
      <ScrollArea className="h-[600px] rounded-md border p-4">
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="text-red-500 text-center p-4">
            <p className="font-semibold">Error loading results</p>
            <p className="text-sm mt-2">{error instanceof Error ? error.message : 'An unknown error occurred'}</p>
            <Button 
              variant="outline" 
              className="mt-4"
              onClick={() => refetch()}
            >
              Try Again
            </Button>
          </div>
        ) : trademarks && trademarks.length > 0 ? (
          <div className="space-y-4">
            {trademarks.map((trademark: Trademark, index: number) => (
              <Card key={index} className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h3 className="font-semibold">Marque</h3>
                    <p>{trademark.marque}</p>
                  </div>
                  <div>
                    <h3 className="font-semibold">Date de dépôt / Enregistrement</h3>
                    <p>{trademark.dateDepot}</p>
                  </div>
                  <div>
                    <h3 className="font-semibold">Produits et services/Class/Classification de Nice</h3>
                    <p>{trademark.produitsServices}</p>
                  </div>
                  <div>
                    <h3 className="font-semibold">Origine</h3>
                    <p>{trademark.origine}</p>
                  </div>
                  <div>
                    <h3 className="font-semibold">Statut</h3>
                    <p>{trademark.statut}</p>
                  </div>
                  {trademark.noticeUrl && (
                    <div className="md:col-span-2">
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => window.open(trademark.noticeUrl, '_blank')}
                      >
                        Download Notice
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        ) : isSearching ? (
          <div className="text-center p-4 text-gray-500">
            No results found. Try a different search term.
          </div>
        ) : null}
      </ScrollArea>
    </main>
  );
}
