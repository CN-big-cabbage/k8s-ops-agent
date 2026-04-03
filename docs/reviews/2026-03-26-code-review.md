# Code Review Report

Date: 2026-03-26
Repository: `k8s-ops-agent`
Reviewer: Codex

## Scope

This review focused on static analysis of the repository structure, shared library layer, representative high-risk tool implementations, and the current test suite.

Reviewed areas:

- `index.ts`
- `lib/`
- `skills/k8s-exec`
- `skills/k8s-config`
- `skills/k8s-logs`
- `skills/k8s-metrics`
- `skills/k8s-events`
- `skills/k8s-pod`
- `skills/k8s-deploy`
- `skills/k8s-ingress`
- `skills/k8s-storage`
- `skills/k8s-portforward`
- existing `vitest` test files

## Project Summary

This repository is an OpenClaw Kubernetes plugin. The entrypoint is `index.ts`, which registers 14 Kubernetes-oriented tools. The overall structure is consistent:

- shared client, formatting, and error wrapping live under `lib/`
- each skill module follows a similar pattern: `zod` schema, handler, register function
- the codebase is easy to scan and extend because the module boundaries are clear

The main weaknesses are not in layout or readability. They are in:

- security boundaries for dangerous operations
- sensitive data exposure
- correctness of some write/update behaviors
- effectiveness of the current tests as regression protection

## Findings

### 1. High Risk: command injection in `k8s_exec.network_check`

File:
- [skills/k8s-exec/src/exec.ts](/Users/pangxubin/git/k8s-ops-agent/skills/k8s-exec/src/exec.ts#L102)

Problem:

`target_host` is interpolated directly into a `sh -c` command string. That means an input intended to represent a hostname can alter the executed shell command inside the container.

Why this matters:

- this turns a connectivity check into a shell execution surface
- shell metacharacters, command substitution, or quote-breaking input can trigger unintended commands
- the risk is especially important in any LLM-driven toolchain where user intent is mediated indirectly

Impact:

- unintended command execution inside target containers
- privilege and blast radius depend on the target pod/container

Recommendation:

- do not build this action with `sh -c` using raw input
- validate `target_host` and `target_port` strictly
- prefer direct argument invocation for `nc`, `curl`, or another safe primitive

### 2. High Risk: `describe_secret` exposes Secret values in plaintext

File:
- [skills/k8s-config/src/config.ts](/Users/pangxubin/git/k8s-ops-agent/skills/k8s-config/src/config.ts#L103)

Related behavior:
- [skills/k8s-config/src/config.ts](/Users/pangxubin/git/k8s-ops-agent/skills/k8s-config/src/config.ts#L233)

Problem:

`formatSecretDescribe` decodes and prints Secret data values directly. In the same module, `get_secret_data` masks values when no specific key is requested. Those two behaviors conflict.

Why this matters:

- a low-friction "describe" action can leak credentials, tokens, or certificates
- plaintext values can propagate into chat transcripts, logs, agent memory, or observability systems

Impact:

- accidental disclosure of production credentials
- inconsistent operator expectations across similar actions

Recommendation:

- make `describe_secret` metadata-only by default
- show keys, counts, types, and maybe value lengths, but not decoded values
- require an explicit, narrow action to reveal a specific key

### 3. Medium Risk: `k8s_pod.restart` is actually delete-based and can be destructive

File:
- [skills/k8s-pod/src/pod.ts](/Users/pangxubin/git/k8s-ops-agent/skills/k8s-pod/src/pod.ts#L231)

Problem:

The implementation deletes the pod and returns a message claiming it will be recreated by its controller.

Why this matters:

- that assumption is only true when a controller actually owns the pod
- for standalone pods or certain operational cases, the pod may simply disappear

Impact:

- operators can believe they are performing a safe restart when they are actually deleting a workload

Recommendation:

- make the response explicit that this is a delete-based restart
- check `ownerReferences` before executing
- reject or warn when no controller is present

### 4. Medium Risk: Ingress update breaks named service ports

File:
- [skills/k8s-ingress/src/ingress.ts](/Users/pangxubin/git/k8s-ops-agent/skills/k8s-ingress/src/ingress.ts#L254)

Problem:

The schema allows `service_port` to be either `number` or `string`, but the implementation maps string input to `80` instead of preserving it as a named port.

Why this matters:

- named ports are common in Kubernetes service definitions
- a valid existing config can be silently rewritten into an incorrect backend mapping

Impact:

- broken routing after ingress update
- silent behavioral regression that may be hard to diagnose

Recommendation:

- if `service_port` is numeric, write `port.number`
- if `service_port` is string, write `port.name`
- never coerce string values to `80`

### 5. Medium Risk: several tests validate duplicated logic instead of production code

Files:
- [skills/k8s-exec/src/exec.test.ts](/Users/pangxubin/git/k8s-ops-agent/skills/k8s-exec/src/exec.test.ts)
- [skills/k8s-logs/src/logs.test.ts](/Users/pangxubin/git/k8s-ops-agent/skills/k8s-logs/src/logs.test.ts)

Problem:

Multiple tests re-declare schemas or helper logic inline instead of importing the real implementation from the module under test.

Why this matters:

- the tests can continue passing even when production logic changes or breaks
- this creates false confidence about regression coverage

Impact:

- poor protection against behavior drift
- harder maintenance because the test suite can diverge from reality

Recommendation:

- export pure helper functions and schemas where needed
- import actual production logic in tests
- add handler-level tests using mocks for Kubernetes clients

## Additional Observations

- [lib/client.ts](/Users/pangxubin/git/k8s-ops-agent/lib/client.ts) is intentionally lightweight and easy to understand, but it currently has no cache invalidation or client recovery strategy.
- The codebase includes multiple write-capable operations such as delete, update, create, exec, and secret access, but there is no unified risk classification or confirmation model.
- Output handling is inconsistent across modules. Some paths truncate output, some do not, and sensitive data treatment varies by tool.

## Test Status

Dynamic verification was not completed in this review session.

Attempted command:

```bash
npm test
```

Observed result:

```text
sh: vitest: command not found
```

Reason:

- `node_modules` is not installed in the current workspace, so the configured test runner is unavailable

## Suggested Discussion Topics

1. Define the plugin security model.
   Is this plugin intended only for trusted operators, or should it defensively handle indirect or LLM-mediated input?

2. Define a risk model for operations.
   It would help to classify actions like `exec`, `delete`, `update`, `port-forward`, and `get_secret_data` as high-risk and decide how they should be gated.

3. Normalize secret handling.
   The repository should settle on one default rule for whether secrets are ever shown in plaintext, and under what explicit conditions.

4. Rework tests to protect real behavior.
   The fastest improvement would be to export testable units from production modules and eliminate inline duplicate logic in tests.

## Recommended Next Steps

Priority order:

1. Fix `k8s_exec.network_check` to eliminate shell injection risk.
2. Remove plaintext exposure from `describe_secret`.
3. Correct `k8s_ingress.update` to preserve named service ports.
4. Change `k8s_pod.restart` semantics or messaging to reflect real behavior.
5. Rebuild the most misleading tests so they validate production code directly.
