// Wave-based batch execution shared by the LLM map stages (score, stance).
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

export async function mapWaves<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  let done = 0;
  for (const wave of chunk(items, concurrency)) {
    const offset = results.length;
    const settled = await Promise.allSettled(wave.map((item, i) => fn(item, offset + i)));
    results.push(...settled);
    done += wave.length;
    onProgress?.(done, items.length);
  }
  return results;
}
