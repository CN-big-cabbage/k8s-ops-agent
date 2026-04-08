import * as k8s from "@kubernetes/client-node";
import { z } from "zod";
import { createK8sClients } from "../lib/client.js";
import { formatTable } from "../lib/format.js";
import { wrapK8sError } from "../lib/errors.js";
import type { PluginConfig } from "../lib/types.js";

export const K8sSecuritySchema = z.object({
  action: z.enum([
    "scan_namespace",
    "check_psa",
    "secret_audit",
    "image_audit",
    "privileged_pods",
  ]),
  namespace: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  label_selector: z.string().optional(),
  context: z.string().optional(),
});

export type K8sSecurityParams = z.infer<typeof K8sSecuritySchema>;

// --- PSA Check helpers ---

interface PSAViolation {
  check: string;
  level: string;
}

function checkPSACompliance(pod: k8s.V1Pod): {
  level: string;
  violations: PSAViolation[];
} {
  const violations: PSAViolation[] = [];
  const spec = pod.spec;
  if (!spec) return { level: "restricted", violations: [] };

  const allContainers = [
    ...(spec.containers || []),
    ...(spec.initContainers || []),
  ];

  const secCtx = spec.securityContext;

  // Privileged level checks
  if (spec.hostPID) violations.push({ check: "hostPID=true", level: "privileged" });
  if (spec.hostIPC) violations.push({ check: "hostIPC=true", level: "privileged" });
  if (spec.hostNetwork) violations.push({ check: "hostNetwork=true", level: "privileged" });

  for (const c of allContainers) {
    const csc = c.securityContext;
    if (csc?.privileged) {
      violations.push({ check: `container ${c.name}: privileged=true`, level: "privileged" });
    }

    // Baseline level checks
    const caps = csc?.capabilities?.add || [];
    const dangerousCaps = caps.filter(
      (cap) => !["NET_BIND_SERVICE"].includes(cap)
    );
    if (dangerousCaps.length > 0) {
      violations.push({
        check: `container ${c.name}: non-default capabilities [${dangerousCaps.join(",")}]`,
        level: "baseline",
      });
    }

    if (csc?.allowPrivilegeEscalation !== false) {
      violations.push({
        check: `container ${c.name}: allowPrivilegeEscalation not explicitly false`,
        level: "restricted",
      });
    }

    // Restricted level checks
    if (csc?.runAsNonRoot !== true && secCtx?.runAsNonRoot !== true) {
      violations.push({
        check: `container ${c.name}: runAsNonRoot not set`,
        level: "restricted",
      });
    }

    if (!csc?.readOnlyRootFilesystem) {
      violations.push({
        check: `container ${c.name}: readOnlyRootFilesystem not set`,
        level: "restricted",
      });
    }

    const dropAll = (csc?.capabilities?.drop || []).includes("ALL");
    if (!dropAll) {
      violations.push({
        check: `container ${c.name}: capabilities.drop does not include ALL`,
        level: "restricted",
      });
    }

    if (!csc?.seccompProfile && !secCtx?.seccompProfile) {
      violations.push({
        check: `container ${c.name}: no seccompProfile`,
        level: "restricted",
      });
    }
  }

  // Check hostPath volumes (baseline)
  for (const vol of spec.volumes || []) {
    if (vol.hostPath) {
      violations.push({ check: `volume ${vol.name}: hostPath`, level: "baseline" });
    }
  }

  // Determine effective level
  let level = "restricted";
  if (violations.some((v) => v.level === "privileged")) {
    level = "privileged";
  } else if (violations.some((v) => v.level === "baseline")) {
    level = "baseline";
  }

  return { level, violations };
}

function formatPSACheck(
  results: Array<{ pod: string; level: string; violations: string[] }>
): string {
  if (results.length === 0) return "No pods found.";

  const headers = ["POD", "LEVEL", "VIOLATIONS"];
  const rows = results.map((r) => [
    r.pod,
    r.level,
    r.violations.length > 0 ? r.violations.join("; ") : "(compliant)",
  ]);
  return formatTable(headers, rows);
}

// --- Secret Audit helpers ---

interface SecretAuditEntry {
  secret: string;
  namespace: string;
  referencedBy: string;
  status: string;
}

