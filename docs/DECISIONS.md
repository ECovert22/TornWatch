# Decisions & Risk Log

A running log of notable technical decisions, trade-offs, and judgment calls made during development — kept so the reasoning behind a choice isn't lost later.

---

## 2026-06-19 — npm audit flagged protobufjs vulnerabilities in Temporal SDK

**Context:** After installing `@temporalio/client`, `@temporalio/worker`, `@temporalio/workflow`, and `@temporalio/activity` (v1.18.1), `npm audit` reported 9 vulnerabilities (8 moderate, 1 high), all stemming from a transitive dependency on `protobufjs` (used internally by Temporal's SDK for serializing Workflow/Activity data over gRPC).

**Investigation:**
- The flagged advisories were a high-severity "schema-derived names can shadow runtime-significant properties" issue and a moderate denial-of-service issue via unbounded JSON expansion.
- `npm audit`'s suggested fix (`npm audit fix --force`) would have force-upgraded `@temporalio/worker` to a different major version, which it explicitly flagged as a breaking change.
- Ran `npm list protobufjs` to check the *actually resolved* version in the lockfile (separate from the version ranges npm audit was evaluating): resolved to `protobufjs@7.6.4` in most paths, `7.5.8` in `@temporalio/proto`.
- A separate, more severe protobufjs advisory (critical, CVSS 9.4, remote code execution via crafted `.proto` schema reuse) was patched in `7.5.5`/`8.0.1`. Since the installed version is `7.6.4`/`7.5.8`, both are past that patched line.

**Decision:** Did not run `npm audit fix --force`. The resolved protobufjs version already appears to be patched against the most serious known issue, and the remaining flagged advisories require processing untrusted/malicious protobuf payloads from an external source — this project's Worker only talks to a local Temporal dev server and the official Torn API, neither of which is an untrusted input vector in this sense. Forcing the suggested upgrade risked breaking compatibility with the Temporal SDK version this project is built against, for no clear security benefit in this context.

**Will revisit if:** Temporal's SDK releases an official patched version without a breaking change, or this project's threat model changes (e.g. if it ever accepts protobuf data from a source outside Temporal/Torn).