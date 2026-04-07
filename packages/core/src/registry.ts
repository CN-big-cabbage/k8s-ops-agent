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
