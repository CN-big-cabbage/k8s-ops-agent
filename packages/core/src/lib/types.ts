export interface HostConfig {
  name: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
}

export interface PluginConfig {
  kubeconfigPath?: string;
  defaultContext?: string;
  hosts?: HostConfig[];
}

export const MAX_OUTPUT_BYTES = 10 * 1024; // 10KB output limit
export const DEFAULT_NAMESPACE = "default";
export const EXEC_TIMEOUT_MS = 30_000; // 30 seconds
export const MAX_LOG_LINES = 1000;
export const DEFAULT_LOG_LINES = 100;
