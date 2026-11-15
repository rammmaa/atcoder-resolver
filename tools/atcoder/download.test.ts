import { describe, expect, it } from 'vitest';
import { download, LoginRequired } from './download';
import { parseSubmissionsPage } from './parse';

const START = Date.parse('2026-11-27T17:30:00+09:00');
const MINUTE = 60_000;
const END_MINUTE = 180;

const TOP = `<html><head><title>T - AtCoder</title><script>
var startTime = moment("2026-11-27T17:30:00+09:00");
var endTime = moment("2026-11-27T20:30:00+09:00");
</script></head><body><a class="contest-title" href="/contests/t">T</a></body></html>`;

/** AtCoder가 화면에 적는 꼴. 예: 2026-11-27 17:31:00+0900 */
const atcoderTime = (minute: number) =>
  `${new Date(START + minute * MINUTE + 9 * 3600_000).toISOString().slice(0, 19).replace('T', ' ')}+0900`;

const row = (id: number, minute: number) => `<tr>
  <td class="no-break"><time class='fixtime fixtime-second'>${atcoderTime(minute)}</time></td>
  <td><a href="/contests/t/tasks/t_a">A - 문제</a></td>
  <td><a href="/users/user${id}">user${id}</a></td>
  <td class="text-right submission-score" data-id="${id}">100</td>
  <td class='text-center'><span class='label label-success'>AC</span></td>
</tr>`;

interface FakeOptions {
  /** 제출마다 대회 시작부터 잰 분. 호출할 때마다 다시 읽으므로 도중에 늘릴 수 있다. */
  minutes: () => number[];
  standings?: 'ok' | 'login';
  submissions?: 'ok' | 'login';
  /** 마지막 쪽에도 다음 링크를 단다. 제출 수를 모르는 서버를 흉내 낸다. */
  alwaysNext?: boolean;
}

function fakeAtCoder(options: FakeOptions) {
  const requests: string[] = [];
  const sleeps: number[] = [];
  const get = async (path: string) => {
    requests.push(path);
    if (path === '/contests/t') return TOP;
    if (path === '/contests/t/standings/json') {
      if (options.standings === 'login') throw new LoginRequired(path);
      return '{"TaskInfo":[],"StandingsData":[]}';
    }
    if (options.submissions === 'login') throw new LoginRequired(path);

    const page = Number(new URL(path, 'https://atcoder.jp').searchParams.get('page'));
    const all = options.minutes();
    const rows = all.slice((page - 1) * 20, page * 20).map((minute, i) => row((page - 1) * 20 + i + 1, minute));
    const link = (label: string, to: number | null) =>
      to === null
        ? `<li class="disabled"><a>${label}</a></li>`
        : `<li><a href="/contests/t/submissions?orderBy=created&amp;page=${to}">${label}</a></li>`;
    const hasNext = options.alwaysNext ? rows.length > 0 : all.length > page * 20;
    return `<html><body><nav><ul class="pager">${link('Prev', page > 1 ? page - 1 : null)}${link('Next', hasNext ? page + 1 : null)}</ul></nav>
      <div class="panel panel-default panel-submission"><table><tbody>${rows.join('')}</tbody></table></div></body></html>`;
  };
  const sleep = async (ms: number) => void sleeps.push(ms);
  const pagesRequested = () =>
    requests.filter((r) => r.includes('/submissions')).map((r) => Number(new URL(r, 'https://atcoder.jp').searchParams.get('page')));
  return { get, sleep, requests, sleeps, pagesRequested };
}

const spread = (count: number, from = 1, to = END_MINUTE - 1) =>
  Array.from({ length: count }, (_, i) => from + ((to - from) * i) / Math.max(1, count - 1));

const idsIn = (pages: string[]) => pages.flatMap((html) => parseSubmissionsPage(html).submissions.map((s) => s.id));

