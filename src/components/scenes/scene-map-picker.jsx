import { useCallback, useEffect, useRef, useState } from 'react';
import { Crosshair, Loader2, MapPin, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * 장면 보정용 지도 좌표 선택기 (구글 지도 + 장소 검색).
 *
 * 🔴 **지도는 거들 뿐이고, 없어도 저장은 되어야 한다.** 이 화면의 본질은 위도·경도를
 *    넣는 것이고 지도는 "기억을 짚어 주는" 보조 장치다. 그래서 키가 없거나 스크립트가
 *    막히면 **절대 던지지 않고** 안내 상자만 그린다 — 부모의 입력 칸은 그대로 살아 있다.
 *
 * 🔴 **검색창은 어떤 경우에도 잠그지 않는다.** 한때 검색이 실패하면 입력칸을 비활성으로
 *    돌렸는데, 그러면 오타를 고쳐 다시 칠 길이 사라진다("검색 누르면 다시 키인도 안 된다").
 *    검색은 자리를 빨리 찾는 지름길일 뿐이고, 실패·0건·이미 골랐음 **어느 상태에서도** 다시
 *    칠 수 있어야 한다. 그리고 검색으로 간 뒤에도 지도 클릭·위경도 직접 입력은 그대로 산다.
 *
 * 로더 구조는 앱 저장소의 `src/lib/google-maps.ts` 를 따랐다(프라미스를 공유해 한 번만
 * 로드하고, 실패는 null). 다만 **이 파일 안에 두었다.** 임시 보정 도구에서만 쓰는 코드라
 * 공용 lib 로 올릴 성질이 아니고, 이 화면이 사라지면 이 파일째로 지우면 되기 때문이다.
 *
 * # 왜 검색창이 필요한가
 *
 * 좌표가 없는 장면은 처음에 **전국이 다 들어오는 축척**(DEFAULT_ZOOM=7)에서 시작한다.
 * 그 상태에서 골프장 하나를 손으로 찾아 내려가는 것은 사실상 불가능하다 — 이름은 화면
 * 제목에 이미 떠 있는데, 그 이름으로 지도를 움직일 길이 없었다. 그래서 이름·주소로 찾아
 * 그 자리로 날아가는 입구를 지도 위에 둔다.
 *
 * # 왜 Places API (New) 인가 (구버전 예제를 베끼지 마라)
 *
 * - 구버전 위젯(`google.maps.places.Autocomplete`, `AutocompleteService`, `PlacesService`)의
 *   문서 주소는 이제 `/maps/documentation/javascript/legacy/place-autocomplete` 로 **넘어간다** —
 *   구글이 그 갈래를 legacy 로 접는 중이다.
 * - 실제로 이 프로젝트 키로 구버전 엔드포인트를 불러 보면
 *   `REQUEST_DENIED — "You're calling a legacy API, which is not enabled for your project.
 *   ... switch to the Places API (New)"` 가 돌아온다. **켤 수 있는 선택지가 아니다.**
 * - 그래서 신버전(`places.googleapis.com`)만 남는다. JS 쪽 입구는 `Place.searchByText` 다.
 *
 * ⚠ **작성 시점에 이 프로젝트(821855252659)에는 Places API (New) 가 아직 켜져 있지 않다.**
 *   개발 서버(localhost:3001)에서 이 키로 실제 브라우저에서 불러 확인했다 — 지도와 places
 *   라이브러리는 멀쩡히 올라오고(`Place` 는 함수다), `searchByText` 만 이렇게 거절당한다:
 *
 *     PLACES_SEARCH_TEXT: PERMISSION_DENIED: Error in searchByText:
 *     Places API (New) has not been used in project 821855252659 before or it is disabled.
 *
 *   즉 **리퍼러도 키도 문제가 아니고, 콘솔에서 서비스를 켜면 끝난다.**
 *   🔴 그래서 **실패를 조용히 삼키지 않는다.** 아무 일도 안 일어난 것처럼 보이면 운영자는 화면이
 *   망가진 줄 알고, 고칠 사람은 무엇이 막혔는지 영영 모른다. 짧은 안내 + 구글이 준 사유를 그대로 세운다.
 *   (그 사유 문장에 **켜러 갈 주소**가 들어 있다. 300자까지 그대로 보여 주는 이유다.)
 *
 * # 왜 자동완성 위젯이 아니라 "눌러서 검색" 인가
 *
 * 신버전의 자동완성은 (a) 구글이 그리는 웹 컴포넌트(`gmp-place-autocomplete`)라 이 저장소의
 * `@/components/ui/input` 과 생김새가 어긋나고 값을 미리 채우기가 까다롭거나, (b) Data API 로
 * 직접 그리면 타이핑마다 요청 + 세션 토큰 + `fetchFields` 2단계가 붙는다. 이 화면은 한 사람이
 * 가끔 쓰는 임시 도구라 **한 번 눌러 한 번 조회하는 쪽**이 코드도 비용도 단순하다.
 */

/**
 * 지도 키.
 *
 * `VITE_` 변수는 **빌드 시점에 번들로 인라인된다** — Cloud Run 환경변수로는 전혀 먹지 않는다
 * (Dockerfile · cloudbuild.yaml 주석). 값이 바뀌면 이미지를 다시 빌드해야 한다.
 * 비어 있으면 스크립트를 아예 요청하지 않는다: 키 없이 부르면 구글이 지도 위에 자기 경고
 * 카드를 그리는데, 그건 우리가 하려던 안내가 아니다.
 */
const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

/** 지도를 띄울 수 있는 환경인지. 「키 없음」 안내로 떨어질지 정하는 데 쓴다. */
export const googleMapsConfigured = Boolean(API_KEY);

/** 구글이 준비를 마쳤을 때 부를 전역 콜백 이름. 흔한 이름(initMap)을 쓰면 남의 코드와 겹친다. */
const CALLBACK = '__birdieupAdminGoogleMapsReady';
const SDK_ORIGIN = 'https://maps.googleapis.com/maps/api/js';

/** 좌표가 없을 때 처음 보여 줄 자리와 배율(남한 전체가 들어오는 정도) */
const DEFAULT_CENTER = { lat: 36.5, lng: 127.9 };
const DEFAULT_ZOOM = 7;
/** 좌표가 정해졌을 때 최소한 이만큼은 당겨 본다. 너무 멀면 어디를 찍었는지 확인이 안 된다. */
const PICKED_ZOOM = 15;

/** 한 번에 보여 줄 검색 결과 수. 목록이 길면 지도가 밀려 내려가 고르기가 더 어려워진다. */
const SEARCH_LIMIT = 5;

/**
 * 로드가 끝나기를 기다리는 동안 두 번째 호출이 스크립트를 또 심지 않게 공유하는 프라미스.
 * **실패는 캐시하지 않는다** — 잠깐 끊긴 네트워크였다면 다이얼로그를 다시 열었을 때 통해야 한다.
 */
let loading = null;

/** 이미 스크립트가 올라와 있는지. SPA 안에서 두 번 심으면 구글이 경고한다. */
function sdkReady() {
  return typeof window?.google?.maps?.importLibrary === 'function';
}

/**
 * 부트스트랩 스크립트를 심는다.
 * ⚠ **잘못된 키는 여기서 걸리지 않는다.** 그때도 스크립트는 정상으로 내려와 콜백까지 부르고,
 *   구글이 지도 위에 자기 오류 카드를 그린다. 화면이 가로챌 수 있는 자리가 아니다.
 */
function injectSdk(apiKey) {
  return new Promise((resolve) => {
    const params = new URLSearchParams({
      key: apiKey,
      v: 'weekly',
      loading: 'async',
      callback: CALLBACK,
      // 지명이 한국어로 적혀야 어디인지 읽힌다.
      language: 'ko',
      region: 'KR',
    });

    window[CALLBACK] = () => {
      delete window[CALLBACK];
      resolve(true);
    };

    const el = document.createElement('script');
    el.src = `${SDK_ORIGIN}?${params.toString()}`;
    el.async = true;
    // 오프라인 · 차단 확장 · 회사 프록시. 결말이 같아서 사유를 가르지 않는다.
    el.onerror = () => {
      delete window[CALLBACK];
      resolve(false);
    };
    document.head.appendChild(el);
  });
}

async function start(apiKey) {
  if (!sdkReady() && !(await injectSdk(apiKey))) return null;
  try {
    // 쓰는 것만 골라 받는다. 여기 적지 않은 라이브러리(경로 등)는 내려받지 않는다.
    const maps = await window.google.maps.importLibrary('maps');

    // 🔴 **places 는 따로 감싼다.** 장소 검색은 있으면 좋은 것이고 지도는 없으면 안 되는
    //    것이라, places 를 못 받았다고 지도까지 「못 열었다」로 떨어뜨리면 손해가 더 크다.
    // ⚠ 여기서 성공해도 **검색이 된다는 뜻은 아니다.** importLibrary 는 자바스크립트 묶음만
    //   내려받고, 키·프로젝트에 Places API (New) 가 켜져 있는지는 실제 조회 때 드러난다.
    let Place = null;
    try {
      const places = await window.google.maps.importLibrary('places');
      Place = places.Place ?? null;
    } catch {
      Place = null;
    }

    return { Map: maps.Map, Place };
  } catch {
    // 스크립트는 받았는데 라이브러리를 못 가져온 경우. 화면 입장에서는 「못 열었다」 하나다.
    return null;
  }
}

/** 지도 라이브러리를 불러온다. 키가 없거나 실패하면 null. **절대 던지지 않는다.** */
function loadGoogleMaps() {
  if (!googleMapsConfigured || typeof document === 'undefined') return Promise.resolve(null);
  if (!loading) {
    loading = start(API_KEY).then((api) => {
      if (!api) loading = null;
      return api;
    });
  }
  return loading;
}

/** 지도 중심과 값이 사실상 같은지. 같은 값으로 다시 panTo 하는 왕복을 끊는 데 쓴다. */
function sameSpot(center, latitude, longitude) {
  if (!center) return false;
  return Math.abs(center.lat() - latitude) < 1e-6 && Math.abs(center.lng() - longitude) < 1e-6;
}

/**
 * 좌표 선택기.
 *
 * **가운데 십자가가 곧 저장될 좌표다.** 핀(마커)을 세우지 않은 이유가 있다:
 * 요즘 권장되는 `AdvancedMarkerElement` 는 지도에 Map ID 가 없으면 **말없이 안 그려지고**,
 * 구형 `Marker` 는 지원 종료 예고된 API 다. 둘 다 임시 도구가 떠안을 위험은 아니라서,
 * 우리 DOM 으로 십자가를 겹쳐 그리고 지도 중심을 좌표로 삼는다. 구글 API 변화에 영향을 받지 않는다.
 *
 * 그 대신 **스크롤 줌과 더블클릭 줌을 끈다.** 둘 다 커서 쪽으로 중심을 끌어서, 찍어 둔 점이
 * 말없이 움직인다. 배율은 오른쪽 아래 +/- 버튼으로 바꾼다(중심이 그대로 유지된다).
 *
 * @param {number|null} latitude   부모가 들고 있는 위도(유효할 때만 숫자)
 * @param {number|null} longitude  경도
 * @param {(lat:number, lng:number) => void} onPick  지도에서 고른 좌표를 부모에게 돌려준다
 * @param {string} defaultQuery    검색창에 미리 채워 둘 말(장면의 sourceName). 비면 빈 칸이다
 */
export default function SceneMapPicker({ latitude, longitude, onPick, defaultQuery = '' }) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  /** 장소 검색 입구(Places API (New)). 못 받았으면 null 이고, 누르면 그 사정을 알린다. */
  const placeRef = useRef(null);

  // 지도를 만든 뒤에 onPick 이 새 함수로 바뀌어도 리스너를 다시 달지 않도록 ref 로 들고 있는다.
  // (렌더 중에 ref 를 건드리지 않고 효과에서 갱신한다.)
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  /**
   * 지도를 만들 때 쓸 중심. **최초 렌더의 좌표가 아니라 "만드는 순간의 최신 좌표"다.**
   *
   * 이미 보정된 장면을 열면 좌표가 한 박자 늦게(부모의 프리필 효과가 돈 뒤에) 들어오는데,
   * 첫 렌더 값으로 굳혀 두면 지도가 남한 전체에서 시작했다가 뒤늦게 날아간다.
   * (그래도 늦게 들어오는 경우가 있어서 아래 동기화 효과가 뒤를 받친다.)
   */
  const spotRef = useRef(null);
  useEffect(() => {
    spotRef.current =
      latitude !== null && longitude !== null ? { lat: latitude, lng: longitude } : null;
  }, [latitude, longitude]);

  const [status, setStatus] = useState(googleMapsConfigured ? 'loading' : 'unavailable');

  // 검색 라이브러리 상태. 'loading' → 'ready' | 'unavailable'
  // ⚠ 이 값은 **무엇을 안내할지**만 정한다. 입력칸은 이 값과 무관하게 언제나 살아 있다.
  const [searchStatus, setSearchStatus] = useState('loading');
  const [query, setQuery] = useState(defaultQuery);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  /**
   * 검색에 대한 한 줄 알림. `{ tone: 'info' | 'error', text, detail? }`
   *
   * 바로 옮겨 갔을 때 · 못 찾았을 때 · 거절당했을 때를 모두 여기로 말한다. 아무 말도 없으면
   * 운영자는 "눌리긴 한 건가" 싶어 같은 버튼을 계속 누른다 — 특히 **거절**은 반드시 보여야 한다.
   */
  const [notice, setNotice] = useState(null);

  /**
   * 검색창을 장면 이름으로 채운다.
   *
   * 다이얼로그 제목에 이미 떠 있는 이름을 운영자가 다시 타이핑할 이유가 없다. 다른 장면을
   * 열면(=defaultQuery 가 바뀌면) 앞 장면에서 찾던 말과 결과가 남아 있으면 안 되므로 함께 지운다.
   * 이름이 없는 라운드는 빈 칸으로 둔다 — 「라운딩」 같은 대체 문구로 검색하면 엉뚱한 곳이 나온다.
   */
  useEffect(() => {
    setQuery(defaultQuery);
    setResults([]);
    setNotice(null);
  }, [defaultQuery]);

  useEffect(() => {
    if (!googleMapsConfigured) return undefined;

    let cancelled = false;
    const listeners = [];

    loadGoogleMaps().then((api) => {
      if (cancelled) return;
      if (!api || !boxRef.current) {
        setStatus('unavailable');
        setSearchStatus('unavailable');
        return;
      }

      placeRef.current = api.Place;
      setSearchStatus(api.Place ? 'ready' : 'unavailable');

      const spot = spotRef.current;
      const map = new api.Map(boxRef.current, {
        center: spot ?? DEFAULT_CENTER,
        zoom: spot ? PICKED_ZOOM : DEFAULT_ZOOM,
        // 위 주석 참고 — 중심이 곧 좌표라서 중심을 끌고 가는 조작을 막는다.
        scrollwheel: false,
        disableDoubleClickZoom: true,
        // 보정에 필요 없는 UI 는 지운다. 상점 아이콘(clickableIcons)은 클릭을 가로채서 끈다.
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      });
      mapRef.current = map;

      listeners.push(
        map.addListener('click', (event) => {
          const position = event?.latLng;
          if (!position) return;
          // 누른 자리를 가운데로 옮겨 십자가와 값이 언제나 같은 곳을 가리키게 한다.
          map.panTo(position);
          onPickRef.current?.(position.lat(), position.lng());
        })
      );
      listeners.push(
        map.addListener('dragend', () => {
          const center = map.getCenter();
          if (!center) return;
          onPickRef.current?.(center.lat(), center.lng());
        })
      );

      setStatus('ready');
    });

    return () => {
      cancelled = true;
      listeners.forEach((listener) => listener.remove());
      mapRef.current = null;
    };
  }, []);

  // 입력 칸에 손으로 적은 좌표를 지도가 따라간다. 같은 자리면 아무것도 하지 않는다 —
  // 지도 → 입력 → 지도 로 도는 왕복을 여기서 끊는다.
  // 검색 결과를 고를 때도 이 길을 탄다(고른 좌표를 부모에게 올리면 그 값이 여기로 돌아온다).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    if (latitude === null || longitude === null) return;
    if (sameSpot(map.getCenter(), latitude, longitude)) return;

    map.panTo({ lat: latitude, lng: longitude });
    if ((map.getZoom() ?? 0) < PICKED_ZOOM) map.setZoom(PICKED_ZOOM);
  }, [latitude, longitude, status]);

  /**
   * 고른 자리를 **부모 값과 지도에 동시에** 반영한다.
   *
   * 값만 올려 두고 지도는 동기화 효과에 맡겨도 결과는 같지만, 여기서 직접 옮겨 두면
   * "골랐는데 지도가 안 움직인다"는 순간이 없다. 같은 자리면 동기화 효과가 알아서 접는다.
   * 배율을 PICKED_ZOOM 까지 당기는 이유: 골프장 하나가 화면에 들어와야 십자가가 **어디를**
   * 가리키는지 눈으로 확인된다.
   */
  const focusSpot = useCallback((position) => {
    onPickRef.current?.(position.lat(), position.lng());
    const map = mapRef.current;
    if (!map) return;
    map.panTo(position);
    if ((map.getZoom() ?? 0) < PICKED_ZOOM) map.setZoom(PICKED_ZOOM);
  }, []);

  /** 목록에서 하나를 고른 경우. 목록은 접는다 — 펼쳐 둔 채로는 방금 옮겨 간 자리가 가려진다. */
  const pickResult = useCallback((place) => {
    if (!place?.location) return;
    focusSpot(place.location);
    setResults([]);
    // 🔴 입력칸의 글자는 **건드리지 않는다.** 고른 장소 이름으로 갈아 끼우면 운영자가 치던
    //    말이 사라지고, "이 골프장이 아니네" 하고 되돌아올 때 처음부터 다시 쳐야 한다.
    setNotice({ tone: 'info', text: `「${place.displayName ?? '고른 자리'}」 자리로 옮겼어요.` });
  }, [focusSpot]);

  /**
   * 이름·주소로 장소를 찾는다.
   *
   * `fields` 는 **요금이 붙는 목록이다.** 우리가 할 일은 "그 자리로 날아가 좌표를 채우는 것"
   * 뿐이라 이름·주소·좌표 셋만 받는다.
   *
   * 결과가 **하나면 고르는 단계를 두지 않는다** — 고를 것이 없는데 한 번 더 누르게 하는 것은
   * 품만 늘린다. 여럿일 때만 목록을 세우고, 그때는 **주소를 함께** 보여 준다(같은 이름의
   * 골프장이 여럿이라 이름만으로는 고를 수가 없다).
   */
  const runSearch = useCallback(async () => {
    const text = query.trim();
    if (searching || text === '') return;

    const Place = placeRef.current;
    if (!Place) {
      // 말없이 아무 일도 안 일어나는 것이 제일 나쁘다. 지금 상태를 그대로 말한다.
      setNotice({
        tone: 'error',
        text:
          searchStatus === 'loading'
            ? '지도를 아직 불러오는 중이에요. 잠시 뒤 다시 눌러 주세요.'
            : '장소 검색을 쓸 수 없어요. 지도를 눌러 직접 찍어 주세요.',
      });
      return;
    }

    setSearching(true);
    setNotice(null);
    setResults([]);
    try {
      const { places } = await Place.searchByText({
        textQuery: text,
        fields: ['displayName', 'formattedAddress', 'location'],
        language: 'ko',
        region: 'kr',
        maxResultCount: SEARCH_LIMIT,
      });
      // 좌표 없는 결과(주소만 있는 사업장 등)는 눌러도 할 일이 없어 걸러 낸다.
      const found = (places ?? []).filter((place) => place?.location);

      if (found.length === 0) {
        setNotice({ tone: 'info', text: '찾지 못했어요. 다른 말로 찾거나 지도를 눌러 직접 찍어 주세요.' });
      } else if (found.length === 1) {
        pickResult(found[0]);
      } else {
        setResults(found);
      }
    } catch (error) {
      // 🔴 키·프로젝트에 Places API (New) 가 안 켜져 있으면 **여기서 드러난다.** 조용히 삼키면
      //    운영자에게는 "먹통"으로만 보이고, 고칠 사람은 무엇이 막혔는지 알 수가 없다.
      //    구글이 준 사유를 그대로 덧붙인다 — 우리가 지어낸 말보다 그쪽이 훨씬 쓸모 있다.
      setNotice({
        tone: 'error',
        text: '장소 검색이 거절됐어요. 지도를 눌러 직접 찍을 수는 있어요.',
        detail: String(error?.message ?? '').slice(0, 300),
      });
    } finally {
      // 🔴 실패 경로에서도 반드시 푼다. 성공에서만 풀면 한 번 실패한 뒤로 영영 잠긴다.
      setSearching(false);
    }
  }, [pickResult, query, searchStatus, searching]);

  if (status === 'unavailable') {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-6 text-center">
        <MapPin className="size-5 text-muted-foreground" />
        <p className="text-sm font-medium">
          {googleMapsConfigured ? '지도를 불러오지 못했어요.' : '지도 키가 없어 지도를 띄우지 못해요.'}
        </p>
        {/* 지도가 없다고 할 일이 없어지는 것은 아니다. 다음 수단을 바로 알려 준다. */}
        <p className="text-xs text-muted-foreground">
          아래 칸에 위도·경도를 직접 넣어 저장할 수 있어요.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* ── 장소 검색 ─────────────────────────────────────────
          🔴 여기서 <form> 을 쓰면 안 된다. 이 컴포넌트는 저장 폼 **안에** 놓이고, 중첩 form 은
             HTML 이 허용하지 않는다. 그리고 Enter 를 그냥 두면 바깥 저장 폼이 제출돼 **검색하려다
             저장이 눌린다.** 그래서 Enter 를 직접 받아 막고 검색으로 돌린다.
          🔴 입력칸에는 disabled 를 걸지 않는다 — 오타를 고쳐 다시 칠 길을 막으면 안 된다. */}
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            runSearch();
          }}
          placeholder="골프장 이름이나 주소로 찾기"
          aria-label="장소 검색"
          className="rounded-xl"
        />
        <Button
          type="button"
          variant="outline"
          className="shrink-0 rounded-xl font-bold"
          onClick={runSearch}
          // 조회가 도는 동안에만 막는다(같은 말로 두 번 던지지 않게). 끝나면 성공이든 실패든 풀린다.
          disabled={searching || query.trim() === ''}
        >
          {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          검색
        </Button>
      </div>

      {notice && (
        <p
          // 실패는 화면 낭독으로도 즉시 알려야 한다. 알림은 조회할 때마다 갈아 끼운다.
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`text-xs ${notice.tone === 'error' ? 'font-medium text-destructive' : 'text-muted-foreground'}`}
        >
          {notice.text}
          {/* 구글이 준 원문. 운영자에게는 군더더기지만, 막힌 것을 푸는 사람에게는 이 한 줄이 전부다. */}
          {notice.detail && <span className="block font-mono text-[11px] opacity-70">{notice.detail}</span>}
        </p>
      )}

      {/* 여럿일 때만 고르게 한다. **주소를 함께** 세우는 이유는 같은 이름의 골프장이 여럿이라
          이름만으로는 어느 것인지 가릴 수가 없기 때문이다. */}
      {results.length > 0 && (
        <ul className="max-h-44 overflow-y-auto rounded-xl border border-border">
          {results.map((place, index) => (
            <li
              // 장소 id 를 받지 않았으므로(요금이 붙는 필드다) 이름+주소를 열쇠로 쓴다.
              // 같은 이름·주소가 두 번 오는 경우를 대비해 순번을 덧댄다.
              key={`${place.displayName ?? ''}|${place.formattedAddress ?? ''}|${index}`}
              className="border-b border-border last:border-b-0"
            >
              <button
                type="button"
                onClick={() => pickResult(place)}
                className="w-full px-3 py-2 text-left transition-colors hover:bg-accent"
              >
                <p className="truncate text-sm font-medium">{place.displayName ?? '이름 없음'}</p>
                {place.formattedAddress && (
                  <p className="truncate text-xs text-muted-foreground">
                    {place.formattedAddress}
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative h-64 overflow-hidden rounded-xl border border-border">
        <div ref={boxRef} className="size-full" />

        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-muted/40 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            지도를 불러오는 중…
          </div>
        )}

        {/* 십자가 = 저장될 좌표. 아직 좌표가 없으면 그리지 않는다 —
            가운데를 가리키고 있으면 "이미 찍혔다"는 오해를 준다. */}
        {status === 'ready' && latitude !== null && longitude !== null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Crosshair className="size-8 text-primary drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />
          </div>
        )}
      </div>

      {/* 검색은 지름길일 뿐이다. **검색으로 대충 간 뒤 지도를 끌어 정확히 맞추는 흐름**이
          자연스러우므로, 두 길이 함께 있다는 것을 한 문장으로 적어 둔다. */}
      <p className="text-xs text-muted-foreground">
        이름이나 주소로 찾아 고르거나, 지도를 눌러(또는 끌어) 위치를 맞추세요. 가운데 십자가
        자리가 저장됩니다. 배율은 오른쪽 아래 +/- 버튼으로 바꿉니다.
      </p>
    </div>
  );
}
