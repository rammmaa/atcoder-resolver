import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatClock } from '../core/load';
import { assignAwards, buildTimeline, type Frame, type FrameKind } from '../core/resolver';
import type { ContestData } from '../core/types';
import { AwardOverlay } from './AwardOverlay';
import { Board } from './Board';

/** 자동 진행에서 화면 한 장을 보여 주는 시간(ms). 시상 화면은 발표자가 직접 넘긴다. */
const AUTO_DELAY: Record<FrameKind, number> = {
  start: 1200,
  pick: 900,
  reveal: 1600,
  final: 450,
  award: 0,
  end: 0,
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// 브라우저 설정에 따라 localStorage가 막혀 있을 수 있다. 그래도 화면은 떠야 한다.
const readNumber = (key: string): number | null => {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
};
const writeNumber = (key: string, value: number) => {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // 저장하지 못해도 진행에는 지장이 없다.
  }
};

function statusOf(frame: Frame, data: ContestData, resume: string | null): { tone: string; text: string } {
  const team = frame.rows.find((r) => r.team.id === frame.teamId);
  const label = data.problems.find((p) => p.id === frame.problemId)?.label;
  switch (frame.kind) {
    case 'start':
      return {
        tone: 'idle',
        text: `프리즈 시점 순위표 (${formatClock(data.contest.freezeSeconds)} 이후 제출 가림) · ${
          resume ?? '→ 키로 공개 시작, ? 키로 조작법'
        }`,
      };
    case 'pick':
      return { tone: 'wait', text: `${team?.team.name} · ${label}번 결과는?` };
    case 'reveal':
      if (frame.outcome === 'failed') return { tone: 'no', text: `${team?.team.name} · ${label}번 오답` };
      return {
        tone: 'ok',
        text: `${team?.team.name} · ${label}번 ${frame.outcome === 'solved' ? '정답' : '점수 상승'}${
          frame.to !== frame.from ? ` · ${(frame.from ?? 0) + 1}위에서 ${(frame.to ?? 0) + 1}위로` : ''
        }`,
      };
    case 'final':
    case 'award':
      return { tone: 'idle', text: `${team?.rank}위 확정 · ${team?.team.name}` };
    case 'end':
      return { tone: 'idle', text: '최종 순위' };
  }
}

export function Resolver({ data }: { data: ContestData }) {
  const frames = useMemo(() => buildTimeline(data), [data]);
  const awards = useMemo(() => assignAwards(frames[frames.length - 1].rows, data.awards ?? []), [frames, data]);
  const last = frames.length - 1;

  // 같은 자료로 다시 열었을 때만 이어 볼 수 있게 자료의 크기를 키에 넣는다.
  const storageKey = `resolver:${data.contest.id}:${data.teams.length}:${data.submissions.length}:${frames.length}`;
  const [saved] = useState(() => readNumber(storageKey));
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(false);
  const [help, setHelp] = useState(false);
  const [rowsVisible, setRowsVisible] = useState(() => readNumber('resolver:rows') ?? 12);

  const frame = frames[index];
  const go = useCallback((delta: number) => setIndex((i) => clamp(i + delta, 0, last)), [last]);

  useEffect(() => {
    if (index > 0) writeNumber(storageKey, index);
  }, [index, storageKey]);
  useEffect(() => writeNumber('resolver:rows', rowsVisible), [rowsVisible]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const actions: Record<string, () => void> = {
        ArrowRight: () => go(1),
        ' ': () => go(1),
        Enter: () => go(1),
        PageDown: () => go(1),
        ArrowLeft: () => go(-1),
        Backspace: () => go(-1),
        PageUp: () => go(-1),
        Home: () => setIndex(0),
        End: () => setIndex(last),
        a: () => setAuto((v) => !v),
        f: () => {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen?.();
        },
        r: () => saved && setIndex(clamp(saved, 0, last)),
        '+': () => setRowsVisible((n) => Math.max(6, n - 1)),
        '=': () => setRowsVisible((n) => Math.max(6, n - 1)),
        '-': () => setRowsVisible((n) => Math.min(40, n + 1)),
        '?': () => setHelp((v) => !v),
        h: () => setHelp((v) => !v),
        Escape: () => {
          setHelp(false);
          setAuto(false);
        },
      };
      const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!action) return;
      e.preventDefault();
      if (e.key === 'Home' || e.key === 'End') setAuto(false);
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, last, saved]);

  useEffect(() => {
    if (!auto) return;
    if (index >= last) {
      setAuto(false);
      return;
    }
    if (frame.kind === 'award') return;
    const timer = window.setTimeout(() => go(1), AUTO_DELAY[frame.kind]);
    return () => window.clearTimeout(timer);
  }, [auto, index, last, frame.kind, go]);

  const resume = saved && saved < last ? `지난번 ${saved}/${last} 단계에서 멈춤. R 키로 이어 보기, → 키로 처음부터` : null;
  const status = statusOf(frame, data, resume);
  const pendingLeft = frame.rows.reduce((sum, r) => sum + r.cells.filter((c) => c.pending > 0).length, 0);
  const awardTeam = frame.kind === 'award' ? frame.rows.find((r) => r.team.id === frame.teamId) : undefined;

  return (
    <div className="stage" onClick={() => go(1)}>
      <header className="topbar">
        <h1>{data.contest.title}</h1>
        <p className={`status tone-${status.tone}`} key={index}>
          {status.text}
        </p>
        <div className="progress">
          {auto && <span className="auto">자동 진행</span>}
          <span>
            남은 공개 <b>{pendingLeft}</b>
          </span>
          <span>
            확정 <b>{frame.finalized}</b> / {frame.rows.length}
          </span>
        </div>
      </header>

      <Board data={data} frame={frame} awards={awards} rowsVisible={rowsVisible} />

      {awardTeam && <AwardOverlay contest={data.contest} row={awardTeam} awards={frame.awards ?? []} />}

      {help && (
        <div className="help" onClick={(e) => e.stopPropagation()}>
          <h2>조작법</h2>
          <dl>
            <dt>→ Space Enter PageDown, 클릭</dt>
            <dd>다음 단계</dd>
            <dt>← Backspace PageUp</dt>
            <dd>이전 단계</dd>
            <dt>A</dt>
            <dd>자동 진행 켜고 끄기 (시상 화면에서는 멈춥니다)</dd>
            <dt>F</dt>
            <dd>전체 화면</dd>
            <dt>+ −</dt>
            <dd>한 화면에 보이는 줄 수 조절</dd>
            <dt>Home End</dt>
            <dd>처음으로, 최종 순위로</dd>
            <dt>R</dt>
            <dd>지난번에 멈춘 곳에서 이어 보기</dd>
            <dt>? Esc</dt>
            <dd>이 창 열고 닫기</dd>
          </dl>
          <h2>칸 읽는 법</h2>
          <dl>
            <dt>
              <span className="swatch solved" />
            </dt>
            <dd>정답. 숫자는 정답 시각(분:초), 괄호는 그 전에 틀린 횟수</dd>
            <dt>
              <span className="swatch solved first" />
            </dt>
            <dd>그 문제를 가장 먼저 푼 참가자</dd>
            <dt>
              <span className="swatch failed" />
            </dt>
            <dd>아직 못 푼 문제. 괄호는 틀린 횟수</dd>
            <dt>
              <span className="swatch pending" />
            </dt>
            <dd>프리즈 뒤 제출이 있어 결과가 가려진 문제. +n은 가려진 제출 수</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
