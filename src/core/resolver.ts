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
      eligible
        .filter((r) => r.team.group === rule.group && !(rule.excludeAwarded && awards.has(r.team.id)))
        .slice(0, rule.count ?? 1)
        .forEach((row) => give(row, rule.name));
    }
  }
  return awards;
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
  const awards = assignAwards(buildBoard(data, revealAll(data)), data.awards ?? []);
  const revealed = new Set<string>();
  let rows = buildBoard(data, revealed);

  const frames: Frame[] = [{ kind: 'start', rows, cursor: null, finalized: 0 }];
  let cursor = rows.length - 1;

  while (cursor >= 0) {
    const finalized = rows.length - 1 - cursor;
    const teamId = rows[cursor].team.id;
    const pending = rows[cursor].cells.find((c) => c.pending > 0);

    if (!pending) {
      frames.push({ kind: 'final', rows, cursor, teamId, finalized: finalized + 1 });
      const won = awards.get(teamId);
      if (won) frames.push({ kind: 'award', rows, cursor, teamId, awards: won, finalized: finalized + 1 });
      cursor -= 1;
      continue;
    }

    const { problemId } = pending;
    frames.push({ kind: 'pick', rows, cursor, teamId, problemId, finalized });

    revealed.add(cellKey(teamId, problemId));
    rows = buildBoard(data, revealed);
    const to = rows.findIndex((r) => r.team.id === teamId);
    const after = rows[to].cells.find((c) => c.problemId === problemId);
    const outcome: Outcome = after?.solved ? 'solved' : (after?.score ?? 0) > pending.score ? 'partial' : 'failed';
    frames.push({ kind: 'reveal', rows, cursor, teamId, problemId, outcome, from: cursor, to, finalized });
  }

  frames.push({ kind: 'end', rows, cursor: null, finalized: rows.length });
  return frames;
}
