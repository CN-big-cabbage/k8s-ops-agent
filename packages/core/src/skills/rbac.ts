import * as k8s from "@kubernetes/client-node";
import { z } from "zod";
import { createK8sClients } from "../lib/client.js";
import { formatAge, formatTable } from "../lib/format.js";
import { wrapK8sError } from "../lib/errors.js";
import type { PluginConfig } from "../lib/types.js";

export const K8sRbacSchema = z.object({
  action: z.enum([
    "list_sa",
    "describe_sa",
    "list_roles",
    "describe_role",
    "list_bindings",
    "describe_binding",
    "who_can",
    "audit_sa",
  ]),
  namespace: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  name: z.string().optional(),
  cluster_scope: z.boolean().optional(),
  verb: z.string().optional(),
  resource: z.string().optional(),
  label_selector: z.string().optional(),
  context: z.string().optional(),
});

export type K8sRbacParams = z.infer<typeof K8sRbacSchema>;

function formatSAList(sas: k8s.V1ServiceAccount[]): string {
  if (sas.length === 0) return "No ServiceAccounts found.";

  const headers = ["NAMESPACE", "NAME", "SECRETS", "AGE"];
  const rows = sas.map((sa) => {
    const namespace = sa.metadata?.namespace || "unknown";
    const name = sa.metadata?.name || "unknown";
    const secrets = (sa.secrets?.length || 0).toString();
    const age = sa.metadata?.creationTimestamp
      ? formatAge(new Date(sa.metadata.creationTimestamp))
      : "unknown";
    return [namespace, name, secrets, age];
  });

  return formatTable(headers, rows);
}

function formatSADescribe(sa: k8s.V1ServiceAccount): string {
  const name = sa.metadata?.name || "unknown";
  const namespace = sa.metadata?.namespace || "unknown";

  let result = `Name: ${name}\n`;
  result += `Namespace: ${namespace}\n`;
  result += `CreationTimestamp: ${sa.metadata?.creationTimestamp || "unknown"}\n`;

  const labels = sa.metadata?.labels;
  if (labels && Object.keys(labels).length > 0) {
    result += `\n--- Labels ---\n`;
    for (const [k, v] of Object.entries(labels)) {
      result += `  ${k}: ${v}\n`;
    }
  }

  const secrets = sa.secrets || [];
  result += `\n--- Secrets ---\n`;
  if (secrets.length === 0) {
    result += `  (none)\n`;
  } else {
    secrets.forEach((s) => {
      result += `  ${s.name || "unknown"}\n`;
    });
  }

  const imagePullSecrets = sa.imagePullSecrets || [];
  if (imagePullSecrets.length > 0) {
    result += `\n--- Image Pull Secrets ---\n`;
    imagePullSecrets.forEach((s) => {
      result += `  ${s.name || "unknown"}\n`;
    });
  }

  return result;
}

function formatRoleList(
  roles: Array<{ scope: string; namespace: string; name: string; rulesCount: number }>
): string {
  if (roles.length === 0) return "No Roles found.";

  const headers = ["SCOPE", "NAMESPACE", "NAME", "RULES-COUNT"];
  const rows = roles.map((r) => [r.scope, r.namespace, r.name, r.rulesCount.toString()]);
  return formatTable(headers, rows);
}

function formatRoleRules(
  name: string,
  scope: string,
  rules: k8s.V1PolicyRule[]
): string {
  let result = `Name: ${name}\n`;
  result += `Scope: ${scope}\n`;
  result += `\n--- Rules ---\n`;

  if (rules.length === 0) {
    result += `  (none)\n`;
    return result;
  }

  rules.forEach((rule, idx) => {
    result += `  [${idx + 1}]\n`;
    result += `    apiGroups: ${JSON.stringify(rule.apiGroups || [])}\n`;
    result += `    resources: ${JSON.stringify(rule.resources || [])}\n`;
    result += `    verbs: ${JSON.stringify(rule.verbs || [])}\n`;
    if (rule.resourceNames && rule.resourceNames.length > 0) {
      result += `    resourceNames: ${JSON.stringify(rule.resourceNames)}\n`;
    }
  });

  return result;
}

function formatBindingList(
  bindings: Array<{
    scope: string;
    namespace: string;
    name: string;
    role: string;
    subjects: string;
  }>
): string {
  if (bindings.length === 0) return "No Bindings found.";

  const headers = ["SCOPE", "NAMESPACE", "NAME", "ROLE", "SUBJECTS"];
  const rows = bindings.map((b) => [b.scope, b.namespace, b.name, b.role, b.subjects]);
  return formatTable(headers, rows);
}

