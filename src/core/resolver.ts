import { buildBoard, cellKey, revealAll, type Row } from './scoring';
import type { AwardRule, ContestData } from './types';

/**
 * - start: 프리즈 시점의 순위표
 * - pick: 다음에 공개할 칸을 가리킨다
 * - reveal: 그 칸의 결과를 공개하고 순위를 다시 매긴다
 * - final: 커서 자리의 참가자가 더 공개할 것이 없어 순위가 확정된다
 * - award: 방금 확정된 참가자가 받는 상을 알린다
 * - end: 최종 순위표
 */
export type FrameKind = 'start' | 'pick' | 'reveal' | 'final' | 'award' | 'end';

export type Outcome = 'solved' | 'partial' | 'failed';

/** 키를 한 번 누를 때마다 넘어가는 화면 한 장. */
export interface Frame {
  kind: FrameKind;
  /** 이 시점의 순위표. 순위 순서대로. */
  rows: Row[];
  /** 지금 처리 중인 자리. 0이 맨 윗줄이다. start와 end에서는 null. */
  cursor: number | null;
  /** 이 프레임에서 주목할 참가자. */
  teamId?: string;
  problemId?: string;
  outcome?: Outcome;
  /** reveal에서 참가자가 옮겨 간 자리. 순위가 그대로면 from과 to가 같다. */
  from?: number;
  to?: number;
  /** 아래에서부터 순위가 확정된 참가자 수. */
  finalized: number;
  awards?: string[];
}

/** 최종 순위표를 받아 참가자별 수상 내역을 정한다. 점수가 없는 참가자는 상을 받지 않는다. */
export function assignAwards(finalRows: Row[], rules: AwardRule[]): Map<string, string[]> {
  const awards = new Map<string, string[]>();
  const give = (row: Row, name: string) => awards.set(row.team.id, [...(awards.get(row.team.id) ?? []), name]);
  const eligible = finalRows.filter((r) => r.score > 0);

  for (const rule of rules) {
    if (rule.rank) {
      const [from, to] = rule.rank;
      for (const row of eligible) {
        if (row.rank >= from && row.rank <= to) give(row, rule.name);
      }
    } else if (rule.group) {
      const candidates = eligible.filter(
        (r) => r.team.group === rule.group && !(rule.excludeAwarded && awards.has(r.team.id)),
      );
      const count = rule.count ?? 1;
      // 마지막 자리에서 동점이면 함께 준다. 순위 구간 상과 같은 원칙이다.
      const cutoff = candidates[count - 1]?.rank;
      candidates.filter((r, i) => i < count || r.rank === cutoff).forEach((row) => give(row, rule.name));
    }
  }
  return awards;
}

/**
 * 참가자마다 이름을 공개하는 프레임 번호. 스팟보드처럼 커서가 처음 그 참가자에게 온 순간 이름을 연다.
 * 모든 참가자는 순위가 확정될 때 반드시 커서를 받으므로 빠지는 사람은 없다.
 */
export function nameRevealedAt(frames: Frame[]): Map<string, number> {
  const at = new Map<string, number>();
  frames.forEach((frame, i) => {
    if (frame.teamId && !at.has(frame.teamId)) at.set(frame.teamId, i);
  });
  return at;
}

/**
 * 프리즈 시점부터 최종 순위표까지의 공개 순서를 전부 미리 계산한다.
 *
 * ICPC Resolver와 같은 방식이다. 커서를 맨 아랫줄에 두고, 그 자리의 참가자에게 가려진 제출이 있으면
 * 문제 순서대로 하나씩 공개한다. 순위가 오르면 커서는 그 자리에 남아 내려온 참가자를 이어서 처리하고,
 * 더 공개할 것이 없으면 그 참가자의 순위를 확정한 뒤 한 줄 위로 올라간다.
 * 가려진 제출을 공개해도 순위가 내려가는 일은 없으므로, 한 번 확정된 자리는 끝까지 바뀌지 않는다.
 */
export function buildTimeline(data: ContestData): Frame[] {
  const finalRows = buildBoard(data, revealAll(data));
  const finalRank = new Map(finalRows.map((r) => [r.team.id, r.rank]));
  const awards = assignAwards(finalRows, data.awards ?? []);
  const revealed = new Set<string>();
  let rows = buildBoard(data, revealed);

  /**
   * 확정된 줄에는 최종 순위를 적는다. 자리는 이미 정해졌어도 순위 숫자는 동점 묶음의 첫 자리로 매기기 때문에,
   * 위에 있던 동점자가 나중에 올라가면 숫자가 바뀐다. "2위 확정"이라고 띄운 뒤에 3위가 되면 안 된다.
   */
  const settle = (current: Row[], finalized: number): Row[] => {
    const from = current.length - finalized;
    if (current.every((row, i) => i < from || row.rank === finalRank.get(row.team.id))) return current;
    return current.map((row, i) => (i < from ? row : { ...row, rank: finalRank.get(row.team.id) ?? row.rank }));
  };

  const frames: Frame[] = [{ kind: 'start', rows, cursor: null, finalized: 0 }];
  let cursor = rows.length - 1;

  while (cursor >= 0) {
    const finalized = rows.length - 1 - cursor;
    const teamId = rows[cursor].team.id;
    const pending = rows[cursor].cells.find((c) => c.pending > 0);

    if (!pending) {
      const settled = settle(rows, finalized + 1);
      frames.push({ kind: 'final', rows: settled, cursor, teamId, finalized: finalized + 1 });
      const won = awards.get(teamId);
      if (won) frames.push({ kind: 'award', rows: settled, cursor, teamId, awards: won, finalized: finalized + 1 });
      cursor -= 1;
      continue;
    }

    const { problemId } = pending;
    frames.push({ kind: 'pick', rows: settle(rows, finalized), cursor, teamId, problemId, finalized });

    revealed.add(cellKey(teamId, problemId));
    rows = buildBoard(data, revealed);
    const to = rows.findIndex((r) => r.team.id === teamId);
    const after = rows[to].cells.find((c) => c.problemId === problemId);
    const outcome: Outcome = after?.solved ? 'solved' : (after?.score ?? 0) > pending.score ? 'partial' : 'failed';
    frames.push({ kind: 'reveal', rows: settle(rows, finalized), cursor, teamId, problemId, outcome, from: cursor, to, finalized });
  }

  frames.push({ kind: 'end', rows, cursor: null, finalized: rows.length });
  return frames;
}
