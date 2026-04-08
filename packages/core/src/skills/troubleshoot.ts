import { z } from "zod";
import { createK8sClients, type K8sClients } from "../lib/client.js";
import { wrapK8sError } from "../lib/errors.js";
import { formatAge } from "../lib/format.js";
import type { PluginConfig } from "../lib/types.js";

export const K8sTroubleshootSchema = z.object({
  action: z.enum([
    "pod_not_ready",
    "service_no_endpoints",
    "node_not_ready",
    "pvc_pending",
    "deployment_stuck",
    "diagnose",
  ]),
  namespace: z.string().optional(),
  name: z.string().optional(),
  resource_type: z.string().optional(),
  context: z.string().optional(),
});

export type K8sTroubleshootParams = z.infer<typeof K8sTroubleshootSchema>;

interface DiagStep {
  step: number;
  label: string;
  result: string;
  detail?: string;
}

interface Diagnosis {
  steps: DiagStep[];
  rootCause: string;
  recommendations: string[];
}

function formatDiagnosis(title: string, diag: Diagnosis): string {
  const lines: string[] = [];
  lines.push(`=== Troubleshoot: ${title} ===`);
  lines.push("");

  for (const s of diag.steps) {
    lines.push(`[Step ${s.step}] ${s.label}... ${s.result}`);
    if (s.detail) {
      for (const line of s.detail.split("\n")) {
        lines.push(`  ${line}`);
      }
    }
  }

  lines.push("");
  lines.push("--- Diagnosis ---");
  lines.push(`Root Cause: ${diag.rootCause}`);
  lines.push("");
  lines.push("Recommendation:");
  for (let i = 0; i < diag.recommendations.length; i++) {
    lines.push(`  ${i + 1}. ${diag.recommendations[i]}`);
  }

  return lines.join("\n");
}

function formatEvents(events: Array<{ type: string; reason: string; message: string; lastTimestamp?: string }>): string {
  if (events.length === 0) return "No recent events";
  return events
    .map((e) => {
      const age = e.lastTimestamp ? formatAge(new Date(e.lastTimestamp)) : "—";
      return `[${age} ago] ${e.type}/${e.reason}: ${e.message}`;
    })
    .join("\n");
}

async function getEvents(
  clients: K8sClients,
  namespace: string,
  fieldSelector: string
): Promise<Array<{ type: string; reason: string; message: string; lastTimestamp?: string }>> {
  try {
    const response = await clients.coreApi.listNamespacedEvent(
      namespace, undefined, undefined, undefined, fieldSelector
    );
    return (response.body.items || [])
      .sort((a, b) => {
        const aTime = a.lastTimestamp?.getTime() || 0;
        const bTime = b.lastTimestamp?.getTime() || 0;
        return bTime - aTime;
      })
      .slice(0, 10)
      .map((e) => ({
        type: e.type || "Normal",
        reason: e.reason || "Unknown",
        message: e.message || "",
        lastTimestamp: e.lastTimestamp?.toISOString(),
      }));
  } catch {
    return [];
  }
}