function findSecretReferences(
  secretName: string,
  secretNamespace: string,
  pods: k8s.V1Pod[]
): string[] {
  const refs: string[] = [];

  for (const pod of pods) {
    if (pod.metadata?.namespace !== secretNamespace) continue;
    const podName = pod.metadata?.name || "unknown";

    // Check volumes
    for (const vol of pod.spec?.volumes || []) {
      if (vol.secret?.secretName === secretName) {
        refs.push(podName);
        break;
      }
    }

    // Check envFrom
    for (const c of [...(pod.spec?.containers || []), ...(pod.spec?.initContainers || [])]) {
      for (const envFrom of c.envFrom || []) {
        if (envFrom.secretRef?.name === secretName) {
          if (!refs.includes(podName)) refs.push(podName);
        }
      }
      // Check env valueFrom
      for (const env of c.env || []) {
        if (env.valueFrom?.secretKeyRef?.name === secretName) {
          if (!refs.includes(podName)) refs.push(podName);
        }
      }
    }

    // Check imagePullSecrets
    for (const ips of pod.spec?.imagePullSecrets || []) {
      if (ips.name === secretName) {
        if (!refs.includes(podName)) refs.push(podName);
      }
    }
  }

  return refs;
}

function formatSecretAudit(entries: SecretAuditEntry[]): string {
  if (entries.length === 0) return "No secrets found.";

  const headers = ["SECRET", "NAMESPACE", "REFERENCED-BY", "STATUS"];
  const rows = entries.map((e) => [e.secret, e.namespace, e.referencedBy, e.status]);
  return formatTable(headers, rows);
}

// --- Image Audit helpers ---

interface ImageIssue {
  pod: string;
  container: string;
  image: string;
  issues: string[];
}

function auditImage(image: string): string[] {
  const issues: string[] = [];

  if (image.endsWith(":latest") || !image.includes(":")) {
    issues.push("uses :latest or no tag");
  }

  if (!image.includes("/")) {
    issues.push("no registry prefix");
  }

  return issues;
}

function formatImageAudit(entries: ImageIssue[]): string {
  if (entries.length === 0) return "No image issues found.";

  const headers = ["POD", "CONTAINER", "IMAGE", "ISSUES"];
  const rows = entries.map((e) => [
    e.pod,
    e.container,
    e.image,
    e.issues.join("; "),
  ]);
  return formatTable(headers, rows);
}

// --- Privileged Pods helpers ---

interface PrivilegedPodEntry {
  pod: string;
  namespace: string;
  riskFlags: string[];
}

function checkPrivileged(pod: k8s.V1Pod): string[] {
  const flags: string[] = [];
  const spec = pod.spec;
  if (!spec) return flags;

  if (spec.hostPID) flags.push("hostPID");
  if (spec.hostIPC) flags.push("hostIPC");
  if (spec.hostNetwork) flags.push("hostNetwork");

  const allContainers = [
    ...(spec.containers || []),
    ...(spec.initContainers || []),
  ];

  for (const c of allContainers) {
    const csc = c.securityContext;
    if (csc?.privileged) flags.push(`${c.name}:privileged`);
    if (csc?.runAsUser === 0) flags.push(`${c.name}:runAsRoot`);
  }

  if (spec.securityContext?.runAsUser === 0) flags.push("pod:runAsRoot");

  return flags;
}

function formatPrivilegedPods(entries: PrivilegedPodEntry[]): string {
  if (entries.length === 0) return "No privileged pods found.";

  const headers = ["POD", "NAMESPACE", "RISK-FLAGS"];
  const rows = entries.map((e) => [e.pod, e.namespace, e.riskFlags.join(", ")]);
  return formatTable(headers, rows);
}

// --- Scan Namespace (aggregated) ---

interface ScanFinding {
  severity: string;
  message: string;
}

function formatSecurityScan(
  namespace: string,
  findings: ScanFinding[],
  score: number
): string {
  let result = `=== Namespace Security Report: ${namespace} ===\n`;
  result += `Score: ${score}/100\n\n`;

  if (findings.length === 0) {
    result += "No issues found.\n";
    return result;
  }

  const sorted = [...findings].sort((a, b) => {
    const order: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
  });

  for (const f of sorted) {
    result += `[${f.severity}] ${f.message}\n`;
  }

  result += `\nRecommendations:\n`;
  const highFindings = findings.filter((f) => f.severity === "HIGH");
  highFindings.forEach((f, idx) => {
    result += `${idx + 1}. Fix: ${f.message}\n`;
  });

  return result;
}

