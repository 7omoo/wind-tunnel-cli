// Sanitize user input before embedding it in LLM prompts.
// Strips common prompt-injection patterns while preserving legitimate content.
// maxLen is the final truncation cap (topic default 5000; supplemental context
// passes CONTEXT_MAX_CHARS instead).
export function sanitizePromptInput(input: string, maxLen = 5000): string {
  let sanitized = input;
  // Normalize Unicode lookalikes (Cyrillic S, A, etc.) that bypass \b word boundaries
  sanitized = sanitized.normalize("NFKC");
  // Remove zero-width and invisible format characters used to split filter keywords
  sanitized = sanitized.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, "");
  // Remove system/assistant role injection attempts (case-insensitive, no \b for CJK compat)
  sanitized = sanitized.replace(/(^|\s)(system|assistant|user|human)\s*:/gim, "$1");
  // Remove instruction override attempts — expanded synonym coverage
  sanitized = sanitized.replace(
    /(ignore|disregard|forget|override|bypass|skip)\s+(all\s+)?(previous|above|prior|earlier|existing|current)\s+(instructions?|prompts?|rules?|context)/gi,
    "[filtered]",
  );
  sanitized = sanitized.replace(/new\s+instructions?\s*:/gi, "[filtered]");
  sanitized = sanitized.replace(/IMPORTANT\s*:/gi, "[filtered]");
  // Remove attempts to close/reopen prompt blocks
  sanitized = sanitized.replace(/```/g, "");
  sanitized = sanitized.replace(/~~~/g, "");
  // Trim excessive length
  return sanitized.slice(0, maxLen).trim();
}

// Escape LLM-generated text before re-embedding it in subsequent prompts.
// Prevents indirect prompt injection via model outputs.
export function escapeForPrompt(text: string): string {
  let escaped = text;
  // Collapse multiple newlines (prevents fake section breaks)
  escaped = escaped.replace(/\n{3,}/g, "\n\n");
  // Neutralize role injection patterns in model output
  escaped = escaped.replace(/(^|\n)\s*(system|assistant|user|human)\s*:/gim, "$1[speaker]:");
  // Neutralize instruction-like phrases
  escaped = escaped.replace(/IMPORTANT\s*:/gi, "Note:");
  escaped = escaped.replace(/```/g, "");
  return escaped;
}
