import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { PrivacyBadge, ProxyBadge } from "@/components/Badge";
import { DashboardToc } from "@/components/DashboardToc";
import { DatasetCatalog } from "@/components/data/DatasetCatalog";
import { Icon } from "@/components/Icon";
import { MenuDemoGuide } from "@/components/MenuDemoGuide";
import { PageHeader } from "@/components/PageHeader";
import { GroupHeading, Section } from "@/components/Section";
import { api, manifest } from "@/lib/api";
import { ASSUMPTION_NOTE, PROXY_NOTE, STABILITY_NOTE } from "@/lib/constants";
import { num } from "@/lib/format";

export const metadata: Metadata = { title: "데이터 활용 정보 · 상생 나침반" };

// 기준월·비공개 내역이 산출물과 함께 움직이므로 캐시하지 않는다
export const dynamic = "force-dynamic";

const TOC = [
  { id: "catalog", label: "공공데이터 6종" },
  { id: "integrity", label: "산출 버전" },
  { id: "privacy", label: "소표본 보호" },
  { id: "definitions", label: "지표 정의" },
  { id: "attribution", label: "외부 서비스" },
];

/**
 * 데이터 활용 정보 — 이 서비스가 무엇으로 계산했는지 확인하는 **정본 한 곳**.
 *
 * 흩어져 있던 출처 표기를 여기로 모으되, **화면 옆 인라인 고지는 걷어내지 않는다**:
 * `근사 지표`(절대 규칙 2)·`가정 기반 전망`(절대 규칙 3)·소표본 보호 배지는 숫자에서
 * 떼어내는 순간 규칙 위반이고, 푸터의 OpenStreetMap 표기는 라이선스 의무다.
 * 그래서 구조는 "허브 + 스포크"다 — 화면에서는 짧게 고지하고, 각 배지가 이 페이지의
 * 해당 섹션(#definitions·#privacy)으로 링크해 자세한 근거를 여기서 한 번만 말한다.
 *
 * 이 화면에 옮겨 온 것:
 *   - 전체 지역 현황의 `데이터 관리 · 출처와 기준` 섹션(기준월 + 비공개 처리 내역)
 *   - 정책 나침반 허브의 `데이터 원천 · 공공데이터 6종` 목록
 * 이 화면에서 새로 밝히는 것:
 *   - 데이터셋별 원본 규모·실제 사용 컬럼·산출물·사용 화면 (docs/plan/21 §심사 대응표가 요구하는 표)
 *   - 산출물 매니페스트(dataset_version·generated_at·파일별 sha256) — 재현 가능성 근거
 *
 * 서버 컴포넌트다. 카탈로그 본문은 상수라 별도 파일(components/data/DatasetCatalog)에 둔다.
 */
