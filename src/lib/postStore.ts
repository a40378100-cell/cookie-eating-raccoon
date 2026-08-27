'use client';
// 게시판·방명록 타입 + 공용 목록 저장소 훅
// v2.0: 서버(Supabase) 연결이 있으면 DB, 없으면 localStorage — 화면 코드는 동일하다.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PostMode } from './sanitize';
import { isServerMode } from './supabase';
import { TABLE_OF, fetchList, syncList, subscribeTable } from './db';
import { currentUserId } from './currentUser';

/** 목록 저장 실패 알림 */
export const LIST_ERR_EVT = 'ohome-list-error';

export interface Comment {
  id: string;
  author: string;
  authorId: string;
  text: string;
  date: string;
  parentId?: string;
  guestPw?: string;
}

export const COMMENT_KEY = 'ohome.comments.v1';

export interface CommentRow extends Comment {
  targetId: string;
  target: 'post' | 'road';
}

export const COMMENT_SEED: CommentRow[] = [];

export function commentsFor(
  rows: CommentRow[],
  target: 'post' | 'road',
  targetId: string,
  legacy: Comment[] = [],
): Comment[] {
  const mine = rows.filter(
    r => r.target === target && r.targetId === targetId,
  );

  const seen = new Set(mine.map(r => r.id));

  return [
    ...legacy.filter(c => !seen.has(c.id)),
    ...mine,
  ].sort((a, b) => a.date.localeCompare(b.date));
}

export type FoldType = 'spoiler' | 'adult' | 'custom';

/**
 * 게시판 첨부파일.
 *
 * ref:
 * - 서버 모드: Supabase Storage 공개 URL
 * - 로컬 모드: IndexedDB 파일 id
 */
export interface PostAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  ref: string;
}

export interface Post {
  id: string;
  title: string;
  body: string;
  mode: PostMode;

  /** 에디터로 작성했는지 기억 */
  authored?: 'editor';

  category: string;
  author: string;
  authorId: string;
  date: string;

  secret: boolean;
  notice: boolean;

  fold: {
    type: FoldType;
    label?: string;
  } | null;

  comments: Comment[];

  /** 소속 게시판 */
  boardId?: string;

  /** 티켓 스킨 대표 이미지 */
  thumbSrc?: string;

  /** 대표 썸네일 크롭 */
  thumbCrop?: {
    x: number;
    y: number;
    scale: number;
  };

  /**
   * 게시글 첨부파일.
   *
   * 기존 글에는 없을 수 있으므로 optional.
   * 서버/로컬 양쪽에서 문자열 ref만 저장한다.
   */
  attachments?: PostAttachment[];
}

export interface GuestEntry {
  id: string;
  author: string;
  authorId?: string;
  guestPw?: string;
  body: string;
  secret: boolean;
  date: string;
  reply?: {
    author: string;
    text: string;
    date: string;
  } | null;
}

export const BOARD_CATEGORIES = ['잡담', '설정', '합작', '기타'];

export const newId = () =>
  Date.now().toString(36) +
  Math.random().toString(36).slice(2, 6);

/**
 * 목록 저장소 훅.
 *
 * 서버 모드:
 *   DB 목록을 가져오고 변경된 행만 syncList로 저장.
 *
 * 로컬 모드:
 *   localStorage 사용.
 */
export function useLocalList<T extends { id?: string }>(
  key: string,
  seed: T[],
): [T[], (next: T[]) => void, boolean] {
  const server = isServerMode() && !!TABLE_OF[key];
  const table = TABLE_OF[key];

  const [list, setList] = useState<T[]>(() =>
    server ? [] : seed,
  );

  const [loaded, setLoaded] = useState(false);

  const latest = useRef<T[]>(list);
  latest.current = list;

  const reqId = useRef(0);

  useEffect(() => {
    let alive = true;

    if (server) {
      const load = () => {
        const id = ++reqId.current;

        fetchList<T & { id: string }>(table)
          .then(rows => {
            if (!alive || id !== reqId.current) return;

            setList(rows);
            latest.current = rows;
            setLoaded(true);
          })
          .catch(() => {
            if (alive) setLoaded(true);
          });
      };

      load();

      const off = subscribeTable(table, load);

      return () => {
        alive = false;
        off();
      };
    }

    try {
      const raw = localStorage.getItem(key);

      if (raw) {
        setList(JSON.parse(raw));
      }
    } catch {
      // 시드 유지
    }

    setLoaded(true);

    const onStorage = (e: StorageEvent) => {
      if (e.key !== key || e.newValue == null) return;

      try {
        setList(JSON.parse(e.newValue));
      } catch {
        // 무시
      }
    };

    window.addEventListener('storage', onStorage);

    return () => {
      alive = false;
      window.removeEventListener('storage', onStorage);
    };
  }, [key, server, table]);

  const update = useCallback(
    (next: T[]) => {
      const prev = latest.current;

      const id = ++reqId.current;

      setList(next);
      latest.current = next;

      if (server) {
        syncList(
          table,
          prev as unknown as { id: string }[],
          next as unknown as { id: string }[],
          currentUserId(),
        ).catch(err => {
          console.error('[ohome] 저장 실패', err);

          try {
            window.dispatchEvent(
              new CustomEvent(LIST_ERR_EVT, {
                detail: {
                  table,
                  message:
                    err instanceof Error
                      ? err.message
                      : String(err),
                },
              }),
            );
          } catch {
            // 무시
          }

          reqId.current = id;

          fetchList<T & { id: string }>(table)
            .then(rows => {
              if (id !== reqId.current) return;

              setList(rows);
              latest.current = rows;
            })
            .catch(() => {
              // 무시
            });
        });

        return;
      }

      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // 무시
      }
    },
    [key, server, table],
  );

  return [list, update, loaded];
}

/* ---------- 시드 ---------- */

export const BOARD_SEED: Post[] = [];

export const GUEST_SEED: GuestEntry[] = [];

export const fmtDate = (iso: string) => {
  const d = new Date(iso);

  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(
    d.getDate(),
  ).padStart(2, '0')}`;
};
