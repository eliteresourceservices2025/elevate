# 08 Source check and citations (review packet, course version 2)

**Purpose:** give the Privacy Officer and counsel a short, checkable trail from every factual statement in the HIPAA course to
its public source, so their review is a confirmation, not a research task.

**Status of the course:** draft. Nothing here is legal advice, and nothing replaces counsel's review. Where something is ERS
policy rather than HIPAA law, the course says so and this table marks it.

**Scope:** the HIPAA course only (7 modules). General cybersecurity habits are a separate course
(`apps/learn/src/content/cybersecurity`) and make no legal claims, so they are not part of this packet.

**Method.** Each factual claim was compared with HHS's own pages and the regulation text (45 CFR Parts 160 and 164, from the
eCFR), by reading them, not from memory. The content was also compared, for topic coverage only, with the organization's paid
HIPAA course (see "Coverage" below); no wording was taken from it.

Verdicts: **Confirmed** (the source says it), **Refined** (wording was changed after the check), **ERS policy** (a rule ERS sets,
beyond HIPAA), **Counsel** (a legal judgment the course should not make alone).

## Sources

| Ref | Source | Address |
| --- | --- | --- |
| S1 | HHS, Training Materials (content last reviewed 30 May 2025; "no single standardized program") | https://www.hhs.gov/hipaa/for-professionals/training/index.html |
| S2 | HHS, Summary of the HIPAA Privacy Rule | https://www.hhs.gov/hipaa/for-professionals/privacy/laws-regulations/index.html |
| S3 | HHS, Summary of the HIPAA Security Rule | https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html |
| S4 | HHS, Breach Notification Rule | https://www.hhs.gov/hipaa/for-professionals/breach-notification/index.html |
| S5 | OCR Cybersecurity Newsletter, October 2024 (social engineering) | https://www.hhs.gov/hipaa/for-professionals/security/guidance/cybersecurity-newsletter-october-2024/index.html |
| S6 | OCR Cybersecurity Newsletter, Q1 2022 (common cyber-attacks, training) | https://www.hhs.gov/hipaa/for-professionals/security/guidance/cybersecurity-newsletter-first-quarter-2022/index.html |
| S7 | HHS, HIPAA Security Rule NPRM page (issued 27 December 2024; "the current Security Rule remains in effect") | https://www.hhs.gov/hipaa/for-professionals/security/hipaa-security-rule-nprm/index.html |
| S8 | HHS, Security Rule NPRM fact sheet (the proposals) | https://www.hhs.gov/hipaa/for-professionals/security/hipaa-security-rule-nprm/factsheet/index.html |
| S9 | Unified Agenda entry RIN 0945-AA22 (NPRM 01/06/2025, 90 FR 898; stage "Long-Term Actions"; final action 07/00/2027) | https://www.reginfo.gov/public/do/eAgendaViewRule?pubId=202510&RIN=0945-AA22 |
| R1 | 45 CFR 160.103 (workforce, business associate, subcontractor, PHI) | https://www.ecfr.gov/current/title-45/part-160/section-160.103 |
| R2 | 45 CFR 164.308 (administrative safeguards) | https://www.ecfr.gov/current/title-45/part-164/section-164.308 |
| R3 | 45 CFR 164.310 (physical safeguards) | https://www.ecfr.gov/current/title-45/part-164/section-164.310 |
| R4 | 45 CFR 164.312 (technical safeguards) | https://www.ecfr.gov/current/title-45/part-164/section-164.312 |
| R5 | 45 CFR 164.402 (breach, presumption, risk assessment, exclusions) | https://www.ecfr.gov/current/title-45/part-164/section-164.402 |
| R6 | 45 CFR 164.404 (notice to individuals, 60 days, discovery) | https://www.ecfr.gov/current/title-45/part-164/section-164.404 |
| R7 | 45 CFR 164.410 (notice by a business associate) | https://www.ecfr.gov/current/title-45/part-164/section-164.410 |
| R8 | 45 CFR 164.514 (de-identification, the 18 identifiers) | https://www.ecfr.gov/current/title-45/part-164/section-164.514 |
| R9 | 45 CFR 164.530 (training, sanctions, mitigation, no retaliation, six-year retention) | https://www.ecfr.gov/current/title-45/part-164/section-164.530 |
| R10 | 45 CFR 164.504(e) (business associate contract provisions) | https://www.ecfr.gov/current/title-45/part-164/section-164.504 |
| R11 | 45 CFR 164.512 (disclosures that do not need authorization) | https://www.ecfr.gov/current/title-45/part-164/section-164.512 |

