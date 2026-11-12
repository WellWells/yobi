/**
 * Whether a bot request asks about the chat's own talk ("sum up the chat above"): one rule for
 * every platform that brings a group's talk into a run (Telegram's group log, LINE PC's
 * database). Such a request gets the recap window (`chatContextWindow.ts`) and `chatRecap`.
 */

/**
 * Words asking about the chat itself — sum it up, catch me up, what were they on about — rather
 * than about one message. A summary of something else ("summarise this article") does not count:
 * the verb needs the chat as its object, or nothing at all after it. Only a thing named right
 * after the verb counts as that something else; a thing later in the sentence ("everything I
 * missed during the movie", 「上面影片的討論總結一下」) leaves the request a recap.
 */
const ZH_THING = '(?:文章|影片|視頻|视频|連結|链接|網址|网址|網頁|网页|網站|网站|檔案|档案|文件|PDF|pdf|報告|报告|新聞|新闻|論文|论文|貼文|帖子)';
const ZH_YOUTUBE = '(?:\\s*(?:YouTube|youtube|YT|yt))?\\s*';
const ZH_SUMMARISE = '(?:統整|统整|總結|总结|摘要|整理|歸納|归纳|重點|重点|回顧|回顾|懶人包|懒人包|概括|彙整|汇整)';
/**
 * Talk, the group, the chat's own messages or a time window after the thing in the same clause
 * (「這篇文章引發的討論」「這部影片之前的訊息」「這篇文章和上面的訊息」「報告群」).
 */
const ZH_TALK_AHEAD = '(?:[^。！？!?，,]|[，,]\\s*(?=還有|还有|以及|和|跟)){0,12}(?:討論|讨论|對話|对话|聊天|(?<![給给幫帮讓让為为])大家|群|留言|回覆|回复|反應|反应|回應|回应|評論|评论|意見|意见|評價|评价|反饋|反馈|心得|看法|說法|说法|爭論|争论|之後|之后|以後|以后|後的|后的|後面|后面|下面|底下|下方|以來|以来|至今|到目前|之前|以前|前的|時(?![間间長长])|时(?![間间長长])|期間|期间|到現在|到现在|錯過|错过|漏掉|(?:上面|上方|前面|剛剛|剛才|刚刚|刚才|稍早)的?(?:訊息|消息))';
const ZH_ABOVE = '(?:上面|上方|前面|剛剛|剛才|刚刚|刚才)';
const ZH_THIS = '(?:(?:這|这|那)(?:個|个|篇|份|部|支|段|則|则|條|条|些)?)';
/** 「摘要這個影片…」「總結一下上面那篇文章」 — unless what is asked about is the talk over it. */
const ZH_POINTED_THING = `(?:一下|下)?${ZH_ABOVE}?${ZH_THIS}${ZH_YOUTUBE}${ZH_THING}(?!${ZH_TALK_AHEAD})`;
/**
 * 「影片(裡)的重點訊息」 is what the video says, not messages in the chat — but only with the thing
 * right after the verb (or 給我); after any other word it is the chat's messages that post or
 * mention it (「有附連結的訊息」「丟影片的訊息」「提到這份報告的訊息」).
 */
const ZH_CHAT_MESSAGES = `(?<!(?:^|${ZH_SUMMARISE}(?:一下|下)?|給我|给我)${ZH_ABOVE}?${ZH_THIS}?(?:今天|今日|昨天|最新)?${ZH_YOUTUBE}${ZH_THING}\\s*(?:裡|里|中|上|內|内)?的\\s*(?:重點|重点|重要|主要|核心|關鍵|关键|最新)?)(?:訊息|消息)`;
/**
 * "this PDF", "the latest YouTube video", "my report" — a thing the verb sums up instead of the
 * chat, unless the talk over it is what is asked about ("the website redesign discussion", "the
 * report feedback"). Plural "posts" are the chat's own messages.
 */
const EN_TALK = String.raw`(?:discussions?|chats?|channels?|groups?|rooms?|threads?|talks?|conversations?|convos?|comments?|replies|messages|debates?|arguments?|drama|reactions?|responses?|views|questions|reviews|feedback|updates?|progress|status|plans?|decisions?|opinions?|thoughts)(?![a-z])`;
const EN_PREPOSITION = String.raw`(?:for|to|in|on|at|from|into|with|by|about|of|via)(?![\w'’-])`;
/**
 * Words that cannot describe the thing: "summarize this as a report", "summarize this then email
 * it" — the report or email is what to make of the chat, not what to read.
 */
