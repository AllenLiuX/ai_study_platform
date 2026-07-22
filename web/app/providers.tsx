"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

import { UpgradeGate } from "@/components/UpgradeGate";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // 402 QuotaError 不要 retry, 直接冒到 UI
            retry: (failureCount, err) => {
              const status = (err as { status?: number } | undefined)?.status;
              if (status === 402 || status === 401 || status === 403) return false;
              return failureCount < 1;
            },
          },
          mutations: {
            retry: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      <UpgradeGate />
    </QueryClientProvider>
  );
}
