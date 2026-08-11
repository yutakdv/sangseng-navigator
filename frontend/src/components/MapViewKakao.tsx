"use client";

import { useEffect, useRef, useState } from "react";
import {
  loadKakaoMaps,
  type KakaoBounds,
  type KakaoCircle,
  type KakaoInfoWindow,
  type KakaoMapInstance,
  type KakaoMarker,
  type KakaoMarkerImage,
  type KakaoNamespace,
} from "@/lib/kakaoMaps";
import { ANCHOR, CATEGORIES, CATEGORY_COLORS, PRIMARY } from "@/lib/constants";
import {
  ANCHOR_COLOR,
  FALLBACK_DOT,
  MAP_BOX,
  MAP_VIEWS,
  OTHER_CANDIDATE_COLOR,
  SLOW_MS,
  type MapViewMode,
  type MapViewProps,
} from "@/components/MapViewTypes";

/**
 * 카드 상세의 500m 반경 지도 본체 — **Kakao Maps JS SDK** (docs/plan/08 F4 · 02 문서 "지도 결정").
 *
 * 원래 MapLibre GL + OpenFreeMap이었으나 국내 배경 지도의 정보량 차이로 교체했다:
 * OpenFreeMap은 이 지역에서 리 단위 지명과 도로만 나오고 라벨도 로마자가 앞에 오는 병기라
 * ("Gohan 고한읍"), 반경 500m 축척에서 "후보가 어디인지"가 읽히지 않았다.
 * 좌표·근거 계산은 그대로고 **그리는 도구만** 바뀐 것이다.
 *
 * ⚠ 폴백 구조는 그대로 유지된다 (02 문서). 지도는 이 컴포넌트 하나에 격리돼 있어
 *   문제가 나면 `MapView.tsx`의 dynamic import 대상을 `MapViewClient`(MapLibre 구현, 보존)로
 *   되돌리는 한 줄이면 되고, 같은 근거(거점 거리·반경 내 가맹점 수)는 바로 아래 "후보 상세" 표가
 *   그대로 담고 있다.
 *
 * ⚠ 키·도메인: `NEXT_PUBLIC_KAKAO_MAP_KEY`가 없거나 Kakao 앱 [플랫폼]>[Web]에 이 도메인이
 *   등록돼 있지 않으면 SDK가 실패한다 — 그때는 지도를 접고 "표로 보라"는 안내만 남긴다.
 */

/** 지도 여백 — 마커가 모서리에 붙지 않게 (MapLibre fitBounds padding 56과 같은 값) */
const FIT_PADDING = 56;

/** 업종 점 — MapLibre circle 레이어의 반지름/테두리를 그대로 옮긴 값 */
const DOT_SAME = { r: 6, sw: 2 };
const DOT_OTHER = { r: 4, sw: 1 };

/** 핀 크기 — MapLibre 기본 마커(27.5×41)의 scale 1 / 1.15 / 0.8에 대응 */
const PIN_BASE = { w: 27, h: 41 };

function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 업종 점 — 흰 테두리를 두른 원. MapLibre `circle-stroke-color: #ffffff`와 같다. */
function dotSvg(color: string, r: number, sw: number): { src: string; size: number } {
  const size = Math.ceil((r + sw / 2) * 2) + 2;
  const c = size / 2;
  return {
    src: svgUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
        `<circle cx="${c}" cy="${c}" r="${r}" fill="${color}" stroke="#ffffff" stroke-width="${sw}"/>` +
        `</svg>`,
    ),
    size,
  };
}

/** 물방울 핀 — MapLibre 기본 마커의 형태(색 채운 핀 + 안쪽 흰 점)를 옮긴 것 */
function pinSvg(color: string, scale: number): { src: string; w: number; h: number } {
  const w = Math.round(PIN_BASE.w * scale);
  const h = Math.round(PIN_BASE.h * scale);
  return {
    src: svgUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 24 34">` +
        `<path d="M12 .6C5.9.6 1 5.5 1 11.6c0 7.6 9.4 20 10.2 21.1a1 1 0 0 0 1.6 0C13.6 31.6 23 19.2 23 11.6 23 5.5 18.1.6 12 .6z" ` +
        `fill="${color}" stroke="rgba(0,0,0,.18)" stroke-width=".8"/>` +
        `<circle cx="12" cy="11.6" r="4.2" fill="#ffffff"/>` +
        `</svg>`,
    ),
    w,
    h,
  };
}

