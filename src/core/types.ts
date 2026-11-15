/**
 * 동점일 때 비교하는 시간을 구하는 방식. 두 방식 모두 총점이 높은 쪽이 앞선다.
 * - last: AtCoder 기본 방식. 점수를 마지막으로 올린 제출 시각 + 오답 수 × 페널티.
 * - sum: AtCoder의 ICPC식 설정. 문제별 정답 시각의 합 + 오답 수 × 페널티.
 * 오답은 점수를 얻은 문제에서, 그 점수를 받기 전까지 낸 것만 센다.
 */
export type Rule = 'last' | 'sum';

export interface ContestInfo {
  id: string;
  title: string;
  /** ISO 8601. 화면 표시에만 쓴다. */
  startTime?: string;
  durationSeconds: number;
  /** 대회 시작부터 잰 초. 이 시각과 같거나 늦은 제출은 공개 전까지 가려진다. */
  freezeSeconds: number;
  rule: Rule;
  /** 오답 한 번에 더하는 시간(초). AtCoder 기본값은 300, ICPC식 대회는 보통 1200. */
  penaltySeconds: number;
}

export interface Problem {
  id: string;
  /** 순위표 열 제목. 보통 A, B, C … */
  label: string;
  title?: string;
}

export interface Team {
  id: string;
  name: string;
  affiliation?: string;
  /** 새내기 특별상처럼 일부 참가자끼리만 겨루는 상에 쓴다. */
  group?: string;
}

export interface Submission {
  id: number;
  teamId: string;
  problemId: string;
  /** 대회 시작부터 잰 초. */
  time: number;
  /** AtCoder 판정 약어. AC, WA, TLE, RE, CE … */
  verdict: string;
  score: number;
}

export interface AwardRule {
  name: string;
  /** [from, to] 순위(양 끝 포함)에 든 참가자에게 준다. */
  rank?: [number, number];
  /** 이 그룹 안에서 위에서부터 count명에게 준다. */
  group?: string;
  count?: number;
  /** 다른 상을 이미 받은 참가자는 건너뛴다. */
  excludeAwarded?: boolean;
}

export interface ContestData {
  contest: ContestInfo;
  problems: Problem[];
  teams: Team[];
  submissions: Submission[];
  awards?: AwardRule[];
}
