// Fisher–Yates shuffle, non-mutating. `random` is injectable for
// deterministic tests and sampling.
export function shuffle<T>(arr: T[], random: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    // i (>0) and j (0..i) are always valid indexes, so both elements exist.
    const ai = a[i] as T;
    a[i] = a[j] as T;
    a[j] = ai;
  }
  return a;
}
