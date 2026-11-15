import { describe, expect, it } from 'vitest';
import { assignAwards, buildTimeline } from './resolver';
import { buildBoard, cellKey, revealAll } from './scoring';
import type { AwardRule, ContestData, Rule, Submission, Team } from './types';

let nextId = 1;
const sub = (teamId: string, problemId: string, time: number, verdict: string): Submission => ({
  id: nextId++,
  teamId,
  problemId,
  time,
  verdict,
  score: verdict === 'AC' ? 100 : 0,
});

const FREEZE = 9000;

const contest = (teams: (string | Team)[], submissions: Submission[], awards?: AwardRule[]): ContestData => ({
  contest: { id: 't', title: 'T', durationSeconds: 10800, freezeSeconds: FREEZE, rule: 'sum', penaltySeconds: 1200 },
  problems: ['a', 'b', 'c'].map((id) => ({ id, label: id.toUpperCase() })),
  teams: teams.map((t) => (typeof t === 'string' ? { id: t, name: t } : t)),
  submissions,
  awards,
});

const ids = (rows: { team: Team }[]) => rows.map((r) => r.team.id);
const kinds = (data: ContestData) => buildTimeline(data).map((f) => f.kind);

describe('buildTimeline', () => {
  it('첫 프레임은 프리즈 시점의 순위표이고 마지막 프레임은 최종 순위표다', () => {
    const data = contest(
      ['kim', 'lee'],
      [sub('kim', 'a', 100, 'AC'), sub('lee', 'a', 9100, 'AC'), sub('lee', 'b', 9200, 'AC')],
    );
    const frames = buildTimeline(data);
    expect(frames[0].kind).toBe('start');
    expect(ids(frames[0].rows)).toEqual(['kim', 'lee']);
    expect(frames[0].rows).toEqual(buildBoard(data, new Set()));
    expect(frames.at(-1)?.kind).toBe('end');
    expect(ids(frames.at(-1)?.rows ?? [])).toEqual(['lee', 'kim']);
    expect(frames.at(-1)?.rows).toEqual(buildBoard(data, revealAll(data)));
  });

  it('대기 중인 제출이 없으면 아래에서부터 한 명씩 순위를 확정한다', () => {
    const data = contest(
      ['kim', 'lee', 'park'],
      [sub('kim', 'a', 100, 'AC'), sub('lee', 'a', 200, 'AC'), sub('park', 'a', 300, 'AC')],
    );
    const frames = buildTimeline(data);
    expect(frames.map((f) => f.kind)).toEqual(['start', 'final', 'final', 'final', 'end']);
    expect(frames.map((f) => f.cursor)).toEqual([null, 2, 1, 0, null]);
    expect(frames.map((f) => f.teamId)).toEqual([undefined, 'park', 'lee', 'kim', undefined]);
    expect(frames.map((f) => f.finalized)).toEqual([0, 1, 2, 3, 3]);
  });

  it('대기 중인 칸은 먼저 가리킨 다음에 공개한다', () => {
    const data = contest(['kim', 'lee'], [sub('kim', 'a', 100, 'AC'), sub('lee', 'b', 9100, 'WA')]);
    const frames = buildTimeline(data);
    expect(frames.map((f) => f.kind)).toEqual(['start', 'pick', 'reveal', 'final', 'final', 'end']);
    const [pick, reveal] = [frames[1], frames[2]];
    expect(pick).toMatchObject({ cursor: 1, teamId: 'lee', problemId: 'b' });
    expect(pick.rows[1].cells[1].pending).toBe(1);
    expect(reveal).toMatchObject({ cursor: 1, teamId: 'lee', problemId: 'b', outcome: 'failed', from: 1, to: 1 });
    expect(reveal.rows[1].cells[1]).toMatchObject({ pending: 0, wrong: 1 });
  });

  it('정답이 공개돼 순위가 오르면 커서는 그 자리에 남아 내려온 참가자를 이어서 처리한다', () => {
    const data = contest(
      ['kim', 'lee', 'park'],
      [
        sub('kim', 'a', 100, 'AC'),
        sub('lee', 'a', 200, 'AC'),
        sub('park', 'a', 9100, 'AC'),
        sub('park', 'b', 9200, 'AC'),
      ],
    );
    const frames = buildTimeline(data);
    const reveals = frames.filter((f) => f.kind === 'reveal');
    expect(reveals[0]).toMatchObject({ teamId: 'park', problemId: 'a', outcome: 'solved', from: 2, to: 2, cursor: 2 });
    expect(reveals[1]).toMatchObject({ teamId: 'park', problemId: 'b', outcome: 'solved', from: 2, to: 0, cursor: 2 });
    expect(ids(reveals[1].rows)).toEqual(['park', 'kim', 'lee']);
    const afterJump = frames[frames.indexOf(reveals[1]) + 1];
    expect(afterJump).toMatchObject({ kind: 'final', cursor: 2, teamId: 'lee' });
  });

  it('한 참가자의 대기 칸은 문제 순서대로 공개한다', () => {
    const data = contest(
      ['kim'],
      [sub('kim', 'c', 9100, 'WA'), sub('kim', 'a', 9200, 'WA'), sub('kim', 'b', 9300, 'WA')],
    );
    const picked = buildTimeline(data)
      .filter((f) => f.kind === 'pick')
      .map((f) => f.problemId);
    expect(picked).toEqual(['a', 'b', 'c']);
  });

  it('확정된 줄에는 최종 순위를 적어서, 위에 있던 동점자가 나중에 올라가도 숫자가 바뀌지 않는다', () => {
    // 프리즈 시점에는 네 명이 모두 0점 동점이고, 이름순 첫 참가자만 프리즈 뒤에 정답을 낸다.
    const data = contest(['a', 'b', 'c', 'd'], [sub('a', 'a', 9100, 'AC')]);
    const frames = buildTimeline(data);
    expect(frames[0].rows.map((r) => r.rank)).toEqual([1, 1, 1, 1]);
    const finals = frames.filter((f) => f.kind === 'final');
    expect(finals.map((f) => [f.teamId, f.rows[f.cursor ?? 0].rank])).toEqual([
      ['d', 2],
      ['c', 2],
      ['b', 2],
      ['a', 1],
    ]);
    // 아직 확정되지 않은 줄은 그 시점의 순위 그대로다.
    expect(finals[0].rows.slice(0, 3).map((r) => r.rank)).toEqual([1, 1, 1]);
  });

  it('상을 받는 참가자는 순위가 확정된 직후에 시상 프레임이 나온다', () => {
    const data = contest(
      ['kim', 'lee'],
      [sub('kim', 'a', 100, 'AC'), sub('lee', 'a', 200, 'AC')],
      [{ name: '대상', rank: [1, 1] }],
    );
    expect(kinds(data)).toEqual(['start', 'final', 'final', 'award', 'end']);
    const award = buildTimeline(data)[3];
    expect(award).toMatchObject({ teamId: 'kim', awards: ['대상'], cursor: 0 });
  });
});

