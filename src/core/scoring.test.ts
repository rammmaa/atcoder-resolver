import { describe, expect, it } from 'vitest';
import { buildBoard, cellKey, revealAll } from './scoring';
import type { ContestData, ContestInfo, Submission } from './types';

let nextId = 1;
const sub = (
  teamId: string,
  problemId: string,
  time: number,
  verdict: string,
  score = verdict === 'AC' ? 100 : 0,
): Submission => ({ id: nextId++, teamId, problemId, time, verdict, score });

const contest = (submissions: Submission[], info: Partial<ContestInfo> = {}): ContestData => ({
  contest: {
    id: 'test',
    title: 'Test',
    durationSeconds: 10800,
    freezeSeconds: 9000,
    rule: 'last',
    penaltySeconds: 300,
    ...info,
  },
  problems: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' },
  ],
  teams: [
    { id: 'kim', name: '김' },
    { id: 'lee', name: '이' },
    { id: 'park', name: '박' },
  ],
  submissions,
});

const rowOf = (data: ContestData, teamId: string, revealed: ReadonlySet<string> = new Set()) => {
  const row = buildBoard(data, revealed).find((r) => r.team.id === teamId);
  if (!row) throw new Error(`no row for ${teamId}`);
  return row;
};
const cellOf = (data: ContestData, teamId: string, problemId: string, revealed?: ReadonlySet<string>) => {
  const cell = rowOf(data, teamId, revealed).cells.find((c) => c.problemId === problemId);
  if (!cell) throw new Error(`no cell for ${problemId}`);
  return cell;
};

describe('last 규칙 (AtCoder 기본)', () => {
  it('총점은 문제 점수의 합이고, 시간은 마지막 정답 시각에 오답 페널티를 더한 값이다', () => {
    const data = contest([
      sub('kim', 'a', 60, 'WA'),
      sub('kim', 'a', 120, 'AC'),
      sub('kim', 'b', 600, 'AC'),
    ]);
    const row = rowOf(data, 'kim');
    expect(row.score).toBe(200);
    expect(row.solved).toBe(2);
    expect(row.penalty).toBe(1);
    expect(row.time).toBe(600 + 300);
  });

  it('풀지 못한 문제의 오답은 페널티에 넣지 않는다', () => {
    const data = contest([
      sub('kim', 'a', 100, 'AC'),
      sub('kim', 'b', 200, 'WA'),
      sub('kim', 'b', 300, 'TLE'),
    ]);
    const row = rowOf(data, 'kim');
    expect(row.penalty).toBe(0);
    expect(row.time).toBe(100);
    expect(cellOf(data, 'kim', 'b').wrong).toBe(2);
  });

  it('정답 이후의 제출은 무시한다', () => {
    const data = contest([
      sub('kim', 'a', 100, 'AC'),
      sub('kim', 'a', 200, 'WA'),
      sub('kim', 'a', 300, 'AC'),
    ]);
    const cell = cellOf(data, 'kim', 'a');
    expect(cell.time).toBe(100);
    expect(cell.wrong).toBe(0);
  });

  it('컴파일 에러는 오답으로 세지 않는다', () => {
    const data = contest([sub('kim', 'a', 50, 'CE'), sub('kim', 'a', 100, 'AC')]);
    expect(rowOf(data, 'kim').penalty).toBe(0);
    expect(cellOf(data, 'kim', 'a').wrong).toBe(0);
  });

  it('제출이 시각 순서로 들어오지 않아도 결과가 같다', () => {
    const data = contest([sub('kim', 'a', 120, 'AC'), sub('kim', 'a', 60, 'WA')]);
    expect(rowOf(data, 'kim').penalty).toBe(1);
  });

  it('부분 점수는 가장 높은 점수와 그 점수를 처음 받은 시각, 그 전까지의 오답 수를 쓴다', () => {
    const data = contest([
      sub('kim', 'a', 100, 'WA', 30),
      sub('kim', 'a', 200, 'WA', 30),
      sub('kim', 'a', 300, 'WA', 70),
      sub('kim', 'a', 400, 'WA', 50),
    ]);
    const cell = cellOf(data, 'kim', 'a');
    expect(cell.score).toBe(70);
    expect(cell.solved).toBe(false);
    expect(cell.time).toBe(300);
    expect(cell.penalty).toBe(2);
    expect(rowOf(data, 'kim').time).toBe(300 + 2 * 300);
  });
});

