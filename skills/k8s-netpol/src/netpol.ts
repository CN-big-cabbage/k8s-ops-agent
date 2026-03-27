import * as k8s from "@kubernetes/client-node";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { z } from "zod";
import { createK8sClients } from "../../../lib/client.js";
import { formatAge, formatTable } from "../../../lib/format.js";
import { wrapK8sError } from "../../../lib/errors.js";
import type { PluginConfig } from "../../../lib/types.js";

export const K8sNetPolSchema = z.object({
  action: z.enum(["list", "describe", "check_pod", "create", "delete", "audit"]),
  namespace: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  policy_name: z.string().optional(),
  pod_name: z.string().optional(),
  pod_selector: z.string().optional(),
  ingress_allow: z.string().optional(),
  egress_allow: z.string().optional(),
  label_selector: z.string().optional(),
  context: z.string().optional(),
});

type K8sNetPolParams = z.infer<typeof K8sNetPolSchema>;

function formatPodSelector(selector: k8s.V1LabelSelector | undefined): string {
  if (!selector || !selector.matchLabels) return "(all pods)";
  return Object.entries(selector.matchLabels)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}

function formatNetPolList(policies: k8s.V1NetworkPolicy[]): string {
  if (policies.length === 0) return "No NetworkPolicies found.";

  const headers = ["NAMESPACE", "NAME", "POD-SELECTOR", "POLICY-TYPES", "AGE"];
  const rows = policies.map((np) => {
    const namespace = np.metadata?.namespace || "unknown";
    const name = np.metadata?.name || "unknown";
    const podSelector = formatPodSelector(np.spec?.podSelector);
    const policyTypes = (np.spec?.policyTypes || []).join(",") || "—";
    const age = np.metadata?.creationTimestamp
      ? formatAge(new Date(np.metadata.creationTimestamp))
      : "unknown";
    return [namespace, name, podSelector, policyTypes, age];
  });

  return formatTable(headers, rows);
}

function formatPeerDescription(peer: k8s.V1NetworkPolicyPeer): string {
  const parts: string[] = [];

  if (peer.namespaceSelector?.matchLabels) {
    const labels = Object.entries(peer.namespaceSelector.matchLabels)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    parts.push(`namespace=${labels}`);
  }

  if (peer.podSelector?.matchLabels) {
    const labels = Object.entries(peer.podSelector.matchLabels)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    parts.push(`pods=${labels}`);
  }

  if (peer.ipBlock) {
    parts.push(`cidr=${peer.ipBlock.cidr}`);
    if (peer.ipBlock.except && peer.ipBlock.except.length > 0) {
      parts.push(`except=${peer.ipBlock.except.join(",")}`);
    }
  }

  return parts.length > 0 ? parts.join(", ") : "(all)";
}

function formatPorts(ports: k8s.V1NetworkPolicyPort[] | undefined): string {
  if (!ports || ports.length === 0) return "all ports";
  return ports
    .map((p) => `${(p.protocol || "TCP")}/${p.port || "*"}`)
    .join(", ");
}

function formatNetPolDescribe(np: k8s.V1NetworkPolicy): string {
  const name = np.metadata?.name || "unknown";
  const namespace = np.metadata?.namespace || "unknown";

  let result = `Name: ${name}\n`;
  result += `Namespace: ${namespace}\n`;
  result += `Pod Selector: ${formatPodSelector(np.spec?.podSelector)}\n`;
  result += `Policy Types: ${(np.spec?.policyTypes || []).join(", ") || "—"}\n`;

  const ingress = np.spec?.ingress || [];
  result += `\n--- Ingress Rules ---\n`;
  if (ingress.length === 0) {
    result += `  (no ingress rules — all ingress denied)\n`;
  } else {
    ingress.forEach((rule, idx) => {
      const from = rule.from || [];
      if (from.length === 0) {
        result += `  [${idx + 1}] From: (all sources)\n`;
      } else {
        const froms = from.map((f) => formatPeerDescription(f)).join("; ");
        result += `  [${idx + 1}] From: ${froms}\n`;
      }
      result += `      Ports: ${formatPorts(rule.ports)}\n`;
    });
  }

  const egress = np.spec?.egress || [];
  result += `\n--- Egress Rules ---\n`;
  if (egress.length === 0) {
    result += `  (no egress rules — all egress denied)\n`;
  } else {
    egress.forEach((rule, idx) => {
      const to = rule.to || [];
      if (to.length === 0) {
        result += `  [${idx + 1}] To: (all destinations)\n`;
      } else {
        const tos = to.map((t) => formatPeerDescription(t)).join("; ");
        result += `  [${idx + 1}] To: ${tos}\n`;
      }
      result += `      Ports: ${formatPorts(rule.ports)}\n`;
    });
  }

  return result;
}

