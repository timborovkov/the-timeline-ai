# GDPR, cookies, and consent audit

**As of:** 2026-08-21
**Status:** Internal legal-and-implementation research; not approved public copy or legal advice
**Repository baseline audited:** `3778f4fbcd0086376df1e516a8d41a0a6ebda791`
**Scope:** EU/EEA GDPR and ePrivacy requirements relevant to Timeline's public website and authenticated SaaS application, including cookies and similar technologies, analytics, legal acceptance, data-subject rights, controller/processor roles, international transfers, and accountability records
**Source policy:** External legal conclusions below rely only on official primary or institutional sources: EUR-Lex, the European Data Protection Board (EDPB), the European Commission, the Court of Justice of the European Union (CJEU), the Estonian legislature, and the Estonian Data Protection Inspectorate (AKI)

## Executive conclusion

Timeline should treat privacy as an implemented system, not a policy-page exercise.

1. **A cookie banner is not automatically required.** If the website and app use only technologies that are strictly necessary to transmit a communication or provide a service explicitly requested by the user, prior consent under Article 5(3) of the ePrivacy Directive is not required. The technologies and GDPR processing still need transparent disclosure.
2. **Optional analytics changes that answer.** If Timeline uses PostHog or another analytics, attribution, experimentation, replay, advertising, or similar client-side technology that stores or accesses information on a user's device, it should not load or transmit until the user has actively opted in. The safer EU-wide implementation is an equally clear **Accept all** and **Reject all** choice on the first layer, with granular preferences and easy withdrawal.
3. **The rule is broader than cookies and broader than personal data.** Local storage, SDKs, pixels, device identifiers, fingerprinting, and instructions that cause a browser to return device information can fall within Article 5(3). GDPR then applies separately where the resulting information is personal data.
4. **Terms, privacy notice, and consent are different things.** Each user can be required to accept versioned Terms of Use. The Privacy Policy is principally a transparency notice, so users should be shown it and Timeline may record acknowledgment, but that acknowledgment must not be represented as GDPR consent. Consent is reserved for genuinely optional, specific processing and must be withdrawable without losing the core service.
5. **A team/customer agreement is still needed.** Each user accepting product terms does not replace an organization-level contract and Article 28 data-processing agreement. The authorized team owner should accept those documents for the customer; every user should separately accept end-user terms and be shown the privacy notice.
6. **Timeline has different roles for different operations.** It is normally a controller for its website, account administration, billing, security, support, legal compliance, and its own telemetry. It will commonly be a processor for customer-directed workspace content, integrations, files, meeting transcripts, retrieval, and AI operations. Roles must be decided per processing operation from actual decision-making, not labels.
7. **No-training provider promises are only one part of compliance.** Timeline also needs a live data-flow and subprocessor register, Article 28 terms, transfer mechanisms, retention and deletion controls, rights workflows, records of processing, consent evidence, legitimate-interest assessments, DPIAs where required, and legal-version evidence.

The least-access target is therefore: **remove optional tracking where it is not essential; otherwise make optional processing opt-in, purpose-limited, short-lived, technically gated, and independently testable.**

## 1. Governing rules and current status

### 1.1 GDPR

