import { type DragEvent, useRef, useState } from 'react';
import sample from '../../data/sample.json';
import { parseContestData } from '../core/load';
import type { ContestData } from '../core/types';

interface Props {
  error: string | null;
  onLoad: (data: ContestData) => void;
  onError: (message: string | null) => void;
}

/** 자료가 심겨 있지 않을 때 뜨는 첫 화면. 파일을 끌어다 놓거나 골라서 연다. */
export function Loader({ error, onLoad, onError }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const open = async (file: File | undefined) => {
    if (!file) return;
    try {
      onLoad(parseContestData(await file.text()));
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void open(e.dataTransfer.files[0]);
  };

  return (
    <main className="loader">
      <p className="loader-eyebrow">AtCoder Resolver</p>
      <h1>프리즈된 순위표를 한 칸씩 공개합니다</h1>

      <button
        type="button"
        className={`dropzone${over ? ' is-over' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <strong>대회 자료 파일(.json)을 여기에 끌어다 놓으세요</strong>
        <span>클릭해서 고를 수도 있습니다. 파일은 이 브라우저 안에서만 읽습니다.</span>
      </button>
      <input ref={input} type="file" accept=".json,application/json" hidden onChange={(e) => void open(e.target.files?.[0])} />

      {error && <p className="loader-error">{error}</p>}

      <button type="button" className="link" onClick={() => onLoad(parseContestData(JSON.stringify(sample)))}>
        샘플 데이터로 미리 보기
      </button>
    </main>
  );
}
