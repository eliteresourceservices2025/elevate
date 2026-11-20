import type { TileDef, TileLayout } from "../bento-tiles";
import { BentoView } from "./bento-view";
import { HoursTile, ScheduleTile, TodoTile } from "./my-work-tiles";
import { AnniversariesTile, AnnouncementsTile, BirthdaysTile, MyTeamTile, NewJoinersTile, WhosOutTile } from "./people-tiles";

/**
 * The VA's dashboard: work first (hours, schedule, to-do), people second. The birthdays tile is two rows tall on the right and scrolls
 * inside itself, so it never stretches the rows.
 */
export const MY_WORK_TILES: TileDef[] = [
  { id: "hours", label: "Hours this week", span: 2, render: () => <HoursTile /> },
  { id: "schedule", label: "Schedule", span: 2, render: () => <ScheduleTile /> },
  { id: "birthdays", label: "Birthdays", span: 2, rows: 2, render: () => <BirthdaysTile /> },
  { id: "todo", label: "To-do", span: 4, render: () => <TodoTile /> },
  { id: "anniversaries", label: "Anniversaries", span: 2, render: () => <AnniversariesTile /> },
  { id: "joiners", label: "New joiners", span: 2, render: () => <NewJoinersTile /> },
  { id: "out", label: "Who is out", span: 2, render: () => <WhosOutTile /> },
  { id: "team", label: "My team", span: 3, render: () => <MyTeamTile /> },
  { id: "announcements", label: "Announcements", span: 3, render: () => <AnnouncementsTile /> },
];

export function MyWorkBento({ layout = null }: { layout?: TileLayout | null }) {
  return <BentoView tiles={MY_WORK_TILES} layout={layout} />;
}
