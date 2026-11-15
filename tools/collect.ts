/**
 * AtCoder에서 대회 자료를 받아 리졸버가 읽는 JSON으로 바꾼다.
 *
 *   ATCODER_SESSION=<REVEL_SESSION 쿠키 값> pnpm collect data/ycpc2026.config.json
 *   pnpm collect data/ycpc2026.config.json --offline   # raw/에 받아 둔 것만으로 다시 변환
 *
 * 옵션
 *   --offline      AtCoder에 접속하지 않고 raw/<contestId>/에 있는 파일만 쓴다
 *   --fresh        받아 둔 제출 목록을 믿지 않고 전부 다시 받는다
 *   --delay <ms>   요청 사이에 쉬는 시간. 기본 1000
 *   --out <path>   결과 파일 경로. 기본은 설정 파일 이름에서 .config를 뺀 것
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { formatClock } from '../src/core/load';
import { buildTimeline } from '../src/core/resolver';
import { buildBoard, revealAll } from '../src/core/scoring';
import type { ContestData } from '../src/core/types';
import { type AtCoderStandings, compareWithOfficial, convert, type OfficialMismatch, type ResolverConfig } from './atcoder/convert';
import { parseContestTop, parseParticipantsCsv, parseSubmissionsPage, type RawSubmission } from './atcoder/parse';

const BASE = 'https://atcoder.jp';
const PAGE_SIZE = 20;

class LoginRequired extends Error {}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const configPath = args.find((a, i) => !a.startsWith('--') && !['--delay', '--out'].includes(args[i - 1]));

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** 환경 변수에는 쿠키 값만 넣어도 되고, 브라우저에서 복사한 Cookie 헤더를 통째로 넣어도 된다. */
function cookieHeader(): string | undefined {
  const session = process.env.ATCODER_SESSION?.trim();
  if (!session) return undefined;
  return session.includes('REVEL_SESSION=') ? session : `REVEL_SESSION=${session}`;
}

async function get(path: string): Promise<string> {
  const cookie = cookieHeader();
  const res = await fetch(BASE + path, {
    redirect: 'manual',
    headers: { 'User-Agent': 'atcoder-resolver', ...(cookie ? { Cookie: cookie } : {}) },
  });
  if (res.status >= 300 && res.status < 400) {
    const to = res.headers.get('location') ?? '';
    if (to.includes('/login')) throw new LoginRequired(path);
    throw new Error(`${path}: 다른 주소로 넘겨졌습니다. (${res.status} → ${to})`);
  }
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
}

const pageFile = (rawDir: string, page: number) => join(rawDir, `submissions-${page}.html`);

/** 제출 시각이 오름차순인 화면인지. 오름차순이면 꽉 찬 쪽은 다시 받아도 내용이 같다. */
const isAscending = (subs: RawSubmission[]) =>
  subs.length < 2 || Date.parse(subs[0].time) <= Date.parse(subs[subs.length - 1].time);

async function download(contestId: string, rawDir: string, fresh: boolean, delay: number): Promise<void> {
  mkdirSync(rawDir, { recursive: true });

  const topHtml = await get(`/contests/${contestId}?lang=en`);
  writeFileSync(join(rawDir, 'top.html'), topHtml);
  const endMs = Date.parse(parseContestTop(topHtml).endTime);

  try {
    writeFileSync(join(rawDir, 'standings.json'), await get(`/contests/${contestId}/standings/json`));
  } catch (e) {
    console.warn(`! 순위표 JSON을 받지 못했습니다. 공식 순위와 대조하는 단계를 건너뜁니다. (${(e as Error).message || '로그인 필요'})`);
  }

  let reuse = !fresh;
  let lastPage = 1;
  let fetched = 0;
  for (let page = 1; page <= lastPage; page++) {
    const file = pageFile(rawDir, page);
    let html: string | null = null;

    if (reuse && existsSync(file)) {
      const cached = parseSubmissionsPage(readFileSync(file, 'utf8'));
      const settled = cached.submissions.length === PAGE_SIZE && cached.submissions.every((s) => s.verdict !== 'WJ');
      if (settled && isAscending(cached.submissions)) html = readFileSync(file, 'utf8');
    }
    if (html === null) {
      if (fetched > 0) await sleep(delay);
      html = await get(`/contests/${contestId}/submissions?orderBy=created&page=${page}&lang=en`);
      writeFileSync(file, html);
      fetched += 1;
    }

    const parsed = parseSubmissionsPage(html);
    lastPage = Math.max(lastPage, parsed.lastPage);
    process.stdout.write(`\r제출 목록 ${page} / ${lastPage}쪽 (새로 받은 쪽 ${fetched})   `);
    if (parsed.submissions.length === 0) break;

    if (!isAscending(parsed.submissions)) {
      // 최신순 화면이면 받는 동안 새 제출이 들어올 때 쪽이 밀린다. 받아 둔 것을 믿지 않는다.
      reuse = false;
    } else if (Date.parse(parsed.submissions[0].time) >= endMs) {
      // 여기부터는 대회가 끝난 뒤의 연습 제출이다.
      break;
    }
  }
  process.stdout.write('\n');
}