async function troubleshootPodNotReady(
  clients: K8sClients,
  namespace: string,
  name: string
): Promise<Diagnosis> {
  const steps: DiagStep[] = [];
  let rootCause = "Unable to determine root cause";
  const recommendations: string[] = [];

  // Step 1: Check pod exists
  let pod;
  try {
    const response = await clients.coreApi.readNamespacedPod(name, namespace);
    pod = response.body;
    steps.push({ step: 1, label: "Check Pod existence", result: "OK" });
  } catch {
    steps.push({ step: 1, label: "Check Pod existence", result: "NOT FOUND" });
    return {
      steps,
      rootCause: `Pod ${namespace}/${name} does not exist`,
      recommendations: [
        "Verify the pod name and namespace are correct",
        `Run: k8s_pod { action: "list", namespace: "${namespace}" }`,
      ],
    };
  }

  // Step 2: Check phase
  const phase = pod.status?.phase || "Unknown";
  steps.push({ step: 2, label: "Check Pod phase", result: phase });

  // Step 3: Check container statuses
  const containerStatuses = pod.status?.containerStatuses || [];
  const initContainerStatuses = pod.status?.initContainerStatuses || [];

  for (const cs of initContainerStatuses) {
    if (cs.state?.waiting) {
      steps.push({
        step: 3,
        label: `Check init container "${cs.name}"`,
        result: cs.state.waiting.reason || "Waiting",
        detail: cs.state.waiting.message,
      });
      rootCause = `Init container "${cs.name}" is stuck: ${cs.state.waiting.reason || "Waiting"}`;
      recommendations.push(`Check init container "${cs.name}" configuration and logs`);
    }
    if (cs.state?.terminated && cs.state.terminated.exitCode !== 0) {
      steps.push({
        step: 3,
        label: `Check init container "${cs.name}"`,
        result: `Terminated (exit code: ${cs.state.terminated.exitCode})`,
        detail: cs.state.terminated.reason || undefined,
      });
      rootCause = `Init container "${cs.name}" failed with exit code ${cs.state.terminated.exitCode}`;
      recommendations.push(`Check init container logs: k8s_pod { action: "logs", pod_name: "${name}", container: "${cs.name}" }`);
    }
  }

  for (const cs of containerStatuses) {
    const restartCount = cs.restartCount || 0;

    if (cs.state?.waiting) {
      const reason = cs.state.waiting.reason || "Waiting";
      steps.push({
        step: 3,
        label: `Check container "${cs.name}"`,
        result: `${reason} (restarts: ${restartCount})`,
        detail: cs.state.waiting.message,
      });

      if (reason === "CrashLoopBackOff") {
        rootCause = `Container "${cs.name}" is in CrashLoopBackOff (restart count: ${restartCount})`;
        const lastState = cs.lastState?.terminated;
        if (lastState?.exitCode === 137) {
          rootCause += " — OOMKilled (exit code 137)";
          recommendations.push("Increase memory limits for this container");
          recommendations.push("Check for memory leaks in the application");
        } else if (lastState?.exitCode === 1) {
          rootCause += ` — application error (exit code ${lastState.exitCode})`;
          recommendations.push(`Check container logs: k8s_pod { action: "logs", pod_name: "${name}", container: "${cs.name}", previous: true }`);
        } else {
          recommendations.push(`Check container logs: k8s_pod { action: "logs", pod_name: "${name}", container: "${cs.name}", previous: true }`);
        }
      } else if (reason === "ImagePullBackOff" || reason === "ErrImagePull") {
        rootCause = `Container "${cs.name}" cannot pull image: ${cs.state.waiting.message || "ImagePullBackOff"}`;
        recommendations.push("Verify the image name and tag are correct");
        recommendations.push("Check image registry credentials (imagePullSecrets)");
        recommendations.push("Verify network connectivity to the registry");
      } else if (reason === "CreateContainerConfigError") {
        rootCause = `Container "${cs.name}" has configuration error: ${cs.state.waiting.message || ""}`;
        recommendations.push("Check ConfigMap/Secret references in the pod spec");
        recommendations.push("Verify all referenced ConfigMaps and Secrets exist");
      } else {
        rootCause = `Container "${cs.name}" is waiting: ${reason}`;
        recommendations.push("Check events for more details");
      }
    } else if (cs.state?.terminated) {
      steps.push({
        step: 3,
        label: `Check container "${cs.name}"`,
        result: `Terminated (exit code: ${cs.state.terminated.exitCode})`,
        detail: cs.state.terminated.reason || undefined,
      });
    } else if (cs.ready === false && cs.state?.running) {
      steps.push({
        step: 3,
        label: `Check container "${cs.name}"`,
        result: "Running but NOT Ready",
        detail: "Readiness probe may be failing",
      });
      rootCause = `Container "${cs.name}" is running but readiness probe is failing`;
      recommendations.push("Check readiness probe configuration");
      recommendations.push(`Check container logs: k8s_pod { action: "logs", pod_name: "${name}", container: "${cs.name}" }`);
    }
  }

  if (phase === "Pending" && containerStatuses.length === 0) {
    rootCause = "Pod is Pending — not yet scheduled";
    recommendations.push("Check events for scheduling failures (FailedScheduling)");
    recommendations.push("Verify node resources are sufficient");
    recommendations.push("Check node selectors, tolerations, and affinity rules");
  }

  // Step 4: Check events
  const events = await getEvents(clients, namespace, `involvedObject.name=${name}`);
  const warningEvents = events.filter((e) => e.type === "Warning");

  if (warningEvents.length > 0) {
    steps.push({
      step: 4,
      label: "Check recent events",
      result: `${warningEvents.length} warning(s)`,
      detail: formatEvents(warningEvents.slice(0, 5)),
    });

    for (const e of warningEvents) {
      if (e.reason === "FailedScheduling" && rootCause.includes("Pending")) {
        rootCause = `Pod cannot be scheduled: ${e.message}`;
        if (e.message.includes("Insufficient cpu")) {
          recommendations.length = 0;
          recommendations.push("Reduce CPU requests or add more nodes");
        } else if (e.message.includes("Insufficient memory")) {
          recommendations.length = 0;
          recommendations.push("Reduce memory requests or add more nodes");
        }
      }
    }
  } else {
    steps.push({ step: 4, label: "Check recent events", result: "No warnings" });
  }

  if (recommendations.length === 0) {
    recommendations.push(`Check pod details: k8s_pod { action: "describe", pod_name: "${name}", namespace: "${namespace}" }`);
    recommendations.push(`Check pod logs: k8s_pod { action: "logs", pod_name: "${name}", namespace: "${namespace}" }`);
  }

  return { steps, rootCause, recommendations };
}

