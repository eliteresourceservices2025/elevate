import { Skeleton } from "@/components/ui/skeleton";

/** Shown while a profile loads: the shape of the summary card, the tab row and one block. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true" aria-label="Loading profile">
      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-44 rounded-2xl" />
      </div>
      <Skeleton className="h-10 w-full max-w-xl" />
      <Skeleton className="h-64 rounded-2xl" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
