FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
# uvicorn은 requirements.txt(=Lambda 번들)에 없으므로 이미지에서만 따로 설치한다 (07 의존성 원칙)
RUN pip install --no-cache-dir -r requirements.txt uvicorn
COPY app ./app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
