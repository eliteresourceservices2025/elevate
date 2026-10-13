# 09 Cybersecurity basics: sources and coverage

The Cybersecurity basics course (`apps/learn/src/content/cybersecurity`) is general good practice for everyone at ERS. It makes
**no legal claims** (HIPAA is its own course), so it needs no counsel review for the law, but the Privacy Officer or the person
who runs IT at ERS should read it before it is published, because it describes ERS's own practice (what to report, to whom).

**How it was built.** The topics come from the four resources the owner shared, cross-checked with two official sources
(CISA and the FTC). The text is original; no wording was copied.

## Sources

| Ref | Source | What it contributed |
| --- | --- | --- |
| C1 | CISA, "Secure Our World" (cisa.gov/secure-our-world) | The four core behaviours: recognize and report phishing, use strong passwords with a password manager, turn on multi-factor authentication, update software |
| C2 | FTC, Cybersecurity for Small Business (ftc.gov/business-guidance/small-businesses/cybersecurity) | Basics (update, back up, strong passwords with MFA, router defaults and WPA2/WPA3, separate guest and public Wi-Fi), physical security, phishing, ransomware, business email imposters, tech support scams, secure remote access, vendor security, the NIST Cybersecurity Framework functions |
| C3 | FTC, "Cybersecurity for small business: Phishing" (ftc.gov/business-guidance/blog/2018/11/cybersecurity-small-business-phishing) | Signs of phishing; verify with a known number; what to do if someone falls for it; reporting |
| C4 | FTC, fact sheets (ftc.gov/system/files/attachments/cybersecurity-small-business/cybersecuirty_sb_factsheets_all.pdf) and the FTC pages on ransomware and physical security | Ransomware: disconnect infected devices without shutting them down, keep backups not connected to the network, patch; physical: locked storage, limited access, encryption and strong passwords reduce harm from lost devices |
| C5 | InfoBahn, "Cyber security training for employees" (ibahn.net.ph/blogs/insights/cyber-security-training-for-employees) | Topics: fundamentals and terminology, threats (phishing, malware, ransomware, trojans, denial of service, password attacks), case studies, security protocols (role-based access, recording and reporting incidents to a supervisor), proper password habits, all ranks take part |
| C6 | SafetyHub, "Cyber security awareness training for employees" (safetyhub.com/safety-training/cyber-security-awareness-training-for-employees/) | Topics: phishing, malware, ransomware, insider threats |
| C7 | SecurityScorecard, "34 resources for employee cybersecurity training" (securityscorecard.com/blog/34-resources-for-employee-cybersecurity-training/) | Topics: phishing detection and response, password practices and safe browsing, social engineering, ransomware, device protection, email and online privacy, working and video conferencing securely from home, incident response; short micro-learning modules; free sources (CISA, HHS, others) |

Note on C4: the combined FTC PDF could not be read as text in this session (it is image-based), so its content was taken from
the FTC's web pages on the same topics.

## Coverage map

| Topic named by the sources | Module in the course |
| --- | --- |
| Fundamentals, terminology, why everyone matters (C5, C7) | 1 Why security is everyone's job |
| The four core behaviours (C1) | 1, then one module each: 2, 3, 4 (updates) |
| Insider threats (C6, C5 "role-based access") | 1 (insiders), 7 (need to know) |
| Password habits, password managers, MFA, MFA fatigue (C1, C2, C5, C7) | 2 Passwords and signing in safely |
| Phishing, social engineering, spear phishing, texts, voice (C1, C2, C3, C5, C6, C7) | 3 Phishing and social engineering |
| Business email imposters, tech support scams (C2) | 3 (new screen) |
| QR codes, cloned voices, fake support chat (current threats) | 3 (new screen) |
| Malware types, trojans, ransomware, backups, updates (C2, C4, C5, C6) | 4 Malware, ransomware and updates |
| Safe browsing, email privacy, downloads, extensions, social media, AI tools (C7) | 5 Safe browsing, email and online privacy |
| Device protection, home network, public Wi-Fi, VPN, video calls, remote work (C2, C7) | 6 Devices, networks and working remotely |
| Physical security, clean desk, tailgating, disposal (C2, C4) | 7 Handling information and physical security |
| Incident response, recording and reporting incidents (C5, C7) | 8 When something goes wrong |
| Case studies (C5) | Scenarios in every module (invented, no real organizations) |
| Network segmentation, secure coding, OWASP, vendor contracts (C2, C7) | Not taught: these are for IT and developers, not for every employee |

## Formats worth adding later

- Short quarterly phishing drills (C7 "simulated phishing campaigns") are in the release 3 plan.
- A one-page quick-reference card per module.
- Role-based extras (C7) for people who handle payments or administer systems.

## Open items

1. The course names "your lead" as the person to tell. Once the incident report form exists (release 2) the lessons should link
   to it.
2. Which password manager, VPN and device-lock tools ERS and each client allow: the course says "use the one ERS or your client
   provides". Replace that with the real tools when they are chosen.
3. The Privacy Officer or IT lead's read-through and the date, recorded when the course is published.