## Claim by claim

### Module 1: foundations

| Claim in the course | Source | Verdict |
| --- | --- | --- |
| HIPAA is a 1996 federal law; the Privacy, Security and Breach Notification Rules are the parts that matter | S2 (Public Law 104-191, enacted 21 August 1996); S3; S4 | Confirmed |
| HHS enforces through its Office for Civil Rights | S2 | Confirmed |
| Covered entities: health plans, clearinghouses, providers that transmit health information electronically in standard transactions | S2 "Who is covered"; R1 | Confirmed (the course says "bills electronically", a plain-words shortening) |
| A business associate does work for a covered entity involving PHI; a subcontractor is used by a business associate | S2 "Business Associates"; R1 | Confirmed |
| Workforce: people under the organization's direct control, paid or not | S2 "Workforce Training and Management"; R1 | Confirmed |
| The chain of trust: each organization that handles the information is bound by an agreement and must bind the next | S2 "Business Associate Contract" ("may not contractually authorize ... any use or disclosure ... that would violate the Rule"); R10 (subcontractors must agree to the same restrictions) | Confirmed |
| What the agreement asks: permitted uses only, safeguards, reporting incl. breaches, subcontractors bound, support for access/amendment/accounting, books open to HHS, return or destroy | R10 (items 1 to 10 of 164.504(e)(2)) | Confirmed |
| Timeline: 1996 law; Privacy Rule compliance by 14 April 2003; HITECH (2009) applies the Security Rule to business associates directly; Omnibus Final Rule published 25 January 2013 | S2 "Compliance Dates"; S3 ("Section 13401 of the HITECH Act ... apply to business associates", "published on January 25, 2013 (commonly known as the 2013 Omnibus Final Rule)") | Confirmed. The Security Rule compliance date is deliberately not stated |
| "Since 2009, ERS answers to the government for its own compliance" | S3 (business associates "civilly and criminally liable"; direct enforcement action) | Confirmed |
| Civil penalties are enforced by OCR; knowing misuse is a crime prosecuted by DOJ: up to $50,000 and 1 year; $100,000 and 5 years with false pretenses; $250,000 and 10 years for intent to sell, transfer or use for commercial advantage, personal gain or malicious harm | S2 "Enforcement and Penalties" (criminal tiers; "The Department of Justice is responsible for criminal prosecutions") | Confirmed (the course gives the prison terms, not the dollar figures) |
| Organizations must train all workforce members, apply sanctions, and keep records six years | S2; R9 (b), (e), (j) | Confirmed |
| Training is repeated every year | HIPAA requires training "as necessary and appropriate"; S1 says there is "no single standardized program"; annual repetition is ERS's own standard | ERS policy (the screen says so) |
| ERS has a Privacy Officer, risk checks and a documented program | R9 (privacy official); R2 (risk analysis, sanction policy) | ERS policy |
| HIPAA prohibits retaliating against people who file a complaint | R9 (g); ERS's own no-punishment promise is stated separately | Confirmed (Refined in version 1) |
| ERS acts as a business associate or subcontractor depending on the client | R1; depends on each contract | Counsel (open item 1) |

### Module 2: PHI, ePHI and identifiers

