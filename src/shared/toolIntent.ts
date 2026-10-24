import { stripUnreadableRegions } from './connectorKeywords';

/**
 * Whether a plain-chat message asks for something only a lookup can answer: weather, air quality,
 * a stock price, an exchange rate, the lunar date or the almanac, the receipt lottery, or what is new right now. Such a message runs as an agent turn
 * (that message only; the composer mode is left as the user set it). Each topic must come with a
 * question about it, so mentioning the weather in passing does not count. Code and quoted lines
 * never count.
 */

/** A question or a request for the figure, close after the topic word. */
const ASKING = '[^。\\n]{0,10}?(?:如何|怎麼樣|怎么样|怎樣|怎样|好嗎|好吗|嗎|吗|呢|多少|幾度|几度|幾點|几点|預報|预报|會不會|会不会|\\?|？)';

/** Asking for the list or the item, close after a "what is new" word. */
const LISTING = '[^。\\n]{0,12}?(?:有哪些|有什麼|有什么|是哪|哪些|哪款|哪個|哪个|是什麼|是什么|推薦|推荐|嗎|吗|呢|\\?|？)';

/** Asking which day, or what the almanac says about one, close after an almanac word. */
const ALMANAC_ASKING = '[^。\\n]{0,10}?(?:幾號|几号|幾月|几月|初幾|初几|哪天|哪一天|哪幾天|哪几天|是什麼|是什么|多少|宜|忌|沖|冲|嗎|吗|呢|\\?|？)';

const TOOL_PHRASES: readonly RegExp[] = [
  // weather
  new RegExp(`(?:天氣|天气|氣溫|气温|溫度|温度|降雨機率|降雨机率|體感溫度|体感温度|紫外線|紫外线)${ASKING}`),
  /(?:會不會|会不会|要不要帶傘|要不要带伞)[^。\n]{0,6}(?:下雨|下雪)/,
  /(?<![a-z])(?:weather|forecast)(?![a-z])[^.\n]{0,30}(?:\?|today|tomorrow|tonight|this week)/i,
  /(?<![a-z])(?:what'?s|how'?s|what is|how is)\s+the\s+(?:weather|temperature)(?![a-z])/i,
  // air quality
  new RegExp(`(?:空氣品質|空气质量|空品|AQI|PM2\\.?5)${ASKING}`, 'i'),
  // stock price
  new RegExp(`(?:股價|股价|收盤價|收盘价|現在多少錢一股)${ASKING}`),
  /(?<![a-z])stock\s+price(?![a-z])/i,
  // exchange rate
  new RegExp(`(?:匯率|汇率)${ASKING}`),
  /(?<![a-z])exchange\s+rate(?![a-z])/i,
  // The lunar date and the almanac: 「今天是農曆？」 was answered 九月十二 from memory (2026-10-22, it was 九月十三).
  new RegExp(`(?:農曆|农历|陰曆|阴历|農民曆|农民历|黃曆|黄历|通勝|通胜|宜忌|黃道吉日|黄道吉日|好日子|吉日)${ALMANAC_ASKING}`),
  new RegExp(`(?:適合|适合|宜不宜|可以)[^。\\n]{0,4}?(?:搬家|入宅|入厝|結婚|结婚|嫁娶|訂婚|订婚|開市|开市|開業|开业|開工|开工|動土|动土|出行|安葬|安床)[^。\\n]{0,6}?(?:嗎|吗|\\?|？|哪天|哪一天|哪幾天|哪几天)`),
  new RegExp(`(?:春節|春节|元宵|端午|七夕|中元|中秋|重陽|重阳|除夕|冬至|清明)(?:節|节)?[^。\\n]{0,4}?(?:是|在)?(?:幾號|几号|幾月|几月|哪天|哪一天|什麼時候|什么时候|星期幾|星期几)`),
  /(?<![a-z])(?:lunar\s+(?:date|calendar)|chinese\s+almanac)(?![a-z])[^.\n]{0,30}\?/i,
  // The receipt lottery: new numbers every two months, so a model's memory is always a period behind.
  // 對發票 only as its own verb: 核對發票金額 and 針對發票 are bookkeeping, not the lottery.
  /(?<![核比校針针])(?:對|对)(?:一下)?(?:統一|统一)?(?:發票|发票)/,
  new RegExp('(?:發票|发票)[^。\\n]{0,6}?(?:中獎|中奖|開獎|开奖|對獎|对奖)'),
  new RegExp('(?:這期|这期|本期|上期|上一期|最新一期)(?:的)?(?:統一|统一)?(?:發票|发票)'),
  new RegExp('(?<![\\dA-Za-z])(?:[A-Za-z]{2}[-\\s]?)?\\d{8}(?!\\d)[^。\\n]{0,6}?(?:有沒有中|有没有中|中了嗎|中了吗|有中嗎|有中吗|中獎|中奖)'),
  /(?<![a-z])(?:receipt|uniform[-\s]+invoice|invoice)\s+(?:lottery|winning\s+numbers?)(?![a-z])/i,
  // What is new right now (releases, launches, the news): only when asked about, not merely named.
  new RegExp(`(?:新上映|上映中|即將上映|近期上映|院線|新上市|新推出|剛發表|新發表|最新款|最新版|最新型號|最新消息|新聞|新闻|頭條|头条|快訊|快讯)${LISTING}`),
  new RegExp(`最新(?:的)?[^。\\n]{0,12}?(?:有哪些|是哪|哪款|哪個|哪个|是什麼|是什么)`),
  new RegExp(`(?:今天|今日|最近|這週|这周|本週|本周)[^。\\n]{0,8}?(?:新聞|新闻|頭條|头条|大事)`),
];

export function looksLikeToolRequest(text: string): boolean {
  const haystack = stripUnreadableRegions(text).trim();
  if (!haystack) return false;
  return TOOL_PHRASES.some((pattern) => pattern.test(haystack));
}