async function troubleshootServiceNoEndpoints(
  clients: K8sClients,
  namespace: string,
  name: string
): Promise<Diagnosis> {
  const steps: DiagStep[] = [];
  const recommendations: string[] = [];

  // Step 1: Check service exists
  let service;
  try {
    const response = await clients.coreApi.readNamespacedService(name, namespace);
    service = response.body;
    steps.push({ step: 1, label: "Check Service existence", result: "OK" });
  } catch {
    steps.push({ step: 1, label: "Check Service existence", result: "NOT FOUND" });
    return {
      steps,
      rootCause: `Service ${namespace}/${name} does not exist`,
      recommendations: [`Verify service name and namespace`],
    };
  }

  // Step 2: Check selector
  const selector = service.spec?.selector;
  if (!selector || Object.keys(selector).length === 0) {
    steps.push({ step: 2, label: "Check Service selector", result: "No selector defined" });
    return {
      steps,
      rootCause: "Service has no selector — it will never match any pods",
      recommendations: [
        "Add a selector to the service spec",
        "Or create Endpoints manually for external services",
      ],
    };
  }

  const selectorStr = Object.entries(selector).map(([k, v]) => `${k}=${v}`).join(",");
  steps.push({ step: 2, label: "Check Service selector", result: selectorStr });

  // Step 3: Find matching pods
  const podResponse = await clients.coreApi.listNamespacedPod(
    namespace, undefined, undefined, undefined, undefined, selectorStr
  );
  const pods = podResponse.body.items || [];

  if (pods.length === 0) {
    steps.push({ step: 3, label: "Find matching Pods", result: "0 pods match" });

    // Check all pods in namespace for close matches
    const allPodsResponse = await clients.coreApi.listNamespacedPod(namespace);
    const allPods = allPodsResponse.body.items || [];
    const selectorKeys = Object.keys(selector);

    const nearMatches = allPods.filter((p) => {
      const labels = p.metadata?.labels || {};
      return selectorKeys.some((k) => k in labels);
    });

    if (nearMatches.length > 0) {
      const names = nearMatches.slice(0, 5).map((p) => p.metadata?.name).join(", ");
      steps.push({
        step: 4,
        label: "Check for similar labels",
        result: `${nearMatches.length} pod(s) have partial label match`,
        detail: `Near matches: ${names}`,
      });
    }

    return {
      steps,
      rootCause: `No pods in namespace "${namespace}" match selector: ${selectorStr}`,
      recommendations: [
        "Check if the selector labels match the pod template labels",
        "Verify pods are running in the correct namespace",
        `List pods: k8s_pod { action: "list", namespace: "${namespace}" }`,
      ],
    };
  }

  steps.push({ step: 3, label: "Find matching Pods", result: `${pods.length} pod(s) match` });

  // Step 4: Check pod readiness
  const readyPods = pods.filter((p) =>
    p.status?.conditions?.some((c) => c.type === "Ready" && c.status === "True")
  );

  if (readyPods.length === 0) {
    const notReadyPod = pods[0];
    steps.push({
      step: 4,
      label: "Check Pod readiness",
      result: "0 pods are Ready",
      detail: `All ${pods.length} matching pod(s) are not ready`,
    });
    return {
      steps,
      rootCause: `Matching pods exist but none are Ready`,
      recommendations: [
        `Troubleshoot pod: k8s_troubleshoot { action: "pod_not_ready", name: "${notReadyPod.metadata?.name}", namespace: "${namespace}" }`,
      ],
    };
  }

  // Step 5: Check port match
  const servicePorts = service.spec?.ports || [];
  steps.push({
    step: 5,
    label: "Check port configuration",
    result: `Service ports: ${servicePorts.map((p) => `${p.port}→${p.targetPort}`).join(", ")}`,
  });

  return {
    steps,
    rootCause: `${readyPods.length}/${pods.length} pods are Ready. Endpoints should exist — check Endpoint object directly`,
    recommendations: [
      `Check endpoints: kubectl get endpoints ${name} -n ${namespace}`,
      "Verify targetPort matches the container port",
    ],
  };
}

