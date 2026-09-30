import "server-only";
import { Inngest } from "inngest";

// Background jobs (Inngest). Production needs INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY; locally the
// dev server (`pnpm dlx inngest-cli@latest dev`) needs no keys.
export const inngest = new Inngest({ id: "elevate" });
