# 08 Source check and citations (review packet)

**Purpose:** give the Privacy Officer and counsel a short, checkable trail from every factual statement in the HIPAA course to its
public source, so their review is a confirmation, not a research task.

**Status of the course:** draft. Nothing here is legal advice, and nothing replaces counsel's review. This check was done with
HHS's own pages and the regulation text; where something is ERS policy rather than HIPAA law, the course says so and this table
marks it.

**Method.** Each factual claim in the course (`apps/learn/src/content/hipaa/`) was compared with: the HHS summaries of the
Privacy, Security and Breach Notification Rules, HHS's training page, OCR's cybersecurity newsletters, and the regulation text
(45 CFR Parts 160 and 164, from the eCFR). The check was done by reading those pages, not from memory.

Verdicts: **Confirmed** (the source says it), **Refined** (the course wording was changed after the check), **ERS policy** (a rule
ERS sets, stricter than or beyond HIPAA), **Counsel** (a legal judgment the course should not make alone).

## Sources

| Ref | Source | Address |
| --- | --- | --- |
| S1 | HHS, Training Materials (content last reviewed 30 May 2025) | https://www.hhs.gov/hipaa/for-professionals/training/index.html |
| S2 | HHS, Summary of the HIPAA Privacy Rule | https://www.hhs.gov/hipaa/for-professionals/privacy/laws-regulations/index.html |
| S3 | HHS, Summary of the HIPAA Security Rule | https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html |
| S4 | HHS, Breach Notification Rule | https://www.hhs.gov/hipaa/for-professionals/breach-notification/index.html |
| S5 | OCR Cybersecurity Newsletter, October 2024 (social engineering) | https://www.hhs.gov/hipaa/for-professionals/security/guidance/cybersecurity-newsletter-october-2024/index.html |
| S6 | OCR Cybersecurity Newsletter, Q1 2022 (common cyber-attacks, training) | https://www.hhs.gov/hipaa/for-professionals/security/guidance/cybersecurity-newsletter-first-quarter-2022/index.html |
| R1 | 45 CFR 160.103 (definitions: workforce, business associate, subcontractor, PHI) | https://www.ecfr.gov/current/title-45/part-160/section-160.103 |
| R2 | 45 CFR 164.308 (administrative safeguards) | https://www.ecfr.gov/current/title-45/part-164/section-164.308 |
| R3 | 45 CFR 164.310 (physical safeguards) | https://www.ecfr.gov/current/title-45/part-164/section-164.310 |
| R4 | 45 CFR 164.312 (technical safeguards) | https://www.ecfr.gov/current/title-45/part-164/section-164.312 |
| R5 | 45 CFR 164.402 (breach definition, presumption, risk assessment) | https://www.ecfr.gov/current/title-45/part-164/section-164.402 |
| R6 | 45 CFR 164.404 (notice to individuals, 60 days, discovery) | https://www.ecfr.gov/current/title-45/part-164/section-164.404 |
| R7 | 45 CFR 164.410 (notice by a business associate) | https://www.ecfr.gov/current/title-45/part-164/section-164.410 |
| R8 | 45 CFR 164.514 (de-identification, the 18 identifiers) | https://www.ecfr.gov/current/title-45/part-164/section-164.514 |
| R9 | 45 CFR 164.530 (training, sanctions, mitigation, no retaliation, six-year retention) | https://www.ecfr.gov/current/title-45/part-164/section-164.530 |

## Claim by claim

### Module 1: foundations

