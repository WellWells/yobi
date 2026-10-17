/**
 * Builds the live, in-process bilibili MCP connection: the video reader (the site's hidden window
 * on its sign-in partition, where the connector's sign-in lives) behind an McpServer, linked to an SDK
 * Client over InMemoryTransport (no network, no port). Loaded lazily by the registry.
 */
import { readBilibiliWords } from '../flow/skills/bilibiliVideo';
import { bilibiliVideoRef } from '../../shared/linkSites/rows';
import { bilibiliVideoUrl } from '../../shared/linkSites/bilibiliLinks';
import { createBilibiliMcpServer, type BilibiliServiceLike, type BilibiliVideoRead } from './bilibiliMcpServer';
import { connectInProcess, type InProcessConnection } from '../mcp/inProcessServer';

async function read(url: string, signal?: AbortSignal): Promise<BilibiliVideoRead> {
  const ref = bilibiliVideoRef(url);
  if (!ref) throw new Error(`Not a bilibili video URL: ${url}`);
  const { data, subtitles, words } = await readBilibiliWords(ref, signal);
  return {
    title: data.title,
    owner: data.owner,
    pubdate: data.pubdate,
    durationS: data.durationS,
    desc: data.desc,
    link: bilibiliVideoUrl(data.bvid, data.part),
    signedIn: subtitles.signedIn,
    subtitles: words?.text ? { language: words.track.name, ai: words.track.ai, text: words.text } : null,
  };
}

const service: BilibiliServiceLike = { read };

export async function connectBilibiliMcp(clientName: string, clientVersion: string): Promise<InProcessConnection> {
  return connectInProcess(createBilibiliMcpServer(service), clientName, clientVersion);
}
