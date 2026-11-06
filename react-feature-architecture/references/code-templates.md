# Code Templates (JavaScript)

These are **starter templates** for a Vite + React **JavaScript** project. TypeScript projects should use `typescript.md`. Don't paste JS into a TS project.

**Verification status.** On 2026-11-06 the blocks below were extracted verbatim into a fresh `create-vite@9.3.4` React app with shadcn CLI 4.23 (`radix-vega`). With that setup they passed `vite build`, `oxlint`, and the Vitest suite in `testing.md`. The library versions were React 19.3, RTK 2.14, react-router-dom 7.18, zod 4.6, @hookform/resolvers 7.0, i18next 26.7, react-i18next 17.1, sonner 2.0, and Tailwind 4.3. This proves the templates compile and that the tested logic behaves as asserted. It does **not** prove they work against your backend. Re-run the checks in the target project, because versions drift.

Conventions:
- Each `### \`path\`` heading is one file, written relative to the project root. Blocks without a path heading are snippets.
- `BACKEND CONTRACT` marks a line that depends on the real API. Confirm it with the user and list it in the final report.
- Template code never logs tokens, passwords, or raw auth responses. Keep it that way.

## Contents
1. Root config
2. Config and constants
3. Generic utils
4. API layer: response adapter, token refresh, baseApi
5. Store
6. Auth feature
7. Home feature (example page with loading, error, and empty states)
8. Routes
9. Layout, loaders, theme, toaster
10. i18n
11. Entry

---

## 1. Root config

### `vite.config.js`
```js
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
```
If `vite.config.js` already exists, **merge** the `tailwindcss()` plugin and the alias into it. Don't replace it.

### `jsconfig.json`
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

### `.env.example`
```
# Base URL of the backend API (no trailing slash), e.g. http://localhost:5000/api
VITE_API_BASE_URL=
```
Add these lines to `.gitignore` if they're missing: `.env`, `.env.local`, `.env.*.local`. Never ignore `.env.example`.

`src/index.css` is written by `shadcn init` (it starts with `@import "tailwindcss";` and adds theme variables). Don't hand-write it.

## 2. Config and constants

### `src/config/env.js`
```js
// The ONLY file allowed to read import.meta.env.
const env = import.meta.env;

export const API_BASE_URL = String(env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
export const APP_ENV = env.MODE;
export const IS_DEV = Boolean(env.DEV);

if (!API_BASE_URL) {
  console.warn("[env] VITE_API_BASE_URL is not set; API calls go to the page's own origin. See .env.example.");
}
```

### `src/constants/api.js`
```js
// BACKEND CONTRACT: endpoint paths, relative to API_BASE_URL. They must start with "/".
export const API_PATHS = {
  LOGIN: "/auth/login",
  REFRESH: "/auth/refresh",
  LOGOUT: "/auth/logout",
  ME: "/auth/me",
};

export const REQUEST_TIMEOUT_MS = 30_000;
```

### `src/constants/auth.js`
```js
// Decided WITH THE USER in Phase 3. Never assume. See auth-and-security.md.
// "cookie": the backend sets the refresh token as an httpOnly cookie (preferred). JS never sees it.
// "body":   the backend returns the refresh token in JSON; the client sends it back in the refresh body.
export const REFRESH_TOKEN_TRANSPORT = "cookie";

// Body mode only: where the refresh token lives between page loads.
// "local"  = localStorage (survives reloads and is shared across tabs; readable by any XSS)
// "memory" = JS memory (an XSS can't read it after the fact, but every reload requires logging in again)
export const BODY_REFRESH_TOKEN_STORAGE = "local";
```

### `src/constants/routes.js`
```js
export const ROUTES = {
  HOME: "/",
  LOGIN: "/login",
};
```

### `src/constants/storage.js`
```js
export const STORAGE_KEYS = {
  REFRESH_TOKEN: "app.refreshToken", // body mode + "local" storage only
  LANGUAGE: "app.language",
  THEME: "app.theme",
  CHUNK_RELOAD_AT: "app.chunkReloadAt", // sessionStorage: timestamp of the last automatic chunk reload
};
```

## 3. Generic utils

### `src/utils/storage.js`
```js
// Safe Web Storage wrappers. Access can throw (privacy mode, blocked site data, quota, sandboxed iframes).
function createStore(getStorage) {
  return {
    get(key) {
      try { return getStorage().getItem(key); } catch { return null; }
    },
    set(key, value) {
      try { getStorage().setItem(key, value); return true; } catch { return false; }
    },
    remove(key) {
      try { getStorage().removeItem(key); } catch { /* ignore */ }
    },
    /** True only if a write followed by a read actually works. */
    isAvailable() {
      const probe = "__storage_probe__";
      try {
        const s = getStorage();
        s.setItem(probe, probe);
        const ok = s.getItem(probe) === probe;
        s.removeItem(probe);
        return ok;
      } catch {
        return false;
      }
    },
  };
}

export const storage = createStore(() => window.localStorage);
export const sessionStore = createStore(() => window.sessionStorage);
```

### `src/utils/getSafeRedirect.js`
```js
/**
 * Returns a same-origin path (pathname + search + hash) or `fallback`.
 * Uses the URL parser, so tricks such as "//evil.com", "/\\evil.com", "/\t/evil.com"
 * and "javascript:..." resolve to another origin (or no path) and are rejected.
 */
export function getSafeRedirect(value, fallback = "/", blockedPaths = []) {
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return fallback;
    if (blockedPaths.includes(url.pathname)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
```

