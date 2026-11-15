import * as cheerio from 'cheerio';

export interface RawSubmission {
  id: number;
  /** ISO 8601. */
  time: string;
  /** 문제 주소에 쓰이는 이름. 예: arc101_b */
  taskId: string;
  /** 순위표 열 제목. 예: D */
  taskLabel: string;
  taskTitle: string;
  /** 참가자 주소에 쓰이는 AtCoder 아이디. */
  user: string;
  score: number;
  /** AC, WA, CE … 채점이 끝나지 않았으면 WJ. */
  verdict: string;
}

export interface SubmissionsPage {
  submissions: RawSubmission[];
  lastPage: number;
}

export interface ContestTop {
  title: string;
  startTime: string;
  endTime: string;
  /** 첫 화면에 페널티가 적혀 있지 않으면 null. */
  penaltySeconds: number | null;
}

export interface Participant {
  handle: string;
  name?: string;
  affiliation?: string;
  group?: string;
}

/** '2021-05-21 02:31:55+0900'을 '2021-05-21T02:31:55+09:00'으로 바꾼다. */
const toIso = (text: string) =>
  text
    .trim()
    .replace(' ', 'T')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');

/** 채점 중에는 'WJ', 'Judging', '3/20', '3/20 TLE'처럼 보인다. */
const normalizeVerdict = (label: string) => (/^(WJ|WR|Judging)$/i.test(label) || /^\d+\s*\/\s*\d+/.test(label) ? 'WJ' : label);

/**
 * 제출 목록 화면(/contests/{id}/submissions) 한 쪽을 읽는다.
 * 화면 언어나 열 순서가 달라도 읽히도록 열 위치가 아니라 칸 안의 링크와 클래스로 값을 찾는다.
 */
export function parseSubmissionsPage(html: string): SubmissionsPage {
  const $ = cheerio.load(html);
  const submissions: RawSubmission[] = [];

  $('td.submission-score').each((_, el) => {
    const scoreCell = $(el);
    const row = scoreCell.closest('tr');
    const taskLink = row.find('a[href*="/tasks/"]').first();
    const userHref = row.find('a[href^="/users/"]').first().attr('href') ?? '';
    const [taskLabel, ...titleParts] = taskLink.text().trim().split(' - ');

    submissions.push({
      id: Number(scoreCell.attr('data-id')),
      time: toIso(row.find('time').first().text()),
      taskId: (taskLink.attr('href') ?? '').split('/tasks/')[1] ?? '',
      taskLabel,
      taskTitle: titleParts.join(' - '),
      user: decodeURIComponent(userHref.replace('/users/', '')),
      score: Number(scoreCell.text().trim()),
      verdict: normalizeVerdict(row.find('span.label').first().text().trim()),
    });
  });

  const pageNumbers = $('ul.pagination a')
    .map((_, a) => Number($(a).text().trim()))
    .get()
    .filter((n) => Number.isInteger(n));
  return { submissions, lastPage: Math.max(1, ...pageNumbers) };
}

/** 대회 첫 화면(/contests/{id})에서 이름과 시각, 페널티를 읽는다. 로그인 없이 열리는 화면이다. */
export function parseContestTop(html: string): ContestTop {
  const $ = cheerio.load(html);
  const pageTitle = $('title').text().trim();
  const startTime = html.match(/startTime\s*=\s*moment\("([^"]+)"\)/)?.[1];
  const endTime = html.match(/endTime\s*=\s*moment\("([^"]+)"\)/)?.[1];
  if (!startTime || !endTime) {
    throw new Error(`대회 시작과 종료 시각을 찾지 못했습니다. 받은 화면의 제목: "${pageTitle}"`);
  }

  const text = $('body').text();
  const penalty = text.match(/Penalty:\s*(\d+)\s*minute/i) ?? text.match(/ペナルティ:\s*(\d+)\s*分/);
  return {
    title: $('a.contest-title').first().text().trim() || pageTitle.replace(/\s*-\s*AtCoder$/, ''),
    startTime,
    endTime,
    penaltySeconds: penalty ? Number(penalty[1]) * 60 : null,
  };
}

/** 따옴표 안의 쉼표와 줄바꿈, ""로 쓴 따옴표를 처리하는 CSV 읽기. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/**
 * 참가자 명단 CSV를 읽는다. 첫 줄은 머리글이고 handle 열은 반드시 있어야 한다.
 * name, affiliation, group 열은 있으면 쓴다. 열 순서는 상관없다.
 */
export function parseParticipantsCsv(text: string): Participant[] {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  const columns = (header ?? []).map((h) => h.trim().toLowerCase());
  const handleAt = columns.indexOf('handle');
  if (handleAt < 0) throw new Error('참가자 명단 CSV의 첫 줄에 handle 열이 없습니다.');

  return rows
    .map((row) => {
      const participant: Participant = { handle: (row[handleAt] ?? '').trim() };
      for (const key of ['name', 'affiliation', 'group'] as const) {
        const value = (row[columns.indexOf(key)] ?? '').trim();
        if (value) participant[key] = value;
      }
      return participant;
    })
    .filter((p) => p.handle !== '');
}
