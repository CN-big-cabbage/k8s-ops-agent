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
    registerK8sMetricsTools(api);
    registerK8sEventsTools(api);
    registerK8sEventAnalysisTools(api);

    api.log("K8s plugin loaded successfully - 9 skills registered");
  },
};

export default plugin;
