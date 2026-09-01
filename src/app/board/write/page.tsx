'use client';

// 게시판 글쓰기/수정
// MD/HTML 모드 + 에디터 + 이미지 + 파일 첨부 + 접기/비밀글/공지

import React, {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  useRouter,
  useSearchParams,
} from 'next/navigation';

import { useAuth } from '@/lib/auth';

import {
  useLocalList,
  BOARD_SEED,
  Post,
  PostAttachment,
  newId,
  FoldType,
} from '@/lib/postStore';

import {
  useBoards,
  boardHref,
  MAIN_BOARD_ID,
} from '@/lib/boardStore';

import { renderBody } from '@/lib/sanitize';
import {
  KInput,
  KTextarea,
  KSelect,
  KCheck,
} from '@/components/ui/Kit';
import {
  CropEditor,
  CropImg,
  CropValue,
} from '@/components/ui/CropEditor';
import { ConfirmModal } from '@/components/ui/Modal';
import { RichEditor } from '@/components/ui/RichEditor';

import { useToast } from '@/components/ui/Toast';

import {
  PageTitle,
  EditableDesc,
} from '@/components/ui/PageText';

import { putBlob } from '@/lib/blobStore';

function formatSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** 에디터가 다루지 못해 정리될 만한 태그·속성이 있는가 — 전환 경고 판단 (인트로와 같은 기준) */
const hasRichHtml = (html: string) =>
  /<(table|thead|tbody|tr|td|th|div|span|section|article|video|audio|details|summary|font|center)\b/i.test(html)
  || /\s(style|class|id)\s*=/i.test(html);