function labelsMatch(
  selector: k8s.V1LabelSelector | undefined,
  labels: Record<string, string> | undefined
): boolean {
  if (!selector || !selector.matchLabels) return true;
  if (!labels) return false;

  return Object.entries(selector.matchLabels).every(
    ([k, v]) => labels[k] === v
  );
}

function formatPodPolicies(
  podName: string,
  namespace: string,
  matchedPolicies: k8s.V1NetworkPolicy[]
): string {
  if (matchedPolicies.length === 0) {
    return `Pod ${namespace}/${podName}: No NetworkPolicies apply (unrestricted traffic).`;
  }

  const headers = ["POLICY", "INGRESS-RESTRICTED", "EGRESS-RESTRICTED"];
  const rows = matchedPolicies.map((np) => {
    const policyTypes = np.spec?.policyTypes || [];
    return [
      np.metadata?.name || "unknown",
      policyTypes.includes("Ingress") ? "Yes" : "No",
      policyTypes.includes("Egress") ? "Yes" : "No",
    ];
  });

  let result = `Pod ${namespace}/${podName}: ${matchedPolicies.length} policies apply\n\n`;
  result += formatTable(headers, rows);
  return result;
}

interface NamespaceAuditEntry {
  namespace: string;
  hasNetPol: boolean;
  podCount: number;
  risk: string;
}

function formatAuditResult(entries: NamespaceAuditEntry[]): string {
  if (entries.length === 0) return "No namespaces found.";

  const headers = ["NAMESPACE", "HAS-NETPOL", "POD-COUNT", "RISK"];
  const rows = entries.map((e) => [
    e.namespace,
    e.hasNetPol ? "Yes" : "No",
    e.podCount.toString(),
    e.risk,
  ]);

  return formatTable(headers, rows);
}

function parseLabelSelector(selector: string): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const part of selector.split(",")) {
    const [k, v] = part.split("=");
    if (k && v) labels[k.trim()] = v.trim();
  }
  return labels;
}

function parseAllowRule(
  rule: string
): k8s.V1NetworkPolicyPeer {
  const peer: k8s.V1NetworkPolicyPeer = {};

  for (const part of rule.split(",")) {
    const trimmed = part.trim();
    if (trimmed.startsWith("namespace=")) {
      const val = trimmed.slice("namespace=".length);
      // If value contains "=" treat as label selector, otherwise as namespace name
      const labels = val.includes("=")
        ? parseLabelSelector(val)
        : { "kubernetes.io/metadata.name": val };
      peer.namespaceSelector = { matchLabels: labels };
    } else if (trimmed.startsWith("cidr=")) {
      const cidr = trimmed.slice("cidr=".length);
      peer.ipBlock = { cidr };
    } else if (trimmed.startsWith("pods=")) {
      const val = trimmed.slice("pods=".length);
      const labels = parseLabelSelector(val);
      peer.podSelector = { matchLabels: labels };
    }
  }

  return peer;
}

