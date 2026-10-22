import { z } from "zod";
import { GENDERS, OTHER_TEXT_MAX, PRONOUNS, RELIGIONS, SEXUAL_ORIENTATIONS } from "./constants";

// One schema per form, used by the form AND the server action. Every answer is optional; an empty choice means "not answered".

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const choice = <T extends readonly [string, ...string[]]>(values: T) => z.preprocess(blankToUndefined, z.enum(values).optional());
const other = z.preprocess(blankToUndefined, z.string().trim().max(OTHER_TEXT_MAX, `Use ${OTHER_TEXT_MAX} characters or fewer`).optional());

type Answers = { gender?: string; genderOther?: string; religion?: string; religionOther?: string; pronouns?: string; pronounsOther?: string; orientation?: string; orientationOther?: string };

/** "I describe it myself" needs the words; the words are ignored for any other choice. */
function withOtherText<S extends z.ZodType<Answers>>(schema: S) {
  return schema.superRefine((v, ctx) => {
    if (v.gender === "self_described" && !v.genderOther) ctx.addIssue({ code: "custom", path: ["genderOther"], message: "Write how you describe your gender, or choose another answer" });
    if (v.orientation === "self_described" && !v.orientationOther) ctx.addIssue({ code: "custom", path: ["orientationOther"], message: "Write how you describe your sexual orientation, or choose another answer" });
    if (v.religion === "self_described" && !v.religionOther) ctx.addIssue({ code: "custom", path: ["religionOther"], message: "Write your religion, or choose another answer" });
    if (v.pronouns === "self_described" && !v.pronounsOther) ctx.addIssue({ code: "custom", path: ["pronounsOther"], message: "Write your pronouns, or choose another answer" });
  });
}

/** The person's own profile card: gender, pronouns, sexual orientation and religion, and which of those colleagues may read. */
export const selfIdentificationSchema = withOtherText(
  z.object({
    gender: choice(GENDERS),
    genderOther: other,
    pronouns: choice(PRONOUNS),
    pronounsOther: other,
    orientation: choice(SEXUAL_ORIENTATIONS),
    orientationOther: other,
    religion: choice(RELIGIONS),
    religionOther: other,
    showGender: z.boolean().optional().default(false),
    showOrientation: z.boolean().optional().default(false),
    showReligion: z.boolean().optional().default(false),
  }),
);
export type SelfIdentificationInput = z.input<typeof selfIdentificationSchema>;

/** The optional section of the public application form: gender, sexual orientation and religion only (never shown to anyone, only counted). */
export const applicantSelfIdSchema = withOtherText(
  z.object({
    gender: choice(GENDERS),
    genderOther: other,
    orientation: choice(SEXUAL_ORIENTATIONS),
    orientationOther: other,
    religion: choice(RELIGIONS),
    religionOther: other,
  }),
);
export type ApplicantSelfIdInput = z.input<typeof applicantSelfIdSchema>;