describe('buildTimeline: 무작위 대회에서도 지켜지는 성질', () => {
  // 시드를 고정한 난수. 실패했을 때 같은 입력으로 다시 돌릴 수 있어야 한다.
  const rng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };

  const randomContest = (seed: number, rule: Rule): ContestData => {
    const rand = rng(seed);
    const teams = Array.from({ length: 30 }, (_, i) => `t${String(i).padStart(2, '0')}`);
    const problems = 'abcdefgh'.split('');
    const submissions: Submission[] = [];
    for (const teamId of teams) {
      const skill = rand();
      for (const [pi, problemId] of problems.entries()) {
        if (rand() > skill + 0.3 - pi * 0.05) continue;
        let time = Math.floor(rand() * 10800);
        const tries = 1 + Math.floor(rand() * 4);
        for (let k = 0; k < tries && time < 10800; k++) {
          const last = k === tries - 1;
          submissions.push(sub(teamId, problemId, time, last && rand() < 0.7 ? 'AC' : rand() < 0.1 ? 'CE' : 'WA'));
          time += 60 + Math.floor(rand() * 900);
        }
      }
    }
    const data = contest(teams, submissions);
    data.problems = problems.map((id) => ({ id, label: id.toUpperCase() }));
    data.contest.rule = rule;
    data.contest.penaltySeconds = rule === 'sum' ? 1200 : 300;
    return data;
  };

  const cases = [1, 2, 3, 4, 5].flatMap((seed) => (['last', 'sum'] as const).map((rule) => [seed, rule] as const));

  it.each(cases)('시드 %i, %s 규칙: 마지막 프레임이 최종 순위표와 같다', (seed, rule) => {
    const data = randomContest(seed, rule);
    expect(buildTimeline(data).at(-1)?.rows).toEqual(buildBoard(data, revealAll(data)));
  });

  it.each(cases)('시드 %i, %s 규칙: 대기 중이던 칸을 빠짐없이 한 번씩 공개한다', (seed, rule) => {
    const data = randomContest(seed, rule);
    const frames = buildTimeline(data);
    const revealedKeys = frames
      .filter((f) => f.kind === 'reveal')
      .map((f) => cellKey(f.teamId ?? '', f.problemId ?? ''));
    expect(revealedKeys.length).toBeGreaterThan(0);
    expect([...revealedKeys].sort()).toEqual([...revealAll(data)].sort());
    frames.forEach((f, i) => {
      if (f.kind !== 'reveal') return;
      expect(frames[i - 1]).toMatchObject({ kind: 'pick', teamId: f.teamId, problemId: f.problemId });
      expect(f.to).toBeLessThanOrEqual(f.from ?? -1);
    });
  });

  it.each(cases)('시드 %i, %s 규칙: 한 번 확정된 참가자의 자리는 끝까지 바뀌지 않는다', (seed, rule) => {
    const data = randomContest(seed, rule);
    const frames = buildTimeline(data);
    const finalIds = ids(frames.at(-1)?.rows ?? []);
    let prev = 0;
    for (const f of frames) {
      expect(f.finalized).toBeGreaterThanOrEqual(prev);
      prev = f.finalized;
      const settled = finalIds.length - f.finalized;
      expect(ids(f.rows).slice(settled)).toEqual(finalIds.slice(settled));
    }
    expect(prev).toBe(finalIds.length);
  });
});

