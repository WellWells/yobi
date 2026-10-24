/**
 * Taipei Metro's quote, with the Circular line's own arrival board. Taipei Metro prices Y trips
 * and its route planner gives one departure; New Taipei, which runs the line, publishes the next
 * trains at every Y station (`circular_time.php`). So a trip that starts and ends on Y, asked
 * about now, gets the board's departures; anything else is Taipei Metro's quote as it is.
 */
import { CIRCULAR_BOARD_PAGE, circularDepartures } from './ntmetroLive';
import { trtcSource } from './trtcSource';
import type { MetroStation, NetworkSource } from './metroTypes';

function onCircular(station: MetroStation): boolean {
  return station.codes.some((code) => code.startsWith('Y'));
}

export const trtcWithCircular: NetworkSource = {
  network: 'trtc',
  async quote(from, to, when, deps) {
    const quote = await trtcSource.quote(from, to, when, deps);
    if (!when.isNow || !onCircular(from) || !onCircular(to)) return quote;
    try {
      const board = await circularDepartures(from, to, deps);
      return board.length > 0
        ? { ...quote, departures: board, sources: [...quote.sources, CIRCULAR_BOARD_PAGE] }
        : quote;
    } catch {
      // The board is extra: Taipei Metro's own answer stands without it.
      return quote;
    }
  },
};
