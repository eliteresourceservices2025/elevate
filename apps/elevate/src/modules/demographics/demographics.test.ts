import { describe, expect, it } from "vitest";
import { GENDERS, GENDER_LABELS, MIN_GROUP, PRONOUNS, RELIGIONS, RELIGION_LABELS, SEXUAL_ORIENTATIONS, SEXUAL_ORIENTATION_LABELS, pronounText, sharedAnswerText } from "./constants";
import { summarizeAnswers } from "./summary";
import { applicantSelfIdSchema, selfIdentificationSchema } from "./validators";

describe("self-identification validators", () => {
  it("accepts nothing at all and treats blanks as not answered", () => {
    const parsed = selfIdentificationSchema.parse({ gender: "", pronouns: "", religion: "", genderOther: " " });
    // Nothing answered, and nothing shared (the switches default to off).
    expect(parsed).toEqual({ showGender: false, showOrientation: false, showReligion: false });
  });

  it("accepts every listed choice, including prefer not to say", () => {
    for (const gender of GENDERS) {
      const input = { gender, ...(gender === "self_described" ? { genderOther: "Agender" } : {}) };
      expect(selfIdentificationSchema.safeParse(input).success).toBe(true);
    }
    for (const religion of RELIGIONS) {
      const input = { religion, ...(religion === "self_described" ? { religionOther: "Pagan" } : {}) };
      expect(selfIdentificationSchema.safeParse(input).success).toBe(true);
    }
    for (const orientation of SEXUAL_ORIENTATIONS) {
      const input = { orientation, ...(orientation === "self_described" ? { orientationOther: "Demisexual" } : {}) };
      expect(selfIdentificationSchema.safeParse(input).success).toBe(true);
      expect(applicantSelfIdSchema.safeParse(input).success).toBe(true);
    }
    for (const pronouns of PRONOUNS) {
      const input = { pronouns, ...(pronouns === "self_described" ? { pronounsOther: "xe/xem" } : {}) };
      expect(selfIdentificationSchema.safeParse(input).success).toBe(true);
    }
  });

  it("refuses unknown values and a self-description without words", () => {
    expect(selfIdentificationSchema.safeParse({ gender: "robot" }).success).toBe(false);
    expect(selfIdentificationSchema.safeParse({ religion: "made up" }).success).toBe(false);
    expect(selfIdentificationSchema.safeParse({ gender: "self_described" }).success).toBe(false);
    expect(selfIdentificationSchema.safeParse({ religion: "self_described" }).success).toBe(false);
    expect(selfIdentificationSchema.safeParse({ pronouns: "self_described" }).success).toBe(false);
    expect(selfIdentificationSchema.safeParse({ orientation: "self_described" }).success).toBe(false);
    expect(selfIdentificationSchema.safeParse({ orientation: "made up" }).success).toBe(false);
    expect(selfIdentificationSchema.safeParse({ gender: "woman", genderOther: "x".repeat(61) }).success).toBe(false);
  });

  it("the applicant section has no pronouns and the same rules", () => {
    expect(applicantSelfIdSchema.parse({ gender: "man", religion: "islam", pronouns: "he_him" })).toEqual({ gender: "man", religion: "islam" });
    expect(applicantSelfIdSchema.safeParse({ gender: "self_described" }).success).toBe(false);
  });
});

describe("the lists", () => {
  it("offer trans, atheist and agnostic choices, each with a label", () => {
    expect(GENDERS).toEqual(expect.arrayContaining(["trans_woman", "trans_man"]));
    expect(RELIGIONS).toEqual(expect.arrayContaining(["atheist", "agnostic"]));
    for (const g of GENDERS) expect(GENDER_LABELS[g]).toBeTruthy();
    for (const o of SEXUAL_ORIENTATIONS) expect(SEXUAL_ORIENTATION_LABELS[o]).toBeTruthy();
    for (const r of RELIGIONS) expect(RELIGION_LABELS[r]).toBeTruthy();
  });
});

describe("shared answer text", () => {
  it("shows a choice or the person's own words, and nothing for no answer or prefer not to say", () => {
    expect(sharedAnswerText("lesbian", null, SEXUAL_ORIENTATION_LABELS)).toBe("Lesbian");
    expect(sharedAnswerText("self_described", " Demisexual ", SEXUAL_ORIENTATION_LABELS)).toBe("Demisexual");
    expect(sharedAnswerText("self_described", " ", SEXUAL_ORIENTATION_LABELS)).toBeNull();
    expect(sharedAnswerText("prefer_not_to_say", null, GENDER_LABELS)).toBeNull();
    expect(sharedAnswerText(null, null, GENDER_LABELS)).toBeNull();
  });
});

describe("pronoun text", () => {
  it("shows a choice, the person's own words, and nothing for no answer or prefer not to say", () => {
    expect(pronounText("she_her", null)).toBe("she/her");
    expect(pronounText("they_them", null)).toBe("they/them");
    expect(pronounText("self_described", "xe/xem")).toBe("xe/xem");
    expect(pronounText("self_described", " ")).toBeNull();
    expect(pronounText("prefer_not_to_say", null)).toBeNull();
    expect(pronounText(null, null)).toBeNull();
  });
});

describe("combined counts", () => {
  const many = (key: string, n: number) => Array.from({ length: n }, () => key);

  it("leaves out a group smaller than the minimum and shows no total", () => {
    const out = summarizeAnswers([...many("woman", MIN_GROUP), ...many("man", MIN_GROUP - 1), ...many("non_binary", 1)], []);
    expect(out.gender).toEqual([{ key: "woman", label: "Woman", count: MIN_GROUP }]);
    expect(out.religion).toEqual([]);
    expect(out.orientation).toEqual([]);
  });

  it("counts sexual orientation with the same minimum", () => {
    const out = summarizeAnswers([], [], [...many("bisexual", MIN_GROUP), ...many("gay", MIN_GROUP - 1)]);
    expect(out.orientation).toEqual([{ key: "bisexual", label: "Bisexual", count: MIN_GROUP }]);
  });

  it("shows every group at or above the minimum, in list order, and ignores blanks", () => {
    const out = summarizeAnswers([], [...many("islam", 6), ...many("roman_catholic", 5), null, null, ...many("judaism", 4)]);
    expect(out.religion.map((g) => [g.key, g.count])).toEqual([
      ["roman_catholic", 5],
      ["islam", 6],
    ]);
  });
});
