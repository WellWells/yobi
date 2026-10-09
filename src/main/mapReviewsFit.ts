import type { MapReview } from './mapReviews';

function nextToDrop(reviews: readonly MapReview[], kept: readonly boolean[]): number {
  const counts = new Map<number, number>();
  reviews.forEach((entry, index) => {
    if (kept[index]) counts.set(entry.rating, (counts.get(entry.rating) ?? 0) + 1);
  });
  let target = Number.NEGATIVE_INFINITY;
  let most = 0;
  for (const [rating, count] of counts) {
    if (count > most || (count === most && rating > target)) {
      target = rating;
      most = count;
    }
  }
  for (let index = reviews.length - 1; index >= 0; index--) {
    if (kept[index] && reviews[index].rating === target) return index;
  }
  return -1;
}

/**
 * The reviews whose JSON array fits `limit` under the provider's own `measure`. Whole reviews go,
 * from the most common star level, oldest first (the sample is newest-first).
 */
export function fitReviews(
  reviews: readonly MapReview[],
  limit: number,
  measure: (text: string) => number,
): MapReview[] {
  const sizes = reviews.map((entry) => measure(JSON.stringify(entry)));
  const comma = measure(',');
  const kept = reviews.map(() => true);
  let count = reviews.length;
  let total = measure('[]') + sizes.reduce((sum, size) => sum + size, 0) + Math.max(0, count - 1) * comma;

  while (count > 0 && total > limit) {
    const index = nextToDrop(reviews, kept);
    if (index < 0) break;
    kept[index] = false;
    count--;
    total -= sizes[index] + (count > 0 ? comma : 0);
  }
  return reviews.filter((_entry, index) => kept[index]);
}
