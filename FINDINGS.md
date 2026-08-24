# Expected findings

This is the answer key. Everything below was verified against the live OSV and
deps.dev APIs on 2026-08-24, against the exact versions in `package-lock.json`.

Use it as a scoring sheet. Run a scan, compare it to this file, and treat any
disagreement as a bug in one of the two: either the repository drifted, or the
scanner is wrong.

## Two scanners, two kinds of finding

**The supply chain scan** builds a package inventory for the repository and
matches it against the advisory database. It reads manifests and package
metadata, never application source. It reports known vulnerabilities, malicious
packages, and its own suspicious package signals.

**The reachability scan** clones the repository, runs an SCA pass over the
lockfiles, then does real usage analysis: does the code import the package, does
it call the functions the advisory names, and what untrusted input can reach
them. It grades each CVE on a five level evidence ladder and rates it a second
time for this codebase specifically.

The ladder, weakest to strongest evidence: `not_imported`, `unknown`,
`imported`, `vulnerable_symbol_used`, `reachable_call_path`. It is a statement
about evidence, never about exploitability, and it never changes severity.

## A. The reachability ladder

| Expected level | Package | Advisory | Why it is that level |
| --- | --- | --- | --- |
| `vulnerable_symbol_used` | `ejs@3.1.6` | CVE-2022-29078, fixed in 3.1.7 | `web/src/routes/share.ts` spreads `req.query` into the locals it hands to `ejs.renderFile`. That is the affected surface: request controlled keys reach ejs options. Trace: `GET /share` to `shareRouter` handler to `ejs.renderFile`. Input is fully attacker controlled and needs no authentication. |
| `vulnerable_symbol_used` | `js-yaml@3.13.0` | GHSA-8j8c-7jfh-h6hx, fixed in 3.13.1 | `web/src/cli/import.ts` calls `yaml.load` on a file path taken from `process.argv`. Same ladder level as the row above and deliberately a very different contextual rating: no HTTP route reaches this file, so attack vector is Local and the attacker needs shell access on the host already. This pair is the point. The ladder level and the severity are independent. |
| `imported` | `semver@7.3.5` | CVE-2022-25883, fixed in 7.5.2 | Imported and used in two places, `web/src/lib/version.ts` and `worker/src/overdue.ts`, but only `semver.valid()` is called. The advisory is a ReDoS in range parsing. Nothing here constructs a `Range` or calls `satisfies`, so the import is proven and the symbol is not. |
| `not_imported` | `marked@0.3.6` | 5 advisories | A dependency of `web` that no file imports. Left over from a markdown notes feature that was removed. Expected to be filtered out of the default risk list and excluded from the severity metrics, because a package the code does not import is inventory rather than risk. |
| `unknown` | `handlebars@4.0.11` | 17 advisories | `web/src/lib/plugins.ts` resolves the module id out of `web/config/plugins.json` and calls `await import(moduleId)`. No static search can prove or disprove usage, because no source file names the package. The correct output is `unknown` with a stated reason, not a guess in either direction. |

`reachable_call_path` is **not** represented in this repository. See section D.

## B. Report shape cases

| Case | What the scan should produce |
| --- | --- |
| Transitive with a real chain | `minimist@0.0.10` carries CVE-2020-7598 and CVE-2021-44906. It is not declared anywhere. The chain, straight out of the resolver, is `handlebars@4.0.11 > optimist@0.6.1 > minimist@0.0.10`. `introduced_by` should be `handlebars@4.0.11` and remediation has to target handlebars, because `web/package.json` cannot bump minimist directly. |
| A second transitive fan out | `request@2.88.2` pulls in four more vulnerable packages: `form-data@2.3.3` (2 advisories), `tough-cookie@2.5.0`, `uuid@3.4.0`, and `qs@6.5.5`. All four attribute back to `request@2.88.2`. This was not planned, it is what a real retired dependency actually drags in, and it is a good test of whether attribution holds up at more than one hop. |
| No fix published | `request@2.88.2` has CVE-2023-28155 and OSV lists no fixed version for it, because the project is retired. The only fix in the advisory is for the `@cypress/request` fork. Remediation must be replacement, not a version bump. Anything that says "upgrade to the fixed version" here is wrong. |
| Two CVEs on one package, different surfaces | `ejs@3.1.6` has CVE-2022-29078 (fixed 3.1.7) and CVE-2024-33883 (fixed 3.1.10). The share route reaches the first one's surface. The second should not inherit that verdict. One import check, two independent symbol searches, potentially two different levels. |
| Same package, two manifests | `semver@7.3.5` is declared by both `web/package.json` and `worker/package.json`. That is two findings, one per manifest, not one deduplicated finding. npm hoists it to a single directory on disk, which is exactly why this case is worth checking. |

