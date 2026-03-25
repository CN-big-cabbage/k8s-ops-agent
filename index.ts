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
