import { describe, expect, it } from 'vitest';
import { toCookieHeader } from './session';

describe('toCookieHeader', () => {
  it('쿠키 값만 받으면 REVEL_SESSION 쿠키로 만든다', () => {
    expect(toCookieHeader('abc%00def')).toBe('REVEL_SESSION=abc%00def');
  });

  it('브라우저에서 복사한 Cookie 헤더를 통째로 받으면 그대로 쓴다', () => {
    expect(toCookieHeader('language=en; REVEL_SESSION=abc; other=1')).toBe('language=en; REVEL_SESSION=abc; other=1');
  });

  it('앞뒤 공백과 줄바꿈, 감싼 따옴표를 떼어 낸다', () => {
    expect(toCookieHeader("  'abc%00def'\n")).toBe('REVEL_SESSION=abc%00def');
    expect(toCookieHeader('"abc"')).toBe('REVEL_SESSION=abc');
  });

  it('값이 없으면 쿠키를 보내지 않는다', () => {
    expect(toCookieHeader(undefined)).toBeUndefined();
    expect(toCookieHeader('   ')).toBeUndefined();
  });

  it('헤더에 넣을 수 없는 문자가 섞여 있으면 값을 드러내지 않고 오류를 낸다', () => {
    expect(() => toCookieHeader('abc\ndef')).toThrow(/ATCODER_SESSION/);
    expect(() => toCookieHeader('abc\ndef')).not.toThrow(/abc/);
  });
});
