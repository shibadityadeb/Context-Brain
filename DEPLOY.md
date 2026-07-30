# Deploying Company Brain to a VPS (test deployment)

A single-VPS, Docker-Compose deployment of the whole stack — infrastructure
(Postgres, Redis, Qdrant, MinIO, Temporal) plus every app service (API, web, and
the four workers), all built from one image.

> This is a **test** deployment topology: everything runs on one host with
> Compose. It is not hardened for production scale (no HA, no managed data
> stores, no secrets manager). Good enough to share a live instance.

## What runs

| Service                              | Port     | Purpose                          |
| ------------------------------------ | -------- | -------------------------------- |
| web                                  | 3000     | Next.js dashboard                |
| api                                  | 4000     | Fastify API + `/health`, `/docs` |
| worker                               | —        | BullMQ jobs                      |
| temporal-worker                      | 4100¹    | Workflow/activity host           |
| connector-worker                     | 4101¹    | Google sync workflows            |
| meeting-worker                       | 4102¹    | Meeting orchestration            |
| postgres/redis/qdrant/minio/temporal | internal | data + workflow infra            |

¹ Worker health ports are internal to the compose network; only **3000** and
**4000** are published to the host.

## 1. Prerequisites

- A Linux VPS (Ubuntu 22.04+), **2 vCPU / 8 GB RAM recommended** (4 GB minimum —
  the local embeddings model and Temporal are the memory hogs), ~20 GB disk.
- Docker Engine + Compose v2:
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```
- Ports 3000 and 4000 open in the firewall (or only 80/443 if you put a reverse
  proxy in front — see step 6).

## 2. Get the code

```bash
git clone https://github.com/shibadityadeb/Context-Brain.git
cd Context-Brain
```

## 3. Configure the environment

```bash
cp .env.deploy.example .env
# Generate strong secrets:
echo "JWT_ACCESS_SECRET=$(openssl rand -hex 32)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
echo "COOKIE_SECRET=$(openssl rand -hex 32)"
echo "TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)"
```

Edit `.env` and set at least:

- `PUBLIC_API_URL`, `WEB_APP_URL`, `API_CORS_ORIGINS` — your VPS IP or domain.
- The four secrets + `POSTGRES_PASSWORD`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` (step 5).

> `PUBLIC_API_URL` is **baked into the web bundle at build time**. If you change
> it later, rebuild the web image (step 7).

## 4. Build and start

```bash
docker compose -f infrastructure/docker/docker-compose.deploy.yml build
docker compose -f infrastructure/docker/docker-compose.deploy.yml up -d
```

On first boot the one-shot `migrate` service applies the database schema
(`prisma migrate deploy`) and seeds system roles before the API starts. Watch it:

```bash
docker compose -f infrastructure/docker/docker-compose.deploy.yml logs -f migrate api web
```

Verify:

```bash
curl -fsS http://localhost:4000/health   # API aggregate health
curl -fsSI http://localhost:3000         # dashboard
```

Then open `http://YOUR_VPS_IP:3000`.

## 5. Google OAuth (sign-in + Workspace connectors)

Sign-in is Google-only, so OAuth must be configured:

1. Google Cloud Console → **APIs & Services → Credentials → Create OAuth client
   ID → Web application**.
2. **Authorized redirect URI** must exactly equal your `GOOGLE_REDIRECT_URI`,
   e.g. `http://YOUR_VPS_IP:4000/api/v1/auth/google/callback` (use `https://…`
   once you add TLS).
3. Enable the Drive, Docs, Sheets, Slides, Gmail, and Calendar APIs on the
   project.
4. Put the client id/secret in `.env` and restart: `... up -d api web`.

> Google rejects plain-IP redirect URIs for some flows and won't allow `https`
> without a real domain — for a shareable test instance, point a domain at the
> VPS and use the reverse proxy below.

## 6. (Recommended) Domain + HTTPS via nginx

Put a reverse proxy in front for TLS and clean URLs. Point two DNS A records at
the VPS: `brain.example.com` (dashboard) and `api.brain.example.com` (API).

Install nginx + certbot, then use the bundled config:

```bash
sudo apt install -y nginx
sudo cp infrastructure/nginx/company-brain.conf /etc/nginx/sites-available/company-brain.conf
sudo sed -i 's/brain\.example\.com/YOUR_DOMAIN/g' /etc/nginx/sites-available/company-brain.conf  # edit domains
sudo ln -s /etc/nginx/sites-available/company-brain.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

The config proxies `brain.…` → web (`:3000`) and `api.brain.…` → API (`:4000`),
with **WebSocket upgrade** (live events + meeting streams) and a 60 MB upload
limit. Add HTTPS — certbot rewrites the blocks to TLS + an HTTP→HTTPS redirect:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d brain.example.com -d api.brain.example.com
```

Then set in `.env` (and rebuild web, step 7 — the API URL is baked in):

```
PUBLIC_API_URL=https://api.brain.example.com
WEB_APP_URL=https://brain.example.com
API_CORS_ORIGINS=https://brain.example.com
GOOGLE_REDIRECT_URI=https://api.brain.example.com/api/v1/auth/google/callback
```

Only expose 80/443 publicly now — you can firewall off 3000/4000 (the proxy
reaches them on localhost). Full config: `infrastructure/nginx/company-brain.conf`.

> Prefer Caddy? Two blocks give you the same with automatic TLS:
> `brain.example.com { reverse_proxy localhost:3000 }` and
> `api.brain.example.com { reverse_proxy localhost:4000 }`.

## 7. Updating / redeploying

```bash
git pull
docker compose -f infrastructure/docker/docker-compose.deploy.yml build
docker compose -f infrastructure/docker/docker-compose.deploy.yml up -d
```

`build` is required whenever code changes **or** you change `PUBLIC_API_URL`
(the web bundle re-bakes it). New migrations apply automatically via the
`migrate` service on the next `up`.

## 8. Operations

```bash
# logs
docker compose -f infrastructure/docker/docker-compose.deploy.yml logs -f api
# stop / start
docker compose -f infrastructure/docker/docker-compose.deploy.yml down
docker compose -f infrastructure/docker/docker-compose.deploy.yml up -d
# nuke data (DANGER — drops volumes)
docker compose -f infrastructure/docker/docker-compose.deploy.yml down -v
```

Data lives in named volumes (`postgres_data`, `redis_data`, `minio_data`,
`qdrant_data`); back up `postgres_data` regularly.

## Notes & caveats

- **Meeting capture bot** (`services/meeting-bot`, headless Chromium + whisper)
  is intentionally excluded — it's heavy. Meeting capture via Recall.ai works
  by setting `RECALLAI_KEY` (and a public `RECALL_WEBHOOK_SECRET` webhook, which
  needs the HTTPS reverse proxy).
- Secrets live in `.env` on the host — keep it `chmod 600` and out of git
  (`.env` is gitignored).
- Continuous Google sync is a 2-minute polling cron (no public webhook needed).
