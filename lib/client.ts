import * as k8s from "@kubernetes/client-node";
import type { PluginConfig } from "./types.js";

export interface K8sClients {
  kc: k8s.KubeConfig;
  coreApi: k8s.CoreV1Api;
  appsApi: k8s.AppsV1Api;
}

const clientCache = new Map<string, K8sClients>();

function cacheKey(kubeconfigPath?: string, context?: string): string {
  return `${kubeconfigPath || "default"}:${context || "default"}`;
}

export function createK8sClients(
  config?: PluginConfig,
  contextOverride?: string
): K8sClients {
  const context = contextOverride || config?.defaultContext;
  const key = cacheKey(config?.kubeconfigPath, context);

  const cached = clientCache.get(key);
  if (cached) return cached;

  const kc = new k8s.KubeConfig();

  if (config?.kubeconfigPath) {
    kc.loadFromFile(config.kubeconfigPath);
  } else {
    kc.loadFromDefault();
  }

  if (context) {
    kc.setCurrentContext(context);
  }

  const clients: K8sClients = {
    kc,
    coreApi: kc.makeApiClient(k8s.CoreV1Api),
    appsApi: kc.makeApiClient(k8s.AppsV1Api),
  };

  clientCache.set(key, clients);
  return clients;
}
