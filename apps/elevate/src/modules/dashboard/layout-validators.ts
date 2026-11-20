import { z } from "zod";
import { LENSES } from "./lens";

// A tile id is a plain lowercase id ("team-flags"): no spaces, capitals, slashes or markup. At most 30 hidden and 30 ordered per view.
const tileId = z.string().regex(/^[a-z0-9-]{1,40}$/);

export const layoutSchema = z.object({
  view: z.enum(LENSES),
  hidden: z.array(tileId).max(30),
  order: z.array(tileId).max(30),
});

export const resetSchema = z.object({ view: z.enum(LENSES) });

export type LayoutInput = z.infer<typeof layoutSchema>;
