import type { SkillType } from '../../../../shared/types';

export interface SkillCatalogEntry {
  type: SkillType;
  keywords: string[];
}

export type SkillCategoryKey = 'extraction' | 'browser' | 'control' | 'actions' | 'tools';

export interface SkillCategory {
  key: SkillCategoryKey;
  labelKey: string;
  skills: SkillCatalogEntry[];
}

export const SKILL_CATALOG: SkillCategory[] = [
  { key: 'extraction', labelKey: 'flow.category.extraction', skills: [
    { type: 'search', keywords: ['search', 'web', 'google', 'duckduckgo', 'serp', 'find', '搜尋', '搜索', '查詢', '網路'] },
    { type: 'research', keywords: ['research', 'deep', 'investigate', 'report', 'cited', 'sources', 'analyze', 'answer', '研究', '深度', '調查', '報告', '引用', '來源', '分析'] },
    { type: 'scraper', keywords: ['scrape', 'crawl', 'css', '爬蟲', '擷取'] },
    { type: 'gmap_reviews', keywords: ['google maps', 'map', 'reviews', 'rating', 'place', '地圖', '評論', '評價', '星等', '店家'] },
    { type: 'line_read', keywords: ['line', 'chat', 'message', 'group', 'community', 'history', 'transcript', 'summarize', 'track', 'LINE', '訊息', '聊天', '群組', '社群', '群聊', '對話', '紀錄', '摘要', '追蹤'] },
    { type: 'browser', keywords: ['fetch', 'web', 'page', '網頁', '瀏覽'] },
    { type: 'rss',     keywords: ['feed', '訂閱'] },
    { type: 'http',    keywords: ['api', 'request', '請求'] },
    { type: 'youtube', keywords: ['transcript', 'subtitle', 'yt', '字幕', '影片'] },
    { type: 'youtube_subs', keywords: ['youtube', 'channel', 'subscribe', 'subscription', 'creator', 'yt', '訂閱', '頻道', '創作者'] },
    { type: 'stock',   keywords: ['stock', 'ticker', 'price', 'equity', 'quote', 'shares', '股票', '股價', '報價', '個股'] },
    { type: 'forex',   keywords: ['forex', 'fx', 'currency', 'exchange', 'rate', '匯率', '外匯', '貨幣', '換匯'] },
    { type: 'weather', keywords: ['weather', 'forecast', 'temperature', 'rain', '天氣', '氣溫', '溫度', '預報', '降雨'] },
    { type: 'air_quality', keywords: ['air', 'quality', 'aqi', 'pollution', 'pm2.5', 'pm25', 'pm10', 'smog', 'ozone', 'moenv', 'taiwan', '空氣', '空品', '品質', '污染', '懸浮微粒', '細懸浮微粒', '霧霾', '臭氧', '環境部', '測站', '台灣'] },
  ] },
  { key: 'browser', labelKey: 'flow.category.browser', skills: [
    { type: 'browser_open', keywords: ['open', 'tab', 'page', 'login', 'session', 'automation', '開啟', '分頁', '登入', '自動化'] },
    { type: 'browser_js', keywords: ['inject', 'javascript', 'click', 'fill', 'form', 'screenshot', 'control', 'operate', 'automation', '操作', '注入', '點擊', '填表', '截圖', '自動化'] },
    { type: 'browser_close', keywords: ['close', 'tab', 'page', '關閉', '分頁'] },
  ] },
  { key: 'control', labelKey: 'flow.category.control', skills: [
    { type: 'loop', keywords: ['repeat', 'foreach', '迴圈', '重複', '陣列'] },
    { type: 'if',   keywords: ['condition', 'branch', '條件', '判斷', '分支'] },
    { type: 'stop', keywords: ['end', 'halt', '停止', '終止'] },
    { type: 'on_change', keywords: ['change', 'changed', 'edge', 'once', 'alert', 'trigger', 'dedupe', 'repeat', 'threshold', 'notify once', '變更', '改變', '變化', '只提醒一次', '一次', '去重', '重複', '門檻', '到價'] },
    { type: 'break', keywords: ['break', 'exit', 'loop', '中斷', '跳出', '迴圈'] },
    { type: 'continue', keywords: ['continue', 'next', 'skip', '繼續', '下一項', '略過'] },
  ] },
  { key: 'actions', labelKey: 'flow.category.actions', skills: [
    { type: 'llm',       keywords: ['ai', 'prompt', 'gpt', 'gemini', '提示', '模型'] },
    { type: 'bot',       keywords: ['telegram', 'message', '機器人', '訊息'] },
    { type: 'email_send', keywords: ['email', 'mail', 'smtp', 'send', '郵件', '寄信', '信件', '電子郵件'] },
    { type: 'clipboard', keywords: ['copy', 'paste', '剪貼', '複製'] },
  ] },
  { key: 'tools', labelKey: 'flow.category.tools', skills: [
    { type: 'shell',   keywords: ['command', 'cmd', 'powershell', 'bash', '指令', '終端'] },
    { type: 'run',     keywords: ['exe', 'program', 'launch', 'open', 'app', '執行', '程式', '應用程式'] },
    { type: 'js',      keywords: ['javascript', 'script', 'code', 'transform', 'json', '腳本', '程式碼', '轉換'] },
    { type: 'random',  keywords: ['random', 'dice', 'lottery', 'number', 'shuffle', 'rand', '亂數', '隨機', '骰子', '樂透', '抽獎', '號碼'] },
    { type: 'text',    keywords: ['text', 'variable', 'string', 'value', 'template', 'relay', 'memo', '文字', '變數', '字串', '模板', '中繼'] },
    { type: 'sysinfo', keywords: ['system', 'cpu', 'ip', '系統', '資訊'] },
    { type: 'power',   keywords: ['power', 'shutdown', 'restart', 'reboot', 'logout', 'signout', 'sleep', 'lock', 'hibernate', '電源', '關機', '重開機', '重啟', '登出', '睡眠', '鎖定', '休眠'] },
    { type: 'restart_app', keywords: ['restart', 'relaunch', 'reboot', 'reload', 'app', 'yobi', 'self', '重啟', '重新啟動', '重開', '應用程式'] },
    { type: 'delay',   keywords: ['delay', 'wait', 'sleep', 'pause', '延遲', '等待', '暫停'] },
    { type: 'notify',  keywords: ['notify', 'notification', 'log', 'message', '通知', '訊息', '記錄'] },
    { type: 'capture', keywords: ['capture', 'screenshot', 'screen', 'printscreen', 'snapshot', '擷取', '螢幕', '截圖', '快照'] },
    { type: 'share', keywords: ['share', 'link', 'url', 'paste', 'pdf', 'png', 'webp', 'image', 'markdown', 'md', 'document', 'export', 'convert', 'render', 'zip', 'report', '分享', '連結', '網址', '轉檔', '轉換', '文件', '圖片', '匯出', '報告', '壓縮'] },
    { type: 'file_write', keywords: ['write', 'save', 'file', 'txt', 'output', '寫入', '儲存', '檔案', '輸出'] },
    { type: 'file_read',  keywords: ['read', 'load', 'open', 'file', '讀取', '開啟', '檔案', '載入'] },
    { type: 'file_list',  keywords: ['list', 'dir', 'directory', 'folder', 'files', '列出', '目錄', '清單', '資料夾'] },
    { type: 'file_delete', keywords: ['delete', 'remove', 'rm', 'file', 'cleanup', 'temp', '刪除', '移除', '檔案', '清理', '暫存'] },
    { type: 'file_download', keywords: ['download', 'fetch', 'save', 'url', 'binary', 'file', '下載', '抓檔', '存檔', '檔案'] },
    { type: 'comment', keywords: ['note', '備註', '註解'] },
  ] },
];

