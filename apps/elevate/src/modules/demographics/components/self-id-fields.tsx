"use client";

import { useState } from "react";
import { SelectField, TextField } from "@/components/form-fields";
import { GENDERS, GENDER_LABELS, OTHER_TEXT_MAX, PRONOUNS, PRONOUN_LABELS, RELIGIONS, RELIGION_LABELS, SEXUAL_ORIENTATIONS, SEXUAL_ORIENTATION_LABELS } from "../constants";

type Values = {
  gender?: string | null;
  genderOther?: string | null;
  pronouns?: string | null;
  pronounsOther?: string | null;
  orientation?: string | null;
  orientationOther?: string | null;
  religion?: string | null;
  religionOther?: string | null;
  showGender?: boolean;
  showOrientation?: boolean;
  showReligion?: boolean;
};
type Errors = Partial<Record<"gender" | "genderOther" | "pronouns" | "pronounsOther" | "orientation" | "orientationOther" | "religion" | "religionOther", string>>;

/** The "Show on my profile" switch under an answer. A plain named checkbox, read by the card on save. */
function ShareSwitch({ id, name, defaultChecked, disabled }: { id: string; name: string; defaultChecked: boolean; disabled: boolean }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm text-muted-foreground">
      <input id={id} name={name} type="checkbox" className="size-4 accent-primary" defaultChecked={defaultChecked && !disabled} disabled={disabled} />
      Show on my profile to colleagues
    </label>
  );
}

/**
 * The optional answers, as plain named form fields (gender, genderOther, pronouns, pronounsOther, orientation,
 * orientationOther, religion, religionOther, and with `withShare` the switches showGender, showOrientation, showReligion).
 * Used on the person's profile card (with pronouns and the switches) and in the public application form (without: nothing
 * an applicant answers is ever shown to anyone). Every list starts on "Skip this question" (empty), and a self-description
 * box appears only when that choice is picked.
 */
export function SelfIdFields({ idPrefix, initial, withPronouns, withShare = false, errors }: { idPrefix: string; initial?: Values; withPronouns: boolean; withShare?: boolean; errors?: Errors }) {
  const [gender, setGender] = useState(initial?.gender ?? "");
  const [pronouns, setPronouns] = useState(initial?.pronouns ?? "");
  const [orientation, setOrientation] = useState(initial?.orientation ?? "");
  const [religion, setReligion] = useState(initial?.religion ?? "");
  // Sharing "no answer" or "prefer not to say" shows nothing, so the switch is off and disabled until there is an answer to show.
  const nothingToShow = (v: string) => v === "" || v === "prefer_not_to_say";
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
        {withShare ? <ShareSwitch id={`${idPrefix}-show-gender`} name="showGender" defaultChecked={initial?.showGender ?? false} disabled={nothingToShow(gender)} /> : null}
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
        <SelectField id={`${idPrefix}-orientation`} name="orientation" label="Sexual orientation" value={orientation} onChange={(e) => setOrientation(e.target.value)} error={errors?.orientation}>
          <option value="">Skip this question</option>
          {SEXUAL_ORIENTATIONS.map((o) => (
            <option key={o} value={o}>
              {SEXUAL_ORIENTATION_LABELS[o]}
            </option>
          ))}
        </SelectField>
        {orientation === "self_described" ? (
          <TextField id={`${idPrefix}-orientation-other`} name="orientationOther" label="How you describe your sexual orientation" maxLength={OTHER_TEXT_MAX} defaultValue={initial?.orientationOther ?? ""} error={errors?.orientationOther} />
        ) : null}
        {withShare ? <ShareSwitch id={`${idPrefix}-show-orientation`} name="showOrientation" defaultChecked={initial?.showOrientation ?? false} disabled={nothingToShow(orientation)} /> : null}
      </div>
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
        {withShare ? <ShareSwitch id={`${idPrefix}-show-religion`} name="showReligion" defaultChecked={initial?.showReligion ?? false} disabled={nothingToShow(religion)} /> : null}
      </div>
    </div>
  );
}
