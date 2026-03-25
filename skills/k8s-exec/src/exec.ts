import * as k8s from "@kubernetes/client-node";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { z } from "zod";
import { createK8sClients } from "../../../lib/client.js";
import { truncateOutput } from "../../../lib/format.js";
import { wrapK8sError } from "../../../lib/errors.js";
import type { PluginConfig } from "../../../lib/types.js";
import { MAX_OUTPUT_BYTES, EXEC_TIMEOUT_MS, DEFAULT_NAMESPACE } from "../../../lib/types.js";
import * as stream from "stream";

const K8sExecSchema = z.object({
  action: z.enum(["exec", "file_read", "file_list", "env", "process_list", "network_check"]),
  namespace: z.string().default(DEFAULT_NAMESPACE),
  pod_name: z.string(),
  container: z.string().optional(),
  command: z.string().optional(),
  file_path: z.string().optional(),
  directory: z.string().default("/"),
  target_host: z.string().optional(),
  target_port: z.number().int().positive().optional(),
  context: z.string().optional(),
});

type K8sExecParams = z.infer<typeof K8sExecSchema>;

async function execInPod(
  kc: k8s.KubeConfig,
  namespace: string,
  podName: string,
  containerName: string | undefined,
  command: string[]
): Promise<{ stdout: string; stderr: string }> {
  const exec = new k8s.Exec(kc);

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const stdoutStream = new stream.Writable({
      write(chunk, _encoding, callback) {
        stdout += chunk.toString();
        callback();
      },
    });

    const stderrStream = new stream.Writable({
      write(chunk, _encoding, callback) {
        stderr += chunk.toString();
        callback();
      },
    });

    const timeout = setTimeout(() => {
      reject(new Error(`Command timed out after ${EXEC_TIMEOUT_MS / 1000} seconds`));
    }, EXEC_TIMEOUT_MS);

    exec
      .exec(
        namespace,
        podName,
        containerName ?? "",
        command,
        stdoutStream,
        stderrStream,
        null, // stdin
        false, // tty
        (status: k8s.V1Status) => {
          clearTimeout(timeout);
          if (status.status === "Success") {
            resolve({ stdout, stderr });
          } else {
            reject(new Error(status.message || `Command failed: ${command.join(" ")}`));
          }
        }
      )
      .catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
  });
}

function buildExecCommand(params: K8sExecParams): string[] {
  switch (params.action) {
    case "exec":
      if (!params.command) throw new Error("command is required for exec action");
      return ["sh", "-c", params.command];

    case "file_read":
      if (!params.file_path) throw new Error("file_path is required for file_read action");
      return ["cat", params.file_path];

    case "file_list":
      return ["ls", "-la", params.directory];

    case "env":
      return ["env"];

    case "process_list":
      return ["sh", "-c", "ps aux 2>/dev/null || ls -la /proc/[0-9]* 2>/dev/null | head -50"];

    case "network_check": {
      if (!params.target_host) throw new Error("target_host is required for network_check action");
      const port = params.target_port || 80;
      const host = params.target_host;
      // Try multiple tools in order of availability
      return [
        "sh",
        "-c",
        `if command -v curl >/dev/null 2>&1; then curl -sf --connect-timeout 5 -o /dev/null -w "Connected to ${host}:${port} (HTTP %{http_code}) in %{time_connect}s" "http://${host}:${port}" 2>&1 || curl -sf --connect-timeout 5 -o /dev/null "http://${host}:${port}" 2>&1; ` +
        `elif command -v wget >/dev/null 2>&1; then wget -q --timeout=5 --spider "http://${host}:${port}" 2>&1 && echo "Connected to ${host}:${port}" || echo "Failed to connect to ${host}:${port}"; ` +
        `elif command -v nc >/dev/null 2>&1; then nc -zv -w5 "${host}" ${port} 2>&1; ` +
        `else echo "No network tools available (curl/wget/nc not found)"; fi`,
      ];
    }

    default:
      throw new Error(`Unknown action: ${params.action}`);
  }
}

async function handleK8sExec(params: K8sExecParams, pluginConfig?: PluginConfig): Promise<string> {
  try {
    const { kc } = createK8sClients(pluginConfig, params.context);
    const command = buildExecCommand(params);

    const { stdout, stderr } = await execInPod(
      kc,
      params.namespace,
      params.pod_name,
      params.container,
      command
    );

    let output = "";
    if (stdout) output += stdout;
    if (stderr) output += (output ? "\n\n--- stderr ---\n" : "") + stderr;
    if (!output) output = "(no output)";

    return truncateOutput(output, MAX_OUTPUT_BYTES);
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `exec ${params.action} in ${params.namespace}/${params.pod_name}`));
  }
}

export function registerK8sExecTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_exec",
    description:
      "Kubernetes container execution: exec commands, read files, list directories, view env vars, list processes, check network connectivity",
    schema: K8sExecSchema,
    handler: async (params: K8sExecParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sExec(params, pluginConfig);
    },
  });
}
