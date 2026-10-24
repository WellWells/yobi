/**
 * Every network's stations, sources and status pages in one place, plus the everyday names riders
 * use that are not station names. The landmark list is short on purpose: the model knows that 士林
 * 夜市 is at 劍潭 and passes the station; these are the names it might pass as they are.
 */
import { KLRT_STATIONS, KRTC_KLRT_TRANSFERS, KRTC_STATIONS } from './krtcStations';
import { klrtSource, krtcSource, krtcStatus } from './krtcSource';
import type { MetroCatalog } from './metroService';
import { NORTH_TRANSFERS } from './metroNetworks';
import type { TransferLink } from './metroNetworks';
import { fetchNoticeExcerpt, fetchNotices } from './metroNotices';
import type { MetroAlias } from './metroResolve';
import { ANKENG_STATIONS, DANHAI_STATIONS, SANYING_STATIONS } from './ntmetroStations';
import { ankengSource, danhaiSource, sanyingSource } from './ntmetroSource';
import { ntmetroStatus } from './ntmetroStatus';
import { TMRT_STATIONS } from './tmrtStations';
import { tmrtSource, tmrtStatus } from './tmrtSource';
import { TRTC_STATIONS } from './trtcStations';
import { trtcWithCircular } from './trtcCircular';
import { trtcStatus } from './trtcSource';
import { TYMC_STATIONS } from './tymcStations';
import { tymcSource, tymcStatus } from './tymcSource';

export const METRO_ALIASES: readonly MetroAlias[] = [
  { words: ['桃園機場', '桃園國際機場', '桃機', 'Taoyuan Airport'], stations: [{ network: 'tymc', zh: '機場第一航廈' }, { network: 'tymc', zh: '機場第二航廈' }] },
  { words: ['第一航廈', '一航', 'T1', '航廈一'], stations: [{ network: 'tymc', zh: '機場第一航廈' }] },
  { words: ['第二航廈', '二航', 'T2', '航廈二'], stations: [{ network: 'tymc', zh: '機場第二航廈' }] },
  { words: ['桃園高鐵', '高鐵桃園站'], stations: [{ network: 'tymc', zh: '高鐵桃園' }] },
  { words: ['北車'], stations: [{ network: 'trtc', zh: '台北車站' }, { network: 'tymc', zh: '台北車站' }] },
  { words: ['101', '台北101', '世貿中心'], stations: [{ network: 'trtc', zh: '台北101/世貿' }] },
  // The official 淡海 map prints 淡金北新 with (北投子) under it.
  { words: ['北投子'], stations: [{ network: 'danhai', zh: '淡金北新' }] },
  // Landmarks whose nearest station is not the one their name contains (士林夜市 is not by 士林):
  // Taipei Metro: 劍潭站「士林夜市，步行約6分鐘」; 三鶯線 LB09's exit 1 is signed 鶯歌陶瓷老街.
  { words: ['士林夜市'], stations: [{ network: 'trtc', zh: '劍潭' }] },
  { words: ['鶯歌老街', '陶瓷老街'], stations: [{ network: 'sanying', zh: '陶瓷老街' }] },
  { words: ['小巨蛋'], stations: [{ network: 'trtc', zh: '台北小巨蛋' }] },
  { words: ['台中高鐵', '高鐵台中'], stations: [{ network: 'tmrt', zh: '高鐵臺中站' }] },
  { words: ['小港機場', '高雄機場', '高雄小港機場'], stations: [{ network: 'krtc', zh: '高雄國際機場' }] },
  { words: ['左營高鐵', '高鐵左營', '新左營'], stations: [{ network: 'krtc', zh: '左營' }] },
];

const KAOHSIUNG_TRANSFERS: readonly TransferLink[] = KRTC_KLRT_TRANSFERS.map(({ krtc, klrt }) => ({
  a: { network: 'krtc', code: krtc },
  b: { network: 'klrt', code: klrt },
  cardDiscount: false,
}));

export const METRO_CATALOG: MetroCatalog = {
  stations: [
    ...TRTC_STATIONS, ...TYMC_STATIONS, ...DANHAI_STATIONS, ...ANKENG_STATIONS, ...SANYING_STATIONS,
    ...TMRT_STATIONS, ...KRTC_STATIONS, ...KLRT_STATIONS,
  ],
  aliases: METRO_ALIASES,
  sources: {
    trtc: trtcWithCircular,
    tymc: tymcSource,
    danhai: danhaiSource,
    ankeng: ankengSource,
    sanying: sanyingSource,
    tmrt: tmrtSource,
    krtc: krtcSource,
    klrt: klrtSource,
  },
  statusSources: [trtcStatus, tymcStatus, ntmetroStatus, tmrtStatus, krtcStatus],
  transfers: [...NORTH_TRANSFERS, ...KAOHSIUNG_TRANSFERS],
  notices: fetchNotices,
  noticeExcerpt: fetchNoticeExcerpt,
};
