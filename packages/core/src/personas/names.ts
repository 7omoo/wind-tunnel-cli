// Extract a display name from the professional_persona prose. The Nemotron
// datasets embed the name in the first sentence; the pattern differs per locale.

import type { Country } from "../types";

export function extractName(professionalPersona: string, country: Country): string {
  // Non-jp pools use Latin/English-style name extraction. jp cuts before "は".
  // Non-Latin scripts (kr/vn) aren't matched precisely but fall back to the
  // leading tokens without breaking.
  if (country !== "jp") {
    // Each capture group [1] always exists when the pattern matches, but
    // noUncheckedIndexedAccess types it as | undefined — hence the guards.
    const m1 = professionalPersona.match(/^(.+?),\s*a\s/);
    if (m1?.[1]) return m1[1];
    const m2 = professionalPersona.match(/^(.+?)\s+is\s/);
    if (m2?.[1]) return m2[1];
    const m3 = professionalPersona.match(
      /named\s+([A-Z][a-z\u00C0-\u024F\-']+(?:\s+[A-Z][a-z\u00C0-\u024F\-']+)+)/,
    );
    if (m3?.[1]) return m3[1];
    const m4 = professionalPersona.match(
      /^((?:(?:Dr|Mr|Mrs|Ms|Prof)\.\s+)?[A-Z][a-z\u00C0-\u024F\-']+(?:\s+[A-Z][a-z\u00C0-\u024F\-']+){1,3})/,
    );
    if (m4?.[1]) return m4[1];
    return professionalPersona
      .split(/[\s,]+/)
      .slice(0, 3)
      .join(" ");
  }
  // String.split always returns a non-empty array, so [0] exists (?? "" is a safety valve).
  return professionalPersona.split("は")[0] ?? "";
}
