import { z } from "zod";
import { CHECKS, EXIT_RETURN, KINDS, LEAVING_REASONS, OWNERS } from "./constants";

const uuid = z.string().uuid("Invalid id");
const text = (max: number) => z.string().trim().max(max);
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");

export const itemSchema = z
  .object({
    title: text(160).min(2, "Every task needs a title"),
    details: z.preprocess(blankToUndefined, text(500).optional()),
    owner: z.enum(OWNERS),
    dueOffsetDays: z.coerce.number().int().min(-60).max(120),
    required: z.boolean().default(true),
    check: z.enum(CHECKS).default("manual"),
    documentTypeId: z.preprocess(blankToUndefined, uuid.optional()),
    policyId: z.preprocess(blankToUndefined, uuid.optional()),
    policyKind: z.preprocess(blankToUndefined, z.enum(["privacy_notice", "monitoring"]).optional()),
    signTemplateId: z.preprocess(blankToUndefined, uuid.optional()),
    href: z.preprocess(blankToUndefined, z.string().trim().max(200).regex(/^\/(?!\/)[^\s\\]*$/, "A link must be a path inside ELEVATE, like /signing").optional()),
  })
  .superRefine((v, ctx) => {
    if (v.check === "document" && !v.documentTypeId) ctx.addIssue({ code: "custom", message: "Choose which document type", path: ["documentTypeId"] });
    if (v.check === "policy" && !v.policyId && !v.policyKind) ctx.addIssue({ code: "custom", message: "Choose which policy", path: ["policyId"] });
    if (v.check === "signature" && !v.signTemplateId) ctx.addIssue({ code: "custom", message: "Choose which agreement template", path: ["signTemplateId"] });
  });

export const checklistTemplateSchema = z.object({
  id: uuid.optional(),
  kind: z.enum(KINDS),
  name: text(120).min(3, "Give the template a name"),
  positionId: z.preprocess(blankToUndefined, uuid.optional()),
  items: z.array(itemSchema).min(1, "Add at least one task").max(40, "At most 40 tasks"),
});
export type ChecklistTemplateInput = z.input<typeof checklistTemplateSchema>;

export const templateIdSchema = z.object({ templateId: uuid });
export const caseIdSchema = z.object({ caseId: uuid });
export const taskIdSchema = z.object({ taskId: uuid });
export const completeTaskSchema = z.object({ taskId: uuid, note: z.preprocess(blankToUndefined, text(500).optional()) });
export const skipTaskSchema = z.object({ taskId: uuid, reason: text(500).min(3, "Give a short reason") });

export const startOffboardingSchema = z.object({
  employeeId: uuid,
  lastWorkingDay: date,
  reason: z.enum(LEAVING_REASONS),
  note: z.preprocess(blankToUndefined, text(1000).optional()),
});

export const exitInterviewSchema = z.object({
  caseId: uuid,
  reasonForLeaving: text(1000).min(3, "Tell us the main reason in a few words"),
  wentWell: z.preprocess(blankToUndefined, text(2000).optional()),
  toImprove: z.preprocess(blankToUndefined, text(2000).optional()),
  wouldReturn: z.enum(EXIT_RETURN),
});

export const certificateSchema = z.object({ employeeId: uuid });
