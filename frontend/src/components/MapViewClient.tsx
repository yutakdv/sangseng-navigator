"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, Polygon } from "geojson";
import { ANCHOR, CATEGORIES, CATEGORY_COLORS, PRIMARY } from "@/lib/constants";

/**
 * 카드 상세의 500m 반경 지도 본체 (docs/plan/08 F4 · 02 문서 "지도 결정").
 *
 * MapLibre GL + OpenFreeMap — 키·도메인 등록이 필요 없고 WebGL 캔버스라 Safari에서 안정적이다.
 * 브라우저 전용이라 이 파일은 `MapView.tsx`가 `next/dynamic(ssr:false)`로만 불러온다.
 *
 * ⚠ Safari 폴백 구조: 지도는 이 컴포넌트 하나에 격리돼 있다. 렌더 문제가 나면 카드 상세에서
 *   `<MapView/>` 한 줄만 걷어내면 되고, 같은 근거(거점 거리·반경 내 가맹점 수)는 바로 아래
 *   "후보 상세" 표가 그대로 담고 있다 (02 문서 최종 폴백 = 거리 표 + 정적 캡처).
 */

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** 지도 높이 — `MapView.tsx`의 로딩 자리표시자와 **같이** 바꿔야 레이아웃이 튀지 않는다 (13 §8) */
const MAP_BOX = "h-[240px] w-full overflow-hidden rounded-lg bg-admin-bg sm:h-[380px]";

const ANCHOR_COLOR = "#1E1840"; // admin.sidebar-deep (lavender-950) — 거점
const OTHER_CANDIDATE_COLOR = "#9ca3af"; // 같은 읍의 다른 후보
const FALLBACK_DOT = "#6b7280"; // 표시 6분류에 없는 값이 들어올 때
/** 이 시간 안에 타일이 안 뜨면 "표로 보라"는 안내를 띄운다 — 심사위원이 고장으로 오인하지 않게 */
const SLOW_MS = 6000;

export type MapPin = {
  name: string;
  category: string;
  lat: number;
  lng: number;
  address?: string;
};

export type MapCandidatePin = MapPin & {
  id: string;
  /** 이번 카드가 제안하는 후보 — 500m 원의 중심이자 강조 마커 */
  isTarget: boolean;
};

export type MapViewProps = {
  /** 500m 원의 중심 = 제안 후보 좌표 */
  center: { lat: number; lng: number };
  /** 같은 읍의 후보 전체 (제안 후보 포함) */
  candidates: MapCandidatePin[];
  /** 같은 읍의 하이원포인트 가맹점 — 전체(1,678건)를 넘기지 않는다 */
  merchants: MapPin[];
  /** 제안 후보와 같은 표시 업종 — 반경 안 동일 업종 공백이 눈에 보이게 크게 찍는다 */
  sameCategory: string;
  radiusM?: number;
};

/**
 * 반경 원 근사 폴리곤(64각형) — **docs/plan/08 F4의 스니펫을 그대로 가져왔다.**
 * 원문에서 바꾼 것은 두 가지뿐이다: `properties: {}` 추가와 반환 타입 명시
 * (`map.addSource`가 `GeoJSON.Feature`를 요구해 원문의 `as const` 형태로는 타입이 맞지 않는다).
 */
function circlePolygon(lng: number, lat: number, radiusM = 500, points = 64): Feature<Polygon> {
  const coords = Array.from({ length: points + 1 }, (_, i) => {
    const angle = (i / points) * 2 * Math.PI;
    const dLat = (radiusM * Math.cos(angle)) / 111320;
    const dLng = (radiusM * Math.sin(angle)) / (111320 * Math.cos((lat * Math.PI) / 180));
    return [lng + dLng, lat + dLat];
  });
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
}

/**
 * WebGL 가용 여부 — 지도를 만들기 전에 확인한다.
 * 이 컴포넌트는 `ssr:false`로만 로드되므로 렌더 시점에 document가 있다.
 */
