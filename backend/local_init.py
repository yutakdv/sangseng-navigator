"""DynamoDB Local에 cards 테이블 생성 (호스트에서: DYNAMO_ENDPOINT=http://localhost:8001 python local_init.py)"""
import os
import boto3

ddb = boto3.resource("dynamodb", endpoint_url=os.environ.get("DYNAMO_ENDPOINT", "http://localhost:8001"),
                     region_name="ap-northeast-2",
                     aws_access_key_id="local", aws_secret_access_key="local")
name = os.environ.get("CARDS_TABLE") or "sangseng-cards"   # 빈 문자열 방어 — db.py 와 동일
if name not in [t.name for t in ddb.tables.all()]:
    ddb.create_table(TableName=name, KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
                     AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
                     BillingMode="PAY_PER_REQUEST").wait_until_exists()
    print(f"created: {name}")
else:
    print(f"exists: {name}")
