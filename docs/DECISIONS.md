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

---

## 2026-06-24 — Non-determinism error from changing Workflow code mid-execution

**Context:** Added the signal-debounce logic to characterMonitorWorkflow while a Workflow started under the older (pre-debounce) code was still running.

**What happened:** Restarting the Worker with the new code caused the running Workflow to replay its old Event History against the new code. The new code tried to start a 60-second debounce timer that the recorded history had no record of, producing a non-determinism error — Temporal refused to reconcile "code wants to do X" with "history says X never happened."

**Resolution (dev):** Terminated the stale Workflow and started a fresh one. A fresh execution compiles the current code from its first event, so there's no prior history to conflict with.

**Will revisit when:** Before any production deploy where Workflows run for hours (live chains). Need a strategy for evolving Workflow code without breaking in-flight executions — Continue-As-New (to truncate history on long loops) and/or Temporal's versioning/patching APIs.

---

## 2026-06-24 — dotenv belongs at executable entry points, not imported modules

**Context:** sendNotification activity reads DISCORD_WEBHOOK_URL from process.env. It threw "not set" despite the value being present in .env.

**Cause:** dotenv only loads .env into the process that imports "dotenv/config". That import existed in client.ts, but Activities run in the Worker process (entry point worker.ts), which had no such import. In Phase 0 the Worker never read env vars directly, so this only surfaced once an Activity did.

**Decision:** Add `import "dotenv/config"` at the top of worker.ts. General rule adopted: dotenv loads go at each executable entry point (worker.ts, client.ts) — the files actually run — never in imported library modules (activities.ts), since only the entry point can guarantee env loads before anything reads it.

---

## 2026-06-24 — Single shared Activity retry policy (readability over per-Activity tuning)

**Context:** Considered giving sendNotification its own retry policy with a lower maximumAttempts (3) than the fetch's (5), since retrying a notification has different cost/benefit than retrying a read.

**Decision:** Kept one shared proxyActivities retry policy for all Activities. The difference between 3 and 5 attempts for a notification is marginal, and one policy is easier to read and reason about than two. Noted as a cheap (~30 sec) refactor if a real reason to split emerges later.

**Reasoning captured:** Retries are generally beneficial for notifications (they turn transient Discord failures into a single successful delivery); the only duplicate risk is the narrow "succeeded but response lost" window, which is harmless for stat-ready pings.

---

## 2026-06-25 — Polling is the foundation; signals are only an optimization

**Context:** A personal-monitor Workflow wedged overnight in the "everything full/ready" state — it was waiting on a Signal with no timeout, and since nothing was sending signals (the only signal source today is manual via the Temporal UI), it waited forever. A manual signal un-stuck it.

**Investigation:** Confirmed Torn's API is strictly pull-based — no webhooks, events, or websockets. Torn never pushes; code can only ask what's currently true. (Even established tools like Torn PDA work by polling.) Therefore a Signal can only ever come from an optional component we build (browser extension, Discord command), which may not exist, may be down, or may be bypassed (player acting on their phone, invisible to a desktop extension).

**Decision / principle adopted:** Polling on a timer is the source of truth and correctness floor for every feature. Signals are purely an optimization to re-poll sooner. Every feature must stay correct with zero signals, and no indefinite wait is allowed without a fallback polling timeout.

**Immediate fix:** The "nothing counting down" branch now waits on a signal OR a 5-minute fallback, whichever comes first, then re-polls. 5 min balances staleness vs. pointless polling while idle/full; cheap against the 100-req/min limit.

**Downstream consequences:**
- Chain tracker must actively poll the faction chain endpoint (~30s) while a chain is live; player/bot hit-reports are optimization signals, not source of truth (a 100-person faction can't be trusted to self-report every hit).
- The debounce built in Phase 1 is correct but premature — it handles bursts from a signal source (browser extension) that doesn't exist yet. Kept as-is for now since it's harmless and will be correct once that source exists.

**Will revisit when:** total polling volume across many concurrent Workflows grows enough to need budgeting against the rate limit.