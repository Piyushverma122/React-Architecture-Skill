# TypeScript Projects

Use this guide when the project is TypeScript: there's a `tsconfig.json` or `.ts`/`.tsx` files, or the user chose TS in Phase 3. The architecture, folder rules, and behavior are identical to the JS templates. Only the file extensions and types change. **Don't mix:** a TS project gets `.ts`/`.tsx` infrastructure files, and a JS project gets `.js`/`.jsx` ones.

**Verification status.** On 2026-11-06 the typed files below were checked with TypeScript 7.0.2 (`tsc --noEmit`), under the options `strict`, `verbatimModuleSyntax`, `noUnusedLocals`, `noUnusedParameters`, and `erasableSyntaxOnly`. The other files were the JS templates with `allowJs`, and versions were the same as in `code-templates.md`. The suite in `testing.md` also passed against them. In that harness, `components/ui/button` was JS, so a small `.d.ts` shim stood in for the typed `button.tsx` that shadcn generates in a real TS project. The files covered only by the conversion rules weren't individually type-checked as `.tsx`.

## 1. Project config differences

- **Aliases:** the Vite react-ts template usually splits its config into `tsconfig.json` (with references), `tsconfig.app.json`, and `tsconfig.node.json`. Add `"paths": { "@/*": ["./src/*"] }` to **both** `tsconfig.json` (the shadcn CLI reads it) and `tsconfig.app.json` (`tsc -b` uses it). No `jsconfig.json`.
- **`baseUrl`:** TypeScript 7 **removed** `baseUrl` (TS 6 deprecated it); `paths` now resolve relative to the tsconfig file. Check `npx tsc -v`. Add `"baseUrl": "."` only for TS ≤ 5, where older docs (including older shadcn docs) required it. If an existing config has `baseUrl` and the installed tsc rejects it, tell the user before removing it.
- **`vite.config.ts`:** same content as the JS version. `node:url` needs `npm i -D @types/node`.
- **shadcn:** `init` detects TS and writes `"tsx": true` along with `.tsx` components. Don't override it.
- **Type check:** the template's `build` script is usually `tsc -b && vite build`. If it isn't, run `npx tsc -b` (or `npx tsc --noEmit -p tsconfig.app.json`) as part of verification.
- **Env typing:** add the file below.

### `src/vite-env.d.ts`
```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

## 2. Mechanical conversion rules (for files without a typed version below)

- `.js` → `.ts` and `.jsx` → `.tsx`. Keep the same names and paths.
- Use `import type { X }` for type-only imports (`verbatimModuleSyntax`).
- In components, use `useAppDispatch`/`useAppSelector` from `@/app/hooks` instead of `useDispatch`/`useSelector`.
- Props: `{ children }: { children: ReactNode }`. Optional props get `?`.
- Constants: add `as const` to objects like `ROUTES`, `API_PATHS`, and `STORAGE_KEYS`.
- Translation JSON imports work with `resolveJsonModule`, which the Vite template enables.
- Never use `any` to silence an error. Use `unknown` and narrow it.

## 3. Typed files

### `src/constants/auth.ts`
```ts
export type RefreshTokenTransport = "cookie" | "body";
export type BodyRefreshTokenStorage = "local" | "memory";

// Decided WITH THE USER. See auth-and-security.md.
export const REFRESH_TOKEN_TRANSPORT: RefreshTokenTransport = "cookie";
export const BODY_REFRESH_TOKEN_STORAGE: BodyRefreshTokenStorage = "local";
```

### `src/api/responseAdapter.ts`
```ts
// BACKEND CONTRACT: the ONLY place that knows how the backend shapes its responses (see the JS version for the accepted shapes).

export type AuthUser = { id?: string | number; email?: string; name?: string } & Record<string, unknown>;

export interface Session {
  accessToken: string;
  refreshToken: string | null;
  user: AuthUser | null;
}

type PlainObject = Record<string, unknown>;

const ENVELOPE_META_KEYS = new Set([
  "success", "status", "statusCode", "code", "message", "meta", "timestamp", "errors", "error",
]);

const isPlainObject = (value: unknown): value is PlainObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

export function isEnvelopeFailure(body: unknown): body is PlainObject & { success: false } {
  return isPlainObject(body) && body.success === false;
}

export function unwrapEnvelope(body: unknown): unknown {
  if (!isPlainObject(body) || !("data" in body)) return body;
  const onlyMeta = Object.keys(body).every((key) => key === "data" || ENVELOPE_META_KEYS.has(key));
  return onlyMeta ? body.data : body;
}

