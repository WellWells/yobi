import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/types';

const api = {
  capturePage: (name: string): Promise<string> => ipcRenderer.invoke(IPC.CAPTURE_PAGE, { name: name || '' }),
};

try {
  contextBridge.exposeInMainWorld('__yobi', api);
} catch {
  (window as unknown as { __yobi: typeof api }).__yobi = api;
}
