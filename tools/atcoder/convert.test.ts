import { describe, expect, it } from 'vitest';
import { buildBoard, revealAll } from '../../src/core/scoring';
import { type AtCoderStandings, compareWithOfficial, convert, type ConvertInput } from './convert';
import type { ContestTop, RawSubmission } from './parse';

const top: ContestTop = {
  title: 'YCPC 2026',
  startTime: '2026-11-27T17:30:00+09:00',
  endTime: '2026-11-27T20:30:00+09:00',
  penaltySeconds: 1200,
};

let nextId = 1;
/** hhmmss는 한국 시각. 예: '18:00:00' */
const raw = (user: string, label: string, hhmmss: string, verdict = 'AC'): RawSubmission => ({
  id: nextId++,
  time: `2026-11-27T${hhmmss}+09:00`,
  taskId: `ycpc2026_${label.toLowerCase()}`,
  taskLabel: label,
  taskTitle: `문제 ${label}`,
  user,
  score: verdict === 'AC' ? 100 : 0,
  verdict,
});

const input = (over: Partial<ConvertInput> = {}): ConvertInput => ({
  config: { contestId: 'ycpc2026', rule: 'sum', freezeMinutesBeforeEnd: 30 },
  top,
  submissions: [raw('alice', 'A', '18:00:00'), raw('bob', 'B', '19:00:00', 'WA')],
  ...over,
});

const standings = (rows: [handle: string, rank: number, score: number, penalty: number][]): AtCoderStandings => ({
  TaskInfo: [
    { Assignment: 'B', TaskName: '둘째', TaskScreenName: 'ycpc2026_b' },
    { Assignment: 'A', TaskName: '첫째', TaskScreenName: 'ycpc2026_a' },
  ],
  StandingsData: rows.map(([handle, Rank, score, Penalty]) => ({
    Rank,
    UserName: handle,
    UserScreenName: handle,
    Affiliation: `${handle} 소속`,
    TotalResult: { Count: 1, Score: score * 100, Penalty, Elapsed: 0 },
    TaskResults: {},
  })),
});

describe('convert: 대회 정보', () => {
  it('대회 길이와 프리즈 시각을 초로 계산하고 규칙을 옮긴다', () => {
    const { data } = convert(input());
    expect(data.contest).toEqual({
      id: 'ycpc2026',
      title: 'YCPC 2026',
      startTime: '2026-11-27T17:30:00+09:00',
      durationSeconds: 10800,
      freezeSeconds: 9000,
      rule: 'sum',
      penaltySeconds: 1200,
    });
  });

  it('설정에 적은 이름과 페널티가 대회 화면의 값보다 우선한다', () => {
    const { data } = convert(input({ config: { contestId: 'ycpc2026', title: '연세대 대회', penaltyMinutes: 5 } }));
    expect(data.contest).toMatchObject({ title: '연세대 대회', penaltySeconds: 300, rule: 'last' });
  });

  it('프리즈 설정이 없으면 공개할 것이 없다고 알린다', () => {
    const { data, warnings } = convert(input({ config: { contestId: 'ycpc2026' } }));
    expect(data.contest.freezeSeconds).toBe(10800);
    expect(warnings.join('\n')).toMatch(/freezeMinutesBeforeEnd/);
  });
});

describe('convert: 제출', () => {
  it('제출 시각을 대회 시작부터 잰 초로 바꾼다', () => {
    const { data } = convert(input());
    expect(data.submissions.map((s) => [s.teamId, s.problemId, s.time, s.verdict, s.score])).toEqual([
      ['alice', 'ycpc2026_a', 1800, 'AC', 100],
      ['bob', 'ycpc2026_b', 5400, 'WA', 0],
    ]);
  });

  it('대회 시간 밖의 제출은 버린다', () => {
    const { data } = convert(
      input({
        submissions: [
          raw('alice', 'A', '17:29:59'),
          raw('alice', 'A', '17:30:00'),
          raw('alice', 'B', '20:29:59'),
          raw('alice', 'B', '20:30:00'),
        ],
      }),
    );
    expect(data.submissions.map((s) => s.time)).toEqual([0, 10799]);
  });

  it('채점이 끝나지 않은 제출이 있으면 알린다', () => {
    const { warnings } = convert(input({ submissions: [raw('alice', 'A', '18:00:00', 'WJ')] }));
    expect(warnings.join('\n')).toMatch(/채점/);
  });
});

describe('convert: 문제 목록', () => {
  it('순위표 JSON이 없으면 제출에 나온 문제를 열 제목 순서로 쓴다', () => {
    const { data } = convert(input({ submissions: [raw('alice', 'B', '18:00:00'), raw('alice', 'A', '18:10:00')] }));
    expect(data.problems).toEqual([
      { id: 'ycpc2026_a', label: 'A', title: '문제 A' },
      { id: 'ycpc2026_b', label: 'B', title: '문제 B' },
    ]);
  });

  it('순위표 JSON이 있으면 아무도 제출하지 않은 문제까지 그 순서대로 쓴다', () => {
    const { data } = convert(
      input({ submissions: [raw('alice', 'A', '18:00:00')], standings: standings([['alice', 1, 1, 0]]) }),
    );
    expect(data.problems).toEqual([
      { id: 'ycpc2026_b', label: 'B', title: '둘째' },
      { id: 'ycpc2026_a', label: 'A', title: '첫째' },
    ]);
  });
});

