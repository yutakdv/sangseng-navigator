import { PageSkeleton } from "@/components/PageSkeleton";

/** 목록·표 중심 담당자 화면의 로딩 스켈레톤 — 본문 폭 max-w-6xl 기준 (허브만 1600px) */
export default function Loading() {
  return <PageSkeleton variant="page" />;
}
