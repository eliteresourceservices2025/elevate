import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

// Inngest calls this endpoint to run the scheduled jobs. In production it verifies every request with
// INNGEST_SIGNING_KEY; it is excluded from the sign-in gate in proxy.ts because it is not a person.
export const { GET, POST, PUT } = serve({ client: inngest, functions });