describe('순위', () => {
  it('점수가 높은 순, 같으면 시간이 짧은 순으로 정렬한다', () => {
    const data = contest([
      sub('kim', 'a', 500, 'AC'),
      sub('lee', 'a', 100, 'AC'),
      sub('lee', 'b', 900, 'AC'),
      sub('park', 'a', 300, 'AC'),
    ]);
    const board = buildBoard(data, new Set());
    expect(board.map((r) => r.team.id)).toEqual(['lee', 'park', 'kim']);
    expect(board.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('점수와 시간이 모두 같으면 같은 순위를 준다', () => {
    const data = contest([sub('kim', 'a', 300, 'AC'), sub('lee', 'a', 300, 'AC')]);
    const board = buildBoard(data, new Set());
    expect(board.map((r) => r.rank)).toEqual([1, 1, 3]);
    expect(board[2].team.id).toBe('park');
  });

  it('명단에 없는 참가자나 문제의 제출은 무시한다', () => {
    const data = contest([sub('staff', 'a', 10, 'AC'), sub('kim', 'z', 10, 'AC')]);
    const board = buildBoard(data, new Set());
    expect(board).toHaveLength(3);
    expect(board.every((r) => r.score === 0)).toBe(true);
  });
});

describe('프리즈', () => {
  it('프리즈 시각부터의 제출은 가려지고 대기 중인 제출 수로만 보인다', () => {
    const data = contest([
      sub('kim', 'a', 8999, 'WA'),
      sub('kim', 'a', 9000, 'WA'),
      sub('kim', 'a', 9500, 'AC'),
    ]);
    const cell = cellOf(data, 'kim', 'a');
    expect(cell.solved).toBe(false);
    expect(cell.wrong).toBe(1);
    expect(cell.pending).toBe(2);
    expect(rowOf(data, 'kim').score).toBe(0);
  });

  it('공개한 칸은 프리즈 이후 제출까지 반영한다', () => {
    const data = contest([
      sub('kim', 'a', 8999, 'WA'),
      sub('kim', 'a', 9000, 'WA'),
      sub('kim', 'a', 9500, 'AC'),
    ]);
    const revealed = new Set([cellKey('kim', 'a')]);
    const cell = cellOf(data, 'kim', 'a', revealed);
    expect(cell.solved).toBe(true);
    expect(cell.pending).toBe(0);
    expect(cell.penalty).toBe(2);
    expect(rowOf(data, 'kim', revealed).time).toBe(9500 + 2 * 300);
  });

  it('프리즈 전에 이미 푼 문제는 이후 제출이 있어도 대기 중으로 보지 않는다', () => {
    const data = contest([sub('kim', 'a', 100, 'AC'), sub('kim', 'a', 9100, 'WA')]);
    expect(cellOf(data, 'kim', 'a').pending).toBe(0);
  });

  it('프리즈 이후 제출이 컴파일 에러뿐이면 대기 중으로 보지 않는다', () => {
    const data = contest([sub('kim', 'a', 9100, 'CE')]);
    expect(cellOf(data, 'kim', 'a').pending).toBe(0);
  });

  it('revealAll은 대기 중인 칸을 모두 담는다', () => {
    const data = contest([
      sub('kim', 'a', 9100, 'AC'),
      sub('lee', 'b', 9200, 'WA'),
      sub('park', 'c', 100, 'AC'),
    ]);
    expect([...revealAll(data)].sort()).toEqual([cellKey('kim', 'a'), cellKey('lee', 'b')].sort());
    expect(buildBoard(data, revealAll(data)).every((r) => r.cells.every((c) => c.pending === 0))).toBe(true);
  });
});

describe('퍼스트 솔브', () => {
  it('문제를 가장 먼저 푼 참가자의 칸에만 표시한다', () => {
    const data = contest([sub('kim', 'a', 300, 'AC'), sub('lee', 'a', 200, 'AC')]);
    expect(cellOf(data, 'lee', 'a').firstSolve).toBe(true);
    expect(cellOf(data, 'kim', 'a').firstSolve).toBe(false);
  });

  it('프리즈 뒤에 나온 퍼스트 솔브는 그 칸을 공개한 다음에 표시한다', () => {
    const data = contest([sub('kim', 'a', 9100, 'AC')]);
    expect(cellOf(data, 'kim', 'a').firstSolve).toBe(false);
    expect(cellOf(data, 'kim', 'a', revealAll(data)).firstSolve).toBe(true);
  });
});

describe('sum 규칙 (AtCoder의 ICPC식 설정)', () => {
  it('시간은 문제별 정답 시각의 합에 오답 페널티를 더한 값이다', () => {
    const data = contest(
      [
        sub('kim', 'a', 125, 'AC'),
        sub('kim', 'b', 600, 'WA'),
        sub('kim', 'b', 1199, 'AC'),
        sub('kim', 'c', 2000, 'WA'),
        sub('lee', 'a', 3000, 'AC'),
      ],
      { rule: 'sum', penaltySeconds: 1200 },
    );
    const kim = rowOf(data, 'kim');
    expect(kim.score).toBe(200);
    expect(kim.penalty).toBe(1);
    expect(kim.time).toBe(125 + 1199 + 1200);
    expect(buildBoard(data, new Set()).map((r) => r.team.id)).toEqual(['kim', 'lee', 'park']);
  });

  it('SCPC 2026 Div.1 공식 순위표 1위의 점수와 시간을 그대로 재현한다', () => {
    // https://atcoder.jp/contests/scpc2026-div1 안내문에 실린 순위표: 700 (41), 2016:16
    const mmss = (m: number, s: number) => m * 60 + s;
    const official: [string, number, number][] = [
      ['a', mmss(36, 21), 7],
      ['c', mmss(170, 50), 16],
      ['d', mmss(190, 31), 0],
      ['f', mmss(244, 28), 3],
      ['i', mmss(200, 42), 0],
      ['j', mmss(136, 3), 12],
      ['k', mmss(217, 21), 3],
    ];
    const subs: Submission[] = [sub('kim', 'l', 100, 'WA')];
    for (const [problemId, acTime, wrong] of official) {
      for (let i = 0; i < wrong; i++) subs.push(sub('kim', problemId, acTime - wrong + i, 'WA'));
      subs.push(sub('kim', problemId, acTime, 'AC'));
    }
    const data = contest(subs, { rule: 'sum', penaltySeconds: 1200, durationSeconds: 16200, freezeSeconds: 16200 });
    data.problems = 'abcdefghijkl'.split('').map((id) => ({ id, label: id.toUpperCase() }));
    const row = rowOf(data, 'kim');
    expect(row.score).toBe(700);
    expect(row.penalty).toBe(41);
    expect(row.time).toBe(mmss(2016, 16));
  });
});