export async function handleK8sSecurity(
  params: K8sSecurityParams,
  pluginConfig?: PluginConfig
): Promise<string> {
  try {
    const { coreApi, networkingApi } = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace || "default";

    switch (params.action) {
      case "scan_namespace": {
        const findings: ScanFinding[] = [];
        let score = 100;

        // Check privileged pods
        const podResp = await coreApi.listNamespacedPod(namespace);
        const pods = podResp.body.items;

        let privilegedCount = 0;
        let latestTagCount = 0;

        for (const pod of pods) {
          const privFlags = checkPrivileged(pod);
          if (privFlags.length > 0) {
            privilegedCount++;
          }

          for (const c of [...(pod.spec?.containers || []), ...(pod.spec?.initContainers || [])]) {
            const imgIssues = auditImage(c.image || "");
            if (imgIssues.some((i) => i.includes(":latest"))) {
              latestTagCount++;
            }
          }
        }

        if (privilegedCount > 0) {
          findings.push({ severity: "HIGH", message: `${privilegedCount} privileged pods found` });
          score -= privilegedCount * 10;
        }

        if (latestTagCount > 0) {
          findings.push({ severity: "HIGH", message: `${latestTagCount} containers using :latest tag` });
          score -= latestTagCount * 5;
        }

        // Check unused secrets
        const secretResp = await coreApi.listNamespacedSecret(namespace);
        const secrets = secretResp.body.items.filter(
          (s) => s.type !== "kubernetes.io/service-account-token"
        );
        let unusedCount = 0;
        for (const secret of secrets) {
          const refs = findSecretReferences(
            secret.metadata?.name || "",
            namespace,
            pods
          );
          if (refs.length === 0) unusedCount++;
        }

        if (unusedCount > 0) {
          findings.push({ severity: "MEDIUM", message: `${unusedCount} unused secrets` });
          score -= unusedCount * 2;
        }

        // Check network policies
        const npResp = await networkingApi.listNamespacedNetworkPolicy(namespace);
        if (npResp.body.items.length === 0 && pods.length > 0) {
          findings.push({ severity: "MEDIUM", message: "No NetworkPolicies defined" });
          score -= 10;
        }

        score = Math.max(0, score);

        return formatSecurityScan(namespace, findings, score);
      }

      case "check_psa": {
        const podResp = await coreApi.listNamespacedPod(
          namespace, undefined, undefined, undefined, undefined, params.label_selector
        );
        const results = podResp.body.items.map((pod) => {
          const { level, violations } = checkPSACompliance(pod);
          return {
            pod: pod.metadata?.name || "unknown",
            level,
            violations: violations.map((v) => v.check),
          };
        });

        return formatPSACheck(results);
      }

      case "secret_audit": {
        let secrets: k8s.V1Secret[];
        let pods: k8s.V1Pod[];

        if (params.all_namespaces) {
          const sResp = await coreApi.listSecretForAllNamespaces();
          secrets = sResp.body.items;
          const pResp = await coreApi.listPodForAllNamespaces();
          pods = pResp.body.items;
        } else {
          const sResp = await coreApi.listNamespacedSecret(namespace);
          secrets = sResp.body.items;
          const pResp = await coreApi.listNamespacedPod(namespace);
          pods = pResp.body.items;
        }

        // Filter out SA tokens
        secrets = secrets.filter(
          (s) => s.type !== "kubernetes.io/service-account-token"
        );

        const entries: SecretAuditEntry[] = secrets.map((secret) => {
          const sName = secret.metadata?.name || "unknown";
          const sNs = secret.metadata?.namespace || "unknown";
          const refs = findSecretReferences(sName, sNs, pods);

          return {
            secret: sName,
            namespace: sNs,
            referencedBy: refs.length > 0 ? refs.join(", ") : "(none)",
            status: refs.length > 0 ? "used" : "unused",
          };
        });

        return formatSecretAudit(entries);
      }

      case "image_audit": {
        let pods: k8s.V1Pod[];
        if (params.all_namespaces) {
          const resp = await coreApi.listPodForAllNamespaces();
          pods = resp.body.items;
        } else {
          const resp = await coreApi.listNamespacedPod(
            namespace, undefined, undefined, undefined, undefined, params.label_selector
          );
          pods = resp.body.items;
        }

        const entries: ImageIssue[] = [];
        for (const pod of pods) {
          const podName = pod.metadata?.name || "unknown";
          for (const c of [...(pod.spec?.containers || []), ...(pod.spec?.initContainers || [])]) {
            const issues = auditImage(c.image || "");
            if (issues.length > 0) {
              entries.push({
                pod: podName,
                container: c.name,
                image: c.image || "unknown",
                issues,
              });
            }
          }
        }

        return formatImageAudit(entries);
      }

      case "privileged_pods": {
        let pods: k8s.V1Pod[];
        if (params.all_namespaces) {
          const resp = await coreApi.listPodForAllNamespaces();
          pods = resp.body.items;
        } else {
          const resp = await coreApi.listNamespacedPod(
            namespace, undefined, undefined, undefined, undefined, params.label_selector
          );
          pods = resp.body.items;
        }

        const entries: PrivilegedPodEntry[] = [];
        for (const pod of pods) {
          const flags = checkPrivileged(pod);
          if (flags.length > 0) {
            entries.push({
              pod: pod.metadata?.name || "unknown",
              namespace: pod.metadata?.namespace || "unknown",
              riskFlags: flags,
            });
          }
        }

        return formatPrivilegedPods(entries);
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `security ${params.action}`));
  }
}

