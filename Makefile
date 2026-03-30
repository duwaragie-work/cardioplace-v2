# ── Healplace Cardio — local dev launcher ────────────────────────────────────
#
# Three-terminal quick-start:
#   Terminal 1: make adk
#   Terminal 2: make backend
#   Terminal 3: make frontend
#
# Or run everything with Docker:
#   make docker-up

.PHONY: adk backend frontend docker-up docker-down install

# ── Individual service commands ───────────────────────────────────────────────

adk:
	@echo "▶ Starting ADK voice service (Python gRPC) on :50051"
	cd adk-service && \
		[ -f .env ] || cp .env.example .env && \
		[ -d .venv ] || python -m venv .venv && \
		. .venv/bin/activate && \
		pip install -q -r requirements.txt && \
		python main.py

backend:
	@echo "▶ Starting NestJS backend on :8080"
	cd backend && npm run start:dev

frontend:
	@echo "▶ Starting Next.js frontend on :3000"
	cd frontend && npm run dev

# ── Install all dependencies ──────────────────────────────────────────────────

install:
	@echo "▶ Installing backend dependencies"
	cd backend && npm install
	@echo "▶ Installing frontend dependencies"
	cd frontend && npm install
	@echo "▶ Creating Python venv + installing adk-service dependencies"
	cd adk-service && \
		[ -d .venv ] || python -m venv .venv && \
		. .venv/bin/activate && \
		pip install -r requirements.txt

# ── Docker commands ───────────────────────────────────────────────────────────

docker-up:
	@echo "▶ Starting all services with Docker Compose"
	docker compose up --build

docker-down:
	docker compose down
