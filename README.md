# AtCoder Resolver

AtCoder에서 연 대회의 프리즈된 순위표를 시상식에서 한 칸씩 공개하는 도구다. 맨 아래 순위부터 가려진 제출의 결과를 하나씩 열고, 정답이 나오면 그 참가자의 줄이 제자리로 올라간다. 백준 스팟보드나 ICPC Resolver와 같은 방식이다.

AtCoder에는 순위표를 프리즈하는 기능은 있지만 이런 식으로 공개하는 화면은 없어서 따로 만들었다. YCPC 2026(2026-11-27)에서 쓰려고 만들었고, 설정 파일만 바꾸면 다른 대회에도 쓸 수 있다.

## 먼저 화면부터 보기

```sh
pnpm install
pnpm dev
```

브라우저에서 `샘플 데이터로 미리 보기`를 누르면 가상의 대회로 전체 흐름을 볼 수 있다. `→` 키로 한 단계씩 넘긴다.

## 대회 당일 순서

1. 설정 파일을 만든다. `data/sample.config.json`을 `data/ycpc2026.config.json`으로 복사해 고친다.
2. AtCoder에 로그인한 브라우저의 개발자 도구에서 `REVEL_SESSION` 쿠키 값을 복사한다. 대회 중이거나 순위표가 프리즈된 동안에는 운영진 계정이어야 전체 제출이 보인다.
3. 자료를 받는다.

   ```sh
   ATCODER_SESSION='<REVEL_SESSION 값>' pnpm collect data/ycpc2026.config.json
   ```

   받은 원본은 `raw/ycpc2026/`에, 변환한 자료는 `data/ycpc2026.json`에 저장된다. 꽉 찬 제출 목록 쪽은 다시 받지 않으므로, 대회 중에 한두 번 미리 돌려 두면 종료 직후에는 새로 생긴 쪽만 받는다.
4. 명령이 끝나면서 출력하는 내용을 확인한다. `공식 순위표 대조` 줄이 "모두 일치"여야 한다. 다르면 누가 어떻게 다른지, 규칙 설정을 바꾸면 맞는지까지 알려 준다.
5. 시상식용 파일 한 장으로 묶는다.

   ```sh
   pnpm bundle data/ycpc2026.json
   ```

   `dist/ycpc2026.html`이 생긴다. 자료와 화면이 모두 들어 있어서 인터넷 없이 이 파일만 열면 된다.

명단이나 상 구성만 고쳤다면 AtCoder에 다시 접속할 필요가 없다. `pnpm collect data/ycpc2026.config.json --offline`으로 받아 둔 원본에서 다시 변환한다.

## 설정 파일

| 항목 | 뜻 |
| --- | --- |
| `contestId` | AtCoder 대회 주소에 쓰이는 이름. `https://atcoder.jp/contests/{contestId}` |
| `title` | 화면에 띄울 대회 이름. 없으면 AtCoder에 적힌 이름을 쓴다 |
| `rule` | 동점일 때 비교하는 시간을 구하는 방식. 아래 "순위 계산" 참고. 기본값 `last` |
| `penaltyMinutes` | 오답 한 번에 더하는 분. 없으면 AtCoder 대회 화면에 적힌 값을 쓴다 |
| `freezeMinutesBeforeEnd` | 대회 종료 몇 분 전부터의 제출을 가릴지 |
| `participants` | 참가자 명단 CSV 경로. 설정 파일이 있는 폴더 기준 |
| `onlyListed` | `true`면 명단에 있는 사람만 순위표에 싣는다 |
| `exclude` | 순위표에서 뺄 AtCoder 아이디. 운영진 계정 등 |
| `includeNoSubmission` | `true`면 제출이 한 번도 없는 사람도 싣는다 |
| `awards` | 상 구성. 위에서부터 차례로 적용한다 |

상은 두 가지로 적는다. `{ "name": "2등상", "rank": [2, 3] }`은 2위부터 3위까지에게 준다. `{ "name": "새내기 특별상", "group": "새내기", "count": 2, "excludeAwarded": true }`는 명단의 `group`이 새내기인 사람 가운데 다른 상을 받지 않은 위에서부터 2명에게 준다. 동점자는 같은 상을 받고, 점수가 없는 사람은 상을 받지 않는다.

