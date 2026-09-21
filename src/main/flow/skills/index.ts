import type { SkillType } from '../../../shared/types';
import type { FlowExecutorDeps } from '../types';
import { execBreak, execContinue, execIf, execStop } from '../runtime';
import { execRss, execScraper, execYoutube, execYoutubeSubs } from './feeds';
import { execJs, execRandom, execRun, execText } from './compute';
import { execHttp, execPower, execRestartApp, execSysInfo } from './system';
import { execForex, execStock, execWeather } from './dataSources';
import { execAirQuality } from './airQuality';
import { execFileDelete, execFileDownload, execFileList, execFileRead, execFileWrite } from './fileOps';
import { execShare } from './share';
import { execEmailSend } from './email';
import { execOnChange } from './stateGate';
import { execSearch } from './search';
import { execResearch } from './research';
import { execGmapReviews } from './mapReviews';
import { execLineRead } from './lineMessages';
import {
  execBot,
  execBrowser,
  execBrowserClose,
  execBrowserJs,
  execBrowserOpen,
  execCapture,
  execClipboard,
  execComment,
  execDelay,
  execLlm,
  execLoop,
  execNotify,
  execShell,
} from './actions';

export async function executeSkill(
  type: SkillType,
  stepId: string,
  config: Record<string, string>,
  deps: FlowExecutorDeps,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  switch (type) {
    case 'shell':
      return execShell(config, timeoutMs, signal);
    case 'run':
      return execRun(config);
    case 'js':
      return execJs(config, timeoutMs);
    case 'text':
      return execText(config);
    case 'random':
      return execRandom(config);
    case 'browser':
      return execBrowser(config);
    case 'browser_open':
      return execBrowserOpen(config);
    case 'browser_js':
      return execBrowserJs(config, timeoutMs);
    case 'browser_close':
      return execBrowserClose(config);
    case 'llm':
      return execLlm(config, deps, timeoutMs, signal);
    case 'clipboard':
      return execClipboard(config);
    case 'delay':
      return execDelay(config);
    case 'notify':
      return execNotify(config);
    case 'capture':
      return execCapture(config, deps);
    case 'share':
      return execShare(config, deps);
    case 'bot':
      return execBot(config, deps);
    case 'rss':
      return execRss(config, stepId);
    case 'scraper':
      return execScraper(config, stepId);
    case 'search':
      return execSearch(config);
    case 'research':
      return execResearch(config, deps);
    case 'gmap_reviews':
      return execGmapReviews(config);
    case 'line_read':
      return execLineRead(config, stepId, deps);
    case 'youtube':
      return execYoutube(config);
    case 'youtube_subs':
      return execYoutubeSubs(config, stepId);
    case 'sysinfo':
      return execSysInfo(config);
    case 'http':
      return execHttp(config, timeoutMs);
    case 'power':
      return execPower(config);
    case 'restart_app':
      return execRestartApp();
    case 'file_write':
      return execFileWrite(config);
    case 'file_read':
      return execFileRead(config);
    case 'file_list':
      return execFileList(config);
    case 'file_delete':
      return execFileDelete(config);
    case 'file_download':
      return execFileDownload(config, timeoutMs);
    case 'stock':
      return execStock(config, timeoutMs);
    case 'forex':
      return execForex(config, timeoutMs);
    case 'weather':
      return execWeather(config, timeoutMs);
    case 'air_quality':
      return execAirQuality(config, timeoutMs);
    case 'email_send':
      return execEmailSend(config);
    case 'stop':
      return execStop(config);
    case 'comment':
      return execComment(config);
    case 'loop':
      return execLoop(config);
    case 'end_loop':
      return '';
    case 'if':
      return execIf(config);
    case 'end_if':
      return '';
    case 'on_change':
      return execOnChange(config, stepId);
    case 'break':
      return execBreak();
    case 'continue':
      return execContinue();
    default:
      throw new Error(`Unknown skill type: ${type as string}`);
  }
}
