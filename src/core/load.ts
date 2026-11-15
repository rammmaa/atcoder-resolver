import type { ContestData } from './types';

/** 초를 AtCoder 순위표와 같은 "분:초"로 적는다. 60분이 넘어도 시간 단위로 올리지 않는다. */
export const formatClock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function fail(path: string, expected: string): never {
  throw new Error(`대회 자료의 ${path} 항목이 올바르지 않습니다. ${expected}`);
}

function need(obj: Json, path: string, key: string, type: 'string' | 'number') {
  const value = obj[key];
  const ok = type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === 'string';
  if (!ok) fail(`${path}.${key}`, type === 'number' ? '숫자여야 합니다.' : '문자열이어야 합니다.');
}

function needList(root: Json, key: string, fields: Record<string, 'string' | 'number'>, allowEmpty: boolean) {
  const list = root[key];
  if (!Array.isArray(list) || (!allowEmpty && list.length === 0)) {
    fail(key, allowEmpty ? '배열이어야 합니다.' : '하나 이상 들어 있는 배열이어야 합니다.');
  }
  list.forEach((item, i) => {
    if (!isObject(item)) fail(`${key}[${i}]`, '객체여야 합니다.');
    for (const [field, type] of Object.entries(fields)) need(item, `${key}[${i}]`, field, type);
  });
}

function needUniqueIds(root: Json, key: string) {
  const seen = new Set<string>();
  for (const item of root[key] as { id: string }[]) {
    if (seen.has(item.id)) fail(key, `id "${item.id}"가 두 번 나옵니다.`);
    seen.add(item.id);
  }
}

/** JSON 문자열을 읽어 형식을 확인한다. 틀린 곳이 있으면 어느 항목인지 적어 오류를 낸다. */
export function parseContestData(text: string): ContestData {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new Error('JSON 형식이 아닙니다. 수집기가 만든 대회 자료 파일(.json)을 골라 주세요.');
  }
  if (!isObject(root)) fail('최상위', '객체여야 합니다.');

  const contest = root.contest;
  if (!isObject(contest)) fail('contest', '객체여야 합니다.');
  need(contest, 'contest', 'id', 'string');
  need(contest, 'contest', 'title', 'string');
  need(contest, 'contest', 'durationSeconds', 'number');
  need(contest, 'contest', 'freezeSeconds', 'number');
  need(contest, 'contest', 'penaltySeconds', 'number');
  if (contest.rule !== 'last' && contest.rule !== 'sum') fail('contest.rule', '"last" 또는 "sum"이어야 합니다.');

  needList(root, 'problems', { id: 'string', label: 'string' }, false);
  needList(root, 'teams', { id: 'string', name: 'string' }, false);
  needList(
    root,
    'submissions',
    { id: 'number', teamId: 'string', problemId: 'string', time: 'number', verdict: 'string', score: 'number' },
    true,
  );
  needUniqueIds(root, 'problems');
  needUniqueIds(root, 'teams');
  if (root.awards !== undefined) needList(root, 'awards', { name: 'string' }, true);

  return root as unknown as ContestData;
}

const SLOT = /(<script type="application\/json" id="resolver-data">)([\s\S]*?)(<\/script>)/;

/**
 * 빌드한 HTML에 대회 자료를 심어 파일 하나로 만든다.
 * 이름에 "</script>"가 들어 있어도 태그가 닫히지 않도록 "<"를 JSON 이스케이프로 바꿔 넣는다.
 */
export function injectData(html: string, data: ContestData): string {
  if (!SLOT.test(html)) throw new Error('HTML에서 자료를 심을 자리(id="resolver-data")를 찾지 못했습니다.');
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return html.replace(SLOT, (_, open: string, __, close: string) => open + json + close);
}

/** 심어 둔 자료의 본문을 읽는다. 비어 있으면 null. */
export function parseEmbedded(text: string | null | undefined): ContestData | null {
  return text && text.trim() !== '' ? parseContestData(text) : null;
}

export function readEmbeddedData(html: string): ContestData | null {
  return parseEmbedded(html.match(SLOT)?.[2]);
}