export function normalizeUser(body: unknown): AuthUser | null {
  const payload = unwrapEnvelope(body);
  if (!isPlainObject(payload)) return null;
  const user = isPlainObject(payload.user) ? payload.user : payload;
  return Object.keys(user).length > 0 ? (user as AuthUser) : null;
}

export function normalizeSession(body: unknown): Session | null {
  const payload = unwrapEnvelope(body);
  if (!isPlainObject(payload)) return null;
  const tokens = isPlainObject(payload.tokens) ? payload.tokens : payload;
  const accessToken = nonEmptyString(tokens.accessToken ?? tokens.access_token ?? tokens.token);
  if (!accessToken) return null;
  return {
    accessToken,
    refreshToken: nonEmptyString(tokens.refreshToken ?? tokens.refresh_token),
    user: isPlainObject(payload.user) ? (payload.user as AuthUser) : null,
  };
}

export const unwrapData = (body: unknown): unknown => unwrapEnvelope(body);
```

### `src/api/tokenRefresh.ts`
```ts
import { createAction, type Dispatch } from "@reduxjs/toolkit";
import type { BaseQueryApi, BaseQueryFn, FetchArgs, FetchBaseQueryError } from "@reduxjs/toolkit/query";
import { API_PATHS } from "@/constants/api";
import { BODY_REFRESH_TOKEN_STORAGE, REFRESH_TOKEN_TRANSPORT } from "@/constants/auth";
import { STORAGE_KEYS } from "@/constants/storage";
import { storage } from "@/utils/storage";
import { normalizeSession, type AuthUser } from "./responseAdapter";

export const sessionStarted = createAction<{ accessToken: string; user?: AuthUser | null }>("auth/sessionStarted");
export const sessionEnded = createAction("auth/sessionEnded");

export type RawBaseQuery = BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError>;
type ExtraOptions = Parameters<RawBaseQuery>[2];
export type RefreshResult =
  | { data: { accessToken: string; user: AuthUser | null }; error?: undefined }
  | { error: FetchBaseQueryError; data?: undefined };

let memoryRefreshToken: string | null = null;
const isBodyMode = REFRESH_TOKEN_TRANSPORT === "body";
const useLocal = BODY_REFRESH_TOKEN_STORAGE === "local";

export const refreshTokenStore = {
  get(): string | null {
    if (!isBodyMode) return null;
    return useLocal ? storage.get(STORAGE_KEYS.REFRESH_TOKEN) : memoryRefreshToken;
  },
  set(token: string | null | undefined): void {
    if (!isBodyMode || !token) return;
    if (useLocal) storage.set(STORAGE_KEYS.REFRESH_TOKEN, token);
    else memoryRefreshToken = token;
  },
  clear(): void {
    memoryRefreshToken = null;
    storage.remove(STORAGE_KEYS.REFRESH_TOKEN);
  },
};

export function endSession(dispatch: Dispatch): void {
  refreshTokenStore.clear();
  dispatch(sessionEnded());
}

let inFlight: Promise<RefreshResult> | null = null;

export const waitForRefresh = (): Promise<unknown> => inFlight ?? Promise.resolve();

const AUTH_FAILURE_STATUSES = new Set<FetchBaseQueryError["status"]>([400, 401, 403]);