function buildNetworkPolicy(params: K8sNetPolParams, namespace: string): k8s.V1NetworkPolicy {
  const podSelector: k8s.V1LabelSelector = {};
  if (params.pod_selector) {
    podSelector.matchLabels = parseLabelSelector(params.pod_selector);
  }

  const policyTypes: string[] = [];
  const policy: k8s.V1NetworkPolicy = {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: {
      name: params.policy_name,
      namespace,
    },
    spec: {
      podSelector,
      policyTypes: [],
    },
  };

  if (params.ingress_allow) {
    policyTypes.push("Ingress");
    const peer = parseAllowRule(params.ingress_allow);
    policy.spec!.ingress = [{ from: [peer] }];
  }

  if (params.egress_allow) {
    policyTypes.push("Egress");
    const peer = parseAllowRule(params.egress_allow);
    policy.spec!.egress = [{ to: [peer] }];
  }

  if (policyTypes.length === 0) {
    policyTypes.push("Ingress", "Egress");
  }

  policy.spec!.policyTypes = policyTypes;
  return policy;
}

export async function handleK8sNetPol(
  params: K8sNetPolParams,
  pluginConfig?: PluginConfig
): Promise<string> {
  try {
    const { coreApi, networkingApi } = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace || "default";

    switch (params.action) {
      case "list": {
        let policies: k8s.V1NetworkPolicy[];

        if (params.all_namespaces) {
          const response = await networkingApi.listNetworkPolicyForAllNamespaces(
            undefined, undefined, undefined, params.label_selector
          );
          policies = response.body.items;
        } else {
          const response = await networkingApi.listNamespacedNetworkPolicy(
            namespace, undefined, undefined, undefined, undefined, params.label_selector
          );
          policies = response.body.items;
        }

        return formatNetPolList(policies);
      }

      case "describe": {
        if (!params.policy_name) {
          throw new Error("policy_name is required for describe action");
        }

        const response = await networkingApi.readNamespacedNetworkPolicy(
          params.policy_name, namespace
        );
        return formatNetPolDescribe(response.body);
      }

      case "check_pod": {
        if (!params.pod_name) {
          throw new Error("pod_name is required for check_pod action");
        }

        const podResp = await coreApi.readNamespacedPod(params.pod_name, namespace);
        const podLabels = podResp.body.metadata?.labels || {};

        const npResp = await networkingApi.listNamespacedNetworkPolicy(namespace);
        const allPolicies = npResp.body.items;

        const matchedPolicies = allPolicies.filter((np) =>
          labelsMatch(np.spec?.podSelector, podLabels)
        );

        return formatPodPolicies(params.pod_name, namespace, matchedPolicies);
      }

      case "create": {
        if (!params.policy_name) {
          throw new Error("policy_name is required for create action");
        }

        const policy = buildNetworkPolicy(params, namespace);
        await networkingApi.createNamespacedNetworkPolicy(namespace, policy);

        return `NetworkPolicy ${namespace}/${params.policy_name} created`;
      }

      case "delete": {
        if (!params.policy_name) {
          throw new Error("policy_name is required for delete action");
        }

        await networkingApi.deleteNamespacedNetworkPolicy(params.policy_name, namespace);
        return `NetworkPolicy ${namespace}/${params.policy_name} deleted`;
      }

      case "audit": {
        const nsResp = await coreApi.listNamespace();
        const namespaces = nsResp.body.items;

        const entries: NamespaceAuditEntry[] = [];

        for (const ns of namespaces) {
          const nsName = ns.metadata?.name || "unknown";
          // Skip system namespaces
          if (nsName.startsWith("kube-")) continue;

          const npResp = await networkingApi.listNamespacedNetworkPolicy(nsName);
          const hasNetPol = npResp.body.items.length > 0;

          const podResp = await coreApi.listNamespacedPod(nsName);
          const podCount = podResp.body.items.length;

          let risk = "LOW";
          if (!hasNetPol && podCount > 0) {
            risk = "HIGH";
          } else if (!hasNetPol && podCount === 0) {
            risk = "NONE";
          }

          entries.push({ namespace: nsName, hasNetPol, podCount, risk });
        }

        return formatAuditResult(entries);
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `netpol ${params.action}`));
  }
}

export function registerK8sNetPolTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_netpol",
    description:
      "Kubernetes NetworkPolicy operations: list, describe, check pod policies, create, delete, audit unprotected namespaces",
    schema: K8sNetPolSchema,
    handler: async (params: K8sNetPolParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sNetPol(params, pluginConfig);
    },
  });
}
