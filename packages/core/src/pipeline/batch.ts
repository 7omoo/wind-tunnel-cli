// Wave-based batch execution shared by the LLM stages (react, score, stance).
// A wave of `concurrency` requests is issued with Promise.allSettled, then the
// next wave starts — matching how the Ollama daemon actually serves requests
// (slots, then queue). Per-item failures are captured, never thrown.

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  const step = Math.max(1, size);
  for (let i = 0; i < items.length; i += step) {
    out.push(items.slice(i, i + step));
  }
  return out;
}

// Yields each wave's settled results (in input order) as soon as that wave
// finishes, before the next one starts. For stages that stream results out
// (react); `index` is the item's position in `items`.
export async function* settleWaves<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): AsyncGenerator<PromiseSettledResult<R>[]> {
  let offset = 0;
  for (const wave of chunk(items, concurrency)) {
    const start = offset;
    yield await Promise.allSettled(wave.map((item, i) => fn(item, start + i)));
    offset += wave.length;
  }
}

// settleWaves collected into one array (input order), with progress per wave.
export async function mapWaves<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for await (const settled of settleWaves(items, concurrency, fn)) {
    results.push(...settled);
    onProgress?.(results.length, items.length);
  }
  return results;
}
