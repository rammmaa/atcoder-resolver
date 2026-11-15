import { formatClock } from '../core/load';
import type { Row } from '../core/scoring';
import type { ContestInfo } from '../core/types';

/** 이름이 길어도 화면 폭을 넘지 않는 글자 크기(vw). 한글은 한 글자가 영문의 두 배쯤 넓다. */
function nameSize(name: string): string {
  const width = [...name].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0x2e80 ? 1 : 0.58), 0);
  return `${Math.min(11, 84 / Math.max(1, width)).toFixed(2)}vw`;
}

/** 수상자가 확정됐을 때 순위표 위를 덮는 화면. 다음 키를 누르면 사라진다. */
export function AwardOverlay({ contest, row, awards }: { contest: ContestInfo; row: Row; awards: string[] }) {
  return (
    <div className="award" key={row.team.id}>
      <p className="award-contest">{contest.title}</p>
      <p className="award-name">{awards.join(' · ')}</p>
      <h2 style={{ fontSize: nameSize(row.team.name) }}>{row.team.name}</h2>
      <p className="award-who">{[row.team.affiliation, row.team.group].filter(Boolean).join(' · ')}</p>
      <p className="award-stat">
        <span>
          <b>{row.rank}</b>위
        </span>
        <span>
          <b>{row.solved}</b>문제
        </span>
        <span>
          <b>{formatClock(row.time)}</b>
        </span>
      </p>
    </div>
  );
}
