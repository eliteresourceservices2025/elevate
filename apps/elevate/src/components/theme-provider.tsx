"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/** Light, dark or the device's setting (the default). The choice is kept in this browser only. */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange {...props}>
      {children}
    </NextThemesProvider>
  );
}
