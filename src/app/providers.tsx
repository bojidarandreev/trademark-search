"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"; // Using localStorage for simplicity first
import { useState, useEffect } from "react";
import { get, set, del } from "idb-keyval"; // For async storage with IndexedDB

// Define the persister using idb-keyval for async storage
const asyncStoragePersister = {
  persistClient: async (client: unknown) => {
    await set("reactQuery", client);
  },
  restoreClient: async () => {
    return await get("reactQuery");
  },
  removeClient: async () => {
    await del("reactQuery");
  },
};

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            gcTime: 1000 * 60 * 60 * 24, // 24 hours cache time
          },
        },
      })
  );

  // State to ensure persister is only created client-side
  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    // Render children directly on the server or during pre-render
    // QueryClientProvider is still needed for server-side query prefetching if any
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  // Use a simple timestamp as a buster string for now.
  // In a real app, this might be a build hash or version number.
  const buster =
    process.env.NEXT_PUBLIC_BUILD_ID || new Date().toISOString().split("T")[0];

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: asyncStoragePersister, // Use the idb-keyval persister
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
        buster: buster,
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
