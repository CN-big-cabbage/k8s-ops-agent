#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { skillRegistry, type PluginConfig } from "@k8s-ops/core";

function loadConfigFromEnv(): PluginConfig {
  const config: PluginConfig = {};

  if (process.env.KUBECONFIG) {
    config.kubeconfigPath = process.env.KUBECONFIG;
  }

  if (process.env.K8S_CONTEXT) {
    config.defaultContext = process.env.K8S_CONTEXT;
  }

  if (process.env.K8S_OPS_SSH_HOSTS) {
    try {
      config.hosts = JSON.parse(process.env.K8S_OPS_SSH_HOSTS);
    } catch {
      console.error("Warning: K8S_OPS_SSH_HOSTS is not valid JSON, ignoring");
    }
  }

  return config;
}

function createServer(config: PluginConfig): McpServer {
  const server = new McpServer({
    name: "k8s-ops",
    version: "1.0.0",
  });

  for (const skill of skillRegistry) {
    server.tool(
      skill.name,
      skill.description,
      async (params: Record<string, unknown>) => {
        try {
          const result = await skill.handler(params, config);
          return {
            content: [{ type: "text" as const, text: result }],
          };
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text" as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
