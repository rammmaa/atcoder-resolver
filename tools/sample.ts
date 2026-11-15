/**
 * 화면을 미리 볼 수 있게 가상의 대회 자료를 만든다. 사람 이름과 아이디는 모두 지어낸 것이다.
 *
 *   pnpm sample            → data/sample.json
 */
import { writeFileSync } from 'node:fs';
import { buildTimeline } from '../src/core/resolver';
import type { ContestData, Submission, Team } from '../src/core/types';

const DURATION = 180 * 60;
const FREEZE = 150 * 60;

// 시드를 고정해 실행할 때마다 같은 자료가 나오게 한다.
let seed = Number(process.env.SAMPLE_SEED ?? 4);
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)];
/** 평균 1 근처에서 가끔 크게 튀는 배수. 풀이 시간이 사람마다 들쭉날쭉한 것을 흉내 낸다. */
const jitter = () => Math.exp((rand() + rand() + rand() - 1.5) * 0.9);

const SURNAMES = [
  'Kim', 'Lee', 'Park', 'Garcia', 'Smith', 'Tanaka', 'Nguyen', 'Müller', 'Rossi', 'Silva', 'Novak', 'Ivanov', 'Chen',
  'Singh', 'Okafor',
];
const GIVEN = [
  'Alex', 'Sam', 'Mina', 'Leo', 'Yuna', 'Omar', 'Ava', 'Noah', 'Iris', 'Kai', 'Lena', 'Hugo', 'Zoe', 'Ravi', 'Emma',
  'Jun', 'Nora', 'Theo', 'Sara', 'Ivan', 'Maya', 'Eli', 'Lucia', 'Finn', 'Aiko', 'Dani', 'Owen', 'Hana', 'Milo', 'Rosa',
];
const DEPARTMENTS = [
  'Computer Science', 'Artificial Intelligence', 'Software', 'Electrical Engineering', 'Mathematics', 'Physics',
  'Industrial Engineering', 'Statistics', 'Mechanical Engineering', 'Urban Planning', 'Information Science', 'Economics',
];
const SYLLABLES = ['ka', 'ri', 'no', 'su', 'me', 'to', 'ha', 'yu', 'ze', 'lo', 'mi', 'ra', 'be', 'chi', 'do', 'ne'];

const teams: Team[] = [];
const usedNames = new Set<string>();
const usedHandles = new Set<string>();
while (teams.length < 40) {
  const surname = pick(SURNAMES);
  const name = `${pick(GIVEN)} ${surname}`;
  const handle = `${pick(SYLLABLES)}${pick(SYLLABLES)}${pick(SYLLABLES)}${Math.floor(rand() * 90 + 10)}`;
  if (usedNames.has(name) || usedHandles.has(handle)) continue;
  usedNames.add(name);
  usedHandles.add(handle);
  const team: Team = { id: handle, name, affiliation: pick(DEPARTMENTS) };
  if (rand() < 0.3) team.group = 'rookie';
  teams.push(team);
}

// 문제마다 평균적인 참가자가 푸는 데 걸리는 분. A가 가장 쉽고 뒤로 갈수록 대체로 어렵다.
const BASE_MINUTES = [6, 12, 18, 24, 32, 40, 52, 65, 80, 100, 130, 170];
const problems = BASE_MINUTES.map((_, i) => ({
  id: `sample_${String.fromCharCode(97 + i)}`,
  label: String.fromCharCode(65 + i),
}));

const submissions: Submission[] = [];
let nextId = 1000;
const submit = (teamId: string, problemId: string, time: number, accepted: boolean) =>
  submissions.push({
    id: nextId++,
    teamId,
    problemId,
    time: Math.floor(time),
    verdict: accepted ? 'AC' : pick(['WA', 'WA', 'WA', 'TLE', 'RE']),
    score: accepted ? 100 : 0,
  });

for (const team of teams) {
  // 실력은 대부분 중간에 몰리고 소수만 아주 높다.
  const skill = 0.25 + 1.6 * rand() ** 2.2;
  let clock = (2 + rand() * 6) * 60;

  // 쉬운 문제부터 풀되 가끔 순서를 바꾼다.
  const order = problems.map((p, i) => ({ p, i, key: i + rand() * 2.5 })).sort((a, b) => a.key - b.key);
  for (const { p, i } of order) {
    const solveAt = clock + ((BASE_MINUTES[i] * 60) / skill) * jitter();
    const wrongs = rand() < 0.45 ? 0 : 1 + Math.floor(rand() * rand() * 5);
    const gaveUp = rand() < 0.08;

    for (let k = 0; k < wrongs; k++) {
      const at = solveAt - (wrongs - k) * (120 + rand() * 480);
      if (at > clock && at < DURATION) submit(team.id, p.id, at, false);
    }
    if (solveAt >= DURATION) {
      // 시간이 모자랐다. 마지막 순간에 던져 본 제출만 남긴다.
      if (rand() < 0.4) submit(team.id, p.id, DURATION - rand() * 240, false);
      break;
    }
    if (gaveUp) {
      clock = solveAt;
      continue;
    }
    submit(team.id, p.id, solveAt, true);
    clock = solveAt + rand() * 120;
  }
}

const data: ContestData = {
  contest: {
    id: 'sample',
    title: 'Sample Contest',
    startTime: '2026-11-27T17:30:00+09:00',
    durationSeconds: DURATION,
    freezeSeconds: FREEZE,
    // AtCoder 기본 방식: 마지막 정답 시각 + 오답당 5분.
    rule: 'last',
    penaltySeconds: 5 * 60,
  },
  problems,
  teams,
  submissions: submissions.sort((a, b) => a.time - b.time || a.id - b.id),
  awards: [
    { name: '1st Prize', rank: [1, 1] },
    { name: '2nd Prize', rank: [2, 3] },
    { name: '3rd Prize', rank: [4, 6] },
    { name: 'Honorable Mention', rank: [7, 10] },
    { name: 'Rookie Award', group: 'rookie', count: 2, excludeAwarded: true },
  ],
};

const frames = buildTimeline(data);
if (process.env.SAMPLE_DRY) {
  // 시드를 고를 때 쓰는 요약. 파일은 쓰지 않는다.
  const reveals = frames.filter((f) => f.kind === 'reveal');
  const top = (rows: typeof frames[number]['rows']) => rows.slice(0, 3).map((r) => r.team.name).join(',');
  console.log(
    `seed=${process.env.SAMPLE_SEED} 공개=${reveals.length} 상승=${reveals.filter((f) => f.to !== f.from).length}`,
    `오답=${reveals.filter((f) => f.outcome === 'failed').length} 처음3=${top(frames[0].rows)} 최종3=${top(frames[frames.length - 1].rows)}`,
  );
  process.exit(0);
}

const out = new URL('../data/sample.json', import.meta.url);
writeFileSync(out, `${JSON.stringify(data, null, 1)}\n`);
const hidden = data.submissions.filter((s) => s.time >= FREEZE).length;
console.log(`참가자 ${teams.length}명, 문제 ${problems.length}개, 제출 ${submissions.length}건 (프리즈 이후 ${hidden}건)`);
console.log(`공개 단계 ${frames.length}장, 그중 결과 공개 ${frames.filter((f) => f.kind === 'reveal').length}번`);
console.log(`저장: ${out.pathname}`);
