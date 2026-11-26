/**
 * AtCoder에서 대회 자료를 받아 리졸버가 읽는 JSON으로 바꾼다.
 *
 *   pnpm collect data/ycpc2026.config.json
 *   pnpm collect data/ycpc2026.config.json --offline   # raw/에 받아 둔 것만으로 다시 변환
 *
 * 로그인 쿠키는 저장소 폴더의 .env 파일에 ATCODER_SESSION=<REVEL_SESSION 쿠키 값>으로 적어 둔다.
 * 같은 이름의 환경 변수가 있으면 그쪽을 먼저 쓴다.
 *
 * 옵션
 *   --offline      AtCoder에 접속하지 않고 raw/<contestId>/에 있는 파일만 쓴다
 *   --delay <ms>   요청 사이에 쉬는 시간. 기본 1000
 *   --out <path>   결과 파일 경로. 기본은 설정 파일 이름에서 .config를 뺀 것
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { formatClock } from '../src/core/load';
import { assignAwards, buildTimeline } from '../src/core/resolver';
import { buildBoard, revealAll } from '../src/core/scoring';
import type { ContestData } from '../src/core/types';
import {
  type AtCoderStandings,
  compareSubmissionCounts,
  compareWithOfficial,
  convert,
  type OfficialMismatch,
  type ResolverConfig,
  suggestSettings,
} from './atcoder/convert';
import { type Downloaded, download, LoginRequired } from './atcoder/download';
import { parseContestTop, parseParticipantsCsv, parseSubmissionsPage, type RawSubmission } from './atcoder/parse';
import { toCookieHeader } from './atcoder/session';

const BASE = 'https://atcoder.jp';
const RAW_FILE = /^(top\.html|standings\.json|submissions-\d+\.html)$/;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const configPath = args.find((a, i) => !a.startsWith('--') && !['--delay', '--out'].includes(args[i - 1]));

async function get(path: string): Promise<string> {
  const cookie = toCookieHeader(process.env.ATCODER_SESSION);
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

/** 받은 원본을 raw/<contestId>/에 둔다. 이전 실행의 파일이 섞이지 않게 먼저 지운다. */
function saveRaw(rawDir: string, downloaded: Downloaded): void {
  mkdirSync(rawDir, { recursive: true });
  for (const name of readdirSync(rawDir)) {
    if (RAW_FILE.test(name)) rmSync(join(rawDir, name));
  }
  writeFileSync(join(rawDir, 'top.html'), downloaded.top);
  if (downloaded.standings !== null) writeFileSync(join(rawDir, 'standings.json'), downloaded.standings);
  downloaded.pages.forEach((html, i) => writeFileSync(join(rawDir, `submissions-${i + 1}.html`), html));
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
  // 받는 도중에 쪽이 밀려 같은 제출이 두 번 들어왔을 수 있으니 제출 번호로 한 번만 남긴다.
  const byId = new Map<number, RawSubmission>();
  for (const page of pages) {
    for (const s of parseSubmissionsPage(readFileSync(join(rawDir, `submissions-${page}.html`), 'utf8')).submissions) {
      byId.set(s.id, s);
    }
  }
  return { top, standings, submissions: [...byId.values()], pageCount: pages.length };
}

function describeMismatches(list: OfficialMismatch[]): string {
  const lines = list
    .slice(0, 10)
    .map(
      (m) =>
        `    ${m.teamId}: 공식 ${m.official.rank}위 ${m.official.score}점 (${m.official.penalty}) ${formatClock(m.official.time)} / ` +
        `계산 ${m.computed.rank}위 ${m.computed.score}점 (${m.computed.penalty}) ${formatClock(m.computed.time)}`,
    );
  if (list.length > 10) lines.push(`    … 외 ${list.length - 10}명`);
  return lines.join('\n');
}

function checkSubmissionCounts(data: ContestData, standings: AtCoderStandings): void {
  const { state, differing } = compareSubmissionCounts(data, standings);
  if (state === 'match') {
    console.log('제출 수 대조: 참가자마다 받은 제출 수가 공식 순위표의 제출 수와 모두 같습니다.');
  } else if (state === 'frozen') {
    console.log('제출 수 대조: 프리즈 전 제출 수가 공식 순위표와 모두 같습니다. 공식 순위표는 프리즈 뒤 제출을 아직 세지 않고 있습니다.');
  } else {
    const list = differing
      .slice(0, 10)
      .map((d) => `${d.teamId}(공식 ${d.official}건, 받은 것 ${d.collected}건)`)
      .join(', ');
    console.warn(`! 제출 수 대조: ${differing.length}명의 제출 수가 공식 순위표와 다릅니다. 빠뜨렸거나 두 번 받은 제출이 있을 수 있습니다: ${list}`);
  }
}

