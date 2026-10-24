import { stripUnreadableRegions } from './connectorKeywords';
import { looksLikeFlowRequest } from './flowIntent';
import { looksLikeWebSearchRequest } from './webIntent';
import { isDesktopBuiltinFlowId } from './linkSites/registry';
import { PROVIDER_URLS, isByokTargetUrl, providerFromUrl } from './types';

/*
 * A message asking for a picture: "幫我畫一隻柴犬", "產生一張狗的圖", "draw a cat", optionally
 * naming who draws ("使用 gpt 產生…"; nobody named = Gemini). Only Gemini's and ChatGPT's web
 * pages can draw; unless the chat's own send is the one asked for and comes back with the picture,
 * such a message is answered by Yobi's image command on that page, for that message only. Charts
 * and diagrams are not pictures: a model answers them as text (Mermaid, a table), so they stay.
 */

/** The built-in that draws: a desktop chat command (its id is its command) and the bot's run. */
export const IMAGE_CHAT_FLOW_ID = 'builtin-image';

/** Longer than this is a pasted text that mentions pictures, not a request for one. */
const MAX_REQUEST_CHARS = 400;

const MEASURE = '(?:一|兩|两|三|幾|几|\\d+)?\\s*(?:張|张|幅|個|个|隻|只|款|組|组)?';
const NOUN = '(?:圖片|图片|圖像|图像|插圖|插图|插畫|插画|照片|相片|桌布|壁紙|壁纸|頭像|头像|大頭貼|大头贴|海報|海报|貼圖|贴图|圖示|图标|頭貼|头贴|logo|LOGO|Logo|圖|图|畫(?!面)|画(?!面))';
/** A 圖 that is a chart, a map or a diagram (or a screenshot) — not something to draw. */
const NOT_A_PICTURE = /(?:地圖|地图|流程圖|流程图|架構圖|架构图|心智圖|心智图|思維導圖|思维导图|甘特圖|甘特图|時序圖|时序图|序列圖|序列图|關係圖|关系图|示意圖|示意图|統計圖|统计图|長條圖|长条图|圓餅圖|圆饼图|折線圖|折线图|圖表|图表|截圖|截图|表格|ER圖|UML)/;

/**
 * 我做的這張圖 / 我剛畫的圖 / 同事設計的這張海報 / 做好的那張圖: one somebody already has, not one
 * to make — unless a new one is asked for later (我做的這張海報，再做一張夏天版). 幫我做的圖要… is
 * the one to make; 你做的那張圖 may be the last one drawn, to edit.
 */
const ALREADY_MADE = '(?!(?:(?<=(?<![幫帮替給给叫讓让])(?:我|他|她|同事|朋友)(?:剛剛?|刚刚?|自己|昨天|今天|之前|上次)?(?:做|畫|画|設計|设计|生成|製作|制作))好?的(?:[這这那]|圖|图)|(?<=(?<![幫帮替給给叫讓让]我)做)好的[這这那])(?![^]*?(?:畫|画|繪|绘|做|設計|设计|生成|產生|产生|製作|制作)\\s*(?:一|兩|两|三|\\d+)\\s*[張张幅個个隻只款]))';

const CJK_REQUESTS: readonly RegExp[] = [
  // 畫一隻狗 / 畫張圖 / 畫出… — but not 計畫一下, 規畫, 刻畫, 比畫, 畫一下重點, nor the nouns in
  // 動畫一季 / 漫畫出到第幾集 / 這幅畫出自梵谷之手 / 畫出自誰之手 (畫出自由女神 still draws)
  /(?<![計计規规企策刻比動动漫幅])(?:畫|画|繪|绘)(?!一下|重點|重点|線|线|面|出自(?:誰|谁|哪|何))(?:一|兩|两|三|幾|几|\d|個|个|張|张|幅|隻|只|出|成)/,
  new RegExp(`(?:幫我|帮我|請|请|給我|给我)?(?:畫|画|繪|绘)${ALREADY_MADE}(?:一下)?${MEASURE}[^，。,.!?！？\\n]{0,12}?${NOUN}`),
  new RegExp(`(?:生成|產生|产生|產出|产出|製作|制作|做|創作|创作|設計|设计|給我|给我|來|来|弄)${ALREADY_MADE}\\s*${MEASURE}[^，。,.!?！？\\n]{0,14}?${NOUN}`),
  // 產圖 / 生圖, the everyday short forms — not 學生圖書館, 衛生圖, 人生圖鑑, 出生圖騰
  /(?<![學学醫医衛卫先師师考])(?:產|产|生)(?:圖|图)(?![書书鑑鉴騰腾])/,
];

