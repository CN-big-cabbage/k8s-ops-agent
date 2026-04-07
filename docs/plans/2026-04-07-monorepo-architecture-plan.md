# Monorepo Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure k8s-ops-agent from a monolithic OpenClaw plugin into a monorepo with 4 packages: core SDK, MCP Server, CLI, and OpenClaw adapter.

**Architecture:** Extract 32 platform-agnostic skill handlers into `@k8s-ops/core`, then build thin adapter layers for MCP Server, CLI, and OpenClaw. All adapters consume a central `skillRegistry` array to auto-register tools with zero manual wiring.

**Tech Stack:** pnpm workspaces, turborepo, TypeScript 6, vitest, @modelcontextprotocol/sdk, commander

**Design doc:** `docs/plans/2026-04-07-monorepo-architecture-design.md`

---

## Phase 1: Scaffold Monorepo

### Task 1: Initialize pnpm workspace

**Files:**
- Create: `pnpm-workspace.yaml`
- Modify: `package.json` (root)

**Step 1: Create pnpm-workspace.yaml**

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
```

**Step 2: Update root package.json**

Replace the current `package.json` with a root workspace config:

```json
{
  "name": "k8s-ops-agent",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "turbo build",
    "test": "turbo test",
    "clean": "turbo clean"
  },
  "devDependencies": {
    "turbo": "^2.5.0",
    "typescript": "^6.0.2"
  }
}
```

**Step 3: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "clean": {
      "cache": false
    }
  }
}
```

**Step 4: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "lib": ["ES2022"],
    "moduleResolution": "node16",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true,
    "composite": true
  }
}
```

**Step 5: Commit**

```bash
git add pnpm-workspace.yaml turbo.json tsconfig.base.json package.json
git commit -m "chore: initialize pnpm monorepo workspace with turborepo"
```

---

### Task 2: Create 4 package shells

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/mcp-server/package.json`
- Create: `packages/mcp-server/tsconfig.json`
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/openclaw-plugin/package.json`
- Create: `packages/openclaw-plugin/tsconfig.json`

**Step 1: Create packages/core**

`packages/core/package.json`:
```json
{
  "name": "@k8s-ops/core",
  "version": "2.0.0",
  "description": "Platform-agnostic Kubernetes operations SDK",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@kubernetes/client-node": "^0.21.0",
    "js-yaml": "^4.1.1",
    "ssh2": "^1.17.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^20.0.0",
    "@types/ssh2": "^1.15.5",
    "vitest": "^4.1.1"
  }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

**Step 2: Create packages/mcp-server**

`packages/mcp-server/package.json`:
```json
{
  "name": "@k8s-ops/mcp",
  "version": "1.0.0",
  "description": "K8s operations MCP Server for Claude, Cursor, and other AI tools",
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "k8s-ops-mcp": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@k8s-ops/core": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod-to-json-schema": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0"
  }
}
```

`packages/mcp-server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"],
  "references": [
    { "path": "../core" }
  ]
}
```

**Step 3: Create packages/cli**

`packages/cli/package.json`:
```json
{
  "name": "@k8s-ops/cli",
  "version": "1.0.0",
  "description": "Kubernetes operations CLI toolkit",
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "k8s-ops": "./dist/bin/k8s-ops.js"
  },
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@k8s-ops/core": "workspace:*",
    "commander": "^13.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0"
  }
}
```

`packages/cli/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"],
  "references": [
    { "path": "../core" }
  ]
}
```

**Step 4: Create packages/openclaw-plugin**

`packages/openclaw-plugin/package.json`:
```json
{
  "name": "@k8s-ops/openclaw",
  "version": "2.0.0",
  "description": "OpenClaw Kubernetes operations plugin",
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@k8s-ops/core": "workspace:*",
    "@sinclair/typebox": "^0.34.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0"
  },
  "peerDependencies": {
    "openclaw": ">=1.0.0"
  },
  "openclaw": {
    "extensions": ["./dist/index.js"]
  }
}
```

`packages/openclaw-plugin/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"],
  "references": [
    { "path": "../core" }
  ]
}
```

**Step 5: Create empty src directories and placeholder index.ts for each package**

```bash
mkdir -p packages/core/src packages/mcp-server/src packages/cli/src packages/cli/src/bin packages/openclaw-plugin/src
echo "// placeholder" > packages/core/src/index.ts
echo "// placeholder" > packages/mcp-server/src/index.ts
echo "// placeholder" > packages/cli/src/index.ts
echo "// placeholder" > packages/openclaw-plugin/src/index.ts
```

**Step 6: Install dependencies**

```bash
pnpm install
```

**Step 7: Verify workspace structure**

```bash
pnpm ls --filter @k8s-ops/core
pnpm ls --filter @k8s-ops/mcp
```

**Step 8: Commit**

```bash
git add packages/ pnpm-lock.yaml
git commit -m "chore: create 4 package shells (core, mcp, cli, openclaw)"
```

---

## Phase 2: Extract Core Package

### Task 3: Move lib/ to core

