# Voluntary self-identification (gender, pronouns, religion)

Optional answers, in `src/modules/demographics/`. Read this before changing the fields, the apply form's optional section or the HR counts.

## Rules (do not weaken)
- **Everything is optional** and every list has "prefer not to say". A self-description needs its words (`validators.ts`).
- **Nobody reads another person's gender or religion.** The person sees their own on their profile ("About me"); HR sees only combined counts (`demographics.view_summary`, Analytics page). There is no per-person screen, export or API for these values.
- **Groups under 5 are never shown** (`MIN_GROUP`), and neither the dropped groups nor a total is shown. The rule runs on the server (`summarizeAnswers`).
- **Pronouns are the only public part**: shown next to the name for anyone who can see the directory (`getPronounsFor`).
- **Never used to decide anything** about hiring, promotion, pay or reviews. Do not add these values to any scorecard, review, candidate view, export, email or notification.
- Audit rows hold field **names** only (`demographics.update`, `demographics.clear`, `demographics.view_summary`), never a value.

## Storage
- `core.employee_demographics` (one row per person) and `talent.candidate_self_identification` (one row per applicant). RLS on, no policies.
- They are separate tables on purpose: no `select * from employees/candidates` can pick the answers up. **No recruiting or people query may join them** (a test scans for it).
- Gender key is plain (counted in SQL). Religion and every self-described text are encrypted with `fieldCrypto()`, contexts `employee_demographics:<field>:<employeeId>` and `candidate_self_id:<field>:<candidateId>`. Pronouns are plain (they are shown).

## Where it is used
- Profile: `SelfIdCard` on the person's own Personal tab (`people/components/profile-view.tsx`); pronouns beside the name.
- Apply form: optional "About you" section (`SelfIdFields`, gender and religion only). `submitApplication` checks it with `applicantSelfIdSchema` and stores it in the application's transaction; it never touches `candidates`.
- HR counts: `SelfIdSummary` on the Analytics page.
- Removal: both retention paths delete the rows (`clearEmployeeSelfId` in people retention, `deleteApplicantSelfId` in the recruiting purge). A person can remove all answers at any time.

## Privacy notice
The notice and `docs/policies/privacy-notice.md` describe this. Publishing a notice is permanent and gates everyone: counsel reads the wording first, and never publish one against a shared dev database. The "My data" export does not decrypt anything; these answers are shown and removable on the profile instead.