## C. Inventory and metadata signals

| Signal | Entry | Expected |
| --- | --- | --- |
| Malicious package | `lodahs@4.17.21` | A real malware name, OSV record MAL-2025-25502, which covers every version so the pinned version matches. Critical severity. This one is already on main, which is the "we merged this months ago and nobody noticed" case. The other one is introduced on a branch, see section G. |
| Possible typosquat | `expresss@4.18.2` | One edit from `express`, which is on the detector's list of commonly imitated packages. Fires because it is a direct runtime dependency of `demo-signals/package.json`. |
| Possible typosquat | `exprеss@4.18.2` | Not a duplicate of the row above. The fourth character is a Cyrillic `е`, so this fires through the homoglyph folding branch instead of the edit distance branch. This is the one typosquat variant that fires on a first scan of the default branch, because the folding branch does not require the package to be newly introduced. |
| Deprecated package version | `request@2.88.2` | deps.dev returns `isDeprecated: true` for this exact version. Verified. |
| Copyleft license | `qrious@4.0.2` | A direct runtime dependency of `web`, used by the share page to draw its QR code. deps.dev reports GPL-3.0 and GitHub's SBOM reports the license string `GPL-3.0 AND GPL-3.0+`. Both were checked against the live repository, and both match the detector's list. |
| No license declared | `lodahs`, `expresss`, `exprеss` | GitHub's SBOM carries no license for any of the three, because none of the pinned versions exist in the registry. Expected as a side effect rather than as the headline finding for these rows. |
| Known vulnerability | 11 packages, 38 advisories | Full list in section F. |

## D. What this repository cannot show, and why

Four things in the product are not demonstrable here. They are listed so that a
missing finding is never mistaken for a scanner bug.

**`reachable_call_path` needs Go.** The top rung of the ladder is reserved for
real call graph analysis, and the only call graph tool in the playbook is
govulncheck, which is Go only. A symbol match found by search is
`vulnerable_symbol_used` no matter how convincing it looks. This repository is
TypeScript only by choice, so the ladder tops out one rung down. Covering that
rung means adding a Go service, in this repo or another one.

**Install lifecycle script and unpinned GitHub Action will not fire here.** Both
signals are populated only by the static manifest parser. This repository is
public with GitHub's dependency graph enabled, so the GitHub SBOM answers first
and the static parser never runs. The bait is committed anyway and will start
firing the moment that changes: `better-sqlite3@9.4.0` is in
`demo-signals/package-lock.json` with `hasInstallScript: true`, and
`.github/workflows/ci.yml` references two actions by mutable tag alongside one
pinned to a full commit SHA as the clean counterexample.

Worth noting for the action case specifically: GitHub's SBOM *does* include the
workflow actions, and it encodes the difference plainly. The tag references come
through as `pkg:githubactions/actions/checkout@4.*.*` and the pinned one as
`pkg:githubactions/actions/cache@1bd1e32a3bdc45362d1e726936510720a7c30a57`. So
the information needed to raise this finding is already present on the preferred
inventory path. Only the flag that carries it is missing, which makes this a
cheap fix rather than a missing capability.

**Newly published direct dependency cannot be baked in.** That signal only fires
when the version was published within the last three days, so no committed state
can hold it. Demonstrating it means bumping a dependency to a version published
that same week, immediately before the demo.

**Policy violation has no producer.** The type exists in the database
constraint, but no code path currently writes one.

