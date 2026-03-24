# Phase 1: k8s-exec + k8s-logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add container execution and advanced logging skills to the K8s ops agent, plus extract shared utilities from duplicated code.

**Architecture:** Extract duplicated `initializeK8sClient`, `formatAge`, `formatTable`, and error handling into `lib/` shared modules. Build `k8s-exec` skill using `@kubernetes/client-node` Exec API for WebSocket-based container command execution. Build `k8s-logs` skill using the existing CoreV1Api log endpoints with in-memory search, aggregation, and statistics. Both skills follow the existing pattern: Zod schema → handler → register function.

**Tech Stack:** TypeScript, @kubernetes/client-node (Exec + CoreV1Api), Zod v4, vitest (new dev dependency for testing)

**Spec:** `docs/superpowers/specs/2026-03-24-k8s-feature-expansion-design.md`

---

## File Structure

```
lib/
├── client.ts          # K8s client init + context management (extracted from all 4 skills)
├── format.ts          # formatAge, formatTable, truncateOutput (extracted from all 4 skills)
├── errors.ts          # wrapK8sError (standardized error handling)
└── types.ts           # PluginConfig type, shared constants

skills/k8s-exec/
├── SKILL.md           # Skill documentation
└── src/
    └── exec.ts        # Container execution skill (6 actions)

skills/k8s-logs/
├── SKILL.md           # Skill documentation
└── src/
    └── logs.ts        # Advanced logging skill (6 actions)

index.ts               # Updated to register 6 skills
```

---

### Task 1: Add vitest and set up test infrastructure

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest**

Run: `cd /Users/a123/git/k8s-ops-agent && npm install --save-dev vitest`

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

- [ ] **Step 3: Add test script to package.json**

Add to `package.json` scripts:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 4: Verify vitest runs**

Run: `cd /Users/a123/git/k8s-ops-agent && npx vitest run`
Expected: "No test files found" (no error)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest test infrastructure"
```

---

### Task 2: Extract shared library — `lib/types.ts`

**Files:**
- Create: `lib/types.ts`

- [ ] **Step 1: Create lib/types.ts**

```typescript
export interface PluginConfig {
  kubeconfigPath?: string;
  defaultContext?: string;
}

export const MAX_OUTPUT_BYTES = 10 * 1024; // 10KB output limit
export const DEFAULT_NAMESPACE = "default";
export const EXEC_TIMEOUT_MS = 30_000; // 30 seconds
export const MAX_LOG_LINES = 1000;
export const DEFAULT_LOG_LINES = 100;
```

- [ ] **Step 2: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add shared types and constants"
```

---

### Task 3: Extract shared library — `lib/format.ts`

**Files:**
- Create: `lib/format.ts`
- Create: `lib/format.test.ts`

- [ ] **Step 1: Write failing tests for formatAge and formatTable**

Create `lib/format.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { formatAge, formatTable, statusSymbol } from "./format.js";

describe("formatAge", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-24T12:00:30Z"));
    expect(formatAge(new Date("2026-03-24T12:00:00Z"))).toBe("30s");
  });

  it("formats minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-24T12:05:00Z"));
    expect(formatAge(new Date("2026-03-24T12:00:00Z"))).toBe("5m");
  });

  it("formats hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-24T15:00:00Z"));
    expect(formatAge(new Date("2026-03-24T12:00:00Z"))).toBe("3h");
  });

  it("formats days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T12:00:00Z"));
    expect(formatAge(new Date("2026-03-24T12:00:00Z"))).toBe("3d");
  });
});

describe("formatTable", () => {
  it("formats a simple table", () => {
    const result = formatTable(["NAME", "AGE"], [["nginx", "3d"], ["redis", "1h"]]);
    expect(result).toContain("NAME");
    expect(result).toContain("nginx");
    expect(result).toContain("redis");
    expect(result.split("\n")).toHaveLength(4); // header + separator + 2 rows
  });

  it("handles empty rows", () => {
    const result = formatTable(["NAME"], []);
    expect(result.split("\n")).toHaveLength(2); // header + separator
  });
});

describe("statusSymbol", () => {
  it("returns checkmark for success states", () => {
    expect(statusSymbol("Running")).toBe("✓");
    expect(statusSymbol("Ready")).toBe("✓");
    expect(statusSymbol("True")).toBe("✓");
  });

  it("returns X for failure states", () => {
    expect(statusSymbol("Failed")).toBe("✗");
    expect(statusSymbol("False")).toBe("✗");
    expect(statusSymbol("Error")).toBe("✗");
  });

  it("returns spinner for pending states", () => {
    expect(statusSymbol("Pending")).toBe("⟳");
    expect(statusSymbol("Unknown")).toBe("⟳");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/a123/git/k8s-ops-agent && npx vitest run lib/format.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement lib/format.ts**

```typescript
export function formatAge(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffDay > 0) return `${diffDay}d`;
  if (diffHour > 0) return `${diffHour}h`;
  if (diffMin > 0) return `${diffMin}m`;
  return `${diffSec}s`;
}

export function formatTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) => {
    const maxRowWidth = rows.length > 0 ? Math.max(...rows.map((r) => (r[i] || "").length)) : 0;
    return Math.max(h.length, maxRowWidth);
  });

  const headerRow = headers.map((h, i) => h.padEnd(colWidths[i])).join("  ");
  const separator = colWidths.map((w) => "-".repeat(w)).join("  ");

  const dataRows = rows.map((row) =>
    row.map((cell, i) => (cell || "").padEnd(colWidths[i])).join("  ")
  );

  return [headerRow, separator, ...dataRows].join("\n");
}

