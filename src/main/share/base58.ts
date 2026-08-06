const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(source: Uint8Array): string {
  if (source.length === 0) return '';

  const digits: number[] = [0];
  for (const byte of source) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = '';
  for (let k = 0; k < source.length - 1 && source[k] === 0; k++) out += ALPHABET[0];
  for (let q = digits.length - 1; q >= 0; q--) out += ALPHABET[digits[q]];
  return out;
}
