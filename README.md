# HomePulse

> 홈/개인 인프라 관제 대시보드 + 실시간 알림 시스템

집이나 소규모 환경의 네트워크 장비(공유기, NAS, IP카메라, 서버 등)를 24/7 모니터링하고, 장애 발생 시 즉시 텔레그램으로 알림을 받을 수 있는 경량 관제 시스템입니다.

![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## 주요 기능

### 🔍 다중 프로토콜 헬스체크
- **HTTP 체크**: 웹 서비스 응답 상태 코드 검증
- **TCP 체크**: 포트 연결 가능 여부 확인
- 커스텀 타임아웃 설정 지원
- 60초 주기 자동 체크 (설정 변경 가능)

### 🚨 실시간 알림 시스템
- **상태 변화 감지**: DOWN/UP 이벤트만 알림 (중복 알림 방지)
- **텔레그램 연동**: 즉시 모바일 푸시 알림
- 장애 발생 시각, 복구 시각 포함

### 📊 웹 대시보드
- 전체 장비 상태 한눈에 확인 (UP/DOWN)
- 최근 이벤트 로그 조회
- 마지막 체크 시간 및 응답 메시지 표시
- 반응형 UI (모바일 지원)

### 💾 운영 안정성
- **SQLite WAL 모드**: 동시 읽기/쓰기 성능 최적화
- **이벤트 로깅**: 모든 상태 변화 이력 저장
- **Docker 지원**: `restart: unless-stopped`로 자동 재시작
- **Graceful 알림 실패 처리**: 알림 실패가 서비스 중단으로 이어지지 않음

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                        HomePulse                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Monitor   │───▶│   Checks    │───▶│   Notify    │     │
│  │  (Cron 60s) │    │ (HTTP/TCP)  │    │ (Telegram)  │     │
│  └──────┬──────┘    └─────────────┘    └─────────────┘     │
│         │                                                   │
│         ▼                                                   │
│  ┌─────────────┐    ┌─────────────┐                        │
│  │     DB      │◀───│   Server    │◀─── HTTP :8787        │
│  │  (SQLite)   │    │  (Express)  │                        │
│  └─────────────┘    └─────────────┘                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│     Router      │  │       NAS       │  │    IP Camera    │
│  192.168.0.1    │  │  192.168.0.10   │  │  192.168.0.20   │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## 기술 스택

| 영역 | 기술 | 선택 이유 |
|------|------|-----------|
| Runtime | Node.js 20+ | 비동기 I/O, 네트워크 작업에 적합 |
| Framework | Express | 경량 웹 서버, 빠른 API 구축 |
| Database | SQLite (better-sqlite3) | 서버리스, WAL 모드로 동시성 확보 |
| Scheduler | setInterval | 외부 의존성 없이 주기적 실행 |
| Notification | Telegram Bot API | 무료, 즉시 푸시, 모바일 지원 |
| Container | Docker + Compose | 일관된 배포 환경, 자동 재시작 |

---

## 빠른 시작

### 1. 저장소 클론

```bash
git clone https://github.com/onedayonepaper/homepulse.git
cd homepulse
```

### 2. 환경 변수 설정

```bash
cp .env.example .env
```

`.env` 파일 수정:
```env
PORT=8787
CHECK_INTERVAL_SEC=60

# 텔레그램 설정 (선택사항 - 없어도 대시보드는 동작)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### 3. 모니터링 대상 설정

`devices.json` 수정:
```json
[
  {
    "id": "router",
    "name": "공유기",
    "type": "tcp",
    "host": "192.168.0.1",
    "port": 80,
    "timeoutMs": 1200
  },
  {
    "id": "nas",
    "name": "Synology NAS",
    "type": "http",
    "url": "http://192.168.0.10:5000",
    "timeoutMs": 2000
  }
]
```

### 4. 실행

**Docker (권장)**
```bash
docker compose up -d --build
```

**로컬 실행**
```bash
npm install
DB_PATH=./data/homepulse.sqlite npm start
```

### 5. 접속

- 대시보드: http://localhost:8787
- API - 상태: http://localhost:8787/api/status
- API - 이벤트: http://localhost:8787/api/events

---

## 설정 가이드

### devices.json 스키마

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `id` | string | ✅ | 고유 식별자 |
| `name` | string | ✅ | 표시 이름 |
| `type` | string | ✅ | `http` 또는 `tcp` |
| `host` | string | TCP만 | 대상 호스트/IP |
| `port` | number | TCP만 | 대상 포트 |
| `url` | string | HTTP만 | 전체 URL |
| `timeoutMs` | number | ❌ | 타임아웃 (기본: 1200ms) |

### 텔레그램 봇 설정

1. [@BotFather](https://t.me/BotFather)에서 `/newbot` 명령으로 봇 생성
2. 발급받은 토큰을 `TELEGRAM_BOT_TOKEN`에 입력
3. 생성된 봇에게 아무 메시지나 전송
4. 브라우저에서 `https://api.telegram.org/bot<TOKEN>/getUpdates` 접속
5. 응답의 `chat.id` 값을 `TELEGRAM_CHAT_ID`에 입력

---

## API 명세

### GET /api/status

현재 모든 장비의 상태를 반환합니다.

**Response**
```json
{
  "devices": [
    {
      "id": "router",
      "name": "공유기",
      "is_up": 1,
      "last_change_ts": 1706540400,
      "last_check_ts": 1706540460,
      "last_message": "TCP 192.168.0.1:80 OK"
    }
  ]
}
```

### GET /api/events

최근 상태 변화 이벤트를 반환합니다 (최대 50개).

**Response**
```json
{
  "events": [
    {
      "id": 1,
      "device_id": "nas",
      "device_name": "NAS",
      "type": "DOWN",
      "message": "TCP timeout",
      "ts": 1706540400
    }
  ]
}
```

---

## 프로젝트 구조

```
homepulse/
├── src/
│   ├── server.js      # Express 서버 + 대시보드 렌더링
│   ├── monitor.js     # 모니터링 스케줄러 + 상태 변화 감지
│   ├── checks.js      # HTTP/TCP 헬스체크 구현
│   ├── db.js          # SQLite 스키마 + CRUD 함수
│   └── notify.js      # 텔레그램 알림 전송
├── data/              # SQLite DB 파일 저장 (gitignore)
├── devices.json       # 모니터링 대상 설정
├── docker-compose.yml
├── Dockerfile
├── package.json
├── .env.example
└── .gitignore
```

---

## 핵심 구현 포인트

### 1. 상태 변화 감지 로직

```javascript
// monitor.js
const changed = prevUp === null || prevUp !== isUp;

if (changed) {
  // 이벤트 기록 + 알림 발송
  // 동일 상태 유지 시에는 알림하지 않음 (알림 피로 방지)
}
```

### 2. TCP 연결 체크

```javascript
// checks.js
socket.once("connect", () => finish(true, "OK"));
socket.once("timeout", () => finish(false, "timeout"));
socket.once("error", (e) => finish(false, e.code));
```

### 3. SQLite WAL 모드

```javascript
// db.js
db.exec(`PRAGMA journal_mode = WAL;`);
// 읽기/쓰기 동시 수행 가능, 크래시 복구 향상
```

### 4. Graceful 알림 실패 처리

```javascript
// notify.js
try {
  await fetch(telegramUrl, { ... });
} catch {
  // 알림 실패는 조용히 넘어감
  // 모니터링 서비스 자체는 중단되지 않음
}
```

---

## 운영 가이드

### 로그 확인
```bash
docker logs -f homepulse
```

### 장비 추가/수정
1. `devices.json` 수정
2. 컨테이너 재시작: `docker compose restart`

### 데이터 백업
```bash
cp ./data/homepulse.sqlite ./backup/
```

### 모니터링 주기 변경
`.env`에서 `CHECK_INTERVAL_SEC` 값 수정 후 재시작

---

## 확장 아이디어

- [ ] ICMP Ping 체크 추가
- [ ] 슬랙/디스코드 알림 연동
- [ ] 일일 요약 리포트 발송
- [ ] 응답 시간 그래프 (시계열 데이터)
- [ ] 다중 사용자 지원 + 인증
- [ ] Prometheus 메트릭 엔드포인트

---

## 라이선스

MIT License

---

## 기여

이슈와 PR을 환영합니다.
