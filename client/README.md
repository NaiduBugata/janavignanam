# Client

The constituency workspace and news desk. The Nest API lives in `../server`.

```sh
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to http://127.0.0.1:5000.

The production site for this client is https://janavignanam-three.vercel.app. It is installable from Safari as a home-screen app. `public/sw.js` caches icons and the offline page only, and it does not cache `/api`. The Android package builds this same client with `VITE_CAPACITOR=true` and does not register that service worker.

## Deploy on Vercel

Import this repo. Set the project Root Directory to `client`, or leave it at the repo root (the root `vercel.json` builds this folder).

Set this environment variable, then redeploy. Vite bakes it into the build:

```
VITE_API_BASE_URL=https://YOUR-RAILWAY-DOMAIN
```

No trailing slash. Leave it empty for local dev. Add the same Vercel URL to the API `CORS_ORIGINS`.