**Files:**
- Move: `lib/*.ts` -> `packages/core/src/lib/*.ts`
- Move: `lib/*.test.ts` -> `packages/core/src/lib/*.test.ts`

**Step 1: Move all lib files**

```bash
mkdir -p packages/core/src/lib
cp lib/client.ts packages/core/src/lib/client.ts
cp lib/errors.ts packages/core/src/lib/errors.ts
cp lib/errors.test.ts packages/core/src/lib/errors.test.ts
cp lib/format.ts packages/core/src/lib/format.ts
cp lib/format.test.ts packages/core/src/lib/format.test.ts
cp lib/ssh.ts packages/core/src/lib/ssh.ts
cp lib/ssh.test.ts packages/core/src/lib/ssh.test.ts
cp lib/types.ts packages/core/src/lib/types.ts
```

**Step 2: Fix import paths in lib files**

The lib files reference each other with `./xxx.js` — these should continue to work as-is since they're relative imports within the same directory.

Verify: no lib file imports from outside lib (only from each other and from `@kubernetes/client-node`, `ssh2`, etc.).

**Step 3: Add vitest config to core**

Create `packages/core/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

**Step 4: Run lib tests in core**

```bash
cd packages/core && pnpm test -- src/lib/
```

Expected: all lib tests pass.

**Step 5: Commit**

```bash
git add packages/core/src/lib/ packages/core/vitest.config.ts
git commit -m "feat(core): move lib/ to packages/core/src/lib"
```

---

### Task 4: Move and flatten skill handlers (batch 1 — already exported)

These 19 skills already have `export` on both handler and schema. They only need:
1. Copy the source file to `packages/core/src/skills/`
2. Remove the `import type { OpenClawPluginApi }` line
3. Remove the `registerXxxTools` function (moves to openclaw adapter)
4. Fix `../../../lib/` import paths to `../lib/`

**Files to create (source -> target):**
```
skills/k8s-pod/src/pod.ts          -> packages/core/src/skills/pod.ts
skills/k8s-pod/src/pod.test.ts     -> packages/core/src/skills/pod.test.ts
skills/k8s-rbac/src/rbac.ts        -> packages/core/src/skills/rbac.ts
skills/k8s-rbac/src/rbac.test.ts   -> packages/core/src/skills/rbac.test.ts (if exists)
skills/k8s-health/src/health.ts    -> packages/core/src/skills/health.ts
skills/k8s-health/src/health.test.ts -> packages/core/src/skills/health.test.ts
skills/k8s-gateway/src/gateway.ts  -> packages/core/src/skills/gateway.ts
skills/k8s-gateway/src/gateway.test.ts -> packages/core/src/skills/gateway.test.ts
skills/k8s-daemonset/src/daemonset.ts -> packages/core/src/skills/daemonset.ts
skills/k8s-daemonset/src/daemonset.test.ts -> packages/core/src/skills/daemonset.test.ts
skills/k8s-hpa/src/hpa.ts          -> packages/core/src/skills/hpa.ts
skills/k8s-cronjob/src/cronjob.ts  -> packages/core/src/skills/cronjob.ts
skills/k8s-cronjob/src/cronjob.test.ts -> packages/core/src/skills/cronjob.test.ts
skills/k8s-crd/src/crd.ts          -> packages/core/src/skills/crd.ts
skills/k8s-crd/src/crd.test.ts     -> packages/core/src/skills/crd.test.ts
skills/k8s-security/src/security.ts -> packages/core/src/skills/security.ts
skills/k8s-security/src/security.test.ts -> packages/core/src/skills/security.test.ts
skills/k8s-topology/src/topology.ts -> packages/core/src/skills/topology.ts
skills/k8s-topology/src/topology.test.ts -> packages/core/src/skills/topology.test.ts
skills/k8s-statefulset/src/statefulset.ts -> packages/core/src/skills/statefulset.ts
skills/k8s-statefulset/src/statefulset.test.ts -> packages/core/src/skills/statefulset.test.ts
skills/k8s-yaml/src/yaml.ts        -> packages/core/src/skills/yaml.ts
skills/k8s-yaml/src/yaml.test.ts   -> packages/core/src/skills/yaml.test.ts
skills/k8s-netpol/src/netpol.ts    -> packages/core/src/skills/netpol.ts
skills/k8s-netpol/src/netpol.test.ts -> packages/core/src/skills/netpol.test.ts
skills/k8s-cost/src/cost.ts        -> packages/core/src/skills/cost.ts
skills/k8s-cost/src/cost.test.ts   -> packages/core/src/skills/cost.test.ts (if exists)
skills/k8s-job/src/job.ts          -> packages/core/src/skills/job.ts
skills/k8s-job/src/job.test.ts     -> packages/core/src/skills/job.test.ts
skills/k8s-helm/src/helm.ts        -> packages/core/src/skills/helm.ts
skills/k8s-helm/src/helm.test.ts   -> packages/core/src/skills/helm.test.ts
skills/k8s-pdb/src/pdb.ts          -> packages/core/src/skills/pdb.ts
skills/k8s-pdb/src/pdb.test.ts     -> packages/core/src/skills/pdb.test.ts
skills/k8s-troubleshoot/src/troubleshoot.ts -> packages/core/src/skills/troubleshoot.ts
skills/k8s-troubleshoot/src/troubleshoot.test.ts -> packages/core/src/skills/troubleshoot.test.ts
skills/k8s-logs/src/logs.ts        -> packages/core/src/skills/logs.ts
skills/k8s-logs/src/logs.test.ts   -> packages/core/src/skills/logs.test.ts
skills/k8s-exec/src/exec.ts        -> packages/core/src/skills/exec.ts
skills/k8s-exec/src/exec.test.ts   -> packages/core/src/skills/exec.test.ts
```

**Step 1: Create skills directory and copy files**

```bash
mkdir -p packages/core/src/skills
```

For each file, copy then apply these edits:

1. **Remove** the line: `import type { OpenClawPluginApi } from "openclaw/plugin-sdk";`
2. **Replace all** `../../../lib/` with `../lib/` in import paths
3. **Remove** the entire `export function registerXxxTools(api: OpenClawPluginApi) { ... }` block at the bottom
4. For `logs.ts` and `exec.ts`: also add `export` to handler function (`async function handleK8sLogs` -> `export async function handleK8sLogs`)

**Step 2: Run tests**

```bash
cd packages/core && pnpm test -- src/skills/
```

Expected: all copied tests pass.

**Step 3: Commit**

```bash
git add packages/core/src/skills/
git commit -m "feat(core): move 19 pre-exported skill handlers to core"
```

---

### Task 5: Move and flatten skill handlers (batch 2 — needs export)

These 13 skills need `export` added to handler AND schema before moving:

```
skills/k8s-config/src/config.ts     -> packages/core/src/skills/config.ts
skills/k8s-deploy/src/deploy.ts     -> packages/core/src/skills/deploy.ts
skills/k8s-events/src/events.ts     -> packages/core/src/skills/events.ts
skills/k8s-event-analysis/src/analysis.ts -> packages/core/src/skills/event-analysis.ts
skills/k8s-ingress/src/ingress.ts   -> packages/core/src/skills/ingress.ts
skills/k8s-metrics/src/metrics.ts   -> packages/core/src/skills/metrics.ts
skills/k8s-namespace/src/namespace.ts -> packages/core/src/skills/namespace.ts
skills/k8s-node/src/node.ts         -> packages/core/src/skills/node.ts
skills/k8s-portforward/src/portforward.ts -> packages/core/src/skills/portforward.ts
skills/k8s-storage/src/storage.ts   -> packages/core/src/skills/storage.ts
skills/k8s-svc/src/svc.ts           -> packages/core/src/skills/svc.ts
```

Also copy test files where they exist (events.test.ts, event-analysis.test.ts, ingress.test.ts, metrics.test.ts, etc.).

**Step 1: Copy and edit each file**

For each file, apply these edits:
1. `const K8sXxxSchema` -> `export const K8sXxxSchema`
2. `async function handleK8sXxx` -> `export async function handleK8sXxx`
3. Remove `import type { OpenClawPluginApi } from "openclaw/plugin-sdk";`
4. Replace `../../../lib/` with `../lib/`
5. Remove the `registerXxxTools` function
6. Add `export type K8sXxxParams = z.infer<typeof K8sXxxSchema>;` if the type is not already exported

**Step 2: Move sys-monitor (special case)**

`skills/sys-monitor/src/monitor.ts` -> `packages/core/src/skills/sys-monitor.ts`

sys-monitor imports from `../../../lib/ssh.js` — change to `../lib/ssh.js`. Also imports from `../../../lib/types.js` — change to `../lib/types.js`. The `SshManager` class is in lib/ssh.ts (already moved). Remove OpenClaw import and register function.

**Step 3: Run all tests**

```bash
cd packages/core && pnpm test
```

Expected: all tests pass.

**Step 4: Commit**

```bash
git add packages/core/src/skills/
git commit -m "feat(core): move remaining 13 skill handlers with export fixes"
```

---

### Task 6: Create skill registry

**Files:**
- Create: `packages/core/src/registry.ts`

**Step 1: Write the failing test**

Create `packages/core/src/registry.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { skillRegistry } from "./registry.js";

