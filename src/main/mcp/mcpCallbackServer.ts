import * as http from 'node:http';

const CALLBACK_PATH = '/callback';

export interface CallbackServer {
  redirectUri: string;
  waitForCode(expectedState: string, timeoutMs: number): Promise<string>;
  close(): void;
}

interface Pending {
  state: string;
  resolve: (code: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch
  ));
}

function respond(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>Yobi</title></head>`
    + `<body style="font-family:system-ui,sans-serif;text-align:center;padding:3rem;color:#222">`
    + `<p style="font-size:1.1rem">${escapeHtml(message)}</p></body></html>`,
  );
}

export function startCallbackServer(successMessage = 'Authorization complete. You can close this window.'): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let pending: Pending | null = null;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== CALLBACK_PATH) {
        respond(res, 404, 'Not found');
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const errorParam = url.searchParams.get('error');

      if (!pending) {
        respond(res, 400, 'No authorization in progress.');
        return;
      }
      if (errorParam) {
        respond(res, 400, `Authorization failed: ${errorParam}`);
        finish(new Error(`Authorization failed: ${errorParam}`));
        return;
      }
      if (!state || state !== pending.state) {
        respond(res, 400, 'Authorization state mismatch.');
        finish(new Error('OAuth state mismatch — possible CSRF, authorization rejected'));
        return;
      }
      if (!code) {
        respond(res, 400, 'Missing authorization code.');
        finish(new Error('Authorization response missing the code'));
        return;
      }
      respond(res, 200, successMessage);
      finish(null, code);
    });

    function finish(err: Error | null, code?: string): void {
      if (!pending) return;
      clearTimeout(pending.timer);
      const { resolve: res, reject: rej } = pending;
      pending = null;
      if (err) rej(err);
      else res(code ?? '');
    }

    const onStartupError = (err: Error): void => reject(err);
    server.once('error', onStartupError);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', onStartupError);
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
        waitForCode(expectedState, timeoutMs) {
          return new Promise<string>((res, rej) => {
            const timer = setTimeout(() => {
              if (pending) {
                pending = null;
                rej(new Error('Timed out waiting for authorization'));
              }
            }, timeoutMs);
            timer.unref();
            pending = { state: expectedState, resolve: res, reject: rej, timer };
          });
        },
        close() {
          if (pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Authorization cancelled'));
            pending = null;
          }
          server.close();
        },
      });
    });
  });
}
