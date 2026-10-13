import { handleVerify } from "@/lib/api";
import { getSql } from "@/lib/db";
import { addressOf, allow } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const production = process.env.NODE_ENV === "production";
  return handleVerify(request, { sql: getSql(), allow: (r) => allow("verify", addressOf(r), production) });
}
