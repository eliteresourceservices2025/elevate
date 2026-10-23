# 15. HIPAA and Cybersecurity v3 plan

Status: planning (23 October 2026). Owner decisions: HIPAA update is **material**; Cybersecurity gaps come from research the owner approves first; **all 20 recap videos** are re-recorded in the owner's cloned voice (VoiceStudio) with the Pixabay lofi track; order is **HIPAA first, then Cybersecurity**. The approved working plan is kept in the session plan file; this page is the durable record.

## Source reviewed

165 screenshots of the HIPAATraining.com course (6 lessons, 136 slides, final exam of 15 questions). The course is undated and has **no 2026-specific content**, so anything "latest" must come from official sources (HHS, eCFR, Federal Register) and go through `08-source-check.md` and counsel.

## Gap map (first pass, by keyword search; confirm screen by screen when writing)

| Source topic | In v2? | Where / action |
|---|---|---|
| What HIPAA is, 1996 to Omnibus timeline, five titles | Covered | `m1-foundations` (timeline, HITECH, Omnibus) |
| Covered entities (providers, plans, clearinghouses), business associates, chain of trust to subcontractors | Covered | `m1-foundations`, `m5-associates` |
| PHI / ePHI, 18 identifiers | Covered | `m2-phi` |
| TPO, authorizations, minimum necessary, incidental disclosures, law-enforcement requests | Covered | `m3-privacy` |
| De-identification (identifier list, file metadata, cosmetic-photo case) | Thin | Check `m2-phi` and `m3-privacy`; add a metadata example |
| Sensitive records (substance use, mental health, STD) kept apart | Thin | Add to `m3-privacy` / `m4-rights`; Part 2 needs counsel |
| Patient rights, Notice of Privacy Practices | Covered | `m4-rights` |
| Security Rule: purpose, three safeguard types, flexibility factors | Covered | `m6-security` (flexibility at line ~29); add a safeguard-sorter game |
| Breach case: stolen laptop, encryption removes notification | Covered | `m7-incidents`, `m6-security` |
| Enforcement news (Cardionet, MD Anderson, copier drives) | Covered, more recent cases | `m8-enforcement` |
| **State laws: more protective law wins, areas where states are stricter** | **Missing** (only a one-line "stricter state law" note) | New module `m11-state-laws` |
| **Texas HB 300** (15 business days for electronic records, SPI, training in 90 days, AG audits) | **Missing** | `m11-state-laws` |
| **California CMIA** (separate authorization for sensitive info, 5-business-day breach report, snooping) | **Missing** | `m11-state-laws` |
| Becoming compliant: compliance officer, training, documents; keys to success (education, commitment, culture); common violations | Thin | Add a closing "keeping it going" screen and a common-violations game |
| Source quiz formats: match, select-all, drag-match | Partly | Use `cards`, `sort`, `game`; select-all only if `q()` allows |

## Rules for what goes in

- Every new legal claim is added to `08-source-check.md` with its source before it reaches a lesson. Uncertain claims go on the counsel list, not into the course.
- Texas and California are the source course's examples. ERS-specific state list is an open owner question.
- Lessons are written for ERS contractors working for US clients, not for a clinic's own compliance officer.

## Open items

- Which other states matter for ERS clients.
- Counsel review date and reviewer email for publishing.
- Whether HIPAA and Cybersecurity are `studio_managed` in production (decides `learn:publish` versus the Studio).
- Where the licensed music file is kept so videos can be rebuilt (`bgm.mp3` is git-ignored).