### `src/utils/getApiErrorMessage.js`
```js
// Turns an RTK Query / fetchBaseQuery error into a short, human-readable message.
// It never fakes success and never echoes huge HTML error pages.
export function getApiErrorMessage(error, fallback = "Something went wrong") {
  if (!error) return fallback;
  switch (error.status) {
    case "FETCH_ERROR": return "Network error: could not reach the server.";
    case "TIMEOUT_ERROR": return "The request timed out. Please try again.";
    case "PARSING_ERROR": return `Unexpected server response (HTTP ${error.originalStatus}).`;
    default: break;
  }
  const data = error.data;
  const fromData =
    (typeof data === "string" && data) ||
    data?.message ||
    data?.error?.message ||
    (typeof data?.error === "string" && data.error) ||
    data?.errors?.[0]?.message;
  if (typeof fromData === "string" && fromData.length <= 300) return fromData;
  if (typeof error.error === "string" && error.error) return error.error; // CUSTOM_ERROR
  if (typeof error.status === "number") return `Request failed (HTTP ${error.status}).`;
  return error.message || fallback;
}
```

### `src/utils/chunkErrors.js`
```js
// Messages browsers and Vite use when a lazily loaded JS/CSS chunk can't be fetched.
const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Unable to preload CSS/i, // Vite CSS preload
  /Loading (CSS )?chunk [\w-]+ failed/i, // webpack-style
];

export function isChunkLoadError(error) {
  if (!error) return false;
  if (error.name === "ChunkLoadError") return true;
  const message = String(error.message ?? "");
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(message));
}
```

### `src/utils/lazyWithRetry.js`
```js
import { lazy } from "react";
import { STORAGE_KEYS } from "@/constants/storage";
import { isChunkLoadError } from "@/utils/chunkErrors";
import { sessionStore } from "@/utils/storage";

const RELOAD_COOLDOWN_MS = 60_000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reloads the page at most once per RELOAD_COOLDOWN_MS to recover from a stale or missing chunk.
 * If sessionStorage can't hold the guard, it does NOT reload (a guard that can't be stored
 * can't stop a loop). The error then reaches LazyErrorBoundary, which offers a manual Reload.
 * Returns true if a reload was started.
 */
export function reloadOnceForChunkError() {
  if (!sessionStore.isAvailable()) return false;
  const last = Number(sessionStore.get(STORAGE_KEYS.CHUNK_RELOAD_AT)) || 0;
  if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
  if (!sessionStore.set(STORAGE_KEYS.CHUNK_RELOAD_AT, String(Date.now()))) return false;
  window.location.reload();
  return true;
}

/**
 * Retries chunk-load failures with backoff, then does one guarded reload.
 * Errors that aren't chunk-load failures (e.g. the module throws while evaluating) are rethrown
 * immediately. They are bugs, and retrying or reloading would only hide them.
 * Kept separate from React so it can be unit tested.
 */
export async function loadWithRetry(factory, { retries = 2, delayMs = 400 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await factory();
    } catch (error) {
      if (!isChunkLoadError(error)) throw error;
      lastError = error;
      if (attempt < retries) await wait(delayMs * 2 ** attempt);
    }
  }
  if (reloadOnceForChunkError()) return new Promise(() => {}); // stay suspended until the reload
  throw lastError;
}

/** React.lazy() with loadWithRetry. Use it for every route page. */
export const lazyWithRetry = (factory, options) => lazy(() => loadWithRetry(factory, options));
```

