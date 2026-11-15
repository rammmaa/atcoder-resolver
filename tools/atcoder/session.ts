/**
 * ATCODER_SESSION 값을 Cookie 헤더로 바꾼다.
 * REVEL_SESSION 쿠키 값만 넣어도 되고, 브라우저에서 복사한 Cookie 헤더를 통째로 넣어도 된다.
 * 로그인 정보이므로 오류 문구에는 값을 넣지 않는다.
 */
export function toCookieHeader(value: string | undefined): string | undefined {
  const session = value
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, '$2')
    .trim();
  if (!session) return undefined;
  if (/[\r\n\0]/.test(session)) {
    throw new Error('ATCODER_SESSION 값에 줄바꿈이 섞여 있습니다. 쿠키 값 한 줄만 넣어 주세요.');
  }
  return session.includes('REVEL_SESSION=') ? session : `REVEL_SESSION=${session}`;
}
