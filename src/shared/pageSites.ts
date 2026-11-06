/**
 * The sites `page_read` knows by name, one row per outlet: where its article text sits. Any other
 * page is read too, by what it says about itself. A row is for a site that generic reading gets
 * wrong: a row without `body` is one whose structured data (JSON-LD `articleBody`) or reader view
 * already gets the article alone, kept so it is read as an article and named properly. A stale
 * selector degrades to those two instead of failing, so the release self-test is what notices one.
 */
export interface PageSite {
  /** A domain; its subdomains belong to the row too, unless a longer domain has its own row. */
  hosts: readonly string[];
  name: string;
  /** The article text's container. Tried in order; the longest match of the first that holds enough text wins. */
  body?: readonly string[];
  /** What sits inside that container but is not the article. */
  drop?: string;
  /** Refuses everyone signed out: a refusal here is that, and a hidden window only waits for the same answer. */
  signedInOnly?: boolean;
}

export const PAGE_SITES: readonly PageSite[] = [
  {
    hosts: ['tw.news.yahoo.com', 'tw.stock.yahoo.com', 'tw.sports.yahoo.com', 'tw.finance.yahoo.com', 'tw.style.yahoo.com', 'tw.tech.yahoo.com'],
    name: 'Yahoo',
    body: ['div.atoms'],
  },
  { hosts: ['udn.com'], name: '聯合新聞網', body: ['section.article-content__editor'] },
  { hosts: ['money.udn.com'], name: '經濟日報', body: ['section#article_body'], drop: '.further-reading' },
  { hosts: ['health.udn.com'], name: '元氣網', body: ['div.story__text__wrapper'], drop: '.ai_content_block, .article-navigation, blockquote, .story__text__wrapper > div:not([class])' },
  { hosts: ['chinatimes.com'], name: '中時新聞網', body: ['div.article-body'] },
  { hosts: ['ctee.com.tw'], name: '工商時報', body: ['article'], drop: '.related-inline, .google-prefernce' },
  { hosts: ['ltn.com.tw'], name: '自由時報', body: ['div.text'], drop: '.appE1121, .before_ir, .after_ir, .suggest, .ph_b' },
  { hosts: ['cna.com.tw'], name: '中央社', body: ['div.paragraph'], drop: '.articlekeywordGroup, .moreArticle' },
  { hosts: ['ettoday.net'], name: 'ETtoday', body: ['div.story'] },
  { hosts: ['news.tvbs.com.tw'], name: 'TVBS 新聞', body: ['div.article-editor-content'] },
  { hosts: ['setn.com'], name: '三立新聞網', body: ['#newsContent'] },
  { hosts: ['news.ebc.net.tw'], name: '東森新聞', body: ['div.article_content'] },
  { hosts: ['ftvnews.com.tw'], name: '民視新聞網', body: ['div#newscontent'] },
  { hosts: ['news.pts.org.tw'], name: '公視新聞網', body: ['div.post-article'], drop: '.link-preview-card' },
  { hosts: ['news.cts.com.tw'], name: '華視新聞', body: ['div.article-content'] },
  { hosts: ['news.ttv.com.tw'], name: '台視新聞網', body: ['div#newscontent'] },
  { hosts: ['ctinews.com'], name: '中天新聞網', body: ['div.rendered-content'] },
  { hosts: ['ctwant.com'], name: 'CTWANT', body: ['article'], drop: '#article-tag-bottom' },
  { hosts: ['mirrormedia.mg'], name: '鏡週刊' },
  { hosts: ['mnews.tw'], name: '鏡新聞', body: ['article[class*="apiDataArticle"]'] },
  { hosts: ['nownews.com'], name: 'NOWnews', body: ['#articleContent'] },
  { hosts: ['upmedia.mg'], name: '上報', body: ['div.news-box-text'] },
  { hosts: ['storm.mg'], name: '風傳媒', body: ['#editor'] },
  { hosts: ['thenewslens.com'], name: '關鍵評論網' },
  { hosts: ['inside.com.tw'], name: 'INSIDE' },
  { hosts: ['cw.com.tw'], name: '天下雜誌', body: ['#article-preview'] },
  { hosts: ['commonhealth.com.tw'], name: '康健雜誌', body: ['div.wrap-content'] },
  { hosts: ['businessweekly.com.tw'], name: '商業周刊', body: ['div.article-body'] },
  { hosts: ['businesstoday.com.tw'], name: '今周刊', body: ['div[id^="article__page__"]'] },
  { hosts: ['gvm.com.tw'], name: '遠見雜誌', body: ['div.article-content'], drop: '.article-head_marketing, .newsletter' },
  { hosts: ['managertoday.com.tw'], name: '經理人', body: ['main.htmlview'] },
  { hosts: ['bnext.com.tw'], name: '數位時代', body: ['div.htmlview.article-content'] },
  { hosts: ['technews.tw'], name: '科技新報', body: ['div.indent'], drop: '#outlineList_top, #translated-content, h3, h3 ~ ul' },
  { hosts: ['cnyes.com'], name: '鉅亨網' },
  { hosts: ['nextapple.com'], name: '壹蘋新聞網', body: ['div.post-content'] },
  { hosts: ['twreporter.org'], name: '報導者' },
  { hosts: ['newtalk.tw'], name: 'Newtalk', body: ['#newtalk-news-view-content'] },
  { hosts: ['cnews.com.tw'], name: 'CNEWS 匯流新聞網', body: ['article[id^="post-"]'] },
  { hosts: ['rti.org.tw'], name: '央廣', body: ['div.editor'] },
  { hosts: ['today.line.me'], name: 'LINE TODAY', body: ['article.entityBodyModule'] },
  { hosts: ['news.pchome.com.tw'], name: 'PChome 新聞' },
  { hosts: ['msn.com'], name: 'MSN' },
  { hosts: ['medium.com'], name: 'Medium', body: ['article'] },
  { hosts: ['mp.weixin.qq.com'], name: '微信公众号', body: ['#js_content'] },
  {
    hosts: ['stackoverflow.com', 'stackexchange.com', 'superuser.com', 'serverfault.com', 'askubuntu.com', 'mathoverflow.net'],
    name: 'Stack Exchange',
    body: ['#mainbar'],
    drop: '.votecell, .js-post-menu, #post-form, .bottom-notice',
  },
  { hosts: ['zhihu.com'], name: '知乎', signedInOnly: true },
];

const SITE_BY_HOST: ReadonlyMap<string, PageSite> = new Map(
  PAGE_SITES.flatMap((site) => site.hosts.map((host) => [host, site] as const)),
);

function hostOf(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The row for a link's host: the longest domain that matches, so `money.udn.com` is not `udn.com`. */
export function findPageSite(url: string): PageSite | null {
  const host = hostOf(url);
  if (!host) return null;
  for (let at = 0; at !== -1; at = host.indexOf('.', at) + 1 || -1) {
    const site = SITE_BY_HOST.get(host.slice(at));
    if (site) return site;
  }
  return null;
}

const GOOGLE_NEWS_ARTICLE = /^\/(?:rss\/)?(?:articles|read)\/([\w-]{20,})\/?$/;

/** The article id in a Google News link, or null: its other pages (topics, stories) are lists. */
export function googleNewsArticleId(url: string): string | null {
  if (hostOf(url) !== 'news.google.com') return null;
  return GOOGLE_NEWS_ARTICLE.exec(new URL(url).pathname)?.[1] ?? null;
}

/** Whether this is a link to a web page at all: nothing else is a page to read. */
export function isWebLink(url: string): boolean {
  return hostOf(url) !== null;
}
