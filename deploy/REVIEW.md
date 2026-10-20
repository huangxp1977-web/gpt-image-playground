# Deployment review handoff — not deployed

Independent re-review is required before any Aliyun deployment/build action. No service, container, ingress, credentials, or target config has been changed by these fixes.

## Approved architecture

Docker Compose is mandatory. Entire clone/build/runtime workflow must happen on **Aliyun first**. Do not build on Toshiba and transfer images. If measured resources cannot support a bounded build without threatening existing production workloads, stop and report; only then, with approval, move the entire clone/build/runtime to Toshiba and use Aliyun reverse forwarding. Local developer build/test is code verification, not the deployment build.

Use the committed multi-stage `Dockerfile` (Node 24 standalone Next output) and `compose.yaml`. Runtime is UID/GID 10001, read-only root filesystem, writable image bind only, all capabilities dropped, loopback mapping `127.0.0.1:3008:3000`. Secrets are runtime-only `shared/app.env` (root-owned 0600), excluded from Docker context. Do not print `docker compose config`, environment contents, or process environments: these may disclose secrets. No native/systemd service is delivered.

## Preflight and build gate — after independent approval only

1. On Aliyun inspect current available RAM, swap, disk, load, existing production container memory/limits and Docker/Compose/BuildKit support. Previous ~453 MiB available was only a point-in-time observation, not proof a build can/cannot fit. Recheck port 3008 and existing OpenLiteSpeed proxy; do not alter unrelated NewAPI or ingress.
2. Decide a bounded BuildKit worker/container memory/CPU budget with headroom reserved for existing workloads; verify that this Docker/BuildKit version actually enforces it. Do not assume `docker build --memory` is enforced by BuildKit. If no enforceable safe budget is available, STOP and report rather than attempt an unbounded build. Observe host available memory and existing service health throughout; kill only the app build if reserve is breached. No speculative 256 MiB runtime cap.
3. Clone the reviewed commit into the app-scoped `/opt/gpt-image-playground` tree on Aliyun. Build there with a release-specific image tag and the verified bounded builder. Neither API keys nor passwords belong in build args. Dockerfile placeholders are compile-time only. Run tests/typecheck/lint before packaging.
4. Provision `/opt/gpt-image-playground/shared` root:10001 0750 and `shared/generated-images` 10001:10001 0700; parent traversal must remain allowed. Create `shared/app.env` root:root 0600 using a secure secret channel, with nonempty APP_PASSWORD, OPENAI_API_KEY, OPENAI_API_BASE_URL=https://newapi.aesthmed.cn/v1. The Docker entrypoint exits before loading server.js if APP_PASSWORD is empty/whitespace/missing; instrumentation additionally guards the app runtime. Instrumentation alone is not an exit guarantee in this Next.js version (observed error logs with process still listening). Generate real secrets only after approval; never print them.
5. Use the release tag through IMAGE_PLAYGROUND_IMAGE and `docker compose up -d --no-build`. Compose intentionally contains no automatic build step. The runtime image stores files at IMAGE_STORAGE_DIR=/app/generated-images, consistently used by generation/download/deletion and mounted to the persistent bind. `create_host_path: false` prevents an accidental root-owned auto-created directory.

## Security fixes and automated coverage

- Generation/deletion require the HttpOnly session cookie **before body consumption**; body passwordHash is no longer accepted as request auth. Cookie path is `/api`, SameSite Strict, Secure in production. Shared-password hash remains a replayable session-exchange credential (not per-user isolation).
- Randomized HMAC session tokens carry a signed expiration checked server-side with constant-time signature comparison; TTL 24h, rotation invalidates sessions. Page/password-save renew session; after expiry authenticate again.
- Actual stream bytes are capped, including missing/chunked/lying Content-Length: image request 12 MiB total, each file 10 MiB, JSON 16 KiB, body deadline 15s. One image operation per process (including SSE body lifetime), four concurrent JSON readers. These admission limits are conservative, not proof of safe total RSS. Use one app process/container unless aggregate budgets are re-reviewed.
- New mask strokes invalidate saved masks; unsaved strokes block submit even if a stale file exists; obsolete async canvas-save callbacks are rejected by revision.
- `npm test` executes route tests, stream counting/cancellation/timeouts/admission tests, signed expiry/null JSON/fail-closed tests, and actual extracted component-handler regressions without a browser. No billable upstream calls are made by these tests.
- Existing development dependency audit has five high-severity transitive findings; do not apply incompatible `npm audit fix --force`. Recheck production-only audit separately.

## Acceptance after build and approval

Verify missing-password container exits; nonroot write/read/delete through bind with read-only root; HTTPS UI/assets; passwordRequired=true; unauthorized generate/delete/download; valid/expired session behavior; 413 chunked body; 429 concurrency; image survives recreate. Measure peak RSS and available host memory during realistic authorized generation and reference edit. At most two billable requests; selective PNG mask must preserve outside-selection pixels, not merely return HTTP200. If memory is inadequate, stop and report before moving hosts. No RAM safety or model mask-semantics claim is established by local tests.

## Portability / later Toshiba migration

Use the same reviewed image recipe and Compose file, building on the destination as approved. Stop writes, cold-copy shared/generated-images preserving numeric UID/GID/modes plus transfer app.env securely, restore permissions, start and verify persistence/auth. Browser history is localStorage/IndexedDB, not server history, and must be exported separately if needed. Keep the old host stopped but intact for rollback. Aliyun forwarding changes require separate approval and must not expose port3008 publicly.