async function troubleshootNodeNotReady(
  clients: K8sClients,
  name: string
): Promise<Diagnosis> {
  const steps: DiagStep[] = [];
  const recommendations: string[] = [];

  // Step 1: Check node exists
  let node;
  try {
    const response = await clients.coreApi.readNode(name);
    node = response.body;
    steps.push({ step: 1, label: "Check Node existence", result: "OK" });
  } catch {
    steps.push({ step: 1, label: "Check Node existence", result: "NOT FOUND" });
    return {
      steps,
      rootCause: `Node ${name} does not exist`,
      recommendations: ["Verify node name is correct", "Check if the node was removed from the cluster"],
    };
  }

  // Step 2: Check conditions
  const conditions = node.status?.conditions || [];
  const pressureConditions = ["MemoryPressure", "DiskPressure", "PIDPressure", "NetworkUnavailable"];
  const issues: string[] = [];

  for (const c of conditions) {
    if (c.type === "Ready") {
      steps.push({
        step: 2,
        label: "Check Ready condition",
        result: `${c.status} (${c.reason || "—"})`,
        detail: c.message || undefined,
      });
      if (c.status !== "True") {
        issues.push(`Node is NotReady: ${c.reason || "unknown reason"} — ${c.message || ""}`);
      }
    }

    if (pressureConditions.includes(c.type || "") && c.status === "True") {
      steps.push({
        step: 3,
        label: `Check ${c.type}`,
        result: `True (${c.reason || "—"})`,
        detail: c.message || undefined,
      });
      issues.push(`${c.type}: ${c.message || c.reason || ""}`);
    }
  }

  // Step 3: Check node info
  const nodeInfo = node.status?.nodeInfo;
  if (nodeInfo) {
    steps.push({
      step: 4,
      label: "Check Node info",
      result: `kubelet ${nodeInfo.kubeletVersion}`,
      detail: `OS: ${nodeInfo.osImage || "—"}, Runtime: ${nodeInfo.containerRuntimeVersion || "—"}`,
    });
  }

  // Step 4: Check allocatable resources
  const allocatable = node.status?.allocatable;
  if (allocatable) {
    steps.push({
      step: 5,
      label: "Check allocatable resources",
      result: `CPU: ${allocatable.cpu}, Memory: ${allocatable.memory}`,
    });
  }

  if (issues.length === 0) {
    return {
      steps,
      rootCause: "Node appears healthy — Ready condition is True",
      recommendations: ["Monitor node for transient issues"],
    };
  }

  const rootCause = issues.join("; ");
  if (rootCause.includes("MemoryPressure")) {
    recommendations.push("Check for pods consuming excessive memory");
    recommendations.push("Consider adding more memory or draining workloads");
  }
  if (rootCause.includes("DiskPressure")) {
    recommendations.push("Clean up unused images and containers");
    recommendations.push("Check disk usage on the node");
  }
  if (rootCause.includes("PIDPressure")) {
    recommendations.push("Check for fork bombs or excessive process creation");
  }
  if (rootCause.includes("NetworkUnavailable")) {
    recommendations.push("Check CNI plugin status");
    recommendations.push("Verify network configuration on the node");
  }
  if (rootCause.includes("NotReady") && recommendations.length === 0) {
    recommendations.push("Check kubelet status on the node");
    recommendations.push("Check node connectivity and system resources");
    recommendations.push("Review kubelet logs: journalctl -u kubelet");
  }

  return { steps, rootCause, recommendations };
}

