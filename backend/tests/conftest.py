"""테스트 공통 환경 — **어떤 테스트 모듈보다 먼저** 실행되어야 하는 설정만 둔다.

pytest는 테스트 모듈을 import하기 전에 conftest.py를 읽는다. 그 순서가 여기서 핵심이다.

`app/db.py`는 import 시점에 `boto3.resource(...).Table(...)`을 만드는데, boto3는 **클라이언트를
만들 때 자격증명을 한 번 해석하고 그 결과를 세션에 캐시한다**. 그래서 자격증명 환경변수를
테스트 모듈 안에서 설정하면 이미 늦을 수 있다 — 알파벳 순으로 먼저 수집되는 모듈이
`app.db`를 간접적으로 import해 버리면(예: `test_algorithms.py` → `app.services.cardgen` →
`app.db`), 그 시점에 자격증명이 없다고 해석된 값이 캐시되어 이후 모든 DynamoDB 호출이
`NoCredentialsError`로 실패한다.

로컬에서는 개발자 머신에 `~/.aws/credentials`가 있어 해석이 성공하므로 이 문제가 보이지 않고,
자격증명이 없는 CI에서만 드러난다 — 그래서 모듈별 `setdefault` 복붙으로는 막을 수 없다.
DynamoDB Local은 자격증명의 **형식**만 요구하므로 더미 값이면 충분하다.
"""
import os

os.environ.setdefault("AWS_ACCESS_KEY_ID", "local")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "local")
os.environ.setdefault("AWS_DEFAULT_REGION", "ap-northeast-2")
# `.env`의 빈 값이 테이블명을 덮지 않도록 선점한다 (db.py의 `or` 기본값과 같은 이름).
os.environ.setdefault("CARDS_TABLE", "sangseng-cards")
os.environ.setdefault("MUTATION_API_TOKEN", "local-test-mutation-token")
