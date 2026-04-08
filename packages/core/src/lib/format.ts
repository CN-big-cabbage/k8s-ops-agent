export function formatAge(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffDay > 0) return `${diffDay}d`;
  if (diffHour > 0) return `${diffHour}h`;
  if (diffMin > 0) return `${diffMin}m`;
  return `${diffSec}s`;
}

export function formatTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) => {
    const maxRowWidth = rows.length > 0 ? Math.max(...rows.map((r) => (r[i] || "").length)) : 0;
    return Math.max(h.length, maxRowWidth);
  });

  const headerRow = headers.map((h, i) => h.padEnd(colWidths[i])).join("  ");
  const separator = colWidths.map((w) => "-".repeat(w)).join("  ");

  const dataRows = rows.map((row) =>
    row.map((cell, i) => (cell || "").padEnd(colWidths[i])).join("  ")
  );

  return [headerRow, separator, ...dataRows].join("\n");
}

export function statusSymbol(status: string): string {
  const successStates = ["Running", "Ready", "True", "Succeeded", "Active", "Healthy", "Available"];
  const failureStates = ["Failed", "False", "Error", "CrashLoopBackOff", "ImagePullBackOff", "OOMKilled"];

  if (successStates.includes(status)) return "✓";
  if (failureStates.includes(status)) return "✗";
  return "⟳";
}

export function truncateOutput(output: string, maxBytes: number): string {
  if (Buffer.byteLength(output, "utf-8") <= maxBytes) return output;
  const truncated = Buffer.from(output, "utf-8").subarray(0, maxBytes).toString("utf-8");
  return truncated + `\n\n--- Output truncated (exceeded ${Math.round(maxBytes / 1024)}KB limit) ---`;
}