async function troubleshootPvcPending(
  clients: K8sClients,
  namespace: string,
  name: string
): Promise<Diagnosis> {
  const steps: DiagStep[] = [];
  const recommendations: string[] = [];

  // Step 1: Check PVC exists
  let pvc;
  try {
    const response = await clients.coreApi.readNamespacedPersistentVolumeClaim(name, namespace);
    pvc = response.body;
    steps.push({ step: 1, label: "Check PVC existence", result: "OK" });
  } catch {
    steps.push({ step: 1, label: "Check PVC existence", result: "NOT FOUND" });
    return {
      steps,
      rootCause: `PVC ${namespace}/${name} does not exist`,
      recommendations: ["Verify the PVC name and namespace are correct"],
    };
  }

  // Step 2: Check status
  const pvcPhase = pvc.status?.phase || "Unknown";
  steps.push({ step: 2, label: "Check PVC status", result: pvcPhase });

  if (pvcPhase === "Bound") {
    return {
      steps,
      rootCause: "PVC is already Bound — no issue found",
      recommendations: [],
    };
  }

  // Step 3: Check StorageClass
  const scName = pvc.spec?.storageClassName || "";
  if (scName) {
    try {
      const scResponse = await clients.storageApi.readStorageClass(scName);
      const sc = scResponse.body;
      steps.push({
        step: 3,
        label: "Check StorageClass",
        result: `"${scName}" exists`,
        detail: `Provisioner: ${sc.provisioner}, ReclaimPolicy: ${sc.reclaimPolicy || "Delete"}`,
      });
    } catch {
      steps.push({ step: 3, label: "Check StorageClass", result: `"${scName}" NOT FOUND` });
      return {
        steps,
        rootCause: `StorageClass "${scName}" referenced by PVC does not exist`,
        recommendations: [
          `Create the StorageClass "${scName}"`,
          "Or change the PVC to use an existing StorageClass",
          `List available: k8s_storage { action: "list_classes" }`,
        ],
      };
    }
  } else {
    steps.push({ step: 3, label: "Check StorageClass", result: "No StorageClass specified (using default)" });
  }

  // Step 4: Check access mode & matching PVs
  const accessModes = pvc.spec?.accessModes || [];
  const storage = pvc.spec?.resources?.requests?.storage || "—";
  steps.push({
    step: 4,
    label: "Check PVC requirements",
    result: `Size: ${storage}, Access: ${accessModes.join(",")}`,
  });

  // Step 5: Check events
  const events = await getEvents(clients, namespace, `involvedObject.name=${name}`);
  const warningEvents = events.filter((e) => e.type === "Warning");

  if (warningEvents.length > 0) {
    steps.push({
      step: 5,
      label: "Check events",
      result: `${warningEvents.length} warning(s)`,
      detail: formatEvents(warningEvents.slice(0, 5)),
    });

    const provisionFailed = warningEvents.find((e) => e.reason === "ProvisioningFailed");
    if (provisionFailed) {
      return {
        steps,
        rootCause: `Provisioning failed: ${provisionFailed.message}`,
        recommendations: [
          "Check the storage provisioner pods are running",
          "Verify cloud provider credentials for dynamic provisioning",
          "Check storage quota in the cloud provider",
        ],
      };
    }
  } else {
    steps.push({ step: 5, label: "Check events", result: "No warnings" });
  }

  return {
    steps,
    rootCause: `PVC is Pending — waiting for provisioner or matching PV`,
    recommendations: [
      "Check if the storage provisioner is running",
      "For static provisioning, create a PV matching the PVC requirements",
      `List PVs: k8s_storage { action: "list_pvs" }`,
      ...recommendations,
    ],
  };
}