| Claim | Source | Verdict |
| --- | --- | --- |
| PHI is individually identifiable health information about health, care or payment, in any form: electronic, paper or oral | S2 "What Information is Protected"; R1 | Confirmed |
| ePHI is the electronic form; the Security Rule is about it | S3 | Confirmed |
| HIPAA lists 18 identifiers | R8 (b)(2)(i)(A) to (R) | Confirmed |
| The families and their examples (names and face photos; places smaller than a state, phone, fax, email; dates and ages over 89; SSN, record, plan, account, license numbers; IP, web addresses, device serials, vehicle plates) | R8 | Confirmed |
| Context matters | S2 ("reasonable basis to believe it can be used to identify") | Confirmed |
| De-identified only by removing the identifiers or by expert determination; deleting a name column is not enough | S2 "De-Identified Health Information"; R8 (b)(1) | Confirmed |
| File names and hidden file details can still identify a person | R8 (A) names, (C) dates, (R) any other unique identifying characteristic, applied to files; the course's practical rule | Confirmed |
| (Not in the course) PHI excludes employment records held as an employer | S2; R1 | Noted |

### Module 3: Privacy Rule and minimum necessary

| Claim | Source | Verdict |
| --- | --- | --- |
| Use, disclosure and request are different and each is limited | S2 "Minimum Necessary" | Confirmed |
| Treatment, payment and operations are permitted without authorization | S2 "Permitted Uses and Disclosures" | Confirmed |
| That permission reaches ERS only through the agreement and the client's instructions | S2; R10 | Confirmed |
| Minimum necessary, its exceptions, and role-based access | S2 "Minimum Necessary", "Access and Uses" | Confirmed |
| Written authorization for marketing, employer sharing, most psychotherapy notes, sale of PHI | S2 "Authorization"; marketing and sale are 45 CFR 164.508(a)(3) and (a)(4), not fetched | Confirmed in S2; Counsel to confirm the two examples against 164.508 |
| The law lets or requires sharing without authorization in some situations: required by law, public health, abuse or neglect, oversight, court proceedings, law enforcement | R11 (a) to (f) | Confirmed |
| Law enforcement requests: lawful process or limited identifying details to locate a suspect; the client decides and verifies | R11 (f)(1), (f)(2) | Confirmed; the instruction "route to the client" is ERS policy |
| Incidental disclosures are allowed when reasonable safeguards and minimum necessary are in place | S2 "Incidental Use and Disclosure" | Confirmed |
| Patient rights: access, amendment, accounting of disclosures, restrictions and confidential communications, notice, complaint | S2 "Notice and Other Individual Rights" | Confirmed |
| HIPAA is a floor: a stricter state law can apply; some record types have extra rules | S2 "State Law" (preemption exception for state laws that give greater privacy protection). The substance use treatment records example refers to 42 CFR Part 2 (not fetched) | Confirmed (state law); Counsel for the Part 2 example |
| The ERS 5-point send check | ERS's own practical aid | ERS policy |

### Module 4: the Security Rule

| Claim | Source | Verdict |
| --- | --- | --- |
| Confidentiality, integrity and availability of ePHI | S3 ("Ensure the confidentiality, integrity, and availability of all ePHI") | Confirmed |
| Three kinds of safeguards: administrative, physical, technical | S3 | Confirmed |
| "Addressable" means implement it, or document why and use an equivalent; not optional | R2/R3/R4 labels; S3 "Required and Addressable Implementation Specifications" | Confirmed |
| Unique user identification | R4 (a)(2)(i), Required | Confirmed |
| Automatic log-off and encryption are addressable | R4 (a)(2)(iii), (iv) | Confirmed |
| Person or entity authentication is required; multi-factor authentication is not named in the current rule but is proposed | R4 (d); S8 ("Require the use of multi-factor authentication, with limited exceptions") | Confirmed |
| Audit controls record and examine activity | R4 (b); S3 | Confirmed |
| Access ends with the work: termination procedures | R2 (a)(3)(ii)(C), Addressable | Confirmed |
| A data backup plan is a required part of contingency planning | R2 (a)(7)(ii)(A), Required | Confirmed |
| Security awareness and training covers security reminders, malicious software, log-in monitoring and password management | R2 (a)(5)(ii)(A) to (D), all Addressable | Confirmed |
| Transmission security | R4 (e); S3 | Confirmed |
| The proposed update: MFA and encryption required with limited exceptions, "addressable" removed, written incident response plans tested; it is a proposal and the current rule remains in effect | S7; S8 | Confirmed |
| Status of the proposal: Unified Agenda stage "Long-Term Actions", final action 07/00/2027 | S9 | Confirmed (not stated in the lesson, because it ages; kept here for the reviewer) |

