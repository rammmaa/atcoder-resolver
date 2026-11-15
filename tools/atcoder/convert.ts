import type { Row } from '../../src/core/scoring';
import type { AwardRule, ContestData, Problem, Rule, Submission, Team } from '../../src/core/types';
import type { ContestTop, Participant, RawSubmission } from './parse';

/** 대회마다 한 벌씩 쓰는 설정 파일의 내용. */
export interface ResolverConfig {
  /** AtCoder 대회 주소에 쓰이는 이름. https://atcoder.jp/contests/{contestId} */
  contestId: string;
  /** 화면에 띄울 대회 이름. 없으면 AtCoder에 적힌 이름을 쓴다. */
  title?: string;
  /** 기본값은 last. 대회 안내문에 정답 시각의 "합"이라고 적혀 있으면 sum. */
  rule?: Rule;
  /** 없으면 AtCoder 대회 화면에 적힌 값을 쓴다. */
  penaltyMinutes?: number;
  /** 대회 종료 몇 분 전부터의 제출을 가릴지. */
  freezeMinutesBeforeEnd?: number;
  /** 참가자 명단 CSV 경로. 설정 파일이 있는 폴더 기준. */
  participants?: string;
  /** 명단에 있는 사람만 순위표에 싣는다. */
  onlyListed?: boolean;
  /** 순위표에서 뺄 AtCoder 아이디. 운영진 계정 등. */
  exclude?: string[];
  /** 제출이 한 번도 없는 사람도 순위표에 싣는다. */
  includeNoSubmission?: boolean;
  awards?: AwardRule[];
}

/** /contests/{id}/standings/json 응답 가운데 여기서 쓰는 부분. */
export interface AtCoderStandings {
  TaskInfo: { Assignment: string; TaskName: string; TaskScreenName: string }[];
  StandingsData: {
    Rank: number;
    UserName: string;
    UserScreenName: string;
    Affiliation?: string;
    /** Score는 실제 점수의 100배다. Penalty는 오답 수. */
    TotalResult: { Count: number; Score: number; Penalty: number; Elapsed: number };
    TaskResults: Record<string, unknown>;
  }[];
}

export interface ConvertInput {
  config: ResolverConfig;
  top: ContestTop;
  submissions: RawSubmission[];
  standings?: AtCoderStandings;
  participants?: Participant[];
}

export interface ConvertResult {
  data: ContestData;
  warnings: string[];
}

const DEFAULT_PENALTY_SECONDS = 300;

const listNames = (names: string[]) => `${names.length}명: ${names.slice(0, 20).join(', ')}${names.length > 20 ? ' …' : ''}`;

