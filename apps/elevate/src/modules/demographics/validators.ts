import { z } from "zod";
import { GENDERS, OTHER_TEXT_MAX, PRONOUNS, RELIGIONS } from "./constants";

// One schema per form, used by the form AND the server action. Every answer is optional; an empty choice means "not answered".

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const choice = <T extends readonly [string, ...string[]]>(values: T) => z.preprocess(blankToUndefined, z.enum(values).optional());
const other = z.preprocess(blankToUndefined, z.string().trim().max(OTHER_TEXT_MAX, `Use ${OTHER_TEXT_MAX} characters or fewer`).optional());

/** "I describe it myself" needs the words; the words are ignored for any other choice. */
function withOtherText<S extends z.ZodType<{ gender?: string; genderOther?: string; religion?: string; religionOther?: string; pronouns?: string; pronounsOther?: string }>>(schema: S) {
  return schema.superRefine((v, ctx) => {
    if (v.gender === "self_described" && !v.genderOther) ctx.addIssue({ code: "custom", path: ["genderOther"], message: "Write how you describe your gender, or choose another answer" });
    if (v.religion === "self_described" && !v.religionOther) ctx.addIssue({ code: "custom", path: ["religionOther"], message: "Write your religion, or choose another answer" });
    if (v.pronouns === "self_described" && !v.pronounsOther) ctx.addIssue({ code: "custom", path: ["pronounsOther"], message: "Write your pronouns, or choose another answer" });
  });
}

/** The person's own profile card: gender, pronouns and religion. */
export const selfIdentificationSchema = withOtherText(
  z.object({
    gender: choice(GENDERS),
    genderOther: other,
    pronouns: choice(PRONOUNS),
    pronounsOther: other,
    religion: choice(RELIGIONS),
    religionOther: other,
  }),
);
export type SelfIdentificationInput = z.input<typeof selfIdentificationSchema>;

/** The optional section of the public application form: gender and religion only. */
export const applicantSelfIdSchema = withOtherText(
  z.object({
    gender: choice(GENDERS),
    genderOther: other,
    religion: choice(RELIGIONS),
    religionOther: other,
  }),
);
export type ApplicantSelfIdInput = z.input<typeof applicantSelfIdSchema>;