const EN_REQUESTS: readonly RegExp[] = [
  // "draw a (clear) conclusion / comparison …", "draw the attention of …", "draw a parallel between",
  // "draw a blank" draw nothing.
  /(?<![a-z])(?:draw|paint|sketch|illustrate)(?![a-z])\s+(?:me\s+)?(?:a|an|some|the|\d+|two|three|my|our)(?![a-z])(?!\s+(?:(?:(?:final|right|wrong|correct|logical|same|clear|reasonable|meaningful|quick|general|firm|valid|useful|hasty|obvious)\s+)?conclusion|comparison|distinction)s?(?![a-z-])(?!\s+(?:scene|panel|page|frame)s?(?![a-z])|[^.?!\n]{0,60}?\s+as\s+(?:an?\s+)?(?:poster|painting|mural|cartoon|comic|illustration|picture|drawing|image)s?(?![a-z]))|\s+(?:attention|inspiration)(?:\s+(?:of|from|to)(?![a-z])|\s*(?:$|[.,!?]))|\s+(?:parallel\s+(?:between|with|to)|lesson\s+from|blank(?:\s+(?:on|when)|\s*(?:$|[.,!?])))(?![a-z]))/i,
  // A docker / disk image, an image classifier / url / slider / file (unless "of" or "with a"
  // something) is software, and "make sure the image …" makes nothing.
  /(?<![a-z])(?:generate|create|make|design|render|produce|give me)(?![a-z])[^.?!\n]{0,40}?(?<![a-z])(?:(?<!(?:docker|container|disk|vm)\s|(?:classifier|url|link)\s+for\s+(?:an?\s+)?|sure\s+(?:the|this|that|my|your|an?)\s+)images?(?![\s-]+(?:(?:classifier|classification|recognition|url|link|tag)s?|processing|from\s+(?:(?:this|the|my|a)\s+)?dockerfile|(?:(?:a\s+(?:bit|little)|slightly|much|\d+\s*%)\s+)?(?:smaller|bigger|larger)|load(?:s|ing)?|responsive|clickable|cent(?:er|re)(?:ed)?[\s-]+aligned|fit\s+(?:the|its)\s+(?:container|screen|div|parent|page|width)|full[\s-]width|carousel|slider|upload(?:er|s)?|cropper|resizer|compressor|component|gallery\s+component)(?![a-z]))(?!\s+(?:file|size)s?(?![a-z])(?!(?:[^.?!\n]|\.(?=\S)){0,40}(?:(?:(?<![a-z])(?:of|showing|depicting|featuring|containing|that\s+shows|with\s+(?:an?\s+)?(?!(?:python|code|javascript|typescript|java|php|ruby|node|css|html|pillow|pil|opencv|matplotlib|numpy|bash|powershell|imagemagick|ffmpeg|canvas|sharp|swift|kotlin|rust|golang)(?![a-z]))[a-z]+)|,\s*an?(?!\s+(?:lot|bit|little)))(?![a-z])|\s*[:—–]\s|\s-\s)))|(?:picture|photo|illustration|drawing|painting|logo|wallpaper|poster|icon|avatar|portrait)s?)(?![a-z])(?!\s+(?:folders?|director(?:y|ies))(?![a-z]))/i,
];

/** Asking how pictures are made, or about one, is a question for the chat, not a request to draw. */
const ASKING_ABOUT = /(?:怎麼|怎么|如何|為什麼|为什么|為何|为何|教我|教學|教学|教程|方法|工具|網站|网站|哪裡|哪里|是什麼|是什么|(?<![a-z])(?:how (?:to|do|can|does)|why|what is|which (?:tool|app|site)|tutorial)(?![a-z]))/i;
/**
 * A question about paintings as things — 國畫一般用什麼紙, 這位畫家一生畫了幾幅畫, 油畫和水彩畫哪個難:
 * the painting comes before any drawing, its clause has a question word (not right after the verb:
 * 國畫風格畫幾隻貓, 畫點什麼 draw) or ends in 嗎 (國畫一般用宣紙嗎, 哪位畫家畫了…), and no drawing is
 * asked for after it (國畫裡有什麼動物？畫一隻給我 / 幫我畫圖). The kind of painting counts only as a
 * noun: 用水墨畫一些竹子 / 用油畫畫 / Q版畫一隻 / 名字畫成 / 畫家裡的客廳 draw.
 */
