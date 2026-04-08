#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_DIR="$ROOT_DIR/packages/openclaw-plugin"

VERSION="${1:-}"
CHANGELOG="${2:-}"

if [ -z "$VERSION" ]; then
  CURRENT=$(node -p "require('$PLUGIN_DIR/package.json').version")
  echo "Usage: $0 <version> [changelog]"
  echo "  Current version: $CURRENT"
  exit 1
fi

if [ -z "$CHANGELOG" ]; then
  CHANGELOG="Release v$VERSION"
fi

COMMIT=$(git -C "$ROOT_DIR" rev-parse HEAD)
REF=$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)

echo "==> Publishing k8s-ops skill v$VERSION ..."
clawhub publish "$PLUGIN_DIR" \
  --slug k8s-ops \
  --name "k8s-ops" \
  --version "$VERSION" \
  --changelog "$CHANGELOG"

echo ""
echo "==> Publishing k8s-ops-plugin (code-plugin) v$VERSION ..."
clawhub package publish "$PLUGIN_DIR" \
  --family code-plugin \
  --name k8s-ops-plugin \
  --display-name "K8s Ops Plugin" \
  --version "$VERSION" \
  --changelog "$CHANGELOG" \
  --source-repo "pangxubin/k8s-ops-agent" \
  --source-commit "$COMMIT" \
  --source-ref "$REF" \
  --source-path "packages/openclaw-plugin"

echo ""
echo "==> Done! Published:"
echo "  Skill:  k8s-ops@$VERSION"
echo "  Plugin: k8s-ops-plugin@$VERSION"
echo ""
echo "  https://clawhub.ai/skills/k8s-ops"
