import { Command } from "commander";
import { skillRegistry, type PluginConfig } from "@k8s-ops/core";

function skillNameToCommand(name: string): string {
  return name
    .replace(/^k8s_/, "")
    .replace(/^sys_/, "sys-")
    .replace(/_/g, "-");
}

export function buildCli(config: PluginConfig): Command {
  const program = new Command()
    .name("k8s-ops")
    .description("Kubernetes operations toolkit")
    .version("1.0.0");

  for (const skill of skillRegistry) {
    const cmdName = skillNameToCommand(skill.name);

    program
      .command(cmdName)
      .description(skill.description)
      .option("-n, --namespace <namespace>", "Kubernetes namespace")
      .option("--all-namespaces", "All namespaces")
      .option("--context <context>", "Kubernetes context")
      .argument("[action]", "Action to perform")
      .argument("[args...]", "Additional arguments")
      .action(async (action: string | undefined, args: string[], options: Record<string, unknown>) => {
        try {
          const params: Record<string, unknown> = { ...options };
          if (action) {
            params.action = action;
          }

          for (const arg of args) {
            const eqIndex = arg.indexOf("=");
            if (eqIndex > 0) {
              params[arg.slice(0, eqIndex)] = arg.slice(eqIndex + 1);
            }
          }

          const result = await skill.handler(params, config);
          process.stdout.write(result + "\n");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(`Error: ${message}\n`);
          process.exit(1);
        }
      });
  }

  return program;
}
