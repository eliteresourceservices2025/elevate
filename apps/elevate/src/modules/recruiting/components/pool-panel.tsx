"use client";

import { useState } from "react";
import { SelectField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatInZone } from "@/lib/time";
import { addPoolMemberToOpening, setTalentPool } from "../actions";
import type { PoolView } from "../queries";
import { useRun } from "./use-run";

/** The talent pool: people who agreed to be kept for future roles, whom staff can put forward for another open job. */
export function PoolPanel({ applicationId, pool }: { applicationId: string; pool: PoolView }) {
  const { run, pending, router } = useRun();
  const [openingId, setOpeningId] = useState("");

  return (
    <section aria-label="Talent pool" className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Talent pool</h2>
        {pool.inPool ? <Badge>In the pool</Badge> : null}
      </div>
      {!pool.consented ? (
        <p className="text-sm text-muted-foreground">
          {pool.expiresAt ? "Their agreement to be kept for future roles has run out." : "They did not tick “keep my details for future roles” when they applied, so they cannot be added to the pool."}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          They agreed to be kept for future roles, until {pool.expiresAt ? formatInZone(pool.expiresAt, undefined, "MMM d, yyyy") : "-"}. After that date their data follows the normal retention periods again.
        </p>
      )}
      {pool.canManage && pool.consented ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={pool.inPool ? "outline" : "default"}
            disabled={pending}
            onClick={() => run(() => setTalentPool({ applicationId, inPool: !pool.inPool }), pool.inPool ? "Taken out of the pool." : "Added to the pool.")}
          >
            {pool.inPool ? "Take out of the pool" : "Add to the talent pool"}
          </Button>
        </div>
      ) : null}
      {pool.canManage && pool.inPool && pool.openings.length > 0 ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run<{ applicationId: string }>(
              () => addPoolMemberToOpening({ applicationId, openingId }),
              "Added to that job.",
              (data) => data && router.push(`/recruiting/applications/${data.applicationId}`),
            );
          }}
        >
          <SelectField id="pool-opening" label="Also consider for another open job" value={openingId} onChange={(e) => setOpeningId(e.target.value)}>
            <option value="">Choose a job</option>
            {pool.openings.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </SelectField>
          <Button type="submit" variant="outline" disabled={pending || openingId === ""}>
            Add to that job
          </Button>
        </form>
      ) : null}
    </section>
  );
}