/** 팝업 내용은 DOM으로 만든다 — 상호명·주소를 HTML 문자열로 결합하지 않기 위함 */
function popupNode(title: string, ...lines: (string | undefined)[]): HTMLElement {
  const root = document.createElement("div");
  root.className = "min-w-0 px-2.5 py-2 text-[11px] leading-4";
  const head = document.createElement("p");
  head.className = "text-xs font-semibold text-admin-text";
  head.textContent = title;
  root.appendChild(head);
  for (const line of lines) {
    if (!line) continue;
    const p = document.createElement("p");
    p.className = "mt-0.5 text-admin-text-muted";
    p.textContent = line;
    root.appendChild(p);
  }
  return root;
}

/** 위·경도 span을 비율만큼 넓힌 bounds — `panTo(bounds)`는 padding 인자를 받지 않는다 */
function paddedBounds(
  kakao: KakaoNamespace,
  points: { lat: number; lng: number }[],
  ratio = 0.18,
): KakaoBounds | null {
  if (!points.length) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  // 한 점만 있을 때(후보=거점 겹침 등) span이 0이라 최소 여백을 준다
  const padLat = Math.max((maxLat - minLat) * ratio, 0.0015);
  const padLng = Math.max((maxLng - minLng) * ratio, 0.0015);
  const bounds = new kakao.maps.LatLngBounds();
  bounds.extend(new kakao.maps.LatLng(minLat - padLat, minLng - padLng));
  bounds.extend(new kakao.maps.LatLng(maxLat + padLat, maxLng + padLng));
  return bounds;
}

/** 반경 원이 화면에 꽉 차게 — 원의 bbox를 미터→도 단위로 환산한다 */
function circleCorners(
  center: { lat: number; lng: number },
  radiusM: number,
): { lat: number; lng: number }[] {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((center.lat * Math.PI) / 180));
  return [
    { lat: center.lat - dLat, lng: center.lng - dLng },
    { lat: center.lat + dLat, lng: center.lng + dLng },
  ];
}

