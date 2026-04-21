# ── Cardioplace v2 — local dev launcher ─────────────────────────────────────
#
# Run all three Node services, each in its own Windows terminal:
#   make dev
#
# Run all three interleaved in the current terminal (one window):
#   make dev-inline
#
# Run individual services:
#   make backend    # :4000
#   make frontend   # :3000
#   make admin      # :3001
#   make adk        # :50051
#
# Other:
#   make install        # npm install at root (installs all workspaces)
#   make stop           # kill anything bound to :3000/:3001/:4000
#   make restart        # stop + clean .next caches + dev
#   make docker-up      # docker compose up --build
#   make docker-down    # docker compose down

.PHONY: dev dev-inline adk backend frontend admin docker-up docker-down install stop restart

ROOT := $(CURDIR)

# ── Spawn one Windows terminal per service ──────────────────────────────────
# `make dev` opens three separate cmd windows so each service has its own
# scrollable log. Close the window to stop that service, or use `make stop`
# to kill all three at once.

dev:
	@echo "▶ Opening backend (:4000), frontend (:3000), admin (:3001) in 3 new terminals"
	powershell -Command "Start-Process cmd '/k cd /d $(ROOT) && npm run start:dev -w backend'"
	powershell -Command "Start-Process cmd '/k cd /d $(ROOT) && npm run dev -w frontend'"
	powershell -Command "Start-Process cmd '/k cd /d $(ROOT) && npm run dev -w admin'"
	@echo "▶ Three terminals launched. Use 'make stop' to kill them all."

# ── Run all three in the current terminal (interleaved output) ─────────────
# -j3 runs the three targets concurrently. Useful for CI or a single scrollback.
# Press Ctrl+C once to stop all (GNU make propagates SIGINT to children).

dev-inline:
	@echo "▶ Starting backend (:4000), frontend (:3000), admin (:3001) in this terminal"
	@echo "  Press Ctrl+C once to stop all three."
	@$(MAKE) -j3 --no-print-directory backend frontend admin

# ── Stop all services by port ──────────────────────────────────────────────
# Targets only processes bound to our dev ports — safer than killing every
# node.exe on the machine (which would take down VS Code's TypeScript server
# and other tooling).

stop:
	-powershell -Command "Get-NetTCPConnection -LocalPort 4000,3000,3001 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $$_ -Force -ErrorAction SilentlyContinue }"
	@echo "▶ Killed any process bound to :3000, :3001, :4000"

# ── Restart (stop + clean Next caches + dev) ───────────────────────────────

restart:
	$(MAKE) stop
	powershell -Command "if (Test-Path frontend/.next) { Remove-Item -Recurse -Force frontend/.next }"
	powershell -Command "if (Test-Path admin/.next) { Remove-Item -Recurse -Force admin/.next }"
	@echo "▶ Cleaned .next caches"
	$(MAKE) dev

# ── Individual service commands ────────────────────────────────────────────

backend:
	@echo "▶ Starting NestJS backend on :4000"
	npm run start:dev -w backend

frontend:
	@echo "▶ Starting Next.js patient frontend on :3000"
	npm run dev -w frontend

admin:
	@echo "▶ Starting Next.js admin app on :3001"
	npm run dev -w admin

adk:
	@echo "▶ Starting ADK voice service (Python gRPC) on :50051"
	cd adk-service && \
		[ -f .env ] || cp .env.example .env && \
		[ -d .venv ] || python -m venv .venv && \
		. .venv/bin/activate && \
		pip install -q -r requirements.txt && \
		python main.py

# ── Install all workspace dependencies ─────────────────────────────────────

install:
	@echo "▶ Installing all workspace dependencies from root (npm workspaces)"
	npm install
	@echo "▶ Creating Python venv + installing adk-service dependencies"
	cd adk-service && \
		[ -d .venv ] || python -m venv .venv && \
		. .venv/bin/activate && \
		pip install -r requirements.txt

# ── Docker commands ────────────────────────────────────────────────────────

docker-up:
	@echo "▶ Starting all services with Docker Compose"
	docker compose up --build

docker-down:
	docker compose down
