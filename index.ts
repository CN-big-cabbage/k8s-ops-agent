import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
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

const plugin = {
  id: "k8s",
  name: "Kubernetes",
  description: "Kubernetes operations plugin - 14 tools for K8s management",

  async load(api: OpenClawPluginApi) {
    // Original 9 skills
    registerK8sPodTools(api);
    registerK8sDeployTools(api);
    registerK8sNodeTools(api);
    registerK8sSvcTools(api);
    registerK8sExecTools(api);
    registerK8sLogsTools(api);
    registerK8sMetricsTools(api);
    registerK8sEventsTools(api);
    registerK8sEventAnalysisTools(api);

    // New skills (Phase 1 & 2)
    registerK8sConfigTools(api);
    registerK8sPortForwardTools(api);
    registerK8sIngressTools(api);
    registerK8sStorageTools(api);
    registerK8sNamespaceTools(api);

    api.log("K8s plugin loaded successfully - 14 skills registered");
  },
};

export default plugin;