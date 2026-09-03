import apiClient from './apiClient';

/**
 * 이모티콘 카탈로그 관리 API (docs/admin-api.md §4).
 *
 * 정본은 Firestore 의 `emoticon_characters/{characterId}` · `emoticons/{emoticonId}` 두
 * 컬렉션이고 **문서 ID 가 곧 슬러그다**. 피드 문서에는 `emoticonId` 하나만 남으므로
 * (birdieup-was `internal/feeds` 의 feedDoc.EmoticonID) 이미 쓰인 id 를 지우거나 재사용하면
 * 과거 피드가 그림을 못 찾는다 — 숨길 때는 `active: false` 를 쓴다.
 *
 * 목록  GET    /admin/emoticons                          [Bearer + emoticons 권한]
 * 업로드 POST  /admin/emoticons/upload-url
 * 캐릭터 PUT   /admin/emoticon-characters/{characterId}   (upsert)
 *       DELETE /admin/emoticon-characters/{characterId}
 * 이모티콘 PUT /admin/emoticons/{emoticonId}              (upsert)
 *       DELETE /admin/emoticons/{emoticonId}
 *
 *   GET 응답 200:
 *   {
 *     characters: [{ id, name, iconPath, iconUrl, order, active }],
 *     emoticons:  [{ id, characterId, name, imagePath, url, order, active }]
 *   }
 *   공개 API(GET /emoticons)와 달리 **active:false 와 그림 없는 행까지 전부** 내려온다.
 *   어드민은 꺼 둔 이모티콘을 다시 켜야 하고, 업로드가 중간에 끊긴 행도 고쳐야 한다.
 *
 *   PUT 은 둘 다 **upsert 다.** 서버가 "이미 있는 id" 를 거절하지 않으므로,
 *   새로 만들 때의 중복 검사는 화면이 목록으로 직접 해야 한다(안 하면 조용히 덮어쓴다).
 *
 *   에러는 전부 { code, message } 이고 message 는 화면에 그대로 띄워도 되는 한국어다.
 *   대표 코드: 400 VALIDATION_FAILED · 403 FORBIDDEN · 409 CHARACTER_NOT_EMPTY.
 *
 *   ⚠ 저장되는 것은 storagePath 뿐이고 URL(iconUrl/url)은 응답마다 서버가 다시 만든다.
 *     화면은 URL 을 폼에 담아 두지 말고 언제나 path 를 되돌려 보내야 한다.
 */

/** 문서 ID(슬러그) 규칙. 서버와 같은 정규식이며 어긋나면 400 이다. */
export const EMOTICON_ID_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** 화면 도움말과 검증 실패 문구를 한 곳에서 관리한다 */
export const EMOTICON_ID_RULE_TEXT =
  '영문 소문자로 시작하고 소문자·숫자·밑줄만 쓸 수 있어요. (최대 40자)';

/** 서버가 서명 URL 을 내주는 콘텐츠 타입. 이 밖은 400 이라 미리 거른다. */
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** 서버 상한과 같은 2MB. 넘겨 보내 봐야 upload-url 에서 400 이다. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** id 가 서버 규칙을 만족하는지 */
export function isValidEmoticonId(value) {
  return EMOTICON_ID_PATTERN.test(String(value ?? ''));
}

/**
 * 서버 에러에서 화면에 띄울 문장을 뽑는다.
 *
 * WAS 의 `internal/httpx` 는 언제나 { code, message } 를 주고 message 가 이미 한국어라
 * 그대로 쓴다. 네트워크 단절처럼 응답 자체가 없을 때만 fallback 으로 떨어진다.
 */
export function readErrorMessage(error, fallback) {
  return (
    error?.response?.data?.message ||
    error?.message ||
    fallback ||
    '요청을 처리하지 못했습니다.'
  );
}

/** 서버 에러 코드(CHARACTER_NOT_EMPTY 같은 분기용). 없으면 빈 문자열. */
export function readErrorCode(error) {
  return error?.response?.data?.code || '';
}

