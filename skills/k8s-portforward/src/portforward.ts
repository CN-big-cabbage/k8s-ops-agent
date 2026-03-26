import { spawn } from "child_process";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { z } from "zod";
import { createK8sClients } from "../../../lib/client.js";
import { wrapK8sError } from "../../../lib/errors.js";
import type { PluginConfig } from "../../../lib/types.js";

// Zod schema for k8s_portforward tool parameters
const K8sPortForwardSchema = z.object({
  action: z.enum(["create", "create_service_forward", "list", "close", "close_pod", "close_all", "test"]),
  namespace: z.string().optional(),
  pod_name: z.string().optional(),
  service_name: z.string().optional(),
  local_port: z.number().int().positive().optional(),
  pod_port: z.number().int().positive().optional(),
  target_port: z.number().int().positive().optional(),
  context: z.string().optional(),
});

type K8sPortForwardParams = z.infer<typeof K8sPortForwardSchema>;

// Store active port forwards in memory
const activeForwards: Map<number, {
  namespace: string;
  podName: string;
  process: ReturnType<typeof spawn>;
  startTime: Date;
}> = new Map();

function findAvailablePort(): number {
  // Try common ports first
  const commonPorts = [8080, 3000, 5000, 5432, 6379, 27017, 9200];
  for (const port of commonPorts) {
    if (!activeForwards.has(port)) {
      return port;
    }
  }
  // Fall back to random port in range 10000-60000
  for (let port = 10000; port <= 60000; port++) {
    if (!activeForwards.has(port)) {
      return port;
    }
  }
  throw new Error("No available ports");
}