describe('convert: 참가자', () => {
  it('명단이 없으면 제출한 사람을 AtCoder 아이디 그대로 싣는다', () => {
    const { data } = convert(input());
    expect(data.teams).toEqual([
      { id: 'alice', name: 'alice' },
      { id: 'bob', name: 'bob' },
    ]);
  });

  it('명단의 이름, 소속, 그룹을 쓰고 아이디의 대소문자는 구분하지 않는다', () => {
    const { data } = convert(
      input({ participants: [{ handle: 'ALICE', name: '김앨리스', affiliation: '컴퓨터과학과', group: '새내기' }] }),
    );
    expect(data.teams[0]).toEqual({ id: 'alice', name: '김앨리스', affiliation: '컴퓨터과학과', group: '새내기' });
  });

  it('명단에 소속이 없으면 순위표 JSON의 소속을 쓴다', () => {
    const { data } = convert(input({ standings: standings([['alice', 1, 1, 0]]) }));
    expect(data.teams.find((t) => t.id === 'alice')).toEqual({ id: 'alice', name: 'alice', affiliation: 'alice 소속' });
  });

  it('exclude에 적은 아이디는 참가자와 제출에서 모두 뺀다', () => {
    const { data } = convert(input({ config: { contestId: 'ycpc2026', freezeMinutesBeforeEnd: 30, exclude: ['Bob'] } }));
    expect(data.teams.map((t) => t.id)).toEqual(['alice']);
    expect(data.submissions.map((s) => s.teamId)).toEqual(['alice']);
  });

  it('onlyListed면 명단에 있는 사람만 남긴다', () => {
    const { data } = convert(
      input({
        config: { contestId: 'ycpc2026', freezeMinutesBeforeEnd: 30, onlyListed: true },
        participants: [{ handle: 'bob', name: '박밥' }],
      }),
    );
    expect(data.teams).toEqual([{ id: 'bob', name: '박밥' }]);
  });

  it('제출이 없는 사람은 기본으로 빼고, includeNoSubmission이면 명단과 순위표의 사람까지 싣는다', () => {
    const base = {
      participants: [{ handle: 'carol', name: '최캐럴' }],
      standings: standings([
        ['alice', 1, 1, 0],
        ['dave', 2, 0, 0],
      ]),
    };
    expect(convert(input(base)).data.teams.map((t) => t.id)).toEqual(['alice', 'bob']);
    const all = convert(
      input({ ...base, config: { contestId: 'ycpc2026', freezeMinutesBeforeEnd: 30, includeNoSubmission: true } }),
    );
    expect(all.data.teams.map((t) => t.id).sort()).toEqual(['alice', 'bob', 'carol', 'dave']);
  });

  it('명단이 있는데 명단에 없는 사람이 제출했으면 알린다', () => {
    const { warnings } = convert(input({ participants: [{ handle: 'alice', name: '김앨리스' }] }));
    expect(warnings.join('\n')).toMatch(/명단에 없는.*bob/);
  });
});

describe('compareWithOfficial', () => {
  const data = () =>
    convert(
      input({
        submissions: [
          raw('alice', 'A', '18:00:00'),
          raw('bob', 'A', '18:10:00', 'WA'),
          raw('bob', 'A', '18:20:00'),
          raw('staff', 'A', '17:31:00'),
        ],
        config: { contestId: 'ycpc2026', rule: 'sum', freezeMinutesBeforeEnd: 30, exclude: ['staff'] },
      }),
    ).data;
  const finalRows = () => buildBoard(data(), revealAll(data()));

  it('점수, 오답 수, 순위가 모두 같으면 차이가 없다', () => {
    const official = standings([
      ['staff', 1, 100, 0],
      ['alice', 2, 100, 0],
      ['bob', 3, 100, 1],
    ]);
    expect(compareWithOfficial(finalRows(), official)).toEqual([]);
  });

  it('공식 순위표와 다른 참가자를 찾아낸다', () => {
    const official = standings([
      ['bob', 1, 200, 0],
      ['alice', 2, 100, 0],
    ]);
    expect(compareWithOfficial(finalRows(), official)).toEqual([
      { teamId: 'alice', official: { rank: 2, score: 100, penalty: 0 }, computed: { rank: 1, score: 100, penalty: 0 } },
      { teamId: 'bob', official: { rank: 1, score: 200, penalty: 0 }, computed: { rank: 2, score: 100, penalty: 1 } },
    ]);
  });
});
