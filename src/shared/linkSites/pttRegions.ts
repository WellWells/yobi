/**
 * PTT writes where an article was posted from by name, after the address, on the system line and
 * on an edit's line. The name is PTT's own (Traditional Chinese), so
 * no address is looked up anywhere. A name not listed here keeps no flag, only its words.
 */
const REGION_CODES: Record<string, string> = {
  臺灣: 'TW', 台灣: 'TW', 香港: 'HK', 澳門: 'MO', 中國: 'CN', 日本: 'JP', 南韓: 'KR', 韓國: 'KR', 大韓民國: 'KR',
  新加坡: 'SG', 馬來西亞: 'MY', 泰國: 'TH', 越南: 'VN', 菲律賓: 'PH', 印尼: 'ID', 印度尼西亞: 'ID', 印度: 'IN',
  柬埔寨: 'KH', 緬甸: 'MM', 寮國: 'LA', 蒙古: 'MN', 汶萊: 'BN', 巴基斯坦: 'PK', 孟加拉: 'BD',
  美國: 'US', 加拿大: 'CA', 墨西哥: 'MX', 巴西: 'BR', 阿根廷: 'AR', 智利: 'CL', 秘魯: 'PE', 哥倫比亞: 'CO',
  英國: 'GB', 愛爾蘭: 'IE', 法國: 'FR', 德國: 'DE', 荷蘭: 'NL', 比利時: 'BE', 盧森堡: 'LU', 瑞士: 'CH',
  奧地利: 'AT', 義大利: 'IT', 西班牙: 'ES', 葡萄牙: 'PT', 瑞典: 'SE', 挪威: 'NO', 芬蘭: 'FI', 丹麥: 'DK',
  冰島: 'IS', 波蘭: 'PL', 捷克: 'CZ', 匈牙利: 'HU', 希臘: 'GR', 羅馬尼亞: 'RO', 烏克蘭: 'UA', 俄羅斯: 'RU',
  土耳其: 'TR', 以色列: 'IL', 阿拉伯聯合大公國: 'AE', 沙烏地阿拉伯: 'SA', 卡達: 'QA',
  澳洲: 'AU', 澳大利亞: 'AU', 紐西蘭: 'NZ', 南非: 'ZA', 埃及: 'EG',
};

/** Every code a name above maps to: the desktop chat carries a flag for each. */
export const PTT_REGION_CODES: readonly string[] = [...new Set(Object.values(REGION_CODES))];

/** The ISO 3166 code for a region as PTT names it; "" for one it does not list. */
export function pttRegionCode(name: string): string {
  return REGION_CODES[name.trim()] ?? '';
}

/** A two-letter region code as its flag emoji (regional indicator letters); "" for anything else. */
export function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...Array.from(code, (letter) => 0x1_f1e6 + letter.charCodeAt(0) - 65));
}