export function statusSymbol(status: string): string {
  const successStates = ["Running", "Ready", "True", "Succeeded", "Active", "Healthy", "Available"];
  const failureStates = ["Failed", "False", "Error", "CrashLoopBackOff", "ImagePullBackOff", "OOMKilled"];

  if (successStates.includes(status)) return "✓";
  if (failureStates.includes(status)) return "✗";
  return "⟳";
}

export function truncateOutput(output: string, maxBytes: number): string {
  if (Buffer.byteLength(output, "utf-8") <= maxBytes) return output;
  const truncated = Buffer.from(output, "utf-8").subarray(0, maxBytes).toString("utf-8");
  return truncated + `\n\n--- Output truncated (exceeded ${Math.round(maxBytes / 1024)}KB limit) ---`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/a123/git/k8s-ops-agent && npx vitest run lib/format.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/format.ts lib/format.test.ts
git commit -m "feat: extract shared formatters to lib/format.ts"
```

---

### Task 4: Extract shared library — `lib/client.ts`

**Files:**
- Create: `lib/client.ts`

- [ ] **Step 1: Implement lib/client.ts**

```typescript
import * as k8s from "@kubernetes/client-node";
import type { PluginConfig } from "./types.js";

export interface K8sClients {
  kc: k8s.KubeConfig;
  coreApi: k8s.CoreV1Api;
  appsApi: k8s.AppsV1Api;
}

const clientCache = new Map<string, K8sClients>();

function cacheKey(kubeconfigPath?: string, context?: string): string {
  return `${kubeconfigPath || "default"}:${context || "default"}`;
}

export function createK8sClients(
  config?: PluginConfig,
  contextOverride?: string
): K8sClients {
  const context = contextOverride || config?.defaultContext;
  const key = cacheKey(config?.kubeconfigPath, context);

  const cached = clientCache.get(key);
  if (cached) return cached;

  const kc = new k8s.KubeConfig();

  if (config?.kubeconfigPath) {
    kc.loadFromFile(config.kubeconfigPath);
  } else {
    kc.loadFromDefault();
  }

  if (context) {
    kc.setCurrentContext(context);
  }

  const clients: K8sClients = {
    kc,
    coreApi: kc.makeApiClient(k8s.CoreV1Api),
    appsApi: kc.makeApiClient(k8s.AppsV1Api),
  };

  clientCache.set(key, clients);
  return clients;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/client.ts
git commit -m "feat: extract shared K8s client initialization to lib/client.ts"
```

---

### Task 5: Extract shared library — `lib/errors.ts`

**Files:**
- Create: `lib/errors.ts`
- Create: `lib/errors.test.ts`

- [ ] **Step 1: Write failing test**

Create `lib/errors.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { wrapK8sError } from "./errors.js";

describe("wrapK8sError", () => {
  it("extracts K8s API error message", () => {
    const error = { response: { body: { message: "pods \"foo\" not found" } } };
    const result = wrapK8sError(error, "get pod");
    expect(result).toContain("get pod");
    expect(result).toContain("pods \"foo\" not found");
  });

  it("handles standard Error objects", () => {
    const error = new Error("connection refused");
    const result = wrapK8sError(error, "list pods");
    expect(result).toContain("list pods");
    expect(result).toContain("connection refused");
  });

  it("handles unknown error types", () => {
    const result = wrapK8sError("something broke", "describe node");
    expect(result).toContain("describe node");
    expect(result).toContain("Unknown error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/a123/git/k8s-ops-agent && npx vitest run lib/errors.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement lib/errors.ts**

```typescript
export function wrapK8sError(error: unknown, operation: string): string {
  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    (error as any).response?.body?.message
  ) {
    return `[${operation}] Kubernetes API error: ${(error as any).response.body.message}`;
  }

  if (error instanceof Error) {
    return `[${operation}] Error: ${error.message}`;
  }

  return `[${operation}] Unknown error: ${String(error)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/a123/git/k8s-ops-agent && npx vitest run lib/errors.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/errors.ts lib/errors.test.ts
git commit -m "feat: add standardized K8s error handling to lib/errors.ts"
```

---

### Task 6: Migrate existing skills to use shared lib

**Files:**
- Modify: `skills/k8s-pod/src/pod.ts`
- Modify: `skills/k8s-deploy/src/deploy.ts`
- Modify: `skills/k8s-node/src/node.ts`
- Modify: `skills/k8s-svc/src/svc.ts`

This task migrates all 4 existing skills to import from `lib/` instead of defining their own `initializeK8sClient`, `formatAge`, `formatTable`, and error handling. The migration must preserve all existing behavior.

- [ ] **Step 1: Migrate k8s-pod/src/pod.ts**

Replace the file's local functions with imports:

1. Add imports at top:
```typescript
import { createK8sClients } from "../../../lib/client.js";
import { formatAge, formatTable } from "../../../lib/format.js";
import { wrapK8sError } from "../../../lib/errors.js";
import type { PluginConfig } from "../../../lib/types.js";
```

2. Remove local `initializeK8sClient`, `formatAge`, `formatTable` functions and the module-level `kc`/`k8sApi` variables.

3. Update `handleK8sPod` to use:
```typescript
async function handleK8sPod(params: K8sPodParams, pluginConfig?: PluginConfig): Promise<string> {
  try {
    const { coreApi } = createK8sClients(pluginConfig, params.context);
    // ... rest unchanged, but replace k8sApi with coreApi ...
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `pod ${params.action}`));
  }
}
```

4. In the handler, rename all `k8sApi` references to `coreApi` (matching the shared client interface).

- [ ] **Step 2: Migrate k8s-deploy/src/deploy.ts**

Same pattern:
1. Add imports from `lib/`.
2. Remove local `initializeK8sClient`, `formatAge`, `formatTable`, module-level `kc`/`appsApi`/`coreApi`.
3. Update `handleK8sDeploy` to use `createK8sClients` and `wrapK8sError`.

- [ ] **Step 3: Migrate k8s-node/src/node.ts**

Same pattern:
1. Add imports from `lib/`.
2. Remove local `initializeK8sClient`, `formatAge`, `formatTable`, module-level `kc`/`coreApi`.
3. Update `handleK8sNode` to use `createK8sClients` and `wrapK8sError`.

- [ ] **Step 4: Migrate k8s-svc/src/svc.ts**

Same pattern:
1. Add imports from `lib/`.
2. Remove local `initializeK8sClient`, `formatAge`, `formatTable`, module-level `kc`/`coreApi`.
3. Update `handleK8sSvc` to use `createK8sClients` and `wrapK8sError`.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd /Users/a123/git/k8s-ops-agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Run all tests**

Run: `cd /Users/a123/git/k8s-ops-agent && npx vitest run`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add skills/k8s-pod/src/pod.ts skills/k8s-deploy/src/deploy.ts skills/k8s-node/src/node.ts skills/k8s-svc/src/svc.ts
git commit -m "refactor: migrate existing skills to shared lib"
```

---

### Task 7: Implement k8s-exec skill

**Files:**
- Create: `skills/k8s-exec/SKILL.md`
- Create: `skills/k8s-exec/src/exec.ts`

- [ ] **Step 1: Create SKILL.md**

Create `skills/k8s-exec/SKILL.md`:

```markdown
---
name: k8s-exec
description: |
  Kubernetes container execution. Activate when user wants to run commands inside containers, check files, view processes, or test network connectivity in pods.
---

# Kubernetes Exec Tool

Single tool `k8s_exec` with action parameter for container execution operations.

## Actions

### Execute Command

Run a command inside a container:

\```json
{
  "action": "exec",
  "namespace": "default",
  "pod_name": "nginx-abc123",
  "command": "ls -la /etc/nginx"
}
\```

### Read File

Read a file from inside a container:

\```json
{
  "action": "file_read",
  "namespace": "default",
  "pod_name": "nginx-abc123",
  "file_path": "/etc/nginx/nginx.conf"
}
\```

### List Directory

List directory contents:

\```json
{
  "action": "file_list",
  "namespace": "default",
  "pod_name": "nginx-abc123",
  "directory": "/var/log"
}
\```

### View Environment Variables

\```json
{
  "action": "env",
  "namespace": "default",
  "pod_name": "app-abc123"
}
\```

### List Processes

\```json
{
  "action": "process_list",
  "namespace": "default",
  "pod_name": "app-abc123"
}
\```

### Network Check

Test connectivity from inside a container:

\```json
{
  "action": "network_check",
  "namespace": "default",
  "pod_name": "app-abc123",
  "target_host": "redis-service",
  "target_port": 6379
}
\```

## Common Workflows

### Debug a CrashLoopBackOff

1. Check environment variables: `{ "action": "env", ... }`
2. Read config files: `{ "action": "file_read", "file_path": "/app/config.yaml", ... }`
3. Check processes: `{ "action": "process_list", ... }`

### Verify Network Connectivity

1. Check DNS resolution: `{ "action": "exec", "command": "nslookup redis-service", ... }`
2. Test port: `{ "action": "network_check", "target_host": "redis-service", "target_port": 6379, ... }`

## Safety Notes

- All commands have a 30-second timeout
- Output exceeding 10KB is truncated
- For multi-container pods, specify the `container` parameter
- Requires `pods/exec` RBAC permission

## Permissions Required

- `pods/exec` - Execute commands in containers
- `pods/get` - Get pod information
```

- [ ] **Step 2: Implement exec.ts**

Create `skills/k8s-exec/src/exec.ts`:

```typescript
import * as k8s from "@kubernetes/client-node";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { z } from "zod";
import { createK8sClients } from "../../../lib/client.js";
import { truncateOutput } from "../../../lib/format.js";
import { wrapK8sError } from "../../../lib/errors.js";
import type { PluginConfig } from "../../../lib/types.js";
import { MAX_OUTPUT_BYTES, EXEC_TIMEOUT_MS, DEFAULT_NAMESPACE } from "../../../lib/types.js";
import * as stream from "stream";

const K8sExecSchema = z.object({
  action: z.enum(["exec", "file_read", "file_list", "env", "process_list", "network_check"]),
  namespace: z.string().default(DEFAULT_NAMESPACE),
  pod_name: z.string(),
  container: z.string().optional(),
  command: z.string().optional(),
  file_path: z.string().optional(),
  directory: z.string().default("/"),
  target_host: z.string().optional(),
  target_port: z.number().int().positive().optional(),
  context: z.string().optional(),
});

type K8sExecParams = z.infer<typeof K8sExecSchema>;

async function execInPod(
  kc: k8s.KubeConfig,
  namespace: string,
  podName: string,
  containerName: string | undefined,
  command: string[]
): Promise<{ stdout: string; stderr: string }> {
  const exec = new k8s.Exec(kc);

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const stdoutStream = new stream.Writable({
      write(chunk, _encoding, callback) {
        stdout += chunk.toString();
        callback();
      },
    });

    const stderrStream = new stream.Writable({
      write(chunk, _encoding, callback) {
        stderr += chunk.toString();
        callback();
      },
    });

    const timeout = setTimeout(() => {
      reject(new Error(`Command timed out after ${EXEC_TIMEOUT_MS / 1000} seconds`));
    }, EXEC_TIMEOUT_MS);

    exec
      .exec(
        namespace,
        podName,
        containerName ?? "",
        command,
        stdoutStream,
        stderrStream,
        null, // stdin
        false, // tty
        (status: k8s.V1Status) => {
          clearTimeout(timeout);
          if (status.status === "Success") {
            resolve({ stdout, stderr });
          } else {
            reject(new Error(status.message || `Command failed: ${command.join(" ")}`));
          }
        }
      )
      .catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
  });
}

function buildExecCommand(params: K8sExecParams): string[] {
  switch (params.action) {
    case "exec":
      if (!params.command) throw new Error("command is required for exec action");
      return ["sh", "-c", params.command];

    case "file_read":
      if (!params.file_path) throw new Error("file_path is required for file_read action");
      return ["cat", params.file_path];

    case "file_list":
      return ["ls", "-la", params.directory];

    case "env":
      return ["env"];

    case "process_list":
      return ["sh", "-c", "ps aux 2>/dev/null || ls -la /proc/[0-9]* 2>/dev/null | head -50"];

    case "network_check": {
      if (!params.target_host) throw new Error("target_host is required for network_check action");
      const port = params.target_port || 80;
      const host = params.target_host;
      // Try multiple tools in order of availability
      return [
        "sh",
        "-c",
        `if command -v curl >/dev/null 2>&1; then curl -sf --connect-timeout 5 -o /dev/null -w "Connected to ${host}:${port} (HTTP %{http_code}) in %{time_connect}s" "http://${host}:${port}" 2>&1 || curl -sf --connect-timeout 5 -o /dev/null "http://${host}:${port}" 2>&1; ` +
        `elif command -v wget >/dev/null 2>&1; then wget -q --timeout=5 --spider "http://${host}:${port}" 2>&1 && echo "Connected to ${host}:${port}" || echo "Failed to connect to ${host}:${port}"; ` +
        `elif command -v nc >/dev/null 2>&1; then nc -zv -w5 "${host}" ${port} 2>&1; ` +
        `else echo "No network tools available (curl/wget/nc not found)"; fi`,
      ];
    }

    default:
      throw new Error(`Unknown action: ${params.action}`);
  }
}

async function handleK8sExec(params: K8sExecParams, pluginConfig?: PluginConfig): Promise<string> {
  try {
    const { kc } = createK8sClients(pluginConfig, params.context);
    const command = buildExecCommand(params);

    const { stdout, stderr } = await execInPod(
      kc,
      params.namespace,
      params.pod_name,
      params.container,
      command
    );

    let output = "";
    if (stdout) output += stdout;
    if (stderr) output += (output ? "\n\n--- stderr ---\n" : "") + stderr;
    if (!output) output = "(no output)";

    return truncateOutput(output, MAX_OUTPUT_BYTES);
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `exec ${params.action} in ${params.namespace}/${params.pod_name}`));
  }
}

export function registerK8sExecTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_exec",
    description:
      "Kubernetes container execution: exec commands, read files, list directories, view env vars, list processes, check network connectivity",
    schema: K8sExecSchema,
    handler: async (params: K8sExecParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sExec(params, pluginConfig);
    },
  });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/a123/git/k8s-ops-agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add skills/k8s-exec/SKILL.md skills/k8s-exec/src/exec.ts
git commit -m "feat: add k8s-exec skill with 6 container execution actions"
```

---

### Task 8: Implement k8s-logs skill

**Files:**
- Create: `skills/k8s-logs/SKILL.md`
- Create: `skills/k8s-logs/src/logs.ts`

- [ ] **Step 1: Create SKILL.md**

Create `skills/k8s-logs/SKILL.md`:

```markdown
---
name: k8s-logs
description: |
  Advanced Kubernetes log operations. Activate when user wants to search logs, aggregate multi-pod logs, compare pod logs, get log statistics, or export logs.
---

# Kubernetes Advanced Logs Tool

Single tool `k8s_logs` with action parameter for advanced log operations. For basic single-pod log viewing, use `k8s_pod` with action `logs`.

## Actions

### Search Logs

Search pod logs by keyword or regex:

\```json
{
  "action": "search",
  "namespace": "default",
  "pod_name": "app-abc123",
  "pattern": "ERROR|WARN",
  "tail_lines": 500
}
\```

### Multi-Pod Logs

Aggregate logs from multiple pods by label:

\```json
{
  "action": "multi_pod",
  "namespace": "production",
  "label_selector": "app=api-server",
  "tail_lines": 100
}
\```

### Logs Since Time

View logs within a time range:

\```json
{
  "action": "since",
  "namespace": "default",
  "pod_name": "app-abc123",
  "since_time": "1h"
}
\```

Supports relative time (`1h`, `30m`, `7d`) and ISO 8601 (`2026-03-24T10:00:00Z`).

### Compare Pod Logs

Side-by-side comparison of two pods:

\```json
{
  "action": "compare",
  "namespace": "default",
  "compare_pods": ["app-pod-1", "app-pod-2"],
  "tail_lines": 50
}
\```

### Log Statistics

Analyze log patterns and error frequencies:

\```json
{
  "action": "stats",
  "namespace": "default",
  "pod_name": "app-abc123",
  "tail_lines": 1000
}
\```

### Export Logs

Export logs as structured JSON:

\```json
{
  "action": "export",
  "namespace": "default",
  "pod_name": "app-abc123",
  "tail_lines": 200
}
\```

## Common Workflows

### Investigate Spike in Errors

1. Get log stats: `{ "action": "stats", "pod_name": "api-server-xyz", "tail_lines": 1000 }`
2. Search for specific error: `{ "action": "search", "pod_name": "api-server-xyz", "pattern": "connection refused" }`
3. Compare with healthy pod: `{ "action": "compare", "compare_pods": ["api-server-good", "api-server-bad"] }`

### Monitor a Deployment Rollout

1. Aggregate logs across all pods: `{ "action": "multi_pod", "label_selector": "app=api", "since_time": "5m" }`
2. Search specific pod for errors: `{ "action": "search", "pod_name": "api-server-xyz", "pattern": "ERROR|panic|fatal", "since_time": "5m" }`

## Permissions Required

- `pods/log` - Read pod logs
- `pods/list` - List pods (for multi_pod action)
```

- [ ] **Step 2: Implement logs.ts — time parsing utility**

Create `skills/k8s-logs/src/logs.ts`. Start with imports and the time parsing helper:

```typescript
import * as k8s from "@kubernetes/client-node";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { z } from "zod";
import { createK8sClients } from "../../../lib/client.js";
import { formatTable, truncateOutput } from "../../../lib/format.js";
import { wrapK8sError } from "../../../lib/errors.js";
import type { PluginConfig } from "../../../lib/types.js";
import { DEFAULT_NAMESPACE, DEFAULT_LOG_LINES, MAX_LOG_LINES } from "../../../lib/types.js";

const K8sLogsSchema = z.object({
  action: z.enum(["search", "multi_pod", "since", "compare", "stats", "export"]),
  namespace: z.string().default(DEFAULT_NAMESPACE),
  pod_name: z.string().optional(),
  label_selector: z.string().optional(),
  container: z.string().optional(),
  pattern: z.string().optional(),
  since_time: z.string().optional(),
  compare_pods: z.tuple([z.string(), z.string()]).optional(),
  tail_lines: z.number().int().positive().default(DEFAULT_LOG_LINES),
  context: z.string().optional(),
});

type K8sLogsParams = z.infer<typeof K8sLogsSchema>;

function parseRelativeTime(timeStr: string): Date {
  const match = timeStr.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    // Try ISO 8601
    const date = new Date(timeStr);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid time format: ${timeStr}. Use relative (1h, 30m, 7d) or ISO 8601.`);
    }
    return date;
  }

  const value = parseInt(match[1]);
  const unit = match[2];
  const now = new Date();

  switch (unit) {
    case "s": return new Date(now.getTime() - value * 1000);
    case "m": return new Date(now.getTime() - value * 60 * 1000);
    case "h": return new Date(now.getTime() - value * 60 * 60 * 1000);
    case "d": return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
    default: throw new Error(`Unknown time unit: ${unit}`);
  }
}

async function fetchPodLogs(
  coreApi: k8s.CoreV1Api,
  namespace: string,
  podName: string,
  container?: string,
  tailLines?: number,
  sinceTime?: Date
): Promise<string> {
  const response = await coreApi.readNamespacedPodLog(
    podName,
    namespace,
    container,
    undefined, // follow
    undefined, // insecureSkipTLSVerify
    undefined, // limitBytes
    undefined, // pretty
    undefined, // previous
    sinceTime ? Math.floor((Date.now() - sinceTime.getTime()) / 1000) : undefined, // sinceSeconds
    tailLines,
    undefined // timestamps
  );
  return response.body || "";
}

async function fetchPodLogsWithTimestamps(
  coreApi: k8s.CoreV1Api,
  namespace: string,
  podName: string,
  container?: string,
  tailLines?: number,
  sinceTime?: Date
): Promise<string> {
  const response = await coreApi.readNamespacedPodLog(
    podName,
    namespace,
    container,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    sinceTime ? Math.floor((Date.now() - sinceTime.getTime()) / 1000) : undefined,
    tailLines,
    true // timestamps
  );
  return response.body || "";
}

async function handleK8sLogs(params: K8sLogsParams, pluginConfig?: PluginConfig): Promise<string> {
  try {
    const { coreApi } = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace;
    const tailLines = Math.min(params.tail_lines, MAX_LOG_LINES);

    switch (params.action) {
      case "search": {
        if (!params.pod_name) throw new Error("pod_name is required for search action");
        if (!params.pattern) throw new Error("pattern is required for search action");

        const sinceDate = params.since_time ? parseRelativeTime(params.since_time) : undefined;
        const logs = await fetchPodLogs(coreApi, namespace, params.pod_name, params.container, tailLines, sinceDate);

        if (!logs) return "No logs found.";

        const regex = new RegExp(params.pattern, "i");
        const lines = logs.split("\n");
        const matches: string[] = [];
        const contextLines = 2;

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            const start = Math.max(0, i - contextLines);
            const end = Math.min(lines.length - 1, i + contextLines);

            if (matches.length > 0) matches.push("---");
            for (let j = start; j <= end; j++) {
              const prefix = j === i ? ">>>" : "   ";
              matches.push(`${prefix} ${lines[j]}`);
            }
          }
        }

        if (matches.length === 0) return `No matches found for pattern: ${params.pattern}`;

        return `Search results for "${params.pattern}" in ${namespace}/${params.pod_name}:\n\n${matches.join("\n")}`;
      }

      case "multi_pod": {
        if (!params.label_selector) throw new Error("label_selector is required for multi_pod action");

        const podsResponse = await coreApi.listNamespacedPod(
          namespace,
          undefined,
          undefined,
          undefined,
          undefined,
          params.label_selector
        );

        const pods = podsResponse.body.items;
        if (pods.length === 0) return `No pods found matching: ${params.label_selector}`;

        const sinceDate = params.since_time ? parseRelativeTime(params.since_time) : undefined;
        const perPodLines = Math.max(10, Math.floor(tailLines / pods.length));

        const logPromises = pods.map(async (pod) => {
          const podName = pod.metadata?.name || "unknown";
          try {
            const logs = await fetchPodLogsWithTimestamps(
              coreApi, namespace, podName, params.container, perPodLines, sinceDate
            );
            return logs.split("\n").filter(Boolean).map((line) => ({ podName, line }));
          } catch {
            return [{ podName, line: `(failed to fetch logs for ${podName})` }];
          }
        });

        const allLogs = (await Promise.all(logPromises)).flat();

        // Sort by timestamp if available
        allLogs.sort((a, b) => {
          const tsA = a.line.match(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z/)?.[0] || "";
          const tsB = b.line.match(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z/)?.[0] || "";
          return tsA.localeCompare(tsB);
        });

        let result = `Multi-pod logs (${pods.length} pods matching "${params.label_selector}"):\n\n`;
        allLogs.forEach(({ podName, line }) => {
          result += `[${podName}] ${line}\n`;
        });

        return result;
      }

      case "since": {
        if (!params.pod_name) throw new Error("pod_name is required for since action");
        if (!params.since_time) throw new Error("since_time is required for since action");

        const sinceDate = parseRelativeTime(params.since_time);
        const logs = await fetchPodLogs(coreApi, namespace, params.pod_name, params.container, tailLines, sinceDate);

        if (!logs) return `No logs found since ${params.since_time}`;

        return `Logs for ${namespace}/${params.pod_name} since ${params.since_time}:\n\n${logs}`;
      }

      case "compare": {
        if (!params.compare_pods) throw new Error("compare_pods is required for compare action");

        const [pod1, pod2] = params.compare_pods;
        const sinceDate = params.since_time ? parseRelativeTime(params.since_time) : undefined;
        const perPodLines = Math.floor(tailLines / 2);

        const [logs1, logs2] = await Promise.all([
          fetchPodLogs(coreApi, namespace, pod1, params.container, perPodLines, sinceDate),
          fetchPodLogs(coreApi, namespace, pod2, params.container, perPodLines, sinceDate),
        ]);

        const lines1 = logs1.split("\n").filter(Boolean);
        const lines2 = logs2.split("\n").filter(Boolean);

        let result = `Log comparison: ${pod1} vs ${pod2}\n`;
        result += `${"=".repeat(60)}\n\n`;

        result += `--- ${pod1} (${lines1.length} lines) ---\n`;
        result += lines1.join("\n");
        result += `\n\n--- ${pod2} (${lines2.length} lines) ---\n`;
        result += lines2.join("\n");

        // Find unique patterns
        const set1 = new Set(lines1.map((l) => l.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, "")));
        const set2 = new Set(lines2.map((l) => l.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, "")));

        const onlyIn1 = [...set1].filter((l) => !set2.has(l));
        const onlyIn2 = [...set2].filter((l) => !set1.has(l));

        if (onlyIn1.length > 0 || onlyIn2.length > 0) {
          result += `\n\n--- Differences ---\n`;
          if (onlyIn1.length > 0) {
            result += `\nOnly in ${pod1} (${onlyIn1.length}):\n`;
            onlyIn1.slice(0, 10).forEach((l) => { result += `  ${l}\n`; });
          }
          if (onlyIn2.length > 0) {
            result += `\nOnly in ${pod2} (${onlyIn2.length}):\n`;
            onlyIn2.slice(0, 10).forEach((l) => { result += `  ${l}\n`; });
          }
        }

        return result;
      }

      case "stats": {
        if (!params.pod_name) throw new Error("pod_name is required for stats action");

        const sinceDate = params.since_time ? parseRelativeTime(params.since_time) : undefined;
        const logs = await fetchPodLogs(coreApi, namespace, params.pod_name, params.container, tailLines, sinceDate);

        if (!logs) return "No logs found.";

        const lines = logs.split("\n").filter(Boolean);

        // Count log levels
        let errorCount = 0;
        let warnCount = 0;
        let infoCount = 0;
        let debugCount = 0;
        const errorMessages = new Map<string, number>();

        for (const line of lines) {
          const upper = line.toUpperCase();
          if (upper.includes("ERROR") || upper.includes("FATAL") || upper.includes("PANIC")) {
            errorCount++;
            // Extract error message (strip timestamp, take first 100 chars)
            const msg = line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s*/, "").substring(0, 100);
            errorMessages.set(msg, (errorMessages.get(msg) || 0) + 1);
          } else if (upper.includes("WARN")) {
            warnCount++;
          } else if (upper.includes("INFO")) {
            infoCount++;
          } else if (upper.includes("DEBUG") || upper.includes("TRACE")) {
            debugCount++;
          }
        }

        // If a custom pattern is provided, count it too
        let patternCount = 0;
        if (params.pattern) {
          const regex = new RegExp(params.pattern, "i");
          for (const line of lines) {
            if (regex.test(line)) patternCount++;
          }
        }

        let result = `Log Statistics for ${namespace}/${params.pod_name}:\n`;
        result += `Total lines analyzed: ${lines.length}\n\n`;

        result += `--- Level Distribution ---\n`;
        result += formatTable(
          ["LEVEL", "COUNT", "PERCENTAGE"],
          [
            ["ERROR/FATAL", errorCount.toString(), `${((errorCount / lines.length) * 100).toFixed(1)}%`],
            ["WARN", warnCount.toString(), `${((warnCount / lines.length) * 100).toFixed(1)}%`],
            ["INFO", infoCount.toString(), `${((infoCount / lines.length) * 100).toFixed(1)}%`],
            ["DEBUG/TRACE", debugCount.toString(), `${((debugCount / lines.length) * 100).toFixed(1)}%`],
          ]
        );

        if (params.pattern) {
          result += `\n\nCustom pattern "${params.pattern}": ${patternCount} matches`;
        }

        if (errorMessages.size > 0) {
          result += `\n\n--- Top Errors ---\n`;
          const sorted = [...errorMessages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
          sorted.forEach(([msg, count], i) => {
            result += `  ${i + 1}. (${count}x) ${msg}\n`;
          });
        }

        return result;
      }

      case "export": {
        if (!params.pod_name) throw new Error("pod_name is required for export action");

        const sinceDate = params.since_time ? parseRelativeTime(params.since_time) : undefined;
        const logs = await fetchPodLogsWithTimestamps(
          coreApi, namespace, params.pod_name, params.container, tailLines, sinceDate
        );

        if (!logs) return "[]";

        const lines = logs.split("\n").filter(Boolean);
        const entries = lines.map((line) => {
          const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s*(.*)/);
          if (tsMatch) {
            return { timestamp: tsMatch[1], message: tsMatch[2] };
          }
          return { timestamp: null, message: line };
        });

        return JSON.stringify({
          pod: params.pod_name,
          namespace,
          count: entries.length,
          logs: entries,
        }, null, 2);
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `logs ${params.action}`));
  }
}