async function troubleshootDeploymentStuck(
  clients: K8sClients,
  namespace: string,
  name: string
): Promise<Diagnosis> {
  const steps: DiagStep[] = [];
  const recommendations: string[] = [];

  // Step 1: Check deployment exists
  let deploy;
  try {
    const response = await clients.appsApi.readNamespacedDeployment(name, namespace);
    deploy = response.body;
    steps.push({ step: 1, label: "Check Deployment existence", result: "OK" });
  } catch {
    steps.push({ step: 1, label: "Check Deployment existence", result: "NOT FOUND" });
    return {
      steps,
      rootCause: `Deployment ${namespace}/${name} does not exist`,
      recommendations: ["Verify the deployment name and namespace are correct"],
    };
  }

  // Step 2: Check conditions
  const conditions = deploy.status?.conditions || [];
  for (const c of conditions) {
    const detail = c.message || undefined;
    steps.push({
      step: 2,
      label: `Check condition: ${c.type}`,
      result: `${c.status} (${c.reason || "—"})`,
      detail,
    });
  }

  const progressing = conditions.find((c) => c.type === "Progressing");
  const available = conditions.find((c) => c.type === "Available");

  // Step 3: Check replica counts
  const desired = deploy.spec?.replicas || 1;
  const ready = deploy.status?.readyReplicas || 0;
  const updated = deploy.status?.updatedReplicas || 0;
  const unavailable = deploy.status?.unavailableReplicas || 0;

  steps.push({
    step: 3,
    label: "Check replica counts",
    result: `Desired: ${desired}, Ready: ${ready}, Updated: ${updated}, Unavailable: ${unavailable}`,
  });

  // Step 4: Check ReplicaSets
  const labelSelector = Object.entries(deploy.spec?.selector?.matchLabels || {})
    .map(([k, v]) => `${k}=${v}`)
    .join(",");

  const rsResponse = await clients.appsApi.listNamespacedReplicaSet(
    namespace, undefined, undefined, undefined, undefined, labelSelector
  );
  const replicaSets = rsResponse.body.items || [];
  const latestRS = replicaSets
    .sort((a, b) => {
      const aRev = parseInt(a.metadata?.annotations?.["deployment.kubernetes.io/revision"] || "0", 10);
      const bRev = parseInt(b.metadata?.annotations?.["deployment.kubernetes.io/revision"] || "0", 10);
      return bRev - aRev;
    })[0];

  if (latestRS) {
    const rsReady = latestRS.status?.readyReplicas || 0;
    const rsDesired = latestRS.spec?.replicas || 0;
    steps.push({
      step: 4,
      label: `Check latest ReplicaSet "${latestRS.metadata?.name}"`,
      result: `${rsReady}/${rsDesired} ready`,
    });

    // Check if new RS pods are having issues
    if (rsReady < rsDesired) {
      const rsPodSelector = Object.entries(latestRS.spec?.selector?.matchLabels || {})
        .map(([k, v]) => `${k}=${v}`)
        .join(",");

      const podsResponse = await clients.coreApi.listNamespacedPod(
        namespace, undefined, undefined, undefined, undefined, rsPodSelector
      );
      const rsPods = podsResponse.body.items || [];

      const problemPods = rsPods.filter((p) =>
        p.status?.containerStatuses?.some(
          (cs) => cs.state?.waiting?.reason === "CrashLoopBackOff" ||
                  cs.state?.waiting?.reason === "ImagePullBackOff" ||
                  cs.state?.waiting?.reason === "ErrImagePull"
        )
      );

      if (problemPods.length > 0) {
        const firstPod = problemPods[0];
        const waitingContainer = firstPod.status?.containerStatuses?.find(
          (cs) => cs.state?.waiting
        );
        const reason = waitingContainer?.state?.waiting?.reason || "Unknown";
        steps.push({
          step: 5,
          label: "Check new Pod status",
          result: `${problemPods.length} pod(s) with issues: ${reason}`,
          detail: waitingContainer?.state?.waiting?.message || undefined,
        });

        return {
          steps,
          rootCause: `New pods failing: ${reason}`,
          recommendations: [
            `Troubleshoot failing pod: k8s_troubleshoot { action: "pod_not_ready", name: "${firstPod.metadata?.name}", namespace: "${namespace}" }`,
          ],
        };
      }
    }
  }

  // Step 5: Check events
  const events = await getEvents(clients, namespace, `involvedObject.name=${name}`);
  const warningEvents = events.filter((e) => e.type === "Warning");

  if (warningEvents.length > 0) {
    steps.push({
      step: 5,
      label: "Check events",
      result: `${warningEvents.length} warning(s)`,
      detail: formatEvents(warningEvents.slice(0, 5)),
    });

    const quotaEvent = warningEvents.find((e) =>
      e.message.includes("exceeded quota") || e.reason === "FailedCreate"
    );
    if (quotaEvent) {
      return {
        steps,
        rootCause: `Resource quota exceeded: ${quotaEvent.message}`,
        recommendations: [
          "Request quota increase or reduce resource requests",
          `Check quota: kubectl describe resourcequota -n ${namespace}`,
        ],
      };
    }
  } else {
    steps.push({ step: 5, label: "Check events", result: "No warnings" });
  }

  if (progressing?.reason === "ProgressDeadlineExceeded") {
    return {
      steps,
      rootCause: "Deployment progress deadline exceeded — rollout is stuck",
      recommendations: [
        `Check pod issues: k8s_troubleshoot { action: "pod_not_ready", name: "<pod-name>", namespace: "${namespace}" }`,
        `Consider rollback: k8s_helm { action: "rollback", release_name: "${name}" }`,
      ],
    };
  }

  if (available?.status !== "True") {
    return {
      steps,
      rootCause: `Deployment not available: ${ready}/${desired} replicas ready`,
      recommendations: [
        "Wait for pods to become ready",
        `Check individual pod status: k8s_pod { action: "list", namespace: "${namespace}", label_selector: "${labelSelector}" }`,
      ],
    };
  }

  return {
    steps,
    rootCause: `Deployment appears healthy: ${ready}/${desired} ready`,
    recommendations: [],
  };
}