export function refreshSession(rawBaseQuery: RawBaseQuery, api: BaseQueryApi, extraOptions: ExtraOptions): Promise<RefreshResult> {
  if (!inFlight) {
    inFlight = runRefresh(rawBaseQuery, api, extraOptions).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function runRefresh(rawBaseQuery: RawBaseQuery, api: BaseQueryApi, extraOptions: ExtraOptions): Promise<RefreshResult> {
  let body: { refreshToken: string } | undefined;
  if (isBodyMode) {
    const refreshToken = refreshTokenStore.get();
    if (!refreshToken) return fail(api, { status: "CUSTOM_ERROR", error: "No refresh token available." });
    body = { refreshToken }; // BACKEND CONTRACT
  }

  const result = await rawBaseQuery({ url: API_PATHS.REFRESH, method: "POST", body }, api, extraOptions);
  if (result.error) {
    return AUTH_FAILURE_STATUSES.has(result.error.status) ? fail(api, result.error) : { error: result.error };
  }

  const session = normalizeSession(result.data);
  if (!session) return fail(api, { status: "CUSTOM_ERROR", error: "Refresh response had no access token." });

  refreshTokenStore.set(session.refreshToken);
  api.dispatch(sessionStarted({ accessToken: session.accessToken, user: session.user }));
  return { data: { accessToken: session.accessToken, user: session.user } };
}

function fail(api: BaseQueryApi, error: FetchBaseQueryError): RefreshResult {
  endSession(api.dispatch);
  return { error };
}
```

### `src/api/baseApi.ts`
```ts
import { createApi, fetchBaseQuery, type BaseQueryApi, type FetchArgs } from "@reduxjs/toolkit/query/react";
import { API_BASE_URL } from "@/config/env";
import { API_PATHS, REQUEST_TIMEOUT_MS } from "@/constants/api";
import { REFRESH_TOKEN_TRANSPORT } from "@/constants/auth";
import { isEnvelopeFailure } from "./responseAdapter";
import { refreshSession, waitForRefresh, type RawBaseQuery } from "./tokenRefresh";

// api/ must not import app/store types (layering), so it describes only what it reads.
type StateWithAuth = { auth?: { accessToken: string | null } };
const accessTokenOf = (api: Pick<BaseQueryApi, "getState">) => (api.getState() as StateWithAuth).auth?.accessToken ?? null;

const fetchQuery = fetchBaseQuery({
  baseUrl: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  credentials: REFRESH_TOKEN_TRANSPORT === "cookie" ? "include" : "same-origin",
  prepareHeaders: (headers, api) => {
    const token = accessTokenOf(api);
    if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  },
});

const rawBaseQuery: RawBaseQuery = async (args, api, extraOptions) => {
  const result = await fetchQuery(args, api, extraOptions);
  if (!result.error && isEnvelopeFailure(result.data)) {
    const error = typeof result.data.message === "string" ? result.data.message : "Request failed.";
    return { error: { status: "CUSTOM_ERROR", error, data: result.data }, meta: result.meta };
  }
  return result;
};

const NO_REFRESH_PATHS = new Set<string>([API_PATHS.LOGIN, API_PATHS.REFRESH, API_PATHS.LOGOUT]);
const pathOf = (args: string | FetchArgs) => (typeof args === "string" ? args : args.url).split("?")[0];

export const baseQueryWithReauth: RawBaseQuery = async (args, api, extraOptions) => {
  await waitForRefresh();
  const tokenUsed = accessTokenOf(api);

  const result = await rawBaseQuery(args, api, extraOptions);
  if (result.error?.status !== 401 || NO_REFRESH_PATHS.has(pathOf(args))) return result;
  if (!tokenUsed) return result;

  const current = accessTokenOf(api);
  if (current && current !== tokenUsed) return rawBaseQuery(args, api, extraOptions);

  const refreshed = await refreshSession(rawBaseQuery, api, extraOptions);
  if (refreshed.error) return result;

  return rawBaseQuery(args, api, extraOptions);
};

export const refreshAccessToken = (api: BaseQueryApi, extraOptions: Parameters<RawBaseQuery>[2]) =>
  refreshSession(rawBaseQuery, api, extraOptions);

export const baseApi = createApi({
  reducerPath: "api",
  baseQuery: baseQueryWithReauth,
  tagTypes: ["Me"],
  endpoints: () => ({}),
});
```

### `src/app/store.ts`
```ts
import { configureStore, createListenerMiddleware } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
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

export const store = configureStore({
  reducer: {
    [baseApi.reducerPath]: baseApi.reducer,
    auth: authReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().prepend(sessionListener.middleware).concat(baseApi.middleware),
});

setupListeners(store.dispatch);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
```

### `src/app/hooks.ts`
```ts
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "./store";

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
```

### `src/features/auth/store/authSlice.ts`
```ts
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AuthUser } from "@/api/responseAdapter";
import { sessionEnded, sessionStarted } from "@/api/tokenRefresh";

export type AuthStatus = "unknown" | "authenticated" | "unauthenticated";

export interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  status: AuthStatus;
}

const initialState: AuthState = { user: null, accessToken: null, status: "unknown" };

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    userLoaded(state, { payload }: PayloadAction<AuthUser>) {
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
      .addCase(sessionEnded, (): AuthState => ({ ...initialState, status: "unauthenticated" }));
  },
});

export const { userLoaded } = authSlice.actions;
export default authSlice.reducer;