const PAINTING_NOUN = /(?<![用以拿][水素]?)[國国油墨版壁字名彩描](?:畫|画)(?!(?:[一兩两三幾几\d]\s*)?[個个張张幅隻只匹條条棵朵位座頭头群]|一[些點点片堆]|出|成|畫|画|的?[風风])|(?:畫|画)家(?![裡里族具人鄉乡貓猫狗常庭門门園园屋中附])/;
const CLAUSE_START = /[^，,。.！!？?；;\n]*$/;
const WH_IN_CLAUSE = /^[^，,。.！!？?；;\n]*?(?:(?<!(?:^|[^國国油墨版壁字名彩描])[畫画繪绘][點点]?)(?:什麼|什么|甚麼|甚么|哪|誰|谁|多少|多久|幾|几)|(?<!(?:生成|產生|产生|做|製作|制作|設計|设计|(?:可以|能|幫我|帮我|給我|给我|替我|請|请)(?:畫|画|繪|绘))[^，,。.！!？?；;\n]{0,6})[嗎吗](?=\s*(?:[，,。.！!？?；;\n]|$)))/;
// 幫我畫圖 / ？畫貓的圖 after the question asks for one; 一生畫了幾幅畫 does not.
const ASKED_TO_DRAW = new RegExp(`(?:[，,。.！!？?；;\\n]|幫我|帮我|給我|给我|替我|請|请)\\s*(?:畫|画|繪|绘)(?![了過过])(?:一下)?${MEASURE}[^，。,.!?！？\\n]{0,12}?${NOUN}`);
const DRAW_AFTER = [CJK_REQUESTS[0], ASKED_TO_DRAW, CJK_REQUESTS[2], CJK_REQUESTS[3]];

function asksAboutPaintings(text: string): boolean {
  const noun = PAINTING_NOUN.exec(text);
  if (!noun) return false;
  const clause = text.slice(0, noun.index).search(CLAUSE_START);
  if (!WH_IN_CLAUSE.test(text.slice(clause))) return false;
  const after = text.slice(noun.index + noun[0].length);
  if (DRAW_AFTER.some((pattern) => pattern.test(after))) return false;
  return CJK_REQUESTS.every((pattern) => (pattern.exec(text)?.index ?? Infinity) >= noun.index);
}

const EN_NOT_A_PICTURE = /(?<![a-z])(?:chart|diagram|flowchart|graph|table|spreadsheet|screenshot|mermaid)s?(?![a-z])/i;

/**
 * "幫我產生圖片：<what to draw>": an instruction that opens the message and ends at a colon or a line
 * break is judged alone, and what follows is the material, however long and whatever it says (a
 * pasted answer saying "I have no image tool" carries 工具). Only an instruction — the verb first,
 * or 幫我／請… then the verb — not a title such as "AI 生成圖片：三款比較".
 */
const MAX_HEAD_CHARS = 30;
const MAX_MATERIAL_CHARS = 4_000;
// A colon between digits (16:9, 12:30) is a ratio or a time, not the end of a head.
const HEAD_END = /(?<!\d)[：:]|[：:](?!\d)|\n/;
const INSTRUCTION_HEAD = /^(?:(?:請|请|麻煩|麻烦)\s*)?(?:你\s*)?(?:(?:可以|能)\s*)?(?:(?:幫我|帮我|替我)\s*)?(?:畫|画|繪|绘|生成|產生|产生|產出|产出|產圖|产图|生圖|生图|製作|制作|做|創作|创作|設計|设计|給我|给我|來|来|弄)|^(?:please\s+)?(?:(?:can|could) you\s+)?(?:draw|paint|sketch|illustrate|generate|create|make|design|render|produce|give me)(?![a-z])/i;

/**
 * "把這段話翻譯成英文：<text>", "把「…」翻成日文": what is quoted or follows is the text to translate,
 * whatever it says. Only an instruction opening the message — not 我的工作是翻譯 or a title such as
 * 翻譯社的 logo / Translate app logo.
 */