function WriteInner() {
  const router = useRouter();

  const { user, isAdmin } = useAuth();

  const toast = useToast();

  const params = useSearchParams();

  const editPid = params.get('edit');

  const [
    posts,
    setPosts,
    postsLoaded,
  ] = useLocalList<Post>(
    'ohome.board.v1',
    BOARD_SEED,
  );

  const editing = editPid
    ? posts.find(p => p.id === editPid)
    : undefined;

  const bid =
    editing?.boardId ??
    params.get('b') ??
    MAIN_BOARD_ID;

  const { boards } = useBoards();

  const board =
    boards.find(b => b.id === bid) ??
    boards[0];

  const [title, setTitle] = useState('');

  const [writeMode, setWriteMode] =
    useState<'editor' | 'md' | 'html'>('editor');

  const [body, setBody] = useState('');
  // HTML 모드 안의 보기 (v2.0 사용자 요청) — 코드 그대로 / 미리보기에서 바로 편집
  const [htmlView, setHtmlView] = useState<'code' | 'preview'>('code');
  const [askRich, setAskRich] = useState<null | (() => void)>(null);   // 정리 경고 후 실행할 전환
  const [category, setCategory] = useState('');

  React.useEffect(() => {
    if (!category && board.cats[0]) {
      setCategory(board.cats[0].label);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.cats.length]);

  const [secret, setSecret] = useState(false);

  const [notice, setNotice] = useState(false);

  // 태그 (v2.0 사용자 요청) — 쉼표로 구분해 입력, 저장할 때 배열로
  const [tagsText, setTagsText] = useState('');
  const parseTags = (s: string) =>
    [...new Set(s.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean))];

  const [foldType, setFoldType] = useState<FoldType | 'none'>('none');
  const [foldLabel, setFoldLabel] = useState('');

  /* ---------- 티켓 썸네일 ---------- */
  const [thumbSrc, setThumbSrc] = useState<string | undefined>(undefined);
  const [thumbCrop, setThumbCrop] = useState<CropValue | undefined>(undefined);
  const [cropOpen, setCropOpen] = useState(false);

  /* ---------- 본문 이미지 ---------- */
  const bodyImages = useMemo(() => {
    const out: string[] = [];

    for (const m of body.matchAll(
      /<img[^>]*src=["']([^"']+)["']/gi,
    )) {
      out.push(m[1]);
    }

    for (const m of body.matchAll(
      /!\[[^\]]*\]\(([^)\s]+)/g,
    )) {
      out.push(m[1]);
    }

    return [...new Set(out)];
  }, [body]);

  useEffect(() => {
    if (thumbSrc && !bodyImages.includes(thumbSrc)) {
      setThumbSrc(undefined);
      setThumbCrop(undefined);
    }
  }, [bodyImages, thumbSrc]);

  /* ---------- 파일 첨부 ---------- */
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [attachments, setAttachments] = useState<PostAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ---------- 수정 모드 ---------- */
  const hydrated = useRef(false);

  useEffect(() => {
    if (!editPid || !postsLoaded || hydrated.current) {
      return;
    }

    const p = posts.find(x => x.id === editPid);

    if (!p) return;

    hydrated.current = true;

    setTitle(p.title);
    setBody(p.body);
    setWriteMode(
      p.mode === 'md'
        ? 'md'
        : p.authored === 'editor'
          ? 'editor'
          : 'html',
    );
    setCategory(p.category);
    setSecret(p.secret);
    setNotice(p.notice);
    setFoldType(p.fold?.type ?? 'none');
    setFoldLabel(p.fold?.label ?? '');
    setTagsText((p.tags ?? []).join(', '));
    setThumbSrc(p.thumbSrc);
    setThumbCrop(p.thumbCrop);
    setAttachments(p.attachments ?? []);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editPid, postsLoaded, posts]);

  const preview = useMemo(
    () =>
      renderBody(
        writeMode === 'md'
          ? 'md'
          : 'html',
        body,
      ),
    [writeMode, body],
  );

  /* ---------- 파일 선택 ---------- */

  const chooseFiles = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(
      e.target.files ?? [],
    );

    if (files.length > 0) {
      setNewFiles(prev => [
        ...prev,
        ...files,
      ]);
    }

    e.target.value = '';
  };

  const removeNewFile = (index: number) => {
    setNewFiles(prev =>
      prev.filter(
        (_, i) => i !== index,
      ),
    );
  };

  const removeAttachment = (
    id: string,
  ) => {
    setAttachments(prev =>
      prev.filter(
        a => a.id !== id,
      ),
    );
  };

  /* ---------- 저장 ---------- */

  const post = async () => {
    if (
      !title.trim() ||
      !body.trim()
    ) {
      toast(
        '제목과 내용을 입력해 주세요',
      );
      return;
    }

    if (editing) {
      if (
        editing.authorId !== user?.id
      ) {
        toast(
          '수정은 작성자 본인만 할 수 있습니다',
        );
        return;
      }
    }

    try {
      setUploading(true);

      /*
       * 새 파일을 blobStore에 저장.
       *
       * 서버 모드:
       *   Supabase Storage → 공개 URL
       *
       * 로컬 모드:
       *   IndexedDB → 파일 id
       */
      const uploaded: PostAttachment[] =
        [];

      for (const file of newFiles) {
        const ref =
          await putBlob(file);

        uploaded.push({
          id: newId(),
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          ref,
        });
      }

      const nextAttachments = [
        ...attachments,
        ...uploaded,
      ];

      if (editing) {
        setPosts(
          posts.map(p =>
            p.id === editing.id
              ? {
                  ...p,
                  title: title.trim(),
                  body,
                  mode:
                    writeMode === 'md'
                      ? 'md'
                      : 'html',
                  authored:
                    writeMode === 'editor'
                      ? 'editor'
                      : undefined,
                  category,
                  secret,
                  notice: isAdmin
                    ? notice
                    : p.notice,
                  fold:
                    foldType === 'none'
                      ? null
                      : {
                          type: foldType,
                          label:
                            foldType === 'custom'
                              ? foldLabel
                              : undefined,
                        },
                  tags: parseTags(tagsText),
                  thumbSrc,
                  thumbCrop,
                  attachments:
                    nextAttachments,
                }
              : p,
          ),
        );

        toast('수정되었습니다');

        router.push(
          `/board/${editing.id}`,
        );

        return;
      }

      const p: Post = {
        id: newId(),

        title: title.trim(),

        body,

        mode:
          writeMode === 'md'
            ? 'md'
            : 'html',

        authored:
          writeMode === 'editor'
            ? 'editor'
            : undefined,

        category,

        author: user!.nickname,

        authorId: user!.id,

        date: new Date().toISOString(),

        secret,

        notice:
          isAdmin && notice,

        fold:
          foldType === 'none'
            ? null
            : {
                type: foldType,
                label:
                  foldType === 'custom'
                    ? foldLabel
                    : undefined,
              },

        comments: [],

        tags: parseTags(tagsText),
        boardId: board.id,
        thumbSrc,
        thumbCrop,
        attachments:
          nextAttachments,
      };

      setPosts([
        p,
        ...posts,
      ]);

      toast('등록되었습니다');

      router.push(
        `/board/${p.id}`,
      );
    } catch (err) {
      console.error(
        '[ohome] 첨부파일 업로드 실패',
        err,
      );

      toast(
        '파일 업로드에 실패했습니다',
      );
    } finally {
      setUploading(false);
    }
  };

  if (!user) {
    return (
      <section className="page">
        <div className="page-head">
          <PageTitle>
            WRITE
          </PageTitle>

          <p>
            글쓰기는 로그인 후 이용할 수 있습니다
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      {/* 큰 글씨 — 추가 게시판이면 그 이름(메뉴 관리 타이틀·이름이 우선), 누르면 그 게시판으로 복귀
          (v2.0 사용자 제보 — 「글쓰기에서 큰제목을 눌러도 안 돌아가고, 제목도 원래 것이 뜬다」) */}
      <div className="page-head">
        <PageTitle href={boardHref(board.id)}>{board.id === MAIN_BOARD_ID ? (editing ? 'EDIT' : 'WRITE') : board.name}</PageTitle>
        <EditableDesc k="board-write-desc" def="에디터 / Markdown / HTML — 스크립트는 저장 시 자동 제거" />
      </div>
      <div className="write-grid">
        {/* ---------- 좌: 본문 ---------- */}

        <div
          className="panel"
          style={{ padding: 24 }}
        >
          <div className="form-row">
            <label
              className="k-label"
              style={{ width: 60 }}
            >
              제목
            </label>

            <KInput
              value={title}
              onChange={e =>
                setTitle(
                  e.target.value,
                )
              }
              style={{ flex: 1 }}
            />
          </div>

          <div className="form-row">
            <label
              className="k-label"
              style={{ width: 60 }}
            >
              모드
            </label>

            <div className="mini-seg">
              {/* HTML로 쓴 글을 에디터로 열면 다루지 못하는 태그가 정리된다 — 되돌릴 수 없어 물어본다 (v2.0) */}
              <button
                className={writeMode === 'editor' ? 'on' : ''}
                onClick={() => {
                  if (writeMode === 'html' && hasRichHtml(body)) {
                    setAskRich(() => () => setWriteMode('editor'));
                    return;
                  }
                  setWriteMode('editor');
                }}
              >
                에디터
              </button>

              <button
                className={writeMode === 'md' ? 'on' : ''}
                onClick={() => {
                  setWriteMode('md');
                  setHtmlView('code');
                }}
              >
                Markdown
              </button>

              <button
                className={writeMode === 'html' ? 'on' : ''}
                onClick={() => setWriteMode('html')}
              >
                HTML
              </button>
            </div>
            {/* HTML 모드 안 보기 전환 (v2.0 사용자 요청) — 코드 그대로 / 미리보기에서 바로 편집 */}
            {writeMode === 'html' && (
              <div className="mini-seg">
                <button className={htmlView === 'code' ? 'on' : ''} onClick={() => setHtmlView('code')}>코드</button>
                <button
                  className={htmlView === 'preview' ? 'on' : ''}
                  onClick={() => {
                    if (htmlView === 'preview') return;
                    if (hasRichHtml(body)) {
                      setAskRich(() => () => setHtmlView('preview'));
                      return;
                    }
                    setHtmlView('preview');
                  }}
                >
                  미리보기 (편집 가능)
                </button>
              </div>
            )}
          </div>

          {writeMode === 'editor' || (writeMode === 'html' && htmlView === 'preview') ? (
            <RichEditor
              value={body}
              onChange={setBody}
              placeholder="내용을 작성하세요 — 이미지 삽입 가능 (스크립트 불허 6.3)"
            />
          ) : (
            <>
              <KTextarea
                style={{
                  minHeight: 220,
                  fontFamily:
                    writeMode === 'html'
                      ? 'ui-monospace, Consolas, monospace'
                      : undefined,
                }}
                placeholder={
                  writeMode === 'md'
                    ? '마크다운으로 작성...'
                    : '<div>HTML 코드를 작성/붙여넣기...</div>'
                }
                value={body}
                onChange={e =>
                  setBody(
                    e.target.value,
                  )
                }
              />

              <div
                className="preview-box"
                style={{
                  marginTop: 14,
                }}
              >
                <div className="pv-label">
                  PREVIEW — 실시간 미리보기
                </div>

                <div
                  className="post-body"
                  dangerouslySetInnerHTML={{
                    __html: preview,
                  }}
                />
              </div>
            </>
          )}

          {/* ---------- 파일 첨부 ---------- */}

          <div
            style={{
              marginTop: 18,
              paddingTop: 16,
              borderTop:
                '1px solid var(--line)',
            }}
          >
            <label
              className="k-label"
              style={{
                display: 'block',
                marginBottom: 8,
              }}
            >
              파일 첨부
            </label>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={chooseFiles}
            />

            <button
              type="button"
              className="btn btn-onbk"
              onClick={() =>
                fileInputRef.current?.click()
              }
              disabled={uploading}
            >
              + 파일 선택
            </button>

            {/* 기존 첨부파일 */}
            {attachments.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gap: 7,
                  marginTop: 10,
                }}
              >
                {attachments.map(file => (
                  <div
                    key={file.id}
                    style={{
                      display: 'flex',
                      alignItems:
                        'center',
                      justifyContent:
                        'space-between',
                      gap: 10,
                      padding:
                        '8px 10px',
                      border:
                        '1px solid var(--line)',
                      borderRadius: 7,
                      fontSize: 12,
                    }}
                  >
                    <div
                      style={{
                        minWidth: 0,
                      }}
                    >
                      <b
                        style={{
                          display:
                            'block',
                          overflow:
                            'hidden',
                          textOverflow:
                            'ellipsis',
                          whiteSpace:
                            'nowrap',
                        }}
                      >
                        {file.name}
                      </b>

                      <small
                        style={{
                          color:
                            'var(--faint)',
                        }}
                      >
                        {formatSize(
                          file.size,
                        )}
                      </small>
                    </div>

                    <button
                      type="button"
                      className="btn btn-onbk"
                      onClick={() =>
                        removeAttachment(
                          file.id,
                        )
                      }
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 아직 업로드하지 않은 파일 */}
            {newFiles.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gap: 7,
                  marginTop: 10,
                }}
              >
                {newFiles.map(
                  (file, index) => (
                    <div
                      key={`${file.name}-${file.size}-${index}`}
                      style={{
                        display: 'flex',
                        alignItems:
                          'center',
                        justifyContent:
                          'space-between',
                        gap: 10,
                        padding:
                          '8px 10px',
                        border:
                          '1px dashed var(--line)',
                        borderRadius: 7,
                        fontSize: 12,
                      }}
                    >
                      <div
                        style={{
                          minWidth: 0,
                        }}
                      >
                        <b
                          style={{
                            display:
                              'block',
                            overflow:
                              'hidden',
                            textOverflow:
                              'ellipsis',
                            whiteSpace:
                              'nowrap',
                          }}
                        >
                          {file.name}
                        </b>

                        <small
                          style={{
                            color:
                              'var(--faint)',
                          }}
                        >
                          {formatSize(
                            file.size,
                          )}{' '}
                          · 업로드 대기
                        </small>
                      </div>

                      <button
                        type="button"
                        className="btn btn-onbk"
                        onClick={() =>
                          removeNewFile(
                            index,
                          )
                        }
                      >
                        취소
                      </button>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>

          {/* ---------- 티켓 대표 이미지 ---------- */}

          {board.skin === 'ticket' &&
            bodyImages.length > 0 && (
              <div
                style={{
                  marginTop: 14,
                }}
              >
                <label
                  className="k-label"
                  style={{
                    marginBottom: 7,
                  }}
                >
                  대표 이미지
                  (티켓 썸네일)
                </label>

                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  {bodyImages.map(
                    src => (
                      <div
                        key={src}
                        data-tip={
                          thumbSrc === src
                            ? '썸네일 위치 조정'
                            : '대표로 선택'
                        }
                        onClick={() => {
                          if (
                            thumbSrc !==
                            src
                          ) {
                            setThumbSrc(
                              src,
                            );
                            setThumbCrop(
                              undefined,
                            );
                          }

                          setCropOpen(
                            true,
                          );
                        }}
                        style={{
                          width: 104,
                          aspectRatio:
                            '16/9',
                          borderRadius: 8,
                          overflow:
                            'hidden',
                          cursor:
                            'var(--cur-pointer,pointer)',
                          position:
                            'relative',
                          flexShrink: 0,
                          outline:
                            thumbSrc ===
                            src
                              ? '2px solid var(--accent)'
                              : '1px solid var(--line)',
                          outlineOffset: 2,
                        }}
                      >
                        <CropImg
                          src={src}
                          crop={
                            thumbSrc ===
                            src
                              ? thumbCrop
                              : undefined
                          }
                        />

                        {thumbSrc ===
                          src && (
                          <span
                            style={{
                              position:
                                'absolute',
                              right: 4,
                              top: 4,
                              fontSize: 9,
                              fontWeight: 700,
                              letterSpacing:
                                '.08em',
                              background:
                                'var(--accent)',
                              color:
                                '#fff',
                              padding:
                                '2px 6px',
                              borderRadius:
                                999,
                            }}
                          >
                            대표
                          </span>
                        )}
                      </div>
                    ),
                  )}
                </div>
              </div>
            )}
        </div>

        {/* ---------- 우: 설정 ---------- */}

        <div>
          <div
            className="panel widget"
            style={{
              marginBottom: 14,
            }}
          >
            <h4>설정</h4>

            <div className="form-row">
              <label
                className="k-label"
                style={{
                  width: 60,
                }}
              >
                말머리
              </label>

              <KSelect
                minWidth={130}
                value={category}
                onChange={setCategory}
                options={board.cats.map(
                  x => ({
                    value: x.label,
                    label: x.label,
                  }),
                )}
                placeholder="말머리 선택"
              />
            </div>

            <div
              style={{
                display: 'grid',
                gap: 9,
              }}
            >
              <KCheck
                label="비밀글 (관리자와 나만 열람)"
                checked={secret}
                onChange={setSecret}
              />

              {isAdmin && (
                <KCheck
                  label="공지로 고정"
                  checked={notice}
                  onChange={setNotice}
                />
              )}
            </div>
          </div>

          <div
            className="panel widget"
            style={{
              marginBottom: 14,
            }}
          >
            <h4>접기 (6.2)</h4>

            <div
              style={{
                display: 'grid',
                gap: 9,
              }}
            >
              <KCheck
                label="스포일러 접기"
                checked={
                  foldType === 'spoiler'
                }
                onChange={v =>
                  setFoldType(
                    v
                      ? 'spoiler'
                      : 'none',
                  )
                }
              />

              <KCheck
                label="수위 주의 접기"
                checked={
                  foldType === 'adult'
                }
                onChange={v =>
                  setFoldType(
                    v
                      ? 'adult'
                      : 'none',
                  )
                }
              />

              <KCheck
                label="직접 입력 문구"
                checked={
                  foldType === 'custom'
                }
                onChange={v =>
                  setFoldType(
                    v
                      ? 'custom'
                      : 'none',
                  )
                }
              />

              {foldType ===
                'custom' && (
                <KInput
                  placeholder="접기 문구"
                  value={foldLabel}
                  onChange={e =>
                    setFoldLabel(
                      e.target.value,
                    )
                  }
                />
              )}
            </div>
          </div>

          <div className="form-actions">
            <button
              className="btn btn-onbk"
              onClick={() =>
                router.push(
                  editing
                    ? `/board/${editing.id}`
                    : boardHref(board.id),
                )
              }
              disabled={uploading}
            >
              CANCEL
            </button>

            <button
              className="btn btn-accent"
              onClick={post}
              disabled={uploading}
            >
              {uploading
                ? 'UPLOADING...'
                : editing
                  ? 'SAVE'
                  : 'POST'}
            </button>
          </div>
        </div>
      </div>

      {/* HTML → 에디터/편집 미리보기 전환 경고 (v2.0) — 다루지 못하는 태그는 편집 순간 정리된다 */}
      <ConfirmModal
        open={askRich !== null}
        title="여기서 편집하면 일부 태그가 정리됩니다"
        body="에디터는 굵게·목록·제목·이미지 같은 기본 서식만 다룹니다. 표·div·style·class 등은 편집하는 순간 정리되며 되돌릴 수 없습니다. HTML을 그대로 두려면 취소하세요."
        onClose={() => setAskRich(null)}
        buttons={[
          { label: 'CANCEL', kind: 'ghost', onClick: () => setAskRich(null) },
          { label: '계속', kind: 'accent', onClick: () => { askRich?.(); setAskRich(null); } },
        ]}
      />

      {/* 대표 썸네일 위치 지정 — 16:9 (티켓 스킨) */}
      {cropOpen && thumbSrc && (
        <CropEditor
          open
          src={thumbSrc}
          aspect="16:9"
          initial={thumbCrop}
          onClose={() => setCropOpen(false)}
          onApply={c => { setThumbCrop(c); setCropOpen(false); }}
        />
      )}
    </section>
  );
}

export default function BoardWritePage() {
  return (
    <Suspense
      fallback={
        <section className="page" />
      }
    >
      <WriteInner />
    </Suspense>
  );
}
