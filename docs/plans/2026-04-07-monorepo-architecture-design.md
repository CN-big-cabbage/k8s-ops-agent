# Monorepo Architecture Design

Date: 2026-04-07
Status: Approved

## Background

k8s-ops-agent provides 32 K8s-focused skills for resource management, troubleshooting, security checks, and host monitoring. The project is currently tightly coupled to OpenClaw (`openclaw/plugin-sdk`), limiting its audience to OpenClaw users only.

**Goal:** Extract core logic into a platform-agnostic SDK and build multiple adapter layers to reach the open-source community through diverse entry points.

**Target audience:** Open-source community (GitHub).

## Architecture: Monorepo with 4 Packages

```
k8s-ops-agent/
├── packages/
│   ├── core/                    # @k8s-ops/core
│   │   ├── src/
│   │   │   ├── skills/          # 32 skill handlers (flat files)
│   │   │   ├── lib/             # client, errors, format, ssh, types
│   │   │   ├── registry.ts      # SkillDefinition[] registry
│   │   │   └── index.ts         # unified exports
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── mcp-server/              # @k8s-ops/mcp
│   │   ├── src/
│   │   │   └── index.ts         # register core handlers as MCP tools
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── cli/                     # @k8s-ops/cli
│   │   ├── src/
│   │   │   └── index.ts         # commander wrapping core handlers
│   │   ├── bin/
│   │   │   └── k8s-ops.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── openclaw-plugin/         # @k8s-ops/openclaw
│       ├── src/
│       │   └── index.ts         # createApiAdapter + registry loop
│       ├── openclaw.plugin.json
│       ├── package.json
│       └── tsconfig.json
│
├── docs/
├── examples/
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── package.json
├── README.md
└── README_CN.md
```

## Package Details

### @k8s-ops/core

The platform-agnostic SDK. Zero platform dependencies.

**Unified handler signature:**

```typescript
type SkillHandler = (params: unknown, config?: PluginConfig) => Promise<string>
```

**Skill registry (key abstraction):**

```typescript
interface SkillDefinition {
  name: string           // "k8s_pod", "k8s_deploy", ...
  description: string    // AI-readable description
  schema: ZodSchema      // parameter validation
  handler: SkillHandler  // pure function
}

const skillRegistry: SkillDefinition[] = [
  { name: "k8s_pod", description: "...", schema: K8sPodSchema, handler: handleK8sPod },
  // ... 32 skills
]
```

**Exports:** Each skill exports handler + schema + type. The registry enables adapters to register all skills with zero manual wiring.

**Dependencies:** `@kubernetes/client-node`, `js-yaml`, `ssh2`, `zod`

**Design decisions:**
- Flatten skill directory structure: `skills/k8s-pod/src/pod.ts` -> `skills/pod.ts`
- Tests colocated: `skills/pod.test.ts` alongside `skills/pod.ts`
- `lib/` moves into core unchanged

### @k8s-ops/mcp

MCP Server adapter. Estimated < 100 lines of adapter code.

Iterates `skillRegistry` and registers each as an MCP tool via `@modelcontextprotocol/sdk`.

**User setup (Claude Code):**

```json
{
  "mcpServers": {
    "k8s-ops": {
      "command": "npx",
      "args": ["@k8s-ops/mcp"],
      "env": { "KUBECONFIG": "~/.kube/config" }
    }
  }
}
```

**Configuration via environment variables:**

| Variable | Description | Default |
|----------|-------------|---------|
| `KUBECONFIG` | kubeconfig path | `~/.kube/config` |
| `K8S_CONTEXT` | default context | current context |
| `K8S_OPS_SSH_HOSTS` | SSH hosts (JSON) | empty |

**Dependencies:** `@k8s-ops/core`, `@modelcontextprotocol/sdk`, `zod-to-json-schema`

### @k8s-ops/cli

CLI tool. Command format: `k8s-ops <skill> <action> [options]`

```bash
k8s-ops pod list -n production
k8s-ops deploy scale --name frontend --replicas 5
k8s-ops troubleshoot pod-not-ready --name checkout-svc
k8s-ops health cluster
k8s-ops sys-monitor cpu --host 192.168.1.10
```

Auto-generates commands from `skillRegistry` + Zod schema introspection.

**Output modes:**
- Default: human-readable (existing handler format)
- `--output json`: machine-readable (future enhancement, not in v1)

**Dependencies:** `@k8s-ops/core`, `commander`

### @k8s-ops/openclaw

Existing OpenClaw adapter, simplified from ~140 lines to ~40 lines by looping over `skillRegistry` instead of 32 individual imports.

**Dependencies:** `@k8s-ops/core`, `openclaw/plugin-sdk`, `@sinclair/typebox`

## Migration Strategy

Ordered for minimal risk:

### Phase 1: Scaffold Monorepo
- Initialize pnpm workspace + turborepo
- Create `tsconfig.base.json`
- Create 4 empty package shells

### Phase 2: Extract Core Package
- Move `lib/` -> `packages/core/src/lib/`
- Move and flatten skill handlers -> `packages/core/src/skills/`
- Unify handler signatures (extract inline handlers from register functions)
- Create `skillRegistry`
- Ensure all existing tests pass under core
- Gate: `pnpm test` all green

### Phase 3: Rebuild OpenClaw Adapter
- Rewrite `index.ts` to import from `@k8s-ops/core`
- Verify: `openclaw plugins install` still works
- Gate: feature parity with current state

### Phase 4: Add MCP Adapter
- Implement mcp-server package
- Test: Claude Code integration with 32 tools
- Gate: all tools callable via MCP

### Phase 5: Add CLI Adapter
- Implement cli package
- Test: `k8s-ops health cluster` works
- Gate: all commands functional

**Key principle:** After Phase 2-3, the project is functionally identical to today. Phases 4-5 are pure additions.

## Version Strategy

| Package | Starting Version | Rationale |
|---------|-----------------|-----------|
| `@k8s-ops/core` | 2.0.0 | Major architecture change |
| `@k8s-ops/mcp` | 1.0.0 | New package |
| `@k8s-ops/cli` | 1.0.0 | New package |
| `@k8s-ops/openclaw` | 2.0.0 | Internal restructure from 1.8.0 |

## Key Insight

The existing handler functions (e.g., `handleK8sTroubleshoot(params, pluginConfig)`) already accept plain params and return plain strings. The OpenClaw coupling only exists in the `register*Tools` wrapper functions. This means the extraction cost is primarily file moves + import path adjustments, not logic rewrites.
