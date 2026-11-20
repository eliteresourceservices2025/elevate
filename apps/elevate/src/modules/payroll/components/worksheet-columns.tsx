"use client";

import { useState, type ReactNode } from "react";

// Laptops and tablets show EVERY column by default (Finance reads the whole sheet); the box can be unticked for a short set (person, client,
// cutoff pay, gross, net, change, client hours, checked by, actions). Phones never get the table: they get a card per person. The detail cells
// (in worksheet.tsx) carry `group-data-[detail=off]:hidden`; this frame holds the choice for the page visit only (nothing is stored).

export function WorksheetColumns({ children }: { children: ReactNode }) {
  const [all, setAll] = useState(true);
  return (
    // --group-h is the height of the group row of the headings (it is hidden with the detail columns), so the column row sticks right under it.
    <div className="group space-y-2 [--group-h:2.5rem] data-[detail=off]:[--group-h:0px]" data-detail={all ? "on" : "off"}>
      <label className="flex min-h-8 w-fit items-center gap-2 text-sm pointer-coarse:min-h-11">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="size-4" />
        Show every column
      </label>
      {children}
    </div>
  );
}
