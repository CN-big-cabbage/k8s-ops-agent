#!/usr/bin/env node

import { buildCli } from "../cli.js";
import type { PluginConfig } from "@k8s-ops/core";

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

const program = buildCli(config);
program.parse();
