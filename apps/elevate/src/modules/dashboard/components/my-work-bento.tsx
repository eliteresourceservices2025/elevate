import { Suspense, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AnniversariesTile, AnnouncementsTile, BirthdaysTile, MyTeamTile, NewJoinersTile, WhosOutTile } from "./people-tiles";
import { HoursTile, ScheduleTile, TodoTile } from "./my-work-tiles";

function Cell({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("min-w-0", className)}>
      <Suspense fallback={<Skeleton className="h-full min-h-32 rounded-2xl" />}>{children}</Suspense>
    </div>
  );
}

/**
 * The VA's dashboard as a bento grid: six columns on a wide screen, every row full, the birthdays tile two rows tall on the right, scrolling inside itself so it never stretches the rows; two columns on a
 * tablet and one on a phone. Work first (hours, schedule, to-do), people second. Tiles are compact and never stretch to fill space.
 */
export function MyWorkBento() {
  return (
    <div className="grid grid-flow-dense grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <Cell className="lg:col-span-2">
        <HoursTile />
      </Cell>
      <Cell className="lg:col-span-2">
        <ScheduleTile />
      </Cell>
      <Cell className="sm:col-span-2 lg:relative lg:col-span-2 lg:row-span-2">
        <BirthdaysTile />
      </Cell>
      <Cell className="sm:col-span-2 lg:col-span-4">
        <TodoTile />
      </Cell>
      <Cell className="lg:col-span-2">
        <AnniversariesTile />
      </Cell>
      <Cell className="lg:col-span-2">
        <NewJoinersTile />
      </Cell>
      <Cell className="lg:col-span-2">
        <WhosOutTile />
      </Cell>
      <Cell className="lg:col-span-3">
        <MyTeamTile />
      </Cell>
      <Cell className="lg:col-span-3">
        <AnnouncementsTile />
      </Cell>
    </div>
  );
}
