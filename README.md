# OPIOW — Save it. Sort it. Share it.

**O**nline **P**latform for **I**nternet **O**bjects: save links, organise them into boards, share with friends, and discover what others advertise.

- **Frontend:** React 18 + Vite + React Router (`frontend/`)
- **Backend:** Django 5 + Django REST Framework + JWT (`backend/`)
- **Database:** PostgreSQL in production (`DATABASE_URL`), SQLite for local dev
- **Sign-in:** Google (ID token) **or** email + password

## Features
Discover / Mine / Saved · list and large views · link previews (Open Graph) and the OPIOW viewer (YouTube/Vimeo play inline) · boards (public/private, collaborators, invites, PIN lock, the "All" folder) · friends and link DMs · follow + private profiles · nicknames · block users and categories · interests · 18+ flag · profile pictures.

## Run locally (no Docker)
```bash
# 1) backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DJANGO_DEBUG=1
python manage.py migrate
python manage.py createsuperuser     # optional, for /admin
python manage.py runserver           # http://localhost:8000

# 2) frontend (new terminal)
cd frontend
cp .env.example .env                 # add VITE_GOOGLE_CLIENT_ID for Google login
npm install
npm run dev                          # http://localhost:5173  (proxies /api and /media to :8000)
```
Tests: `cd backend && python manage.py test`

## Google sign-in setup
1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** → *Web application*.
2. Add your site to **Authorized JavaScript origins** (`http://localhost:5173`, `https://yourdomain.com`).
3. Set the same client ID in two places: `GOOGLE_CLIENT_ID` (backend) and `VITE_GOOGLE_CLIENT_ID` (frontend, baked in at build time).

Without a client ID, Google login is disabled (the API returns 503) and email + password still works.

## Deploy with Docker (recommended)
```bash
cp .env.example .env      # set POSTGRES_PASSWORD, DJANGO_SECRET_KEY, your domain, Google IDs
docker compose up -d --build
```
The site is served at `http://localhost:8080` (change `SITE_PORT`). nginx serves the React build and proxies `/api`, `/admin`, `/media`, `/static` to Django (gunicorn). Migrations run on container start. Data lives in the `pgdata` and `media` volumes.

Create an admin user: `docker compose exec backend python manage.py createsuperuser`

Put HTTPS in front (Caddy, Cloudflare, your host's load balancer). Then set `SECURE_COOKIES=1`, and use `https://` origins in `CSRF_TRUSTED_ORIGINS` / `CORS_ALLOWED_ORIGINS`.

Generate a secret key: `python -c "import secrets; print(secrets.token_urlsafe(60))"`

### Other hosts
- **Backend** (Render, Railway, Fly, etc.): deploy `backend/` with its Dockerfile. Set the env vars in `backend/.env.example` and attach a Postgres `DATABASE_URL` and a persistent disk for `MEDIA_ROOT`.
- **Frontend** (Netlify, Vercel, Cloudflare Pages): build with `npm run build` and publish `dist/`. Set `VITE_API_URL=https://your-api-domain/api` at build time, add SPA fallback to `index.html`, and add the frontend origin to the backend's `CORS_ALLOWED_ORIGINS`.

## Environment variables (backend)
| Variable | Purpose |
|---|---|
| `DJANGO_SECRET_KEY` | required in production |
| `DJANGO_DEBUG` | `1` for dev |
| `DJANGO_ALLOWED_HOSTS` | comma-separated hosts |
| `CSRF_TRUSTED_ORIGINS`, `CORS_ALLOWED_ORIGINS` | comma-separated origins |
| `DATABASE_URL` | Postgres URL (SQLite if unset) |
| `GOOGLE_CLIENT_ID` | enables Google sign-in |
| `MEDIA_ROOT` | where uploads are stored |
| `SECURE_COOKIES` | `1` behind HTTPS |

## API overview (all under `/api/`, JWT `Authorization: Bearer <token>`)
- Auth: `POST auth/register/`, `auth/login/`, `auth/google/`, `auth/refresh/`
- Me: `GET/PATCH me/`, `GET categories/`, `GET users/search/?q=`
- Profiles: `GET users/<username>/`, `POST/DELETE users/<username>/follow/`, `GET users/<username>/followers|following/`, `follow-requests/`
- Links: `GET/POST links/`, `PATCH/DELETE links/<id>/`, `POST/DELETE links/<id>/advertise/`, `POST links/save/`, `GET preview/?url=`, `GET discover/`
- Boards: `GET/POST boards/`, `GET/PATCH/DELETE boards/<id>/`, `POST boards/<id>/links/`, `POST boards/<id>/pin/`, `POST boards/<id>/invite/`, `GET invites/`, `POST invites/<id>/accept|decline/`
- Friends & chat: `GET friends/`, `POST friends/request/`, `POST/DELETE friends/<uid>/`, `GET conversations/`, `GET/POST messages/<uid>/`, `POST nicknames/<uid>/`
- Safety: `GET/POST blocks/`, `DELETE blocks/<uid>/`, `GET/POST/DELETE locks/`, `POST locks/verify/`

## Notes
- PIN locks are hashed and enforced by the server for chat messages and board contents. Treat them as a privacy screen, not strong security.
- Link category detection is keyword-based (host + title).
- Link previews are fetched server-side with SSRF protection (private/loopback addresses are refused).
- Some previews depend on third-party image services (favicons, page thumbnails); they degrade gracefully when blocked.
