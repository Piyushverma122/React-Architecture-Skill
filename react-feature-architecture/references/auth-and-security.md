# Auth Architecture, Backend Contract and Security

## Contents
1. Decisions to make with the user (never assume)
2. How the flow works
3. Requirement → implementation map
4. Refresh-token transport: cookie vs body
5. Access-token storage and opt-in persistence
6. Expected backend contract (examples)
7. Security rules
8. Known limitations

---

## 1. Decisions to make with the user (never assume)

| Decision | Options | Default if the user has no preference | Where it's set |
|---|---|---|---|
| Refresh-token transport | `cookie` (httpOnly) / `body` | **Ask. There's no default.** Recommend `cookie` if the backend supports it. | `constants/auth.js` → `REFRESH_TOKEN_TRANSPORT` |
| Body mode: where the refresh token lives | `local` / `memory` | Ask. Explain the trade-off below. | `constants/auth.js` → `BODY_REFRESH_TOKEN_STORAGE` |
| Persist the access token across reloads | no / yes | **no** (memory only) | `app/store.js` (see §5) |
| Endpoint paths | | placeholders `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me` | `constants/api.js` |
| Response shapes | | the adapter accepts the common shapes in §6 | `api/responseAdapter.js` |

If the backend has **no refresh endpoint**, stop and ask. The template's automatic refresh, session restore, and 401 handling all assume one. Without it, the skill needs a reduced design: no refresh, and logout on 401. Don't improvise that silently.

## 2. How the flow works

```
App start ─► AuthGate (status "unknown", shows PageLoader)
             ├─ access token already in state (opt-in persistence) ─► sessionStarted
             ├─ body mode and no stored refresh token ─────────────► sessionEnded ("unauthenticated")
             └─ otherwise: POST /refresh (single-flight)
                   ├─ 2xx + token  ─► sessionStarted ("authenticated")
                   ├─ 400/401/403 or no token in the response ─► sessionEnded ("unauthenticated")
                   └─ network / 5xx ─► retry screen (status stays "unknown")

Any request ─► baseQueryWithReauth
   wait for an in-flight refresh ─► send with Bearer token
   └─ 401 and path not in {login, refresh, logout} and a token was sent
        ├─ token changed meanwhile ─► retry once
        └─ refreshSession() (single-flight, shared by all callers)
              ├─ success ─► retry the original request ONCE (a second 401 is returned as-is)
              ├─ auth failure ─► endSession → sessionEnded → API cache reset → PrivateRoute redirects
              └─ transient failure ─► return the original 401, keep the session

Login  ─► queryFn: POST /login ─► normalizeSession ─► store refresh token (body) ─► sessionStarted
          PublicRoute sees "authenticated" ─► <Navigate to={getSafeRedirect(?redirect)} replace />
Logout ─► POST /logout ─► (after it settles) endSession ─► cache reset ─► PrivateRoute ─► /login
```

There's one source of truth for redirects: the route guards react to `auth.status`. No component calls `navigate()` after login or logout, so there are no competing navigations.

## 3. Requirement → implementation map

| # | Requirement | Where |
|---|---|---|
| 1 | Login | `authApi.login` (`queryFn` + `normalizeSession`), `LoginPage` |
| 2 | Logout | `authApi.logout` → `endSession` after the request settles |
| 3 | Get current user | `authApi.getMe` (`transformResponse: normalizeUser`, `providesTags: ["Me"]`) |
| 4 | Access-token refresh | `refreshSession` in `api/tokenRefresh.js` |
| 5 | Automatic refresh on 401 | `baseQueryWithReauth` in `api/baseApi.js` |
| 6 | Single-flight | the shared `inFlight` promise + `waitForRefresh()` |
| 7 | Session expiration | `fail()` → `endSession` → `sessionEnded` → the auth slice resets, and the store listener calls `resetApiState()` |
| 8 | Protected routes | `PrivateRoute` (waits on `"unknown"` status) |
| 9 | Public routes | `PublicRoute` |
| 10 | Safe post-login redirect | `getSafeRedirect` (URL-parser based; same origin only; `/login` blocked) |
| 11 | Reload / session restore | `AuthGate` → `useRefreshMutation`, on the same single-flight path |
| 12 | Failed refresh handling | auth failure → logged out; transient → session kept / retry screen; never more than one retry per request |

