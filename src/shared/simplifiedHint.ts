/**
 * A cheap "this answer has Simplified Chinese in it" check, so "convert to Traditional" is offered
 * without loading a dictionary. Only common characters that exist in Simplified alone are listed:
 * none is also a Taiwanese, Hong Kong or Japanese shinjitai form, so Japanese text never trips it.
 * Whether a conversion actually changes anything is decided by the conversion itself.
 */
export const SIMPLIFIED_ONLY: ReadonlySet<string> = new Set([
  ...'们这个说为时对开发样网络软视频简还进应吗电现问题关实际过经动间从总长门车马见书东乐处级认识让请码层产业务构统设专报库无读语响获历选择类单变页图标节质优护边帮给钱买卖尔虽两态确义亚传华众儿账议论试验预览显复杂运营销费价备尝错误输链录启闭达结',
]);

const KANA = /[぀-ヿ]/;

/** True when the text has a character only Simplified Chinese writes, and no Japanese kana. */
export function hasSimplifiedChinese(text: string): boolean {
  if (KANA.test(text)) return false;
  for (const char of text) {
    if (SIMPLIFIED_ONLY.has(char)) return true;
  }
  return false;
}
