import { parseContestTop, parseSubmissionsPage } from './parse';

/** 요청한 화면 대신 로그인 화면으로 넘겨졌을 때. */
export class LoginRequired extends Error {}

export interface DownloadOptions {
  /** atcoder.jp의 경로를 받아 본문을 돌려준다. 로그인 화면으로 넘겨지면 LoginRequired를 던진다. */
  get: (path: string) => Promise<string>;
  sleep: (ms: number) => Promise<unknown>;
  /** 제출 목록 요청 사이에 쉬는 시간(ms). */
  delay: number;
  /** 화면 구성이 바뀌어 다음 링크가 끝없이 이어질 때를 대비한 한도. */
  maxPages?: number;
  onPage?: (page: number) => void;
}

export interface Downloaded {
  top: string;
  /** 순위표 JSON 원문. 받지 못했으면 null이고 이유는 standingsError에 있다. */
  standings: string | null;
  standingsError?: string;
  /** 제출 목록 화면. 1쪽부터 차례대로. */
  pages: string[];
}

/**
 * 대회 첫 화면, 순위표 JSON, 제출 목록 전체를 받는다.
 *
 * 제출 목록은 시각 오름차순으로 요청하고 다음 쪽 링크가 없을 때까지 따라간다.
 * 오름차순이면 받는 도중에 들어온 제출이 뒤에 붙으므로 빠지는 것이 없다.
 * 받아 둔 쪽을 다시 쓰지 않고 매번 전부 받는다. 재채점으로 앞쪽 판정이 바뀔 수 있고,
 * 수십 명 규모 대회는 전부 받아도 1분이 걸리지 않는다.
 */
export async function download(contestId: string, options: DownloadOptions): Promise<Downloaded> {
  const { get, sleep, delay, maxPages = 2000, onPage } = options;

  const top = await get(`/contests/${contestId}`);
  const endMs = Date.parse(parseContestTop(top).endTime);

  let standings: string | null = null;
  let standingsError: string | undefined;
  try {
    standings = await get(`/contests/${contestId}/standings/json`);
  } catch (e) {
    standingsError = e instanceof LoginRequired ? '로그인이 필요합니다' : e instanceof Error ? e.message : String(e);
  }

  const pages: string[] = [];
  for (let page = 1; ; page++) {
    if (page > maxPages) {
      throw new Error(`제출 목록이 ${maxPages}쪽을 넘습니다. 다음 쪽 링크를 잘못 읽고 있을 수 있어 멈춥니다.`);
    }
    if (page > 1) await sleep(delay);

    const html = await get(`/contests/${contestId}/submissions?orderBy=created&page=${page}`);
    const { submissions, lastLinkedPage } = parseSubmissionsPage(html);
    if (submissions.length === 0) break;
    pages.push(html);
    onPage?.(page);

    const first = Date.parse(submissions[0].time);
    const last = Date.parse(submissions[submissions.length - 1].time);
    // 오름차순일 때만: 이 쪽이 대회가 끝난 뒤의 제출로 시작하면 그 뒤는 전부 연습 제출이다.
    if (first <= last && first >= endMs) break;
    if (lastLinkedPage <= page) break;
  }
  return { top, standings, standingsError, pages };
}
