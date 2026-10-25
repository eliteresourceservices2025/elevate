import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The standard page widths. List and detail pages ("full") fill the shell up to 105rem (1680 px): beyond that a table only spreads its
 * columns apart, so related facts end up a screen away from each other. A page that really uses more room (the org chart, a pipeline
 * board, charts) asks for "canvas". Reading pages and forms keep a readable line length.
 */
const WIDTHS = {
  full: "max-w-[105rem]",
  canvas: "",
  wide: "max-w-6xl",
  medium: "max-w-4xl",
  form: "max-w-3xl",
  narrow: "max-w-2xl",
} as const;

export type PageWidth = keyof typeof WIDTHS;

/** Wraps a page's content at one of the standard widths with the standard gap between sections. */
export function PageContainer({ width = "full", className, ...props }: ComponentProps<"div"> & { width?: PageWidth }) {
  return <div className={cn("flex flex-col gap-6", WIDTHS[width], className)} {...props} />;
}
