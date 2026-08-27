export function fenceUntrusted(tag: string, body: string): string {
  return [`<${tag}>`, sealClosingTag(tag, body), `</${tag}>`].join('\n');
}

export function sealClosingTag(tag: string, body: string): string {
  return body.replace(new RegExp(`</\\s*${tag}\\s*>`, 'gi'), `< /${tag}>`);
}