const EN_FUNCTION_WORD = String.raw`(?:and|or|but|n|as|like|then|than|so|also|too|if|when|while|before|after|until|since|because|once|unless|a|an|the|this|that|these|those|my|our|your|his|her|their|its|i|we|you|they|he|she|it|me|us|them|him|will|can|could|would|should|may|might|must|need|want|gonna|wanna|is|are|was|were|be|do|does|did|have|has|had|quick|quickly|briefly|now|here|there|again|just|only|asap|please|pls|plz|over|up|out)(?![\w'’-])`;
/** "the last few pages", "the previous page" — pages of the chat. */
const EN_PAGE = String.raw`(?<!(?:last|first|previous|prev|next|past|few|couple|several|earlier|\d+|two|three|four|five|six|seven|eight|nine|ten)\s+)pages?(?!\s+of\s+(?:the\s+|this\s+|our\s+)?(?:group\s+)?${EN_TALK})`;
const EN_THING = String.raw`(?:(?!${EN_TALK}|${EN_PREPOSITION}|${EN_FUNCTION_WORD})[\w'’-]+\s+){0,2}(?:(?:article|video|vid|clip|link|file|document|pdf|webpage|website|url|report|paper|doc|tweet|email|podcast|blog)s?|post|${EN_PAGE})(?![a-z-])(?!\s+(?:style|format)(?![a-z]))(?![\w'’/-]*(?:,?\s+(?!${EN_PREPOSITION})[\w'’/-]+){0,3}?,?\s+${EN_TALK})`;
const EN_URL = String.raw`(?:https?:\/\/|www\.)`;
const EN_CONTENT_OF = String.raw`(?:the\s+)?(?:contents?|gist|main\s+points|key\s+points|key\s+takeaways|takeaways|highlights|main\s+ideas?)\s+(?:of|from|in)\s+(?:this|that|the|these|my)\s+${EN_THING}`;
const RECAP_PHRASES: readonly RegExp[] = [
  new RegExp(`${ZH_SUMMARISE}(?!${ZH_POINTED_THING}).{0,12}(?:上面|上方|以上|前面|剛剛|剛才|刚刚|刚才|稍早|之前|這段|这段|大家|群組|群组|群裡|群里|對話|对话|聊天|討論|讨论|${ZH_CHAT_MESSAGES})`),
  /(?:上面|上方|以上|前面|剛剛|剛才|刚刚|刚才|稍早|大家|群組|群组|群裡|群里).{0,12}(?:統整|统整|總結|总结|摘要|整理|歸納|归纳|重點|重点|回顧|回顾|懶人包|懒人包|概括|彙整|汇整)/,
  /^(?:幫我|帮我|請|请)?(?:統整|统整|總結|总结|摘要|整理|歸納|归纳|彙整|汇整)(?:一下|下)?(?:重點|重点)?[。.!！?？]*$/,
  /(?:剛剛|剛才|刚刚|刚才|上面|前面|稍早|大家|他們|他们|你們|你们).{0,6}(?:在|有)?(?:聊|說|说|講|讲|討論|讨论|吵)(?:了)?(?:些)?(?:什麼|什么|啥|甚麼)/,
  // "List what was discussed", "how many people were in it", "what did they discuss".
  /(?:列出|列一下|條列|条列|列舉|列举|整理出).{0,12}(?:討論|讨论|對話|对话|聊天|聊了|說了|说了)/,
  /(?:討論|讨论|聊)(?:了|過|过)?(?:的)?(?:什麼|什么|啥|甚麼|內容|内容|話題|话题|主題|主题)/,
  /(?:幾|几|多少)(?:個|个|位)?人(?:在|有)?(?:討論|讨论|聊|說話|说话|發言|发言|參與|参与)/,
  new RegExp(String.raw`(?<![a-z])(?:summari[sz]e|summary|recap|tl;?dr|catch me up)(?![a-z])(?!(?:\s*[:：]\s*|\s+)(?:(?:this|that|the|an?)\s+(?:article|page|video|link|post|file|document)|(?:of\s+)?(?:(?:this|that|the|an?|these|my)\s+(?:${EN_THING}|${EN_URL})|${EN_URL})|(?:on|for)\s+(?:this|that|these)\s+${EN_THING}|${EN_CONTENT_OF}|what\s+(?:this|that|the)\s+${EN_THING}\s+(?:says|said|is\s+about|was\s+about|argues|covers|claims)))`, 'i'),
  /what (?:did|have|were) (?:we|they|you guys|people|everyone) (?:been )?(?:talk|discuss|say|said|chat)/i,
];

/** The request is about the chat's talk itself, not about one message or a thing it names. */
export function asksAboutTheChat(text: string): boolean {
  const haystack = text.trim();
  return haystack !== '' && RECAP_PHRASES.some((pattern) => pattern.test(haystack));
}
