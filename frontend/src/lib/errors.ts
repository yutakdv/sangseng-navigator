/**
 * API 에러 — 상태코드를 살려 나른다 (docs/plan/08 F3).
 *
 * 비2xx를 전부 같은 `Error`로 뭉뚱그리면 호출부가 **409를 구분하지 못한다**.
 * 409는 장애가 아니라 정상적인 도메인 신호이므로(전 후보가 추진중/완료, 잘못된 상태 전이 — 05 §8)
 * 에러 화면이 아니라 안내 문구로 다뤄야 한다.
 *
 * `lib/api.ts`가 던진다. 호출부가 lib/api를 통하지 않고도 이 타입만 import 할 수 있게 별도 파일로 뺐다.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}