Caches: `sessionEnded` resets the whole RTK Query cache, for logout as well as expiry. Login invalidates `"Me"`. The cache is already empty after any previous logout or expiry, so login doesn't need a full reset.

## 4. Refresh-token transport: cookie vs body

| | **httpOnly cookie** (`"cookie"`) | **Response body** (`"body"`) |
|---|---|---|
| JS can read the refresh token | No | Yes |
| XSS impact | The attacker can make requests while the page is open but can't steal the long-lived token | The attacker can exfiltrate the refresh token and keep using it later (with `"local"` storage) |
| CSRF | The refresh endpoint is cookie-authenticated, so the backend needs `SameSite` + CSRF protection (a SameSite=Strict/Lax cookie, a custom header check, or a CSRF token) | Not cookie-based, so no CSRF on refresh |
| Cross-origin setup | Needs CORS with credentials (see §6) and correct cookie attributes | Plain CORS |
| Survives reload | Yes (the browser keeps the cookie) | `"local"`: yes · `"memory"`: no (re-login on every reload) |
| Client code | `credentials: "include"`; the token is never touched | Sent in the refresh/logout body; stored via `refreshTokenStore` |

Rules the templates enforce:
- **Cookie mode:** the refresh token is never read, stored, logged, or put in Redux. `refreshTokenStore` is a no-op.
- **Body mode:** the refresh token lives **only** in `refreshTokenStore` (localStorage or memory). It's never in Redux state or the RTK Query cache (`login` returns `{ user }` only), never logged, and cleared by `endSession`.
- Both modes run the explicit refresh (`useRefreshMutation`) and the automatic refresh through the **same** `refreshSession` function, so they behave identically.
- A missing body-mode token fails locally with no network call. An invalid or expired one (400/401/403) ends the session. A malformed refresh response (no access token) ends the session.

## 5. Access-token storage and opt-in persistence

**Default: memory only.** The access token lives in the Redux `auth` slice and nowhere else. On reload, `AuthGate` gets a new one from the refresh endpoint. This keeps the short-lived token out of storage that an XSS payload can read later.