describe("skillRegistry", () => {
  it("should contain 32 skills", () => {
    expect(skillRegistry.length).toBe(32);
  });

  it("should have unique names", () => {
    const names = skillRegistry.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("should have required fields on every skill", () => {
    for (const skill of skillRegistry) {
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.schema).toBeTruthy();
      expect(typeof skill.handler).toBe("function");
    }
  });

  it("should have names starting with k8s_ or sys_", () => {
    for (const skill of skillRegistry) {
      expect(skill.name).toMatch(/^(k8s_|sys_)/);
    }
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test -- src/registry.test.ts
```

Expected: FAIL — registry.ts does not exist.

**Step 3: Write registry.ts**

Create `packages/core/src/registry.ts`:
```typescript
import type { ZodSchema } from "zod";
import type { PluginConfig } from "./lib/types.js";

// Skills
import { handleK8sPod, K8sPodSchema } from "./skills/pod.js";
import { handleK8sDeploy, K8sDeploySchema } from "./skills/deploy.js";
import { handleK8sNode, K8sNodeSchema } from "./skills/node.js";
import { handleK8sSvc, K8sSvcSchema } from "./skills/svc.js";
import { handleK8sExec, K8sExecSchema } from "./skills/exec.js";
import { handleK8sLogs, K8sLogsSchema } from "./skills/logs.js";
import { handleK8sMetrics, K8sMetricsSchema } from "./skills/metrics.js";
import { handleK8sEvents, K8sEventsSchema } from "./skills/events.js";
import { handleK8sEventAnalysis, K8sEventAnalysisSchema } from "./skills/event-analysis.js";
import { handleK8sConfig, K8sConfigSchema } from "./skills/config.js";
import { handleK8sPortForward, K8sPortForwardSchema } from "./skills/portforward.js";
import { handleK8sIngress, K8sIngressSchema } from "./skills/ingress.js";
import { handleK8sStorage, K8sStorageSchema } from "./skills/storage.js";
import { handleK8sNamespace, K8sNamespaceSchema } from "./skills/namespace.js";
import { handleK8sStatefulSet, K8sStatefulSetSchema } from "./skills/statefulset.js";
import { handleK8sDaemonSet, K8sDaemonSetSchema } from "./skills/daemonset.js";
import { handleK8sJob, K8sJobSchema } from "./skills/job.js";
import { handleK8sCronJob, K8sCronJobSchema } from "./skills/cronjob.js";
import { handleK8sHpa, K8sHpaSchema } from "./skills/hpa.js";
import { handleK8sRbac, K8sRbacSchema } from "./skills/rbac.js";
import { handleK8sNetPol, K8sNetPolSchema } from "./skills/netpol.js";
import { handleK8sSecurity, K8sSecuritySchema } from "./skills/security.js";
import { handleK8sPdb, K8sPdbSchema } from "./skills/pdb.js";
import { handleK8sCrd, K8sCrdSchema } from "./skills/crd.js";
import { handleK8sHealth, K8sHealthSchema } from "./skills/health.js";
import { handleK8sTopology, K8sTopologySchema } from "./skills/topology.js";
import { handleK8sCost, K8sCostSchema } from "./skills/cost.js";
import { handleK8sHelm, K8sHelmSchema } from "./skills/helm.js";
import { handleK8sYaml, K8sYamlSchema } from "./skills/yaml.js";
import { handleK8sGateway, K8sGatewaySchema } from "./skills/gateway.js";
import { handleK8sTroubleshoot, K8sTroubleshootSchema } from "./skills/troubleshoot.js";
import { handleSysMonitor, SysMonitorSchema } from "./skills/sys-monitor.js";

export interface SkillDefinition {
  name: string;
  description: string;
  schema: ZodSchema;
  handler: (params: unknown, config?: PluginConfig) => Promise<string>;
}

export const skillRegistry: SkillDefinition[] = [
  // Core resources
  { name: "k8s_pod", description: "Kubernetes Pod operations: list, describe, delete, logs, exec", schema: K8sPodSchema, handler: handleK8sPod },
  { name: "k8s_deploy", description: "Kubernetes Deployment operations: list, describe, scale, rollout (status/history/restart/undo), update-image", schema: K8sDeploySchema, handler: handleK8sDeploy },
  { name: "k8s_node", description: "Kubernetes Node operations: list, describe, status, cordon, uncordon, drain, taints, labels", schema: K8sNodeSchema, handler: handleK8sNode },
  { name: "k8s_svc", description: "Kubernetes Service operations: list, describe, endpoints, status", schema: K8sSvcSchema, handler: handleK8sSvc },
  { name: "k8s_config", description: "Kubernetes ConfigMap and Secret operations: list, describe, get data, update, create, delete", schema: K8sConfigSchema, handler: handleK8sConfig },
  { name: "k8s_ingress", description: "Kubernetes Ingress operations: list, describe, status, create, delete, update", schema: K8sIngressSchema, handler: handleK8sIngress },
  { name: "k8s_storage", description: "Kubernetes Storage operations: list PVCs/PVs/StorageClasses, describe, capacity", schema: K8sStorageSchema, handler: handleK8sStorage },
  { name: "k8s_namespace", description: "Kubernetes Namespace operations: list, describe, create, delete, resource-quota", schema: K8sNamespaceSchema, handler: handleK8sNamespace },

  // Operations
  { name: "k8s_exec", description: "Execute commands in Kubernetes containers", schema: K8sExecSchema, handler: handleK8sExec },
  { name: "k8s_portforward", description: "Kubernetes port forwarding: create, list, close", schema: K8sPortForwardSchema, handler: handleK8sPortForward },
  { name: "k8s_logs", description: "Kubernetes log retrieval: current, previous, follow, multi-container", schema: K8sLogsSchema, handler: handleK8sLogs },
  { name: "k8s_metrics", description: "Kubernetes metrics: node and pod resource usage", schema: K8sMetricsSchema, handler: handleK8sMetrics },
  { name: "k8s_events", description: "Kubernetes events: list, filter, watch", schema: K8sEventsSchema, handler: handleK8sEvents },
  { name: "k8s_event_analysis", description: "Kubernetes event analysis: patterns, anomalies, correlations", schema: K8sEventAnalysisSchema, handler: handleK8sEventAnalysis },

  // Workloads
  { name: "k8s_statefulset", description: "Kubernetes StatefulSet operations: list, describe, scale, rollout", schema: K8sStatefulSetSchema, handler: handleK8sStatefulSet },
  { name: "k8s_daemonset", description: "Kubernetes DaemonSet operations: list, describe, rollout", schema: K8sDaemonSetSchema, handler: handleK8sDaemonSet },
  { name: "k8s_job", description: "Kubernetes Job operations: list, describe, create, delete, logs", schema: K8sJobSchema, handler: handleK8sJob },
  { name: "k8s_cronjob", description: "Kubernetes CronJob operations: list, describe, create, suspend, trigger", schema: K8sCronJobSchema, handler: handleK8sCronJob },
  { name: "k8s_hpa", description: "Kubernetes HPA operations: list, describe, create, update, delete", schema: K8sHpaSchema, handler: handleK8sHpa },

  // Security & RBAC
  { name: "k8s_rbac", description: "Kubernetes RBAC operations: roles, bindings, permissions check", schema: K8sRbacSchema, handler: handleK8sRbac },
  { name: "k8s_netpol", description: "Kubernetes NetworkPolicy operations: list, describe, create, delete, test", schema: K8sNetPolSchema, handler: handleK8sNetPol },
  { name: "k8s_security", description: "Kubernetes security audit: pod security, RBAC analysis, secrets scan", schema: K8sSecuritySchema, handler: handleK8sSecurity },

  // Advanced ops
  { name: "k8s_pdb", description: "Kubernetes PodDisruptionBudget operations: list, describe, create, delete", schema: K8sPdbSchema, handler: handleK8sPdb },
  { name: "k8s_crd", description: "Kubernetes CRD operations: list, describe, instances", schema: K8sCrdSchema, handler: handleK8sCrd },
  { name: "k8s_health", description: "Kubernetes cluster health check: nodes, workloads, networking, storage, certificates", schema: K8sHealthSchema, handler: handleK8sHealth },
  { name: "k8s_topology", description: "Kubernetes cluster topology: node distribution, pod placement, zone mapping", schema: K8sTopologySchema, handler: handleK8sTopology },
  { name: "k8s_cost", description: "Kubernetes cost analysis: resource usage, waste detection, optimization", schema: K8sCostSchema, handler: handleK8sCost },

  // Ecosystem
  { name: "k8s_helm", description: "Helm operations: list, install, upgrade, rollback, uninstall, values, history", schema: K8sHelmSchema, handler: handleK8sHelm },
  { name: "k8s_yaml", description: "Kubernetes YAML operations: validate, apply, diff, template, dry-run", schema: K8sYamlSchema, handler: handleK8sYaml },
  { name: "k8s_gateway", description: "Kubernetes Gateway API operations: routes, gateways, policies", schema: K8sGatewaySchema, handler: handleK8sGateway },
  { name: "k8s_troubleshoot", description: "Intelligent troubleshooting: pod_not_ready, service_no_endpoints, node_not_ready, pvc_pending, deployment_stuck, diagnose", schema: K8sTroubleshootSchema, handler: handleK8sTroubleshoot },

  // System monitoring
  { name: "sys_monitor", description: "Host system monitoring via SSH: overview, CPU, memory, disk, network, load, processes", schema: SysMonitorSchema, handler: handleSysMonitor },
];
```

**Step 4: Run test to verify it passes**

```bash
cd packages/core && pnpm test -- src/registry.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/registry.ts packages/core/src/registry.test.ts
git commit -m "feat(core): create skill registry with 32 skill definitions"
```

---

### Task 7: Create core index.ts (unified exports)

**Files:**
- Modify: `packages/core/src/index.ts`

**Step 1: Write index.ts**

Replace `packages/core/src/index.ts`:

```typescript
// Registry
export { skillRegistry, type SkillDefinition } from "./registry.js";

// Lib
export { createK8sClients, type K8sClients } from "./lib/client.js";
export { wrapK8sError } from "./lib/errors.js";
export { formatAge, formatTable } from "./lib/format.js";
export { type PluginConfig, type HostConfig, MAX_OUTPUT_BYTES, DEFAULT_NAMESPACE, EXEC_TIMEOUT_MS, MAX_LOG_LINES, DEFAULT_LOG_LINES } from "./lib/types.js";

// Skill handlers & schemas (re-export for direct usage)
export { handleK8sPod, K8sPodSchema } from "./skills/pod.js";
export { handleK8sDeploy, K8sDeploySchema } from "./skills/deploy.js";
export { handleK8sNode, K8sNodeSchema } from "./skills/node.js";
export { handleK8sSvc, K8sSvcSchema } from "./skills/svc.js";
export { handleK8sExec, K8sExecSchema } from "./skills/exec.js";
export { handleK8sLogs, K8sLogsSchema } from "./skills/logs.js";
export { handleK8sMetrics, K8sMetricsSchema } from "./skills/metrics.js";
export { handleK8sEvents, K8sEventsSchema } from "./skills/events.js";
export { handleK8sEventAnalysis, K8sEventAnalysisSchema } from "./skills/event-analysis.js";
export { handleK8sConfig, K8sConfigSchema } from "./skills/config.js";
export { handleK8sPortForward, K8sPortForwardSchema } from "./skills/portforward.js";
export { handleK8sIngress, K8sIngressSchema } from "./skills/ingress.js";
export { handleK8sStorage, K8sStorageSchema } from "./skills/storage.js";
export { handleK8sNamespace, K8sNamespaceSchema } from "./skills/namespace.js";
export { handleK8sStatefulSet, K8sStatefulSetSchema } from "./skills/statefulset.js";
export { handleK8sDaemonSet, K8sDaemonSetSchema } from "./skills/daemonset.js";
export { handleK8sJob, K8sJobSchema } from "./skills/job.js";
export { handleK8sCronJob, K8sCronJobSchema } from "./skills/cronjob.js";
export { handleK8sHpa, K8sHpaSchema } from "./skills/hpa.js";
export { handleK8sRbac, K8sRbacSchema } from "./skills/rbac.js";
export { handleK8sNetPol, K8sNetPolSchema } from "./skills/netpol.js";
export { handleK8sSecurity, K8sSecuritySchema } from "./skills/security.js";
export { handleK8sPdb, K8sPdbSchema } from "./skills/pdb.js";
export { handleK8sCrd, K8sCrdSchema } from "./skills/crd.js";
export { handleK8sHealth, K8sHealthSchema } from "./skills/health.js";
export { handleK8sTopology, K8sTopologySchema } from "./skills/topology.js";
export { handleK8sCost, K8sCostSchema } from "./skills/cost.js";
export { handleK8sHelm, K8sHelmSchema } from "./skills/helm.js";
export { handleK8sYaml, K8sYamlSchema } from "./skills/yaml.js";
export { handleK8sGateway, K8sGatewaySchema } from "./skills/gateway.js";
export { handleK8sTroubleshoot, K8sTroubleshootSchema } from "./skills/troubleshoot.js";
export { handleSysMonitor, SysMonitorSchema } from "./skills/sys-monitor.js";
```

**Step 2: Build core package**

```bash
cd packages/core && pnpm build
```

Expected: builds without errors.

**Step 3: Run full test suite**

```bash
cd packages/core && pnpm test
```

Expected: all tests pass.

**Step 4: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): add unified exports in index.ts"
```

---

## Phase 3: Rebuild OpenClaw Adapter

### Task 8: Implement OpenClaw adapter from core

**Files:**
- Modify: `packages/openclaw-plugin/src/index.ts`
- Copy: `openclaw.plugin.json` -> `packages/openclaw-plugin/openclaw.plugin.json`

**Step 1: Write the adapter**

Replace `packages/openclaw-plugin/src/index.ts`:

```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { skillRegistry, type PluginConfig } from "@k8s-ops/core";

function createApiAdapter(realApi: OpenClawPluginApi): OpenClawPluginApi {
  const proxy = Object.create(realApi);

  proxy.tools = {
    register(opts: {
      name: string;
      description: string;
      schema: unknown;
      handler: (params: unknown) => Promise<unknown>;
    }) {
      realApi.registerTool({
        name: opts.name,
        label: opts.name,
        description: opts.description,
        parameters: Type.Any(),
        async execute(_toolCallId: string, params: unknown) {
          const result = await opts.handler(params);
          const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
          return {
            content: [{ type: "text" as const, text }],
            details: result,
          };
        },
      });
    },
  };

  proxy.getPluginConfig = (_id: string) => {
    return (realApi as any).pluginConfig ?? undefined;
  };

  proxy.log = (msg: string) => {
    realApi.logger?.info?.(msg);
  };

  return proxy;
}

const plugin = {
  id: "k8s",
  name: "Kubernetes",
  description: "Kubernetes operations plugin - 32 tools for K8s management",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    const adapted = createApiAdapter(api);
    const pluginConfig: PluginConfig | undefined = api.getPluginConfig?.("k8s");

    for (const skill of skillRegistry) {
      adapted.tools.register({
        name: skill.name,
        description: skill.description,
        schema: skill.schema,
        handler: (params: unknown) => skill.handler(params, pluginConfig),
      });
    }

    api.logger?.info?.(`K8s plugin loaded successfully - ${skillRegistry.length} skills registered`);
  },
};

export default plugin;
```

**Step 2: Copy openclaw.plugin.json**

```bash
cp openclaw.plugin.json packages/openclaw-plugin/openclaw.plugin.json
```

Update the skills path in the copied file to point to the new location if needed.

**Step 3: Build**

```bash
pnpm --filter @k8s-ops/openclaw build
```

Expected: builds without errors.

**Step 4: Commit**

```bash
git add packages/openclaw-plugin/
git commit -m "feat(openclaw): rebuild adapter using core skillRegistry"
```

---

## Phase 4: Add MCP Adapter

### Task 9: Write MCP server test

**Files:**
- Create: `packages/mcp-server/src/index.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { skillRegistry } from "@k8s-ops/core";

describe("MCP Server", () => {
  it("should have access to all 32 skills from core", () => {
    expect(skillRegistry.length).toBe(32);
  });

  it("every skill name is a valid MCP tool name (no spaces, lowercase)", () => {
    for (const skill of skillRegistry) {
      expect(skill.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});
```

**Step 2: Run test to verify it passes**

```bash
cd packages/mcp-server && pnpm test
```

Note: This test validates the contract with core, not MCP internals (MCP SDK provides its own transport testing).

**Step 3: Commit**

```bash
git add packages/mcp-server/src/index.test.ts
git commit -m "test(mcp): add contract tests for skill registry integration"
```

---

### Task 10: Implement MCP server

**Files:**
- Modify: `packages/mcp-server/src/index.ts`

**Step 1: Write the MCP server**

Replace `packages/mcp-server/src/index.ts`:

```typescript
#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { skillRegistry, type PluginConfig } from "@k8s-ops/core";
import { zodToJsonSchema } from "zod-to-json-schema";

function loadConfigFromEnv(): PluginConfig {
  const config: PluginConfig = {};

  if (process.env.KUBECONFIG) {
    config.kubeconfigPath = process.env.KUBECONFIG;
  }

  if (process.env.K8S_CONTEXT) {
    config.defaultContext = process.env.K8S_CONTEXT;
  }

  if (process.env.K8S_OPS_SSH_HOSTS) {
    try {
      config.hosts = JSON.parse(process.env.K8S_OPS_SSH_HOSTS);
    } catch {
      console.error("Warning: K8S_OPS_SSH_HOSTS is not valid JSON, ignoring");
    }
  }

  return config;
}

function createServer(config: PluginConfig): McpServer {
  const server = new McpServer({
    name: "k8s-ops",
    version: "1.0.0",
  });

  for (const skill of skillRegistry) {
    const jsonSchema = zodToJsonSchema(skill.schema, { target: "openApi3" });

    server.tool(
      skill.name,
      skill.description,
      (jsonSchema as any).properties ?? {},
      async (params: Record<string, unknown>) => {
        try {
          const result = await skill.handler(params, config);
          return {
            content: [{ type: "text" as const, text: result }],
          };
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text" as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

**Step 2: Build**

```bash
pnpm --filter @k8s-ops/mcp build
```

Expected: builds without errors.

**Step 3: Smoke test (manual)**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node packages/mcp-server/dist/index.js
```

Expected: JSON response with server capabilities listing 32 tools.

**Step 4: Commit**

```bash
git add packages/mcp-server/src/index.ts
git commit -m "feat(mcp): implement MCP server with 32 K8s tools"
```

---

## Phase 5: Add CLI Adapter

### Task 11: Write CLI test

**Files:**
- Create: `packages/cli/src/cli.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { buildCli } from "./cli.js";

describe("CLI", () => {
  it("should create commands for all skill categories", () => {
    const program = buildCli({});
    const commandNames = program.commands.map((c) => c.name());

    expect(commandNames).toContain("pod");
    expect(commandNames).toContain("deploy");
    expect(commandNames).toContain("health");
    expect(commandNames).toContain("troubleshoot");
    expect(commandNames).toContain("sys-monitor");
  });

  it("should have 32 commands total", () => {
    const program = buildCli({});
    expect(program.commands.length).toBe(32);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/cli && pnpm test
```

Expected: FAIL — cli.ts does not exist.

**Step 3: Commit**

```bash
git add packages/cli/src/cli.test.ts
git commit -m "test(cli): add CLI command structure tests"
```

---

### Task 12: Implement CLI

**Files:**
- Create: `packages/cli/src/cli.ts`
- Modify: `packages/cli/src/index.ts`
- Create: `packages/cli/src/bin/k8s-ops.ts`

**Step 1: Create cli.ts (command builder)**

```typescript
import { Command } from "commander";
import { skillRegistry, type PluginConfig } from "@k8s-ops/core";

function skillNameToCommand(name: string): string {
  // "k8s_pod" -> "pod", "k8s_event_analysis" -> "event-analysis", "sys_monitor" -> "sys-monitor"
  return name
    .replace(/^k8s_/, "")
    .replace(/^sys_/, "sys-")
    .replace(/_/g, "-");
}

export function buildCli(config: PluginConfig): Command {
  const program = new Command()
    .name("k8s-ops")
    .description("Kubernetes operations toolkit — 32 tools for cluster management")
    .version("1.0.0");

  for (const skill of skillRegistry) {
    const cmdName = skillNameToCommand(skill.name);

    const cmd = program
      .command(cmdName)
      .description(skill.description)
      .option("-n, --namespace <namespace>", "Kubernetes namespace")
      .option("--all-namespaces", "All namespaces")
      .option("--context <context>", "Kubernetes context")
      .option("--json", "Output raw JSON")
      .argument("[action]", "Action to perform")
      .argument("[args...]", "Additional arguments")
      .action(async (action: string | undefined, args: string[], options: Record<string, unknown>) => {
        try {
          const params: Record<string, unknown> = { ...options };
          if (action) {
            params.action = action;
          }

          // Parse remaining key=value args
          for (const arg of args) {
            const eqIndex = arg.indexOf("=");
            if (eqIndex > 0) {
              params[arg.slice(0, eqIndex)] = arg.slice(eqIndex + 1);
            }
          }

          // Remove commander-specific keys
          delete params.json;

          const result = await skill.handler(params, config);
          console.log(result);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Error: ${message}`);
          process.exit(1);
        }
      });
  }

  return program;
}
```

**Step 2: Create bin/k8s-ops.ts**

```typescript
#!/usr/bin/env node

