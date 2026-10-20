# Deployment review handoff

Upstream: alasano/gpt-image-playground commit 47f6f95fb7ea0b20a997eba9f51a4f1f82cf6798.

## Verified locally

- Node 24.20.0 on Toshiba and Aliyun; both x86_64.
- Toshiba build succeeded with Next.js 16.4.2; typecheck and ESLint passed.
- npm audit --omit=dev: zero vulnerabilities after lockfile update (upstream lockfile had critical Next.js and high sharp/source-map-js advisories).
- Development dependency audit still reports five high-severity transitive braces/micromatch/fast-glob/Next ESLint findings. Do not use audit fix --force: it proposes an incompatible Next ESLint downgrade.
- Aliyun has ~453 MiB available RAM at inspection. Build on Toshiba, deploy standalone Node artifact via systemd (not a second Docker daemon workload).
- Existing image.aesthmed.cn OpenLiteSpeed proxy targets 127.0.0.1:3008 with 300-second init timeout, valid certificate paths and HTTP-to-HTTPS redirect. No ingress files changed.
- Port 3008 was unused. Existing NewAPI container not modified.

## Security changes requiring independent review

- Default model changed to gpt-image-2.5-sunburst.
- Upstream generation/deletion password checks already exist. Download route was unauthenticated; patched to require HttpOnly Secure SameSite=Strict signed cookie.
- New /api/session exchanges existing passwordHash for cookie; page rehydrates session from the existing localStorage hash and obtains it when saving password.
- Download filenames restricted to generated image filename pattern and private/no-store/nosniff headers added.
- No user-controlled remote URL fetch exists in app API: image edits use binary uploads; generation expects base64 output. Next.js upgraded to fix Image Optimization SSRF advisory.
- API key remains server-only. Existing upstream localStorage hash is a replayable bearer credential (shared-password architecture, not user isolation); rotating APP_PASSWORD invalidates both hash and download cookie.
- Cookie refresh is on page load/password save; after 24h without reload, download cookie expires. Shared browser history is not cross-device server history.

## Runtime approval blocker

The first state-changing SSH deployment command was intercepted with pending_approval: `overwrite system file via tee`. It did not execute. As of last readback, /opt/gpt-image-playground did not exist and systemd service was inactive. Do not claim production deployed or functionality verified. No credentials were generated or delivered.

## Approved deployment target and remaining checks

Use /opt/gpt-image-playground/releases/<release>/ plus current symlink, shared/app.env (root-owned 0600), shared/generated-images (gptimage-owned 0700). IMPORTANT: shared parent directory must be root:gptimage 0750 (not root-only 0700), so the service can traverse to generated-images. Service unit is deploy/gpt-image-playground.service.

Set server-only OPENAI_API_BASE_URL=https://newapi.aesthmed.cn/v1, securely reuse custom_providers[name=Newapi.aesthmed.cn].api_key from ~/.hermes/config.yaml without logging. Generate APP_PASSWORD with cryptographic randomness; deliver only via restricted ~/.hermes/credentials/image-playground-login.txt (0600). No password currently exists.

Build: OPENAI_API_KEY=build-placeholder NEXT_TELEMETRY_DISABLED=1 npm run build. Copy public/ and .next/static into .next/standalone before packaging. Deploy standalone artifact (includes production dependencies), run as dedicated gptimage user via provided service with loopback hostname and port3008. Avoid printing env files or inspecting process environments into chat.

After approval: verify service active and loopback binding; HTTPS UI and loaded JS; passwordRequired=true; unauthorized generation/delete/download/session rejected; valid session cookie download; authenticated harmless generation and reference edit with selective PNG mask (at most two billable requests). Check mask preservation separately from HTTP200 acceptance. Verify file persistence and authenticated deletion. Inspect logs for errors and confirm NewAPI unchanged. Parent must independently review changes before final acceptance.
