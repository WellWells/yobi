import { app } from 'electron';
import { version } from '../../package.json';

export function getAppVersion(): string {
  // Starting an entry file directly leaves app.getVersion() at Electron's runtime version.
  return app.isPackaged ? app.getVersion() : version;
}