import { buildCli } from "../cli.js";
import type { PluginConfig } from "@k8s-ops/core";

const config: PluginConfig = {};

if (process.env.KUBECONFIG) {
  config.kubeconfigPath = process.env.KUBECONFIG;
}
if (process.env.K8S_CONTEXT) {
  config.defaultContext = process.env.K8S_CONTEXT;
}
if (process.env.K8S_OPS_SSH_HOSTS) {
  try {
    config.hosts = JSON.parse(process.env.K8S_OPS_SSH_HOSTS);
  } catch {
    console.error("Warning: K8S_OPS_SSH_HOSTS is not valid JSON, ignoring");
  }
}

const program = buildCli(config);
program.parse();
```

**Step 3: Update packages/cli/src/index.ts**

```typescript
export { buildCli } from "./cli.js";
```

**Step 4: Add vitest config to cli**

Create `packages/cli/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

Add vitest to cli devDependencies in `packages/cli/package.json`.

**Step 5: Run tests**

```bash
cd packages/cli && pnpm test
```

Expected: PASS — 32 commands created.

**Step 6: Build and smoke test**

```bash
pnpm --filter @k8s-ops/cli build
node packages/cli/dist/bin/k8s-ops.js --help
node packages/cli/dist/bin/k8s-ops.js health --help
```

