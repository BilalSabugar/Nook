# NOOK — Production Release Audit & Remediation Plan

**Project:** [Nook](https://github.com/BilalSabugar/Nook)  
**Audit date:** 28 October 2026 (IST)  
**Audited revision:** [`d851a844f5c824a0469e1a6289a2c990a12a8633`](https://github.com/BilalSabugar/Nook/commit/d851a844f5c824a0469e1a6289a2c990a12a8633) (`master`)  
**Audit type:** Source-code, deployment-configuration, GitHub Actions, and production-release readiness review  
**Release scope:** Internet-facing deployment with browser automation, background agents, persistent user data, and AI-generated command execution  
**Decision:** **NO-GO for unrestricted public production at the audited revision**  
**Audit limitations:** No live production deployment, independently performed penetration test, or Docker Compose runtime execution by the auditor. Findings marked *unverified* require runtime evidence, not assumption.

---

## 1. Executive summary

Nook has substantially progressed since earlier reviews. Authentication, human-approval records, Cipher task/workspace wiring, live Playwright interaction, and fail-closed behavior when isolated command execution is unavailable are implemented. The latest examined GitHub Actions run passed its **Build & Verify** job with **59 of 59 tests passing**, zero skipped, and successful lint, TypeScript, and Next.js production build.

The previously reported **direct host Docker socket mount into the sandbox runner** has been removed. An isolated Docker-in-Docker (DinD) supervisor and a Compose end-to-end workflow were introduced to address workspace mapping and production execution verification.

**The blocking regression is the new supervisor's trust boundary:** the current `docker-compose.yml` uses `docker:27-dind` with `privileged: true`, disables Docker TLS (`DOCKER_TLS_CERTDIR=`), and connects the supervisor to the `default` network shared with the Nook web app and worker. The sandbox runner connects over `tcp://container-supervisor:2375`. This exposes an unauthenticated, high-privilege Docker management interface to more services than necessary. The runner's signed tickets do not protect direct access to this Docker API.

Furthermore, the new Compose acceptance job had **not yet completed successfully at the time of this audit**. Earlier attempts of the new Compose pipeline had failed. There is also a gap between unit/integration assertions and actual independent demonstration of cross-agent isolation, browser egress restrictions, and full backup/restore.

**Recommended release strategy:** Correct the daemon/network privilege boundary first, then require a successful real Compose end-to-end job and security negative tests before releasing autonomous execution to public or untrusted workloads. A tightly controlled private technical preview with shell execution disabled carries a lower risk profile.

---

## 2. Scope and evidence

### Audited files and subsystems

| Subsystem | Primary evidence |
|---|---|
| Supervisor & service network topology | [`docker-compose.yml`](https://github.com/BilalSabugar/Nook/blob/d851a844f5c824a0469e1a6289a2c990a12a8633/docker-compose.yml) |
| Runner authorization, execution and health | [`bin/sandbox-runner.mjs`](https://github.com/BilalSabugar/Nook/blob/d851a844f5c824a0469e1a6289a2c990a12a8633/bin/sandbox-runner.mjs) |
| Production stack acceptance script | [`bin/test-production-compose.mjs`](https://github.com/BilalSabugar/Nook/blob/d851a844f5c824a0469e1a6289a2c990a12a8633/bin/test-production-compose.mjs) |
| CI jobs | [`.github/workflows/ci.yml`](https://github.com/BilalSabugar/Nook/blob/d851a844f5c824a0469e1a6289a2c990a12a8633/.github/workflows/ci.yml) |
| Login and request authentication | [`src/lib/auth.ts`](https://github.com/BilalSabugar/Nook/blob/d851a844f5c824a0469e1a6289a2c990a12a8633/src/lib/auth.ts), [`src/app/api/auth/session/route.ts`](https://github.com/BilalSabugar/Nook/blob/d851a844f5c824a0469e1a6289a2c990a12a8633/src/app/api/auth/session/route.ts) |
| Agent task permissions | [`src/lib/sandbox-ticket.ts`](https://github.com/BilalSabugar/Nook/blob/d851a844f5c824a0469e1a6289a2c990a12a8633/src/lib/sandbox-ticket.ts), [`src/app/api/approvals/route.ts`](https://github.com/BilalSabugar/Nook/blob/d851a844f5c824a0469e1a6289a2c990a12a8633/src/app/api/approvals/route.ts) |
| Browser automation and SSRF | [`src/lib/browser-session.ts`](https://github.com/BilalSabugar/Nook/blob/d851a844f5c824a0469e1a6289a2c990a12a8633/src/lib/browser-session.ts), [`src/lib/ssrf.ts`](https://github.com/BilalSabugar/Nook/blob/d851a844f5c824a0469e1a6289a2c990a12a8633/src/lib/ssrf.ts) |
| Persistence, jobs and workers | [`src/lib/worker.ts`](https://github.com/BilalSabugar/Nook/blob/d851a844f5c824a0469e1a6289a2c990a12a8633/src/lib/worker.ts), [`src/app/api/jobs/route.ts`](https://github.com/BilalSabugar/Nook/blob/d851a844f5c824a0469e1a6289a2c990a12a8633/src/app/api/jobs/route.ts) |
| Workspace export/import | [`src/app/api/workspace/export/route.ts`](https://github.com/BilalSabugar/Nook/blob/d851a844f5c824a0469e1a6289a2c990a12a8633/src/app/api/workspace/export/route.ts), [`src/app/api/workspace/import/route.ts`](https://github.com/BilalSabugar/Nook/blob/d851a844f5c824a0469e1a6289a2c990a12a8633/src/app/api/workspace/import/route.ts) |
| System health | [`src/app/api/health/route.ts`](https://github.com/BilalSabugar/Nook/blob/d851a844f5c824a0469e1a6289a2c990a12a8633/src/app/api/health/route.ts) |

**CI reference:** [GitHub Actions run #40630645095](https://github.com/BilalSabugar/Nook/actions/runs/40630645095).

**Point-in-time observation:** The **Build & Verify** job was successful, with 59/59 tests passing. The **Production Docker Compose Integration** job was still in progress, at the *Build Production Containers* step, at the last observed check. **Do not treat that as either a passing or failed final result without rechecking the run.**

### Finding classification

- **Confirmed in source/configuration:** An identified behavior or security-relevant configuration is directly present.
- **Not demonstrated:** Code/tests exist, but the necessary production behavior or adversarial property has not been proven by the observed evidence.
- **Runtime-dependent:** Real-world impact depends on infrastructure, access controls, and deployment details; a source-level audit cannot determine exploitability alone.

---

## 3. Findings requiring remediation

### P0-01 — Privileged, unauthenticated Docker management endpoint accessible beyond the runner

**Status:** CONFIRMED CONFIGURATION FINDING  
**Priority:** P0 — Block unrestricted public production with autonomous execution.

**Observed configuration:**

```yaml
container-supervisor:
  image: docker:27-dind
  privileged: true
  environment:
    - DOCKER_TLS_CERTDIR=
  networks:
    - default
    - sandbox_internal
```

The runner sets `DOCKER_HOST=tcp://container-supervisor:2375`. Disabling Docker TLS in this DinD topology provides unauthenticated Docker API access within reachable networks. Because the supervisor also joins the `default` network used by the web app and worker, those services can potentially address the daemon without passing through the Nook runner's ticket validation.

**Risk:** A compromised network peer with Docker API reachability could create/modify containers, inspect files and images, or manipulate workloads within the privileged DinD supervisor. This is a significant high-privilege control-plane exposure, even though it is not the same as directly mounting the host Docker socket into the application. No live exploit was demonstrated.

**Required fix:**

1. Make the supervisor reachable **only by the sandbox-runner** over a dedicated execution network; **do not** attach it to `default`, and ensure the web and worker have no alternate route to it.
2. Protect the daemon management transport with authenticated mTLS or an equivalent strong, verified control-plane mechanism. Do not run a freely accessible plaintext Docker API on TCP/2375.
3. Prefer a genuinely rootless, unprivileged, dedicated sandbox supervisor if operationally feasible. If privileged DinD is temporarily necessary, explicitly document the residual risk, restrict host/kernel capabilities, and do **not** describe it as rootless.
4. Ensure `sandbox-runner` cannot be reached from outside the intended administrative boundary; remove its host-published port in normal production or bind it only within a controlled test profile.
5. Authenticate and authorize each execution at the runner, maintaining its signed ticket checks even with network segmentation.

**Release acceptance tests:**

- From the **web** and **worker** containers, attempts to connect to the supervisor management port must fail.
- From the **runner**, authenticated supervisor commands must succeed; unauthenticated or incorrect-credential operations must fail.
- Confirm actual daemon privilege/security mode using `docker info` and deployment inspection; reject mismatch with declared policy.
- Execute a legitimate agent task and show it cannot access the Docker control plane, neighboring workspaces, runner credentials, or the host.

### P1-02 — Supervisor privilege mode misreported as rootless

**Status:** CONFIRMED SOURCE/CONFIGURATION MISMATCH  
**Priority:** P1; must be resolved for truthful production-security claims.

`bin/sandbox-runner.mjs` describes any configured `DOCKER_HOST` as an `isolated_rootless_supervisor`. The current Compose image is `docker:27-dind` with `privileged: true`.

**Required fix:** Use an actual capability/daemon inspection rather than inferring the privilege mode from the presence of `DOCKER_HOST`. Health responses should separately report connectivity, daemon mode, execution readiness, and restricted capabilities. Fail production readiness if critical constraints are not met. Update documentation/test names accordingly.

**Acceptance:** A privileged DinD deployment is never labeled rootless, and a broken daemon connection cannot return an execution-ready health status.

### P1-03 — Production Compose integration has no observed passing result

**Status:** NOT DEMONSTRATED AS OF AUDIT  
**Priority:** P1; release gate.

A new `compose-e2e` job and `bin/test-production-compose.mjs` now exist. This is a material improvement over the previous audit. The latest observed run had not completed its Compose job; earlier attempted Compose workflows failed. The build/unit test job passed.

**Required fix:** Keep the production integration job mandatory on release branches, ensure the latest commit passes, save diagnostic logs/artifacts, and do not declare release-ready from green unit tests alone.

**Acceptance:** On the exact release commit, `build` and `compose-e2e` both finish successfully; Compose uses the final hardened production configuration and real containers, not `mock-docker.mjs`.

### P1-04 — Cross-agent isolation assertions are weaker than adversarial isolation proof

**Status:** COVERAGE GAP / NOT DEMONSTRATED  
**Priority:** P1; release gate for untrusted execution.

The production test rejects known path-traversal command strings and checks that a task container cannot see `/app/.nook_storage`. Those checks are useful, but filtering a literal command is not proof that arbitrary executable code cannot reach other agent directories. The test needs a populated second workspace and an attempted cross-boundary read **from inside a successfully running task container**.

**Required fix:** Add negative tests in which a validly authorized task runs ordinary Node.js filesystem operations from its isolated container against a separate agent's populated directory and known private sentinel file. No task should access the runner's Docker API or environment secrets.

**Acceptance:** Real task-container attempts to read another agent's sentinel, mount unrelated data, or reach the supervisor control plane fail. A valid task still executes and can read/write only its assigned workspace.

### P1-05 — Full user-to-execution authorization path not tested in Compose

**Status:** COVERAGE GAP / NOT DEMONSTRATED  
**Priority:** P1; release gate.

The Compose acceptance script constructs its own HMAC ticket using the runner secret and calls `/exec` directly. This demonstrates ticket validation and container execution, not the complete Nook flow through login, Mission planning, human approval, approval consumption and task execution. This test design is fine for testing the runner in isolation, but not sufficient for a full product-release claim.

**Required fix:** Add a browser/API integration journey through the Nook application: authenticated owner creates Mission → Cipher requests approval → explicit human decision → exact authorized command executes → approval is consumed once → artifact and test output verified.

**Acceptance:** The end-to-end path passes against the real Compose stack. Wrong agent, command, task, expired approval, missing approval and replayed token all fail.

### P1-06 — Browser network containment relies on application interception

**Status:** SOURCE-LEVEL SECURITY CONCERN; LIVE BYPASS NOT DEMONSTRATED  
**Priority:** P1 for untrusted internet browsing.

Chromium is launched with `--no-sandbox` on Linux in `src/lib/browser-session.ts`. Playwright intercepts requests and calls Nook's URL validator, but URL validation followed by `route.continue()` is not an equivalent substitute for enforced network-level egress filtering.

**Required fix:** Place browser execution in a restricted browser runtime with a network policy that prevents access to private/internal address spaces and metadata services even if request interception fails or DNS changes. Avoid unnecessary Chromium sandbox disabling. Test redirects, DNS rebinding, XHR/fetch, iframes, subresources and service-worker behavior.

**Acceptance:** All attempts to contact internal services/metadata endpoints fail under the production browser runtime while ordinary public browsing, clicking and typing remain functional.

### P1-07 — Authentication and command authorization hardening

**Status:** CONFIRMED AUTHENTICATION COVERAGE GAP + TRUST-BOUNDARY REVIEW  
**Priority:** P1 before broad internet exposure.

The session login handler does not call the rate limiter used by `validateApiRequest`. The `/api/jobs` route permits an authenticated owner to enqueue `code_test` tasks, and the worker executes these using `system_verified_test` authorization. This may fit Nook's single-owner trust model but **does not represent a separate human approval step** for each background command.

**Required fix:**

- Add login throttling with sensible retry/backoff/lockout controls, logging and reverse-proxy-aware client identification.
- Require strong credentials and an HTTPS-facing deployment.
- Define when `system_verified_test` execution is allowed, restrict it to trusted job creation paths, and document the difference from human-approved execution.
- Add negative tests for unauthorized job creation and task/command substitution.

**Acceptance:** Login brute-force attempts are throttled and audited. Unauthenticated users cannot enqueue jobs, and no untrusted agent can upgrade itself to a system-verified execution task.

### P2-08 — Worker and recovery operations need production validation

**Status:** RUNTIME EVIDENCE GAP  
**Priority:** P2 for controlled preview; P1 for business-critical persistent workloads.

The jobs API invokes `ensureWorkerStarted()` at module load even though Compose runs a separate worker service. While the Mission engine has database-backed leases and fencing, worker lifecycle coordination, crash recovery and suppression of duplicate external side effects remain production behaviors that require demonstration.

**Required fix:** Make the dedicated worker the sole job-processing scheduler in production; ensure web routes only enqueue/signal work. Use durable leases/idempotency for side effects and test abrupt process termination while a task is running.

**Acceptance:** Kill a worker mid-task; restart; task is resumed/retried safely without duplicate irreversible actions, and stale leases are recovered consistently.

### P2-09 — Backup/restore does not cover every exported entity

**Status:** CONFIRMED IMPLEMENTATION GAP  
**Priority:** P2; P1 if marketing a complete backup/restore guarantee.

`/api/workspace/export` includes spaces, Missions, evidence and approval audit metadata. `/api/workspace/import` reconstructs spaces/documents and workspace state, but does not fully import those other entities or historical document revision trees. Thus an export is not demonstrably a complete restorable snapshot.

**Required fix:** Specify a versioned portable backup schema and implement round-trip import for all promised entities (with careful handling/redaction of approvals and secrets). Provide a consistent database backup strategy, including SQLite WAL files or an official SQLite backup operation, with tested recovery.

**Acceptance:** Export a populated instance, restore into a clean instance, compare documents, revision history, Missions, evidence and settings, and verify recovered usability. Confirm private credentials are not unintentionally exported.

### P2-10 — Health checks and transport security

**Status:** CONFIRMED IMPLEMENTATION/DEPLOYMENT GAP  
**Priority:** P2; required for a professionally operated public service.

`/api/health` returns static `status: ok` without verifying the SQLite database, dedicated worker or runner. Compose publishes HTTP port 3000; no TLS termination/reverse proxy is configured in the supplied deployment. The runner is published to host loopback for CI (`127.0.0.1:4000`).

**Required fix:** Provide separate liveness/readiness endpoints; readiness must actually check dependencies without exposing secrets. Add an HTTPS reverse-proxy deployment profile and make the runner's host port publication test-only.

**Acceptance:** Unhealthy database or runner makes readiness fail. External HTTP is redirected to HTTPS, secure cookies function, and internal execution endpoints are inaccessible from the public network.

### P2-11 — Sensitive screenshot caching

**Status:** CONFIRMED SOURCE FINDING  
**Priority:** P2.

The authenticated screenshot endpoint responds with `Cache-Control: public, max-age=120, immutable` even though browser screenshots can contain private session content.

**Required fix:** Use `Cache-Control: private, no-store` for potentially sensitive screenshots and avoid serving synthetic placeholders as verified real captures.

**Acceptance:** Authenticated screenshot responses are non-publicly cacheable; missing or unauthorized requests do not disclose captured content.

### P3-12 — Documentation and release claims

**Status:** CONFIRMED DOCUMENTATION MISMATCH  
**Priority:** P3; required before final release announcement.

Some README and testing messages continue to describe the execution supervisor as rootless and the end-to-end isolation model as verified. The current config is privileged rootful DinD; testing of the final production stack was incomplete at the audit observation point. The GitHub repository description, homepage and topics are also unset.

**Required fix:** Update the README, deployment guide, architecture diagram and feature matrix to reflect actual privilege mode, test scope and limitations; add correct GitHub metadata. Avoid claims of benchmark superiority without a fair external benchmark.

**Acceptance:** Every security and functional claim links to a reproducible test with known scope, and no statement contradicts deployment configuration.

---

## 4. Previously raised issues — disposition

| Prior issue | Status at audited revision |
|---|---|
| Direct mount of host `/var/run/docker.sock` into sandbox runner | **Resolved in Compose** — replaced by a separate DinD supervisor; see new P0 control-plane exposure |
| Nested-Docker task workspace mapping mismatch | **Addressed in code** via volume inspection and file-copy path; successful real deployment still needs evidence |
| No production Compose integration workflow | **Addressed in code** — new `compose-e2e` job and runner acceptance script |
| Cipher wrong agent ID / missing approval ID / wrong workspace | **Addressed in code and tested** by current unit/integration suite |
| Browser click/type were simulated | **Addressed in code and tested** using live Playwright form submission |
| Unsafe shared-process shell fallback | **Removed** — runner refuses execution when no container execution path is available |
| Build failures | **Resolved at last check** — Build & Verify passing; 59/59 tests |

**Important:** Do not reopen resolved code defects solely because they appeared in a previous audit. Reopen them only if evidence demonstrates a regression.

---

## 5. Production release-gate matrix

| Gate | Required evidence | Result at audit |
|---|---|---|
| G1. Clean build | `npm ci`, lint, types, unit/integration suite, production build | **PASS** (59/59 tests, Build & Verify succeeded) |
| G2. Secure supervisor management | Restricted network, authenticated daemon, verified privilege policy | **FAIL** (confirmed configuration weakness) |
| G3. Real task-container execution | Compose launch, files present, execute, output and artifacts persisted | **PENDING VERIFICATION** |
| G4. Cross-agent filesystem and API isolation | Actual executable code cannot read other agents or use control plane | **NOT DEMONSTRATED** |
| G5. Full owner approval workflow | Login → Mission → approval → execution → verified result | **NOT DEMONSTRATED in Compose** |
| G6. Browser safety | Real navigation + enforced network-level egress policy | **INCOMPLETE EVIDENCE** |
| G7. Worker crash recovery | Kill/restart, safe retry, no duplicate side effects | **NOT DEMONSTRATED** |
| G8. Complete restore | Full workspace, revisions, Missions, evidence round trip | **INCOMPLETE IMPLEMENTATION** |
| G9. HTTPS and operational readiness | TLS, secure access, monitored dependencies, reliable backups | **NOT VERIFIED** |

**Hard release decision:** A public production launch with privileged autonomous execution must remain **NO-GO** until G2–G5 pass against the actual hardened deployment. For a full reliability/security production claim, finish G6–G9 as well.

---

## 6. Implementation plan for the next production-fix sprint

### Phase A — Secure the execution control plane (must finish first)

- [ ] Remove `container-supervisor` from every network reachable by the web app or worker.
- [ ] Restrict supervisor networking to a dedicated execution-management network used only by the runner.
- [ ] Authenticate supervisor API access and eliminate publicly/network-accessible unauthenticated TCP 2375 management.
- [ ] Replace privileged rootful DinD where feasible, or formally document and mitigate its residual risk; make health/reporting truthful.
- [ ] Ensure task containers have no network access, Docker API access, host mounts, or extra privileges and only their authorized workspace.
- [ ] Prove negative access tests from web, worker and task-container contexts.

### Phase B — Make the production acceptance test authoritative

- [ ] Require a passing `compose-e2e` job on the **exact release SHA**.
- [ ] Verify real task container creation, successful execution, known-input/known-output artifacts and correct cleanup.
- [ ] Populate two agents' workspaces; verify cross-agent access fails via an executable, not only command-string filters.
- [ ] Verify inability to reach the Docker management API and protected host/internal services from untrusted task code.
- [ ] Add end-to-end owner login, Mission creation, approval, consumption, execution and evidence checks.
- [ ] Make failures preserve diagnostic logs while keeping secrets redacted.

### Phase C — Hardening & reliability

- [ ] Add production login throttling, stronger setup checks and safe credential management.
- [ ] Isolate Chromium and enforce browser network egress at the infrastructure layer.
- [ ] Use a single dedicated worker scheduler, with leases and idempotent recovery tests.
- [ ] Implement complete versioned export/import and a tested SQLite backup/restore runbook.
- [ ] Deploy HTTPS/TLS, split liveness from readiness, and introduce monitoring/alerting.
- [ ] Set screenshot cache headers to `private, no-store`.

### Phase D — Release integrity

- [ ] Resolve documentation inaccuracies regarding Docker privileges, test coverage and verified capabilities.
- [ ] Produce an accurate security architecture diagram and deployment threat model.
- [ ] Record the release SHA, environment, CI run URL, production acceptance results, and known limitations.
- [ ] Publish a release candidate/tag only when mandatory gates pass; test rollback from the release image.

---

## 7. Suggested acceptance-test scenarios

The tests below should run against **actual hardened production-equivalent services** (not a mock Docker CLI).

| Test ID | Scenario | Must pass when… |
|---|---|---|
| SEC-01 | Web app attempts supervisor Docker API connection | Connection is denied by network controls |
| SEC-02 | Worker attempts supervisor Docker API connection | Connection is denied by network controls |
| SEC-03 | Runner contacts supervisor with bad credentials | Request rejected |
| SEC-04 | Valid signed ticket launches isolated task | Correct command runs and output is returned |
| SEC-05 | Task tries to inspect another agent's known sentinel file | Access denied, sentinel never exposed |
| SEC-06 | Task tries to reach Docker daemon, metadata service, or other internal endpoint | All denied by execution environment |
| SEC-07 | Missing/expired/replayed/wrong-agent/wrong-command ticket | Execution rejected |
| SEC-08 | Approval denied or not yet granted | Cipher does not execute |
| SEC-09 | Human approval granted exactly once | Only bound command executes; approval consumed once |
| OPS-01 | Worker killed during active Mission | Safe recovery without duplicated side effects |
| OPS-02 | Database unavailable | Readiness fails and users receive safe error handling |
| OPS-03 | Backup/restore into clean installation | Documents, revisions, Missions and evidence match |
| BROW-01 | Live browser interacts with a public form | Typed value and resulting page state verified |
| BROW-02 | Browser attempts prohibited private/metadata network access | Denied at connection/network layer |

**Test hygiene:** Use random test-only secrets, redact credentials from logs, destroy test data after completion and never expose the Docker daemon externally just to make tests pass.

---

## 8. Release decisions by deployment scope

| Release type | Decision | Conditions |
|---|---|---|
| Private trusted-user preview | **Conditional GO** | Limit users; disable autonomous shell/privileged execution until safe deployment passes; keep data backed up |
| Public source-code / experimental beta | **Conditional GO** | Explicit limitations, fail-closed defaults, no unsupported production-security claims |
| Internet-facing autonomous production with untrusted tasks | **NO-GO** | Resolve P0 control-plane exposure and pass real acceptance/security gates |

---

## 9. Final conclusion

**At the audited revision, Nook is not approved for unrestricted public production with autonomous command execution enabled.** Its functional maturity and automated test coverage are much stronger than earlier versions, but the new **privileged, unauthenticated Docker control plane on a network shared with application services** is a critical architectural release blocker. The successful end-to-end production Compose result had also not yet been observed at audit time.

**Next action:** Fix the supervisor network/authentication/privilege boundary, then get a fully green Compose acceptance workflow covering legitimate command execution and adversarial cross-agent isolation. Do not restart broad feature development until these gates are closed.

> **Re-audit rule:** Recheck GitHub HEAD and workflow outcomes after applying fixes. This report is pinned to commit `d851a844f5c824a0469e1a6289a2c990a12a8633`; subsequent fixes or CI outcomes may change the verdict. Any finding characterized as “not demonstrated” should be closed by actual test evidence rather than by a commit message.

---

**Prepared for:** Nook release engineering  
**Evidence basis:** GitHub repository source, production configuration, GitHub Actions run status and logs observed on 28 October 2026.  
**This is an engineering audit, not a penetration-test certification.**
