#!/bin/sh
# Runs the Render Workflows local task server + a test run inside Linux.
# The Render CLI's local server doesn't work on native Windows (it hard-codes /tmp for a Unix
# socket, and Node on Windows treats socket paths as named pipes), so run this through Docker:
#   MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/src:ro" node:24.22.1-bookworm sh /src/scripts/workflows-check.sh
# It also mirrors Render's Linux CI=true install, which catches pnpm build-script approvals.
set -e
CLI_VERSION=2.31.0
apt-get update -qq >/dev/null && apt-get install -y -qq unzip curl >/dev/null
mkdir -p /app && cd /src && tar --exclude=./node_modules --exclude=./.next --exclude=./.git --exclude=./.env -cf - . | tar -xf - -C /app
cd /app
corepack enable >/dev/null 2>&1
CI=true pnpm install --frozen-lockfile >/tmp/install.log 2>&1 || { tail -20 /tmp/install.log; exit 1; }
curl -sSL -o /tmp/cli.zip "https://github.com/render-oss/cli/releases/download/v${CLI_VERSION}/cli_${CLI_VERSION}_linux_amd64.zip"
unzip -o -q /tmp/cli.zip -d /tmp/render && R=$(ls /tmp/render/cli_* /tmp/render/render 2>/dev/null | head -1) && chmod +x "$R"
echo "node $(node -v), $($R --version | head -1)"
: > /tmp/empty.env
$R workflows dev -o text --confirm --env-file /tmp/empty.env -- node node_modules/tsx/dist/cli.mjs workflows/index.ts >/tmp/dev.log 2>&1 &
for i in $(seq 1 60); do grep -q "tasks found" /tmp/dev.log && break; sleep 0.5; done
grep -A5 "tasks found" /tmp/dev.log || { cat /tmp/dev.log; exit 1; }
RENDER_USE_LOCAL_DEV=true timeout 90 node node_modules/tsx/dist/cli.mjs scripts/spike-workflows.ts