export const SKILL_CATEGORY: Record<SkillType, SkillCategoryKey> = (() => {
  const map = {} as Record<SkillType, SkillCategoryKey>;
  for (const cat of SKILL_CATALOG) {
    for (const skill of cat.skills) map[skill.type] = cat.key;
  }
  map.end_loop = 'control';
  map.end_if = 'control';
  return map;
})();

export const DANGER_SKILLS: SkillType[] = ['stop', 'power', 'restart_app', 'file_delete'];

export interface SearchableSkill {
  type: SkillType;
  category: string;
  name: string;
  desc: string;
  keywords: string[];
}

export interface SkillGroup {
  category: string;
  items: SearchableSkill[];
}

type Translate = (key: string) => string;

export function buildSkillGroups(t: Translate): SkillGroup[] {
  return SKILL_CATALOG.map((cat) => {
    const category = t(cat.labelKey);
    return {
      category,
      items: cat.skills.map((s) => ({
        type: s.type,
        category,
        name: t(`flow.skill.${s.type}`),
        desc: t(`flow.skill.${s.type}.desc`),
        keywords: s.keywords,
      })),
    };
  });
}

export function skillMatchesQuery(skill: SearchableSkill, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [skill.name, skill.desc, skill.category, ...skill.keywords].join(' ').toLowerCase();
  return haystack.includes(q);
}

export function filterSkillGroups(groups: SkillGroup[], query: string): SkillGroup[] {
  if (!query.trim()) return groups;
  return groups
    .map((g) => ({ category: g.category, items: g.items.filter((s) => skillMatchesQuery(s, query)) }))
    .filter((g) => g.items.length > 0);
}

export function flattenSkillGroups(groups: SkillGroup[]): SearchableSkill[] {
  return groups.flatMap((g) => g.items);
}