// Typed against the slice (not RootState) to avoid a store ↔ slice import cycle.
type StateWithAuth = { auth: AuthState };
export const selectCurrentUser = (state: StateWithAuth) => state.auth.user;
export const selectAccessToken = (state: StateWithAuth) => state.auth.accessToken;
export const selectAuthStatus = (state: StateWithAuth) => state.auth.status;
export const selectIsAuthenticated = (state: StateWithAuth) => state.auth.status === "authenticated";
```

### `src/features/auth/authApi.ts`
```ts
import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import { baseApi, refreshAccessToken } from "@/api/baseApi";
import { normalizeSession, normalizeUser, type AuthUser } from "@/api/responseAdapter";
import { endSession, refreshTokenStore, sessionStarted } from "@/api/tokenRefresh";
import { API_PATHS } from "@/constants/api";
import { REFRESH_TOKEN_TRANSPORT } from "@/constants/auth";
import { userLoaded } from "./store/authSlice";

export interface LoginCredentials {
  email: string;
  password: string;
}

const MISSING_TOKEN_ERROR: FetchBaseQueryError = {
  status: "CUSTOM_ERROR",
  error: "The server response did not include an access token.",
};

export const authApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    login: build.mutation<{ user: AuthUser | null }, LoginCredentials>({
      async queryFn(credentials, api, _extraOptions, baseQuery) {
        const result = await baseQuery({ url: API_PATHS.LOGIN, method: "POST", body: credentials });
        if (result.error) return { error: result.error };
        const session = normalizeSession(result.data);
        if (!session) return { error: MISSING_TOKEN_ERROR };
        refreshTokenStore.set(session.refreshToken);
        api.dispatch(sessionStarted({ accessToken: session.accessToken, user: session.user }));
        return { data: { user: session.user } };
      },
      invalidatesTags: (result) => (result ? ["Me"] : []),
    }),

    refresh: build.mutation<{ user: AuthUser | null }, void>({
      async queryFn(_arg, api, extraOptions) {
        const result = await refreshAccessToken(api, extraOptions);
        return result.error ? { error: result.error } : { data: { user: result.data.user } };
      },
    }),

    logout: build.mutation<unknown, void>({
      query: () => ({
        url: API_PATHS.LOGOUT,
        method: "POST",
        body: REFRESH_TOKEN_TRANSPORT === "body" ? { refreshToken: refreshTokenStore.get() } : undefined,
      }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
        } catch {
          // Reported to the caller via the mutation result.
        } finally {
          endSession(dispatch);
        }
      },
    }),

    getMe: build.query<AuthUser | null, void>({
      query: () => API_PATHS.ME,
      transformResponse: (body: unknown) => normalizeUser(body),
      providesTags: ["Me"],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          if (data) dispatch(userLoaded(data));
        } catch {
          // Exposed through the hook's error state.
        }
      },
    }),
  }),
});

export const { useLoginMutation, useRefreshMutation, useLogoutMutation, useGetMeQuery } = authApi;
```

### `src/utils/chunkErrors.ts`
```ts
const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
  /Loading (CSS )?chunk [\w-]+ failed/i,
];

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error) && (typeof error !== "object" || error === null)) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "ChunkLoadError") return true;
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(String(message ?? "")));
}
```

### `src/utils/lazyWithRetry.ts`
```ts
import { lazy, type ComponentType } from "react";
import { STORAGE_KEYS } from "@/constants/storage";
import { isChunkLoadError } from "@/utils/chunkErrors";
import { sessionStore } from "@/utils/storage";

export interface RetryOptions {
  retries?: number;
  delayMs?: number;
}

const RELOAD_COOLDOWN_MS = 60_000;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function reloadOnceForChunkError(): boolean {
  if (!sessionStore.isAvailable()) return false;
  const last = Number(sessionStore.get(STORAGE_KEYS.CHUNK_RELOAD_AT)) || 0;
  if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
  if (!sessionStore.set(STORAGE_KEYS.CHUNK_RELOAD_AT, String(Date.now()))) return false;
  window.location.reload();
  return true;
}

export async function loadWithRetry<T>(factory: () => Promise<T>, { retries = 2, delayMs = 400 }: RetryOptions = {}): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await factory();
    } catch (error) {
      if (!isChunkLoadError(error)) throw error;
      lastError = error;
      if (attempt < retries) await wait(delayMs * 2 ** attempt);
    }
  }
  if (reloadOnceForChunkError()) return new Promise<T>(() => {});
  throw lastError;
}

