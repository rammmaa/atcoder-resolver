import type { ContestData, Submission, Team } from './types';

export interface Cell {
  problemId: string;
  /** 지금까지 보이는 제출 가운데 가장 높은 점수. */
  score: number;
  solved: boolean;
  /** 가장 높은 점수를 처음 받은 시각(초). 점수가 없으면 null. */
  time: number | null;
  /** 순위 계산에 들어가는 오답 수. 가장 높은 점수를 받기 전까지의 오답만 센다. */
  penalty: number;
  /** 보이는 오답 수. 풀지 못한 문제의 칸에 표시한다. */
  wrong: number;
  /** 프리즈에 가려 아직 공개하지 않은 제출 수. */
  pending: number;
  firstSolve: boolean;
}

export interface Row {
  team: Team;
  /** 문제 순서대로. */
  cells: Cell[];
  score: number;
  solved: number;
  /** 순위 계산에 들어간 오답 수의 합. */
  penalty: number;
  /** 동점일 때 비교하는 시간(초). 페널티가 이미 더해져 있다. */
  time: number;
  rank: number;
}

/** 채점은 됐지만 오답으로 세지 않는 판정. */
const NOT_COUNTED = new Set(['CE', 'IE', 'WJ', 'WR', 'JUDGING']);

const counts = (s: Submission) => !NOT_COUNTED.has(s.verdict.toUpperCase());

export const cellKey = (teamId: string, problemId: string) => `${teamId}\u0000${problemId}`;

const byTime = (a: Submission, b: Submission) => a.time - b.time || a.id - b.id;

/** 참가자와 문제 조합마다 제출을 시각 순서로 모은다. 명단에 없는 참가자나 문제는 버린다. */
function groupSubmissions(data: ContestData): Map<string, Submission[]> {
  const teams = new Set(data.teams.map((t) => t.id));
  const problems = new Set(data.problems.map((p) => p.id));
  const groups = new Map<string, Submission[]>();
  for (const s of data.submissions) {
    if (!teams.has(s.teamId) || !problems.has(s.problemId)) continue;
    const key = cellKey(s.teamId, s.problemId);
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  for (const list of groups.values()) list.sort(byTime);
  return groups;
}

function judgeCell(problemId: string, subs: Submission[], freezeSeconds: number, revealed: boolean): Cell {
  const cell: Cell = {
    problemId,
    score: 0,
    solved: false,
    time: null,
    penalty: 0,
    wrong: 0,
    pending: 0,
    firstSolve: false,
  };
  for (const s of subs) {
    if (cell.solved) break;
    if (!counts(s)) continue;
    if (s.time >= freezeSeconds && !revealed) {
      cell.pending += 1;
      continue;
    }
    const accepted = s.verdict.toUpperCase() === 'AC';
    if (accepted || s.score > cell.score) {
      cell.score = Math.max(cell.score, s.score);
      cell.time = s.time;
      cell.penalty = cell.wrong;
      cell.solved = accepted;
    }
    if (!accepted) cell.wrong += 1;
  }
  return cell;
}

/** 문제마다 가장 이른 정답 시각. 프리즈와 무관하게 전체 제출로 구한다. */
function firstSolveTimes(groups: Map<string, Submission[]>): Map<string, number> {
  const first = new Map<string, number>();
  for (const subs of groups.values()) {
    const ac = subs.find((s) => s.verdict.toUpperCase() === 'AC');
    if (!ac) continue;
    const best = first.get(ac.problemId);
    if (best === undefined || ac.time < best) first.set(ac.problemId, ac.time);
  }
  return first;
}

const compareRows = (a: Row, b: Row) => b.score - a.score || a.time - b.time;

/**
 * 순위표를 계산한다. 프리즈 이후 제출은 `revealed`에 든 칸에서만 반영한다.
 * 결과는 순위 순서로 정렬돼 있고, 점수와 시간이 모두 같으면 같은 `rank`를 가진다.
 */
export function buildBoard(data: ContestData, revealed: ReadonlySet<string>): Row[] {
  const { rule, penaltySeconds, freezeSeconds } = data.contest;
  const groups = groupSubmissions(data);
  const firstSolve = firstSolveTimes(groups);

  const rows = data.teams.map((team): Row => {
    const cells = data.problems.map((problem) => {
      const key = cellKey(team.id, problem.id);
      const cell = judgeCell(problem.id, groups.get(key) ?? [], freezeSeconds, revealed.has(key));
      cell.firstSolve = cell.solved && cell.time === firstSolve.get(problem.id);
      return cell;
    });

    const scored = cells.filter((c) => c.score > 0);
    const times = scored.map((c) => c.time ?? 0);
    const penalty = scored.reduce((sum, c) => sum + c.penalty, 0);
    const base = rule === 'sum' ? times.reduce((sum, t) => sum + t, 0) : Math.max(0, ...times);
    return {
      team,
      cells,
      score: scored.reduce((sum, c) => sum + c.score, 0),
      solved: cells.filter((c) => c.solved).length,
      penalty,
      time: scored.length > 0 ? base + penalty * penaltySeconds : 0,
      rank: 0,
    };
  });

  // 동점자끼리의 표시 순서는 호출할 때마다 같도록 이름으로 고정한다.
  rows.sort(
    (a, b) => compareRows(a, b) || a.team.name.localeCompare(b.team.name, 'ko') || a.team.id.localeCompare(b.team.id),
  );
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    row.rank = prev && compareRows(prev, row) === 0 ? prev.rank : i + 1;
  });
  return rows;
}

/** 프리즈에 가려진 제출이 있는 칸 전부. 이 집합으로 buildBoard를 부르면 최종 순위표가 나온다. */
export function revealAll(data: ContestData): Set<string> {
  const keys = new Set<string>();
  for (const row of buildBoard(data, new Set())) {
    for (const cell of row.cells) {
      if (cell.pending > 0) keys.add(cellKey(row.team.id, cell.problemId));
    }
  }
  return keys;
}
