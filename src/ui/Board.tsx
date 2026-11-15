import { type CSSProperties, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatClock } from '../core/load';
import type { Frame, Outcome } from '../core/resolver';
import type { Cell, Row } from '../core/scoring';
import type { ContestData } from '../core/types';

/** 커서가 있는 줄 아래로 방금 확정된 줄을 몇 개 보여 줄지. */
const ROWS_BELOW_CURSOR = 2;

interface Props {
  data: ContestData;
  frame: Frame;
  awards: Map<string, string[]>;
  rowsVisible: number;
  /** 이 참가자의 이름을 보여 줘도 되는지. 커서가 오기 전에는 가린다. */
  named: (teamId: string) => boolean;
}

export function Board({ data, frame, awards, rowsVisible, named }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [animated, setAnimated] = useState(false);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setHeight(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 줄 높이를 처음 잰 직후에는 줄들이 0에서 제자리로 날아가지 않도록 전환 효과를 한 박자 늦게 켠다.
  useEffect(() => {
    if (height === 0 || animated) return;
    const id = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(id);
  }, [height, animated]);

  const rowHeight = height / rowsVisible;
  const total = frame.rows.length;
  const maxScroll = Math.max(0, total * rowHeight - height);
  const scroll =
    frame.cursor === null ? 0 : Math.min(maxScroll, Math.max(0, (frame.cursor + 1 + ROWS_BELOW_CURSOR) * rowHeight - height));

  // 줄이 움직일 때 DOM 순서가 바뀌면 전환 효과가 끊긴다. 순서는 아이디로 고정하고 위치만 transform으로 옮긴다.
  const position = useMemo(() => new Map(frame.rows.map((r, i) => [r.team.id, i])), [frame.rows]);
  const stable = useMemo(() => [...frame.rows].sort((a, b) => a.team.id.localeCompare(b.team.id)), [frame.rows]);

  const columns = `0.75fr 3.4fr 1.5fr 1.5fr repeat(${data.problems.length}, minmax(0, 1fr))`;
  const vars = { '--row-h': `${rowHeight}px`, '--cols': columns } as CSSProperties;

  return (
    <section className={`board${animated ? ' is-animated' : ''}`} style={vars}>
      <div className="thead">
        <span className="th-rank">순위</span>
        <span className="th-name">참가자</span>
        <span>점수</span>
        <span>시간</span>
        {data.problems.map((p) => (
          <span key={p.id} className="th-problem" title={p.title}>
            {p.label}
          </span>
        ))}
      </div>

      <div className="viewport" ref={viewport}>
        <div className="rows" style={{ transform: `translateY(${-scroll}px)`, height: total * rowHeight }}>
          {height > 0 &&
            stable.map((row) => {
              const at = position.get(row.team.id) ?? 0;
              const spotlight = frame.teamId === row.team.id;
              const finalized = at >= total - frame.finalized;
              return (
                <RowView
                  key={row.team.id}
                  row={row}
                  top={at * rowHeight}
                  spotlight={spotlight}
                  finalized={finalized}
                  hidden={!named(row.team.id)}
                  rising={spotlight && frame.kind === 'reveal' && frame.to !== frame.from}
                  pickedProblem={spotlight && frame.kind === 'pick' ? frame.problemId : undefined}
                  revealedProblem={spotlight && frame.kind === 'reveal' ? frame.problemId : undefined}
                  outcome={spotlight ? frame.outcome : undefined}
                  awards={finalized ? awards.get(row.team.id) : undefined}
                />
              );
            })}
        </div>
      </div>
    </section>
  );
}

interface RowProps {
  row: Row;
  top: number;
  spotlight: boolean;
  finalized: boolean;
  hidden: boolean;
  rising: boolean;
  pickedProblem?: string;
  revealedProblem?: string;
  outcome?: Outcome;
  awards?: string[];
}

const RowView = memo(function RowView(props: RowProps) {
  const { row, top, spotlight, finalized, hidden, rising, pickedProblem, revealedProblem, outcome, awards } = props;
  const classes = ['row', spotlight && 'is-spotlight', finalized && 'is-final', rising && 'is-rising', outcome && `got-${outcome}`];

  return (
    <div className={classes.filter(Boolean).join(' ')} style={{ transform: `translateY(${top}px)` }}>
      <div className="row-inner">
        <span className="rank">{row.rank}</span>
        {hidden ? (
          // 아이디도 이름만큼 누구인지 드러내므로 함께 가린다. 그룹 표시(새내기 등)도 마찬가지다.
          <span className="who is-hidden">
            <span className="name">? ? ?</span>
          </span>
        ) : (
        <span className="who">
          <span className="name">
            {row.team.name}
            {row.team.group && <em className="tag">{row.team.group}</em>}
            {awards?.map((a) => (
              <em key={a} className="tag tag-award">
                {a}
              </em>
            ))}
          </span>
          {row.team.affiliation && <span className="affiliation">{row.team.affiliation}</span>}
        </span>
        )}
        <span className="score">
          {row.score}
          {row.penalty > 0 && <small>({row.penalty})</small>}
        </span>
        <span className="time">{row.score > 0 ? formatClock(row.time) : '–'}</span>
        {row.cells.map((cell) => (
          <CellView
            key={cell.problemId}
            cell={cell}
            picked={pickedProblem === cell.problemId}
            revealed={revealedProblem === cell.problemId}
          />
        ))}
      </div>
    </div>
  );
});

function CellView({ cell, picked, revealed }: { cell: Cell; picked: boolean; revealed: boolean }) {
  const flags = `${picked ? ' is-picked' : ''}${revealed ? ' is-revealed' : ''}`;

  if (cell.pending > 0) {
    return (
      <span className={`cell pending${flags}`}>
        <b>?</b>
        <small>
          {cell.wrong > 0 && `(${cell.wrong}) `}+{cell.pending}
        </small>
      </span>
    );
  }
  if (cell.score > 0) {
    return (
      <span className={`cell ${cell.solved ? 'solved' : 'partial'}${cell.firstSolve ? ' first' : ''}${flags}`}>
        <b>{formatClock(cell.time ?? 0)}</b>
        <small>
          {!cell.solved && `${cell.score}점 `}
          {cell.penalty > 0 && `(${cell.penalty})`}
        </small>
      </span>
    );
  }
  if (cell.wrong > 0) {
    return (
      <span className={`cell failed${flags}`}>
        <b>({cell.wrong})</b>
      </span>
    );
  }
  return <span className="cell empty" />;
}
