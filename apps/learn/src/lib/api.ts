import { z } from "zod";
import { withUser, type Sql } from "./db";
import { resolveSession, type Deps } from "./handlers";
import { sameSiteOrigin } from "./origin";
import { drillFor, quarterOf } from "../content/drills";
import { addressOf } from "./rate-limit";

// The JSON endpoints behind the player and the exam. Every one is a POST from this site only, needs a Learn session, and calls one
// database function that holds the rule (docs/learn/03-data-and-security.md): the browser says what the person did, and the
// database decides what counts. Time, scores and completion are never taken from the browser.

export type ApiDeps = Deps & {
  /** Whether this person may make another call (the rate limit, per person). */
  allowUser: (userId: string) => Promise<boolean>;
};

type Ctx = { sql: Sql; userId: string; authMethods: string[]; address: string };
type Output = { status?: number; body: Record<string, unknown> };

const uuid = z.string().uuid();
const moduleKey = z.string().regex(/^[a-z0-9_]{1,40}$/);
const optionIds = z.array(z.string().regex(/^[a-f]$/)).max(6);

const MESSAGES: Record<string, [number, string]> = {
  not_found: [404, "We could not find that."],
  not_open: [409, "This training is already finished or closed."],
  inactive: [403, "Your account is not active. Please contact HR."],
  module_locked: [409, "Please finish the earlier modules first."],
  no_such_module: [404, "We could not find that module."],
  no_such_screen: [400, "That screen does not exist."],
  screens_missing: [409, "Please look at every screen of this module first."],
  time_missing: [409, "Keep going: this module needs a little more reading time before it can be completed."],
  modules_incomplete: [409, "Please finish all the modules before the exam."],
  no_tries_left: [409, "You have used all your tries. Please contact HR."],
  wait_after_fail: [409, "Please review the topics first. You can try again after the wait."],
  bank_too_small: [500, "This part of the training is not ready yet. Please contact HR."],
  calls_not_configured: [500, "The mock call is not ready yet. Please contact HR."],
  step_out_of_order: [409, "That step was already answered or is not next. Please reload the call."],
  call_unfinished: [409, "Please finish every step of every call first."],
  exam_not_configured: [500, "The exam is not ready yet. Please contact HR."],
  time_up: [409, "Time is up. Your saved answers will be graded."],
  already_submitted: [409, "This exam was already submitted."],
  not_submitted: [409, "This exam has not been submitted yet."],
  not_in_attempt: [400, "That question is not part of this exam."],
  bad_option: [400, "That answer is not one of the choices."],
  not_passed: [409, "You can accept after you pass the exam."],
  name_required: [400, "Please type your full name."],
  name_mismatch: [400, "The name must match your name in ELEVATE."],
};

