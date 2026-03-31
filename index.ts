import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { registerK8sPodTools } from "./skills/k8s-pod/src/pod.js";
import { registerK8sDeployTools } from "./skills/k8s-deploy/src/deploy.js";
import { registerK8sNodeTools } from "./skills/k8s-node/src/node.js";
import { registerK8sSvcTools } from "./skills/k8s-svc/src/svc.js";
import { registerK8sExecTools } from "./skills/k8s-exec/src/exec.js";
import { registerK8sLogsTools } from "./skills/k8s-logs/src/logs.js";
import { registerK8sMetricsTools } from "./skills/k8s-metrics/src/metrics.js";
import { registerK8sEventsTools } from "./skills/k8s-events/src/events.js";
import { registerK8sEventAnalysisTools } from "./skills/k8s-event-analysis/src/analysis.js";
// New skills
import { registerK8sConfigTools } from "./skills/k8s-config/src/config.js";
import { registerK8sPortForwardTools } from "./skills/k8s-portforward/src/portforward.js";
import { registerK8sIngressTools } from "./skills/k8s-ingress/src/ingress.js";
import { registerK8sStorageTools } from "./skills/k8s-storage/src/storage.js";
import { registerK8sNamespaceTools } from "./skills/k8s-namespace/src/namespace.js";
// Phase 1: Workload skills
import { registerK8sStatefulSetTools } from "./skills/k8s-statefulset/src/statefulset.js";
import { registerK8sDaemonSetTools } from "./skills/k8s-daemonset/src/daemonset.js";
import { registerK8sJobTools } from "./skills/k8s-job/src/job.js";
import { registerK8sCronJobTools } from "./skills/k8s-cronjob/src/cronjob.js";
import { registerK8sHpaTools } from "./skills/k8s-hpa/src/hpa.js";
// Phase 2: Security & RBAC skills
import { registerK8sRbacTools } from "./skills/k8s-rbac/src/rbac.js";
import { registerK8sNetPolTools } from "./skills/k8s-netpol/src/netpol.js";
import { registerK8sSecurityTools } from "./skills/k8s-security/src/security.js";
// Phase 3: Advanced ops skills
import { registerK8sPdbTools } from "./skills/k8s-pdb/src/pdb.js";
import { registerK8sCrdTools } from "./skills/k8s-crd/src/crd.js";
import { registerK8sHealthTools } from "./skills/k8s-health/src/health.js";
import { registerK8sTopologyTools } from "./skills/k8s-topology/src/topology.js";
import { registerK8sCostTools } from "./skills/k8s-cost/src/cost.js";
// Phase 4: Ecosystem integration skills
import { registerK8sHelmTools } from "./skills/k8s-helm/src/helm.js";
import { registerK8sYamlTools } from "./skills/k8s-yaml/src/yaml.js";
import { registerK8sGatewayTools } from "./skills/k8s-gateway/src/gateway.js";
import { registerK8sTroubleshootTools } from "./skills/k8s-troubleshoot/src/troubleshoot.js";
// Phase 5: System monitoring
import { registerSysMonitorTools } from "./skills/sys-monitor/src/monitor.js";

/**
 * Adapter: wraps OpenClaw's registerTool API to provide the
 * api.tools.register({ name, description, schema, handler }) interface
 * that k8s skill files expect.
 */
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

    // Original 9 skills
    registerK8sPodTools(adapted);
    registerK8sDeployTools(adapted);
    registerK8sNodeTools(adapted);
    registerK8sSvcTools(adapted);
    registerK8sExecTools(adapted);
    registerK8sLogsTools(adapted);
    registerK8sMetricsTools(adapted);
    registerK8sEventsTools(adapted);
    registerK8sEventAnalysisTools(adapted);

    // New skills (Phase 1 & 2)
    registerK8sConfigTools(adapted);
    registerK8sPortForwardTools(adapted);
    registerK8sIngressTools(adapted);
    registerK8sStorageTools(adapted);
    registerK8sNamespaceTools(adapted);

    // Phase 1: Workload skills
    registerK8sStatefulSetTools(adapted);
    registerK8sDaemonSetTools(adapted);
    registerK8sJobTools(adapted);
    registerK8sCronJobTools(adapted);
    registerK8sHpaTools(adapted);

    // Phase 2: Security & RBAC skills
    registerK8sRbacTools(adapted);
    registerK8sNetPolTools(adapted);
    registerK8sSecurityTools(adapted);

    // Phase 3: Advanced ops skills
    registerK8sPdbTools(adapted);
    registerK8sCrdTools(adapted);
    registerK8sHealthTools(adapted);
    registerK8sTopologyTools(adapted);
    registerK8sCostTools(adapted);

    // Phase 4: Ecosystem integration skills
    registerK8sHelmTools(adapted);
    registerK8sYamlTools(adapted);
    registerK8sGatewayTools(adapted);
    registerK8sTroubleshootTools(adapted);

    // Phase 5: System monitoring
    registerSysMonitorTools(adapted);

    api.logger?.info?.("K8s plugin loaded successfully - 32 skills registered");
  },
};

export default plugin;
