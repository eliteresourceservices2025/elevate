"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-reads the page from the server every so often, so a running session's hours keep moving. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