async function handleK8sPortForward(params: K8sPortForwardParams, pluginConfig?: PluginConfig): Promise<string> {
  try {
    const { coreApi } = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace || "default";

    switch (params.action) {
      case "create": {
        if (!params.pod_name) {
          throw new Error("pod_name is required for create action");
        }
        if (!params.pod_port) {
          throw new Error("pod_port is required for create action");
        }

        const localPort = params.local_port || findAvailablePort();
        
        // Check if pod exists
        try {
          await coreApi.readNamespacedPod(params.pod_name, namespace);
        } catch {
          throw new Error(`Pod ${namespace}/${params.pod_name} not found`);
        }

        if (activeForwards.has(localPort)) {
          throw new Error(`Port ${localPort} is already in use`);
        }

        // Build kubectl port-forward command
        const kubeconfigArg = pluginConfig?.kubeconfigPath 
          ? `--kubeconfig=${pluginConfig.kubeconfigPath}` 
          : '';
        const contextArg = params.context ? `--context=${params.context}` : '';
        
        const cmd = "kubectl";
        const args = [
          ...kubeconfigArg.split(' ').filter(Boolean),
          ...contextArg.split(' ').filter(Boolean),
          "port-forward",
          `-n=${namespace}`,
          params.pod_name,
          `${localPort}:${params.pod_port}`
        ].filter(Boolean);

        const proc = spawn(cmd, args, {
          stdio: ['ignore', 'pipe', 'pipe']
        });

        // Wait for the forward to establish by listening for stdout/stderr
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Port forward timed out after 10 seconds"));
          }, 10000);

          proc.stdout?.on('data', (data: Buffer) => {
            const msg = data.toString();
            if (msg.includes('Forwarding')) {
              clearTimeout(timeout);
              resolve();
            }
          });

          let stderrOutput = '';
          proc.stderr?.on('data', (data: Buffer) => {
            stderrOutput += data.toString();
          });

          proc.on('error', (err) => {
            clearTimeout(timeout);
            reject(new Error(`Failed to start port forward: ${err.message}`));
          });

          proc.on('exit', (code) => {
            if (code !== 0) {
              clearTimeout(timeout);
              reject(new Error(`Port forward exited with code ${code}: ${stderrOutput}`));
            }
          });
        });

        activeForwards.set(localPort, {
          namespace,
          podName: params.pod_name,
          process: proc,
          startTime: new Date()
        });

        return `Port forward created successfully:\n- Local port: ${localPort}\n- Pod: ${namespace}/${params.pod_name}\n- Pod port: ${params.pod_port}\n- Use 'curl http://localhost:${localPort}' to test\n\nNote: Port forward will remain active until closed or pod terminates.`;
      }

      case "create_service_forward": {
        if (!params.service_name) {
          throw new Error("service_name is required for create_service_forward action");
        }
        if (!params.target_port) {
          throw new Error("target_port is required for create_service_forward action");
        }

        const localPort = params.local_port || findAvailablePort();
        
        // Get service to find backend pods
        try {
          await coreApi.readNamespacedService(params.service_name, namespace);
        } catch {
          throw new Error(`Service ${namespace}/${params.service_name} not found`);
        }

        if (activeForwards.has(localPort)) {
          throw new Error(`Port ${localPort} is already in use`);
        }

        const kubeconfigArg = pluginConfig?.kubeconfigPath
          ? `--kubeconfig=${pluginConfig.kubeconfigPath}`
          : '';
        const contextArg = params.context ? `--context=${params.context}` : '';

        const cmd = "kubectl";
        const args = [
          ...kubeconfigArg.split(' ').filter(Boolean),
          ...contextArg.split(' ').filter(Boolean),
          "port-forward",
          `-n=${namespace}`,
          `svc/${params.service_name}`,
          `${localPort}:${params.target_port}`
        ].filter(Boolean);

        const proc = spawn(cmd, args, {
          stdio: ['ignore', 'pipe', 'pipe']
        });

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Service port forward timed out after 10 seconds"));
          }, 10000);

          proc.stdout?.on('data', (data: Buffer) => {
            const msg = data.toString();
            if (msg.includes('Forwarding')) {
              clearTimeout(timeout);
              resolve();
            }
          });

          let stderrOutput = '';
          proc.stderr?.on('data', (data: Buffer) => {
            stderrOutput += data.toString();
          });

          proc.on('error', (err) => {
            clearTimeout(timeout);
            reject(new Error(`Failed to start service port forward: ${err.message}`));
          });

          proc.on('exit', (code) => {
            if (code !== 0) {
              clearTimeout(timeout);
              reject(new Error(`Service port forward exited with code ${code}: ${stderrOutput}`));
            }
          });
        });

        activeForwards.set(localPort, {
          namespace,
          podName: `svc/${params.service_name}`,
          process: proc,
          startTime: new Date()
        });

        return `Service port forward created:\n- Local port: ${localPort}\n- Service: ${namespace}/${params.service_name}\n- Target port: ${params.target_port}\n\nNote: Service port forwarding may require the service to have external traffic policy enabled.`;
      }

      case "list": {
        if (activeForwards.size === 0) {
          return "No active port forwards.";
        }

        let result = "Active Port Forwards:\n\n";
        result += "LOCAL PORT | POD/SERVICE | NAMESPACE | STARTED | PID\n";
        result += "-----------|-------------|-----------|---------|-----\n";
        
        activeForwards.forEach((info, port) => {
          const started = info.startTime.toLocaleTimeString();
          const pid = info.process.pid || "unknown";
          const pod = info.podName.length > 15 ? info.podName.substring(0, 12) + "..." : info.podName;
          result += `${port}         | ${pod.padEnd(13)} | ${info.namespace.padEnd(9)} | ${started} | ${pid}\n`;
        });

        return result;
      }

      case "close": {
        if (!params.local_port) {
          throw new Error("local_port is required for close action");
        }

        const forward = activeForwards.get(params.local_port);
        if (!forward) {
          return `No active port forward on port ${params.local_port}`;
        }

        forward.process.kill();
        activeForwards.delete(params.local_port);

        return `Port forward on local port ${params.local_port} closed.`;
      }

      case "close_pod": {
        if (!params.pod_name) {
          throw new Error("pod_name is required for close_pod action");
        }

        const targetNamespace = params.namespace || "default";
        let closedPorts: number[] = [];

        activeForwards.forEach((info, port) => {
          if (info.podName === params.pod_name && info.namespace === targetNamespace) {
            info.process.kill();
            activeForwards.delete(port);
            closedPorts.push(port);
          }
        });

        if (closedPorts.length === 0) {
          return `No active port forwards found for pod ${targetNamespace}/${params.pod_name}`;
        }

        return `Closed port forward(s) ${closedPorts.join(", ")} for pod ${targetNamespace}/${params.pod_name}`;
      }

      case "close_all": {
        const count = activeForwards.size;
        
        activeForwards.forEach((info) => {
          info.process.kill();
        });
        activeForwards.clear();

        return `Closed ${count} port forward(s).`;
      }

      case "test": {
        if (!params.local_port) {
          throw new Error("local_port is required for test action");
        }

        const forward = activeForwards.get(params.local_port);
        if (!forward) {
          return `No active port forward on port ${params.local_port}`;
        }

        // Try to connect to the port
        const net = await import('net');
        
        return new Promise<string>((resolve) => {
          const socket = new net.Socket();
          socket.setTimeout(3000);
          
          socket.on('connect', () => {
            socket.destroy();
            resolve(`Port ${params.local_port} is reachable - forward is active!`);
          });
          
          socket.on('timeout', () => {
            socket.destroy();
            resolve(`Port ${params.local_port} exists but not responding (may still be initializing)`);
          });
          
          socket.on('error', (err) => {
            resolve(`Port ${params.local_port} error: ${err.message}`);
          });
          
          socket.connect(params.local_port, '127.0.0.1');
        });
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `portforward ${params.action}`));
  }
}

export function registerK8sPortForwardTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_portforward",
    description: "Kubernetes port forwarding: create, list, close port forwards to pods/services",
    schema: K8sPortForwardSchema,
    handler: async (params: K8sPortForwardParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sPortForward(params, pluginConfig);
    },
  });
}