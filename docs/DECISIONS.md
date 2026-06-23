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

---

## 2026-06-22 — Debounce vs. throttle for Signal-triggered Torn API re-fetches

**Context:** Personal timer Workflow (Phase 1) needs to re-fetch from Torn's API when a Signal indicates something changed (e.g. player trained), but rapid bursts of Signals (e.g. spamming the gym button) shouldn't each trigger a separate fetch.

**Options considered:**
- Throttle: act on the first Signal in a burst, ignore the rest for a cooldown window.
- Debounce: restart a short countdown on every Signal, only fetch once the countdown finishes uninterrupted.

**Decision:** Debounce. Throttling would capture a snapshot near the start of a burst that goes stale almost immediately if the burst continues; debouncing waits for input to actually settle before doing the one real fetch that matters. Chosen 60-second debounce window, revisit if it proves too slow/fast in practice.

**Will revisit if:** real usage shows 60 seconds feels wrong, or if a stat needs faster reaction than that allows.

---

## 2026-06-22 — Travel-bundling built against current (pre-Travelling 2.0) rules

**Context:** Torn announced "Travelling 2.0" Phase 2 shipping June 23, 2026, which allows some item use abroad (e.g. Xanax in UK/South Africa/Japan) — directly relevant to Phase 1.5's assumption that nothing is actionable while traveling.

**Decision:** Build Phase 1.5 against today's rules rather than trying to anticipate the patch. Tracked explicitly in SPEC.md section 11 (External Dependency Watch) with a concrete re-check trigger (the patch's ship date) rather than left as an implicit assumption.

**Will revisit if:** Travelling 2.0 Phase 2 ships and changes drug-cooldown-while-traveling behavior in supported countries.