### `src/utils/LazyErrorBoundary.jsx`
```jsx
import { Component } from "react";
import { isChunkLoadError } from "@/utils/chunkErrors";

/**
 * Catches render errors (including failed lazy chunks) below it.
 * - Pass `resetKey={location.pathname}` so navigating away clears the error.
 * - Optional `fallback({ error, isChunkError, retry, reload })` render prop for custom UI or i18n.
 */
export default class LazyErrorBoundary extends Component {
  state = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error) {
    return { error };
  }

  // Navigating (a new resetKey) clears the error without an extra setState-after-update render.
  static getDerivedStateFromProps(props, state) {
    if (props.resetKey === state.resetKey) return null;
    return { resetKey: props.resetKey, error: null };
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) console.error("[LazyErrorBoundary]", error, info?.componentStack);
  }

  retry = () => {
    // React.lazy caches a rejected import, so only a reload can truly retry a chunk error.
    if (isChunkLoadError(this.state.error)) return this.reload();
    this.setState({ error: null });
    this.props.onReset?.();
  };

  reload = () => window.location.reload();

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isChunkError = isChunkLoadError(error);
    if (this.props.fallback) {
      return this.props.fallback({ error, isChunkError, retry: this.retry, reload: this.reload });
    }

    return (
      <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <h2 className="text-lg font-semibold">
          {isChunkError ? "This part of the app couldn't be loaded" : "Something went wrong"}
        </h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {isChunkError
            ? "You may be offline, or a new version was released. Reloading usually fixes it."
            : "An unexpected error occurred while showing this section."}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={this.retry}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={this.reload}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
```
`import.meta.env.DEV` here is a compile-time constant Vite strips in production. That's the one tolerated read outside `config/env.js`. If you'd rather be strict, import `IS_DEV` from `@/config/env` (it's allowed: `utils/` → `config/`).

## 4. API layer

`src/api/` holds exactly three files:
- `responseAdapter.js` knows the backend's response shapes.
- `tokenRefresh.js` holds the auth events, the refresh-token store, and the single-flight refresh.
- `baseApi.js` holds the base query, the reauth wrapper, and `createApi`.

None of them imports from `features/` or `shared/`.

### `src/api/responseAdapter.js`
```js
// BACKEND CONTRACT: the ONLY place that knows how the backend shapes its responses.
// The defaults accept the common shapes listed below. Once the real contract is known,
// trim them to it and delete the shapes you don't need.
//
//   { accessToken, refreshToken?, user? }
//   { data: { accessToken, refreshToken?, user? } }
//   { success: true, data: { ... }, message? }
//   { tokens: { accessToken | access_token, refreshToken | refresh_token }, user? }
//
// Rules: never throw, never log the body, return null when the data isn't usable.

const ENVELOPE_META_KEYS = new Set([
  "success", "status", "statusCode", "code", "message", "meta", "timestamp", "errors", "error",
]);

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmptyString = (value) => (typeof value === "string" && value.trim() !== "" ? value : null);

/** True for bodies like `{ success: false, message }` that arrive with HTTP 2xx. */
export function isEnvelopeFailure(body) {
  return isPlainObject(body) && body.success === false;
}

/**
 * Unwraps `{ data: X }` / `{ success, data: X, message }` envelopes.
 * It unwraps only when every other key is envelope metadata, so a resource that merely
 * has a `data` field is returned unchanged.
 */
export function unwrapEnvelope(body) {
  if (!isPlainObject(body) || !("data" in body)) return body;
  const onlyMeta = Object.keys(body).every((key) => key === "data" || ENVELOPE_META_KEYS.has(key));
  return onlyMeta ? body.data : body;
}

/** Returns a user object or null. Accepts the user itself, `{ user }`, or an envelope around either. */
export function normalizeUser(body) {
  const payload = unwrapEnvelope(body);
  if (!isPlainObject(payload)) return null;
  const user = isPlainObject(payload.user) ? payload.user : payload;
  return Object.keys(user).length > 0 ? user : null;
}

/**
 * Login and refresh responses. Returns { accessToken, refreshToken, user },
 * or null when there's no usable access token.
 */
export function normalizeSession(body) {
  const payload = unwrapEnvelope(body);
  if (!isPlainObject(payload)) return null;
  const tokens = isPlainObject(payload.tokens) ? payload.tokens : payload;
  const accessToken = nonEmptyString(tokens.accessToken ?? tokens.access_token ?? tokens.token);
  if (!accessToken) return null;
  return {
    accessToken,
    refreshToken: nonEmptyString(tokens.refreshToken ?? tokens.refresh_token),
    user: isPlainObject(payload.user) ? payload.user : null,
  };
}

/** For feature endpoints: `transformResponse: unwrapData`. */
export const unwrapData = (body) => unwrapEnvelope(body);
```

### `src/api/tokenRefresh.js`
```js
import { createAction } from "@reduxjs/toolkit";
import { API_PATHS } from "@/constants/api";
import { BODY_REFRESH_TOKEN_STORAGE, REFRESH_TOKEN_TRANSPORT } from "@/constants/auth";
import { STORAGE_KEYS } from "@/constants/storage";
import { storage } from "@/utils/storage";
import { normalizeSession } from "./responseAdapter";

// ── Auth events ──────────────────────────────────────────────────────────────
// Defined here (not in the slice) so api/ never imports features/. The auth slice
// handles them in extraReducers, and app/store.js resets the API cache on sessionEnded.
export const sessionStarted = createAction("auth/sessionStarted"); // payload: { accessToken, user? }
export const sessionEnded = createAction("auth/sessionEnded");

// ── Refresh-token store (body mode only) ─────────────────────────────────────
// In cookie mode the refresh token is httpOnly: JS never reads, stores, or sends it.
let memoryRefreshToken = null;
const isBodyMode = REFRESH_TOKEN_TRANSPORT === "body";
const useLocal = BODY_REFRESH_TOKEN_STORAGE === "local";

export const refreshTokenStore = {
  get() {
    if (!isBodyMode) return null;
    return useLocal ? storage.get(STORAGE_KEYS.REFRESH_TOKEN) : memoryRefreshToken;
  },
  set(token) {
    if (!isBodyMode || !token) return;
    if (useLocal) storage.set(STORAGE_KEYS.REFRESH_TOKEN, token);
    else memoryRefreshToken = token;
  },
  clear() {
    memoryRefreshToken = null;
    storage.remove(STORAGE_KEYS.REFRESH_TOKEN);
  },
};

/** The one way to end a session locally: forget the tokens, then reset auth state (and the API cache). */
export function endSession(dispatch) {
  refreshTokenStore.clear();
  dispatch(sessionEnded());
}

// ── Single-flight refresh ────────────────────────────────────────────────────
let inFlight = null;

/** Resolves when no refresh is running, so requests don't go out with a token that's about to change. */
export const waitForRefresh = () => inFlight ?? Promise.resolve();

// A refresh failing with these statuses means the refresh token is missing, invalid, or expired.
const AUTH_FAILURE_STATUSES = new Set([400, 401, 403]);

/**
 * Refreshes the access token ONCE no matter how many callers ask at the same time.
 * Resolves to { data: { accessToken, user } } or { error }:
 *   success                    → stores a rotated refresh token (body mode) + dispatches sessionStarted
 *   auth failure / bad payload → endSession (logged out), and the error is returned
 *   network / 5xx              → the error is returned and the session is KEPT (a flaky network doesn't log people out)
 * `rawBaseQuery` must NOT be the reauth wrapper, so a refresh can never trigger another refresh.
 */
export function refreshSession(rawBaseQuery, api, extraOptions) {
  if (!inFlight) {
    inFlight = runRefresh(rawBaseQuery, api, extraOptions).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function runRefresh(rawBaseQuery, api, extraOptions) {
  let body;
  if (isBodyMode) {
    const refreshToken = refreshTokenStore.get();
    if (!refreshToken) return fail(api, { status: "CUSTOM_ERROR", error: "No refresh token available." });
    body = { refreshToken }; // BACKEND CONTRACT: refresh request body
  }

  const result = await rawBaseQuery({ url: API_PATHS.REFRESH, method: "POST", body }, api, extraOptions);
  if (result.error) {
    return AUTH_FAILURE_STATUSES.has(result.error.status) ? fail(api, result.error) : { error: result.error };
  }

  const session = normalizeSession(result.data);
  if (!session) return fail(api, { status: "CUSTOM_ERROR", error: "Refresh response had no access token." });

  refreshTokenStore.set(session.refreshToken); // rotation (no-op in cookie mode)
  api.dispatch(sessionStarted({ accessToken: session.accessToken, user: session.user }));
  return { data: { accessToken: session.accessToken, user: session.user } };
}

function fail(api, error) {
  endSession(api.dispatch);
  return { error };
}
```

### `src/api/baseApi.js`
```js
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { API_BASE_URL } from "@/config/env";
import { API_PATHS, REQUEST_TIMEOUT_MS } from "@/constants/api";
import { REFRESH_TOKEN_TRANSPORT } from "@/constants/auth";
import { isEnvelopeFailure } from "./responseAdapter";
import { refreshSession, waitForRefresh } from "./tokenRefresh";

const fetchQuery = fetchBaseQuery({
  baseUrl: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  // Cookie mode needs credentials on every call so the httpOnly refresh cookie reaches /refresh.
  credentials: REFRESH_TOKEN_TRANSPORT === "cookie" ? "include" : "same-origin",
  prepareHeaders: (headers, { getState }) => {
    const token = getState().auth?.accessToken;
    if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  },
});

/** fetchBaseQuery + turns 2xx `{ success: false }` envelopes into errors (one error shape everywhere). */
const rawBaseQuery = async (args, api, extraOptions) => {
  const result = await fetchQuery(args, api, extraOptions);
  if (!result.error && isEnvelopeFailure(result.data)) {
    const error = typeof result.data.message === "string" ? result.data.message : "Request failed.";
    return { error: { status: "CUSTOM_ERROR", error, data: result.data }, meta: result.meta };
  }
  return result;
};

// These never trigger a refresh: a 401 here is a real answer, and refreshing would loop.
const NO_REFRESH_PATHS = new Set([API_PATHS.LOGIN, API_PATHS.REFRESH, API_PATHS.LOGOUT]);
const pathOf = (args) => String(typeof args === "string" ? args : args?.url ?? "").split("?")[0];

export const baseQueryWithReauth = async (args, api, extraOptions) => {
  await waitForRefresh();
  const tokenUsed = api.getState().auth?.accessToken ?? null;

  const result = await rawBaseQuery(args, api, extraOptions);
  if (result.error?.status !== 401 || NO_REFRESH_PATHS.has(pathOf(args))) return result;
  if (!tokenUsed) return result; // anonymous request: no session to refresh (startup restore is AuthGate's job)

  // Another request already refreshed while this one was in flight: just retry with the new token.
  const current = api.getState().auth?.accessToken;
  if (current && current !== tokenUsed) return rawBaseQuery(args, api, extraOptions);

  const refreshed = await refreshSession(rawBaseQuery, api, extraOptions);
  if (refreshed.error) return result; // the session (if expired) was already ended inside refreshSession

  return rawBaseQuery(args, api, extraOptions); // retry exactly once; a second 401 is returned as-is
};

/** Explicit refresh (startup restore) on the SAME single-flight path as the automatic one. */
export const refreshAccessToken = (api, extraOptions) => refreshSession(rawBaseQuery, api, extraOptions);

export const baseApi = createApi({
  reducerPath: "api",
  baseQuery: baseQueryWithReauth,
  tagTypes: ["Me"], // add each feature's tag types here
  endpoints: () => ({}),
});
```

## 5. Store

### `src/app/store.js`
```js
import { configureStore, createListenerMiddleware } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { baseApi } from "@/api/baseApi";
import { sessionEnded } from "@/api/tokenRefresh";
import authReducer from "@/features/auth/store/authSlice";

// Ending a session (logout, failed refresh) drops every cached server response,
// so the next user never sees the previous user's data.
const sessionListener = createListenerMiddleware();
sessionListener.startListening({
  actionCreator: sessionEnded,
  effect: (_action, { dispatch }) => {
    dispatch(baseApi.util.resetApiState());
  },
});

export const store = configureStore({
  reducer: {
    [baseApi.reducerPath]: baseApi.reducer,
    auth: authReducer,
    // register other feature slices here
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().prepend(sessionListener.middleware).concat(baseApi.middleware),
});

setupListeners(store.dispatch);
```
There's no redux-persist by default: the access token lives in memory and `AuthGate` restores the session through the refresh endpoint. For opt-in persistence, see `auth-and-security.md` §5.

## 6. Auth feature

### `src/features/auth/store/authSlice.js`
```js
import { createSlice } from "@reduxjs/toolkit";
import { sessionEnded, sessionStarted } from "@/api/tokenRefresh";

// status: "unknown" until AuthGate's startup check finishes, then "authenticated" | "unauthenticated".
// `user` is session identity (who is logged in), kept here so guards and the header work without
// a query subscription. Other server data stays in RTK Query.
const initialState = { user: null, accessToken: null, status: "unknown" };

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    userLoaded(state, { payload }) {
      state.user = payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(sessionStarted, (state, { payload }) => {
        state.accessToken = payload.accessToken;
        if (payload.user) state.user = payload.user;
        state.status = "authenticated";
      })
      .addCase(sessionEnded, () => ({ ...initialState, status: "unauthenticated" }));
  },
});

export const { userLoaded } = authSlice.actions;
export default authSlice.reducer;

export const selectCurrentUser = (state) => state.auth.user;
export const selectAccessToken = (state) => state.auth.accessToken;
export const selectAuthStatus = (state) => state.auth.status;
export const selectIsAuthenticated = (state) => state.auth.status === "authenticated";
```

### `src/features/auth/authApi.js`
```js
import { baseApi, refreshAccessToken } from "@/api/baseApi";
import { normalizeSession, normalizeUser } from "@/api/responseAdapter";
import { endSession, refreshTokenStore, sessionStarted } from "@/api/tokenRefresh";
import { API_PATHS } from "@/constants/api";
import { REFRESH_TOKEN_TRANSPORT } from "@/constants/auth";
import { userLoaded } from "./store/authSlice";

const MISSING_TOKEN_ERROR = { status: "CUSTOM_ERROR", error: "The server response did not include an access token." };

export const authApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // Tokens are stored in the auth slice / refreshTokenStore, never in the RTK Query cache.
    login: build.mutation({
      async queryFn(credentials, api, _extraOptions, baseQuery) {
        const result = await baseQuery({ url: API_PATHS.LOGIN, method: "POST", body: credentials });
        if (result.error) return { error: result.error };
        const session = normalizeSession(result.data);
        if (!session) return { error: MISSING_TOKEN_ERROR };
        refreshTokenStore.set(session.refreshToken); // body mode only
        api.dispatch(sessionStarted({ accessToken: session.accessToken, user: session.user }));
        return { data: { user: session.user } };
      },
      invalidatesTags: (result) => (result ? ["Me"] : []),
    }),

    // Same single-flight code path as the automatic refresh on 401.
    refresh: build.mutation({
      async queryFn(_arg, api, extraOptions) {
        const result = await refreshAccessToken(api, extraOptions);
        return result.error ? { error: result.error } : { data: { user: result.data.user } };
      },
    }),

    logout: build.mutation({
      // BACKEND CONTRACT: body mode sends the refresh token so the server can revoke it.
      query: () => ({
        url: API_PATHS.LOGOUT,
        method: "POST",
        body: REFRESH_TOKEN_TRANSPORT === "body" ? { refreshToken: refreshTokenStore.get() } : undefined,
      }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
        } catch {
          // Server-side failure is reported to the caller via the mutation result.
        } finally {
          // Always end locally. This runs AFTER the mutation settles: ending the session resets
          // the API state, and doing it earlier would abort this very mutation.
          endSession(dispatch);
        }
      },
    }),

    getMe: build.query({
      query: () => API_PATHS.ME,
      transformResponse: normalizeUser,
      providesTags: ["Me"],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          if (data) dispatch(userLoaded(data));
        } catch {
          // The error is exposed through the hook's error state.
        }
      },
    }),
  }),
});

export const { useLoginMutation, useRefreshMutation, useLogoutMutation, useGetMeQuery } = authApi;
```

### `src/features/auth/components/AuthGate.jsx`
```jsx
import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { endSession, refreshTokenStore, sessionStarted } from "@/api/tokenRefresh";
import { Button } from "@/components/ui/button";
import PageLoader from "@/components/loaders/PageLoader";
import { REFRESH_TOKEN_TRANSPORT } from "@/constants/auth";
import { useRefreshMutation } from "@/features/auth/authApi";
import { selectAccessToken, selectAuthStatus } from "@/features/auth/store/authSlice";

/**
 * Restores the session once at startup, BEFORE any route guard runs, so a reload never
 * bounces a logged-in user to /login. React StrictMode runs this effect twice in dev;
 * both calls share one network request (single-flight).
 */
export default function AuthGate({ children }) {
  const { t } = useTranslation("common");
  const dispatch = useDispatch();
  const status = useSelector(selectAuthStatus);
  const accessToken = useSelector(selectAccessToken);
  const [refresh, { isError }] = useRefreshMutation();

  useEffect(() => {
    if (status !== "unknown") return;
    if (accessToken) {
      dispatch(sessionStarted({ accessToken })); // opt-in persisted token; a 401 later triggers refresh
      return;
    }
    if (REFRESH_TOKEN_TRANSPORT === "body" && !refreshTokenStore.get()) {
      endSession(dispatch); // nothing to restore
      return;
    }
    refresh();
  }, [status, accessToken, dispatch, refresh]);

  if (status !== "unknown") return children;
  if (!isError) return <PageLoader />;

  // Only transient failures (offline, 5xx) end up here. Auth failures set status to "unauthenticated".
  return (
    <div role="alert" className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm text-muted-foreground">{t("session.restoreFailed")}</p>
      <Button onClick={() => refresh()}>{t("actions.retry")}</Button>
    </div>
  );
}
```

### `src/features/auth/schemas/loginSchema.js`
```js
import { z } from "zod";

// A factory so messages are translated. The API used here works in zod v3 and v4.
export const createLoginSchema = (t) =>
  z.object({
    email: z
      .string()
      .trim()
      .min(1, t("auth:validation.emailRequired"))
      .email(t("auth:validation.emailInvalid")),
    password: z.string().min(8, t("auth:validation.passwordMin", { count: 8 })),
  });
```

### `src/features/auth/pages/LoginPage.jsx`
```jsx
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useLoginMutation } from "@/features/auth/authApi";
import { createLoginSchema } from "@/features/auth/schemas/loginSchema";
import { getApiErrorMessage } from "@/utils/getApiErrorMessage";

export default function LoginPage() {
  const { t } = useTranslation(["auth", "common"]);
  const [login, { isLoading }] = useLoginMutation();
  const schema = useMemo(() => createLoginSchema(t), [t]);

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
    mode: "onTouched",
  });

  async function onSubmit(values) {
    try {
      await login(values).unwrap();
      toast.success(t("auth:login.success"));
      // No navigate() here. The session state flips to "authenticated" and PublicRoute
      // redirects to the validated ?redirect= target. That's the one place redirects happen.
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("auth:login.failed")));
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1 className="text-2xl font-semibold">{t("auth:login.title")}</h1>
          </CardTitle>
          <CardDescription>{t("auth:login.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("auth:fields.email")}</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("auth:fields.password")}</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={isLoading} aria-busy={isLoading}>
                {isLoading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {isLoading ? t("auth:login.submitting") : t("auth:login.submit")}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}
```

## 7. Home feature (example with loading, error, and empty states)

### `src/features/home/pages/HomePage.jsx`
```jsx
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import SectionLoader from "@/components/loaders/SectionLoader";
import { useGetMeQuery } from "@/features/auth/authApi";
import { getApiErrorMessage } from "@/utils/getApiErrorMessage";

export default function HomePage() {
  const { t } = useTranslation("common");
  const { data: me, isLoading, isError, error, refetch } = useGetMeQuery();

  if (isLoading) return <SectionLoader />;

  if (isError) {
    return (
      <section role="alert" className="space-y-3">
        <p className="text-sm text-destructive">{getApiErrorMessage(error, t("errors.loadFailed"))}</p>
        <Button variant="outline" onClick={refetch}>{t("actions.retry")}</Button>
      </section>
    );
  }

  const name = me?.name || me?.email;
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">{name ? t("home.welcome", { name }) : t("home.welcomeAnonymous")}</h1>
    </section>
  );
}
```

## 8. Routes

### `src/shared/config/routes.config.js`
```js
import { Home } from "lucide-react";
import { ROUTES } from "@/constants/routes";

// Private navigation, shared by Sidebar and MobileFooter. labelKey points into locales/*/common.json.
export const PRIVATE_NAV = [{ to: ROUTES.HOME, labelKey: "nav.home", icon: Home, end: true }];
```

### `src/routes/PrivateRoute.jsx`
```jsx
import { useSelector } from "react-redux";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import PageLoader from "@/components/loaders/PageLoader";
import { ROUTES } from "@/constants/routes";
import { selectAuthStatus } from "@/features/auth/store/authSlice";

export default function PrivateRoute() {
  const status = useSelector(selectAuthStatus);
  const location = useLocation();

  if (status === "unknown") return <PageLoader />; // AuthGate normally prevents this
  if (status !== "authenticated") {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}${location.hash}`);
    return <Navigate to={`${ROUTES.LOGIN}?redirect=${redirect}`} replace />;
  }
  return <Outlet />;
}
```

### `src/routes/PublicRoute.jsx`
```jsx
import { useSelector } from "react-redux";
import { Navigate, Outlet, useSearchParams } from "react-router-dom";
import PageLoader from "@/components/loaders/PageLoader";
import { ROUTES } from "@/constants/routes";
import { selectAuthStatus } from "@/features/auth/store/authSlice";
import { getSafeRedirect } from "@/utils/getSafeRedirect";

