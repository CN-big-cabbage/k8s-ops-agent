import * as k8s from "@kubernetes/client-node";
import type { PluginConfig } from "./types.js";

export interface K8sClients {
  kc: k8s.KubeConfig;
  coreApi: k8s.CoreV1Api;
  appsApi: k8s.AppsV1Api;
  networkingApi: k8s.NetworkingV1Api;
  storageApi: k8s.StorageV1Api;
  batchApi: k8s.BatchV1Api;
  autoscalingApi: k8s.AutoscalingV2Api;
  rbacApi: k8s.RbacAuthorizationV1Api;
  policyApi: k8s.PolicyV1Api;
  customObjectsApi: k8s.CustomObjectsApi;
  apiextensionsApi: k8s.ApiextensionsV1Api;
  objectApi: k8s.KubernetesObjectApi;
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
    networkingApi: kc.makeApiClient(k8s.NetworkingV1Api),
    storageApi: kc.makeApiClient(k8s.StorageV1Api),
    batchApi: kc.makeApiClient(k8s.BatchV1Api),
    autoscalingApi: kc.makeApiClient(k8s.AutoscalingV2Api),
    rbacApi: kc.makeApiClient(k8s.RbacAuthorizationV1Api),
    policyApi: kc.makeApiClient(k8s.PolicyV1Api),
    customObjectsApi: kc.makeApiClient(k8s.CustomObjectsApi),
    apiextensionsApi: kc.makeApiClient(k8s.ApiextensionsV1Api),
    objectApi: k8s.KubernetesObjectApi.makeApiClient(kc),
  };

  clientCache.set(key, clients);
  return clients;
}