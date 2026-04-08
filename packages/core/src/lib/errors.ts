export function wrapK8sError(error: unknown, operation: string): string {
  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    (error as any).response?.body?.message
  ) {
    return `[${operation}] Kubernetes API error: ${(error as any).response.body.message}`;
  }

  if (error instanceof Error) {
    return `[${operation}] Error: ${error.message}`;
  }

  return `[${operation}] Unknown error: ${String(error)}`;
}