export default async function DataPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const sp = await searchParams;
  const demo = sp.demo === "data";

  // 원장이 실패해도 카탈로그·매니페스트·지표 정의는 성립한다 — 소표본 고지만 폴백된다
  const [d, usageLedger] = await Promise.all([
    api.dashboard(),
    api.usageMonthly().catch(() => null),
  ]);

  // 원장 쪽 값이 정본이고, 구형 산출물에는 아예 없을 수 있어 둘 다 가드한다
  const privacy = usageLedger?.privacy_meta ?? d.privacy_meta ?? null;
  const mf = manifest();
  const files = Object.entries(mf.files).sort(([a], [b]) => a.localeCompare(b));
  const totalBytes = files.reduce((sum, [, f]) => sum + f.bytes, 0);

  return (
    <AdminShell dashboard={d}>
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <PageHeader
          icon="database"
          eyebrow="데이터 활용"
          title="데이터 활용 정보"
          lede="이 서비스의 모든 숫자가 어느 공공데이터에서, 어느 시점 기준으로, 어떤 계산을 거쳐 나왔는지 한곳에서 확인합니다. 원본을 수정·적재하는 기능이 아니라 검증용 조회 화면입니다."
        >
          <p className="u-note mt-2 flex flex-wrap items-center gap-x-2">
            <Icon name="database" size={13} />
            데이터 기준 {d.period_note} · 산출일 {d.updated_at} · 데이터 버전 {mf.dataset_version}
          </p>
        </PageHeader>

        {demo ? (
          <MenuDemoGuide
            icon="database"
            title="데이터 활용 데모"
            description={`현재 화면은 ${d.period_note} 데이터를 기준으로 그려집니다. 원천 파일을 바꾸는 대신, 어떤 데이터가 의사결정에 쓰였는지 확인합니다.`}
            steps={[
              "공공데이터 6종의 출처와 실제 사용 컬럼을 확인합니다.",
              "산출 버전·체크섬으로 화면의 숫자가 어느 스냅샷에서 나왔는지 대조합니다.",
              "소표본 보호로 비공개 처리된 셀과 그 이유를 확인합니다.",
            ]}
          />
        ) : null}

        <DashboardToc items={TOC} />

        {/* ══ ① 공공데이터 6종 카탈로그 ══ */}
        <section id="catalog" aria-label="공공데이터 6종" className="flex scroll-mt-32 flex-col gap-6">
          <GroupHeading note="원본 규모·실제 사용 컬럼·산출물·사용 화면을 데이터셋마다 밝힌다">
            공공데이터 6종
          </GroupHeading>
          <DatasetCatalog />
        </section>

        {/* ══ ② 산출 버전과 무결성 ══ */}
        <section id="integrity" aria-label="산출 버전과 무결성" className="flex scroll-mt-32 flex-col gap-6">
          <GroupHeading note="화면의 숫자가 어느 스냅샷에서 나왔는지 — 재현 가능성 근거">
            산출 버전과 무결성
          </GroupHeading>
          <Section
            icon="shield"
            title="파이프라인 산출물 매니페스트"
            desc="원본을 내려받아 pipeline/run_all.py를 돌리면 같은 산출물이 나오는지 대조할 수 있도록, 산출 시점과 파일별 SHA-256을 그대로 싣는다. 화면이 읽는 파일은 모두 이 목록 안에 있다."
          >
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-admin-surface-sunken px-3.5 py-3">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-admin-text-muted">
                  데이터 버전
                </dt>
                <dd className="mt-1 break-all font-mono text-[13px] font-semibold text-admin-text">
                  {mf.dataset_version}
                </dd>
              </div>
              <div className="rounded-xl bg-admin-surface-sunken px-3.5 py-3">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-admin-text-muted">
                  기준월
                </dt>
                <dd className="mt-1 text-[13px] font-semibold text-admin-text">{mf.base_month}</dd>
              </div>
              <div className="rounded-xl bg-admin-surface-sunken px-3.5 py-3">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-admin-text-muted">
                  산출 시각 (UTC)
                </dt>
                <dd className="mt-1 text-[13px] font-semibold text-admin-text">{mf.generated_at}</dd>
              </div>
            </dl>

            <div className="u-scroll-x mt-4">
              <table className="u-table min-w-[560px]">
                <thead>
                  <tr>
                    <th scope="col">산출 파일</th>
                    <th scope="col" className="text-right">크기</th>
                    <th scope="col">SHA-256</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map(([name, f]) => (
                    <tr key={name}>
                      <td className="font-mono text-[12px] font-medium">{name}</td>
                      <td className="text-right tabular-nums text-admin-text-muted">
                        {num(Math.round(f.bytes / 1024))} KB
                      </td>
                      <td
                        className="font-mono text-[11px] text-admin-text-muted"
                        title={f.sha256}
                      >
                        {f.sha256.slice(0, 16)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="u-note mt-3 border-t border-admin-border pt-2.5">
              산출물 {files.length}종 합계 {num(Math.round(totalBytes / 1024))} KB. 해시는 앞 16자만
              표시하며 전체 값은 각 행에 마우스를 올리면 보입니다. 검증:{" "}
              <code className="rounded bg-admin-surface-sunken px-1 py-0.5 font-mono text-[11px]">
                shasum -a 256 data/processed/&lt;파일&gt;
              </code>
            </p>
          </Section>
        </section>

        {/* ══ ③ 소표본 보호 — 전체 지역 현황(#data-demo)에서 이관 ══ */}
        <section id="privacy" aria-label="소표본 보호" className="flex scroll-mt-32 flex-col gap-6">
          <GroupHeading note="무엇을 왜 감췄는지 화면이 직접 밝히는 자리">소표본 보호</GroupHeading>
          <Section
            icon="shield"
            title="비공개 처리 내역"
            badge={privacy ? <PrivacyBadge note={privacy.note} k={privacy.k} /> : null}
            desc="억제 사실을 숨기면 '데이터가 없다'와 구분되지 않아, 개인정보 보호 설계가 오히려 결함처럼 읽힌다. 감춘 칸과 이유를 그대로 싣는다."
          >
            {privacy ? (
              <>
                <p className="break-keep text-[15px] leading-7 text-admin-text">{privacy.note}</p>
                <p className="u-note mt-3">
                  가맹점 {privacy.k}곳 미만인 (지역 × 업종) 칸은 건수를 그대로 내보내면 개별 사업자의
                  매출이 역산될 수 있어 값을 비웁니다. 화면은 이 칸을 0으로 그리지 않고 비공개로
                  표기하며, 영향받는 지역의 합계는 {privacy.aggregate_rounding.unit} 단위로 반올림해
                  발행합니다. 비율·순위·스코어는 반올림 전 원값으로 계산합니다.
                </p>
                <h3 className="u-h3 mt-4">
                  비공개 셀 {privacy.suppressed_cells.length}개
                </h3>
                {privacy.suppressed_cells.length ? (
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-admin-text-soft">
                    {privacy.suppressed_cells.map((c) => (
                      <li key={`${c.eup}-${c.category}`} className="flex items-baseline gap-1.5">
                        <Icon name="shield" size={12} />
                        <span>
                          {c.eup} {c.category} — 건수 비공개
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="u-note mt-2">현재 기준월에 비공개 처리된 셀은 없습니다.</p>
                )}
                <p className="u-note mt-3 border-t border-admin-border pt-2.5">
                  이 처리는 파이프라인 <code className="font-mono">p10_privacy.py</code>가 산출 단계에서
                  적용하므로, 화면이 감추는 것이 아니라 발행되는 데이터 자체에 값이 없습니다.
                </p>
              </>
            ) : (
              <p className="u-note">현재 산출물에 소표본 보호 메타가 없습니다.</p>
            )}
          </Section>
        </section>

        {/* ══ ④ 지표 정의와 주의 — 화면 배지들이 링크로 가리키는 자리 ══ */}
        <section id="definitions" aria-label="지표 정의와 주의" className="flex scroll-mt-32 flex-col gap-6">
          <GroupHeading note="화면 곳곳의 고지 배지가 무엇을 뜻하는지 — 정의는 여기 한 곳에만 둔다">
            지표 정의와 주의
          </GroupHeading>

          <Section
            id="proxy"
            icon="info"
            title="근사 지표 — 지역 전환율"
            badge={<ProxyBadge note={PROXY_NOTE} />}
            desc="지역 전환율을 표시하는 모든 화면에는 이 배지가 함께 붙는다."
          >
            <p className="break-keep text-[15px] leading-7 text-admin-text">{PROXY_NOTE}</p>
            <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-admin-surface-sunken px-3.5 py-3">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-admin-text-muted">
                  분자
                </dt>
                <dd className="mt-1 text-[13px] text-admin-text">
                  하이원포인트 지역 사용 <b>건수</b> (하이원포인트 사용현황 CSV)
                </dd>
              </div>
              <div className="rounded-xl bg-admin-surface-sunken px-3.5 py-3">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-admin-text-muted">
                  분모
                </dt>
                <dd className="mt-1 text-[13px] text-admin-text">
                  입장 <b>연인원</b> — 1·2·3부 교대 합산 (일자별 카지노 입장객 API)
                </dd>
              </div>
            </dl>
            <p className="u-note mt-3">
              단위가 다르므로 비율이 아니라 <b>연인원 1인당 건수</b>다. 강원랜드가 공개한 금액 기준
              지역 사용 비율(2024년 29.4%, 지속가능경영보고서 공표치)과는 산출 근거가 다른 별개
              지표이므로 서로 대체하거나 비교하지 않는다.
            </p>
          </Section>

          <Section
            id="assumption"
            icon="warn"
            title="가정 기반 전망"
            desc="시뮬레이션 출력(가맹 전환 시 예상 효과, 페이백 시나리오)에 고정으로 붙는 문구다."
          >
            <p className="break-keep text-[15px] leading-7 text-admin-text">
              “{ASSUMPTION_NOTE}”
            </p>
            <p className="u-note mt-3">
              관측된 과거 값이 아니라 가정을 넣어 계산한 값이라는 뜻이다. 원천 데이터에 금액 필드가
              없어 예산·ROI는 산출하지 않으며, 페이백 효과도 금액이 아니라 지역 전환율 정의를 뒤집은
              <b> 건수 환산</b>으로만 표시한다 — 새 가정을 더하지 않는 유일한 방법이기 때문이다.
              AI가 만든 문장 역시 제안일 뿐이며, 담당자 승인을 거쳐야 카드가 확정된다.
            </p>
          </Section>

          <Section
            id="stability"
            icon="shield"
            title="추천 순위 안정도"
            desc="민감도 실측값이다 — 미래를 내다본 전망이 아니므로 가정 기반 전망 배지의 대상이 아니다."
          >
            <p className="break-keep text-[15px] leading-7 text-admin-text">{STABILITY_NOTE}</p>
            <p className="u-note mt-3">
              산출: 파이프라인 <code className="font-mono">p8_sensitivity.py</code>가 가중치 조합
              95개를 전수 재계산한 결과(<code className="font-mono">sensitivity.json</code>).
            </p>
          </Section>

          <Section
            icon="target"
            title="지역 소비 집중도 · 업종별 소비 분산도"
            desc="둘 다 0~100 지수로 환산해 표시한다."
          >
            <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-7 text-admin-text">
              <li>
                <b>지역 소비 집중도</b> — 값이 높을수록 특정 지역에 소비가 몰려 있다. 6개 지역의
                사용 건수 분포가 얼마나 치우쳤는지를 0~100으로 환산한 값이다.
              </li>
              <li>
                <b>업종별 소비 분산도</b> — 값이 높을수록 업종이 고르게 분산돼 있다. 표시 6분류의
                점유 분포를 0~100으로 환산한 값이다.
              </li>
            </ul>
            <p className="u-note mt-3">
              두 지수 모두 파이프라인 <code className="font-mono">p5_metrics.py</code>가 산출하며,
              산식 정본은 <code className="font-mono">pipeline/common.py</code>의 상수다.
            </p>
          </Section>

          <Section
            icon="pin"
            title="지역 구분의 정의"
            desc="같은 이름이라도 이 서비스에서 가리키는 범위가 행정구역과 다를 수 있다."
          >
            <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-7 text-admin-text">
              <li>
                <b>삼척시</b> — 시 전역이 아니라 하이원포인트 지역가맹 대상지역인 <b>도계읍</b> 기준이다.
              </li>
              <li>
                <b>정선군</b> — 고한읍·사북읍을 <b>제외한 잔여 지역</b> 기준이다. 두 읍은 각각 별도
                지역으로 집계하므로 정선군 값에 포함되지 않는다.
              </li>
            </ul>
          </Section>
        </section>

        {/* ══ ⑤ 외부 서비스 표기 ══ */}
        <section id="attribution" aria-label="외부 서비스 표기" className="flex scroll-mt-32 flex-col gap-6">
          <GroupHeading note="라이선스상 표기 의무가 있는 항목 — 각 화면 푸터에도 함께 싣는다">
            외부 서비스 표기
          </GroupHeading>
          <Section
            icon="map"
            title="지도 · 외부 서비스"
            desc="담당자 화면과 방문객 위젯이 서로 다른 지도를 쓰므로 표기도 나뉜다."
          >
            <dl className="flex flex-col gap-3">
              <div className="rounded-xl border border-admin-border p-3.5">
                <dt className="text-[13px] font-bold text-admin-text">담당자 화면 지도</dt>
                <dd className="u-note mt-1">© OpenStreetMap contributors · OpenFreeMap</dd>
              </div>
              <div className="rounded-xl border border-admin-border p-3.5">
                <dt className="text-[13px] font-bold text-admin-text">방문객 위젯 지도</dt>
                <dd className="u-note mt-1">© Kakao Maps (Kakao Maps JavaScript SDK)</dd>
              </div>
              <div className="rounded-xl border border-admin-border p-3.5">
                <dt className="text-[13px] font-bold text-admin-text">지오코딩 (주소 → 좌표)</dt>
                <dd className="u-note mt-1">
                  Kakao 로컬 REST API (폴백: 국토교통부 VWorld) — 파이프라인 단계에서만 호출하며 결과는
                  <code className="ml-1 font-mono">merchants.json</code>에 좌표로 고정된다.
                </dd>
              </div>
            </dl>
            <p className="u-note mt-3 border-t border-admin-border pt-2.5">
              방문객이 보는 화면의 출처 표기는{" "}
              <Link href="/widget" className="font-semibold text-admin-primary underline-offset-4 hover:underline">
                방문객 위젯
              </Link>{" "}
              푸터에서 확인할 수 있습니다.
            </p>
          </Section>
        </section>
      </div>
    </AdminShell>
  );
}
