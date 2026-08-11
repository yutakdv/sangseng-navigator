"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * 목록 한 줄의 **선택 버튼** — 마스터-디테일의 마스터 쪽.
 *
 * 누르면 페이지를 옮기지 않고 `?selected=<id>`만 갈아 끼운다. 서버가 그 쿼리를 읽어
 * 좌측 미리보기를 다시 그리므로, 목록·미리보기 렌더링은 전부 서버 컴포넌트로 남는다 —
 * 이 파일이 허브에서 유일하게 상태를 만지는 조각이다.
 *
 * `router.replace`를 쓰는 이유는 두 가지다. 미리보기를 훑는 동작이 뒤로 가기 기록을
 * 수십 개 쌓으면 안 되고, `scroll: false`로 현재 스크롤 위치를 지켜야 목록을 계속 훑을 수
 * 있기 때문이다. 이동 대상 쿼리는 서버가 만들어 문자열로 내려준다(종류 필터 `?type=`이
 * 걸려 있으면 함께 보존해야 하는데, 그 판단은 서버가 이미 하고 있다).
 *
 * 상세 페이지로 가는 길은 좌측 카드의 "근거·전망 검토하기" 버튼 하나뿐이다.
 */
export function SelectRow({
  href,
  selected,
  label,
  children,
}: {
  /** 서버가 만든 `?type=…&selected=…` 쿼리 문자열 */
  href: string;
  selected: boolean;
  /** 스크린리더용 — 무엇을 미리보는 버튼인지 */
  label: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-busy={pending || undefined}
      aria-label={`${label} 왼쪽에서 미리보기`}
      onClick={() => startTransition(() => router.replace(href, { scroll: false }))}
      className={`group flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors ${
        selected
          ? // 면(라벤더 배경) + 우측 체크로 선택을 알린다 — 면 위에 세로선을 겹치지 않는다 (13 §6-1)
            "bg-lavender-100"
          : "hover:bg-lavender-50"
      } ${pending ? "opacity-70" : ""}`}
    >
      {children}
    </button>
  );
}