/** 바이트 수를 사람이 읽는 크기로. 업로드 거절 문구에 쓴다. */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)}KB`;
  return `${(value / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 고른 파일이 업로드 제약을 만족하는지 본다.
 * 통과하면 null, 아니면 화면에 그대로 보여 줄 한국어 사유를 돌려준다.
 */
export function validateImageFile(file) {
  if (!file) return '이미지를 선택해 주세요.';
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return 'PNG · JPG · WEBP 이미지만 올릴 수 있어요.';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `이미지는 ${formatBytes(MAX_IMAGE_BYTES)} 이하만 올릴 수 있어요. (선택한 파일 ${formatBytes(file.size)})`;
  }
  return null;
}

/** 목록. 응답이 비어도 화면이 깨지지 않게 항상 두 배열을 돌려준다. */
export async function fetchCatalog() {
  const response = await apiClient.get('/admin/emoticons');
  const body = response.data ?? {};
  return {
    characters: Array.isArray(body.characters) ? body.characters : [],
    emoticons: Array.isArray(body.emoticons) ? body.emoticons : [],
  };
}

/**
 * 서명된 업로드 URL 을 받는다.
 *
 * `emoticonId` 를 주면 이모티콘 그림 경로, 생략하면 캐릭터 아이콘 경로가 나온다.
 * 경로에는 매번 새 난수가 붙으므로 같은 이모티콘을 다시 올려도 옛 그림이 CDN·브라우저
 * 캐시에 남지 않는다.
 */
export async function createUploadUrl({
  contentType,
  bytes,
  characterId,
  emoticonId,
}) {
  const response = await apiClient.post('/admin/emoticons/upload-url', {
    contentType,
    bytes,
    characterId,
    ...(emoticonId ? { emoticonId } : {}),
  });
  return response.data ?? {};
}

/**
 * 2단계 업로드: 서명 URL 발급 → 스토리지로 직접 PUT → storagePath 반환.
 *
 * 돌려받은 storagePath 를 그대로 PUT /admin/emoticons/{id} 의 `imagePath`(캐릭터면
 * `iconPath`)에 넣는다. **저장되는 것은 path 뿐이고 조회 URL 은 서버가 매번 다시 만든다.**
 *
 * ⚠ 두 번째 단계에 apiClient(axios 인스턴스)를 쓰면 안 된다. baseURL 이 붙어 절대 URL 이
 *   망가지고, 인터셉터가 Authorization 헤더를 얹으면 GCS 가 서명과 헤더 조합을 다시 계산해
 *   403 SignatureDoesNotMatch 를 낸다. 그래서 전역 fetch 로 맨몸 PUT 을 보낸다.
 *
 * ⚠ Content-Type 은 upload-url 에 보낸 contentType 과 **글자 하나까지 같아야 한다.**
 *   서명이 그 값을 포함해 계산되므로 'image/jpeg' 로 발급받고 'image/jpg' 로 보내면 깨진다.
 *   그래서 file.type 하나를 두 곳에 함께 쓴다.
 */
export async function uploadImage(file, { characterId, emoticonId } = {}) {
  const contentType = file.type;

  const { uploadUrl, storagePath } = await createUploadUrl({
    contentType,
    bytes: file.size,
    characterId,
    emoticonId,
  });

  if (!uploadUrl || !storagePath) {
    throw new Error('업로드 주소를 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }

  // fetch 는 axios 와 달리 4xx/5xx 에서도 reject 하지 않는다. res.ok 를 직접 봐야 한다.
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });

  if (!res.ok) {
    throw new Error(
      `이미지 업로드에 실패했습니다. (스토리지 응답 ${res.status}) 잠시 후 다시 시도해 주세요.`
    );
  }

  return storagePath;
}

/** 캐릭터 upsert. 부분 수정이 아니라 네 필드를 통째로 덮어쓴다. */
export async function saveCharacter(characterId, { name, iconPath, order, active }) {
  const response = await apiClient.put(
    `/admin/emoticon-characters/${encodeURIComponent(characterId)}`,
    { name, iconPath, order, active }
  );
  return response.data ?? {};
}

/** 캐릭터 삭제. 소속 이모티콘이 남아 있으면 409 CHARACTER_NOT_EMPTY 다. */
export async function deleteCharacter(characterId) {
  await apiClient.delete(
    `/admin/emoticon-characters/${encodeURIComponent(characterId)}`
  );
}

/** 이모티콘 upsert. 역시 다섯 필드를 통째로 덮어쓴다(빠뜨린 필드는 비워진다). */
export async function saveEmoticon(
  emoticonId,
  { characterId, name, imagePath, order, active }
) {
  const response = await apiClient.put(
    `/admin/emoticons/${encodeURIComponent(emoticonId)}`,
    { characterId, name, imagePath, order, active }
  );
  return response.data ?? {};
}

/** 이모티콘 삭제. 이미 쓰인 것을 지우면 과거 피드의 그림이 사라진다 — 화면에서 경고한다. */
export async function deleteEmoticon(emoticonId) {
  await apiClient.delete(`/admin/emoticons/${encodeURIComponent(emoticonId)}`);
}

const emoticonService = {
  fetchCatalog,
  createUploadUrl,
  uploadImage,
  saveCharacter,
  deleteCharacter,
  saveEmoticon,
  deleteEmoticon,
};

export default emoticonService;
