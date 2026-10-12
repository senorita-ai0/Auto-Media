// Best-of-N generation. The generation, validation and scoring functions are injected so the selection logic is
// pure and testable without any AI provider.

export function clampVariantCount(value, max = 4) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(max, n);
}

/**
 * Generate up to `count` candidates sequentially (to respect provider rate limits), drop the ones that fail
 * validation, and return the highest-scoring one. With count = 1 behaviour is identical to a single call:
 * a validation error is thrown rather than swallowed.
 *
 * generate(index)  -> candidate
 * validate(c)      -> throws when the candidate is unusable
 * score(c)         -> number (higher is better); ties keep the earliest candidate
 * summarize(c)     -> small plain object stored with the content so reviewers can compare alternatives
 */
export async function generateVariants({ count = 1, generate, validate = () => {}, score, summarize = c => ({ value: c }) }) {
  const total = clampVariantCount(count);
  if (total === 1) {
    const only = await generate(0);
    validate(only);
    return { generated: only, chosenIndex: 0, alternatives: [] };
  }

  const usable = [];
  let lastError = null;
  for (let index = 0; index < total; index++) {
    try {
      const candidate = await generate(index);
      validate(candidate);
      usable.push({ index, candidate, score: Number(score(candidate)) || 0 });
    } catch (error) {
      lastError = error;
    }
  }
  if (!usable.length) throw lastError || new Error("No usable candidate was generated.");

  let best = usable[0];
  for (const entry of usable) if (entry.score > best.score) best = entry;
  return {
    generated: best.candidate,
    chosenIndex: best.index,
    alternatives: usable.map(entry => ({ ...summarize(entry.candidate), score: entry.score, chosen: entry.index === best.index }))
  };
}
