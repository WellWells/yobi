import { createCipheriv, createHash, createHmac, pbkdf2, randomFillSync } from 'node:crypto';
import { ReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import * as os from 'node:os';
import { basename } from 'node:path';
import { format } from 'node:util';
import { deflateSync, gunzipSync } from 'node:zlib';
import { connectTcp, nodeReadableToFuman } from '@fuman/node';
import { IntermediatePacketCodec } from '@mtcute/core';
import type { ICorePlatform, TelegramTransport } from '@mtcute/core';
import { BaseCryptoProvider } from '@mtcute/core/utils.js';
import type { ICryptoProvider } from '@mtcute/core/utils.js';
import { ige256Decrypt, ige256Encrypt, initSync } from '@mtcute/wasm';
import { mtcuteWasmBytes } from './wasm';

/*
 * The Node pieces mtcute needs, written here rather than taken from @mtcute/node: that package
 * hard-depends on better-sqlite3 (a native module, for a storage Yobi does not use) and reads its
 * .wasm from node_modules at run time. Same behaviour as its NodeCryptoProvider, NodePlatform and
 * TcpTransport otherwise.
 */

export class YobiCryptoProvider extends BaseCryptoProvider implements ICryptoProvider {
  initialize(): void {
    initSync(mtcuteWasmBytes());
  }

  createAesCtr(key: Uint8Array, iv: Uint8Array): { process: (data: Uint8Array) => Uint8Array } {
    const cipher = createCipheriv(`aes-${key.length * 8}-ctr`, key, iv);
    return { process: (data) => cipher.update(data) };
  }

  createAesIge(key: Uint8Array, iv: Uint8Array): { encrypt: (data: Uint8Array) => Uint8Array; decrypt: (data: Uint8Array) => Uint8Array } {
    return {
      encrypt: (data) => ige256Encrypt(data, key, iv),
      decrypt: (data) => ige256Decrypt(data, key, iv),
    };
  }

  pbkdf2(password: Uint8Array, salt: Uint8Array, iterations: number, keylen = 64, algo = 'sha512'): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      pbkdf2(password, salt, iterations, keylen, algo, (err, key) => (err ? reject(err) : resolve(key)));
    });
  }

  sha1(data: Uint8Array): Uint8Array {
    return createHash('sha1').update(data).digest();
  }

  sha256(data: Uint8Array): Uint8Array {
    return createHash('sha256').update(data).digest();
  }

  hmacSha256(data: Uint8Array, key: Uint8Array): Uint8Array {
    return createHmac('sha256', key).update(data).digest();
  }

  gzip(data: Uint8Array, maxSize: number): Uint8Array | null {
    try {
      return deflateSync(data, { maxOutputLength: maxSize });
    } catch (err: unknown) {
      if ((err as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE') return null;
      throw err;
    }
  }

  gunzip(data: Uint8Array): Uint8Array {
    return gunzipSync(data);
  }

  randomFill(buf: Uint8Array): void {
    randomFillSync(buf);
  }
}

/** mtcute's log levels: 1 error, 2 warn. Anything chattier stays out of yobi.log. */
const LOG_WARN = 2;

export function createPlatform(log: (message: string) => void): ICorePlatform {
  return {
    // The app closes the client itself on quit; mtcute's own exit hook would race that.
    beforeExit: () => () => undefined,
    log: (_color, level, tag, fmt, args) => {
      if (level > LOG_WARN) return;
      log(`[telegram-upload] mtcute ${tag}: ${format(fmt, ...args)}`);
    },
    getDefaultLogLevel: () => LOG_WARN,
    getDeviceModel: () => `Yobi (${os.type()} ${os.arch()})`,
    normalizeFile: async (file) => {
      if (!(file instanceof ReadStream)) return null;
      const filePath = file.path.toString();
      return {
        file: nodeReadableToFuman(file),
        fileName: basename(filePath),
        fileSize: (await stat(filePath)).size,
      };
    },
  };
}

export function createTransport(): TelegramTransport {
  return {
    async connect(dc, abortSignal) {
      const connection = await connectTcp({ address: dc.ipAddress, port: dc.port }, abortSignal);
      connection.setNoDelay(true);
      connection.setKeepAlive(true);
      return connection;
    },
    packetCodec: () => new IntermediatePacketCodec(),
  };
}