### Module 5: protecting patient information where you work

| Claim | Source | Verdict |
| --- | --- | --- |
| Policies must cover how workstations are used and the physical safeguards around them | R3 (b), (c); S3 "Workstation Use and Security" | Confirmed |
| Device and media controls: receipt, movement, disposal, removal before reuse; disposal and media re-use are required | R3 (d)(1), (d)(2)(i), (d)(2)(ii) | Confirmed |
| Private space, lock the screen, approved systems only, no personal email, cloud or chat, no public AI tools, no saving, printing or photographing, report lost devices at once | Practical ERS and client rules implementing R3 and R4 and the agreement | ERS policy |
| A lost or stolen device is a security incident | R2 (a)(6) (response and reporting, Required) | Confirmed |
| Everyday network and device habits (router, updates, public Wi-Fi) | Moved to the separate Cybersecurity course | Not in this course |

### Module 6: privacy and security incidents

| Claim | Source | Verdict |
| --- | --- | --- |
| A breach is an impermissible use or disclosure that compromises the security or privacy of PHI | R5; S4 | Confirmed |
| It is presumed a breach unless a risk assessment shows a low probability of compromise (four factors) | R5; S4 | Confirmed |
| The client and ERS decide whether it is a reportable breach, not the person who made the mistake | R5; S4 | Confirmed |
| Individuals must be told without unreasonable delay and no later than 60 days after discovery | R6 (b) | Confirmed |
| A business associate must tell the covered entity, with the same 60-day outer limit; many contracts require sooner | R7 (a), (b) | Confirmed; Counsel to confirm each client's contract |
| A breach is discovered the first day it is known, or would have been known with reasonable diligence, to anyone other than the person who caused it | R6 (a)(2), R7 (a)(2) | Confirmed (Refined in version 1) |
| Properly encrypted information is "secured": notification may not be required; the client decides | S4 ("specifies encryption and destruction as the technologies and methodologies") | Confirmed |
| Common causes of incidents | General experience; consistent with S6 and OCR's breach reporting | Confirmed (practice) |
| Mitigation: reduce harm as far as practicable | R9 (f) | Confirmed |
| Report right away to the lead and HR, keep evidence, write facts without patient details, do not contact the patient | ERS procedure | ERS policy |
| HIPAA prohibits retaliation for filing a complaint | R9 (g) | Confirmed |

### Module 7: scenario lab

The scenarios restate Modules 1 to 6; they contain no additional factual claims. Names and details are invented.

## Version history of the course

**Version 1 → 2 (this packet):**

1. Exam changed to **15 questions and 80%**, to match the organization's existing course (tries stay at 3).
2. The course is **HIPAA only**. The phishing module and the generic remote-work and home-network material moved to the separate
   Cybersecurity course; Modules 4 and 5 were rewritten in HIPAA terms (Security Rule safeguards; workstation and device
   controls), with the proposed Security Rule update stated as a proposal.
3. New content from the topic comparison: the chain of trust, what the agreement asks of ERS, a short timeline, who enforces
   and the criminal tiers (Module 1); file names and photo details in de-identification (Module 2); when police, courts or
   agencies ask, and incidental disclosures (Module 3); access that must end with the work, and backups (Module 4); what
   usually goes wrong and encryption (Module 6).