참가자 명단은 첫 줄이 머리글인 CSV다. `handle` 열은 꼭 있어야 하고 `name`, `affiliation`, `group`은 있으면 쓴다. 아이디의 대소문자는 구분하지 않는다. 명단에 없는 사람이 제출했거나 명단에 있는데 제출이 없으면 `collect`가 알려 주므로 아이디 오타를 여기서 잡을 수 있다.

```csv
handle,name,affiliation,group
example_handle1,홍길동,컴퓨터과학과,
example_handle2,김연세,인공지능학과,새내기
```

## 조작법

| 키 | 동작 |
| --- | --- |
| `→` `Space` `Enter` `PageDown`, 클릭 | 다음 단계 |
| `←` `Backspace` `PageUp` | 이전 단계 |
| `A` | 자동 진행을 켜고 끈다. 시상 화면에서는 멈추고 기다린다 |
| `F` | 전체 화면 |
| `+` `-` | 한 화면에 보이는 줄 수 조절 |
| `Home` `End` | 처음으로, 최종 순위로 |
| `R` | 지난번에 멈춘 곳에서 이어 보기 |
| `?` | 조작법과 칸 읽는 법 |

발표용 리모컨은 보통 `PageDown`과 `PageUp`을 보내므로 그대로 쓸 수 있다. 실수로 새로 고침을 해도 진행 위치가 브라우저에 남아 있어서 `R` 키로 돌아온다. 결과가 미리 보이지 않도록 자동으로 이어 보지는 않는다.

## 순위 계산

총점이 높은 쪽이 앞서고, 총점이 같으면 시간이 짧은 쪽이 앞선다. 시간을 구하는 방식은 AtCoder 대회 설정에 따라 둘 중 하나다.

- `last`: AtCoder 기본 방식. 점수를 마지막으로 올린 제출 시각에 오답 페널티를 더한다.
- `sum`: ICPC식. 문제별 정답 시각을 모두 더한 값에 오답 페널티를 더한다. 대회 안내문에 "sum of times of AC"라고 적혀 있으면 이쪽이다.

오답은 점수를 얻은 문제에서 그 점수를 받기 전까지 낸 것만 센다. 컴파일 에러는 세지 않는다.

`sum` 방식은 AtCoder에서 열린 [SCPC 2026 Div.1](https://atcoder.jp/contests/scpc2026-div1) 안내문에 실린 공식 순위표로 맞춰 봤다. 1위의 문제별 정답 시각과 오답 수를 넣으면 공식 값인 700점, 오답 41번, 2016:16이 그대로 나온다. 이 확인은 `src/core/scoring.test.ts`에 테스트로 들어 있다.

## 아직 실제로 확인하지 못한 것

- 로그인이 필요한 화면을 받아 오는 부분은 실제 계정으로 돌려 보지 못했다. 제출 목록과 대회 첫 화면을 읽는 코드는 AtCoder가 실제로 내려 준 HTML로 테스트했고, 순위표 JSON은 공개된 다른 도구들의 타입 정의를 따랐다. 대회 전에 연습용 대회나 지난 대회로 `pnpm collect`를 한 번 돌려 봐야 한다.
- 제출 목록을 시각 오름차순(`orderBy=created`)으로 받는다고 가정했다. 실제로 최신순으로 오더라도 모든 쪽을 받고 제출 번호로 중복을 걸러 내므로 결과는 같지만, 받아 둔 쪽을 다시 쓰지 못해 매번 전부 받는다.
- 대회가 끝난 뒤 AtCoder 순위표의 프리즈가 언제 풀리는지는 AtCoder 쪽 설정이다. 시상식 전에 풀리면 참가자가 휴대폰으로 결과를 먼저 볼 수 있으니 운영진에게 확인해 둔다.

## 구조

```
src/core/      순위 계산(scoring), 공개 순서 계산(resolver), 자료 검증(load)
src/ui/        화면
tools/         collect(받기와 변환), bundle(HTML 한 장으로 묶기), sample(샘플 자료 만들기)
tools/atcoder/ AtCoder 화면 읽기(parse)와 변환(convert)
data/          샘플 자료와 설정 예시. 실제 대회 자료는 저장소에 올리지 않는다
```

공개 순서는 화면을 띄울 때 처음부터 끝까지 한 번에 계산해 둔다(`buildTimeline`). 화면은 그 결과를 한 장씩 넘겨 보여 주기만 하므로 뒤로 가기가 단순하고, 계산은 화면 없이 테스트한다.

```sh
pnpm test        # 단위 테스트
pnpm typecheck   # 타입 검사
pnpm build       # dist/index.html (자료를 직접 골라 여는 화면)
```