async function autoDiagnose(
  clients: K8sClients,
  namespace: string,
  name: string,
  resourceType: string
): Promise<Diagnosis> {
  switch (resourceType.toLowerCase()) {
    case "pod":
      return troubleshootPodNotReady(clients, namespace, name);
    case "service":
    case "svc":
      return troubleshootServiceNoEndpoints(clients, namespace, name);
    case "node":
      return troubleshootNodeNotReady(clients, name);
    case "pvc":
    case "persistentvolumeclaim":
      return troubleshootPvcPending(clients, namespace, name);
    case "deployment":
    case "deploy":
      return troubleshootDeploymentStuck(clients, namespace, name);
    default:
      return {
        steps: [],
        rootCause: `Auto-diagnose not supported for resource type: ${resourceType}`,
        recommendations: [
          "Supported types: pod, service, node, pvc, deployment",
          `Try: k8s_troubleshoot { action: "pod_not_ready", name: "${name}" }`,
        ],
      };
  }
}

export async function handleK8sTroubleshoot(
  params: K8sTroubleshootParams,
  pluginConfig?: PluginConfig
): Promise<string> {
  try {
    const clients = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace || "default";

    if (!params.name) {
      throw new Error("name is required for troubleshooting");
    }

    switch (params.action) {
      case "pod_not_ready": {
        const diag = await troubleshootPodNotReady(clients, namespace, params.name);
        return formatDiagnosis(`Pod ${namespace}/${params.name}`, diag);
      }

      case "service_no_endpoints": {
        const diag = await troubleshootServiceNoEndpoints(clients, namespace, params.name);
        return formatDiagnosis(`Service ${namespace}/${params.name}`, diag);
      }

      case "node_not_ready": {
        const diag = await troubleshootNodeNotReady(clients, params.name);
        return formatDiagnosis(`Node ${params.name}`, diag);
      }

      case "pvc_pending": {
        const diag = await troubleshootPvcPending(clients, namespace, params.name);
        return formatDiagnosis(`PVC ${namespace}/${params.name}`, diag);
      }

      case "deployment_stuck": {
        const diag = await troubleshootDeploymentStuck(clients, namespace, params.name);
        return formatDiagnosis(`Deployment ${namespace}/${params.name}`, diag);
      }

      case "diagnose": {
        if (!params.resource_type) {
          throw new Error("resource_type is required for diagnose action");
        }
        const diag = await autoDiagnose(clients, namespace, params.name, params.resource_type);
        return formatDiagnosis(`${params.resource_type} ${namespace}/${params.name}`, diag);
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `troubleshoot ${params.action}`));
  }
}