Expected: help output showing all 32 commands.

**Step 7: Commit**

```bash
git add packages/cli/
git commit -m "feat(cli): implement CLI with 32 auto-generated commands"
```

---

## Phase 6: Clean Up and Validate

### Task 13: Full build and test validation

**Step 1: Build all packages**

```bash
pnpm build
```

Expected: all 4 packages build without errors.

**Step 2: Run all tests**

```bash
pnpm test
```

Expected: all tests pass across all packages.

**Step 3: Verify package sizes**

```bash
du -sh packages/*/dist/
```

**Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: final monorepo validation and cleanup"
```

---

### Task 14: Update root README

**Files:**
- Modify: `README.md`
- Modify: `README_CN.md`

**Step 1: Update README.md**

Add a "Packages" section and update Quick Start to show all 3 installation methods:

```markdown
## Packages

| Package | Description | Install |
|---------|-------------|---------|
| [@k8s-ops/core](packages/core) | Platform-agnostic K8s operations SDK | `npm i @k8s-ops/core` |
| [@k8s-ops/mcp](packages/mcp-server) | MCP Server for AI tools | `npx @k8s-ops/mcp` |
| [@k8s-ops/cli](packages/cli) | CLI toolkit | `npx @k8s-ops/cli health cluster` |
| [@k8s-ops/openclaw](packages/openclaw-plugin) | OpenClaw plugin | `openclaw plugins install` |

