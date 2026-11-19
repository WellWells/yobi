import type { ToolFetcher } from './toolFetch';

/*
 * A program's releases as GitHub's REST API lists them, and the one Yobi takes: the newest stable
 * release that has been out long enough and carries both this machine's file and the checksums.
 * The API (not the `latest` redirect) because only it says when a release was published.
 */

export interface ReleaseAsset {
  name: string;
  size: number;
  /** GitHub's own `sha256:<hex>` of the uploaded file, lower-case hex; absent on older releases. */
  sha256?: string;
}

export interface GithubRelease {
  tag: string;
  /** The tag without a leading `v`. */
  version: string;
  publishedAt: string;
  assets: ReleaseAsset[];
}

const LIST_MAX_BYTES = 4_000_000;
const RELEASES_PER_PAGE = 20;
const TAG = /^v?[0-9A-Za-z._-]{1,64}$/;
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readAsset(raw: unknown): ReleaseAsset | null {
  if (!isRecord(raw) || typeof raw.name !== 'string' || typeof raw.size !== 'number') return null;
  const digest = typeof raw.digest === 'string' ? /^sha256:([0-9a-f]{64})$/i.exec(raw.digest)?.[1]?.toLowerCase() : undefined;
  return { name: raw.name, size: raw.size, ...(digest ? { sha256: digest } : {}) };
}

/** The stable releases in the API's answer; drafts, pre-releases and odd tags are left out. */
export function parseReleases(json: unknown): GithubRelease[] {
  if (!Array.isArray(json)) return [];
  const releases: GithubRelease[] = [];
  for (const raw of json) {
    if (!isRecord(raw) || raw.draft === true || raw.prerelease === true) continue;
    const tag = typeof raw.tag_name === 'string' ? raw.tag_name : '';
    const publishedAt = typeof raw.published_at === 'string' ? raw.published_at : '';
    if (!TAG.test(tag) || !Number.isFinite(Date.parse(publishedAt))) continue;
    const assets = Array.isArray(raw.assets) ? raw.assets.map(readAsset).filter((a): a is ReleaseAsset => a !== null) : [];
    releases.push({ tag, version: tag.replace(/^v/, ''), publishedAt, assets });
  }
  return releases;
}

/**
 * The newest release published at least `minAgeMs` ago that has every file in `needs`. A release
 * younger than that is skipped, not waited for: the one before it is taken meanwhile.
 */
export function pickRelease(
  releases: readonly GithubRelease[],
  needs: readonly string[],
  minAgeMs: number,
  now: number = Date.now(),
): GithubRelease | null {
  const ready = releases
    .filter((r) => now - Date.parse(r.publishedAt) >= minAgeMs)
    .filter((r) => needs.every((name) => r.assets.some((a) => a.name === name)))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return ready[0] ?? null;
}

export function releasesUrl(repo: string): string {
  if (!REPO.test(repo)) throw new Error(`not a GitHub repository name: ${repo}`);
  return `https://api.github.com/repos/${repo}/releases?per_page=${RELEASES_PER_PAGE}`;
}

/** The download URL of one file of a release; the tag and name are checked, never taken as given. */
export function releaseAssetUrl(repo: string, tag: string, name: string): string {
  if (!REPO.test(repo) || !TAG.test(tag) || !/^[A-Za-z0-9._-]{1,128}$/.test(name)) throw new Error(`not a release file: ${repo} ${tag} ${name}`);
  return `https://github.com/${repo}/releases/download/${tag}/${name}`;
}

export async function fetchReleases(fetcher: ToolFetcher, repo: string): Promise<GithubRelease[]> {
  const { body } = await fetcher.fetchBytes(releasesUrl(repo), LIST_MAX_BYTES, { Accept: 'application/vnd.github+json' });
  let json: unknown;
  try {
    json = JSON.parse(body.toString('utf8'));
  } catch {
    throw new Error(`GitHub's release list for ${repo} is not JSON`);
  }
  return parseReleases(json);
}
