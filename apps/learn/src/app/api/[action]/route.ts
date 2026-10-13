import { handleApi } from "@/lib/api";
import { getSql } from "@/lib/db";
import { elevateUrl } from "@/lib/origin";
import { allow } from "@/lib/rate-limit";

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const production = process.env.NODE_ENV === "production";
  return handleApi(request, action, {
    sql: getSql(),
    elevateOrigin: elevateUrl(),
    production,
    allow: async () => true,
    allowUser: (userId) => allow("api", userId, production),
  });
}
