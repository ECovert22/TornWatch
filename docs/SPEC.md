# TornWatch

**A Durable, Temporal-Powered Monitoring & War-Support Toolkit for Torn City**

*Project Specification — Version 0.5 (Draft for review)*

---

## Table of Contents

1. [Overview](#1-overview)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [Temporal Concepts Used in This Project](#3-temporal-concepts-used-in-this-project)
4. [Architecture Overview](#4-architecture-overview)
5. [Feature Specifications](#5-feature-specifications)
   - [5.1 Personal Cooldown & Timer Notifications](#51-personal-cooldown--timer-notifications)
   - [5.2 Faction Chain Watcher](#52-faction-chain-watcher)
   - [5.3 Market Watcher](#53-market-watcher)
   - [5.4 War / Hit-Quality Tracker](#54-war--hit-quality-tracker)
6. [Discord Bot Integration](#6-discord-bot-integration)
7. [Phased Roadmap](#7-phased-roadmap)
8. [Tech Stack](#8-tech-stack)
9. [Suggested Project Structure](#9-suggested-project-structure)
10. [Torn API Reference Notes](#10-torn-api-reference-notes)
11. [External Dependency Watch](#11-external-dependency-watch)
12. [Risks & Open Questions](#12-risks--open-questions)
13. [Immediate Next Steps](#13-immediate-next-steps)

---

# 1. Overview

TornWatch is a monitoring and faction war-support tool for the browser game Torn City, built on Temporal, a durable execution platform. It is read-only and informational by design: it watches game state and notifies players, rather than automating in-game actions. This keeps it compliant with Torn's API Terms of Service and avoids any risk to player accounts.

## 1.1 One-sentence pitch

*A background service and Discord bot that watches a Torn City character and faction — personal cooldown timers, faction war chains, hit-quality during wars, and item market listings — and reliably notifies players, using Temporal to guarantee it keeps working correctly through crashes, network outages, and Torn's API rate limits.*

## 1.2 Why Temporal (and not just a cron job)

Several of this project's core features have a shape that plain scripts handle poorly but that Temporal is purpose-built for:

- Processes that must stay alive and correct for hours (a faction chain) or weeks (a standing monitor), surviving laptop sleep, process crashes, and deploys without losing state.

- Built-in retry and backoff for a third-party API with a hard, documented rate limit (Torn allows up to 100 requests per minute per user) and well-defined transient error codes.

- Race conditions between a deadline (a chain timeout) and external events (a player reporting a hit via Discord), which map directly onto Temporal's Timers and Signals.

- Fan-out across many faction members (Child Workflows) with independent state and independent failure handling.

- A live, self-managed queue of participants who can join or leave mid-event, which needs durable, race-safe state — not just a flat timer.

# 2. Goals & Non-Goals

## 2.1 Goals

- Build a genuinely useful personal and faction tool for an active Torn City player and their faction.

- Support real faction war operations: chain timing, hit rotation, and target quality, with Discord as the primary interface for live coordination.

- Learn Temporal's core primitives hands-on: Workflows, Activities, Workers, Timers, Signals, Schedules, and Child Workflows.

- Stay strictly within Torn's API Terms of Service throughout.

## 2.2 Non-Goals (at least for v1)

- No automated gameplay actions (auto-attacking, auto-buying, auto-training). The Torn API is read-only by design — there is no endpoint to place an order or commit an attack — and Torn's stated goal for the API is informational, explicitly not to give players an advantage over others.

- No scraping the game's web pages (HTML scraping) — official API only.

- No multi-tenant hosted product for other factions in v1 — this is a personal/faction tool first.

- No mobile native app — a PWA (installable web app) is the long-term front-end target instead, alongside the Discord bot.

> **Important constraint — Terms of Service**
>
> Torn's API documentation states the system is meant to provide read-only, informational access, and that Torn does not want the API used to create an unfair gameplay advantage. Torn also expects any tool that stores a player's API key to clearly disclose what is stored, who can see it, and why. Every feature in this spec is designed to read data and notify players — never to submit actions on a player's behalf.

# 3. Temporal Concepts Used in This Project

A quick-reference glossary for the Temporal vocabulary this spec relies on, with a note on which feature first introduces each concept.

| **Concept** | **Plain-language definition** | **First used in** |
| --- | --- | --- |
| Workflow | Durable orchestration code describing what should happen, step by step. Survives crashes by replaying recorded history instead of losing progress. | Phase 0 |
| Activity | The only place allowed to do real-world work: HTTP calls, reading the clock, anything non-deterministic. Workflows call Activities, never the network directly. | Phase 0 |
| Worker | A long-running process that polls Temporal for work and actually executes Workflow/Activity code. | Phase 0 |
| Retry Policy | Built-in configuration for how an Activity should retry on failure (backoff timing, max attempts) — replaces hand-written retry loops. | Phase 1 |
| Timer (durable sleep) | A Workflow can sleep for minutes or hours and wake up exactly on schedule, without polling, and without losing the sleep if the process restarts. | Phase 1 |
| Signal | An asynchronous message sent into a running Workflow from the outside world (e.g. a Discord command reporting a hit), without restarting the Workflow. | Phase 2 |
| Query | A way to read a running Workflow's current in-memory state from the outside, without affecting it (e.g. "who's next in the queue right now?"). | Phase 2 |
| Schedule | Tells Temporal to start a Workflow automatically on a recurring basis (e.g. every 5 minutes), similar to cron but durable and observable. | Phase 3 |
| Child Workflow | A Workflow started by another Workflow, with its own independent history and failure handling — used for fan-out (one per faction member). | Phase 3 |
| Saga / Compensation | A pattern for multi-step processes where, if a later step fails, earlier steps are explicitly undone or accounted for. | Phase 4 |

# 4. Architecture Overview

At a high level, TornWatch consists of these moving pieces:

| **Component** | **Responsibility** |
| --- | --- |
| Temporal Service | Either the local Temporal CLI dev server (development) or Temporal Cloud (later, if desired). Stores Workflow Event History and coordinates Workers. |
| Worker process | A long-running Node.js (TypeScript) process that polls the Temporal Service and executes TornWatch's Workflow and Activity code. Runs continuously in production. |
| Activities | All Torn API calls, notification sends, and any other I/O. Organized by domain: torn-api.ts, notifications.ts, discord.ts. |
| Workflows | Orchestration logic: per-character monitor, chain watcher, faction hit-quality monitor, market watcher. No direct I/O — calls Activities only. |
| Discord bot | A separate long-running process connected to Discord's gateway. Posts notifications driven by Workflow events, and turns Discord commands/button-clicks into Signals sent to running Workflows via the Temporal Client. |
| Client / Front-end | Starts Workflows, sends Signals, runs Queries. Starts as a CLI/small script, later becomes a PWA web app and/or the Discord bot itself. |

## 4.1 Why a single Worker is enough

Unlike a typical web server that must scale horizontally under load, TornWatch's Worker only needs to keep up with a handful of Workflows (one per tracked character, one per active chain, one per faction). A single Worker process is sufficient for the entire project's scope, including the faction fan-out phase.

## 4.2 Core architectural principle: polling is the foundation, signals are an optimization

Torn's API is strictly pull-based: there are no webhooks, no events, no websockets, no push of any kind. Torn never proactively tells TornWatch that something happened; TornWatch can only ask Torn what is currently true. This single fact is load-bearing for every feature in this spec, so it is stated explicitly here.

The consequence: anything that must be correct cannot depend on a Signal arriving. A Signal in TornWatch can only ever originate from a component that TornWatch itself builds (e.g. a future browser extension that watches in-game actions locally, or a Discord command), and such a source is optional, may not exist yet, may be down, and can be bypassed entirely (for example, the player acting on their phone, which a desktop browser extension cannot see). Therefore:

- Polling Torn on a timer is the source of truth and the correctness floor for every feature.

- Signals are purely an optimization layered on top — they let a Workflow re-poll sooner than its scheduled interval when there is reason to, improving responsiveness. They never replace the poll.

- Every feature must remain correct even if zero Signals ever arrive. A Workflow must never be able to wedge indefinitely waiting on a Signal that may never come; any indefinite wait must have a fallback polling timeout.

This principle was discovered the hard way during Phase 1: a Workflow left in the "everything is already full/ready" state waited on a Signal alone (no timeout) and silently wedged overnight, because nothing was generating Signals. The fix — a fallback re-poll interval on that wait — is the concrete application of this principle. See section 5.1.4.

# 5. Feature Specifications

## 5.1 Personal Cooldown & Timer Notifications

Tracks a player's personal time-sensitive stats and notifies them (via Discord) when something needs attention, without requiring them to keep the game open or check manually.

### Tracked signals

- Energy and nerve bars reaching full.

- Travel timer landing.

- Drug, medical, and booster cooldowns expiring.

- Any other periodic bar/cooldown the Torn API exposes that the player wants to track — designed as a configurable list, not a hardcoded set, so new stats can be added without code changes.

### 5.1.1 Core loop behavior

One Workflow Execution per tracked character. Rather than polling constantly, the Workflow alternates between two kinds of waiting:

- Most of the time: wait for whichever tracked stat is soonest to become ready, OR for a Signal indicating something changed (e.g. the player trained, spending energy) — whichever happens first.

- If a Signal wins that race: rather than immediately re-fetching from Torn, the Workflow debounces — it waits for a short quiet period (e.g. 60 seconds with no further Signals) before actually re-fetching, since game actions like repeated gym training can fire many Signals in quick succession and an immediate re-fetch per Signal would be wasteful. Only once Signals stop arriving does the Workflow fetch fresh data and recalculate.

### 5.1.2 Edge-triggered notifications (avoiding duplicate alerts)

A stat being "ready" (e.g. energy already full) is a sustained condition, not a one-time event — if notifications fired every time the Workflow checked and found a stat still at zero seconds remaining, the player would be spammed repeatedly for something they haven't acted on yet.

- The Workflow only notifies on a transition from "not ready" to "ready" for a given stat, compared against that stat's previous fetch result — not on every fetch where the stat happens to still be ready.

- Once notified, that stat is marked as already-announced and won't notify again until it's observed to go back to "not ready" (the player actually used it, starting a new countdown) and then becomes ready again.

- On the very first fetch when tracking begins, a stat that's already ready is treated like any other transition and does notify immediately, rather than being silently treated as a baseline — simpler to reason about, and revisit later only if this proves noisy in practice.

### 5.1.3 Travel bundling (current rules, June 2026)

Most actions — training, taking drugs, using cooldown-driven items — are not currently possible while a player is traveling or abroad; the relevant game screens are inaccessible until landing. This means individual notifications for energy, nerve, or cooldowns becoming ready mid-flight are not actionable and would just be noise.

- While the player is traveling, the Workflow's primary wait target becomes the travel arrival time, not the soonest of all tracked stats.

- Energy, nerve, and cooldown readiness are still tracked quietly in the background during the flight, but individual notifications for them are suppressed while traveling.

- The drug cooldown specifically is still announced as it becomes ready during travel, separately from the on-landing summary, since knowing a drug is off cooldown can matter for planning even before landing.

- The moment travel ends, the Workflow sends one consolidated landing notification listing whichever other stats (energy, nerve, cooldowns) became ready during the flight, then resumes normal independent edge-triggered notifications going forward.

> **Known near-term risk — Travelling 2.0**
>
> Torn announced a major travel system overhaul ("Travelling 2.0") with Phase 2 shipping June 23, 2026, introducing a Travel Inventory that allows some item use abroad (e.g. Xanax usable immediately upon purchase in the UK, South Africa, and Japan), with further phases (including weapons/armor) expected to follow, targeted before Halloween 2026. The travel-bundling behavior in this section is built against the rules as of June 2026 and is expected to need revision once Phase 2 ships and the picture becomes clearer with Phase 3. This is a deliberate, accepted v1 simplifying assumption with a known expiration date, not a permanent design choice.

### 5.1.4 Fallback polling (the correctness floor)

When every tracked stat is already full/ready, there is nothing to count down to, so the Workflow has no natural timer to wait on. It still waits for a Signal (in case the player acts), but per the principle in section 4.2, that wait must also have a fallback timeout so it can never wedge indefinitely waiting on a Signal that may never arrive.

- In this state the Workflow waits on a Signal OR a 5-minute fallback, whichever comes first, then re-polls.

- 5 minutes is a deliberate balance: long enough to avoid pointless polling while genuinely idle and full, short enough that a change made without a Signal (e.g. the player acted on their phone, bypassing any browser extension) is detected reasonably promptly. The interval is cheap relative to the 100-request/minute rate limit.

- This fallback is permanent infrastructure, not a stopgap to be removed once a Signal source (browser extension) exists — the extension is an optimization that speeds detection, while this fallback remains the floor that guarantees correctness even when no Signal arrives.

## 5.2 Faction Chain Watcher

Supports a faction war chain — a multi-hour event with a countdown timer that resets on every hit and ends the chain if nobody attacks in time. This is the most state-rich feature in the project: it manages a live, self-service participant queue, a parallel "Chain Leader" track, and a shared countdown timer, all coordinated through Discord.

### 5.2.1 The hit rotation (queue)

- Players join or leave the rotation at any time via Discord bot commands (e.g. /join-chain, /leave-chain) — this is not a fixed pre-set schedule.

- Order is first-come-first-served: position is determined by when a player joined relative to others currently in the queue.

- The bot proactively notifies the next player or two in line before their turn arrives, so they have time to be ready.

- When a player hits, the Chain Watcher Workflow receives a Signal, advances the queue, and resets the chain countdown Timer.

### 5.2.2 The Chain Leader track

Higher-level players often need to operate outside the normal rotation — hospitalizing the strongest currently-online members of the enemy faction so they can't retaliate or counter-chain, rather than taking a turn in order.

- Becoming a Chain Leader is self-declared via a Discord command (e.g. /become-chain-leader) — there is no fixed pre-assigned list.

- Chain Leaders hunt independently, generally targeting tough enemy online members rather than following the queue.

- In v1, a Chain Leader remains part of the regular rotation at the same time ("both" model) — this matters when the regular queue is small and needs every available hitter. Fully separating the two roles (removing a Chain Leader from the queue while active) is a planned future option once queue depth makes that safe.

- Hits from a Chain Leader still reset the shared chain countdown Timer, exactly like a regular rotation hit.

### 5.2.3 Timer-reset behavior on out-of-rotation hits

A key open design question was whether a hit landed outside the normal rotation order (e.g. by a Chain Leader) should also skip or reorder the regular queue. The v1 default, chosen deliberately to avoid unfairness around in-game pay-per-hit incentives, is:

- Out-of-rotation hits reset the chain countdown Timer only. The regular queue's order and "whose turn" pointer are unaffected — nobody in the queue is skipped because someone else hit.

> **Planned future enhancement — dynamic / configurable reset behavior**
>
> The right reset behavior may depend on factors like how many enemy targets are currently available (not hospitalized, not traveling) versus how many players are waiting in the queue. A future version should make this behavior dynamic or at least configurable — for example, a toggle accessible through a Discord command or a future web dashboard — rather than a single hardcoded rule. This is intentionally deferred past v1.

### 5.2.4 Target assignment (war mode)

Suggesting which enemy target a player should hit next is, in its full generality, a dynamic matching problem: each available hitter should be paired with a good available target, but both sides of that pairing change continuously as targets leave hospital, travel, or get hit by someone else, and as hitters join, leave, or finish their turn. Exactly optimal assignment under those constraints is computationally hard to solve fresh on every change; a greedy approach — assign the best currently-available target to the next hitter, recomputed each time state changes — is intentionally chosen as a good-enough heuristic rather than an exact solver, since the underlying data is changing faster than an expensive optimal solution would stay valid anyway.

- Target stat estimates are sourced from FFScouter (see 5.2.6) rather than built from scratch.

- Open question: how long should a player be given to take their turn before being skipped or re-prompted? This likely needs to flex based on how many suitable targets are currently available — a deep target pool can afford short turns; a shallow one may need longer waits for a target to free up. Deferred to detailed design in Phase 2/4.

- Open question: the enemy faction may log on and actively counter-attack to disrupt the chain (hospitalizing your hitters, contesting targets). The matching and turn-timing logic should be aware this is an adversarial, not just a logistics, problem. Deferred to detailed design in Phase 2/4.

### 5.2.5 Non-war (energy management) mode

A simpler chain mode for chains run outside of faction war — for example, a casual or training chain where the goal is simply to keep the chain alive as long as possible so more faction members have a chance to join in, rather than to coordinate against a specific enemy faction.

- Still uses the join/leave queue and FCFS ordering from 5.2.1 — but the goal the queue serves is different: pacing hits against players' energy regeneration to keep the chain alive longer, not coordinating target quality or countering an enemy.

- No targets are assigned and no Chain Leader role exists in this mode — there's no enemy faction to hospitalize.

- This is a strict subset of the war-mode Workflow logic (same queue/Signal/Timer mechanics, fewer features active), not a separate system — implementation should reuse the same Chain Watcher Workflow with a mode flag, rather than duplicating logic.

### 5.2.6 FFScouter integration

FFScouter is a free, established third-party tool that estimates a player's battle stats from their public Fair Fight history, and exposes this through its own documented API, separate from Torn's official API. Rather than building stat estimation from scratch, target-quality features (target suggestions in war mode, and the War/Hit-Quality Tracker in 5.4) should treat FFScouter as an external data source, the same way Torn's own API is treated.

- FFScouter requires registering a Torn API key with their service and exposes endpoints including a target-finder optimized for fair-fight range and respect gain, and a real-time "War Room" feature for monitoring enemy faction members during wars.

- Using FFScouter introduces a second third-party dependency and a second rate limit/availability profile to design Activities and retries around, distinct from Torn's own.

### 5.2.7 Temporal design notes

- The queue, the Chain Leader set, and the countdown deadline are all state held inside a single Chain Watcher Workflow Execution per active chain — not a separate database — since this state only needs to exist while the chain is active.

- Per section 4.2, polling is authoritative here, and the chain's own short timeout sets the cadence: while a chain is live, the Workflow polls Torn's faction chain endpoint on a tight interval (e.g. every 30 seconds) to know the true chain timer and hit count, rather than trusting player- or bot-reported hits to be complete. This is a bounded, intense polling window that only runs while a chain is active, not 24/7.

- Hit reports (from a player, the Discord bot, or a future browser extension) are modeled as Signals — but per section 4.2 they are an optimization for snappier updates between polls, never the source of truth. A 100-person faction cannot be relied upon to report every hit accurately, so the poll is what keeps the chain timer correct.

- Joining, leaving, and declaring Chain Leader status are also modeled as Signals into the running Workflow (these are genuinely player-driven intent, not game state, so Signals are appropriate as the primary mechanism for them).

- A Query exposes current state (time remaining, current queue order, who's flagged as Chain Leader) so the Discord bot and any future dashboard can read live status without disturbing the Workflow.

## 5.3 Market Watcher

Watches a player-configured list of specific items across the Torn item market and bazaars, and notifies the player when one is listed meaningfully under typical value — framed strictly as faster signal detection for a human decision, since the Torn API has no order-placement endpoint and Torn does not want tools that create an unfair advantage.

### Behavior

- Player selects specific item IDs to watch and a target/threshold price (or a percentage-under-typical-value rule).

- An Activity polls market and bazaar listings for watched items on an interval respecting Torn's rate limit and response caching window.

- When a listing appears under the configured threshold, a short multi-step sequence detects the listing, re-confirms it's still present a few seconds later (listings can be stale or already gone by the time they're seen), and then sends a notification — a natural fit for a Saga-style compensation step if the notification fails after the listing was already confirmed.

## 5.4 War / Hit-Quality Tracker

Checks whether faction members (on both sides of a war) are attacking targets that make sense, rather than only farming much weaker opponents.

> **Design note — respect is per-matchup, not a fixed stat**
>
> In Torn, the respect value of an attack is calculated from the relationship between attacker and defender for that specific matchup — it isn't a fixed property of a player that can be looked up directly. This feature therefore evaluates each outgoing attack's matchup (attacker vs. defender stats/level at the time of the hit) rather than treating "respect" as a static field on a player record.

### Behavior

- For each recent attack by a tracked faction member, evaluate the matchup against the defender to estimate whether it was a high-value or low-value target choice.

- Flag players who are repeatedly choosing low-value matchups (much weaker opponents) instead of viable higher-value targets that were available.

- During an active war, this can run on a Temporal Schedule across the whole faction using one Child Workflow per member, fanning out efficiently.

# 6. Discord Bot Integration

The Discord bot is the primary live interface for the Chain Watcher and the main notification channel for personal timers and market alerts. It is a separate long-running process from the Temporal Worker, connected to Discord's gateway, that talks to the Temporal Client to send Signals into running Workflows and to read Queries for live status.

## 6.1 Responsibilities

- Personal notifications: DM or mention a player when one of their tracked timers (energy, nerve, drug cooldown, travel, etc.) is ready.

- Chain queue management: /join-chain, /leave-chain, /become-chain-leader, and a command or reaction to report a hit, each translated into a Signal sent to the active Chain Watcher Workflow.

- Turn notifications: proactively message the next player (or two) in the rotation before their turn arrives, using the Workflow's Query results.

- Target suggestions: when relevant, surface a suggested target for the player whose turn is next, informed by the hit-quality logic in 5.4.

- Market and war alerts: post notifications from the Market Watcher and War Tracker into a faction channel or as DMs, depending on configuration.

## 6.2 Open design questions

| **#** | **Question** | **Current thinking** |
| --- | --- | --- |
| 1 | Bot framework choice (discord.js vs. Discord.py vs. other) | Leaning discord.js to stay in TypeScript end-to-end with the rest of the project, avoiding a language switch. |
| 2 | Where does the bot process run relative to the Worker? | Both as long-running processes on the same home desktop in production; can run on the development machine locally for testing. |
| 3 | How does the bot authenticate Discord users to Torn identities? | Needs a one-time link step (e.g. a /link-torn-id command tying a Discord user to a Torn player ID) — to be designed in detail during this phase. |
| 4 | Should hit-reporting be a slash command, a button under the notification message, or both? | Likely both — a button is faster for the common case; a command works if the original message has scrolled away. |

# 7. Phased Roadmap

Each phase below is independently demoable — it should be possible to stop after any phase and still have something real and working.

## Phase 0 — Foundations

Prove the Worker, Temporal Service, and Client wiring works end-to-end against a real Torn API call, before any game logic exists.

- Local Temporal dev server running via the Temporal CLI.

- One Activity calling Torn's /user endpoint; one Workflow calling that Activity once.

- Done when: a Client script prints real player data fetched through a Workflow Execution, visible in the Temporal Web UI's Event History.

## Phase 1 — Personal Timer Notifications

Build the core loop described in section 5.1.1–5.1.2: per-character Workflow tracking energy, nerve, travel, and cooldowns, using the soonest-event-or-Signal race and debounce pattern, with edge-triggered notifications through a simple channel (Discord webhook is the simplest starting point before the full bot exists).

- A real Retry Policy tuned to Torn's documented error codes — rate-limit and transient errors retry with backoff; invalid-key errors do not retry endlessly.

> **Suggested chaos test**
>
> Kill the Worker process while a Workflow is mid-sleep, then restart it. Confirm the Workflow resumes and still fires the notification at the correct original time.

## Phase 1.5 — Travel Bundling

Add the travel-aware behavior described in section 5.1.3 on top of the working Phase 1 loop: switching the Workflow's primary wait target to travel arrival time while traveling, suppressing individual notifications for non-actionable stats during the flight (except drug cooldown), and sending one consolidated notification on landing.

- Deliberately built against current (June 2026) travel rules; flagged for revisit once Travelling 2.0's later phases ship (see callout in 5.1.3).

## Phase 2 — Chain Watcher (core logic, polling-based)

Build the Chain Watcher Workflow described in section 5.2 — the queue, the Chain Leader track, and the shared countdown Timer — using simple polling of Torn's faction attack/news log to detect hits, before the Discord bot exists. This proves the state machine and Signal/Query logic in isolation.

- Recommended build order: implement non-war (energy management) mode first, since it's a strict subset of war mode with no target assignment or Chain Leader logic — then layer war mode's target suggestions and Chain Leader track on top of the same Workflow.

## Phase 2.5 — Discord Bot Integration

Build the bot described in section 6: queue join/leave/hit-reporting commands, Chain Leader self-declaration, turn notifications, and personal timer notifications migrating from webhook to bot. This replaces Phase 2's polling-based hit detection with real-time Signals from Discord, and resolves the Discord-to-Torn-identity linking question.

## Phase 3 — Faction-Wide Hit-Quality Monitor

Build the War Tracker from section 5.4: a Parent Workflow for the faction with one Child Workflow per member, run on a Temporal Schedule, using batch-efficient API calls where possible to conserve the shared rate-limit budget.

## Phase 4 — Market Watcher

Build the feature from section 5.3, including the detect-confirm-notify sequence and its Saga-style compensation path.

## Phase 5 — PWA Front-End

A web dashboard (reusing the existing TypeScript codebase) showing live chain state, tracked timers, and recent alerts, installable as a Progressive Web App, alongside the Discord bot rather than replacing it.

# 8. Tech Stack

| **Layer** | **Choice** | **Notes** |
| --- | --- | --- |
| Language | TypeScript (Node.js) | Used for Workflows/Activities, the Discord bot, and the eventual PWA front-end, avoiding a language switch. |
| Orchestration | Temporal (self-hosted dev server, or Temporal Cloud) | Local temporal server start-dev is sufficient for the entire project. |
| External API | Torn API v2 (official, read-only) | All game data access. No HTML scraping. |
| Discord | discord.js | Long-running bot process, separate from the Worker, talking to the Temporal Client. |
| Persistence | None required for core logic | Temporal's Event History is the source of truth for Workflow state. A lightweight DB could be added later purely for the dashboard's historical reporting. |
| Front-end (Phase 5) | PWA (vanilla or lightweight framework) | Installable web app; talks to the Temporal Client via a small backend API layer. |
| Hosting (production) | Home desktop | Worker and Discord bot processes both run continuously. |

# 9. Suggested Project Structure

```
tornwatch/
  src/
    activities/
      torn-api.ts         (all Torn API calls)
      notifications.ts    (Discord/email sends)
    workflows/
      character-monitor.ts
      chain-watcher.ts
      faction-hit-monitor.ts
      market-watcher.ts
    bot/
      index.ts            (Discord bot entrypoint)
      commands/           (slash commands)
    worker.ts
    client.ts
  package.json
  tsconfig.json
  .env (gitignored — API keys, bot token, webhook URLs)
```

# 10. Torn API Reference Notes

| **Fact** | **Detail** |
| --- | --- |
| Rate limit | Up to 100 individual requests per minute, per user, across all of that user's API keys combined. |
| Response caching | Each distinct call is cached for 29 seconds; calling more often than every ~30 seconds for the same selection returns stale cached data. |
| Key access levels | Four levels: public, minimal, limited, full. A custom key scoped to only the needed selections is recommended to minimize exposure if the key is ever compromised. |
| Relevant error codes | 2 = incorrect key, 5 = too many requests, 8 = temporary IP block, 13 = key disabled due to owner inactivity, 17 = backend error. Codes 5, 8, and 17 are good candidates for automatic retry; code 2 should alert the user rather than retry. |
| Faction-wide efficiency | Prefer one faction-wide endpoint call over iterating individual member calls where possible, to conserve the shared request budget during fan-out. |
| ToS posture | API is explicitly intended to be read-only/informational. Storing another player's key requires clear disclosure of what's stored and why. |

# 11. External Dependency Watch

Torn City is a live, actively-developed game, and some design decisions in this spec are deliberately built against the rules as they exist today rather than trying to anticipate every future change. This section tracks known upcoming changes that could invalidate current assumptions, so they don't get forgotten.

| **Change** | **Status / timeline** | **What it affects here** |
| --- | --- | --- |
| Travelling 2.0, Phase 2 (Travel Inventory) | Ships June 23, 2026. Allows some item use abroad — e.g. Xanax usable immediately upon purchase in the UK, South Africa, and Japan; alcohol and clothing also become usable abroad. | Directly affects section 5.1.3's travel-bundling assumption that nothing is actionable mid-flight/abroad. Once live, drug-cooldown handling abroad in those specific countries may need to change from "announce on landing" to "announce immediately, since it may now be usable." |
| Travelling 2.0, Phase 3 (weapons & armor return) | No firm date; targeted before Halloween 2026. | Lower relevance to TornWatch's current feature set (no combat-loadout tracking planned), but worth re-checking once it ships in case it changes other travel-related API fields. |

*Revisit this table after each listed change ships, and update section 5.1.3 and the Risks table accordingly rather than letting the spec silently go stale.*

# 12. Risks & Open Questions

| **#** | **Question / Risk** | **Current thinking** |
| --- | --- | --- |
| 1 | Dynamic/toggleable chain-timer reset behavior (section 5.2.3) | Deferred past v1; revisit once queue depth and target-availability data exist to inform the rule. |
| 2 | Mutually-exclusive Chain Leader vs. regular queue membership | v1 allows both simultaneously; revisit once queue depth makes full separation safe. |
| 3 | Discord-to-Torn identity linking | Needs a one-time link command; security/verification approach to be designed in Phase 2.5. |
| 4 | API key and bot token storage | Local .env file, gitignored, never committed or logged in plaintext; GitHub Actions secrets if CI is added later. |
| 5 | Is a database needed? | Not for Phases 0–4 — Temporal's Event History covers Workflow state. Revisit only if the dashboard needs historical reporting beyond what a Query can expose live. |
| 6 | Optimal target/hitter matching is computationally hard in the general case | A greedy, recomputed-on-change heuristic is the intentional v1 approach rather than an exact solver, since target/hitter availability changes faster than an expensive optimal solution would stay valid. |
| 7 | How long should a player be given to take their turn before being skipped? | Likely needs to flex with target pool depth; not yet designed in detail. Deferred to Phase 2/4. |
| 8 | Enemy faction actively countering the chain (hospitalizing hitters, contesting targets) | Matching/turn-timing logic needs to treat this as adversarial, not just logistical. Deferred to Phase 2/4. |
| 9 | Dependency on FFScouter (third-party, not Torn-official) for stat estimates | Accepted trade-off to avoid rebuilding stat estimation from scratch; introduces a second external rate limit/availability profile to design around. |
| 10 | Travelling 2.0 may invalidate the travel-bundling assumption in 5.1.3 | Deliberately deferred; tracked in section 11 (External Dependency Watch) with a concrete re-check trigger date. |
| 11 | Total polling volume across many concurrent Workflows could approach the 100-req/min rate limit | Not a concern at current scale (a handful of Workflows), but as faction-wide features and many tracked characters are added, total poll frequency needs to be budgeted against the shared per-user limit. Chain polling (every ~30s while active) is the heaviest; personal monitors are light. Revisit when concurrent Workflow count grows. |

# 13. Immediate Next Steps

- Review this spec and adjust phase order/scope as needed — nothing here is final.

- Confirm local dev environment setup (Node.js, Temporal CLI) on the machine that will run development work.

- Generate a scoped Torn API key (custom access, limited to needed selections) rather than a full-access key.

- Build Phase 0 and confirm end-to-end wiring against a real Torn API call.

- Proceed phase by phase, migrating the long-running Worker and bot processes to production hosting once Phase 1 needs multi-hour uptime.

*— End of specification —*