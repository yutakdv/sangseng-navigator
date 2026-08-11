/**
 * 현재 담당자 — 사이드바 계정 칸과 허브 인사말이 공유하는 **단일 출처**.
 *
 * 화면마다 이름을 직접 적어 두면 로그인을 붙일 때 고쳐야 할 자리가 흩어진다. 지금은
 * 인증 연동 전이라 환경변수를 먼저 보고, 없으면 데모 시드 값을 쓴다. 실제 연동 시
 * 이 파일이 세션에서 읽도록 바꾸면 이름을 쓰는 화면이 전부 함께 따라온다.
 *
 * `NEXT_PUBLIC_` 접두사라 브라우저에도 실린다 — 표시용 이름이라 민감 정보가 아니다.
 * 값이 비어 있으면 역할 이름으로 폴백해 인사말이 "님"만 남는 일이 없게 한다.
 */
const DEMO_NAME = "홍길동";
const DEMO_TEAM = "지역상생팀";
/** 이름을 어디서도 얻지 못했을 때 쓰는 역할 이름 */
const FALLBACK_NAME = "담당자";
/**
 * 결정 감사 기록에 남는 담당자 식별자의 기본값.
 *
 * 이름과 달리 표시용이 아니라 **기록의 키**라, 이름을 바꿔도 같은 사람의 결정이 갈라지지 않도록
 * 따로 둔다. 계정 체계가 없어 이 값은 화면이 보내는 **자기신고 값**이며, 서버가
 * `verified: false`·공유 토큰 인증과 함께 저장해 검증되지 않았음을 명시한다 —
 * 그러니 FE가 이 값을 검증된 신원처럼 다루지 않는다.
 */
const DEMO_ID = "operator.demo";

const clean = (value: string | undefined): string => (value ?? "").trim();

/** 환경변수 → 데모 시드 순. 둘 다 비면 빈 문자열이고, 그 처리는 아래에서 갈린다 */
const resolvedName = clean(process.env.NEXT_PUBLIC_OPERATOR_NAME) || clean(DEMO_NAME);

export const operator = {
  /** 결정 요청의 actor_id — 비어 있으면 서버가 422를 내므로 기본값을 반드시 남긴다 */
  id: clean(process.env.NEXT_PUBLIC_OPERATOR_ID) || DEMO_ID,
  name: resolvedName || FALLBACK_NAME,
  team: clean(process.env.NEXT_PUBLIC_OPERATOR_TEAM) || clean(DEMO_TEAM),
};

/**
 * 허브 인사말 — "홍길동 담당자님". 팀명은 넣지 않는다 (길고 딱딱해진다).
 * 이름을 얻지 못하면 "담당자 담당자님"이 되지 않도록 역할 이름만 남긴다.
 */
export const operatorGreeting = resolvedName ? `${resolvedName} 담당자님` : `${FALLBACK_NAME}님`;

/** 사이드바 아바타의 한 글자 */
export const operatorInitial = operator.name.slice(0, 1);
