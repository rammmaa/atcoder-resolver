import { useEffect, useState } from 'react';
import { parseContestData, parseEmbedded } from '../core/load';
import type { ContestData } from '../core/types';
import { Loader } from './Loader';
import { Resolver } from './Resolver';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * 대회 자료를 찾는 순서:
 * 1. `pnpm bundle`이 HTML에 심어 둔 자료
 * 2. 주소의 ?data=경로 (개발 서버나 웹 서버로 띄웠을 때)
 * 3. 없으면 파일을 고르는 화면
 */
export function App() {
  const [data, setData] = useState<ContestData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const embedded = parseEmbedded(document.getElementById('resolver-data')?.textContent);
      if (embedded) {
        setData(embedded);
        return;
      }
    } catch (e) {
      setError(messageOf(e));
      return;
    }

    const url = new URLSearchParams(window.location.search).get('data');
    if (!url) return;
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`${url}을(를) 받지 못했습니다. (HTTP ${res.status})`);
        return res.text();
      })
      .then((text) => setData(parseContestData(text)))
      .catch((e) => setError(messageOf(e)));
  }, []);

  if (!data) return <Loader error={error} onLoad={setData} onError={setError} />;
  return <Resolver data={data} />;
}