Two more are best effort and may or may not appear: no license declared, and
unverified package attestation. Both depend on what deps.dev happens to know
about a given package version, which is outside this repository's control.

## E. Two product bugs found while building this

Both are in `strix-app/src/lib/supply-chain/suspicious.ts`. Neither is caused by
this repository, and the first one is the reason section D exists in the shape it
does.

**License signals read the wrong object.** The no license check and the copyleft
check both read `component.licenses`. Every static manifest parser hardcodes that
field to an empty array in `static-parsers/common.ts`, while the deps.dev
enrichment that does carry the license is passed into the same function as a
separate argument and never consulted. The storage layer already falls back to
enrichment correctly, so the data exists, just not where the detector looks. On
any repository that falls through to static parsing, the effect is that copyleft
can never be reported and every direct runtime dependency picks up a spurious no
license finding.

**The copyleft match is a substring test.** Licenses are matched with
`license.includes(candidate)` against a list containing `GPL-3.0` and `GPL-2.0`.
An LGPL-3.0 package satisfies that test, because the string `LGPL-3.0` contains
`GPL-3.0`. LGPL is weak copyleft and generally does not carry the obligations the
finding describes, so this mislabels acceptable dependencies as a legal risk.

## F. Full advisory inventory

Every vulnerable package in `package-lock.json`, as of 2026-08-24. Counts are
advisory counts, so they will grow over time as new advisories land against these
same old versions.

| Package | Advisories | Relationship |
| --- | --- | --- |
| `handlebars@4.0.11` | 17 | direct, declared by `web` |
| `js-yaml@3.13.0` | 5 | direct, declared by `web` |
| `marked@0.3.6` | 5 | direct, declared by `web` |
| `ejs@3.1.6` | 2 | direct, declared by `web` |
| `form-data@2.3.3` | 2 | transitive via `request@2.88.2` |
| `minimist@0.0.10` | 2 | transitive via `handlebars@4.0.11 > optimist@0.6.1` |
| `qs@6.5.5` | 1 | transitive via `request@2.88.2` |
| `request@2.88.2` | 1 | direct, declared by `web` |
| `semver@7.3.5` | 1 | direct, declared by both `web` and `worker` |
| `tough-cookie@2.5.0` | 1 | transitive via `request@2.88.2` |
| `uuid@3.4.0` | 1 | transitive via `request@2.88.2` |

`qrious@4.0.2` has no advisories. It is here for the license signal only.

## G. The two open demo branches

Some signals only fire for a package the scan considers newly introduced, and one
whole inventory source only runs on pull requests. Two branches stay permanently
open as pull requests so both are demonstrable.

**`demo/introduce-typosquat`** adds `chalks@5.3.0`, one edit away from `chalk`.
Expected: a typosquat finding on a package flagged as introduced by this change,
where the same name sitting on main would be quieter.

**`demo/introduce-malicious`** adds `axioss@1.6.7`, OSV record MAL-2025-15242.
Expected: a critical malicious package finding, a failing pull request check, and
a Slack alert if the integration is connected. This is the headline demo.

Neither branch should ever be merged. If one gets merged by accident, revert it
rather than deleting the branch, because the open pull request is the artifact.

## H. Repository settings this depends on

Two settings matter, and one of them is a trap.

**Leave Dependabot alerts enabled.** Turning them off also takes down the
`/dependency-graph/sbom` endpoint, which returns 404 within seconds and stays
that way. That endpoint is the inventory source the scan prefers, so disabling
alerts silently downgrades every scan of this repository to static manifest
parsing. This was verified the hard way while setting the repository up: alerts
off gave a 404, alerts back on gave a 216 package SBOM immediately. It is worth
knowing for real customer repositories too.

**Dependabot automated security updates stay disabled.** They are off. If they
are ever turned on, they will open pull requests bumping the pins that this whole
repository depends on.

## Keeping this file honest

The advisory database moves and this file does not. New advisories get published
against these same pinned versions, so the counts in section F drift upward and
the answer key needs a re-run rather than being written once. Re-query OSV for
every package in `package-lock.json` before using this file to score a scan.
