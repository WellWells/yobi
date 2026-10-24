/**
 * Simplified → Traditional (Taiwan) for the closed vocabulary tyme4ts emits: activity names,
 * spirits, mansions, Na Yin, Peng Zu lines, fetus-god positions, solar terms, lunar festivals.
 *
 * A general converter is wrong here in ways an almanac reader notices at once: opencc turns the
 * mansion 斗 into 鬥, the branch 丑 inside a Peng Zu line into 醜, the fetus god's 占 into 佔, and
 * leaves 上梁 where Taiwanese almanacs print 上樑. So the map is per character, checked against
 * every name in the library's tables, and the few characters an almanac never converts
 * (丑 占 斗 采 咸 后) are simply absent from it.
 */

const SIMPLIFIED =
  '专东丧临习乡产亲仓仪会佣儿党养内军冲击剑动劳匮医单厌厕厨参发启国圣坏坟墙处复头妇娄学宁宝对寿将尝岁师帐带并庆库庙废开张强归惊愿执扫护挂摇敌斋断时机杨树栖桥殓毕气涂涧渔游满灯灾炉猎猪疮盖祸离种穷竖筑纯纳织经结绘络绝续网肠腊艺节药虚蚁蛰蜡补见触订讼词诸谢财败货贼车轸还进远酱针钏钗钻锋错长门闭问闰阳阴阵陈难雇雳颠风饰馀马驿鸟鸡鸣黄龙齐买酝酿铸贵疗';
const TRADITIONAL =
  '專東喪臨習鄉產親倉儀會傭兒黨養內軍衝擊劍動勞匱醫單厭廁廚參發啟國聖壞墳牆處復頭婦婁學寧寶對壽將嘗歲師帳帶並慶庫廟廢開張強歸驚願執掃護掛搖敵齋斷時機楊樹棲橋殮畢氣塗澗漁遊滿燈災爐獵豬瘡蓋禍離種窮豎築純納織經結繪絡絕續網腸臘藝節藥虛蟻蟄蠟補見觸訂訟詞諸謝財敗貨賊車軫還進遠醬針釧釵鑽鋒錯長門閉問閏陽陰陣陳難僱靂顛風飾餘馬驛鳥雞鳴黃龍齊買醞釀鑄貴療';

/** Whole names whose Traditional form is not the per-character one. Checked before the map. */
const PHRASES: Readonly<Record<string, string>> = {
  益后: '益後',
  谷雨: '穀雨',
  理发: '理髮',
  启钻: '啟攢',
  上梁: '上樑',
  作梁: '作樑',
};

const CHAR_MAP: ReadonlyMap<string, string> = new Map(
  [...SIMPLIFIED].map((ch, i) => [ch, [...TRADITIONAL][i]] as const),
);

export function toHant(text: string): string {
  const whole = PHRASES[text];
  if (whole) return whole;
  let out = text;
  for (const [from, to] of Object.entries(PHRASES)) out = out.split(from).join(to);
  return [...out].map((ch) => CHAR_MAP.get(ch) ?? ch).join('');
}

export const ALMANAC_HANT_TABLE = { simplified: SIMPLIFIED, traditional: TRADITIONAL, phrases: PHRASES } as const;