The GDPR applies to personal-data processing and requires lawfulness, fairness, transparency, purpose limitation, data minimization, accuracy, storage limitation, security, and controller accountability. The controller must be able to demonstrate compliance. These are continuing operating duties, not requirements satisfied by publishing a Privacy Policy. See [GDPR Articles 5 and 24](https://eur-lex.europa.eu/eli/reg/2016/679/oj).

For Timeline, online identifiers, IP addresses, account IDs, stable device IDs, team membership, event content, files, transcripts, embeddings associated with people or accounts, support records, and pseudonymous telemetry can all be personal data. Pseudonymization reduces risk but normally does not take data outside GDPR where re-identification remains reasonably possible.

### 1.2 ePrivacy device-access rule

Article 5(3) of the ePrivacy Directive requires clear and comprehensive information and user consent before storing information, or gaining access to information already stored, in terminal equipment. It has two narrow exceptions: the operation is solely for transmission of a communication, or it is strictly necessary to provide an information-society service explicitly requested by the user. See [Directive 2002/58/EC, consolidated text, Article 5(3)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A02002L0058-20091219).

The EDPB confirms that Article 5(3) is technology-neutral and is not limited to HTTP cookies. It can cover tracking pixels and URLs, local processing, unique identifiers, some IP-only tracking, Internet-of-Things reporting, JavaScript or SDK instructions that cause a device to return information, and storage in volatile memory. It also protects information that is not personal data. See [EDPB Guidelines 2/2023 on the technical scope of Article 5(3)](https://www.edpb.europa.eu/documents/guideline/guidelines-22023-on-technical-scope-of-art-53-of-eprivacy-directive_en).

The ePrivacy question and GDPR question are sequential:

1. Does the technology store or access information on the device, and if so is it strictly necessary under Article 5(3)?
2. If the resulting processing involves personal data, what GDPR legal basis, transparency, minimization, retention, security, rights, processor, and transfer controls apply?

Legitimate interests under GDPR do **not** replace required ePrivacy consent for the storage/access operation. The EDPB cookie-banner taskforce specifically rejected using legitimate interests as the legal basis for placing or reading consent-required cookies, while noting that subsequent processing needs its own GDPR basis. See the [EDPB Cookie Banner Taskforce report](https://www.edpb.europa.eu/documents/task-force-report/report-of-the-work-undertaken-by-the-cookie-banner-taskforce_en).

### 1.3 Estonia and EU proposals

The Estonian Electronic Communications Act contains a consent/necessity rule for processing information related to terminal equipment, but its English text is framed around communications undertakings. AKI has nevertheless published the practical position that, following the CJEU's Planet49 judgment, non-exempt website cookies require active consent and users must receive information about purposes, duration, and third-party access. See [Electronic Communications Act, section 102](https://www.riigiteataja.ee/en/akt/530122025009), [AKI's published cookie explanation](https://aastaraamat.aki.ee/node/2), and [CJEU Planet49, Case C-673/17](https://eur-lex.europa.eu/legal-content/EN/SUM/?uri=CELEX%3A62017CJ0673).

Because Estonia's national text and historical transposition record do not provide a clean answer for every website scenario, the implementation baseline should be the stricter, EU-wide Article 5(3), CJEU, and EDPB standard. Counsel should confirm the exact Estonian legal basis, enforcement route, and any national exceptions before public launch.

EU simplification proposals do not change the implementation baseline until adopted and applicable. The Commission currently lists its digital-legislation simplification proposal as being in the co-legislative process. Timeline should implement the law in force, not a proposed future cookie regime. See the [European Commission simplification tracker](https://commission.europa.eu/law/law-making-process/better-regulation/simplification-implementation-and-enforcement/simplification_en).

## 2. Binding requirements

This section states requirements that follow directly from the GDPR/ePrivacy framework. National application and the facts of a particular processing operation can still affect the result.

### 2.1 Inventory every storage and access technology

Timeline must know what its own code and every embedded third party does on the public site, sign-up and invitation flows, authentication callbacks, and authenticated application. The inventory must include, at minimum:

- cookies, `localStorage`, `sessionStorage`, IndexedDB, service-worker caches, and browser databases;
- analytics, experimentation, feature-flag, support, fraud-prevention, CAPTCHA, error-monitoring, video, font, CDN, and embedded-content SDKs;
- pixels, link decoration, referral/attribution parameters, fingerprinting inputs, and stable device or browser identifiers;
- the requests emitted before a choice, after rejection, after acceptance, and after withdrawal; and
- each technology's provider, purpose, legal entity, data elements, recipient, duration, host/domain, first- or third-party status, and deletion behavior.

The Article 5(3) analysis concerns actual behavior. A vendor calling a cookie "essential," "anonymous," "cookieless," or "privacy friendly" does not establish the exception. The controller must be able to demonstrate why an operation is strictly necessary. See the [EDPB Cookie Banner Taskforce report](https://www.edpb.europa.eu/documents/task-force-report/report-of-the-work-undertaken-by-the-cookie-banner-taskforce_en) and [EDPB Guidelines 2/2023](https://www.edpb.europa.eu/documents/guideline/guidelines-22023-on-technical-scope-of-art-53-of-eprivacy-directive_en).

### 2.2 Apply the strictly-necessary exception narrowly

Likely candidates for the exception, after verifying their exact implementation, include:

- short-lived authentication and session continuity;
- CSRF protection and security controls necessary for a requested login or transaction;
- load balancing required to deliver the requested service;
- a user's explicit language, accessibility, or interface preference;
- invitation or checkout state needed to complete the flow the user initiated; and
- a minimal first-party preference record that remembers the user's cookie choice.

Technologies are not strictly necessary merely because they are commercially useful, improve the product, measure performance, fund the service, simplify operations, or appear in a vendor's default installation. Product analytics, attribution, ad measurement, behavioral profiling, heatmaps, session replay, and most cross-session experimentation normally require prior consent when they access or store device information.

Feature flags require a factual split. A server-side flag needed to deliver a requested account feature may be implemented without optional browser tracking. A client analytics SDK that creates a persistent identifier or observes behavior does not become strictly necessary merely because the same vendor also serves feature flags.

### 2.3 Obtain valid consent before optional storage/access

Where consent is required, it must be freely given, specific, informed, and unambiguous, demonstrated by an affirmative action. Silence, inactivity, continued browsing, scrolling, swiping, or pre-ticked boxes are not valid consent. Consent must be granular where purposes are separable, and withdrawing must be as easy as giving consent. The controller must be able to prove the consent. See [GDPR Articles 4(11) and 7](https://eur-lex.europa.eu/eli/reg/2016/679/oj) and [EDPB Guidelines 05/2020 on consent](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en).

For Timeline, a defensible banner implementation means:

- no consent-required script, SDK, device identifier, storage, or outbound request before a positive choice;
- **Accept all** and **Reject all** on the first layer with comparable visibility and clarity;
- **Manage preferences** for purpose-level choices;
- optional categories off by default, with no pre-ticked switches;
- no misleading color, contrast, wording, hierarchy, or repeated prompting designed to push acceptance;
- the same core service and account access after rejection;
- a persistent, easy-to-find privacy-preferences control; and
- withdrawal that stops future collection, clears optional first-party storage, and triggers any required downstream cessation/deletion process.

The CJEU held that a pre-selected checkbox is invalid consent and that the user must be told about cookie duration and third-party access. See [CJEU Planet49, Case C-673/17](https://eur-lex.europa.eu/legal-content/EN/SUM/?uri=CELEX%3A62017CJ0673). The EDPB taskforce records the common supervisory-authority position that a banner without a reject/refuse option alongside acceptance cannot produce valid consent, and that deceptive designs and pre-ticked options are invalid. See the [EDPB Cookie Banner Taskforce report](https://www.edpb.europa.eu/documents/task-force-report/report-of-the-work-undertaken-by-the-cookie-banner-taskforce_en).

### 2.4 Provide clear cookie and similar-technology information

EU law does not require a document with the exact title "Cookie Policy." It does require clear, comprehensive, accessible information before consent and GDPR transparency where personal data is processed. A dedicated **Cookies and similar technologies** notice is the clearest implementation.

The notice should state:

- the name/provider and purpose of each technology;
- whether it is strictly necessary or optional;
- the information stored or accessed and the personal data subsequently processed;
- its lifetime or the criteria used to determine it;
- whether and which third parties receive or access information;
- the relevant GDPR legal basis for subsequent personal-data processing;
- international-transfer information and safeguards where applicable;
- how to change or withdraw a choice; and
- the date/version of the notice.

The notice should be linked from the consent interface, privacy preferences, footer, and Privacy Policy. The Privacy Policy and cookie notice may cross-link, but neither link excuses loading optional technology before consent.

### 2.5 Provide GDPR privacy information at the right time

When Timeline collects data directly, it must provide the Article 13 information at collection. When it receives personal data indirectly—for example through customer integrations, meeting transcripts, imported files, or a customer directory—Article 14 applies unless a valid exception does. Required information includes controller identity and contact details; DPO contact where applicable; purposes and legal bases; legitimate interests; recipients; transfers and safeguards; retention or criteria; rights; complaint route; whether provision is required and consequences; and meaningful information about qualifying automated decisions. Article 14 also requires categories and source. See [GDPR Articles 12–14](https://eur-lex.europa.eu/eli/reg/2016/679/oj).

Notices must be concise, transparent, intelligible, easy to access, and written in clear language. Layering is appropriate: a concise just-in-time explanation should link to the detailed policy. Material new purposes require notice before the new processing, not only a later policy-page update.

### 2.6 Keep Terms, privacy acknowledgment, and GDPR consent separate

The following are distinct evidence:

| Evidence | Purpose | Must be withdrawable without losing the core service? |
| --- | --- | --- |
| Terms of Use acceptance | Contract formation and product rules | Contract-law question; termination consequences belong in the Terms |
| Privacy Policy acknowledgment | Evidence that the notice was presented | No; acknowledgment is not the legal basis |
| Optional analytics/cookie consent | Permission for specified optional purposes and device access | Yes |
| Customer DPA acceptance | Organization-level Article 28 controller/processor contract | Governed by the customer contract; not end-user consent |
| Meeting participant notice or consent | Supports the customer's lawful capture process | Depends on role, jurisdiction, purpose, and legal basis |

GDPR consent cannot be hidden inside mandatory Terms or bundled with unnecessary processing. If a user cannot refuse the unnecessary processing without losing service, consent is unlikely to be freely given. See [GDPR Article 7(4)](https://eur-lex.europa.eu/eli/reg/2016/679/oj) and [EDPB Guidelines 05/2020 on consent](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en).

Timeline should record each user's acceptance of the current Terms and presentation/acknowledgment of the Privacy Policy, including immutable document version or content hash, effective date, timestamp, user, organization context, and acceptance surface. The authorized team owner should separately accept organization Terms and the DPA, including authority to bind the customer. This is an accountability and contract-enforceability design; counsel must settle the exact clickwrap wording and reacceptance threshold.

A changed Privacy Policy does not automatically require fresh GDPR consent. Fresh consent is required when Timeline wants to rely on consent for a new or materially changed purpose, category, vendor, or scope that the old consent did not cover. Material Terms changes may require reacceptance under applicable contract/consumer law. Material notice changes should at least be affirmatively communicated and versioned.

### 2.7 Assign a lawful basis per purpose

Timeline must identify and document a legal basis before each personal-data processing purpose. One blanket basis for "operating and improving the service" is not sufficient. See [GDPR Article 6](https://eur-lex.europa.eu/eli/reg/2016/679/oj) and the [EDPB lawful-processing overview](https://www.edpb.europa.eu/sme/be-compliant/process-personal-data-lawfully_en).

Initial purpose mapping for counsel and product review:

| Processing purpose | Likely route | Required caveat |
| --- | --- | --- |
| Create account, authenticate, provide requested workspace functions | Article 6(1)(b), contract | Only processing objectively necessary to deliver the contract; not a route for unrelated analytics or marketing |
| Billing, tax, accounting, legally required records | Article 6(1)(c), legal obligation, and contract where applicable | Identify the exact law and retention period by jurisdiction |
| Security logs, abuse prevention, incident response | Often Article 6(1)(f), legitimate interests | Written necessity and balancing assessment; minimize, restrict access, and set retention |
| Support requested by a user/customer | Contract and/or legitimate interests | Separate support from product-training or unrelated analytics |
| Optional browser analytics, attribution, replay, behavioral experimentation | ePrivacy consent before device access; GDPR consent is the safest baseline for subsequent analytics | If another GDPR basis is proposed, ePrivacy consent may still be mandatory; counsel and a documented assessment are required |
| Transactional service messages | Contract or legitimate interests, depending on message | Separate from direct marketing and honor communications law |
| Customer workspace content processed on instructions | Customer's basis as controller; Timeline Article 28 processor | DPA, instructions, subprocessors, security, deletion, and assistance obligations |
| Timeline's independent use of customer content for model training, benchmarking, or unrelated product improvement | Separate controller purpose and legal analysis | Do not do this by default; mandatory Terms cannot create valid consent for an unnecessary independent purpose |
| Special-category data | Article 6 basis plus an Article 9 condition | Ordinary acceptance or legitimate interests alone is insufficient |

Contract necessity is narrow: processing must be objectively necessary for the service the person requested. Consent is inappropriate where processing cannot genuinely be stopped after withdrawal. Legitimate interests require a real and present interest, necessity, and balancing against the person's interests, rights, and reasonable expectations. The assessment should be written and linked to the ROPA.

### 2.8 Determine controller and processor roles per operation

A controller determines purposes and essential means; a processor acts on the controller's documented instructions. The designation in a contract is relevant but not decisive. A company can be controller for one processing operation and processor for another. See [EDPB Guidelines 07/2020 on controller and processor concepts](https://www.edpb.europa.eu/documents/guideline/guidelines-072020-on-the-concepts-of-controller-and-processor-in-the-gdpr_en).

Expected Timeline allocation, subject to factual and counsel review:

- **Timeline as controller:** public-site operations, account and team administration, customer relationship, billing, fraud/security decisions, legal compliance, support operations, its own product communications, and its own analytics.
- **Customer as controller / Timeline as processor:** customer-selected integrations and ingestion, team events, documents and files, meeting capture and transcripts, embeddings/retrieval, customer-directed AI inference, exports, and customer-defined retention—where Timeline genuinely acts only on customer instructions.
- **Possible separate or joint-controller areas:** any purpose Timeline decides independently using customer content, shared fraud intelligence, cross-customer benchmarking, or a jointly determined third-party integration. These cannot be assigned by label alone.

The customer DPA must cover subject matter and duration, nature and purpose, data types, data-subject categories, controller rights and obligations, documented instructions, confidentiality, security, subprocessors, rights assistance, breach/DPIA assistance, deletion or return, information demonstrating compliance, and audits. Subprocessors need prior specific or general written authorization; under general authorization, the controller must be informed of intended additions or replacements and have an opportunity to object. See [GDPR Article 28](https://eur-lex.europa.eu/eli/reg/2016/679/oj).

### 2.9 Implement rights, retention, and deletion end to end

Timeline needs an intake, identity-verification, scoping, fulfillment, exception, and evidence workflow for access, rectification, erasure, restriction, portability, objection, and qualifying automated-decision rights. Requests generally require a response within one month; a complex request may be extended by two further months if the person is informed within the first month. Requests are generally free unless manifestly unfounded or excessive. See [GDPR Articles 12 and 15–22](https://eur-lex.europa.eu/eli/reg/2016/679/oj) and the [EDPB data-subject rights overview](https://www.edpb.europa.eu/topics/key-gdpr-concepts/data-subject-rights_en).

The workflow must distinguish:

- Timeline's controller data, for which Timeline decides and answers the request;
- customer-controlled workspace data, for which Timeline promptly assists the customer under the DPA; and
- data that cannot lawfully be disclosed because it would adversely affect other people's rights or reveal another team's data.

Rights and deletion cannot stop at primary Postgres rows. The data map must cover object storage, Qdrant/vector data, transcripts, generated summaries, queues, caches, logs, support systems, email systems, analytics, meeting providers, AI providers, and recoverable backups. A deletion schedule may allow encrypted backups to expire rather than surgically rewriting them where restoration controls reapply deletion, but the schedule and restoration procedure must be documented and tested.

Every category needs a purpose-linked retention period or objective criteria. "For as long as necessary" without an internal schedule is not an operational control. Erasure is not absolute; legal obligations, legal claims, freedom-of-expression, public-interest, and other Article 17 exceptions must be applied narrowly and recorded. See [GDPR Articles 5(1)(e), 13(2)(a), 14(2)(a), 17, and 28(3)(g)](https://eur-lex.europa.eu/eli/reg/2016/679/oj).

### 2.10 Control subprocessors and international transfers

Timeline must maintain a current register of processors and subprocessors, including the legal entity, service, processing purpose, data categories, locations, remote-support access, subprocessors, retention/deletion terms, security commitments, and transfer mechanism. A list of brand names or hosting regions is not enough.

The EDPB states that a controller should have the identity and contact details of all processors and subprocessors readily available and remains responsible for verifying that the processing chain provides sufficient guarantees. See [EDPB Opinion 22/2024 on processor and subprocessor obligations](https://www.edpb.europa.eu/documents/opinion-of-the-board-art-64/opinion-222024-on-certain-obligations-following-from-the_en).

Transfers outside the EEA require an applicable Chapter V route:

1. an adequacy decision for the destination or eligible recipient;
2. appropriate safeguards such as the applicable Standard Contractual Clauses (SCCs), with enforceable rights and remedies; or
3. a narrow Article 49 derogation for exceptional circumstances, not routine SaaS processing.

See [GDPR Articles 44–49](https://eur-lex.europa.eu/eli/reg/2016/679/oj) and the [European Commission transfer overview](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/obligations/what-rules-apply-if-my-organisation-transfers-data-outside-eu_en).

For a U.S. recipient, the EU-U.S. Data Privacy Framework adequacy decision applies only if the specific legal entity is currently certified and the relevant data is covered. Otherwise Timeline needs another mechanism, commonly SCCs, plus an assessment of destination-country law and practice and any necessary supplementary measures. See [Commission Implementing Decision (EU) 2023/1795](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32023D1795), [Commission Implementing Decision (EU) 2021/914 on SCCs](https://eur-lex.europa.eu/eli/dec_impl/2021/914/oj), and [EDPB Recommendations 01/2020 on supplementary transfer measures](https://www.edpb.europa.eu/documents/recommendation/recommendations-012020-on-measures-that-supplement-transfer-tools-to_en).

An EU hosting region does not by itself close the transfer analysis if a U.S. or other non-EEA entity can remotely access data, if support or abuse review occurs elsewhere, or if subprocessors create onward transfers. Timeline must map the actual processing chain and periodically re-evaluate it.

### 2.11 Maintain accountability records

At minimum, Timeline should expect to maintain:

- controller and processor records of processing activities (ROPAs), including purposes, categories, recipients, transfers, retention, and security measures;
- a data-flow map and authoritative processor/subprocessor register;
- lawful-basis register and legitimate-interest assessments;
- consent receipts and withdrawal records;
- privacy, cookie, Terms, DPA, and banner versions with immutable acceptance/presentation evidence;
- retention and deletion schedule, backup-expiry rules, and deletion verification;
- data-subject request register and fulfillment evidence;
- security risk assessments, access reviews, incident records, and a breach register;
- transfer mechanisms, transfer impact assessments, supplementary measures, and re-review dates;
- DPIA screening decisions and completed DPIAs where required;
- processor due-diligence and audit evidence; and
- training, confidentiality, and privileged human-access records.

Article 30's fewer-than-250-person exception is narrow and unavailable where processing is not occasional, is likely to risk rights and freedoms, or includes Article 9 or criminal-conviction data. Timeline's continuous SaaS processing is not occasional, so it should not plan around the exemption. Records must be written, including electronic form, and available to the supervisory authority. See [GDPR Article 30](https://eur-lex.europa.eu/eli/reg/2016/679/oj).

### 2.12 Screen for DPIAs, DPO duties, and breach obligations

A DPIA is required before processing likely to result in high risk, particularly for systematic and extensive evaluation with significant effects, large-scale special-category processing, or systematic monitoring of publicly accessible areas. The assessment must describe processing and purposes, necessity/proportionality, risks, and measures. See [GDPR Article 35](https://eur-lex.europa.eu/eli/reg/2016/679/oj) and the [EDPB compliance overview](https://www.edpb.europa.eu/sme/be-compliant/be-compliant_en).

Timeline should formally screen at least:

- meeting recording/transcript capture and participant notice;
- broad communications/integration ingestion and cross-source AI retrieval;
- processing likely to contain health, union, political, biometric, or other special-category information;
- analytics, profiling, replay, or behavioral experimentation;
- automated recommendations or decisions that could materially affect people; and
- new AI or monitoring features that combine multiple datasets.

These are screening candidates, not a conclusion that every listed operation legally requires a DPIA. Counsel and the documented facts determine the result.

A DPO is mandatory where the organization's core activities require regular and systematic large-scale monitoring or large-scale processing of special-category/criminal-conviction data, as well as for public authorities. It is not mandatory merely because a company sells SaaS or uses AI. Timeline should document a periodic threshold assessment as product scope and scale change. See [GDPR Article 37](https://eur-lex.europa.eu/eli/reg/2016/679/oj) and the [EDPB DPO overview](https://www.edpb.europa.eu/sme/be-compliant/data-protection-officer_en).

Controllers must notify the competent supervisory authority of a personal-data breach without undue delay and, where feasible, within 72 hours, unless it is unlikely to risk people's rights and freedoms. High-risk breaches require communication to affected people without undue delay, subject to Article 34 exceptions. Processors must notify controllers without undue delay. All breaches must be documented, including facts, effects, and remediation. See [GDPR Articles 33–34](https://eur-lex.europa.eu/eli/reg/2016/679/oj) and the [EDPB data-breach overview](https://www.edpb.europa.eu/sme/assess-the-risks/data-breaches_en).

## 3. Risk-based least-access recommendations

The recommendations in this section are not all verbatim statutory commands. They are the lowest-risk engineering and operating design derived from the requirements above and Timeline's stated principle: **we do not want to see customer data, and we do not want anyone else to see it.**

### 3.1 Preferred architecture: no optional browser tracking

The cleanest implementation is to remove nonessential client-side analytics, attribution, replay, and behavioral experimentation from both the marketing site and application.

With only verified strictly necessary technologies:

- do not show a performative accept/reject banner;
- publish a concise Cookies and similar technologies notice;
- disclose necessary storage at the point it matters;
- keep each necessary technology short-lived and purpose-bound; and
- run an automated browser audit that proves no optional storage/access or third-party telemetry occurs.

This minimizes data, removes the risk of collecting before consent, avoids dark-pattern pressure, and better matches Timeline's trust position.

### 3.2 If analytics remains, use a real consent gate

If PostHog or another optional analytics provider remains:

1. Default every optional purpose to denied before the consent manager initializes.
2. Do not initialize the analytics SDK, fetch feature flags through it, create identifiers, set optional storage, or emit events before opt-in.
3. Give equal first-layer **Accept all** and **Reject all** controls, plus granular preferences.
4. Separate necessary, analytics, personalization, and marketing only where those purposes and technologies actually exist. Do not invent a category to imply a choice.
5. Record a minimal consent receipt: random receipt ID or authenticated user reference, timestamp, banner/notice version, selected purposes/vendors, interface language/surface, and withdrawal timestamp. Avoid raw IP, full user agent, URL content, or customer-workspace data unless separately justified.
6. Keep the first-party consent-choice cookie necessary, narrow, and disclosed. Do not place analytics IDs inside it.
7. Make the device/browser choice effective before login. An authenticated preference may help synchronize future behavior, but cannot retroactively authorize pre-login tracking or override a rejection on the current device.
8. On withdrawal, prevent new SDK loads/calls, call provider opt-out/reset functions where needed, clear optional first-party identifiers, and execute any promised downstream deletion.
9. Never let rejecting analytics break authentication, invitations, billing, workspace functions, support, or security.
10. Re-request consent only when the old choice no longer covers a material new purpose, vendor, or scope—not merely on every visit.

If client-side feature flags are coupled to analytics consent, decouple them. Serve necessary flags from Timeline's server without behavioral tracking, or design a deterministic fallback for users who reject analytics.

### 3.3 Treat security vendors by their actual behavior

Security and reliability can often support a legitimate-interest basis under GDPR, but that does not create a blanket ePrivacy exception.

- **Sentry/error monitoring:** disable replay by default; scrub URL paths, query strings, form input, workspace content, headers, and user identifiers; sample minimally; restrict retention; and document the legitimate-interest assessment. Verify whether the client integration stores/accesses device information beyond what is strictly necessary.
- **Cloudflare Turnstile or other bot protection:** load just in time on the protected action rather than every page where feasible; document the attack risk and necessity; disclose the provider and transfer path; and verify its exact storage/device-access behavior.
- **Logs:** separate short-lived security logs from product analytics. Avoid copying document names, message text, meeting content, access tokens, full URLs, or raw request bodies into logs.

Where the strictly-necessary classification is not clear, either gate the technology on consent or obtain a written counsel assessment supported by observed network/storage behavior.

### 3.4 Make policies derive from an auditable data map

The Privacy Policy, cookie notice, Trust page, DPA, subprocessor list, retention schedule, and in-product disclosures should be generated or reviewed against one authoritative internal data map. Each row should include:

- processing operation and purpose;
- Timeline role and customer role;
- data subjects and data elements;
- source, systems, recipients, and human-access path;
- legal basis and any Article 9 condition;
- device storage/access classification;
- retention and deletion path, including backups;
- processor/subprocessor contract and location;
- transfer mechanism and assessment;
- rights handling owner; and
- source evidence, last verification date, and open gap.

Public claims must be no stronger than the weakest verified code, deployment, provider setting, contract, or internal practice.

### 3.5 Build legal acceptance as immutable evidence

Recommended product gates:

- **New individual user:** explicit checkbox/button accepting the current Terms, with the Privacy Policy separately linked and acknowledged as a notice; no optional analytics box preselected or bundled.
- **New team:** authorized owner accepts organization Terms and the DPA and confirms authority to bind the organization; record the organization and document versions independently from the user's acceptance.
- **Invited user:** accepts current end-user Terms and sees the current Privacy Policy before first workspace access, even if the team owner already accepted customer terms.
- **Material Terms change:** block or clearly gate continued use only under a counsel-approved reacceptance rule.
- **Material Privacy change:** issue a prominent notice; request fresh consent only for consent-based processing whose scope changed.
- **Evidence:** retain immutable snapshots or hashes, effective dates, acceptance timestamps, actor, team, locale, surface, and supersession relationship. Do not silently rewrite old legal versions.

### 3.6 Test consent and privacy controls continuously

Add release checks that use a clean browser profile and inspect network, cookies, local storage, IndexedDB, and service workers across:

- public landing, pricing, Trust, Privacy, Terms, and guide pages;
- sign-up, sign-in, password reset, OAuth callbacks, invitations, and team creation;
- authenticated workspace navigation;
- accept all, reject all, granular choices, and withdrawal;
- unsupported/blocked third-party scripts; and
- multiple locales and responsive layouts.

Tests should fail if an optional request or storage operation occurs before consent or after rejection/withdrawal. A scheduled manual scanner should compare observed technologies with the source-controlled inventory. Content-security policy and connection allowlists should make an undeclared vendor difficult to add accidentally.

### 3.7 Operationalize rights and deletion

Before promising deletion or portability publicly:

- define whether the request comes from a user, former user, meeting participant, integration contact, or customer administrator;
- route controller requests and processor-assistance requests separately;
- inventory exportable source and derived data;
- define retention exceptions and approval authority;
- propagate deletion/tombstones to Postgres, Qdrant, RustFS/object storage, caches, queues, analytics, support, mail, meeting, and AI providers;
- document backup expiry and prevent restored data from becoming live again;
- verify team isolation during export and deletion; and
- retain a minimal, access-controlled request/audit record without retaining the deleted content.

## 4. Matters requiring counsel before public claims or launch

1. **Estonian ePrivacy implementation:** confirm the precise national provisions, competent authority, enforcement practice, and whether any national interpretation changes the safer opt-in standard.
2. **Cookie classifications:** review the observed behavior of authentication, invite handoff, consent storage, Turnstile, Sentry, PostHog, feature flags, embedded content, fonts/CDNs, and any future analytics. Do not approve by vendor category alone.
3. **Legitimate interests:** approve written assessments for security logging, bot prevention, reliability monitoring, support, fraud prevention, and any server-side measurement.
4. **Employment context:** assess whether optional consent from users acting as employees can be freely given and whether team administrators may configure any telemetry. A team administrator should not be presumed able to consent to optional device tracking for every member.
5. **Controller/processor allocation:** validate the role for every integration, meeting workflow, AI inference, support access, abuse review, product-improvement purpose, and provider. Update customer Terms and DPA accordingly.
6. **Meeting capture:** decide the lawful basis, notice, recording-consent rules, and controller responsibility for every participant jurisdiction. A host checkbox is evidence of an instruction; it is not by itself proof that every participant was lawfully recorded.
7. **Special-category and criminal-conviction data:** define prohibited/allowed uses, Article 9/10 conditions, customer instructions, and heightened safeguards for content that may contain health, union, political, biometric, or criminal information.
8. **DPIAs and DPO:** determine which launch operations require DPIAs and whether scale/core activities trigger a DPO. Revisit on material product or scale changes.
9. **International transfers:** verify the exact contracting entity for every provider; current DPF status and scope where used; SCC module; transfer impact assessment; supplementary measures; government-access posture; remote support; and onward subprocessors.
10. **Terms and notice acceptance:** approve clickwrap wording, who may bind a team, consumer-versus-business treatment, change-notice periods, and the threshold for mandatory reacceptance.
11. **Data-subject rights and conflicts:** approve identity verification, authorization of team admins, third-party rights in workspace content, privilege/confidentiality restrictions, erasure exceptions, and response templates.
12. **Children:** confirm that the service is limited to business users of an appropriate age or add age/parental-consent analysis and product controls.
13. **Direct marketing:** separately assess email and in-product marketing under applicable ePrivacy and national marketing rules; transactional service messages are not a blanket route for promotion.

## 5. Implementation decision matrix

| Question | Launch-safe answer | Evidence needed |
| --- | --- | --- |
| Can Timeline run without a cookie banner? | Yes, only if verified storage/access is strictly necessary and no optional technology runs | Browser/network audit, source inventory, necessity rationale, notice |
| Can Timeline load PostHog before a choice? | No for consent-required analytics/device access | Automated pre-consent and rejection tests |
| Can "legitimate interests" replace cookie consent? | No for Article 5(3) storage/access that requires consent | Separate ePrivacy classification and GDPR basis |
| Can Terms acceptance count as privacy consent? | No | Separate legal-version evidence and optional consent receipts |
| Must every user accept Terms? | Recommended for enforceability and consistent product rules | Versioned per-user acceptance; counsel-approved copy |
| Must every user "accept" the Privacy Policy? | The notice must be provided; acknowledgment may be recorded, but it is not GDPR consent | Presentation/acknowledgment evidence and accessible notice |
| Is user acceptance enough for a customer team? | No | Authorized organization acceptance and Article 28 DPA |
| Is an EU hosting region enough for transfers? | No | Legal entities, access locations, onward transfers, adequacy/DPF or SCC/TIA evidence |
| Is a provider's "no training" statement enough? | No | Binding terms/DPA, retention, access, subprocessors, transfers, deletion, and configuration evidence |
| May Timeline promise complete deletion? | Only after every store/provider/backup path is implemented and tested | Retention map, deletion job, provider evidence, restoration controls |
| Is a DPIA definitely required for all AI? | No; screen processing facts for likely high risk | Documented screening and counsel decision |

## 6. Recommended order of work

1. Freeze new telemetry, cookie, SDK, and provider additions until the inventory and review gate exist.
2. Produce an observed browser/storage/network inventory for every public, auth, invitation, and app route.
3. Remove optional analytics where it does not justify its privacy and operational cost.
4. If optional analytics remains, implement prior opt-in, equal reject, granular preferences, withdrawal, deletion/reset, and automated blocking tests.
5. Finalize the data-flow map, controller/processor allocation, legal-basis register, processor/subprocessor register, and transfer evidence.
6. Implement per-user Terms acceptance/privacy-notice evidence and team-owner organization Terms/DPA acceptance as separate records.
7. Build and test controller/processor rights, retention, deletion, export, breach, and provider-offboarding workflows.
8. Complete counsel review, DPIA screening, and any required DPIAs before publishing binding policies or strong Trust-page claims.
9. Derive the Privacy Policy, cookie notice, Terms, DPA, subprocessor list, and Trust page from verified controls and evidence.
10. Re-audit on every material provider, purpose, model, retention, location, SDK, or legal-version change.

## Official source index

- [Regulation (EU) 2016/679 (GDPR), official text](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [Directive 2002/58/EC (ePrivacy Directive), consolidated text](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A02002L0058-20091219)
- [CJEU Planet49, Case C-673/17, official summary](https://eur-lex.europa.eu/legal-content/EN/SUM/?uri=CELEX%3A62017CJ0673)
- [EDPB Guidelines 2/2023 on the technical scope of Article 5(3)](https://www.edpb.europa.eu/documents/guideline/guidelines-22023-on-technical-scope-of-art-53-of-eprivacy-directive_en)
- [EDPB Guidelines 05/2020 on consent](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en)
- [EDPB Cookie Banner Taskforce report](https://www.edpb.europa.eu/documents/task-force-report/report-of-the-work-undertaken-by-the-cookie-banner-taskforce_en)
- [EDPB Guidelines 07/2020 on controller and processor concepts](https://www.edpb.europa.eu/documents/guideline/guidelines-072020-on-the-concepts-of-controller-and-processor-in-the-gdpr_en)
- [EDPB Opinion 22/2024 on processor and subprocessor obligations](https://www.edpb.europa.eu/documents/opinion-of-the-board-art-64/opinion-222024-on-certain-obligations-following-from-the_en)
- [EDPB Recommendations 01/2020 on supplementary transfer measures](https://www.edpb.europa.eu/documents/recommendation/recommendations-012020-on-measures-that-supplement-transfer-tools-to_en)
- [Commission Implementing Decision (EU) 2021/914 on SCCs](https://eur-lex.europa.eu/eli/dec_impl/2021/914/oj)
- [Commission Implementing Decision (EU) 2023/1795 on the EU-U.S. Data Privacy Framework](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32023D1795)
- [European Commission international-transfer overview](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/obligations/what-rules-apply-if-my-organisation-transfers-data-outside-eu_en)
- [EDPB data-subject rights overview](https://www.edpb.europa.eu/topics/key-gdpr-concepts/data-subject-rights_en)
- [EDPB lawful-processing overview](https://www.edpb.europa.eu/sme/be-compliant/process-personal-data-lawfully_en)
- [EDPB accountability and DPIA overview](https://www.edpb.europa.eu/sme/be-compliant/be-compliant_en)
- [EDPB DPO overview](https://www.edpb.europa.eu/sme/be-compliant/data-protection-officer_en)
- [EDPB data-breach overview](https://www.edpb.europa.eu/sme/assess-the-risks/data-breaches_en)
- [Estonian Electronic Communications Act](https://www.riigiteataja.ee/en/akt/530122025009)
- [Estonian Data Protection Inspectorate cookie explanation](https://aastaraamat.aki.ee/node/2)
- [European Commission simplification tracker](https://commission.europa.eu/law/law-making-process/better-regulation/simplification-implementation-and-enforcement/simplification_en)
