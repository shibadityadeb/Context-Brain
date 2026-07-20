/**
 * Map over items with a bounded number of in-flight operations. Critical for
 * large corpora: a multi-hour transcript can produce dozens of chunks, and
 * firing every Codex child process at once would exhaust the machine. Results
 * preserve input order.
 *
 * @param items Inputs to process.
 * @param limit Max operations in flight (coerced to >= 1).
 * @param fn Async mapper receiving the item and its index.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const width = Math.max(1, Math.floor(limit));
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index] as T, index);
    }
  }

  const workers = Array.from({ length: Math.min(width, items.length) }, worker);
  await Promise.all(workers);
  return results;
}
