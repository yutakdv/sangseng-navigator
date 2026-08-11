"use client";

import { useEffect, useRef, useState } from "react";
import {
  loadKakaoMaps,
  type KakaoCustomOverlay,
  type KakaoMapInstance,
  type KakaoMarker,
} from "@/lib/kakaoMaps";
import type { Recommendation } from "@/types";

// SDK 로더는 `lib/kakaoMaps.ts` 한 곳에만 둔다 — 카드 상세 지도(`MapViewKakao`)와 같은
// 스크립트를 공유해야 태그가 두 번 붙지 않고 `window.kakao` 타입도 갈라지지 않는다.

/**
 * 마커 핀 — 카카오 기본 파란 핀 대신 위젯 그린(`visitor-primary` #166534)으로 그린다.
 *
 * SVG를 data URI로 넣어 외부 이미지 요청을 만들지 않는다(핀 하나 때문에 정적 자산과 캐시
 * 문제를 늘리지 않는다). 확충 가맹점은 목록에서 별도 섹션으로 갈라 두었으므로 지도에서도
 * 구분되어야 한다 — 같은 그린 계열을 쓰되 안쪽 표식을 점 → 반짝임으로 바꾸고 한 치수 키운다.
 */
function pinDataUri(mark: "dot" | "sparkle"): string {
  const inner =
    mark === "dot"
      ? '<circle cx="12" cy="11.6" r="4.2" fill="#ffffff"/>'
      : '<path d="M12 6.2l1.5 3.6 3.6 1.5-3.6 1.5L12 16.4l-1.5-3.6-3.6-1.5 3.6-1.5L12 6.2Z" fill="#ffffff"/>';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32">' +
    '<path d="M12 31.2S23 19.6 23 11.6C23 5.2 18.1.8 12 .8S1 5.2 1 11.6c0 8 11 19.6 11 19.6Z"' +
    ' fill="#166534" stroke="#ffffff" stroke-width="1.6"/>' +
    inner +
    "</svg>";
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const PIN = {
  base: { src: pinDataUri("dot"), w: 30, h: 40 },
  fresh: { src: pinDataUri("sparkle"), w: 34, h: 45 },
} as const;

/** 핀 끝과 카드 사이 간격 — 카드가 핀을 덮지 않게 이만큼 띄운다 (가장 큰 핀 45px + 여백) */
const CARD_LIFT = 52;

/**
 * 핀을 눌렀을 때 뜨는 말풍선 카드.
 *
 * SDK의 InfoWindow가 아니라 CustomOverlay에 넣을 DOM을 직접 만든다 — InfoWindow는 흰 프레임과
 * 꼬리, 닫기 버튼이 전부 SDK 것이라 목록 카드(`MerchantCard`)와 같은 라운드·그림자·그린 배지를
 * 쓸 수 없다. 지도 위에 뜨는 카드가 목록 카드와 남남처럼 보이면 같은 가맹점이라는 게 안 읽힌다.
 *
 * JSX가 아닌 이유는 CustomOverlay가 HTMLElement를 요구하기 때문이고, 클래스 문자열이 이 파일에
 * 그대로 있으므로 Tailwind가 정상적으로 수집한다.
 */
function popupCard(merchant: Recommendation, onClose: () => void): HTMLElement {
  const el = (tag: string, className: string, text?: string): HTMLElement => {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  // 바깥 래퍼의 아래 여백이 곧 "핀 위로 띄우는 높이"다 (yAnchor=1이 이 박스의 바닥을 좌표에 붙인다)
  const root = el("div", "relative w-[236px]");
  root.style.paddingBottom = `${CARD_LIFT}px`;

  const card = el(
    "div",
    "relative rounded-2xl bg-white p-3.5 text-left shadow-[0_18px_40px_-16px_rgb(15_23_42_/_0.45)]",
  );

  const close = el(
    "button",
    "absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600",
  );
  close.setAttribute("type", "button");
  close.setAttribute("aria-label", "닫기");
  close.innerHTML =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  close.addEventListener("click", onClose);
  card.appendChild(close);

  card.appendChild(el("strong", "block pr-7 text-[14px] font-bold leading-5 text-admin-text", merchant.name));
  card.appendChild(el("span", "mt-0.5 block text-[11px] font-medium text-admin-text-muted", merchant.category));
  card.appendChild(
    el("span", "mt-1.5 block break-keep text-[11px] leading-4 text-admin-text-muted", merchant.address),
  );

  const badges = el("div", "mt-2 flex flex-wrap gap-1");
  if (merchant.badge) {
    badges.appendChild(
      el(
        "span",
        "inline-flex items-center rounded-full bg-state-good-bg px-2 py-0.5 text-[10px] font-bold text-state-good",
        merchant.badge,
      ),
    );
  }
  if (merchant.payback) {
    badges.appendChild(
      el(
        "span",
        "inline-flex items-center rounded-full bg-visitor-primary-soft px-2 py-0.5 text-[10px] font-bold text-visitor-primary",
        `${merchant.payback.rate}% 페이백`,
      ),
    );
  }
  if (badges.childElementCount) card.appendChild(badges);

  const link = el(
    "a",
    "mt-2.5 flex min-h-9 items-center justify-center rounded-xl bg-visitor-primary text-[12px] font-bold text-white",
    "카카오맵에서 길찾기",
  );
  link.setAttribute("href", merchant.directions_url);
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", "noreferrer");
  card.appendChild(link);

  // 꼬리 — 카드와 같은 흰색 사각형을 45° 돌려 카드 아래 가운데에 붙인다
  const tail = el("div", "absolute left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-white");
  tail.style.bottom = `${CARD_LIFT - 6}px`;

  root.appendChild(card);
  root.appendChild(tail);
  return root;
}

export function KakaoMapView({
  recommendations,
  region,
}: {
  recommendations: Recommendation[];
  region?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [message, setMessage] = useState("지도를 준비하고 있어요…");
  /** 말풍선이 열려 있는 동안엔 제목 칩을 내린다 — 300px짜리 모바일 지도에서 둘이 겹친다 */
  const [popupOpen, setPopupOpen] = useState(false);

  useEffect(() => {
    let active = true;
    let map: KakaoMapInstance | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const markers: KakaoMarker[] = [];
    let popup: KakaoCustomOverlay | null = null;
    const closePopup = () => {
      popup?.setMap(null);
      popup = null;
      if (active) setPopupOpen(false);
    };

    const points = recommendations.filter(
      (merchant) => Number.isFinite(merchant.lat) && Number.isFinite(merchant.lng),
    );

    if (!points.length) {
      return () => {
        active = false;
      };
    }

    loadKakaoMaps()
      .then((kakao) => {
        if (!active || !containerRef.current) return;
        const center = new kakao.maps.LatLng(points[0].lat, points[0].lng);
        const mapInstance = new kakao.maps.Map(containerRef.current, { center, level: 8 });
        map = mapInstance;
        const bounds = new kakao.maps.LatLngBounds();

        points.forEach((merchant) => {
          const position = new kakao.maps.LatLng(merchant.lat, merchant.lng);
          bounds.extend(position);
          const pin = merchant.badge ? PIN.fresh : PIN.base;
          const marker = new kakao.maps.Marker({
            map: mapInstance,
            position,
            title: merchant.name,
            image: new kakao.maps.MarkerImage(pin.src, new kakao.maps.Size(pin.w, pin.h), {
              // 핀 끝이 좌표를 가리키게 — 기본 offset은 이미지 왼쪽 위다
              offset: new kakao.maps.Point(pin.w / 2, pin.h),
            }),
            // 확충 핀이 겹칠 때 뒤로 숨지 않게
            zIndex: merchant.badge ? 3 : 2,
          });
          markers.push(marker);
          kakao.maps.event.addListener(marker, "click", () => {
            if (!map) return;
            closePopup();
            const card = popupCard(merchant, closePopup);
            popup = new kakao.maps.CustomOverlay({
              position,
              content: card,
              yAnchor: 1,
              zIndex: 10,
              clickable: true,
            });
            popup.setMap(map);
            setPopupOpen(true);
            /**
             * 카드는 핀 위로 자라는데 지도 섹션은 `overflow-hidden`이라, 위쪽 핀을 누르면
             * 이름·닫기 버튼이 지도 밖으로 잘려 나간다. 클릭한 핀을 가운데로 옮기고, 그래도
             * 카드가 위로 넘칠 만큼이면 그만큼 더 내려 자리를 만든다.
             *
             * `panTo`(애니메이션)를 쓰면 뒤이은 `panBy`가 진행 중인 이동에 먹혀 카드가 잘린 채
             * 남는다 — 자리 잡기는 즉시(`setCenter`) 하고, 미세 조정만 애니메이션으로 준다.
             */
            map.setCenter(position);
            const viewHeight = containerRef.current?.clientHeight ?? 0;
            requestAnimationFrame(() => {
              const overflowAbove = card.offsetHeight + 14 - viewHeight / 2;
              if (overflowAbove > 0) map?.panBy(0, -overflowAbove);
            });
          });
        });

        // 지도 빈 곳을 누르면 닫힌다 — 카드에 닫기 버튼이 있어도 이 동작을 기대하는 사용자가 많다
        kakao.maps.event.addListener(mapInstance, "click", closePopup);

        const fit = () => {
          if (!map) return;
          // 컨테이너가 최종 폭에 닿기 전에 지도를 만들면 늘어난 만큼이 회색 타일로 남는다 —
          // 크기가 바뀔 때마다 다시 재서 그리고, 뷰 영역도 같이 맞춘다
          map.relayout();
          if (points.length > 1) map.setBounds(bounds, 48, 48, 48, 48);
          else map.setCenter(center);
        };
        fit();
        if (typeof ResizeObserver !== "undefined" && containerRef.current) {
          resizeObserver = new ResizeObserver(fit);
          resizeObserver.observe(containerRef.current);
        }
        if (active) setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStatus("fallback");
        setMessage(
          error instanceof Error && error.message.includes("키")
            ? "Kakao 지도 키를 확인하면 주변 가맹점을 지도에서 볼 수 있어요."
            : "지도를 불러오지 못했어요. 아래 가맹점 목록은 계속 이용할 수 있어요.",
        );
      });

    return () => {
      active = false;
      resizeObserver?.disconnect();
      closePopup();
      markers.forEach((marker) => marker.setMap(null));
      map = null;
    };
  }, [recommendations]);

  const hasPoints = recommendations.some(
    (merchant) => Number.isFinite(merchant.lat) && Number.isFinite(merchant.lng),
  );
  const points = recommendations.filter(
    (merchant) => Number.isFinite(merchant.lat) && Number.isFinite(merchant.lng),
  );
  const freshCount = points.filter((merchant) => merchant.badge).length;
  const visibleStatus = hasPoints ? status : "fallback";
  const visibleMessage = hasPoints ? message : "이 조건에는 지도에 표시할 가맹점이 없어요.";

  return (
    <section className="relative overflow-hidden rounded-[26px] bg-[#eaf4e8] ring-1 ring-inset ring-emerald-900/10">
      <div ref={containerRef} className="h-[300px] w-full sm:h-[360px]" aria-label="추천 가맹점 Kakao 지도" />
      {visibleStatus !== "ready" ? (
        <StaticMapFallback points={points} message={visibleMessage} />
      ) : null}
      {/* z-10: Kakao SDK가 타일·마커 레이어를 z-index 1로 깔기 때문에, 이 칩들에 z를 주지 않으면
          실제 지도가 뜬 순간 지도 아래로 가려진다(폴백 화면에서는 보이므로 놓치기 쉽다) */}
      {popupOpen ? null : (
        <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm">
          {region ? `${region} 주변 추천 가맹점` : "하이원리조트 주변 추천 가맹점"}
        </div>
      )}
      {/* 범례는 지도에 실제로 찍힌 핀 두 종류를 설명한다 — 표식이 둘인데 한 가지만 말하면
          "왜 어떤 핀은 다르게 생겼나"가 지도 위에서 풀리지 않는다 */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex flex-wrap gap-2 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm">
        <span>
          <span className="text-visitor-primary">●</span> 하이원포인트 사용 가능 {points.length}곳
        </span>
        {freshCount ? (
          <>
            <span className="text-slate-400">·</span>
            <span>
              <span className="text-visitor-primary">✦</span> 이번 분기 확충 {freshCount}곳
            </span>
          </>
        ) : null}
      </div>
    </section>
  );
}

/** Kakao SDK가 차단되거나 키의 Web 도메인 등록이 아직 안 된 경우에도 빈 박스를 피한다. */
function StaticMapFallback({
  points,
  message,
}: {
  points: Recommendation[];
  message: string;
}) {
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats, 37.18);
  const maxLat = Math.max(...lats, 37.23);
  const minLng = Math.min(...lngs, 128.79);
  const maxLng = Math.max(...lngs, 128.86);
  const latSpan = Math.max(maxLat - minLat, 0.01);
  const lngSpan = Math.max(maxLng - minLng, 0.01);

  return (
    <div
      className="absolute inset-0 overflow-hidden bg-[#dfeadb]"
      style={{
        backgroundImage:
          "linear-gradient(28deg, transparent 46%, rgba(255,255,255,.8) 47%, rgba(255,255,255,.8) 49%, transparent 50%), linear-gradient(112deg, transparent 47%, rgba(255,255,255,.65) 48%, rgba(255,255,255,.65) 50%, transparent 51%), linear-gradient(#d3e5d4 1px, transparent 1px), linear-gradient(90deg, #d3e5d4 1px, transparent 1px)",
        backgroundSize: "180px 140px, 220px 180px, 42px 42px, 42px 42px",
      }}
    >
      <div className="absolute inset-x-4 top-4 rounded-xl bg-white/90 px-3 py-2 text-center shadow-sm">
        <p className="text-[13px] font-bold text-emerald-950">{message}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-emerald-900/65">목록에서 가맹점 상세 주소와 길찾기를 확인할 수 있어요.</p>
      </div>
      {points.map((merchant) => {
        const left = 12 + ((merchant.lng - minLng) / lngSpan) * 76;
        const top = 38 + (1 - (merchant.lat - minLat) / latSpan) * 45;
        return (
          <a
            key={`${merchant.name}-${merchant.address}`}
            href={merchant.directions_url}
            target="_blank"
            rel="noreferrer"
            title={`${merchant.name} · ${merchant.category}`}
            aria-label={`${merchant.name} Kakao 길찾기`}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center transition-transform hover:scale-110"
            style={{ left: `${Math.min(92, Math.max(8, left))}%`, top: `${Math.min(88, Math.max(38, top))}%` }}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full border-4 border-white bg-emerald-600 text-lg text-white shadow-lg">
              ●
            </span>
            <span className="mt-1 max-w-[120px] truncate rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-slate-800 shadow-sm">
              {merchant.name}
            </span>
          </a>
        );
      })}
    </div>
  );
}
