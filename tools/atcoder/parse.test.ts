import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseContestTop, parseParticipantsCsv, parseSubmissionsPage } from './parse';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

// 출처: kenkoooo/AtCoderProblems 저장소의 테스트 자료(atcoder-client/test_resources/abc107_submissions).
// AtCoder가 실제로 내려 준 제출 목록 화면이다.
describe('parseSubmissionsPage', () => {
  const page = parseSubmissionsPage(fixture('abc107_submissions.html'));

  it('한 쪽에 실린 제출 20건을 모두 읽는다', () => {
    expect(page.submissions).toHaveLength(20);
  });

  it('제출 번호, 시각, 문제, 참가자, 점수, 판정을 읽는다', () => {
    expect(page.submissions[0]).toEqual({
      id: 22755871,
      time: '2021-05-21T02:31:55+09:00',
      taskId: 'arc101_b',
      taskLabel: 'D',
      taskTitle: 'Median of Medians',
      user: 'Chris_wsd',
      score: 700,
      verdict: 'AC',
    });
  });

  it('실행 시간과 메모리 칸이 합쳐진 컴파일 에러 행도 읽는다', () => {
    const ce = page.submissions.find((s) => s.id === 22749563);
    expect(ce).toMatchObject({ verdict: 'CE', score: 0 });
  });

  it('쪽 번호 목록이 있으면 연결된 가장 뒤쪽 번호를 읽는다', () => {
    expect(page.lastLinkedPage).toBe(2208);
  });

  it('채점이 끝나지 않은 제출은 판정을 WJ로 통일한다', () => {
    const html = fixture('abc107_submissions.html')
      .replace('title="Accepted">AC<', 'title="Judging">3/20 TLE<')
      .replace('title="Accepted">AC<', 'title="Waiting for Judging">WJ<');
    const { submissions } = parseSubmissionsPage(html);
    expect(submissions.slice(0, 3).map((s) => s.verdict)).toEqual(['WJ', 'WJ', 'AC']);
  });

  it('제출이 없는 화면에서는 빈 목록을 돌려준다', () => {
    const html = '<html><body><div class="panel panel-default panel-submission"><p>There is no submission.</p></div></body></html>';
    expect(parseSubmissionsPage(html)).toEqual({ submissions: [], lastLinkedPage: 0 });
  });

  it('제출 목록 화면이 아닌 것을 받으면 빈 목록으로 넘기지 않고 오류를 낸다', () => {
    expect(() => parseSubmissionsPage('<html><title>502 Bad Gateway</title><body>error</body></html>')).toThrow(
      /502 Bad Gateway/,
    );
  });
});

// 2026-11-15에 로그인한 세션으로 확인한 지금의 화면. 쪽 번호 대신 앞뒤 링크만 있다.
describe('parseSubmissionsPage: 앞뒤 링크만 있는 화면', () => {
  const withPager = (pager: string) =>
    fixture('abc107_submissions.html').replace(/<ul class="pagination[\s\S]*?<\/ul>/g, pager);
  const link = (label: string, page?: number) =>
    page === undefined
      ? `<li class="disabled"><a>${label}</a></li>`
      : `<li><a href="/contests/abc107/submissions?orderBy=created&amp;page=${page}">${label}</a></li>`;
  const pager = (prev?: number, next?: number) =>
    `<nav><ul class="pager">${link('&lt; Prev', prev)}${link('Next &gt;', next)}</ul></nav>`;

  it('첫 쪽에서는 다음 쪽 번호를 읽는다', () => {
    const page = parseSubmissionsPage(withPager(pager(undefined, 2)));
    expect(page.submissions).toHaveLength(20);
    expect(page.lastLinkedPage).toBe(2);
  });

  it('가운데 쪽에서는 다음 쪽 번호를 읽는다', () => {
    expect(parseSubmissionsPage(withPager(pager(6, 8))).lastLinkedPage).toBe(8);
  });

  it('마지막 쪽에서는 지금 쪽보다 큰 번호가 나오지 않는다', () => {
    expect(parseSubmissionsPage(withPager(pager(6, undefined))).lastLinkedPage).toBe(6);
  });
});

describe('parseSubmissionsPage: 읽지 못한 행', () => {
  const broken = (from: string, to: string) => fixture('abc107_submissions.html').replace(from, to);

  it.each([
    ['제출 번호', 'data-id="22755871"', 'data-id=""'],
    ['제출 시각', "2021-05-21 02:31:55+0900", '방금 전'],
    ['참가자', 'href="/users/Chris_wsd"', 'href="/somewhere"'],
    ['판정', 'title="Accepted">AC<', 'title="">  <'],
  ])('%s을(를) 읽지 못하면 그 행을 버리지 않고 오류를 낸다', (what, from, to) => {
    expect(() => parseSubmissionsPage(broken(from, to))).toThrow(new RegExp(what));
  });
});

// 출처: https://atcoder.jp/contests/scpc2026-div1?lang=en (로그인 없이 열리는 대회 첫 화면)
describe('parseContestTop', () => {
  it('대회 이름, 시작과 종료 시각, 페널티를 읽는다', () => {
    expect(parseContestTop(fixture('scpc2026_top.html'))).toEqual({
      title: 'SCPC 2026 Div.1',
      startTime: '2026-05-16T13:00:00+09:00',
      endTime: '2026-05-16T17:30:00+09:00',
      penaltySeconds: 1200,
    });
  });

  it('시각을 찾지 못하면 어떤 화면인지 알 수 있게 오류를 낸다', () => {
    expect(() => parseContestTop('<html><title>Sign In - AtCoder</title></html>')).toThrow(/Sign In - AtCoder/);
  });
});

describe('parseParticipantsCsv', () => {
  it('머리글 이름으로 열을 찾아 읽는다', () => {
    const csv = 'name,handle,group,affiliation\n홍길동,gildong,새내기,컴퓨터과학과\n';
    expect(parseParticipantsCsv(csv)).toEqual([
      { handle: 'gildong', name: '홍길동', group: '새내기', affiliation: '컴퓨터과학과' },
    ]);
  });

  it('따옴표로 감싼 쉼표, 빈 칸, 빈 줄, BOM, CRLF를 처리한다', () => {
    const csv = '﻿handle,name,affiliation,group\r\nabc,"김, 철수",,\r\n\r\ndef,이영희,"공과대학 ""기계""",\r\n';
    expect(parseParticipantsCsv(csv)).toEqual([
      { handle: 'abc', name: '김, 철수' },
      { handle: 'def', name: '이영희', affiliation: '공과대학 "기계"' },
    ]);
  });

  it('handle 열이 없으면 오류를 낸다', () => {
    expect(() => parseParticipantsCsv('name\n홍길동\n')).toThrow(/handle/);
  });
});
