/**
 * How the eight networks join: their names, the city each is in, where a rider walks from one to
 * another, and what that costs. A trip across two networks is two fares; the only discount is New
 * Taipei's: 8 元 off (4 元 on 敬老／愛心／兒童 cards) when a stored-value card (悠遊卡、一卡通、愛金卡)
 * changes between Taipei Metro and the 淡海、安坑 light rails or the 三鶯線 within an hour, either
 * way (metro.taipei 轉乘優惠 and ntmetro.com.tw node 10102, read 2026-10-22). Neither Taipei Metro
 * nor the airport line lists any discount between them, nor KRTC between its MRT and light rail.
 */
import type { MetroNetwork, MetroOperator } from './metroTypes';

export type MetroRegion = 'north' | 'central' | 'south';

export interface NetworkInfo {
  zh: string;
  en: string;
  region: MetroRegion;
  operator: MetroOperator;
}

export const NETWORK_INFO: Readonly<Record<MetroNetwork, NetworkInfo>> = {
  trtc: { zh: '台北捷運', en: 'Taipei Metro', region: 'north', operator: 'trtc' },
  tymc: { zh: '桃園機場捷運', en: 'Taoyuan Airport MRT', region: 'north', operator: 'tymc' },
  danhai: { zh: '淡海輕軌', en: 'Danhai LRT', region: 'north', operator: 'ntmetro' },
  ankeng: { zh: '安坑輕軌', en: 'Ankeng LRT', region: 'north', operator: 'ntmetro' },
  sanying: { zh: '三鶯線', en: 'Sanying Line', region: 'north', operator: 'ntmetro' },
  tmrt: { zh: '台中捷運', en: 'Taichung MRT', region: 'central', operator: 'tmrt' },
  krtc: { zh: '高雄捷運', en: 'Kaohsiung MRT', region: 'south', operator: 'krtc' },
  klrt: { zh: '高雄環狀輕軌', en: 'Kaohsiung Circular LRT', region: 'south', operator: 'krtc' },
};

export function networkName(network: MetroNetwork): string {
  return NETWORK_INFO[network].zh;
}

/** The card discount on a New Taipei transfer, adult card. */
export const NTMETRO_TRANSFER_DISCOUNT_NTD = 8;

export interface TransferLink {
  a: { network: MetroNetwork; code: string };
  b: { network: MetroNetwork; code: string };
  /** The New Taipei card transfer discount applies here. */
  cardDiscount: boolean;
}

/** Where the northern networks meet Taipei Metro: each is the same place under both names. */
export const NORTH_TRANSFERS: readonly TransferLink[] = [
  { a: { network: 'trtc', code: 'R10' }, b: { network: 'tymc', code: 'A1' }, cardDiscount: false }, // 台北車站
  { a: { network: 'trtc', code: 'O15' }, b: { network: 'tymc', code: 'A2' }, cardDiscount: false }, // 三重
  { a: { network: 'trtc', code: 'Y20' }, b: { network: 'tymc', code: 'A3' }, cardDiscount: false }, // 新北產業園區
  { a: { network: 'trtc', code: 'R27' }, b: { network: 'danhai', code: 'V01' }, cardDiscount: true }, // 紅樹林
  { a: { network: 'trtc', code: 'Y08' }, b: { network: 'ankeng', code: 'K09' }, cardDiscount: true }, // 十四張
  { a: { network: 'trtc', code: 'BL01' }, b: { network: 'sanying', code: 'LB01' }, cardDiscount: true }, // 頂埔
];

/** A rider's walk between two networks' platforms, in minutes, allowed when timing the next leg. */
export const TRANSFER_ALLOWANCE_MIN = 10;
