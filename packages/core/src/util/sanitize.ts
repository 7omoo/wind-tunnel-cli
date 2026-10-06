// Preparing text for LLM prompts.
//
// User-supplied text (the post under test, optional background) is embedded
// verbatim. This is a message-testing tool: rewriting the copy — even phrases
// like "IMPORTANT:" or "our assistant:" that look like injections — would make
// every persona react to text the user never wrote. The defense is structural
// instead: callers clamp the length and wrap the text in a tagged block
// (quoteUntrusted) that the prompt declares to be material, not instructions.

// Trims and caps user text. maxLen defaults to the topic cap; supplemental
// context passes CONTEXT_MAX_CHARS.
export function clampPromptInput(input: string, maxLen = 5000): string {
  return input.trim().slice(0, maxLen).trim();
}

// Wraps text in <tag>…</tag>. The only way out of the block is a literal
// closing tag inside the text, so that alone is defused; nothing else changes.
// `tag` is an internal constant (letters only), never user input.
export function quoteUntrusted(tag: string, text: string): string {
  const closing = new RegExp(`</\\s*${tag}\\s*>`, "gi");
  return `<${tag}>\n${text.replace(closing, `<\\/${tag}>`)}\n</${tag}>`;
}

// Escape LLM-generated text before re-embedding it in subsequent prompts.
// Prevents indirect prompt injection via model outputs.
//
// Applied to upstream *analysis* output that a later prompt treats as context
// (group names, beliefs, triggers, the safe version — see prompts/suggest.ts).
// Persona reactions are deliberately NOT escaped where they are the material
// under analysis (scoring, verdict, stances, propositions): rewriting them
// would change what is being measured, the same reason the user's copy is
// embedded verbatim.
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