const TRANSLATE_HEAD = /^(?:(?:請|请|麻煩|麻烦)\s*)?(?:你\s*)?(?:(?:可以|能)\s*)?(?:我(?:要|想要?)\s*)?(?:(?:幫我|帮我|替我|幫忙|帮忙)\s*)?(?:[把將将][^：:\n]{0,15}?|(?:這段|这段|這句|这句|以下|下面)[^：:\n]{0,6}?)?(?:(?:翻譯|翻译)(?:一下)?(?:這段|这段|這句|这句|以下|下面)?(?:話|话)?|(?:翻譯|翻译|翻|譯|译)(?:成|為|为)?\s*(?:[英中日韓韩法德俄泰越台臺粵粤][文語语]|白話|白话|文言|繁體|繁体|簡體|简体|english|chinese|japanese))(?:\s*(?:好?[嗎吗]|[，,]?\s*(?:謝謝|谢谢)|[並并][^：:\n]{0,6}))?$|^(?:[英中日韓韩][翻譯译][英中日韓韩]|[英中日韓韩法德][文語语](?:翻譯|翻译))$|^(?:please\s+)?(?:(?:can|could) you\s+)?translate(?:\s+(?:this|that|these|it|the following|to|into|from|me)(?![a-z])|\s*$)/i;
/** An English translate instruction may run longer than other heads before its colon. */
const MAX_TRANSLATE_HEAD_CHARS = 60;
const QUOTED_TRANSLATION = /^(?:(?:請|请)\s*)?(?:(?:幫我|帮我)\s*)?把\s*[「『"“][^」』"”]+[」』"”]\s*(?:翻譯|翻译|翻|譯|译)(?:成|為|为)|^(?:please\s+)?translate\s+["“「]/i;

function instructionHead(text: string): string | null {
  const end = text.search(HEAD_END);
  if (end <= 0 || end > MAX_TRANSLATE_HEAD_CHARS) return null;
  const head = text.slice(0, end).trim();
  if (TRANSLATE_HEAD.test(head)) return head;
  return end <= MAX_HEAD_CHARS && INSTRUCTION_HEAD.test(head) ? head : null;
}

function asksForPicture(text: string): boolean {
  if (ASKING_ABOUT.test(text)) return false;
  if (CJK_REQUESTS.some((pattern) => pattern.test(text))) {
    return !NOT_A_PICTURE.test(text) && !asksAboutPaintings(text);
  }
  if (EN_REQUESTS.some((pattern) => pattern.test(text))) return !EN_NOT_A_PICTURE.test(text);
  return false;
}

export function looksLikeImageRequest(text: string): boolean {
  const haystack = stripUnreadableRegions(text).trim();
  if (!haystack || QUOTED_TRANSLATION.test(haystack)) return false;
  const head = instructionHead(haystack);
  if (head !== null) return haystack.length <= MAX_MATERIAL_CHARS && asksForPicture(head);
  return haystack.length <= MAX_REQUEST_CHARS && asksForPicture(haystack);
}

/**
 * Whether the picture is all a picture request asks for, so the image command may take it without
 * an agent turn. It is a shortcut, not the only way to a picture — the agent draws too
 * (`draw_image`) — so anything more goes to the agent: "建立一個每天產生一張貓圖的流程" asks for a
 * flow, "上網查最新的 iPhone 再畫一張圖" for the web first, "用 Notion 的資料生成一張圖" for Notion.
 */
export function pictureIsWholeJob(text: string, namesConnector: boolean): boolean {
  return !namesConnector && !looksLikeFlowRequest(text) && !looksLikeWebSearchRequest(text);
}

/**
 * Whether an ordinary send to `targetUrl` already comes back with the picture: Gemini's page draws
 * in any chat, ChatGPT's only outside its temporary chat. Never in the agent (its replies are a
 * tool protocol) and never on a BYOK key.
 */
export function chatSendDraws(targetUrl: string, opts: { agent: boolean; temporary: boolean }): boolean {
  if (opts.agent || !targetUrl || isByokTargetUrl(targetUrl)) return false;
  const provider = providerFromUrl(targetUrl);
  if (provider === 'gemini') return true;
  return provider === 'chatgpt' && !opts.temporary;
}

/** The web pages that draw. */
export type ImageProvider = 'gemini' | 'chatgpt';

/**
 * Naming who draws, as the user says it (2026-10-19: "使用 gemini 產生XXX的圖", "使用 gpt 產生YYY
 * 的圖"; unnamed = Gemini): a use-word then the name anywhere, or the name opening the message. A
 * name with no use-word in the middle of a sentence ("畫一個 GPT 的 logo") is the subject, not the
 * choice. A refused name ("不要用 gpt", "don't use gpt") is no choice; 要不要用 / 用不用 ask for it.
 */