function readRaw(rawDir: string) {
  if (!existsSync(join(rawDir, 'top.html'))) {
    throw new Error(`${rawDir}/top.html이 없습니다. --offline 없이 먼저 한 번 받아 주세요.`);
  }
  const top = parseContestTop(readFileSync(join(rawDir, 'top.html'), 'utf8'));
  const standingsPath = join(rawDir, 'standings.json');
  const standings = existsSync(standingsPath)
    ? (JSON.parse(readFileSync(standingsPath, 'utf8')) as AtCoderStandings)
    : undefined;

  const pages = readdirSync(rawDir)
    .map((name) => Number(name.match(/^submissions-(\d+)\.html$/)?.[1]))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
  // 쪽이 밀려 같은 제출을 두 번 받았을 수 있으니 번호로 한 번만 남긴다.
  const byId = new Map<number, RawSubmission>();
  for (const page of pages) {
    for (const s of parseSubmissionsPage(readFileSync(pageFile(rawDir, page), 'utf8')).submissions) byId.set(s.id, s);
  }
  return { top, standings, submissions: [...byId.values()] };
}

function describeMismatches(list: OfficialMismatch[]): string {
  const lines = list
    .slice(0, 10)
    .map(
      (m) =>
        `    ${m.teamId}: 공식 ${m.official.rank}위 ${m.official.score}점 (${m.official.penalty}) / ` +
        `계산 ${m.computed.rank}위 ${m.computed.score}점 (${m.computed.penalty})`,
    );
  if (list.length > 10) lines.push(`    … 외 ${list.length - 10}명`);
  return lines.join('\n');
}

function checkAgainstOfficial(data: ContestData, standings: AtCoderStandings): void {
  const diff = (d: ContestData) => ({
    final: compareWithOfficial(buildBoard(d, revealAll(d)), standings),
    frozen: compareWithOfficial(buildBoard(d, new Set()), standings),
  });
  const ours = diff(data);
  if (ours.final.length === 0) {
    console.log(`공식 순위표 대조: 최종 순위표가 ${data.teams.length}명 모두 일치합니다.`);
    return;
  }
  if (ours.frozen.length === 0) {
    console.log('공식 순위표 대조: AtCoder 순위표가 아직 프리즈 상태입니다. 프리즈 시점 순위표와는 모두 일치합니다.');
    return;
  }

  const closer = ours.final.length <= ours.frozen.length ? ours.final : ours.frozen;
  console.warn(`! 공식 순위표 대조: ${closer.length}명이 다릅니다.\n${describeMismatches(closer)}`);
  const otherRule = data.contest.rule === 'sum' ? 'last' : 'sum';
  const other = diff({ ...data, contest: { ...data.contest, rule: otherRule } });
  if (other.final.length === 0 || other.frozen.length === 0) {
    console.warn(`! 설정의 rule을 "${otherRule}"로 바꾸면 공식 순위표와 일치합니다.`);
  }
}

async function main() {
  if (!configPath) {
    console.error('사용법: pnpm collect <설정 파일.json> [--offline] [--fresh] [--delay ms] [--out 경로]');
    process.exit(2);
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as ResolverConfig;
  if (!config.contestId) throw new Error('설정 파일에 contestId가 없습니다.');
  const rawDir = resolve('raw', config.contestId);

  if (!flag('--offline')) {
    await download(config.contestId, rawDir, flag('--fresh'), Number(option('--delay') ?? 1000));
  }

  const raw = readRaw(rawDir);
  const participants = config.participants
    ? parseParticipantsCsv(readFileSync(resolve(dirname(configPath), config.participants), 'utf8'))
    : undefined;
  const { data, warnings } = convert({ config, participants, ...raw });

  const out = option('--out') ?? join(dirname(configPath), `${basename(configPath).replace(/(\.config)?\.json$/, '')}.json`);
  if (resolve(out) === resolve(configPath)) throw new Error('결과 파일이 설정 파일을 덮어씁니다. --out으로 다른 경로를 주세요.');
  writeFileSync(out, `${JSON.stringify(data)}\n`);

  const { contest } = data;
  const hidden = data.submissions.filter((s) => s.time >= contest.freezeSeconds).length;
  const frames = buildTimeline(data);
  console.log(`대회: ${contest.title} (${contest.id})`);
  console.log(`시간: ${contest.startTime}부터 ${contest.durationSeconds / 60}분, ${formatClock(contest.freezeSeconds)}부터 프리즈`);
  console.log(`규칙: ${contest.rule}, 오답 페널티 ${contest.penaltySeconds / 60}분`);
  console.log(`참가자 ${data.teams.length}명, 문제 ${data.problems.length}개, 제출 ${data.submissions.length}건 (프리즈 이후 ${hidden}건)`);
  console.log(`공개 단계 ${frames.length}장, 결과 공개 ${frames.filter((f) => f.kind === 'reveal').length}번`);
  for (const w of warnings) console.warn(`! ${w}`);
  if (raw.standings) checkAgainstOfficial(data, raw.standings);
  console.log(`저장: ${out}`);
  console.log(`다음: pnpm bundle ${out}`);
}

main().catch((e) => {
  if (e instanceof LoginRequired) {
    console.error(
      `\n로그인이 필요한 화면입니다: ${e.message}\n` +
        'AtCoder에 로그인한 브라우저의 개발자 도구에서 REVEL_SESSION 쿠키 값을 복사해\n' +
        'ATCODER_SESSION 환경 변수에 넣고 다시 실행해 주세요. 대회 중에는 운영진 계정이어야 전체 제출이 보입니다.',
    );
  } else {
    console.error(`\n${e instanceof Error ? e.message : e}`);
  }
  process.exit(1);
});