/** AtCoder에서 받은 자료와 설정을 합쳐 리졸버가 읽는 형식으로 바꾼다. */
export function convert({ config, top, submissions, standings, participants }: ConvertInput): ConvertResult {
  const warnings: string[] = [];
  const startMs = Date.parse(top.startTime);
  const durationSeconds = Math.round((Date.parse(top.endTime) - startMs) / 1000);

  if (config.freezeMinutesBeforeEnd === undefined) {
    warnings.push('설정에 freezeMinutesBeforeEnd가 없어 가려지는 제출이 없습니다. 공개할 것이 없는 순위표가 됩니다.');
  }
  const freezeSeconds = durationSeconds - (config.freezeMinutesBeforeEnd ?? 0) * 60;

  // AtCoder 아이디는 대소문자만 다른 것을 같은 계정으로 본다. 표기는 AtCoder 쪽 것을 따른다.
  const canonical = new Map<string, string>();
  const remember = (handle: string) => {
    if (!canonical.has(handle.toLowerCase())) canonical.set(handle.toLowerCase(), handle);
  };
  standings?.StandingsData.forEach((s) => remember(s.UserScreenName));
  submissions.forEach((s) => remember(s.user));
  participants?.forEach((p) => remember(p.handle));
  const idOf = (handle: string) => canonical.get(handle.toLowerCase()) ?? handle;

  const listed = new Map((participants ?? []).map((p) => [idOf(p.handle), p]));
  const official = new Map((standings?.StandingsData ?? []).map((s) => [idOf(s.UserScreenName), s]));
  const excluded = new Set((config.exclude ?? []).map(idOf));

  const inContest = submissions
    .map((s) => ({ raw: s, teamId: idOf(s.user), time: Math.floor((Date.parse(s.time) - startMs) / 1000) }))
    .filter((s) => s.time >= 0 && s.time < durationSeconds);
  const submitters = new Set(inContest.map((s) => s.teamId));

  const candidates = new Set(submitters);
  if (config.includeNoSubmission) {
    for (const id of [...listed.keys(), ...official.keys()]) candidates.add(id);
  }
  const teamIds = [...candidates]
    .filter((id) => !excluded.has(id) && (!config.onlyListed || listed.has(id)))
    .sort((a, b) => a.localeCompare(b));

  const teams = teamIds.map((id): Team => {
    const person = listed.get(id);
    const row = official.get(id);
    const team: Team = { id, name: person?.name ?? row?.UserName ?? id };
    const affiliation = person?.affiliation ?? row?.Affiliation;
    if (affiliation) team.affiliation = affiliation;
    if (person?.group) team.group = person.group;
    return team;
  });

  const included = new Set(teamIds);
  const kept: Submission[] = inContest
    .filter((s) => included.has(s.teamId))
    .map((s) => ({
      id: s.raw.id,
      teamId: s.teamId,
      problemId: s.raw.taskId,
      time: s.time,
      verdict: s.raw.verdict,
      score: s.raw.score,
    }))
    .sort((a, b) => a.time - b.time || a.id - b.id);

  let problems: Problem[];
  if (standings) {
    problems = standings.TaskInfo.map((t) => ({ id: t.TaskScreenName, label: t.Assignment, title: t.TaskName }));
  } else {
    const seen = new Map<string, Problem>();
    for (const s of submissions) {
      if (!seen.has(s.taskId)) seen.set(s.taskId, { id: s.taskId, label: s.taskLabel, title: s.taskTitle });
    }
    problems = [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
  }

  const waiting = kept.filter((s) => s.verdict === 'WJ').length;
  if (waiting > 0) {
    warnings.push(`채점이 끝나지 않은 제출이 ${waiting}건 있습니다. 채점이 끝난 뒤 다시 수집해야 최종 결과가 맞습니다.`);
  }
  if (participants) {
    const unlisted = [...submitters].filter((id) => !listed.has(id) && !excluded.has(id)).sort();
    if (unlisted.length > 0) {
      const fate = config.onlyListed ? '순위표에서 빠집니다.' : '순위표에는 AtCoder 아이디로 실립니다.';
      warnings.push(`명단에 없는 제출자 ${listNames(unlisted)}. ${fate}`);
    }
    const silent = [...listed.keys()].filter((id) => !submitters.has(id)).sort();
    if (silent.length > 0) {
      warnings.push(`명단에 있지만 제출이 없는 참가자 ${listNames(silent)}. 아이디 오타가 아닌지 확인해 주세요.`);
    }
  }

  const data: ContestData = {
    contest: {
      id: config.contestId,
      title: config.title ?? top.title,
      startTime: top.startTime,
      durationSeconds,
      freezeSeconds,
      rule: config.rule ?? 'last',
      penaltySeconds:
        config.penaltyMinutes !== undefined
          ? config.penaltyMinutes * 60
          : (top.penaltySeconds ?? DEFAULT_PENALTY_SECONDS),
    },
    problems,
    teams,
    submissions: kept,
  };
  if (config.awards) data.awards = config.awards;
  return { data, warnings };
}

export interface Standing {
  rank: number;
  score: number;
  penalty: number;
}

export interface OfficialMismatch {
  teamId: string;
  official: Standing;
  computed: Standing;
}

/**
 * 직접 계산한 순위표를 AtCoder 순위표 JSON과 견준다. 점수, 오답 수, 순위 가운데 하나라도 다르면 돌려준다.
 * 운영진처럼 일부를 뺀 경우에도 비교되도록, 공식 순위는 우리 순위표에 실린 사람끼리 다시 매긴다.
 */
export function compareWithOfficial(rows: Row[], standings: AtCoderStandings): OfficialMismatch[] {
  const ours = new Set(rows.map((r) => r.team.id.toLowerCase()));
  const official = standings.StandingsData.filter((s) => ours.has(s.UserScreenName.toLowerCase()));
  const byId = new Map(official.map((s) => [s.UserScreenName.toLowerCase(), s]));

  const mismatches: OfficialMismatch[] = [];
  for (const row of rows) {
    const theirs = byId.get(row.team.id.toLowerCase());
    if (!theirs) continue;
    const expected: Standing = {
      rank: 1 + official.filter((s) => s.Rank < theirs.Rank).length,
      score: theirs.TotalResult.Score / 100,
      penalty: theirs.TotalResult.Penalty,
    };
    const computed: Standing = { rank: row.rank, score: row.score, penalty: row.penalty };
    if (expected.rank !== computed.rank || expected.score !== computed.score || expected.penalty !== computed.penalty) {
      mismatches.push({ teamId: row.team.id, official: expected, computed });
    }
  }
  return mismatches;
}
