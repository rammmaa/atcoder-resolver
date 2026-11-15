import { describe, expect, it } from 'vitest';
import { formatClock, injectData, parseContestData, readEmbeddedData } from './load';
import type { ContestData } from './types';

const valid = (): ContestData => ({
  contest: { id: 'c', title: '대회', durationSeconds: 10800, freezeSeconds: 9000, rule: 'sum', penaltySeconds: 1200 },
  problems: [{ id: 'a', label: 'A' }],
  teams: [{ id: 'kim', name: '김' }],
  submissions: [{ id: 1, teamId: 'kim', problemId: 'a', time: 60, verdict: 'AC', score: 100 }],
});

describe('formatClock', () => {
  it('초를 AtCoder 순위표처럼 분:초로 적는다', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(59)).toBe('0:59');
    expect(formatClock(36 * 60 + 21)).toBe('36:21');
    expect(formatClock(2016 * 60 + 16)).toBe('2016:16');
  });
});

describe('parseContestData', () => {
  it('형식이 맞으면 그대로 돌려준다', () => {
    expect(parseContestData(JSON.stringify(valid()))).toEqual(valid());
  });

  it('JSON이 아니면 그렇다고 알린다', () => {
    expect(() => parseContestData('<html>')).toThrow(/JSON/);
  });

  it.each([
    ['contest가 없을 때', (d: any) => delete d.contest, /contest/],
    ['규칙 이름이 틀렸을 때', (d: any) => (d.contest.rule = 'icpc'), /rule/],
    ['프리즈 시각이 숫자가 아닐 때', (d: any) => (d.contest.freezeSeconds = '9000'), /freezeSeconds/],
    ['문제 목록이 비었을 때', (d: any) => (d.problems = []), /problems/],
    ['참가자에 이름이 없을 때', (d: any) => delete d.teams[0].name, /teams\[0\]\.name/],
    ['제출 시각이 없을 때', (d: any) => delete d.submissions[0].time, /submissions\[0\]\.time/],
    ['참가자 아이디가 겹칠 때', (d: any) => d.teams.push({ id: 'kim', name: '김2' }), /kim/],
    ['상의 순위 구간이 배열이 아닐 때', (d: any) => (d.awards = [{ name: '1등상', rank: 1 }]), /awards\[0\]\.rank/],
    ['상의 순위 구간이 거꾸로일 때', (d: any) => (d.awards = [{ name: '상', rank: [3, 1] }]), /awards\[0\]\.rank/],
    ['상에 순위 구간도 그룹도 없을 때', (d: any) => (d.awards = [{ name: '상', ranks: [1, 3] }]), /awards\[0\]/],
    ['그룹 상의 인원이 숫자가 아닐 때', (d: any) => (d.awards = [{ name: '상', group: '새내기', count: '2' }]), /awards\[0\]\.count/],
  ])('%s 어느 항목이 문제인지 알린다', (_, breakIt, message) => {
    const data = valid();
    breakIt(data);
    expect(() => parseContestData(JSON.stringify(data))).toThrow(message);
  });
});

describe('parseContestData: 상 구성', () => {
  it('순위 구간 상과 그룹 상을 받아들인다', () => {
    const data = valid();
    data.awards = [
      { name: '1등상', rank: [1, 1] },
      { name: '새내기 특별상', group: '새내기', count: 2, excludeAwarded: true },
    ];
    expect(parseContestData(JSON.stringify(data)).awards).toEqual(data.awards);
  });
});

describe('injectData', () => {
  const page = '<html><body><script type="application/json" id="resolver-data"></script><div id="root"></div></body></html>';

  it('HTML에 심은 자료를 다시 꺼내면 원래 자료와 같다', () => {
    const data = valid();
    data.teams[0].name = '</script><script>alert(1)</script> & <!-- 김';
    const html = injectData(page, data);
    expect(html).not.toContain('</script><script>alert(1)');
    expect(readEmbeddedData(html)).toEqual(data);
  });

  it('자료를 심을 자리가 없으면 오류를 낸다', () => {
    expect(() => injectData('<html></html>', valid())).toThrow(/resolver-data/);
  });

  it('자료를 심지 않은 HTML에서는 null을 돌려준다', () => {
    expect(readEmbeddedData(page)).toBeNull();
  });
});
