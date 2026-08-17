// CSV export helpers. Pure functions, no IO. Aimed at both re-analysis
// (pandas / R / SPSS) and audit trails.

import type { Opinion } from "../types";

// RFC 4180 escaping: double the quotes, wrap in quotes when the value contains , " or newlines.
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(values: unknown[]): string {
  return values.map(csvEscape).join(",");
}

/**
 * Flatten opinions to CSV. Includes a run_id column so multiple runs can be
 * concatenated and still separated cleanly.
 */
export function opinionsToCsv(
  opinions: Opinion[],
  context: { runId?: string; topic?: string; country?: string } = {},
): string {
  const header = [
    "run_id",
    "topic",
    "country",
    "persona_id",
    "persona_name",
    "age",
    "sex",
    "occupation",
    "location",
    "marital_status",
    "text",
  ];
  const lines: string[] = [csvRow(header)];
  for (const o of opinions) {
    lines.push(
      csvRow([
        context.runId ?? "",
        context.topic ?? "",
        context.country ?? "",
        o.personaId,
        o.name,
        o.attributes.age,
        o.attributes.sex,
        o.attributes.occupation,
        o.attributes.location,
        o.attributes.marital_status,
        o.text,
      ]),
    );
  }
  // UTF-8 BOM so Excel doesn't mangle non-ASCII text
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

// Filesystem/HTTP-safe filename: keep ASCII alphanumerics plus - _ only.
export function safeFilename(stem: string, ext: string): string {
  const cleaned = stem
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
  return `${cleaned || "export"}.${ext}`;
}