## Quick Start

### As MCP Server (Claude Code, Cursor, VS Code)

Add to your MCP config:
{json config}

### As CLI Tool

{cli examples}

### As OpenClaw Plugin

{existing quick start}
```

**Step 2: Mirror changes to README_CN.md**

**Step 3: Commit**

```bash
git add README.md README_CN.md
git commit -m "docs: update READMEs for monorepo with MCP/CLI/OpenClaw quick start"
```

---

### Task 15: Remove old skill directories

After all packages are working, remove the old top-level `skills/`, `lib/`, `index.ts`, and old config files that have been migrated.

**Step 1: Remove old files**

```bash
rm -rf skills/ lib/ index.ts openclaw.plugin.json vitest.config.ts tsconfig.json
```

**Step 2: Verify build still works**

```bash
pnpm build && pnpm test
```

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove old monolithic structure after monorepo migration"
```

---

## Summary

| Phase | Tasks | Key Deliverable |
|-------|-------|-----------------|
| 1. Scaffold | Task 1-2 | pnpm workspace + 4 package shells |
| 2. Extract Core | Task 3-7 | `@k8s-ops/core` with 32 handlers + registry |
| 3. OpenClaw Adapter | Task 8 | `@k8s-ops/openclaw` — feature parity with current |
| 4. MCP Server | Task 9-10 | `@k8s-ops/mcp` — npx-runnable MCP server |
| 5. CLI | Task 11-12 | `@k8s-ops/cli` — 32 auto-generated commands |
| 6. Clean Up | Task 13-15 | Full validation, docs, old code removal |

**Total:** 15 tasks, ~15 commits