// Logged-out-only pages (login, signup). Logged-in users go to a validated same-origin redirect.
export default function PublicRoute() {
  const status = useSelector(selectAuthStatus);
  const [params] = useSearchParams();

  if (status === "unknown") return <PageLoader />;
  if (status === "authenticated") {
    return <Navigate to={getSafeRedirect(params.get("redirect"), ROUTES.HOME, [ROUTES.LOGIN])} replace />;
  }
  return <Outlet />;
}
```

### `src/routes/AppRoutes.jsx`
```jsx
import { Suspense } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import PageLoader from "@/components/loaders/PageLoader";
import { ROUTES } from "@/constants/routes";
import Layout from "@/layout/Layout";
import LazyErrorBoundary from "@/utils/LazyErrorBoundary";
import { lazyWithRetry } from "@/utils/lazyWithRetry";
import PrivateRoute from "./PrivateRoute";
import PublicRoute from "./PublicRoute";

const LoginPage = lazyWithRetry(() => import("@/features/auth/pages/LoginPage"));
const HomePage = lazyWithRetry(() => import("@/features/home/pages/HomePage"));
const NotFound = lazyWithRetry(() => import("@/layout/NotFound"));

export default function AppRoutes() {
  const location = useLocation();
  return (
    <LazyErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route element={<PublicRoute />}>
            <Route path={ROUTES.LOGIN} element={<LoginPage />} />
          </Route>

          <Route element={<PrivateRoute />}>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              {/* more private pages here */}
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </LazyErrorBoundary>
  );
}
```

## 9. Layout, loaders, theme, toaster

### `src/layout/Layout.jsx`
```jsx
import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import SectionLoader from "@/components/loaders/SectionLoader";
import LazyErrorBoundary from "@/utils/LazyErrorBoundary";
import Header from "./Header";
import MobileFooter from "./MobileFooter";
import Sidebar from "./Sidebar";