**Opt-in persistence**, only if the user explicitly asks (for example, there's no working refresh restore on reload and they accept the risk). Persisting the access token in localStorage means any XSS can read it, and it stays valid until it expires. Prefer short access-token lifetimes. Install `redux-persist` and change `app/store.js` as follows. This variant passed `vite build` in the verification harness on 2026-11-06. Its runtime behavior wasn't unit-tested.

```js
import { configureStore, createListenerMiddleware } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { FLUSH, PAUSE, PERSIST, PURGE, REGISTER, REHYDRATE, persistReducer, persistStore } from "redux-persist";
import storage from "redux-persist/lib/storage";
import { baseApi } from "@/api/baseApi";
import { sessionEnded } from "@/api/tokenRefresh";
import authReducer from "@/features/auth/store/authSlice";

const sessionListener = createListenerMiddleware();
sessionListener.startListening({
  actionCreator: sessionEnded,
  effect: (_action, { dispatch }) => {
    dispatch(baseApi.util.resetApiState());
  },
});

// Never persist "status": AuthGate must re-validate the session on every start.
// Never persist the RTK Query cache.
const authPersistConfig = { key: "auth", storage, whitelist: ["accessToken", "user"] };

export const store = configureStore({
  reducer: {
    [baseApi.reducerPath]: baseApi.reducer,
    auth: persistReducer(authPersistConfig, authReducer),
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({ serializableCheck: { ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER] } })
      .prepend(sessionListener.middleware)
      .concat(baseApi.middleware),
});

setupListeners(store.dispatch);
export const persistor = persistStore(store);
```
In `main.jsx`, wrap `<App />` in `<PersistGate loading={<PageLoader />} persistor={persistor}>` inside `<Provider>`. Logout and expiry still work: `sessionEnded` resets `accessToken`/`user` to null, and redux-persist writes that cleared state back to storage.

## 6. Expected backend contract (examples)

The adapter (`api/responseAdapter.js`) accepts all of these. Trim it to the real one once it's known.

**Login** `POST {API_BASE_URL}/auth/login` with body `{ "email": "...", "password": "..." }`
```json
{ "accessToken": "eyJ...", "user": { "id": 1, "email": "a@b.io", "name": "Asha" } }
```
```json
{ "data": { "accessToken": "eyJ...", "user": { "id": 1 } } }
```
```json
{ "success": true, "message": "Logged in", "data": { "accessToken": "eyJ...", "refreshToken": "r-1", "user": { "id": 1 } } }
```
```json
{ "tokens": { "access_token": "eyJ...", "refresh_token": "r-1" }, "user": { "id": 1 } }
```
Cookie mode: the response also sets `Set-Cookie: refresh_token=...; HttpOnly; Secure; SameSite=...; Path=/auth`, and the body has **no** `refreshToken`. Body mode: the body includes `refreshToken`.

**Refresh** `POST /auth/refresh`
- Cookie mode: no body. The browser sends the cookie.
- Body mode: `{ "refreshToken": "r-1" }` (**BACKEND CONTRACT:** the field name).
- Success: same shapes as login. `user` is optional. A new `refreshToken` (rotation) is optional, and is stored if present.
- Failure: **401** (or 400/403) when the refresh token is missing, invalid, or expired. Use 5xx only for real server errors, because the client keeps the session on 5xx.

**Logout** `POST /auth/logout` (body mode sends `{ "refreshToken": "..." }` so the server can revoke it). Any 2xx works. Cookie mode: the server must clear the cookie.

**Current user** `GET /auth/me` → `{ "id": 1, ... }`, `{ "user": {...} }`, or `{ "data": { "user": {...} } }`.

**Errors:** any status with a JSON body such as `{ "message": "..." }` or `{ "errors": [{ "message": "..." }] }`. A 2xx `{ "success": false, "message": "..." }` is treated as an error (`CUSTOM_ERROR`).

**401 semantics (required):** an expired or invalid **access token** must produce HTTP **401**, not 403 or a 200 with an error body. Otherwise the automatic refresh never triggers.

**Cross-origin cookie mode (required if the API is on another origin):**
- `Access-Control-Allow-Origin: <exact frontend origin>` (no `*`)
- `Access-Control-Allow-Credentials: true`
- `Access-Control-Allow-Headers` must include `Authorization` and `Content-Type`
- The cookie needs `SameSite=None; Secure` when frontend and API are on different *sites*. `SameSite=Lax` works for same-site subdomains.
- Simpler alternative: serve the API under the same origin (a reverse proxy, or Vite `server.proxy` in dev), with `VITE_API_BASE_URL=/api`.

## 7. Security rules

- Never log tokens, passwords, `Authorization` headers, or raw login/refresh/me responses. Not in `console.*`, error reporters, or toasts. The templates only log component stacks in dev.
- Never put refresh tokens in Redux, sessionStorage, or the RTK Query cache. Never touch an httpOnly refresh token from JS.
- Redirects: always go through `getSafeRedirect`. Never navigate to an absolute URL taken from query params, storage, or the API.
- Show server error messages only when they're short strings (`getApiErrorMessage` caps them at 300 chars). Never render HTML from errors.
- The `Authorization` header is added only from in-memory state, and only to requests through `baseApi`. Don't hand-roll `fetch` calls with the token elsewhere.
- XSS is the main threat to any SPA token scheme. Keep a Content Security Policy, avoid `dangerouslySetInnerHTML`, and keep dependencies updated.

## 8. Known limitations

- **Multiple tabs:** each tab restores its own session. With strict refresh-token rotation and reuse detection on the backend, two tabs refreshing at the same moment can trip the reuse detector. If the backend does that, add cross-tab coordination (a `BroadcastChannel` or the Web Locks API) and ask the user first. It isn't included by default.
- **Logout in another tab** isn't propagated until this tab's next 401. Optional fix: listen for a `storage` event or a `BroadcastChannel` message, then call `endSession`.
- **Startup in cookie mode** always makes one refresh call, even for visitors who never logged in (it returns 401, so they're treated as logged out). That's expected.
- When a session expires, `resetApiState` drops in-flight queries, which resolve as uninitialized rather than as errors. The guards redirect to login right away, so the user doesn't see this.