4. Wording corrections from the earlier check: workforce definition, anti-retaliation rule, breach discovery, MFA described as
   practice, ZIP codes described as "any place smaller than a state".

## Coverage compared with the organization's paid HIPAA course

The organization's HIPAA training account was used as a **topic reference** (its six lessons: Introduction, Using and Disclosing
PHI, HIPAA Privacy, HIPAA Security, HIPAA and State Laws, Becoming HIPAA Compliant, plus a 15-question exam at 80%). Its
wording and figures were not used. Its screenshots were also checked for statements that are out of date or not in the rule, so
they are not carried over.

| Their lesson | ELEVATE Learn | Result |
| --- | --- | --- |
| 1 Introduction (what HIPAA is, ecosystem, covered entities, business associates, chain of trust, timeline, structure, compliance, penalties) | Module 1 | Covered; structure of the titles is not taught because a VA does not need it |
| 2 Using and Disclosing PHI (TPO, exceptions, authorizations, sensitive information, third parties, minimum necessary, incidental, de-identification, breaches, with case studies) | Modules 2, 3 and 6 | Covered, with scenarios in place of open case studies |
| 3 HIPAA Privacy (patient rights, notice of privacy practices, business associate contracts, administrative safeguards, formal documents) | Modules 1 and 3 | Covered at the level a VA acts on; the organization-level documents belong to the Privacy Officer |
| 4 HIPAA Security (objectives, flexibility, three safeguards, case studies on ended access, unlocked screens, malware and backups) | Modules 4, 5 and 6 | Covered |
| 5 HIPAA and State Laws (more protective state law prevails; Texas and California examples) | Module 3 screen "HIPAA is the minimum, not the maximum" | Covered as a principle; state-by-state detail is not taught because clients span states |
| 6 Becoming HIPAA Compliant (objectives, officers, risk assessment, common violations, "common sense") | Module 1 (program), Module 6 (what usually goes wrong) | Covered |
| Final exam, 15 questions, 80%, certificate | Same exam size and pass mark; certificate with reference and public check | Matched |

**Statements in that course that were not carried over:** a penalty range of "$100 to $50,000 per violation" (HHS adjusts the
civil figures every year; S2 shows the current table), a rule that training must be repeated "every 2 years" (HIPAA sets no
period; S1), a statement that encryption is "not required" in terms that predate the proposed update (R4 lists it as
addressable; S8 proposes making it required), and state-law specifics for two states.

## Open items for the reviewer (counsel or Privacy Officer)

1. **ERS's legal role** per client (business associate or subcontractor), and how HIPAA applies to a Philippine workforce under
   each agreement. The course says only that the same protections follow the information "through the contracts ERS signs".
2. **Contract deadlines**: the course gives 60 days as HIPAA's outer limit and says contracts are often shorter. Confirm each
   client's actual notice period so Module 6 can state ERS's internal deadline.
3. **Authorization examples** (marketing, sale of PHI, psychotherapy notes) are from the HHS summary; confirm against 45 CFR
   164.508.
4. **Substance use treatment records (42 CFR Part 2)** are mentioned as an example of extra rules; confirm or remove.
5. **Responsibility statement** (`v1-draft`) and the plain-words wording of sanctions.
6. **The proposed Security Rule update.** The lesson states it as a proposal. If a final rule is published (S9 shows a final
   action date of 07/00/2027), Modules 4 and 5 need a new version.
7. **Penalty amounts** (civil) are deliberately not in the course. The criminal prison terms are.
8. **Review date and reviewer** are recorded when the version is published (`reviewed_by`, `counsel_approved_on`).

## How to keep this current

Re-run this check when: HHS publishes a final Security Rule modification, OCR issues new guidance on a topic in the course, a
client contract changes the notice period, or the course content changes materially. Record the date and the reviewer in the
published version.