const NAMES = '(gemini|雙子座|双子座|chat\\s?gpt|gpt|openai|dall[\\s-]?e)(?![a-z0-9])';
const NAMED_WITH_VERB = new RegExp(`(?:使用|改用|用|叫|請|请|找|讓|让|透過|透过|通過|通过|(?<![a-z])(?:using|use|with|via|ask|by)\\s)\\s*${NAMES}`, 'gi');
const NAMED_FIRST = new RegExp(`^\\s*${NAMES}\\s*[:：,，、]?\\s*`, 'i');
// 別 only opening a clause (別用, 請別用, 千萬別用), never ending a word (特別用, 各別用, 離別用).
const REFUSED = /(?:(?<![要想用何願愿希嘛啥麼么可准需必得能法])不(?:太)?(?:要|想|想要|希望|願意|愿意|可以|准|需要|必)?|(?<=^|[\s，,。.！!？?；;：:、「『"“'（(請请託托萬万你您妳們们就也可先還还都又說说次後后天那])[別别]|勿|禁止|(?<![a-z])(?:(?:don['’]?t|do not|never|not)(?:\s+ever)?(?:\s+(?:want|wish|like|need)(?:\s+you)?)?(?:\s+to)?|without|no need to))\s*(?:再\s*)?(?:使用|用)?\s*$/i;
// "stop using gpt", not "a bus stop with gpt" nor "can't stop using gpt".
const STOP_USING = /(?<=^|[,.;!?]\s*|(?<![a-z])(?:please|pls|and|to|just|so|then|i|you|we|must|should|will|can|could|now|also|ok|okay)\s+)(?:avoid|stop)\s*$/i;

function refused(before: string, useWord: string): boolean {
  const refusal = REFUSED.exec(before);
  // "draw the word NOT using gpt": a capitalised NOT alone is the word drawn.
  if (refusal) return !/^NOT\s*$/.test(refusal[0]);
  return /^us(?:e|ing)\s/i.test(useWord) && STOP_USING.test(before);
}

function chosenName(text: string): RegExpExecArray | null {
  for (const match of text.matchAll(NAMED_WITH_VERB)) {
    if (!refused(text.slice(0, match.index), match[0])) return match;
  }
  return NAMED_FIRST.exec(text);
}

function providerNamed(name: string): ImageProvider {
  return /gemini|雙子|双子/i.test(name) ? 'gemini' : 'chatgpt';
}

export interface ImageRequest {
  /** Who the user asked to draw; null when they named nobody. */
  provider: ImageProvider | null;
  /** What is sent to the page: the request without the "use X" part. */
  prompt: string;
}

/** The picture request in a message, or null when it is not one. */
export function parseImageRequest(text: string): ImageRequest | null {
  const match = chosenName(text);
  const prompt = match
    ? `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`.replace(/^[\s,，、:：]+/, '').replace(/\s+/g, ' ').trim()
    : text.trim();
  if (!looksLikeImageRequest(prompt)) return null;
  return { provider: match ? providerNamed(match[1]) : null, prompt };
}

/** The page the image command draws on: the one named, Gemini when none was. */
export function imageProviderUrl(provider: ImageProvider | null): string {
  return provider === 'chatgpt' ? PROVIDER_URLS.chatgpt : PROVIDER_URLS.gemini;
}

/**
 * Where a picture request in the chat goes: null = the ordinary send, because the chat's own
 * model is the one asked for (named, or Gemini by default) and its send comes back with the
 * picture; otherwise the image command on the page asked for.
 */
export function imageRouteFor(
  text: string,
  chatUrl: string,
  opts: { agent: boolean; temporary: boolean },
): ImageRequest | null {
  const request = parseImageRequest(text);
  if (!request) return null;
  const wanted: ImageProvider = request.provider ?? 'gemini';
  const chatProvider = chatUrl && !isByokTargetUrl(chatUrl) ? providerFromUrl(chatUrl) : null;
  if (chatProvider === wanted && chatSendDraws(chatUrl, opts)) return null;
  return request;
}

/** A command turn nobody typed (a pasted link's built-in, a drawn picture): no "/…" badge. */
export function isUntypedBuiltinCommand(id: string): boolean {
  return id === IMAGE_CHAT_FLOW_ID || isDesktopBuiltinFlowId(id);
}
