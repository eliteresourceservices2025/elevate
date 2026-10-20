"use client";

import { useState } from "react";
import { SelectField, TextField } from "@/components/form-fields";
import { GENDERS, GENDER_LABELS, OTHER_TEXT_MAX, PRONOUNS, PRONOUN_LABELS, RELIGIONS, RELIGION_LABELS } from "../constants";

type Values = { gender?: string | null; genderOther?: string | null; pronouns?: string | null; pronounsOther?: string | null; religion?: string | null; religionOther?: string | null };
type Errors = Partial<Record<"gender" | "genderOther" | "pronouns" | "pronounsOther" | "religion" | "religionOther", string>>;

/**
 * The optional answers, as plain named form fields (gender, genderOther, pronouns, pronounsOther, religion, religionOther).
 * Used on the person's profile card (with pronouns) and in the public application form (without). Every list starts on
 * "Prefer not to answer" (empty), and a self-description box appears only when that choice is picked.
 */
export function SelfIdFields({ idPrefix, initial, withPronouns, errors }: { idPrefix: string; initial?: Values; withPronouns: boolean; errors?: Errors }) {
  const [gender, setGender] = useState(initial?.gender ?? "");
  const [pronouns, setPronouns] = useState(initial?.pronouns ?? "");
  const [religion, setReligion] = useState(initial?.religion ?? "");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-4">
        <SelectField id={`${idPrefix}-gender`} name="gender" label="Gender" value={gender} onChange={(e) => setGender(e.target.value)} error={errors?.gender}>
          <option value="">Skip this question</option>
          {GENDERS.map((g) => (
            <option key={g} value={g}>
              {GENDER_LABELS[g]}
            </option>
          ))}
        </SelectField>
        {gender === "self_described" ? (
          <TextField id={`${idPrefix}-gender-other`} name="genderOther" label="How you describe your gender" maxLength={OTHER_TEXT_MAX} defaultValue={initial?.genderOther ?? ""} error={errors?.genderOther} />
        ) : null}
      </div>
      {withPronouns ? (
        <div className="space-y-4">
          <SelectField id={`${idPrefix}-pronouns`} name="pronouns" label="Pronouns" value={pronouns} onChange={(e) => setPronouns(e.target.value)} error={errors?.pronouns} hint="Shown next to your name for colleagues.">
            <option value="">Skip this question</option>
            {PRONOUNS.map((p) => (
              <option key={p} value={p}>
                {PRONOUN_LABELS[p]}
              </option>
            ))}
          </SelectField>
          {pronouns === "self_described" ? (
            <TextField id={`${idPrefix}-pronouns-other`} name="pronounsOther" label="Your pronouns" maxLength={OTHER_TEXT_MAX} defaultValue={initial?.pronounsOther ?? ""} error={errors?.pronounsOther} />
          ) : null}
        </div>
      ) : null}
      <div className="space-y-4">
        <SelectField id={`${idPrefix}-religion`} name="religion" label="Religion" value={religion} onChange={(e) => setReligion(e.target.value)} error={errors?.religion}>
          <option value="">Skip this question</option>
          {RELIGIONS.map((r) => (
            <option key={r} value={r}>
              {RELIGION_LABELS[r]}
            </option>
          ))}
        </SelectField>
        {religion === "self_described" ? (
          <TextField id={`${idPrefix}-religion-other`} name="religionOther" label="Your religion" maxLength={OTHER_TEXT_MAX} defaultValue={initial?.religionOther ?? ""} error={errors?.religionOther} />
        ) : null}
      </div>
    </div>
  );
}