// `ComponentType<any>` mirrors React.lazy's own signature so pages with any props are accepted.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const lazyWithRetry = <T extends ComponentType<any>>(factory: () => Promise<{ default: T }>, options?: RetryOptions) =>
  lazy(() => loadWithRetry(factory, options));
```

### `src/utils/storage.ts`
```ts
interface SafeStore {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
  isAvailable(): boolean;
}

function createStore(getStorage: () => Storage): SafeStore {
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

### `src/utils/LazyErrorBoundary.tsx`
```tsx
import { Component, type ErrorInfo, type ReactNode } from "react";
import { isChunkLoadError } from "@/utils/chunkErrors";

interface FallbackArgs {
  error: Error;
  isChunkError: boolean;
  retry: () => void;
  reload: () => void;
}

interface Props {
  children: ReactNode;
  resetKey?: unknown;
  onReset?: () => void;
  fallback?: (args: FallbackArgs) => ReactNode;
}

interface State {
  error: Error | null;
  resetKey: unknown;
}

export default class LazyErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.resetKey) return null;
    return { resetKey: props.resetKey, error: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error("[LazyErrorBoundary]", error, info.componentStack);
  }

  retry = () => {
    if (isChunkLoadError(this.state.error)) return this.reload();
    this.setState({ error: null });
    this.props.onReset?.();
  };

  reload = () => window.location.reload();

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const isChunkError = isChunkLoadError(error);
    if (this.props.fallback) return this.props.fallback({ error, isChunkError, retry: this.retry, reload: this.reload });
    // Markup shortened here. Use the JS template's full markup (description text, focus styles).
    return (
      <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <h2 className="text-lg font-semibold">
          {isChunkError ? "This part of the app couldn't be loaded" : "Something went wrong"}
        </h2>
        <div className="flex gap-2">
          <button type="button" onClick={this.retry} className="rounded-md border px-4 py-2 text-sm font-medium">
            Retry
          </button>
          <button type="button" onClick={this.reload} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Reload
          </button>
        </div>
      </div>
    );
  }
}
```

### `src/routes/PrivateRoute.tsx`
```tsx
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAppSelector } from "@/app/hooks";
import PageLoader from "@/components/loaders/PageLoader";
import { ROUTES } from "@/constants/routes";
import { selectAuthStatus } from "@/features/auth/store/authSlice";

export default function PrivateRoute() {
  const status = useAppSelector(selectAuthStatus);
  const location = useLocation();

  if (status === "unknown") return <PageLoader />;
  if (status !== "authenticated") {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}${location.hash}`);
    return <Navigate to={`${ROUTES.LOGIN}?redirect=${redirect}`} replace />;
  }
  return <Outlet />;
}
```

### `src/features/auth/components/AuthGate.tsx`
```tsx
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { endSession, refreshTokenStore, sessionStarted } from "@/api/tokenRefresh";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import PageLoader from "@/components/loaders/PageLoader";
import { REFRESH_TOKEN_TRANSPORT } from "@/constants/auth";
import { useRefreshMutation } from "@/features/auth/authApi";
import { selectAccessToken, selectAuthStatus } from "@/features/auth/store/authSlice";

export default function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation("common");
  const dispatch = useAppDispatch();
  const status = useAppSelector(selectAuthStatus);
  const accessToken = useAppSelector(selectAccessToken);
  const [refresh, { isError }] = useRefreshMutation();

  useEffect(() => {
    if (status !== "unknown") return;
    if (accessToken) {
      dispatch(sessionStarted({ accessToken }));
      return;
    }
    if (REFRESH_TOKEN_TRANSPORT === "body" && !refreshTokenStore.get()) {
      endSession(dispatch);
      return;
    }
    void refresh();
  }, [status, accessToken, dispatch, refresh]);

  if (status !== "unknown") return children;
  if (!isError) return <PageLoader />;

  return (
    <div role="alert" className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm text-muted-foreground">{t("session.restoreFailed")}</p>
      <Button onClick={() => void refresh()}>{t("actions.retry")}</Button>
    </div>
  );
}
```

Form typing (LoginPage): `type LoginValues = z.infer<ReturnType<typeof createLoginSchema>>`, then `useForm<LoginValues>({ resolver: zodResolver(schema), ... })`. With zod v4 + @hookform/resolvers ≥ 5, input and output types are inferred. If `.trim()` makes them differ, use `useForm<z.input<S>, unknown, z.output<S>>`.