describe('download', () => {
  it('다음 쪽 링크를 따라 마지막 쪽까지 받는다', async () => {
    const fake = fakeAtCoder({ minutes: () => spread(45) });
    const result = await download('t', { ...fake, delay: 1000 });
    expect(fake.pagesRequested()).toEqual([1, 2, 3]);
    expect(idsIn(result.pages)).toHaveLength(45);
    expect(result.top).toBe(TOP);
    expect(result.standings).toContain('StandingsData');
  });

  it('제출 수가 한 쪽 크기의 배수여도 빠뜨리거나 더 받지 않는다', async () => {
    const fake = fakeAtCoder({ minutes: () => spread(40) });
    const result = await download('t', { ...fake, delay: 1000 });
    expect(fake.pagesRequested()).toEqual([1, 2]);
    expect(idsIn(result.pages)).toHaveLength(40);
  });

  it('다음 링크를 따라갔는데 빈 쪽이면 거기서 끝낸다', async () => {
    const fake = fakeAtCoder({ minutes: () => spread(40), alwaysNext: true });
    const result = await download('t', { ...fake, delay: 1000 });
    expect(fake.pagesRequested()).toEqual([1, 2, 3]);
    expect(idsIn(result.pages)).toHaveLength(40);
  });

  it('대회가 끝난 뒤의 제출로 시작하는 쪽을 만나면 그 뒤는 받지 않는다', async () => {
    const afterEnd = spread(60, END_MINUTE, END_MINUTE + 600);
    const fake = fakeAtCoder({ minutes: () => [...spread(25), ...afterEnd] });
    const result = await download('t', { ...fake, delay: 1000 });
    expect(fake.pagesRequested()).toEqual([1, 2, 3]);
    expect(idsIn(result.pages).slice(0, 25)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('받는 사이에 제출이 늘어 다음 쪽이 생기면 그 쪽도 받는다', async () => {
    let count = 30;
    const fake = fakeAtCoder({ minutes: () => spread(count) });
    const get = async (path: string) => {
      const html = await fake.get(path);
      if (path.includes('page=1')) count = 70;
      return html;
    };
    const result = await download('t', { ...fake, get, delay: 1000 });
    expect(fake.pagesRequested()).toEqual([1, 2, 3, 4]);
    expect(new Set(idsIn(result.pages)).size).toBeGreaterThanOrEqual(60);
  });

  it('최신순으로 내려오는 화면이면 끝난 뒤의 제출이 먼저 보여도 끝까지 받는다', async () => {
    const newestFirst = [...spread(25), ...spread(30, END_MINUTE, END_MINUTE + 300)].reverse();
    const fake = fakeAtCoder({ minutes: () => newestFirst });
    const result = await download('t', { ...fake, delay: 1000 });
    expect(fake.pagesRequested()).toEqual([1, 2, 3]);
    expect(idsIn(result.pages)).toHaveLength(55);
  });

  it('제출 목록 요청 사이마다 정해진 시간만큼 쉰다', async () => {
    const fake = fakeAtCoder({ minutes: () => spread(45) });
    await download('t', { ...fake, delay: 1500 });
    expect(fake.sleeps).toEqual([1500, 1500]);
  });

  it('순위표 JSON을 받지 못해도 제출 목록은 받고, 이유를 함께 돌려준다', async () => {
    const fake = fakeAtCoder({ minutes: () => spread(5), standings: 'login' });
    const result = await download('t', { ...fake, delay: 0 });
    expect(result.standings).toBeNull();
    expect(result.standingsError).toMatch(/로그인/);
    expect(idsIn(result.pages)).toHaveLength(5);
  });

  it('제출 목록이 로그인 화면으로 넘어가면 받은 척하지 않고 오류를 낸다', async () => {
    const fake = fakeAtCoder({ minutes: () => spread(5), submissions: 'login' });
    await expect(download('t', { ...fake, delay: 0 })).rejects.toBeInstanceOf(LoginRequired);
  });

  it('쪽 수가 한도를 넘으면 끝없이 돌지 않고 오류를 낸다', async () => {
    const fake = fakeAtCoder({ minutes: () => spread(200) });
    await expect(download('t', { ...fake, delay: 0, maxPages: 3 })).rejects.toThrow(/3쪽/);
  });
});