function checkAgainstOfficial(data: ContestData, standings: AtCoderStandings): void {
  const diff = (d: ContestData) => ({
    final: compareWithOfficial(buildBoard(d, revealAll(d)), standings),
    frozen: compareWithOfficial(buildBoard(d, new Set()), standings),
  });
  const ours = diff(data);
  const { compared, missing } = ours.final;
  if (compared === 0) {
    console.warn('! 공식 순위표 대조: 견줄 수 있는 참가자가 한 명도 없습니다. 순위표 JSON이 비었거나 아이디가 전혀 겹치지 않습니다.');
    return;
  }
  if (missing.length > 0) {
    console.warn(`! 공식 순위표에 없는 참가자 ${missing.length}명은 대조하지 못했습니다: ${missing.slice(0, 10).join(', ')}`);
  }
  if (ours.final.mismatches.length === 0) {
    console.log(`공식 순위표 대조: ${compared}명의 점수, 오답 수, 시간, 순위가 최종 순위표와 모두 일치합니다.`);
    return;
  }
  if (ours.frozen.mismatches.length === 0) {
    console.log(`공식 순위표 대조: AtCoder 순위표가 아직 프리즈 상태입니다. ${compared}명 모두 프리즈 시점 순위표와 일치합니다.`);
    console.log('  프리즈 뒤의 제출은 아직 대조하지 못했습니다. 프리즈가 풀린 뒤 다시 받으면 최종 순위까지 확인할 수 있습니다.');
    return;
  }

  const closer = ours.final.mismatches.length <= ours.frozen.mismatches.length ? ours.final : ours.frozen;
  console.warn(`! 공식 순위표 대조: ${compared}명 가운데 ${closer.mismatches.length}명이 다릅니다.\n${describeMismatches(closer.mismatches)}`);
  const suggestion = suggestSettings(data, standings);
  if (suggestion) {
    const changes = [
      suggestion.rule !== data.contest.rule && `rule을 "${suggestion.rule}"로`,
      suggestion.penaltyMinutes * 60 !== data.contest.penaltySeconds && `penaltyMinutes를 ${suggestion.penaltyMinutes}로`,
    ].filter(Boolean);
    const target = suggestion.stage === 'final' ? '최종 순위표' : '프리즈 시점 순위표';
    console.warn(`! 설정의 ${changes.join(', ')} 바꾸면 공식 ${target}와 일치합니다.`);
  }
}

/** 최종 순위표에서 총점과 시간이 같아 같은 순위를 받은 참가자 묶음을 알린다. 상 구간 경계에 걸리면 수상 인원이 늘어난다. */
function reportTies(data: ContestData): void {
  const rows = buildBoard(data, revealAll(data)).filter((r) => r.score > 0);
  const awards = assignAwards(rows, data.awards ?? []);
  const groups = new Map<number, typeof rows>();
  for (const row of rows) groups.set(row.rank, [...(groups.get(row.rank) ?? []), row]);
  const ties = [...groups.values()].filter((g) => g.length > 1);
  if (ties.length === 0) {
    console.log('동점 확인: 최종 순위표에 총점과 시간이 모두 같은 참가자가 없습니다.');
    return;
  }
  console.warn(`! 동점 확인: 최종 순위표에 총점과 시간이 모두 같은 묶음이 ${ties.length}개 있습니다.`);
  for (const group of ties) {
    const names = group
      .map((r) => {
        const won = awards.get(r.team.id);
        return `${r.team.name} (${r.team.id})${won ? ` [${won.join(', ')}]` : ''}`;
      })
      .join(', ');
    console.warn(`  ${group[0].rank}위 ${group.length}명, 총점 ${group[0].score}, 시간 ${formatClock(group[0].time)}: ${names}`);
  }
}

async function main() {
  if (!configPath) {
    console.error('사용법: pnpm collect <설정 파일.json> [--offline] [--delay ms] [--out 경로]');
    process.exit(2);
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as ResolverConfig;
  if (!config.contestId) throw new Error('설정 파일에 contestId가 없습니다.');
  // 쿠키를 명령줄에 적으면 셸 기록에 남는다. 저장소에 올라가지 않는 .env 파일에서 읽는다.
  if (!process.env.ATCODER_SESSION && existsSync('.env')) process.loadEnvFile('.env');
  const rawDir = resolve('raw', config.contestId);

  if (!flag('--offline')) {
    const downloaded = await download(config.contestId, {
      get,
      sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
      delay: Number(option('--delay') ?? 1000),
      onPage: (page) => process.stdout.write(`\r제출 목록 ${page}쪽 받는 중   `),
    });
    process.stdout.write('\n');
    if (downloaded.standings === null) {
      console.warn(`! 순위표 JSON을 받지 못했습니다(${downloaded.standingsError}). 공식 순위와 대조하지 않습니다.`);
    }
    saveRaw(rawDir, downloaded);
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
  console.log(`받은 제출 목록 ${raw.pageCount}쪽, 그 가운데 대회 시간 안의 제출 ${data.submissions.length}건 (프리즈 이후 ${hidden}건)`);
  console.log(`참가자 ${data.teams.length}명, 문제 ${data.problems.length}개`);
  console.log(`공개 단계 ${frames.length}장, 결과 공개 ${frames.filter((f) => f.kind === 'reveal').length}번`);
  for (const w of warnings) console.warn(`! ${w}`);
  reportTies(data);
  if (raw.standings) {
    checkSubmissionCounts(data, raw.standings);
    checkAgainstOfficial(data, raw.standings);
  }
  console.log(`저장: ${out}`);
  console.log(`다음: pnpm bundle ${out}`);
}

main().catch((e) => {
  if (e instanceof LoginRequired) {
    console.error(
      `\n로그인이 필요한 화면입니다: ${e.message}\n` +
        (process.env.ATCODER_SESSION
          ? 'ATCODER_SESSION 값으로는 로그인되지 않았습니다. 세션이 끝났거나 값이 잘못 복사된 것 같습니다.\n'
          : 'ATCODER_SESSION이 없습니다.\n') +
        'AtCoder에 로그인한 브라우저의 개발자 도구에서 REVEL_SESSION 쿠키 값을 복사해\n' +
        '.env 파일에 ATCODER_SESSION=<값>으로 적고 다시 실행해 주세요. 대회 중에는 운영진 계정이어야 전체 제출이 보입니다.',
    );
  } else {
    console.error(`\n${e instanceof Error ? e.message : e}`);
  }
  process.exit(1);
});
