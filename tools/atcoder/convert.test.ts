import { describe, expect, it } from 'vitest';
import { buildBoard, revealAll } from '../../src/core/scoring';
import {
  type AtCoderStandings,
  compareSubmissionCounts,
  compareWithOfficial,
  convert,
  type ConvertInput,
  suggestSettings,
} from './convert';
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

const standings = (
  rows: [handle: string, rank: number, score: number, penalty: number, elapsedSeconds?: number][],
): AtCoderStandings => ({
  TaskInfo: [
    { Assignment: 'B', TaskName: '둘째', TaskScreenName: 'ycpc2026_b' },
    { Assignment: 'A', TaskName: '첫째', TaskScreenName: 'ycpc2026_a' },
  ],
  StandingsData: rows.map(([handle, Rank, score, Penalty, elapsed = 0]) => ({
    Rank,
    UserName: handle,
    UserScreenName: handle,
    Affiliation: `${handle} 소속`,
    // AtCoder는 점수를 100배로, 시간을 나노초로 준다.
    TotalResult: { Count: 1, Score: score * 100, Penalty, Elapsed: elapsed * 1e9 },
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

  it('순위표 JSON의 표시 이름이 비어 있으면 아이디를 이름으로 쓴다', () => {
    const official = standings([['alice', 1, 100, 0]]);
    official.StandingsData[0].UserName = '';
    const { data } = convert(input({ standings: official }));
    expect(data.teams.find((t) => t.id === 'alice')?.name).toBe('alice');
  });

  it('순위표 JSON에서 아이디가 빈 행은 참가자로 보지 않는다', () => {
    const official = standings([
      ['alice', 1, 100, 0],
      ['', 2, 0, 0],
    ]);
    const { data } = convert(
      input({ standings: official, config: { contestId: 'ycpc2026', freezeMinutesBeforeEnd: 30, includeNoSubmission: true } }),
    );
    expect(data.teams.map((t) => t.id)).toEqual(['alice', 'bob']);
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

describe('convert: 설정이나 자료가 어긋났을 때의 경고', () => {
  it('exclude에 적은 아이디가 대회에 없으면 알린다', () => {
    const { warnings } = convert(input({ config: { contestId: 'ycpc2026', freezeMinutesBeforeEnd: 30, exclude: ['bob', 'bbo'] } }));
    expect(warnings.join('\n')).toMatch(/exclude.*bbo/);
    expect(warnings.join('\n')).not.toMatch(/exclude.*bob/);
  });

  it('명단에 같은 아이디가 두 번 나오면 알린다', () => {
    const { warnings } = convert(
      input({
        participants: [
          { handle: 'alice', name: '김앨리스' },
          { handle: 'bob', name: '박밥' },
          { handle: 'Alice', name: '다른 이름' },
        ],
      }),
    );
    expect(warnings.join('\n')).toMatch(/두 번.*alice/i);
  });

  it('순위표 JSON의 문제 목록에 없는 문제로 낸 제출이 있으면 알린다', () => {
    const { warnings } = convert(
      input({
        submissions: [raw('alice', 'A', '18:00:00'), raw('alice', 'Z', '18:10:00')],
        standings: standings([['alice', 1, 100, 0]]),
      }),
    );
    expect(warnings.join('\n')).toMatch(/문제 목록에 없는.*1건/);
  });
});

describe('compareSubmissionCounts', () => {
  const official = (counts: [handle: string, count: number][]): AtCoderStandings => {
    const result = standings(counts.map(([handle], i) => [handle, i + 1, 0, 0]));
    result.StandingsData.forEach((row, i) => (row.TotalResult.Count = counts[i][1]));
    return result;
  };
  const collected = () =>
    convert(
      input({
        submissions: [
          raw('alice', 'A', '18:00:00', 'WA'),
          raw('alice', 'A', '18:05:00'),
          raw('bob', 'A', '20:10:00', 'CE'),
          raw('bob', 'A', '20:15:00'),
        ],
      }),
    ).data;

  it('참가자마다 받은 제출 수가 공식 순위표의 제출 수와 같으면 차이가 없다', () => {
    expect(compareSubmissionCounts(collected(), official([['alice', 2], ['bob', 2]]))).toEqual({ state: 'match', differing: [] });
  });

  it('받은 제출이 모자란 참가자를 찾아낸다', () => {
    expect(compareSubmissionCounts(collected(), official([['alice', 3], ['bob', 2]]))).toEqual({
      state: 'mismatch',
      differing: [{ teamId: 'alice', official: 3, collected: 2 }],
    });
  });

  it('공식 순위표가 프리즈 전 제출만 세고 있으면 프리즈 상태로 본다', () => {
    expect(compareSubmissionCounts(collected(), official([['alice', 2], ['bob', 0]]))).toEqual({ state: 'frozen', differing: [] });
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

  // alice는 30분에 정답(1800초), bob은 40분에 오답 뒤 50분에 정답(3000초 + 페널티 1200초).
  it('점수, 오답 수, 시간, 순위가 모두 같으면 차이가 없고 견준 인원을 알려 준다', () => {
    const official = standings([
      ['staff', 1, 100, 0, 60],
      ['alice', 2, 100, 0, 1800],
      ['bob', 3, 100, 1, 4200],
    ]);
    expect(compareWithOfficial(finalRows(), official)).toEqual({ compared: 2, mismatches: [], missing: [] });
  });

  it('공식 순위표와 다른 참가자를 찾아낸다', () => {
    const official = standings([
      ['bob', 1, 200, 0, 1000],
      ['alice', 2, 100, 0, 1800],
    ]);
    expect(compareWithOfficial(finalRows(), official).mismatches).toEqual([
      {
        teamId: 'alice',
        official: { rank: 2, score: 100, penalty: 0, time: 1800 },
        computed: { rank: 1, score: 100, penalty: 0, time: 1800 },
      },
      {
        teamId: 'bob',
        official: { rank: 1, score: 200, penalty: 0, time: 1000 },
        computed: { rank: 2, score: 100, penalty: 1, time: 4200 },
      },
    ]);
  });

  it('순위와 점수가 같아도 시간이 다르면 찾아낸다', () => {
    const official = standings([
      ['alice', 1, 100, 0, 1800],
      ['bob', 2, 100, 1, 3600],
    ]);
    expect(compareWithOfficial(finalRows(), official).mismatches.map((m) => m.teamId)).toEqual(['bob']);
  });

  it('점수가 없는 참가자는 시간을 비교하지 않는다', () => {
    const zero = convert(input({ submissions: [raw('alice', 'A', '18:00:00', 'WA')] })).data;
    const official = standings([['alice', 1, 0, 0, 999]]);
    expect(compareWithOfficial(buildBoard(zero, revealAll(zero)), official).mismatches).toEqual([]);
  });

  it('공식 순위표에 없는 참가자는 일치로 치지 않고 따로 알려 준다', () => {
    const official = standings([['alice', 1, 100, 0, 1800]]);
    expect(compareWithOfficial(finalRows(), official)).toEqual({ compared: 1, mismatches: [], missing: ['bob'] });
  });

  it('공식 순위표가 비어 있으면 견준 인원이 0명이다', () => {
    expect(compareWithOfficial(finalRows(), standings([]))).toEqual({
      compared: 0,
      mismatches: [],
      missing: ['alice', 'bob'],
    });
  });
});

describe('suggestSettings', () => {
  // 대회 화면의 페널티는 20분이다. bob은 A를 18:10에 틀리고 18:20에 맞힌 뒤 B를 18:30에 맞힌다.
  // alice는 A를 18:00에, B를 18:40에 맞힌다.
  const data = (config: Partial<ConvertInput['config']> = {}) =>
    convert(
      input({
        submissions: [
          raw('alice', 'A', '18:00:00'),
          raw('bob', 'A', '18:10:00', 'WA'),
          raw('bob', 'A', '18:20:00'),
          raw('bob', 'B', '18:30:00'),
          raw('alice', 'B', '18:40:00'),
        ],
        config: { contestId: 'ycpc2026', freezeMinutesBeforeEnd: 30, ...config },
      }),
    ).data;

  // last, 페널티 5분: alice 70분(4200초), bob 60분 + 5분(3900초)이라 bob이 1위.
  const lastFive = standings([
    ['bob', 1, 200, 1, 3900],
    ['alice', 2, 200, 0, 4200],
  ]);

  it('지금 설정이 공식 순위표와 맞으면 제안하지 않는다', () => {
    expect(suggestSettings(data({ rule: 'last', penaltyMinutes: 5 }), lastFive)).toBeNull();
  });

  it('페널티만 다르면 페널티를 바꾸라고 제안한다', () => {
    expect(suggestSettings(data({ rule: 'last' }), lastFive)).toEqual({ rule: 'last', penaltyMinutes: 5, stage: 'final' });
  });

  it('규칙만 다르면 페널티는 그대로 두고 규칙을 바꾸라고 제안한다', () => {
    expect(suggestSettings(data({ rule: 'sum', penaltyMinutes: 5 }), lastFive)).toEqual({
      rule: 'last',
      penaltyMinutes: 5,
      stage: 'final',
    });
  });

  it('규칙과 페널티가 모두 다르면 둘 다 바꾸라고 제안한다', () => {
    expect(suggestSettings(data({ rule: 'sum' }), lastFive)).toEqual({ rule: 'last', penaltyMinutes: 5, stage: 'final' });
  });

  it('어떤 설정으로도 맞지 않으면 null', () => {
    const impossible = standings([
      ['alice', 1, 300, 0, 100],
      ['bob', 2, 200, 1, 3900],
    ]);
    expect(suggestSettings(data({ rule: 'last' }), impossible)).toBeNull();
  });
});
