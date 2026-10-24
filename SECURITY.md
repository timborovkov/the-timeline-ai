# Security policy

We welcome good-faith reports that help protect The Timeline and its users.

## Report a vulnerability privately

Email [contact@thetimeline.cc](mailto:contact@thetimeline.cc) with the subject
`[Security] Vulnerability report`. For an active exploit or exposed customer
data, use `[Security][Urgent]`.

Do not open a public issue or pull request containing an undisclosed
vulnerability, customer data, credentials, invite or verification tokens, or a
working exploit.

Include, where possible:

- the affected URL, feature, version, or commit;
- impact and who could be affected;
- reproducible steps using your own or synthetic data;
- a minimal proof of concept, screenshots, or logs with secrets removed; and
- a safe way to contact and credit you.

We will acknowledge reports, provide an initial assessment when available, and
keep reporters informed through remediation. Complex or provider-dependent
issues may take longer. We will coordinate disclosure timing and credit when
requested and safe. Specific response-time targets will be published after
security-inbox ownership and escalation coverage are formally assigned.

## Safe harbor

Good-faith research must:

- use accounts, teams, and data you own or have explicit permission to test;
- stop and report if you encounter another person's data or a secret;
- avoid privacy violations, persistence, lateral movement, data destruction,
  denial of service, spam, social engineering, physical testing, and attacks on
  third-party providers; and
- retain only the minimum evidence needed for the report and delete it after we
  confirm receipt.

When you follow these limits, we will treat the research as authorized and work
with you to understand and resolve it. This policy does not create a bug bounty
or promise payment.

## Scope

Reports may cover the hosted service at
[thetimeline.cc](https://thetimeline.cc), this repository, official workers and
APIs, authentication and permissions, integrations, and documented deployment
components. For a vulnerability in a third-party service, report it to that
provider too; tell us privately when Timeline users or configurations are
affected.

Only the current hosted service and current repository head receive routine
security fixes. Historical commits, local forks, and customer-modified
deployments may still help us understand a flaw but are not separately
supported versions.

For non-sensitive security hardening, documentation corrections, or dependency
updates that do not reveal an exploitable weakness, a normal issue is welcome.
Until the repository publishes contribution terms and a license, contact us
before submitting a pull request.
