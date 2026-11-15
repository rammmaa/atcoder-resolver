/**
 * 대회 자료를 화면과 함께 HTML 한 장으로 묶는다. 인터넷이 없어도 이 파일만 열면 된다.
 *
 *   pnpm bundle data/ycpc2026.json     → dist/ycpc2026.html
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { injectData, parseContestData } from '../src/core/load';

const dataPath = process.argv[2];
if (!dataPath) {
  console.error('사용법: pnpm bundle <대회 자료.json>');
  process.exit(2);
}

try {
  const data = parseContestData(readFileSync(dataPath, 'utf8'));
  execFileSync('pnpm', ['exec', 'vite', 'build', '--logLevel', 'warn'], { stdio: 'inherit' });

  const out = join('dist', `${basename(dataPath).replace(/\.json$/, '')}.html`);
  if (out === join('dist', 'index.html')) throw new Error('자료 파일 이름이 index.json이면 빌드 결과를 덮어씁니다. 이름을 바꿔 주세요.');
  writeFileSync(out, injectData(readFileSync(join('dist', 'index.html'), 'utf8'), data));
  console.log(`${data.contest.title}: 참가자 ${data.teams.length}명, 제출 ${data.submissions.length}건`);
  console.log(`저장: ${out}`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
