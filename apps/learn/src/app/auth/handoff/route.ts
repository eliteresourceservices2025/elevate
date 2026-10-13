import { getSql } from "@/lib/db";
import { handleHandoff } from "@/lib/handlers";
import { elevateUrl } from "@/lib/origin";
import { addressOf, allow } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const production = process.env.NODE_ENV === "production";
  return handleHandoff(request, {
    sql: getSql(),
    elevateOrigin: elevateUrl(),
    production,
    allow: (r) => allow("handoff", addressOf(r), production),
  });
}