export default function Layout() {
  const { t } = useTranslation("common");
  const location = useLocation();
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        {t("a11y.skipToContent")}
      </a>
      <Header />
      <div className="flex flex-1">
        <Sidebar />
        <main id="main-content" tabIndex={-1} className="flex-1 p-4 pb-20 outline-none md:p-6 md:pb-6">
          {/* The shell stays visible while a page chunk loads or fails. */}
          <LazyErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<SectionLoader />}>
              <Outlet />
            </Suspense>
          </LazyErrorBoundary>
        </main>
      </div>
      <MobileFooter />
    </div>
  );
}
```

### `src/layout/Header.jsx`
```jsx
import { Languages, LogOut, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/context/theme-context";
import { useLogoutMutation } from "@/features/auth/authApi";
import { selectCurrentUser } from "@/features/auth/store/authSlice";

export default function Header() {
  const { t, i18n } = useTranslation("common");
  const { resolvedTheme, setTheme } = useTheme();
  const user = useSelector(selectCurrentUser);
  const [logout, { isLoading }] = useLogoutMutation();
  const nextLanguage = i18n.resolvedLanguage === "hi" ? "en" : "hi";

  async function handleLogout() {
    const result = await logout();
    // The local session is cleared either way; tell the user if the server didn't confirm.
    if (result.error) toast.warning(t("logout.serverFailed"));
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
      <span className="font-semibold">{t("appName")}</span>
      <div className="ml-auto flex items-center gap-1">
        {user?.email && <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>}
        <Button variant="ghost" size="icon" aria-label={t("language.switch")} onClick={() => i18n.changeLanguage(nextLanguage)}>
          <Languages aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("theme.toggle")}
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          {resolvedTheme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </Button>
        <Button variant="ghost" size="sm" onClick={handleLogout} disabled={isLoading}>
          <LogOut aria-hidden="true" />
          {t("actions.logout")}
        </Button>
      </div>
    </header>
  );
}
```

### `src/layout/Sidebar.jsx`
```jsx
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { PRIVATE_NAV } from "@/shared/config/routes.config";

export default function Sidebar() {
  const { t } = useTranslation("common");
  return (
    <nav aria-label={t("nav.main")} className="hidden w-56 shrink-0 border-r p-3 md:block">
      <ul className="space-y-1">
        {PRIVATE_NAV.map(({ to, labelKey, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent",
                  isActive && "bg-accent font-medium",
                )
              }
            >
              <Icon className="size-4" aria-hidden="true" />
              {t(labelKey)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

### `src/layout/MobileFooter.jsx`
```jsx
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { PRIVATE_NAV } from "@/shared/config/routes.config";

export default function MobileFooter() {
  const { t } = useTranslation("common");
  return (
    <nav aria-label={t("nav.main")} className="fixed inset-x-0 bottom-0 z-40 border-t bg-background md:hidden">
      <ul className="flex justify-around">
        {PRIVATE_NAV.map(({ to, labelKey, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn("flex flex-col items-center gap-1 px-4 py-2 text-xs", isActive ? "text-foreground" : "text-muted-foreground")
              }
            >
              <Icon className="size-5" aria-hidden="true" />
              {t(labelKey)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

### `src/layout/NotFound.jsx`
```jsx
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/constants/routes";

export default function NotFound() {
  const { t } = useTranslation("common");
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-semibold">{t("notFound.title")}</h1>
      <p className="text-muted-foreground">{t("notFound.body")}</p>
      <Button asChild>
        <Link to={ROUTES.HOME}>{t("notFound.back")}</Link>
      </Button>
    </main>
  );
}
```

### `src/layout/AppToaster.jsx`
```jsx
import { Toaster } from "@/components/ui/sonner";
import { useTheme } from "@/context/theme-context";

// Passes the app theme into the generated shadcn Toaster WITHOUT editing components/ui/sonner.jsx.
// This works because the generated component spreads {...props} after its own theme prop.
// Check that in the project's actual file first (see the "Theme notes" below).
export default function AppToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster theme={resolvedTheme} richColors closeButton position="top-right" />;
}
```

### `src/components/loaders/PageLoader.jsx`
```jsx
import { Loader2 } from "lucide-react";

export default function PageLoader() {
  return (
    <div className="flex min-h-svh items-center justify-center" role="status" aria-live="polite">
      <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
```

### `src/components/loaders/SectionLoader.jsx`
```jsx
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function SectionLoader({ className, label = "Loading…" }) {
  return (
    <div className={cn("flex min-h-40 items-center justify-center", className)} role="status" aria-live="polite">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
```

### `src/context/theme-context.js`
```js
import { createContext, useContext } from "react";

// Split from ThemeProvider.jsx so each file exports only components or only non-components (Fast Refresh).
export const ThemeContext = createContext(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
```

### `src/context/ThemeProvider.jsx`
```jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { STORAGE_KEYS } from "@/constants/storage";
import { storage } from "@/utils/storage";
import { ThemeContext } from "./theme-context";

const THEMES = ["light", "dark", "system"];
const media = () => window.matchMedia?.("(prefers-color-scheme: dark)");
const systemTheme = () => (media()?.matches ? "dark" : "light");

export function ThemeProvider({ children, defaultTheme = "system" }) {
  const [theme, setThemeState] = useState(() => {
    const saved = storage.get(STORAGE_KEYS.THEME);
    return THEMES.includes(saved) ? saved : defaultTheme;
  });
  const [system, setSystem] = useState(systemTheme);
  const resolvedTheme = theme === "system" ? system : theme;

  useEffect(() => {
    const mq = media();
    if (!mq) return undefined;
    const onChange = () => setSystem(systemTheme());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolvedTheme === "dark");
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const setTheme = useCallback((next) => {
    if (!THEMES.includes(next)) return;
    storage.set(STORAGE_KEYS.THEME, next);
    setThemeState(next);
  }, []);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
```

**Theme notes.**
- If the project **already** has a theme provider (its own, or `next-themes` with a `ThemeProvider` mounted), reuse it and skip both theme files above. Then point `AppToaster` at that provider's hook. If it already uses `next-themes`' provider, the generated Toaster themes itself and `AppToaster` can render `<Toaster />` without a `theme` prop.
- `next-themes` gets installed by `shadcn add sonner` because the generated file imports it. Without its provider, its `useTheme()` returns no theme and the file falls back to `"system"`. Nothing breaks, and the explicit `theme` prop from `AppToaster` wins. Leave the dependency installed, since the ui file imports it.
- If the project's generated `sonner.jsx` does **not** spread `{...props}` after `theme` (for example in an older or customized version), make the smallest possible edit, or ask the user, and report it. Never overwrite user customizations.
- To avoid a light-mode flash before React mounts, you can add a tiny inline script to `index.html` that applies the `dark` class from `localStorage["app.theme"]`. It's optional, so ask first.

## 10. i18n

### `src/i18n.js`
```js
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { STORAGE_KEYS } from "@/constants/storage";
import { storage } from "@/utils/storage";
import enAuth from "@/locales/en/auth.json";
import enCommon from "@/locales/en/common.json";
import hiAuth from "@/locales/hi/auth.json";
import hiCommon from "@/locales/hi/common.json";

export const SUPPORTED_LANGUAGES = ["en", "hi"];

const saved = storage.get(STORAGE_KEYS.LANGUAGE);

i18n.on("languageChanged", (lng) => {
  storage.set(STORAGE_KEYS.LANGUAGE, lng);
  if (typeof document !== "undefined") document.documentElement.lang = lng;
});

i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon, auth: enAuth },
    hi: { common: hiCommon, auth: hiAuth },
  },
  lng: SUPPORTED_LANGUAGES.includes(saved) ? saved : "en",
  fallbackLng: "en",
  supportedLngs: SUPPORTED_LANGUAGES,
  ns: ["common", "auth"],
  defaultNS: "common",
  interpolation: { escapeValue: false }, // React already escapes
  initAsync: false, // bundled resources → ready synchronously (option name for i18next ≥ 24; older: initImmediate)
});

export default i18n;
```

### `src/locales/en/common.json`
```json
{
  "appName": "App",
  "nav": { "main": "Main navigation", "home": "Home" },
  "actions": { "logout": "Log out", "retry": "Try again" },
  "theme": { "toggle": "Toggle dark mode" },
  "language": { "switch": "Switch language" },
  "a11y": { "skipToContent": "Skip to content" },
  "home": { "welcome": "Welcome, {{name}}", "welcomeAnonymous": "Welcome" },
  "session": { "restoreFailed": "We couldn't reach the server to restore your session." },
  "logout": { "serverFailed": "You were signed out on this device, but the server didn't confirm the logout." },
  "errors": { "loadFailed": "Couldn't load this content." },
  "notFound": { "title": "Page not found", "body": "The page you're looking for doesn't exist.", "back": "Go home" }
}
```

### `src/locales/hi/common.json`
```json
{
  "appName": "ऐप",
  "nav": { "main": "मुख्य नेविगेशन", "home": "होम" },
  "actions": { "logout": "लॉग आउट", "retry": "फिर से कोशिश करें" },
  "theme": { "toggle": "डार्क मोड बदलें" },
  "language": { "switch": "भाषा बदलें" },
  "a11y": { "skipToContent": "मुख्य सामग्री पर जाएँ" },
  "home": { "welcome": "स्वागत है, {{name}}", "welcomeAnonymous": "स्वागत है" },
  "session": { "restoreFailed": "आपका सत्र बहाल करने के लिए सर्वर से संपर्क नहीं हो सका।" },
  "logout": { "serverFailed": "आप इस डिवाइस से साइन आउट हो गए, लेकिन सर्वर ने लॉगआउट की पुष्टि नहीं की।" },
  "errors": { "loadFailed": "यह सामग्री लोड नहीं हो सकी।" },
  "notFound": { "title": "पेज नहीं मिला", "body": "आप जो पेज ढूंढ रहे हैं वह मौजूद नहीं है।", "back": "होम पर जाएँ" }
}
```

### `src/locales/en/auth.json`
```json
{
  "login": {
    "title": "Sign in",
    "subtitle": "Enter your email and password to continue.",
    "submit": "Sign in",
    "submitting": "Signing in…",
    "success": "Signed in successfully",
    "failed": "Login failed"
  },
  "fields": { "email": "Email", "password": "Password" },
  "validation": {
    "emailRequired": "Email is required",
    "emailInvalid": "Enter a valid email address",
    "passwordMin": "Password must be at least {{count}} characters"
  }
}
```

### `src/locales/hi/auth.json`
```json
{
  "login": {
    "title": "साइन इन करें",
    "subtitle": "जारी रखने के लिए अपना ईमेल और पासवर्ड दर्ज करें।",
    "submit": "साइन इन",
    "submitting": "साइन इन हो रहा है…",
    "success": "सफलतापूर्वक साइन इन हुआ",
    "failed": "लॉगिन विफल रहा"
  },
  "fields": { "email": "ईमेल", "password": "पासवर्ड" },
  "validation": {
    "emailRequired": "ईमेल आवश्यक है",
    "emailInvalid": "मान्य ईमेल पता दर्ज करें",
    "passwordMin": "पासवर्ड कम से कम {{count}} अक्षरों का होना चाहिए"
  }
}
```

## 11. Entry

### `src/main.jsx`
```jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import "@/i18n";
import "@/index.css";
import App from "@/App";
import { store } from "@/app/store";
import { ThemeProvider } from "@/context/ThemeProvider";
import AppToaster from "@/layout/AppToaster";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Provider store={store}>
      <ThemeProvider>
        <BrowserRouter>
          <App />
          <AppToaster />
        </BrowserRouter>
      </ThemeProvider>
    </Provider>
  </StrictMode>,
);
```

### `src/App.jsx`
```jsx
import AuthGate from "@/features/auth/components/AuthGate";
import AppRoutes from "@/routes/AppRoutes";

export default function App() {
  return (
    <AuthGate>
      <AppRoutes />
    </AuthGate>
  );
}
```
Delete the Vite starter's `src/App.css` and its demo assets only if the user agrees and nothing else imports them.