describe('assignAwards', () => {
  const freshman = (id: string): Team => ({ id, name: id, group: '새내기' });
  const solved = (teamId: string, time: number) => sub(teamId, 'a', time, 'AC');
  const awardsOf = (data: ContestData) => {
    const result = assignAwards(buildBoard(data, revealAll(data)), data.awards ?? []);
    return Object.fromEntries(result);
  };

  it('순위 구간에 든 참가자에게 상을 준다', () => {
    const data = contest(
      ['kim', 'lee', 'park'],
      [solved('kim', 100), solved('lee', 200), solved('park', 300)],
      [
        { name: '1등상', rank: [1, 1] },
        { name: '2등상', rank: [2, 3] },
      ],
    );
    expect(awardsOf(data)).toEqual({ kim: ['1등상'], lee: ['2등상'], park: ['2등상'] });
  });

  it('동점자는 같은 상을 받는다', () => {
    const data = contest(['kim', 'lee'], [solved('kim', 100), solved('lee', 100)], [{ name: '1등상', rank: [1, 1] }]);
    expect(awardsOf(data)).toEqual({ kim: ['1등상'], lee: ['1등상'] });
  });

  it('점수가 없는 참가자에게는 상을 주지 않는다', () => {
    const data = contest(['kim', 'lee'], [solved('kim', 100)], [{ name: '입상', rank: [1, 2] }]);
    expect(awardsOf(data)).toEqual({ kim: ['입상'] });
  });

  it('그룹 상은 그 그룹 안에서 위에서부터 count명에게 준다', () => {
    const data = contest(
      ['kim', freshman('lee'), freshman('park'), freshman('choi')],
      [solved('kim', 100), solved('lee', 200), solved('park', 300), solved('choi', 400)],
      [{ name: '새내기 특별상', group: '새내기', count: 2 }],
    );
    expect(awardsOf(data)).toEqual({ lee: ['새내기 특별상'], park: ['새내기 특별상'] });
  });

  it('그룹 상도 마지막 자리에서 동점이면 함께 준다', () => {
    const data = contest(
      [freshman('kim'), freshman('lee'), freshman('park')],
      [solved('kim', 100), solved('lee', 200), solved('park', 200)],
      [{ name: '새내기 특별상', group: '새내기', count: 2 }],
    );
    expect(awardsOf(data)).toEqual({ kim: ['새내기 특별상'], lee: ['새내기 특별상'], park: ['새내기 특별상'] });
  });

  it('excludeAwarded면 이미 다른 상을 받은 참가자를 건너뛴다', () => {
    const data = contest(
      [freshman('kim'), freshman('lee'), freshman('park')],
      [solved('kim', 100), solved('lee', 200), solved('park', 300)],
      [
        { name: '1등상', rank: [1, 1] },
        { name: '새내기 특별상', group: '새내기', count: 1, excludeAwarded: true },
      ],
    );
    expect(awardsOf(data)).toEqual({ kim: ['1등상'], lee: ['새내기 특별상'] });
  });
});
