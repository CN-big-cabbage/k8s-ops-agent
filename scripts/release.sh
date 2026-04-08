#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_DIR="$ROOT_DIR/packages/openclaw-plugin"

VERSION="${1:-}"
CHANGELOG="${2:-}"

CURRENT=$(node -p "require('$PLUGIN_DIR/package.json').version")

if [ -z "$VERSION" ]; then
  echo "k8s-ops release — push to GitHub + publish to ClawHub"
  echo ""
  echo "Usage: $0 <version> [changelog]"
  echo "  Current version: $CURRENT"
  echo ""
  echo "Example:"
  echo "  $0 2.1.0 'feat: add node-drain tool'"
  exit 1
fi

if [ -z "$CHANGELOG" ]; then
  CHANGELOG="Release v$VERSION"
fi

BRANCH=$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)

echo "==> [1/4] Building all packages ..."
pnpm --dir "$ROOT_DIR" build

echo ""
echo "==> [2/4] Pushing $BRANCH to GitHub ..."
git -C "$ROOT_DIR" push origin "$BRANCH"

COMMIT=$(git -C "$ROOT_DIR" rev-parse HEAD)

echo ""
echo "==> [3/4] Publishing k8s-ops skill v$VERSION to ClawHub ..."
clawhub publish "$PLUGIN_DIR" \
  --slug k8s-ops \
  --name "k8s-ops" \
  --version "$VERSION" \
  --changelog "$CHANGELOG"

echo ""
echo "==> [4/4] Publishing k8s-ops-plugin v$VERSION to ClawHub ..."
clawhub package publish "$PLUGIN_DIR" \
  --family code-plugin \
  --name k8s-ops-plugin \
  --display-name "K8s Ops Plugin" \
  --version "$VERSION" \
  --changelog "$CHANGELOG" \
  --source-repo "pangxubin/k8s-ops-agent" \
  --source-commit "$COMMIT" \
  --source-ref "$BRANCH" \
  --source-path "packages/openclaw-plugin"

echo ""
echo "Done! Released v$VERSION"
echo "  GitHub:  https://github.com/pangxubin/k8s-ops-agent/tree/$BRANCH"
echo "  Skill:   https://clawhub.ai/skills/k8s-ops"
echo "  Plugin:  k8s-ops-plugin@$VERSION"
