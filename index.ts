import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { registerK8sPodTools } from "./skills/k8s-pod/src/pod.js";
import { registerK8sDeployTools } from "./skills/k8s-deploy/src/deploy.js";
import { registerK8sNodeTools } from "./skills/k8s-node/src/node.js";
import { registerK8sSvcTools } from "./skills/k8s-svc/src/svc.js";

const plugin = {
  id: "k8s",
  name: "Kubernetes",
  description: "Kubernetes operations plugin",

  async load(api: OpenClawPluginApi) {
    // Register k8s-pod tools
    registerK8sPodTools(api);

    // Register k8s-deploy tools
    registerK8sDeployTools(api);

    // Register k8s-node tools
    registerK8sNodeTools(api);

    // Register k8s-svc tools
    registerK8sSvcTools(api);

    api.log("K8s plugin loaded successfully - 4 skills registered");
  },
};

export default plugin;