function formatBindingDescribe(
  name: string,
  scope: string,
  roleRef: k8s.V1RoleRef,
  subjects: k8s.V1Subject[]
): string {
  let result = `Name: ${name}\n`;
  result += `Scope: ${scope}\n`;
  result += `\n--- Role Reference ---\n`;
  result += `  Kind: ${roleRef.kind}\n`;
  result += `  Name: ${roleRef.name}\n`;
  result += `  API Group: ${roleRef.apiGroup}\n`;

  result += `\n--- Subjects ---\n`;
  if (subjects.length === 0) {
    result += `  (none)\n`;
  } else {
    subjects.forEach((s) => {
      result += `  Kind: ${s.kind}, Name: ${s.name}`;
      if (s.namespace) result += `, Namespace: ${s.namespace}`;
      result += `\n`;
    });
  }

  return result;
}

function formatSubjects(subjects: k8s.V1Subject[] | undefined): string {
  if (!subjects || subjects.length === 0) return "(none)";
  return subjects.map((s) => `${s.kind}/${s.name}`).join(", ");
}

interface WhoCanResult {
  subject: string;
  type: string;
  namespace: string;
  viaBinding: string;
}

function formatWhoCanResult(results: WhoCanResult[], verb: string, resource: string): string {
  if (results.length === 0) {
    return `No subjects found with permission to "${verb}" "${resource}".`;
  }

  let header = `Subjects who can "${verb}" "${resource}":\n\n`;
  const headers = ["WHO", "TYPE", "NAMESPACE", "VIA-BINDING"];
  const rows = results.map((r) => [r.subject, r.type, r.namespace, r.viaBinding]);
  return header + formatTable(headers, rows);
}

interface AuditResult {
  sa: string;
  namespace: string;
  riskLevel: string;
  reasons: string[];
}

function formatAuditResult(results: AuditResult[]): string {
  if (results.length === 0) {
    return "No overprivileged ServiceAccounts found.";
  }

  const headers = ["SA", "NAMESPACE", "RISK-LEVEL", "REASON"];
  const rows = results.map((r) => [r.sa, r.namespace, r.riskLevel, r.reasons.join("; ")]);
  return formatTable(headers, rows);
}

function ruleMatchesVerbResource(
  rule: k8s.V1PolicyRule,
  verb: string,
  resource: string
): boolean {
  const verbMatch =
    (rule.verbs || []).includes("*") || (rule.verbs || []).includes(verb);
  const resourceMatch =
    (rule.resources || []).includes("*") || (rule.resources || []).includes(resource);
  return verbMatch && resourceMatch;
}

function hasWildcardPermissions(rules: k8s.V1PolicyRule[]): string[] {
  const reasons: string[] = [];
  for (const rule of rules) {
    if ((rule.verbs || []).includes("*") && (rule.resources || []).includes("*")) {
      reasons.push("wildcard verbs and resources (*.*)");
    } else if ((rule.verbs || []).includes("*")) {
      const res = (rule.resources || []).join(",");
      reasons.push(`wildcard verbs on [${res}]`);
    } else if ((rule.resources || []).includes("*")) {
      const verbs = (rule.verbs || []).join(",");
      reasons.push(`[${verbs}] on wildcard resources`);
    }
  }
  return reasons;
}