export function MapViewKakao({
  center,
  candidates,
  merchants,
  sameCategory,
  radiusM = 500,
}: MapViewProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<KakaoMapInstance | null>(null);
  const kakaoRef = useRef<KakaoNamespace | null>(null);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  const [view, setView] = useState<MapViewMode>("anchor");
  // 모바일에서 한 손가락 드래그가 페이지 스크롤을 가로채지 않게 — MapLibre `cooperativeGestures` 대응.
  // 탭하기 전까지 드래그를 잠그고, 잠긴 동안만 안내를 덮는다.
  const [locked, setLocked] = useState(false);

  // 승인 버튼 → revalidate로 부모 서버 컴포넌트가 다시 렌더돼도 지도를 새로 만들지 않는다
  // (데모 5단계에서 지도가 깜빡이는 것을 막는다). 아래 signature가 실제로 달라질 때만 다시 만든다 —
  // 같은 signature면 props 내용도 같은 카드의 같은 데이터다.
  const signature = `${center.lng},${center.lat},${radiusM},${sameCategory},${candidates.length},${merchants.length}`;

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    let active = true;
    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_MS);
    const markers: KakaoMarker[] = [];
    let circle: KakaoCircle | null = null;
    let infoWindow: KakaoInfoWindow | null = null;

    // 터치 기기에서만 드래그를 잠근다 — 데스크톱은 휠만 막으면 페이지 스크롤을 가로채지 않는다
    const coarse =
      typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

    loadKakaoMaps()
      .then((kakao) => {
        if (!active || !boxRef.current) return;
        window.clearTimeout(slowTimer);
        setSlow(false);
        kakaoRef.current = kakao;

        const map = new kakao.maps.Map(boxRef.current, {
          center: new kakao.maps.LatLng(center.lat, center.lng),
          level: 6,
          scrollwheel: false, // 페이지 스크롤을 지도가 가로채지 않게 (13 §8 반응형 최소선)
          draggable: !coarse,
        });
        mapRef.current = map;
        setLocked(coarse);

        // 확대·축소 컨트롤 — MapLibre NavigationControl(showCompass:false) 자리
        map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.TOPRIGHT);

        const openPopup = (marker: KakaoMarker, content: HTMLElement) => {
          infoWindow?.close();
          infoWindow = new kakao.maps.InfoWindow({ content, removable: true });
          infoWindow.open(map, marker);
        };

        // ── 500m 반경 원 ─────────────────────────────────────────
        // Kakao는 반지름을 미터로 직접 받는다 — MapLibre처럼 64각형으로 근사할 필요가 없다
        circle = new kakao.maps.Circle({
          center: new kakao.maps.LatLng(center.lat, center.lng),
          radius: radiusM,
          fillColor: PRIMARY,
          fillOpacity: 0.15,
          strokeColor: PRIMARY,
          strokeWeight: 1.5,
          strokeOpacity: 0.55,
          strokeStyle: "solid",
        });
        circle.setMap(map);

        // ── 가맹점 점 ────────────────────────────────────────────
        // 업종 색은 항목에 고정(13 §5). 제안 업종은 크게 찍어 반경 안 공백이 눈에 보이게 한다.
        // MarkerImage는 업종·크기 조합당 하나만 만들어 재사용한다 — 읍당 최대 639개(태백시)라
        // 마커마다 이미지를 새로 만들면 그 수만큼 객체가 늘어난다.
        const dotImages = new Map<string, KakaoMarkerImage>();
        const dotImageFor = (color: string, same: boolean) => {
          const key = `${color}|${same}`;
          const cached = dotImages.get(key);
          if (cached) return cached;
          const { r, sw } = same ? DOT_SAME : DOT_OTHER;
          const { src, size } = dotSvg(color, r, sw);
          const image = new kakao.maps.MarkerImage(src, new kakao.maps.Size(size, size), {
            offset: new kakao.maps.Point(size / 2, size / 2),
          });
          dotImages.set(key, image);
          return image;
        };

        for (const m of merchants) {
          const same = m.category === sameCategory;
          const marker = new kakao.maps.Marker({
            map,
            position: new kakao.maps.LatLng(m.lat, m.lng),
            image: dotImageFor(CATEGORY_COLORS[m.category] ?? FALLBACK_DOT, same),
            title: m.name,
            zIndex: same ? 2 : 1,
          });
          markers.push(marker);
          kakao.maps.event.addListener(marker, "click", () => {
            openPopup(marker, popupNode(m.name, `${m.category} · 하이원포인트 가맹점`, m.address));
          });
        }

        // ── 마커 (거점 · 후보) ─────────────────────────────────────
        // 라벨은 ANCHOR.name 그대로 — "정문"은 근거 없는 좌표라 폐기됐다 (13 §9)
        const addPin = (
          position: { lat: number; lng: number },
          color: string,
          scale: number,
          zIndex: number,
          content: () => HTMLElement,
        ) => {
          const { src, w, h } = pinSvg(color, scale);
          const marker = new kakao.maps.Marker({
            map,
            position: new kakao.maps.LatLng(position.lat, position.lng),
            image: new kakao.maps.MarkerImage(src, new kakao.maps.Size(w, h), {
              offset: new kakao.maps.Point(w / 2, h), // 핀 끝이 좌표를 가리키게
            }),
            zIndex,
          });
          markers.push(marker);
          kakao.maps.event.addListener(marker, "click", () => openPopup(marker, content()));
        };

        addPin(ANCHOR, ANCHOR_COLOR, 1, 5, () =>
          popupNode(ANCHOR.name, "거점 — 후보까지의 거리·소요시간 기준점"),
        );

        for (const cd of candidates) {
          addPin(
            cd,
            cd.isTarget ? PRIMARY : OTHER_CANDIDATE_COLOR,
            cd.isTarget ? 1.15 : 0.8,
            cd.isTarget ? 7 : 6,
            () =>
              popupNode(
                cd.name,
                `${cd.category} · ${cd.isTarget ? "이번 제안 후보" : "같은 읍의 다른 후보"}`,
                cd.address,
              ),
          );
        }

        // 첫 화면은 "거점과 후보를 함께" — 카드 서사(거점에서 직선 X km / 도로 Y분)와 같은 그림이다
        const initial = new kakao.maps.LatLngBounds();
        initial.extend(new kakao.maps.LatLng(center.lat, center.lng));
        initial.extend(new kakao.maps.LatLng(ANCHOR.lat, ANCHOR.lng));
        map.setBounds(initial, FIT_PADDING, FIT_PADDING, FIT_PADDING, FIT_PADDING);
        setView("anchor");
      })
      .catch(() => {
        if (!active) return;
        window.clearTimeout(slowTimer);
        setFailed(true);
      });

    return () => {
      active = false;
      window.clearTimeout(slowTimer);
      infoWindow?.close();
      for (const marker of markers) marker.setMap(null);
      circle?.setMap(null);
      mapRef.current = null;
      kakaoRef.current = null;
      // Kakao에는 map.destroy()가 없다 — SDK가 컨테이너에 직접 붙인 DOM을 비워야
      // signature가 바뀌어 다시 만들 때 지도가 두 겹으로 쌓이지 않는다.
      if (box) box.innerHTML = "";
    };
    // signature가 같으면 같은 카드의 같은 데이터라 지도를 다시 만들 이유가 없다 (위 주석).
    // props를 그대로 의존하면 승인 → revalidate 때마다 지도가 통째로 재생성된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const applyView = (next: MapViewMode) => {
    setView(next);
    const map = mapRef.current;
    const kakao = kakaoRef.current;
    if (!map || !kakao) return;

    const points =
      next === "radius"
        ? circleCorners(center, radiusM)
        : next === "anchor"
          ? [center, { lat: ANCHOR.lat, lng: ANCHOR.lng }]
          : [center, ...merchants, ...candidates];

    const bounds = paddedBounds(kakao, points);
    if (!bounds) return;
    // panTo는 영역에 맞춰 **부드럽게** 이동한다. 구버전 SDK에서 bounds 인자를 받지 않으면
    // 즉시 이동으로 떨어뜨린다 — 뷰 전환이 아예 안 되는 것보다 낫다.
    try {
      map.panTo(bounds);
    } catch {
      map.setBounds(bounds);
    }
  };

  const unlock = () => {
    setLocked(false);
    mapRef.current?.setDraggable(true);
  };

  if (failed) {
    return (
      <div className={`${MAP_BOX} flex flex-col items-center justify-center gap-1 px-4 text-center`}>
        <p className="text-sm font-medium text-admin-text">지도를 표시하지 못했습니다</p>
        <p className="break-keep text-xs leading-5 text-admin-text-muted">
          지도를 불러오지 못했습니다. 아래 “후보 상세” 표에 거점 거리와 반경 500m 내 가맹점 수가 같은
          근거로 담겨 있습니다.
        </p>
      </div>
    );
  }

  // 범례에는 이 읍에 실제로 있는 업종만 — 순서·색은 고정 팔레트 그대로 (13 §5)
  const present = CATEGORIES.filter((c) => merchants.some((m) => m.category === c));

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="relative">
        <div ref={boxRef} className={MAP_BOX} />
        {locked ? (
          <button
            type="button"
            onClick={unlock}
            className="absolute inset-0 flex items-end justify-center rounded-lg bg-admin-text/5 pb-4 text-[11px] font-medium text-admin-text"
          >
            <span className="rounded-full bg-white/95 px-3 py-1.5 shadow-card">
              지도를 탭하면 움직일 수 있습니다
            </span>
          </button>
        ) : null}
      </div>

      {slow ? (
        <p role="status" className="break-keep text-[11px] leading-4 text-admin-text-muted">
          지도가 늦게 뜨거나 표시되지 않으면 아래 “후보 상세” 표에서 같은 근거(거점 거리·반경 500m 내
          가맹점 수)를 확인할 수 있습니다.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {MAP_VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            onClick={() => applyView(v.value)}
            aria-pressed={view === v.value}
            className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
              view === v.value
                ? "bg-admin-primary font-medium text-white"
                : "bg-admin-bg text-admin-text hover:bg-slate-200"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-4 text-admin-text-muted">
        <Legend shape="pin" color={PRIMARY} label="이번 제안 후보" />
        <Legend shape="pin" color={OTHER_CANDIDATE_COLOR} label="같은 읍의 다른 후보" />
        <Legend shape="pin" color={ANCHOR_COLOR} label={`거점 ${ANCHOR.name}`} />
        <Legend shape="area" color={PRIMARY} label={`반경 ${radiusM}m`} />
        {present.map((c) => (
          <Legend
            key={c}
            shape="dot"
            color={CATEGORY_COLORS[c]}
            label={c === sameCategory ? `${c} 가맹점 (제안 업종)` : `${c} 가맹점`}
          />
        ))}
      </ul>
    </div>
  );
}

function Legend({
  shape,
  color,
  label,
}: {
  shape: "pin" | "dot" | "area";
  color: string;
  label: string;
}) {
  const style =
    shape === "area"
      ? { backgroundColor: color, opacity: 0.25, borderRadius: "9999px" }
      : {
          backgroundColor: color,
          borderRadius: shape === "pin" ? "9999px 9999px 9999px 1px" : "9999px",
        };
  return (
    <li className="flex items-center gap-1">
      <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0" style={style} />
      <span>{label}</span>
    </li>
  );
}