class ApiError extends Error {
  constructor(
    public code: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/** The database raises `learn:<code>`; anything else is not shown to the person. */
function codeOf(error: unknown): { code: string; detail?: string } | null {
  const message = error instanceof Error ? error.message : "";
  const match = /^learn:([a-z_]+)$/.exec(message);
  if (!match) return null;
  return { code: match[1], detail: (error as { detail?: string }).detail };
}

const ACTIONS: Record<string, { schema: z.ZodType; run: (ctx: Ctx, input: never) => Promise<Output> }> = {
  /** A quarterly micro-drill answer. Correctness is worked out here from our own content; nothing about it blocks anything. */
  drill: {
    schema: z.object({ course: z.string().regex(/^[a-z0-9-]{1,60}$/), choice: z.enum(["a", "b", "c"]) }),
    run: async (ctx, input: { course: string; choice: "a" | "b" | "c" }) => {
      const quarter = quarterOf(new Date());
      const drill = drillFor(input.course, quarter);
      if (!drill) throw new ApiError("not_found");
      const correct = input.choice === drill.best;
      const [r] = await ctx.sql`select learn.record_drill(${ctx.userId}::uuid, ${input.course}, ${quarter}, ${drill.key}, ${input.choice}, ${correct}) as recorded`;
      return { body: { ok: true, correct, best: drill.best, explanation: drill.explanation, recorded: r.recorded as boolean } };
    },
  },
  /** The person opened a screen of a module. */
  screen: {
    schema: z.object({ assignmentId: uuid, moduleKey, screen: z.number().int().min(0).max(80) }),
    run: async (ctx, input: { assignmentId: string; moduleKey: string; screen: number }) => {
      await ctx.sql`select learn.open_screen(${ctx.userId}::uuid, ${input.assignmentId}::uuid, ${input.moduleKey}, ${input.screen})`;
      return { body: { ok: true } };
    },
  },
  /** A heartbeat while the page is open and active. The database decides how many seconds count. */
  time: {
    schema: z.object({ assignmentId: uuid, moduleKey, seconds: z.number().int().min(0).max(120) }),
    run: async (ctx, input: { assignmentId: string; moduleKey: string; seconds: number }) => {
      const [credit] = await ctx.sql`select learn.credit_time(${ctx.userId}::uuid, ${input.assignmentId}::uuid, ${input.moduleKey}, ${input.seconds}) as credited`;
      const total = await moduleSeconds(ctx, input.assignmentId, input.moduleKey);
      return { body: { ok: true, credited: credit.credited as number, totalSeconds: total.seconds, minSeconds: total.minSeconds } };
    },
  },
  complete: {
    schema: z.object({ assignmentId: uuid, moduleKey }),
    run: async (ctx, input: { assignmentId: string; moduleKey: string }) => {
      try {
        await ctx.sql`select learn.complete_module(${ctx.userId}::uuid, ${input.assignmentId}::uuid, ${input.moduleKey})`;
      } catch (error) {
        const c = codeOf(error);
        if (c?.code === "time_missing") {
          const t = await moduleSeconds(ctx, input.assignmentId, input.moduleKey);
          throw new ApiError("time_missing", { remainingSeconds: Math.max(0, t.minSeconds - t.seconds) });
        }
        throw error;
      }
      return { body: { ok: true } };
    },
  },
  startExam: {
    schema: z.object({ assignmentId: uuid }),
    run: async (ctx, input: { assignmentId: string }) => {
      try {
        const [row] = await ctx.sql`select learn.start_exam(${ctx.userId}::uuid, ${input.assignmentId}::uuid) as id`;
        return { body: { ok: true, attemptId: row.id as string } };
      } catch (error) {
        const c = codeOf(error);
        if (c?.code === "wait_after_fail") throw new ApiError("wait_after_fail", { retryAt: c.detail ?? null });
        throw error;
      }
    },
  },
  answer: {
    schema: z.object({ attemptId: uuid, questionId: uuid, selected: optionIds }),
    run: async (ctx, input: { attemptId: string; questionId: string; selected: string[] }) => {
      await ctx.sql`select learn.save_answer(${ctx.userId}::uuid, ${input.attemptId}::uuid, ${input.questionId}::uuid, ${input.selected}::text[])`;
      return { body: { ok: true } };
    },
  },
  submit: {
    schema: z.object({ attemptId: uuid }),
    run: async (ctx, input: { attemptId: string }) => {
      const [r] = await ctx.sql`select * from learn.grade_attempt(${ctx.userId}::uuid, ${input.attemptId}::uuid)`;
      return { body: { ok: true, scorePercent: Number(r.score_percent), correct: r.correct_count as number, total: r.total_count as number, passed: r.passed as boolean } };
    },
  },
  /** The mock call: start it, answer one step at a time, then submit. The database holds the key and the rules (docs/learn/14-mock-call.md). */
  startCall: {
    schema: z.object({ assignmentId: uuid }),
    run: async (ctx, input: { assignmentId: string }) => {
      try {
        const [row] = await ctx.sql`select learn.start_call(${ctx.userId}::uuid, ${input.assignmentId}::uuid) as id`;
        return { body: { ok: true, attemptId: row.id as string } };
      } catch (error) {
        const c = codeOf(error);
        if (c?.code === "wait_after_fail") throw new ApiError("wait_after_fail", { retryAt: c.detail ?? null });
        throw error;
      }
    },
  },
  answerCall: {
    schema: z.object({ attemptId: uuid, scenarioId: uuid, stepId: z.string().regex(/^[a-z0-9-]{1,20}$/), optionId: z.string().regex(/^[a-d]$/) }),
    run: async (ctx, input: { attemptId: string; scenarioId: string; stepId: string; optionId: string }) => {
      // Only the caller's answer, the new mood and whether the call / attempt is finished: never points or the best reply.
      const [r] = await ctx.sql`select * from learn.answer_call_step(${ctx.userId}::uuid, ${input.attemptId}::uuid, ${input.scenarioId}::uuid, ${input.stepId}, ${input.optionId})`;
      return { body: { ok: true, reply: r.reply as string, mood: r.mood as number, callDone: r.call_done as boolean, attemptDone: r.attempt_done as boolean } };
    },
  },
  submitCall: {
    schema: z.object({ attemptId: uuid }),
    run: async (ctx, input: { attemptId: string }) => {
      const [r] = await ctx.sql`select * from learn.grade_call(${ctx.userId}::uuid, ${input.attemptId}::uuid)`;
      return { body: { ok: true, scorePercent: Number(r.score_percent), passed: r.passed as boolean, categories: r.categories as Record<string, number> } };
    },
  },
  /** After a pass: the responsibility statement and the certificate. */
  accept: {
    schema: z.object({ assignmentId: uuid, statementVersion: z.string().regex(/^[a-z0-9._-]{1,30}$/), typedName: z.string().trim().min(2).max(120) }),
    run: async (ctx, input: { assignmentId: string; statementVersion: string; typedName: string }) => {
      const [c] = await ctx.sql`
        select * from learn.accept_and_certify(${ctx.userId}::uuid, ${input.assignmentId}::uuid, ${input.statementVersion}, ${input.typedName}, ${ctx.address}, ${ctx.authMethods}::text[])`;
      // An update module returns no certificate (the person keeps the one they hold).
      return { body: { ok: true, reference: (c?.reference as string | undefined) ?? null } };
    },
  },
};

async function moduleSeconds(ctx: Ctx, assignmentId: string, key: string): Promise<{ seconds: number; minSeconds: number }> {
  // Reads go through row-level security, which needs the person set for the transaction.
  const rows = await withUser(ctx.sql, ctx.userId, (tx) => tx`
    select coalesce((select sum(seconds) from learn.module_time where assignment_id = ${assignmentId}::uuid and module_key = ${key}), 0)::int as seconds,
           coalesce((select m.min_seconds from learn.assignments a join learn.version_modules m on m.version_id = a.version_id
                     where a.id = ${assignmentId}::uuid and m.module_key = ${key}), 0)::int as min_seconds`);
  return { seconds: rows[0].seconds as number, minSeconds: rows[0].min_seconds as number };
}

/** POST /api/<action>. */
export async function handleApi(request: Request, action: string, deps: ApiDeps): Promise<Response> {
  if (!sameSiteOrigin(request)) return json(403, { ok: false, error: "This request was not allowed." });
  // eslint-disable-next-line security/detect-object-injection -- `action` is looked up in a fixed map and used only if it is a key of it
  const def = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
  if (!def) return json(404, { ok: false, error: "Not found." });

  const session = await resolveSession(request.headers.get("cookie"), deps);
  if (!session) return json(401, { ok: false, code: "signed_out", error: "Your session ended. Please open training from ELEVATE again." });
  if (!(await deps.allowUser(session.userId))) return json(429, { ok: false, error: "Too many requests. Please wait a moment." });

  if (Number(request.headers.get("content-length") ?? "0") > 8192) return json(413, { ok: false, error: "Request too large." });
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { ok: false, error: "Please try again." });
  }
  const parsed = def.schema.safeParse(raw);
  if (!parsed.success) return json(400, { ok: false, error: "Please check what you entered and try again." });

