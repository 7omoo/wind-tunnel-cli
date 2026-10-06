// An error whose message already tells the user what to do ("no persona pool
// installed — run: wt-cli personas pull usa"). The CLI shows it as written,
// without adding a classified headline or generic hints.
export class CuratedError extends Error {
  override name = "CuratedError";
}
