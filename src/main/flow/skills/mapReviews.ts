import { fetchMapReviews, SORT_ORDER, type MapReviewSort } from '../../mapReviews';
import { fetchPlaceStats, localizedVerdict } from '../../mapPlaceStats';
import { config } from '../../config';
import { getLangCache } from '../../i18n';
import { sendLog } from '../../helpers';

const DEFAULT_COUNT = 100;
const MIN_COUNT = 10;
const MAX_COUNT = 300;

export async function execGmapReviews(skillConfig: Record<string, string>): Promise<string> {
  const url = (skillConfig.url ?? '').trim();
  if (!url) {
    sendLog('🗺️ [Flow] Maps Reviews: empty URL — returning []');
    return '[]';
  }

  const sortRaw = (skillConfig.sort ?? 'mixed').trim();
  const sort: MapReviewSort | 'mixed' = sortRaw in SORT_ORDER ? (sortRaw as MapReviewSort) : 'mixed';
  const parsed = Number.parseInt(skillConfig.count ?? '', 10);
  const count = Number.isFinite(parsed) ? Math.min(Math.max(parsed, MIN_COUNT), MAX_COUNT) : DEFAULT_COUNT;

  sendLog(`🗺️ [Flow] Maps Reviews step — ${url} (sort=${sort}, count=${count})`);
  try {
    const result = await fetchMapReviews(url, {
      sort,
      count,
      hl: config.locale,
      onLog: (message) => sendLog(`🗺️ [Flow] Maps Reviews: ${message}`),
    });
    sendLog(`🗺️ [Flow] Maps Reviews: ${result.reviews.length} review(s) fetched`);

    const stats = await fetchPlaceStats(result.placeUrl, {
      onLog: (message) => sendLog(`🗺️ [Flow] ${message}`),
    }).catch(() => null);

    const { verdict, tier } = localizedVerdict(stats?.rating ?? '', stats?.total ?? '', getLangCache());

    return JSON.stringify({
      output: JSON.stringify(result.reviews),
      place: result.place,
      rating: stats?.rating ?? '',
      total: stats?.total ?? '',
      distribution: stats?.distribution ?? '',
      positive: stats?.positive ?? '',
      verdict,
      tier,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendLog(`⚠️ [Flow] Maps Reviews failed: ${message}`);
    return '[]';
  }
}