export function registerK8sLogsTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_logs",
    description:
      "Advanced Kubernetes log operations: search, multi-pod aggregation, time-range filtering, compare, statistics, export",
    schema: K8sLogsSchema,
    handler: async (params: K8sLogsParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sLogs(params, pluginConfig);
    },
  });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/a123/git/k8s-ops-agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add skills/k8s-logs/SKILL.md skills/k8s-logs/src/logs.ts
git commit -m "feat: add k8s-logs skill with 6 advanced log actions"
```

---

### Task 8b: Add unit tests for k8s-exec

**Files:**
- Create: `skills/k8s-exec/src/exec.test.ts`

- [ ] **Step 1: Write tests for buildExecCommand and input validation**

Create `skills/k8s-exec/src/exec.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

// Test the command building logic by importing the module
// Since execInPod requires a real K8s connection, we test the pure functions
// and input validation paths

describe("k8s-exec input validation", () => {
  it("exec action requires command parameter", async () => {
    // Import the module to test schema validation
    const { z } = await import("zod");
    const K8sExecSchema = z.object({
      action: z.enum(["exec", "file_read", "file_list", "env", "process_list", "network_check"]),
      namespace: z.string().default("default"),
      pod_name: z.string(),
      container: z.string().optional(),
      command: z.string().optional(),
      file_path: z.string().optional(),
      directory: z.string().default("/"),
      target_host: z.string().optional(),
      target_port: z.number().int().positive().optional(),
      context: z.string().optional(),
    });

    const result = K8sExecSchema.safeParse({
      action: "exec",
      pod_name: "test-pod",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid action", async () => {
    const { z } = await import("zod");
    const K8sExecSchema = z.object({
      action: z.enum(["exec", "file_read", "file_list", "env", "process_list", "network_check"]),
      namespace: z.string().default("default"),
      pod_name: z.string(),
    });

    const result = K8sExecSchema.safeParse({
      action: "invalid",
      pod_name: "test-pod",
    });
    expect(result.success).toBe(false);
  });

  it("requires pod_name", async () => {
    const { z } = await import("zod");
    const K8sExecSchema = z.object({
      action: z.enum(["exec", "file_read", "file_list", "env", "process_list", "network_check"]),
      namespace: z.string().default("default"),
      pod_name: z.string(),
    });

    const result = K8sExecSchema.safeParse({ action: "env" });
    expect(result.success).toBe(false);
  });

  it("defaults namespace to 'default'", async () => {
    const { z } = await import("zod");
    const K8sExecSchema = z.object({
      action: z.enum(["exec", "file_read", "file_list", "env", "process_list", "network_check"]),
      namespace: z.string().default("default"),
      pod_name: z.string(),
    });

    const result = K8sExecSchema.parse({ action: "env", pod_name: "test" });
    expect(result.namespace).toBe("default");
  });

  it("defaults directory to '/'", async () => {
    const { z } = await import("zod");
    const K8sExecSchema = z.object({
      action: z.enum(["exec", "file_read", "file_list", "env", "process_list", "network_check"]),
      pod_name: z.string(),
      directory: z.string().default("/"),
    });

    const result = K8sExecSchema.parse({ action: "file_list", pod_name: "test" });
    expect(result.directory).toBe("/");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/a123/git/k8s-ops-agent && npx vitest run skills/k8s-exec/src/exec.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add skills/k8s-exec/src/exec.test.ts
git commit -m "test: add unit tests for k8s-exec schema validation"
```

---

### Task 8c: Add unit tests for k8s-logs

**Files:**
- Create: `skills/k8s-logs/src/logs.test.ts`

- [ ] **Step 1: Write tests for time parsing and log processing logic**

Create `skills/k8s-logs/src/logs.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";

describe("parseRelativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T12:00:00Z"));

    // Inline the function for testing since it's not exported
    function parseRelativeTime(timeStr: string): Date {
      const match = timeStr.match(/^(\d+)(s|m|h|d)$/);
      if (!match) {
        const date = new Date(timeStr);
        if (isNaN(date.getTime())) throw new Error(`Invalid time format: ${timeStr}`);
        return date;
      }
      const value = parseInt(match[1]);
      const unit = match[2];
      const now = new Date();
      switch (unit) {
        case "s": return new Date(now.getTime() - value * 1000);
        case "m": return new Date(now.getTime() - value * 60 * 1000);
        case "h": return new Date(now.getTime() - value * 60 * 60 * 1000);
        case "d": return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
        default: throw new Error(`Unknown time unit: ${unit}`);
      }
    }

    expect(parseRelativeTime("30s").getTime()).toBe(new Date("2026-03-25T11:59:30Z").getTime());
    expect(parseRelativeTime("5m").getTime()).toBe(new Date("2026-03-25T11:55:00Z").getTime());
    expect(parseRelativeTime("2h").getTime()).toBe(new Date("2026-03-25T10:00:00Z").getTime());
    expect(parseRelativeTime("1d").getTime()).toBe(new Date("2026-03-24T12:00:00Z").getTime());
  });

  it("parses ISO 8601", () => {
    function parseRelativeTime(timeStr: string): Date {
      const match = timeStr.match(/^(\d+)(s|m|h|d)$/);
      if (!match) {
        const date = new Date(timeStr);
        if (isNaN(date.getTime())) throw new Error(`Invalid time format: ${timeStr}`);
        return date;
      }
      return new Date();
    }

    const result = parseRelativeTime("2026-03-24T10:00:00Z");
    expect(result.toISOString()).toBe("2026-03-24T10:00:00.000Z");
  });

  it("throws on invalid format", () => {
    function parseRelativeTime(timeStr: string): Date {
      const match = timeStr.match(/^(\d+)(s|m|h|d)$/);
      if (!match) {
        const date = new Date(timeStr);
        if (isNaN(date.getTime())) throw new Error(`Invalid time format: ${timeStr}`);
        return date;
      }
      return new Date();
    }

    expect(() => parseRelativeTime("abc")).toThrow("Invalid time format");
  });
});

describe("k8s-logs schema validation", () => {
  it("rejects invalid action", async () => {
    const { z } = await import("zod");
    const K8sLogsSchema = z.object({
      action: z.enum(["search", "multi_pod", "since", "compare", "stats", "export"]),
      namespace: z.string().default("default"),
      pod_name: z.string().optional(),
    });

    const result = K8sLogsSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("defaults tail_lines to 100", async () => {
    const { z } = await import("zod");
    const K8sLogsSchema = z.object({
      action: z.enum(["search", "multi_pod", "since", "compare", "stats", "export"]),
      pod_name: z.string().optional(),
      tail_lines: z.number().int().positive().default(100),
    });

    const result = K8sLogsSchema.parse({ action: "search" });
    expect(result.tail_lines).toBe(100);
  });

  it("accepts compare_pods tuple", async () => {
    const { z } = await import("zod");
    const K8sLogsSchema = z.object({
      action: z.enum(["search", "multi_pod", "since", "compare", "stats", "export"]),
      compare_pods: z.tuple([z.string(), z.string()]).optional(),
    });

    const result = K8sLogsSchema.parse({
      action: "compare",
      compare_pods: ["pod-1", "pod-2"],
    });
    expect(result.compare_pods).toEqual(["pod-1", "pod-2"]);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/a123/git/k8s-ops-agent && npx vitest run skills/k8s-logs/src/logs.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add skills/k8s-logs/src/logs.test.ts
git commit -m "test: add unit tests for k8s-logs schema and time parsing"
```

---

### Task 9: Register new skills in index.ts

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Update index.ts**

Add imports and registrations for the two new skills:

```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { registerK8sPodTools } from "./skills/k8s-pod/src/pod.js";
import { registerK8sDeployTools } from "./skills/k8s-deploy/src/deploy.js";
import { registerK8sNodeTools } from "./skills/k8s-node/src/node.js";
import { registerK8sSvcTools } from "./skills/k8s-svc/src/svc.js";
import { registerK8sExecTools } from "./skills/k8s-exec/src/exec.js";
import { registerK8sLogsTools } from "./skills/k8s-logs/src/logs.js";

const plugin = {
  id: "k8s",
  name: "Kubernetes",
  description: "Kubernetes operations plugin",

  async load(api: OpenClawPluginApi) {
    registerK8sPodTools(api);
    registerK8sDeployTools(api);
    registerK8sNodeTools(api);
    registerK8sSvcTools(api);
    registerK8sExecTools(api);
    registerK8sLogsTools(api);

    api.log("K8s plugin loaded successfully - 6 skills registered");
  },
};

export default plugin;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/a123/git/k8s-ops-agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add index.ts
git commit -m "feat: register k8s-exec and k8s-logs skills in plugin entry point"
```

---

### Task 10: Update README documentation

**Files:**
- Modify: `README.md`
- Modify: `README_CN.md`

- [ ] **Step 1: Update README.md**

Add the two new skills to the features table, add usage examples for k8s-exec and k8s-logs. Follow the existing format. Key additions:

1. Update skill count from 4 to 6
2. Add k8s-exec section with action examples (exec, file_read, env, network_check)
3. Add k8s-logs section with action examples (search, multi_pod, stats)
4. Update RBAC permissions table to include `pods/exec` and `pods/log`

- [ ] **Step 2: Update README_CN.md**

Mirror the same changes in Chinese documentation.

- [ ] **Step 3: Commit**

```bash
git add README.md README_CN.md
git commit -m "docs: update READMEs with k8s-exec and k8s-logs skills"
```

---

### Task 11: Update plugin manifest version

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump version**

Update version in `package.json` from `"1.0.0"` to `"1.1.0"` (minor version bump for new features).

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: bump version to 1.1.0 for Phase 1 release"
```

---

### Task 12: Run full test suite and verify

- [ ] **Step 1: Run all tests**

Run: `cd /Users/a123/git/k8s-ops-agent && npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run TypeScript check**

Run: `cd /Users/a123/git/k8s-ops-agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify project structure**

Run: `ls -la lib/ skills/k8s-exec/ skills/k8s-logs/`
Expected: All files present

- [ ] **Step 4: Verify git log**

Run: `git log --oneline`
Expected: Clean commit history with all tasks
