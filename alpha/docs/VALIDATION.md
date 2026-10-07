# Validation record — 2026-10-07

## Phase 1: architecture and engine

- Repository base `472c876`; branch `macn-1.0-alpha`; original prototypes preserved.
- Original `node test-computertc.js`: passed before implementation and again at final verification.
- Pure Node tests cover capacity sizing, EWMA slowdown, exact partition invariance, all-node loss, lease expiry, disconnected node, late/duplicate/invalid results, retry limit, new job IDs and percentile definitions.
- A follow-up regression test covers short jobs after rate growth: each idle eligible node gets a capacity-weighted opportunity. Another covers a rejected send/backpressure retry without loss.

## Phase 2: networking, execution and UI

- Real Socket.IO WebSockets with three sessions, paired repeated jobs and token rejection.
- Real lost connection with an in-flight assignment; survivor completes exactly the reference result.
- Real connected but non-computing session; heartbeat stays alive, lease expires and survivor finishes.
- ComputeRTC fake-channel tests: independent control draining while data is blocked; bounded queue backpressure. These are transport unit tests, not WAN/RTC latency measurements.
- Coordinator tests: invalid input, cancellation, all-nodes-lost error, paired equality and single report persistence callback.

**Final Node suite: 21 tests, 21 passed.** Tests are included; no failure is intentionally skipped.

## Phase 3: actual browser and benchmark

- Playwright driving Chromium 153, three isolated contexts, one 390px mobile viewport.
- Real module Web Workers run the shared kernel; no simulated task completion in the dashboard.
- A complete baseline/distributed pair uses all three nodes; a second suite in the same browser sessions passes.
- JSON download, no page JavaScript errors, mobile document overflow check and disconnect rendering pass.
- Desktop/mobile screenshots inspected visually. The node table intentionally scrolls horizontally on a narrow viewport.
- Three real paired runs of 500 million samples: identical integer totals in all pairs, three contributors, median speedup **2.747×** on this host. Raw results and timing caveats are in `../examples/`.
- Standard Playwright browser download was unavailable in this execution environment. A separate temporary Chromium 153 runtime was used via `CHROMIUM_PATH`; it is not an application dependency. The checked-in scripts also support a standard Playwright-managed browser.
- CI configuration is added for Node 22 plus browser tests. Local tests used Node 24.19.0. A configured workflow is not a claim that remote CI has already passed.

## Not yet validated

Three physical heterogeneous devices, actual Android/iOS behavior, WAN/TURN, p99 with a statistically useful sample count, RTC mono/dual channel throughput under load, hostile clients, long-running soak tests, persistence and coordinator crash recovery. The repo's older seven-device connectivity experiment and recorded 9.15-second demo are not counted as validation of this implementation.

## Changes and regressions

Supported new entry point is `alpha/`; old entry points and their historical source were not edited. Top-level README adds navigation and distinguishes new measured work from prior experiments. The network topology change is explicit in the audit and README. The alpha neither imports executable JSON nor serves the repository root over HTTP.