export async function handleK8sRbac(
  params: K8sRbacParams,
  pluginConfig?: PluginConfig
): Promise<string> {
  try {
    const { coreApi, rbacApi } = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace || "default";

    switch (params.action) {
      case "list_sa": {
        let sas: k8s.V1ServiceAccount[];
        if (params.all_namespaces) {
          const response = await coreApi.listServiceAccountForAllNamespaces(
            undefined, undefined, undefined, params.label_selector
          );
          sas = response.body.items;
        } else {
          const response = await coreApi.listNamespacedServiceAccount(
            namespace, undefined, undefined, undefined, undefined, params.label_selector
          );
          sas = response.body.items;
        }
        return formatSAList(sas);
      }

      case "describe_sa": {
        if (!params.name) {
          throw new Error("name is required for describe_sa action");
        }
        const response = await coreApi.readNamespacedServiceAccount(params.name, namespace);
        return formatSADescribe(response.body);
      }

      case "list_roles": {
        const roleItems: Array<{ scope: string; namespace: string; name: string; rulesCount: number }> = [];

        if (params.cluster_scope) {
          const response = await rbacApi.listClusterRole(
            undefined, undefined, undefined, undefined, params.label_selector
          );
          for (const role of response.body.items) {
            roleItems.push({
              scope: "Cluster",
              namespace: "—",
              name: role.metadata?.name || "unknown",
              rulesCount: (role.rules || []).length,
            });
          }
        } else {
          if (params.all_namespaces) {
            const response = await rbacApi.listRoleForAllNamespaces(
              undefined, undefined, undefined, params.label_selector
            );
            for (const role of response.body.items) {
              roleItems.push({
                scope: "Namespaced",
                namespace: role.metadata?.namespace || "unknown",
                name: role.metadata?.name || "unknown",
                rulesCount: (role.rules || []).length,
              });
            }
          } else {
            const response = await rbacApi.listNamespacedRole(
              namespace, undefined, undefined, undefined, undefined, params.label_selector
            );
            for (const role of response.body.items) {
              roleItems.push({
                scope: "Namespaced",
                namespace: role.metadata?.namespace || "unknown",
                name: role.metadata?.name || "unknown",
                rulesCount: (role.rules || []).length,
              });
            }
          }
        }

        return formatRoleList(roleItems);
      }

      case "describe_role": {
        if (!params.name) {
          throw new Error("name is required for describe_role action");
        }

        if (params.cluster_scope) {
          const response = await rbacApi.readClusterRole(params.name);
          return formatRoleRules(params.name, "Cluster", response.body.rules || []);
        } else {
          const response = await rbacApi.readNamespacedRole(params.name, namespace);
          return formatRoleRules(params.name, "Namespaced", response.body.rules || []);
        }
      }

      case "list_bindings": {
        const bindingItems: Array<{
          scope: string;
          namespace: string;
          name: string;
          role: string;
          subjects: string;
        }> = [];

        if (params.cluster_scope) {
          const response = await rbacApi.listClusterRoleBinding(
            undefined, undefined, undefined, undefined, params.label_selector
          );
          for (const binding of response.body.items) {
            bindingItems.push({
              scope: "Cluster",
              namespace: "—",
              name: binding.metadata?.name || "unknown",
              role: `${binding.roleRef.kind}/${binding.roleRef.name}`,
              subjects: formatSubjects(binding.subjects),
            });
          }
        } else {
          if (params.all_namespaces) {
            const response = await rbacApi.listRoleBindingForAllNamespaces(
              undefined, undefined, undefined, params.label_selector
            );
            for (const binding of response.body.items) {
              bindingItems.push({
                scope: "Namespaced",
                namespace: binding.metadata?.namespace || "unknown",
                name: binding.metadata?.name || "unknown",
                role: `${binding.roleRef.kind}/${binding.roleRef.name}`,
                subjects: formatSubjects(binding.subjects),
              });
            }
          } else {
            const response = await rbacApi.listNamespacedRoleBinding(
              namespace, undefined, undefined, undefined, undefined, params.label_selector
            );
            for (const binding of response.body.items) {
              bindingItems.push({
                scope: "Namespaced",
                namespace: binding.metadata?.namespace || "unknown",
                name: binding.metadata?.name || "unknown",
                role: `${binding.roleRef.kind}/${binding.roleRef.name}`,
                subjects: formatSubjects(binding.subjects),
              });
            }
          }
        }

        return formatBindingList(bindingItems);
      }

      case "describe_binding": {
        if (!params.name) {
          throw new Error("name is required for describe_binding action");
        }

        if (params.cluster_scope) {
          const response = await rbacApi.readClusterRoleBinding(params.name);
          const b = response.body;
          return formatBindingDescribe(params.name, "Cluster", b.roleRef, b.subjects || []);
        } else {
          const response = await rbacApi.readNamespacedRoleBinding(params.name, namespace);
          const b = response.body;
          return formatBindingDescribe(params.name, "Namespaced", b.roleRef, b.subjects || []);
        }
      }

      case "who_can": {
        if (!params.verb) {
          throw new Error("verb is required for who_can action");
        }
        if (!params.resource) {
          throw new Error("resource is required for who_can action");
        }

        const results: WhoCanResult[] = [];

        // Check ClusterRoleBindings
        const crbResponse = await rbacApi.listClusterRoleBinding();
        for (const crb of crbResponse.body.items) {
          let rules: k8s.V1PolicyRule[] = [];
          try {
            const roleResp = await rbacApi.readClusterRole(crb.roleRef.name);
            rules = roleResp.body.rules || [];
          } catch {
            continue;
          }

          const matches = rules.some((r) =>
            ruleMatchesVerbResource(r, params.verb!, params.resource!)
          );
          if (matches) {
            for (const subject of crb.subjects || []) {
              results.push({
                subject: subject.name,
                type: subject.kind,
                namespace: subject.namespace || "—",
                viaBinding: crb.metadata?.name || "unknown",
              });
            }
          }
        }

        // Check RoleBindings in the target namespace
        const rbResponse = await rbacApi.listNamespacedRoleBinding(namespace);
        for (const rb of rbResponse.body.items) {
          let rules: k8s.V1PolicyRule[] = [];
          try {
            if (rb.roleRef.kind === "ClusterRole") {
              const roleResp = await rbacApi.readClusterRole(rb.roleRef.name);
              rules = roleResp.body.rules || [];
            } else {
              const roleResp = await rbacApi.readNamespacedRole(rb.roleRef.name, namespace);
              rules = roleResp.body.rules || [];
            }
          } catch {
            continue;
          }

          const matches = rules.some((r) =>
            ruleMatchesVerbResource(r, params.verb!, params.resource!)
          );
          if (matches) {
            for (const subject of rb.subjects || []) {
              results.push({
                subject: subject.name,
                type: subject.kind,
                namespace: subject.namespace || namespace,
                viaBinding: rb.metadata?.name || "unknown",
              });
            }
          }
        }

        return formatWhoCanResult(results, params.verb, params.resource);
      }

      case "audit_sa": {
        const auditResults: AuditResult[] = [];

        let sas: k8s.V1ServiceAccount[];
        if (params.all_namespaces) {
          const resp = await coreApi.listServiceAccountForAllNamespaces();
          sas = resp.body.items;
        } else {
          const resp = await coreApi.listNamespacedServiceAccount(namespace);
          sas = resp.body.items;
        }

        // Build a map of all bindings
        const allClusterBindings = (await rbacApi.listClusterRoleBinding()).body.items;
        const allNamespacedBindings = params.all_namespaces
          ? (await rbacApi.listRoleBindingForAllNamespaces()).body.items
          : (await rbacApi.listNamespacedRoleBinding(namespace)).body.items;

        for (const sa of sas) {
          const saName = sa.metadata?.name || "unknown";
          const saNamespace = sa.metadata?.namespace || "unknown";
          const allReasons: string[] = [];

          // Check cluster role bindings
          for (const crb of allClusterBindings) {
            const isBound = (crb.subjects || []).some(
              (s) =>
                s.kind === "ServiceAccount" &&
                s.name === saName &&
                (s.namespace === saNamespace || !s.namespace)
            );
            if (!isBound) continue;

            try {
              const roleResp = await rbacApi.readClusterRole(crb.roleRef.name);
              const wildcardReasons = hasWildcardPermissions(roleResp.body.rules || []);
              allReasons.push(...wildcardReasons);
            } catch {
              // skip if role not found
            }
          }

          // Check namespaced role bindings
          for (const rb of allNamespacedBindings) {
            if (rb.metadata?.namespace !== saNamespace) continue;

            const isBound = (rb.subjects || []).some(
              (s) => s.kind === "ServiceAccount" && s.name === saName
            );
            if (!isBound) continue;

            try {
              let rules: k8s.V1PolicyRule[] = [];
              if (rb.roleRef.kind === "ClusterRole") {
                const roleResp = await rbacApi.readClusterRole(rb.roleRef.name);
                rules = roleResp.body.rules || [];
              } else {
                const roleResp = await rbacApi.readNamespacedRole(
                  rb.roleRef.name,
                  rb.metadata?.namespace || namespace
                );
                rules = roleResp.body.rules || [];
              }
              const wildcardReasons = hasWildcardPermissions(rules);
              allReasons.push(...wildcardReasons);
            } catch {
              // skip if role not found
            }
          }

          if (allReasons.length > 0) {
            auditResults.push({
              sa: saName,
              namespace: saNamespace,
              riskLevel: "HIGH",
              reasons: allReasons,
            });
          }
        }

        return formatAuditResult(auditResults);
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `rbac ${params.action}`));
  }
}

