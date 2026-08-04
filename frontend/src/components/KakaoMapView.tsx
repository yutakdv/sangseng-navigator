"use client";

import { useEffect, useRef, useState } from "react";
import type { Recommendation } from "@/types";

type KakaoLatLng = { getLat: () => number; getLng: () => number };

type KakaoMapInstance = {
  setBounds: (bounds: KakaoBounds, top?: number, right?: number, bottom?: number, left?: number) => void;
};

type KakaoBounds = { extend: (position: KakaoLatLng) => void };

type KakaoMarker = {
  setMap: (map: KakaoMapInstance | null) => void;
};

type KakaoInfoWindow = {
  open: (map: KakaoMapInstance, marker: KakaoMarker) => void;
  close: () => void;
};

type KakaoNamespace = {
  maps: {
    load: (callback: () => void) => void;
    LatLng: new (lat: number, lng: number) => KakaoLatLng;
    LatLngBounds: new () => KakaoBounds;
    Map: new (
      container: HTMLElement,
      options: { center: KakaoLatLng; level: number },
    ) => KakaoMapInstance;
    Marker: new (options: {
      map: KakaoMapInstance;
      position: KakaoLatLng;
      title?: string;
    }) => KakaoMarker;
    InfoWindow: new (options: { content: HTMLElement; removable?: boolean }) => KakaoInfoWindow;
    event: { addListener: (target: KakaoMarker, type: string, listener: () => void) => void };
  };
};

declare global {
  interface Window {
    kakao?: KakaoNamespace;
  }
}

let kakaoLoader: Promise<KakaoNamespace> | null = null;

function loadKakaoMaps(): Promise<KakaoNamespace> {
  const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
  if (!appKey) return Promise.reject(new Error("Kakao Maps JS 키가 없습니다."));
  if (typeof window === "undefined") return Promise.reject(new Error("브라우저에서만 지도를 불러올 수 있습니다."));
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
      existing.addEventListener("error", () => reject(new Error("Kakao Maps SDK를 불러오지 못했습니다.")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", () => reject(new Error("Kakao Maps SDK를 불러오지 못했습니다.")), {
      once: true,
    });
    document.head.appendChild(script);
  });

  return kakaoLoader;
}

function popupContent(merchant: Recommendation): HTMLElement {
  const root = document.createElement("div");
  root.className = "min-w-[170px] px-1 py-0.5 text-[12px] leading-5";
  const title = document.createElement("strong");
  title.className = "block text-[13px] text-slate-900";
  title.textContent = merchant.name;
  root.appendChild(title);
  const category = document.createElement("span");
  category.className = "block text-slate-600";
  category.textContent = merchant.category;
  root.appendChild(category);
  const address = document.createElement("span");
  address.className = "block text-slate-500";
  address.textContent = merchant.address;
  root.appendChild(address);
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

  useEffect(() => {
    let active = true;
    let map: KakaoMapInstance | null = null;
    const markers: KakaoMarker[] = [];
    let infoWindow: KakaoInfoWindow | null = null;

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
          const marker = new kakao.maps.Marker({ map: mapInstance, position, title: merchant.name });
          markers.push(marker);
          kakao.maps.event.addListener(marker, "click", () => {
            if (!map) return;
            infoWindow?.close();
            infoWindow = new kakao.maps.InfoWindow({ content: popupContent(merchant), removable: true });
            infoWindow.open(map, marker);
          });
        });

        if (points.length > 1) map.setBounds(bounds, 48, 48, 48, 48);
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
      infoWindow?.close();
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
  const visibleStatus = hasPoints ? status : "fallback";
  const visibleMessage = hasPoints ? message : "이 조건에는 지도에 표시할 가맹점이 없어요.";

  return (
    <section className="relative overflow-hidden rounded-[26px] bg-[#eaf4e8] ring-1 ring-inset ring-emerald-900/10">
      <div ref={containerRef} className="h-[300px] w-full sm:h-[360px]" aria-label="추천 가맹점 Kakao 지도" />
      {visibleStatus !== "ready" ? (
        <StaticMapFallback points={points} message={visibleMessage} />
      ) : null}
      <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm">
        {region ? `${region} 주변 추천 가맹점` : "하이원리조트 주변 추천 가맹점"}
      </div>
      <div className="pointer-events-none absolute bottom-4 left-4 flex flex-wrap gap-2 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm">
        <span>● 추천 가맹점 {recommendations.length}곳</span>
        <span className="text-slate-400">·</span>
        <span>● 하이원포인트 사용 가능</span>
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