| Claim in the course | Source | Verdict |
| --- | --- | --- |
| HIPAA is a 1996 federal law; the Privacy, Security and Breach Notification Rules are the parts that matter | S2 (HIPAA, Public Law 104-191, enacted 21 August 1996); S3 (Privacy, Security and Breach Notification Rules "together"); S4 | Confirmed |
| HHS enforces through its Office for Civil Rights | S2 ("Within HHS, the Office for Civil Rights has responsibility for implementing and enforcing the Privacy Rule") | Confirmed |
| Covered entities: health plans, clearinghouses, providers that transmit health information electronically in standard transactions | S2 "Who is covered"; R1 | Confirmed (the course says "bills electronically", a plain-words shortening) |
| A business associate does work for a covered entity involving PHI; a subcontractor is used by a business associate | S2 "Business Associates"; R1 ("Business associate", "Subcontractor"; a subcontractor that handles PHI is itself a business associate) | Confirmed |
| Workforce: people under the organization's direct control, paid or not | S2 "Workforce Training and Management"; R1 ("Workforce") | Refined (was "the people who work under these organizations") |
| Depending on the client, ERS acts as a business associate or subcontractor | R1 (definitions); the actual role depends on each contract | Counsel (see open item 1) |
| Organizations face civil money penalties; certain violations can be prosecuted criminally | S2 "Enforcement and Penalties" ("civil money penalties ... certain violations ... may be subject to criminal prosecution") | Confirmed (no dollar amounts are used in the course on purpose: they change every year) |
| Organizations must train all workforce members, have sanctions, and keep records six years | S2 "Workforce Training and Management"; R9 (b), (e), (j) | Confirmed |
| Training is repeated every year | HIPAA requires training "as necessary and appropriate"; S1 says there is "no single standardized program"; annual repetition is ERS's standard | ERS policy (the screen now says so) |
| ERS has a Privacy Officer, risk checks and a documented program | R9 (designation of a privacy official); R2 (risk analysis, sanction policy); this is how ERS organizes it | ERS policy (new screen "How ERS keeps this program running") |
| HIPAA prohibits retaliating against people who file a complaint | R9 (g) "Refraining from intimidating or retaliatory acts" | Refined (was "good-faith reporting is protected", which was broader than the rule; ERS's own no-punishment promise is now stated separately) |
| Looking at records without a work reason is a violation | S2 ("A covered entity may not use or disclose protected health information, except ... as the Privacy Rule permits or requires"); minimum necessary and role-based access policies | Confirmed |

### Module 2: PHI, ePHI and identifiers

| Claim | Source | Verdict |
| --- | --- | --- |
| PHI is individually identifiable health information about past, present or future health or condition, the provision of care, or payment, in any form: electronic, paper or oral | S2 "What Information is Protected"; R1 | Confirmed |
| ePHI is the electronic form, and the Security Rule is about it | S3 ("protect ... electronic protected health information (ePHI)") | Confirmed |
| HIPAA lists 18 identifiers | R8 (b)(2)(i)(A) to (R) is 18 items | Confirmed |
| The five "families" and their examples: names, face photos, biometric prints; addresses, places, phone, fax, email; dates and ages over 89; SSN, record, plan, account, license numbers; IP, web addresses, device serials, vehicle plates | R8 | Confirmed. Refined: the contact line now reads "any place smaller than a state", because the rule allows the first three ZIP digits in some cases |
| Dates related to the individual are identifiers (birth, admission, discharge, appointment); ages over 89 | R8 (C): all date elements except year, ages over 89 | Confirmed |
| Context matters: a name in a clinic's list is PHI | S2 ("reasonable basis to believe it can be used to identify the individual") | Confirmed |
| De-identified only by removing the identifiers or an expert determination; deleting a name column is not enough | S2 "De-Identified Health Information" (two ways); R8 (b)(1) (expert determination or safe harbor, with no actual knowledge that the rest could identify) | Confirmed |
| Screenshots, copies and exports carry the same protection | S2 ("in any form or media"); the course's own practical rule | Confirmed |
| (Not in the course) PHI excludes employment records a covered entity keeps as an employer | S2; R1 | Noted: ERS's own HR records are not PHI |

### Module 3: Privacy Rule and minimum necessary

| Claim | Source | Verdict |
| --- | --- | --- |
| Use, disclosure and request are different actions and each is limited | S2 ("use, disclose, and request only the minimum amount") | Confirmed |
| Treatment, payment and operations may be used and shared without the patient's authorization | S2 "Permitted Uses and Disclosures" (2) | Confirmed |
| That permission reaches ERS only through the business associate agreement and the client's instructions | S2 "Business Associate Contract" ("may not contractually authorize ... any use or disclosure ... that would violate the Rule") | Confirmed |
| Minimum necessary: least amount needed; not the entire record unless justified | S2 "Minimum Necessary" | Confirmed |
| Exceptions: treatment between providers, to the patient, with authorization, to HHS, required by law | S2 (a) to (f) | Confirmed |
| Access is by role | S2 "Access and Uses" (policies restricting access by workforce role) | Confirmed |
| Written authorization is needed for marketing, employer sharing, most psychotherapy notes, and sales of PHI | S2 "Authorization" ("written authorization for any use or disclosure ... not for treatment, payment or health care operations or otherwise permitted") and "Psychotherapy notes"; the marketing and sale rules are in 45 CFR 164.508(a)(3) and (a)(4), not fetched here | Confirmed in S2; Counsel to confirm the two examples marked to 164.508 |
| Patient rights: access, amendment, accounting of disclosures, restrictions and confidential communications, notice, complaint | S2 "Notice and Other Individual Rights" | Confirmed |
| HIPAA is a floor: a stricter state law can apply as well; some record types have extra rules | S2 "State Law" (preemption does not apply to contrary state laws that provide greater privacy protection). The substance use treatment records example refers to 42 CFR Part 2 (not fetched) | Confirmed (state law); Counsel for the Part 2 example |
| The ERS 5-point send check (Who, What, Why, Where, How) | ERS's own practical aid | ERS policy |

### Module 4: Security Rule and safeguards

| Claim | Source | Verdict |
| --- | --- | --- |
| The rule protects confidentiality, integrity and availability of ePHI | S3 ("Ensure the confidentiality, integrity, and availability of all ePHI") | Confirmed |
| Three kinds of safeguards: administrative, physical, technical | S3 | Confirmed |
| Security awareness and training for all workforce members; sanctions | S3; R2 (a)(5), (a)(1)(ii)(C) | Confirmed |
| Unique user identification (own login) | R4 (a)(2)(i), Required | Confirmed |
| Automatic log-off, encryption | R4 (a)(2)(iii), (iv), both Addressable | Confirmed (the course asks people not to bypass these; it does not call them mandatory) |
| Audit controls: activity is recorded and examined | R4 (b); S3 "Audit Controls" | Confirmed |
| Person or entity authentication (multi-factor sign-in is one way) | R4 (d). The current rule does not name multi-factor authentication | Refined: "stops most attackers" became "greatly reduces the chance a stolen password alone is enough"; MFA is presented as ERS and client practice, not as a HIPAA requirement |
| Transmission security: protect ePHI sent over a network | R4 (e); S3 "Transmission Security" | Confirmed |
| Passwords and protection from malicious software are part of awareness training | R2 (a)(5)(ii)(B), (D) (both Addressable) | Confirmed |
| "Least privilege" | A general security term; the Security Rule states it as workforce security and access management (S3 "Workforce Security", "Access Control") | Confirmed (term is plain-language) |
| A ransomware attack is a security incident even if nothing is read | R2 (a)(6) security incident procedures; the Security Rule's availability goal | Confirmed |

### Module 5: working remotely and securing devices

| Claim | Source | Verdict |
| --- | --- | --- |
| Policies must cover how workstations are used and protected, and how devices and media are handled | R3 (b), (c), (d); S3 "Workstation Use and Security", "Device and Media Controls" | Confirmed |
| Final disposal and removing ePHI before media is reused are required | R3 (d)(2)(i), (ii), both Required | Confirmed |
| Private workspace, screen lock, no photos, approved systems only, no personal email, cloud or chat, no pasting into public AI tools, no public Wi-Fi without the client's secure connection, strong router password, WPA2 or WPA3, report lost devices immediately | These are practical and ERS or client rules, not line-by-line HIPAA text; they implement R3 and R4 and the client's agreement | ERS policy (and the course tells people the client's rules may be stricter) |
| Lock shortcuts (Windows key and L; Control, Command and Q on a Mac) | Operating system documentation | Confirmed (platform facts) |

### Module 6: phishing and social engineering

| Claim | Source | Verdict |
| --- | --- | --- |
| Attackers target people; phishing is one of the most frequent social engineering attacks, with smishing and voice variants | S5 (defines phishing, smishing and others) ; S6 | Confirmed |
| Workforce training and security reminders are part of the Security Rule's awareness requirement | S5 (links workforce education to the security awareness and training provision); R2 (a)(5)(ii)(A) | Confirmed |
| The warning signs (urgency, requests for credentials, look-alike senders, mismatched links, unexpected attachments) and the response steps (stop, check, verify through a known channel, report) | General practice, consistent with S5 and S6 | Confirmed (practice) |
| MFA fatigue | Not in HIPAA text; a widely documented technique | ERS policy / practice |
| Report quickly if you clicked; do not delete the message | S5, R2 (a)(6) (incidents must be identified, responded to and documented) | Confirmed |

### Module 7: privacy and security incidents

| Claim | Source | Verdict |
| --- | --- | --- |
| A breach is an impermissible use or disclosure that compromises the security or privacy of PHI | R5; S4 | Confirmed |
| It is presumed a breach unless a risk assessment shows a low probability of compromise (four factors) | R5 (nature and extent of the PHI, who used or received it, whether it was actually acquired or viewed, how far the risk is mitigated); S4 | Confirmed |
| The client and ERS decide whether it is a reportable breach, not the person who made the mistake | R5, S4 (the covered entity or business associate demonstrates low probability) | Confirmed |
| Individuals must be told without unreasonable delay and no later than 60 days after discovery | R6 (b) ("without unreasonable delay and in no case later than 60 calendar days after discovery") | Confirmed |
| A business associate must tell the covered entity; many contracts require it sooner | R7 (a), (b) (same 60 calendar days outer limit); contracts commonly set shorter times | Confirmed; Counsel to confirm each client's actual contract deadline |
| A breach is discovered the first day it is known, or would have been known with reasonable diligence; knowledge of others in the organization counts | R6 (a)(2), R7 (a)(2) (knowledge of any workforce member or agent other than the person who committed it is imputed) | Refined (was "when anyone in the workforce knew") |
| Some events are not breaches (good-faith unintentional access within authority; inadvertent disclosure between authorized people; recipient could not have retained it) | R5 (exclusions (i) to (iii)) | Confirmed; deliberately not taught, because a VA must report and let the client decide |
| Mitigation: reduce harm as far as practicable | R9 (f) | Confirmed |
| Report right away to the lead and HR, keep evidence, write facts without patient details, do not contact the patient | ERS procedure | ERS policy |
| HIPAA prohibits retaliation for filing a complaint | R9 (g) | Refined (see Module 1) |

### Module 8: scenario lab

The scenarios and the readiness list restate Modules 1 to 7; they contain no additional factual claims. Names and details are
invented.

## What changed because of this check

1. Workforce definition aligned with the regulation (Module 1).
2. "Reporting is protected" replaced by the accurate anti-retaliation rule, with ERS's own promise stated separately (Modules 1, 7).
3. Breach discovery wording aligned with the regulation (Module 7).
4. MFA described as practice, not as a HIPAA requirement (Module 4).
5. ZIP codes described as "any place smaller than a state" (Module 2).
6. New screens and 5 new questions for gaps against the organization's paid course (below).
7. Estimated time rose from 85 to 88 minutes; the bank is now 85 questions.

## Coverage compared with the organization's paid HIPAA course

| Paid course topic | ELEVATE Learn | Result |
| --- | --- | --- |
| About this course | Module 1, welcome screen | Covered |
| Introduction to HIPAA | Module 1 | Covered |
| Using and Disclosing PHI | Module 3 (use, disclosure, request; TPO; **new:** written authorization) | Covered, gap closed |
| HIPAA Privacy (safeguards from a people standpoint) | Modules 2 and 3; **new:** patient rights screen | Covered, gap closed |
| HIPAA Security (safeguards, IT minimum floor) | Modules 4, 5 and 6 | Covered, with a remote-work focus the paid course does not have |
| HIPAA and State Laws | **New:** Module 3 screen "HIPAA is the minimum, not the maximum" | Gap closed |
| Becoming HIPAA Compliant (organization's program) | **New:** Module 1 screen "How ERS keeps this program running"; Module 7 (incidents) | Covered at the level a VA needs; the organization-level detail belongs to the Privacy Officer, not the course |
| Final exam: 15 questions, 80% | 25 questions (Full) or 15 (Essentials), 85%, three tries, wait between tries | Differs by decision (see below) |
| Certificate of completion | Certificate with reference and public check | Covered |

Where ELEVATE Learn goes further than the paid course: remote workspace and device rules, phishing and social engineering,
scenario practice, randomized exam with a rotating bank, server-measured study time, attestation, and annual renewal tracking.

**Exam difference to decide:** the paid course uses 15 questions and 80%. Ours was set earlier at 25 questions and 85% for the
Full track. Both are defensible; HHS does not set a pass mark (S1: "no single standardized program"). If HR prefers parity, the
change is one setting in the exam configuration of a new version.

## Open items for the reviewer (counsel or Privacy Officer)

1. **ERS's legal role** per client (business associate or subcontractor) and whether the course should name it; also how HIPAA
   applies to ERS's Philippine workforce under each BAA. The course says only that the same protections follow the information
   "through the contracts ERS signs".
2. **Contract deadlines**: the course gives 60 days as HIPAA's outer limit and says contracts are often sooner. Confirm each
   client's actual notice period so Module 7 can state ERS's internal deadline.
3. **Authorization examples** (marketing, sale of PHI, psychotherapy notes) are from the HHS summary; confirm against 45 CFR
   164.508 for the exact wording.
4. **Substance use treatment records (42 CFR Part 2)** are mentioned as an example of extra rules; confirm or remove.
5. **Responsibility statement** (`v1-draft`) and the plain-words wording of sanctions.
6. **Pending change:** HHS has proposed modifications to the Security Rule (noted on S3). The course describes the rule now in
   effect. If a final rule is published (for example making multi-factor authentication or encryption mandatory), Modules 4 and
   5 need a new version.
7. **Penalty amounts** are deliberately not in the course (HHS adjusts them yearly; S2 shows the current table).
8. **Review date and reviewer** are recorded when the version is published (`reviewed_by`, `counsel_approved_on`).

## How to keep this current

Re-run this check when: HHS publishes a final Security Rule modification, OCR issues new guidance on a topic in the course,
a client contract changes the notice period, or the course content changes materially. Record the date and the reviewer in the
published version.