function webglSupported(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** 팝업 내용은 DOM으로 만든다 — 상호명·주소를 HTML 문자열로 결합하지 않기 위함 */
function popupNode(title: string, ...lines: (string | undefined)[]): HTMLElement {
  const root = document.createElement("div");
  root.className = "min-w-0 text-[11px] leading-4";
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

type View = "anchor" | "radius" | "eup";

const VIEWS: { value: View; label: string }[] = [
  { value: "anchor", label: "거점과 함께" },
  { value: "radius", label: "반경 500m 확대" },
  { value: "eup", label: "읍 전체 가맹점" },
];

export function MapViewClient({
  center,
  candidates,
  merchants,
  sameCategory,
  radiusM = 500,
}: MapViewProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // 지원 여부는 마운트 시 한 번만 판정한다 (effect에서 setState 하며 다시 그리지 않도록)
  const [webglOk] = useState(webglSupported);
  const [slow, setSlow] = useState(false);
  const [view, setView] = useState<View>("anchor");

  // 승인 버튼 → revalidate로 부모 서버 컴포넌트가 다시 렌더돼도 지도를 새로 만들지 않는다
  // (데모 5단계에서 지도가 깜빡이는 것을 막는다). 아래 signature가 실제로 달라질 때만 다시 만든다 —
  // 같은 signature면 props 내용도 같은 카드의 같은 데이터다.
  const signature = `${center.lng},${center.lat},${radiusM},${sameCategory},${candidates.length},${merchants.length}`;

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_MS);

    // 첫 화면은 "거점과 후보를 함께" — 카드 서사(거점에서 직선 X km / 도로 Y분)와 같은 그림이다
    const initialBounds = new maplibregl.LngLatBounds([center.lng, center.lat], [
      center.lng,
      center.lat,
    ]).extend([ANCHOR.lng, ANCHOR.lat]);

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: box,
        style: STYLE_URL, // OpenFreeMap — 키·도메인 등록 불필요
        bounds: initialBounds,
        fitBoundsOptions: { padding: 56 },
        // 모바일에서 페이지 스크롤을 지도가 가로채지 않게 (13 §8 반응형 최소선)
        cooperativeGestures: true,
        locale: {
          "CooperativeGesturesHandler.WindowsHelpText": "Ctrl 키를 누른 채 스크롤하면 확대·축소됩니다",
          "CooperativeGesturesHandler.MacHelpText": "⌘ 키를 누른 채 스크롤하면 확대·축소됩니다",
          "CooperativeGesturesHandler.MobileHelpText": "두 손가락으로 지도를 움직일 수 있습니다",
        },
        // attributionControl은 기본값 유지 — OSM·OpenFreeMap 저작자 표시 의무 (02 문서)
      });
    } catch {
      // 지도만 접고 화면의 나머지(후보 상세 표)는 그대로 둔다 — 타이머가 안내 문구를 띄운다
      return () => window.clearTimeout(slowTimer);
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      window.clearTimeout(slowTimer);
      setSlow(false);

      // ── 500m 반경 원 ─────────────────────────────────────────
      map.addSource("radius", { type: "geojson", data: circlePolygon(center.lng, center.lat, radiusM) });
      map.addLayer({
        id: "radius-fill",
        type: "fill",
        source: "radius",
        paint: { "fill-color": PRIMARY, "fill-opacity": 0.15 },
      });
      map.addLayer({
        id: "radius-line",
        type: "line",
        source: "radius",
        paint: { "line-color": PRIMARY, "line-width": 1.5, "line-opacity": 0.55 },
      });

      // ── 가맹점 점 ────────────────────────────────────────────
      // 색·크기는 feature 속성으로 미리 계산해 넣는다 (스타일 표현식을 단순 get으로 유지)
      map.addSource("merchants", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: merchants.map((m) => {
            const same = m.category === sameCategory;
            return {
              type: "Feature" as const,
              properties: {
                name: m.name,
                category: m.category,
                address: m.address ?? "",
                color: CATEGORY_COLORS[m.category] ?? FALLBACK_DOT,
                r: same ? 6 : 4,
                sw: same ? 2 : 1,
              },
              geometry: { type: "Point" as const, coordinates: [m.lng, m.lat] },
            };
          }),
        },
      });
      map.addLayer({
        id: "merchant-dots",
        type: "circle",
        source: "merchants",
        paint: {
          "circle-radius": ["get", "r"],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["get", "sw"],
        },
      });

      map.on("click", "merchant-dots", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const p = feature.properties as { name?: string; category?: string; address?: string };
        new maplibregl.Popup({ offset: 10, maxWidth: "260px" })
          .setLngLat(e.lngLat)
          .setDOMContent(
            popupNode(p.name ?? "", `${p.category ?? ""} · 하이원포인트 가맹점`, p.address || undefined),
          )
          .addTo(map);
      });
      map.on("mouseenter", "merchant-dots", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "merchant-dots", () => {
        map.getCanvas().style.cursor = "";
      });
    });

    // ── 마커 (거점 · 후보) ─────────────────────────────────────
    // 라벨은 ANCHOR.name 그대로 — "정문"은 근거 없는 좌표라 폐기됐다 (13 §9)
    new maplibregl.Marker({ color: ANCHOR_COLOR })
      .setLngLat([ANCHOR.lng, ANCHOR.lat])
      .setPopup(
        new maplibregl.Popup({ offset: 26 }).setDOMContent(
          popupNode(ANCHOR.name, "거점 — 후보까지의 거리·소요시간 기준점"),
        ),
      )
      .addTo(map);

    for (const cd of candidates) {
      new maplibregl.Marker({
        color: cd.isTarget ? PRIMARY : OTHER_CANDIDATE_COLOR,
        scale: cd.isTarget ? 1.15 : 0.8,
      })
        .setLngLat([cd.lng, cd.lat])
        .setPopup(
          new maplibregl.Popup({ offset: 26 }).setDOMContent(
            popupNode(
              cd.name,
              `${cd.category} · ${cd.isTarget ? "이번 제안 후보" : "같은 읍의 다른 후보"}`,
              cd.address,
            ),
          ),
        )
        .addTo(map);
    }

    return () => {
      window.clearTimeout(slowTimer);
      map.remove();
      mapRef.current = null;
    };
    // signature가 같으면 같은 카드의 같은 데이터라 지도를 다시 만들 이유가 없다 (위 주석).
    // props를 그대로 의존하면 승인 → revalidate 때마다 지도가 통째로 재생성된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const applyView = (next: View) => {
    setView(next);
    const map = mapRef.current;
    if (!map) return;
    if (next === "radius") {
      map.easeTo({ center: [center.lng, center.lat], zoom: 14.5, duration: 600 });
      return;
    }
    const bounds = new maplibregl.LngLatBounds([center.lng, center.lat], [center.lng, center.lat]);
    if (next === "anchor") {
      bounds.extend([ANCHOR.lng, ANCHOR.lat]);
    } else {
      for (const m of merchants) bounds.extend([m.lng, m.lat]);
      for (const cd of candidates) bounds.extend([cd.lng, cd.lat]);
    }
    map.fitBounds(bounds, { padding: 56, duration: 600 });
  };

  if (!webglOk) {
    return (
      <div className={`${MAP_BOX} flex flex-col items-center justify-center gap-1 px-4 text-center`}>
        <p className="text-sm font-medium text-admin-text">지도를 표시하지 못했습니다</p>
        <p className="break-keep text-xs leading-5 text-admin-text-muted">
          이 브라우저에서 지도 렌더가 지원되지 않습니다. 아래 “후보 상세” 표에 거점 거리와 반경 500m
          내 가맹점 수가 같은 근거로 담겨 있습니다.
        </p>
      </div>
    );
  }

  // 범례에는 이 읍에 실제로 있는 업종만 — 순서·색은 고정 팔레트 그대로 (13 §5)
  const present = CATEGORIES.filter((c) => merchants.some((m) => m.category === c));

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div ref={boxRef} className={MAP_BOX} />

      {slow ? (
        <p role="status" className="break-keep text-[11px] leading-4 text-admin-text-muted">
          지도가 늦게 뜨거나 표시되지 않으면 아래 “후보 상세” 표에서 같은 근거(거점 거리·반경 500m 내
          가맹점 수)를 확인할 수 있습니다.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {VIEWS.map((v) => (
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
