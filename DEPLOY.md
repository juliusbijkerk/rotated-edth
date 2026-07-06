# Deploying the landing page (always-up `rotated.cc`)

Goal: `rotated.cc` shows the landing page **24/7** (served by Cloudflare Pages — no
laptop needed, so no more Error 1033), while the *live app* moves to `app.rotated.cc`
behind the on-demand tunnel. The landing page already points at `app.rotated.cc` and
shows ONLINE/OFFLINE by pinging it.

```
  rotated.cc        →  Cloudflare Pages   (static landing, always up)
  app.rotated.cc    →  cloudflared tunnel →  localhost:8010   (live app, on-demand)
  unit.rotated.cc   →  cloudflared tunnel →  localhost:8010   (phone PTT, on-demand)
```

---

## Step 1 — point the app at `app.rotated.cc`

The tunnel config (`~/.cloudflared/config.yml`) is already updated to serve
`app.rotated.cc`. Create its DNS record (one time):

```sh
cloudflared tunnel route dns rotated app.rotated.cc
```

Restart the tunnel so it picks up the new hostname:

```sh
# stop the running `cloudflared tunnel run rotated`, then:
cloudflared tunnel run rotated
```

Check: with the app + tunnel running, `https://app.rotated.cc/api/health` returns
`{"ok":true}`. (`rotated.cc` still works as a fallback until Step 3 takes over the apex.)

## Step 2 — deploy the landing page to Cloudflare Pages

Easiest (no tooling) — **drag-and-drop**:
1. Cloudflare dashboard ▸ **Workers & Pages** ▸ **Create** ▸ **Pages** ▸ **Upload assets**.
2. Project name: `rotated-landing`. Drag the **`landing/`** folder in. Deploy.
3. You get a `https://rotated-landing.pages.dev` URL — open it, confirm it looks right.

Alternative (CLI, nice for repeat updates):
```sh
npx wrangler login
npx wrangler pages deploy landing --project-name rotated-landing
```

## Step 3 — put it on `rotated.cc`

1. In the `rotated-landing` Pages project ▸ **Custom domains** ▸ **Set up a domain**.
2. Enter `rotated.cc`. Cloudflare sees the domain is in your account and offers to
   **update the existing DNS record** (currently the apex CNAME → tunnel). Confirm.
3. Wait for the cert to issue (usually < 1 min). Now `https://rotated.cc` serves the
   landing page permanently — even with your Mac off.

Optional: also add `www.rotated.cc` the same way.

## Step 4 — verify
- **Anytime (laptop on or off):** `rotated.cc` loads instantly with the embedded demo
  video. It's a fully static page, so it's always up — no more 1033.
- **Live demo (laptop on):** bring the app + tunnel up and the live system is reachable
  directly at `app.rotated.cc/operator` (password-gated). The landing page is static and
  intentionally doesn't link to it, so it never shows a broken "offline" state.

---

## Updating the page later
Edit `landing/index.html`, then re-run the drag-and-drop upload (or
`wrangler pages deploy landing --project-name rotated-landing`).

## Two things only you can decide
- **GitHub link:** the landing footer links to `github.com/juliusbijkerk/rotated-edth`,
  which is **private** — an employer would hit 404. Make the repo public, or remove the
  link. (I won't flip visibility for you.)
- **The live app is still laptop-dependent.** Pages only makes the *landing* always-up.
  For a truly self-serve live app you'd cloud-host it and swap local Whisper for a hosted
  STT API — that's the separate "self-serve" path, not needed for the video showcase.
