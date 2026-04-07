// Registry
export { skillRegistry, type SkillDefinition } from "./registry.js";

// Lib
export { createK8sClients, type K8sClients } from "./lib/client.js";
export { wrapK8sError } from "./lib/errors.js";
export { formatAge, formatTable, statusSymbol, truncateOutput } from "./lib/format.js";
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
