import { getSql } from "@/lib/db";
import { handleSignOut } from "@/lib/handlers";
import { elevateUrl } from "@/lib/origin";

export async function POST(request: Request) {
  return handleSignOut(request, { sql: getSql(), elevateOrigin: elevateUrl(), production: process.env.NODE_ENV === "production", allow: async () => true });
}