  try {
    const out = await def.run({ sql: deps.sql, userId: session.userId, authMethods: session.authMethods, address: addressOf(request) }, parsed.data as never);
    return json(out.status ?? 200, out.body);
  } catch (error) {
    const extra = error instanceof ApiError ? error.extra : {};
    const code = error instanceof ApiError ? error.code : codeOf(error)?.code;
    // eslint-disable-next-line security/detect-object-injection -- `code` comes from the fixed `learn:<code>` pattern and is looked up in a fixed map
    const known = code && Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : undefined;
    if (known) return json(known[0], { ok: false, code, error: known[1], ...extra });
    console.error("api failed:", action, error instanceof Error ? error.name : "unknown"); // never the request or a person
    return json(500, { ok: false, error: "Something went wrong. Please try again." });
  }
}

/** The public certificate check: needs the reference and the full name. Rate limited by address; no session. */
export async function handleVerify(request: Request, deps: Pick<Deps, "sql" | "allow">): Promise<Response> {
  if (!sameSiteOrigin(request)) return json(403, { ok: false, error: "This request was not allowed." });
  if (!(await deps.allow(request))) return json(429, { ok: false, error: "Too many tries. Please wait a few minutes." });
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { ok: false, error: "Please try again." });
  }
  const parsed = z.object({ reference: z.string().trim().min(5).max(30), name: z.string().trim().min(2).max(120) }).safeParse(raw);
  if (!parsed.success) return json(400, { ok: false, error: "Please enter the reference and the full name." });
  try {
    const [r] = await deps.sql`select * from learn.verify_certificate(${parsed.data.reference}, ${parsed.data.name})`;
    return json(200, { ok: true, status: r.status as string, issuedOn: r.issued_on ?? null, endsOn: r.ends_on ?? null });
  } catch {
    return json(500, { ok: false, error: "Something went wrong. Please try again." });
  }
}
