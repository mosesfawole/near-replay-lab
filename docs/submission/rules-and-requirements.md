# NEAR HACKATHON: rules and submission requirements

Public-source check retrieved **2 November 2026**, last source retrieval **11:47:58 UTC**. This prepares a local draft package; it does not establish this team's complete eligibility or submit anything. Recheck the live organizer rules before publication and submission, because they may change.

## Event and schedule

| Item | Verified rule or fact |
| --- | --- |
| Official event name | **NEAR HACKATHON**. HackList calls it **NEAR HACKATHON: Build Beyond Boundaries**. [1][2] |
| Organizer identification | The event site uses NEAR branding and directs announcements to **@NEARProtocol**. The precise legal organizer entity is **not named in the reviewed material**. [2][3] |
| Announcement / code window begins | **19 October 2026**, per Q-001; work from the announcement counts. Earlier commits are baseline. The linked announcement is [this NEARProtocol post](https://x.com/nearprotocol/status/2112257967818997891); the date is verified from the organizer FAQ, not independently from X. [2] |
| Hackathon and submission window opens | **1 November 2026, 00:00 UTC = 01:00 CET**. [2][3] |
| Development and submission deadline | **14 November 2026, 23:59 UTC = 15 November 2026, 00:59 CET**. [2][3] |
| Internal target | **13 November 2026, 20:00 CET = 19:00 UTC**, from the approved project plan; **28 hours 59 minutes** before the official deadline. This is a project target, not an organizer rule. |
| Judging starts | **16 November 2026, 00:00 UTC = 01:00 CET**. [2] |
| Results by | **18 November 2026, 23:59 UTC = 19 November 2026, 00:59 CET**. [2] |

November dates use Europe/Berlin's CET offset of UTC+1.

## Prizes and tracks

The verified total pool is **$250,000**, fixed in USD and paid in NEAR. There is one overall grand prize and three places in each of 13 tracks. Payout is one payment without vesting within 30 days of results. The rules do not specify the conversion-rate mechanism or whether the grand prize can stack with a track prize. [2][3]

| Prize | Amount | Number of awards |
| --- | ---: | ---: |
| Overall grand prize | $55,000 | 1 |
| Track first place | $10,000 | 13 |
| Track second place | $3,000 | 13 |
| Track third place | $2,000 | 13 |

| Submission ID | Official track name |
| --- | --- |
| `defi` | Unstoppable DeFi |
| `thesis` | Investment Thesis |
| `privacy` | Privacy & Private AI |
| `business` | Autonomous Business |
| `swarms` | AI Swarms |
| `security` | **AI Security & Defense** — selected primary track |
| `agents` | Agent Economy |
| `realworld` | Real-World Money |
| `games` | Games With Real Economies |
| `nfts` | NFTs That Do Something |
| `memecoins` | Memecoins With Mechanics |
| `social` | Social Money |
| `open` | Open Innovation |

Select every track the project actually fits, once each. This remains one project submission. [2]

The security track's exact build direction is: **“Build spending limits, policy engines, sandboxed wallets, reputation and scam detection. Give AI money without giving it the keys to everything.”** Its hints are **AGENT SECURITY, FUNCTION CALL KEYS, TEE ATTESTATION**. Q-011 says mandatory integrations are **none**: hints are hints, and an own NEAR contract that fits the track is enough. NEAR Replay Lab's proposed fit is payment-policy regression testing with native NEAR contracts and restricted function-call keys. Final track acceptance remains the organizer's judgment. A live LLM, NEAR AI Cloud, Intents, and TEE integration are not stated requirements. [2][3]

## Eligibility, originality and AI use

- **Solo or team:** both permitted; no advance sign-up needed. One person may enter at most **two different, independent projects**, with each README naming the other. The API also caps submissions at two per email. One submission per project and repository. [2][3]
- **Testnet:** testnet-only projects are permitted in **all tracks**. Mainnet is needed only for an integration that is itself mainnet-only. No mainnet integration is required for the current native NEAR fixture project. [2, Q-010–011]
- **Existing work:** an old project as-is is not allowed. A new feature or NEAR integration built in the announcement-to-deadline window is allowed, with the baseline disclosed. No minimum code size is stated. An existing repository may use a dedicated branch, or `pre-hackathon` and `hackathon-submission` tags, plus a README section linking the diff. [2, Q-001–004]
- **Libraries, templates, boilerplate and AI code:** permitted, including the team's own older libraries. List them in the README; older own libraries remain baseline. Do not imply all third-party or AI-assisted code was independently authored. [2, Q-005]
- **License and rights:** add a LICENSE file; any license is allowed, including MIT. The team keeps code rights. Organizers receive non-exclusive promotional rights to the name, screenshots, video and repository link. [2, Q-013–014]

The reviewed primary material does **not** specify participant age, residency/nationality, jurisdiction restrictions, employee exclusions, legal-entity eligibility, or identity/tax procedures. Those details and this user's personal eligibility remain **unverified**. General project permission is not a certification of every participant or prize-payout condition.

## Judging and evidence

Claude Code and Codex screen every project first for reproducibility and whether it performs the README's claimed features. Q-017 describes a structured report and preliminary score; human judges decide, and a low AI score alone cannot reject a project. [2][3]

The site lists **technical implementation, design, impact, originality and sustainability** as criteria used in **previous NEAR hackathons**, describing them as preparation guidance. A current numeric rubric, criterion weights, minimum scores, tie-break rules and track-specific scoring weights are **not verified**. [3]

For this package, make every demo claim traceable to the recorded report, label synthetic hostile proposals and constructed fixtures, and keep the recording's date and recorded status visible. Explain that retry and concurrency test the same once-only settlement property. These are project truthfulness and usability choices; they are not extra organizer scoring rules.

## Required repository and demo

1. A **working prototype in a public repository** by the deadline. Keep it public through judging and include a LICENSE. The README must explain the problem, NEAR's concrete role and reproducible **“do X — see Y”** steps. Disclose reused baseline and libraries/templates/AI code. [2][3]
2. A **public X demo post** saying the project was built at **NEAR HACKATHON**, tagging **@NEARProtocol** and **#NEARHackathon**, with attached demo media. **@NearLegion** and **@NearBuilders** are optional. [2][3]
3. For a **local-only demo**, the X post must contain a **video**. Q-012 explicitly says screenshots are insufficient when judges cannot open the demo. Hosted demos are a plus; the organizer asks that they remain available through **18 November**, ideally **25 November**. [2]
4. Submit **both** public links through the final form. A deck, hosted site, live model, live video presentation, or specific hosting provider is **not stated as required** in the reviewed material. [2][3]

Official demo advice: lead with the problem, show one complete user-action-to-result moment, explain NEAR's role concretely, and link the demo/repository with a useful next step. [2]

**Media limits remain unknown:** no event-specific video duration, file size, resolution, codec, aspect ratio, screenshot count, or X-post character limit appears in the reviewed primary material. Do not label any locally chosen recording length or copy length as an official maximum. X account-specific platform limits must be checked when the human publishes.

## Exact submission fields and limits

The organizer publishes an explicit API contract, corroborated by the public form for visible fields. The endpoint is `https://nearhackathon.com/api/applications`; it has **not been called** during this requirements check. The form is [nearhackathon.com/#apply](https://nearhackathon.com/#apply). [2][3]

| JSON field | Verified requirement |
| --- | --- |
| `requestId` | UUID generated once for the actual submission and reused on retries |
| `projectName` | String, **2–80 characters** |
| `leadName` | String, **2–80 characters**, human-supplied |
| `email` | Valid email, **maximum 160 characters**, at most two submissions per email |
| `size` | Exactly one of `1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+` |
| `tracks` | Nonempty array of allowed IDs above; no duplicates; proposed value `["security"]` |
| `nearAddress` | String, **2–64 characters**, lowercase; the human's **mainnet** prize-payout account, named or 64-character implicit |
| `projectUrl` | HTTP(S) URL of public repository, **maximum 300 characters**; each repository can be submitted once |
| `demoUrl` | HTTP(S) URL of public X demo post, **maximum 300 characters** |
| `idea` | Description of problem, product and NEAR's role, **20–2,000 characters** |
| `consent` | Boolean **true**, only after the human agrees to the exact contact notice below |

The account-format regex is `^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$`. Format validity alone does not establish that a payout account is valid, owned or suitable. Public testnet fixture accounts are not the requested mainnet payout account. [2]

The JSON body limit is **12,000 bytes**. Send exactly the contract fields; `website` is a spam honeypot, and any nonempty value rejects the submission. An actual payload contains personal data and must not be committed to the repository. **No completed payload is included in this local package.** [2]

Exact consent notice: **“I agree that the organizers may use these details to review our submission and contact us about this hackathon.”** [2][3]

The organizer says a submission **cannot be edited**. It requires the human to confirm the exact payload before an agent sends it. The repository must already be public and the demo post published. For this session, publication, contacting people, account creation and submission remain outside the authorized local work. [2]

Before submission, the human must supply/confirm the team lead, contact email, team size, mainnet payout account, final tracks, public repository URL, public X demo URL and consent. Draft descriptions may be prepared now; unknown personal values and unpublished links remain absent or null in draft checklists.

## Sources and retrieval

- **[1] HackList listing** — [NEAR HACKATHON: Build Beyond Boundaries](https://hacklist.io/hackathon/a8e9a432-9627-4600-850b-85ee368bfcd0), retrieved 2 November 2026. Secondary discovery source linking the event site; it says HackList is not affiliated with organizers.
- **[2] Organizer's public rules and API contract** — [HACKATHON.md](https://nearhackathon.com/HACKATHON.md), retrieved 2 November 2026, last retrieval 11:47:58 UTC. SHA-256 of the UTF-8 response content: `8482c2cae1a4148a9cdb747700516685f10d7e110ac76db8a1b1db3d3f617d90`.
- **[3] Organizer event page, final form and public FAQ** — [nearhackathon.com](https://nearhackathon.com/), retrieved 2 November 2026. Confirms schedule, prize breakdown, track wording, visible form field limits and FAQ. The form was inspected by a public HTTP GET; nothing was filled or sent.

Only these public materials were used for the rules check. No credentials, wallet, account session, paid API, submission request, or social publication was used.
