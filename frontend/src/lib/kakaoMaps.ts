/**
 * Kakao Maps JS SDK 로더 — **SDK를 쓰는 화면은 전부 이 파일 하나를 거친다**
 * (방문객 위젯 `KakaoMapView`, 카드 상세 `MapViewKakao`).
 *
 * 로더를 화면마다 두면 `declare global`의 `window.kakao` 타입이 파일마다 갈라지고
 * 스크립트 태그도 중복으로 붙는다. 싱글턴 프로미스 하나로 묶어 두 번째 호출부터는
 * 이미 끝난 로드를 그대로 재사용한다.
 *
 * ⚠ 여기 쓰는 키는 `NEXT_PUBLIC_KAKAO_MAP_KEY`(**JavaScript 키**)다 —
 *   파이프라인 지오코딩의 `KAKAO_REST_API_KEY`와 다른 키이고, Kakao 앱
 *   [플랫폼]>[Web]에 화면이 열리는 도메인이 등록돼 있어야 타일이 뜬다.
 *   미등록·미설정이면 reject되고, 호출부는 각자의 폴백 화면을 띄운다.
 */

export type KakaoLatLng = { getLat: () => number; getLng: () => number };

export type KakaoBounds = { extend: (position: KakaoLatLng) => void };

export type KakaoSize = { readonly __brand?: "KakaoSize" };
export type KakaoPoint = { readonly __brand?: "KakaoPoint" };
export type KakaoMarkerImage = { readonly __brand?: "KakaoMarkerImage" };
export type KakaoZoomControl = { readonly __brand?: "KakaoZoomControl" };

export type KakaoMapInstance = {
  setBounds: (
    bounds: KakaoBounds,
    top?: number,
    right?: number,
    bottom?: number,
    left?: number,
  ) => void;
  /** LatLngBounds를 넘기면 그 영역에 맞춰 **부드럽게** 이동한다 (뷰 전환 버튼용) */
  panTo: (target: KakaoLatLng | KakaoBounds) => void;
  /** 픽셀 단위로 밀어 준다. 말풍선이 지도 밖으로 잘리지 않게 자리를 만들 때 쓴다 */
  panBy: (dx: number, dy: number) => void;
  setCenter: (position: KakaoLatLng) => void;
  setLevel: (level: number, options?: { animate?: boolean | { duration: number } }) => void;
  getLevel: () => number;
  setDraggable: (draggable: boolean) => void;
  addControl: (control: KakaoZoomControl, position: number) => void;
  relayout: () => void;
};

export type KakaoMarker = {
  setMap: (map: KakaoMapInstance | null) => void;
};

export type KakaoInfoWindow = {
  open: (map: KakaoMapInstance, marker?: KakaoMarker) => void;
  close: () => void;
};

/**
 * 말풍선을 우리가 직접 그릴 때 쓴다 — InfoWindow는 흰 프레임·꼬리·닫기 버튼이 SDK 것이라
 * 화면 디자인(라운드·그림자·그린 배지)을 맞출 수 없다. 방문객 위젯 지도가 이걸 쓴다.
 */
export type KakaoCustomOverlay = {
  setMap: (map: KakaoMapInstance | null) => void;
};

export type KakaoCircle = {
  setMap: (map: KakaoMapInstance | null) => void;
};

export type KakaoNamespace = {
  maps: {
    load: (callback: () => void) => void;
    LatLng: new (lat: number, lng: number) => KakaoLatLng;
    LatLngBounds: new (sw?: KakaoLatLng, ne?: KakaoLatLng) => KakaoBounds;
    Size: new (width: number, height: number) => KakaoSize;
    Point: new (x: number, y: number) => KakaoPoint;
    Map: new (
      container: HTMLElement,
      options: {
        center: KakaoLatLng;
        level: number;
        /** 휠 확대·축소 — 페이지 스크롤을 지도가 가로채지 않도록 카드 상세에서는 끈다 */
        scrollwheel?: boolean;
        draggable?: boolean;
      },
    ) => KakaoMapInstance;
    Marker: new (options: {
      map?: KakaoMapInstance;
      position: KakaoLatLng;
      title?: string;
      image?: KakaoMarkerImage;
      zIndex?: number;
      clickable?: boolean;
    }) => KakaoMarker;
    MarkerImage: new (
      src: string,
      size: KakaoSize,
      options?: { offset?: KakaoPoint },
    ) => KakaoMarkerImage;
    InfoWindow: new (options: {
      content: HTMLElement;
      removable?: boolean;
      zIndex?: number;
    }) => KakaoInfoWindow;
    CustomOverlay: new (options: {
      position: KakaoLatLng;
      content: HTMLElement;
      /** 0=위쪽 끝, 1=아래쪽 끝이 position에 붙는다. 핀 위에 띄우려면 1 */
      yAnchor?: number;
      xAnchor?: number;
      zIndex?: number;
      /** 내부 링크·버튼이 눌리게 하려면 필요하다 (지도 드래그로 먹히지 않게) */
      clickable?: boolean;
    }) => KakaoCustomOverlay;
    Circle: new (options: {
      center: KakaoLatLng;
      /** 미터 단위 — MapLibre처럼 원을 다각형으로 근사할 필요가 없다 */
      radius: number;
      strokeWeight?: number;
      strokeColor?: string;
      strokeOpacity?: number;
      strokeStyle?: string;
      fillColor?: string;
      fillOpacity?: number;
    }) => KakaoCircle;
    ZoomControl: new () => KakaoZoomControl;
    ControlPosition: { TOPRIGHT: number; RIGHT: number };
    event: {
      addListener: (target: object, type: string, listener: () => void) => void;
    };
  };
};

declare global {
  interface Window {
    kakao?: KakaoNamespace;
  }
}

let kakaoLoader: Promise<KakaoNamespace> | null = null;

export function loadKakaoMaps(): Promise<KakaoNamespace> {
  const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
  if (!appKey) return Promise.reject(new Error("Kakao Maps JS 키가 없습니다."));
  if (typeof window === "undefined")
    return Promise.reject(new Error("브라우저에서만 지도를 불러올 수 있습니다."));
  if (window.kakao?.maps) return Promise.resolve(window.kakao);
  if (kakaoLoader) return kakaoLoader;

  kakaoLoader = new Promise<KakaoNamespace>((resolve, reject) => {
    const scriptId = "kakao-maps-sdk";
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
    const onLoad = () => {
      if (!window.kakao?.maps) {
        reject(new Error("Kakao Maps SDK가 초기화되지 않았습니다."));
        return;
      }
      window.kakao.maps.load(() => resolve(window.kakao as KakaoNamespace));
    };

    if (existing) {
      if (window.kakao?.maps) onLoad();
      else existing.addEventListener("load", onLoad, { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Kakao Maps SDK를 불러오지 못했습니다.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Kakao Maps SDK를 불러오지 못했습니다.")),
      { once: true },
    );
    document.head.appendChild(script);
  });

  return kakaoLoader;
}
