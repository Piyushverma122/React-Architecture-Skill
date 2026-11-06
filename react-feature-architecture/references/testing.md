# Testing the Architecture (optional, recommended)

These Vitest suites check the parts that are easiest to get subtly wrong:
- response normalization
- the 401 → single-flight refresh → retry flow
- session expiry and logout
- both refresh-token transports
- safe redirects
- the chunk reload guard
- session restore in `AuthGate`
- form validation
- i18n init

**Status:** on 2026-11-06 all suites below passed against the JS templates in `code-templates.md` (Vitest 5.1, jsdom 31, Node 26).

Install test tooling **only with the user's approval**. If the project already has a runner (Jest, Vitest), adapt the files to it instead of adding a second one. To add Vitest:
`npm i -D vitest jsdom`, then add `"test": "vitest run"` to `package.json` scripts.

The API tests run in the **node** environment on purpose. Under jsdom, `fetchBaseQuery` builds a Node `Request` with a jsdom `AbortSignal`, and Node rejects it. Only the `AuthGate` test uses jsdom, and it swaps in Node's `AbortController` for that reason.

### `vitest.config.js`
```js
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.js";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "node",
      env: { VITE_API_BASE_URL: "http://api.test" },
      include: ["src/**/*.test.{js,jsx}"],
    },
  }),
);
```

### `src/test/fakeBackend.js`
```js
import { vi } from "vitest";

/** In-memory Web Storage for tests. */
export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
}

/**
 * Stubs global fetch. `routes` maps a pathname (or "/ping" for any /ping/*) to
 * (call) => [status, json, delayMs?]. Returns the list of recorded calls.
 */
export function fakeBackend(routes) {
  const calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      const text = req.method === "GET" ? "" : await req.clone().text();
      const call = {
        path: url.pathname,
        method: req.method,
        auth: req.headers.get("authorization"),
        credentials: req.credentials,
        body: text ? JSON.parse(text) : undefined,
      };
      calls.push(call);
      const key = url.pathname.startsWith("/ping") ? "/ping" : url.pathname;
      const handler = routes[key];
      if (!handler) return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
      const [status, json, delayMs = 0] = await handler(call);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return new Response(JSON.stringify(json ?? null), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return calls;
}

/** Fresh module graph (store, single-flight state) per test. mode: "cookie" | "body". */
export async function setupApp({ mode = "cookie" } = {}) {
  vi.resetModules();
  if (mode === "body") {
    vi.doMock("@/constants/auth", () => ({ REFRESH_TOKEN_TRANSPORT: "body", BODY_REFRESH_TOKEN_STORAGE: "local" }));
  } else {
    vi.doUnmock("@/constants/auth");
  }
  const { store } = await import("@/app/store");
  const { baseApi } = await import("@/api/baseApi");
  const tokenRefresh = await import("@/api/tokenRefresh");
  const { authApi } = await import("@/features/auth/authApi");
  const testApi = baseApi.injectEndpoints({
    endpoints: (build) => ({ ping: build.query({ query: (n) => `/ping/${n}`, keepUnusedDataFor: 0 }) }),
    overrideExisting: true,
  });
  return { store, baseApi, testApi, authApi, ...tokenRefresh };
}
```

### `src/api/__tests__/responseAdapter.test.js`
```js
import { describe, expect, it } from "vitest";
import { isEnvelopeFailure, normalizeSession, normalizeUser, unwrapEnvelope } from "@/api/responseAdapter";

describe("responseAdapter", () => {
  const user = { id: 1, email: "a@b.c" };

  it.each([
    ["flat", { accessToken: "t", user }],
    ["data envelope", { data: { accessToken: "t", user } }],
    ["success envelope", { success: true, message: "ok", data: { accessToken: "t", user } }],
    ["tokens object", { tokens: { access_token: "t" }, user }],
  ])("normalizeSession handles %s", (_name, body) => {
    expect(normalizeSession(body)).toEqual({ accessToken: "t", refreshToken: null, user });
  });

  it("normalizeSession returns null without a usable token", () => {
    for (const body of [null, "x", [], {}, { accessToken: "" }, { data: { user } }, { accessToken: 42 }]) {
      expect(normalizeSession(body)).toBeNull();
    }
  });

  it("normalizeSession keeps the refresh token for body mode", () => {
    expect(normalizeSession({ accessToken: "t", refreshToken: "r" }).refreshToken).toBe("r");
  });

  it("normalizeUser accepts user, { user } and envelopes", () => {
    expect(normalizeUser(user)).toEqual(user);
    expect(normalizeUser({ user })).toEqual(user);
    expect(normalizeUser({ success: true, data: { user } })).toEqual(user);
    expect(normalizeUser({ data: user })).toEqual(user);
    expect(normalizeUser({})).toBeNull();
    expect(normalizeUser(null)).toBeNull();
  });

  it("does not unwrap a resource that merely has a data field", () => {
    const resource = { id: 1, data: { x: 1 } };
    expect(unwrapEnvelope(resource)).toBe(resource);
  });

  it("detects 2xx failure envelopes", () => {
    expect(isEnvelopeFailure({ success: false, message: "no" })).toBe(true);
    expect(isEnvelopeFailure({ success: true })).toBe(false);
  });
});
```

### `src/api/__tests__/authFlow.test.js`
```js
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeBackend, memoryStorage, setupApp } from "@/test/fakeBackend";

afterEach(() => {
  vi.unstubAllGlobals();
});

// /ping succeeds only with the current valid token.
const pingRoute = (valid) => (call) => (call.auth === `Bearer ${valid()}` ? [200, { ok: true }] : [401, { message: "expired" }]);

describe("baseQueryWithReauth", () => {
  it("parallel 401s share ONE refresh, then each request is retried once", async () => {
    let valid = "new";
    const calls = fakeBackend({
      "/ping": pingRoute(() => valid),
      "/auth/refresh": () => [200, { accessToken: "new" }, 30],
    });
    const { store, testApi, sessionStarted } = await setupApp();
    store.dispatch(sessionStarted({ accessToken: "old" }));

    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => store.dispatch(testApi.endpoints.ping.initiate(n))));

    expect(calls.filter((c) => c.path === "/auth/refresh")).toHaveLength(1);
    expect(results.every((r) => r.data?.ok)).toBe(true);
    expect(store.getState().auth).toMatchObject({ accessToken: "new", status: "authenticated" });
  });

  it("a failed refresh ends the session once and never loops", async () => {
    const calls = fakeBackend({
      "/ping": () => [401, { message: "expired" }],
      "/auth/refresh": () => [401, { message: "refresh expired" }],
    });
    const { store, testApi, sessionStarted } = await setupApp();
    store.dispatch(sessionStarted({ accessToken: "old" }));

    const results = await Promise.all([1, 2, 3].map((n) => store.dispatch(testApi.endpoints.ping.initiate(n))));

    expect(calls.filter((c) => c.path === "/auth/refresh")).toHaveLength(1);
    expect(calls.filter((c) => c.path.startsWith("/ping"))).toHaveLength(3); // no retries
    expect(store.getState().auth).toMatchObject({ accessToken: null, user: null, status: "unauthenticated" });
    // sessionEnded resets the API cache, so in-flight queries are dropped rather than cached as errors.
    expect(results.every((r) => !r.data)).toBe(true);
    expect(Object.keys(store.getState().api.queries)).toHaveLength(0);
  });

  it("a transient refresh failure (5xx/offline) keeps the session", async () => {
    fakeBackend({
      "/ping": () => [401, {}],
      "/auth/refresh": () => [503, { message: "down" }],
    });
    const { store, testApi, sessionStarted } = await setupApp();
    store.dispatch(sessionStarted({ accessToken: "old" }));

    const result = await store.dispatch(testApi.endpoints.ping.initiate(1));

    expect(result.error.status).toBe(401);
    expect(store.getState().auth).toMatchObject({ accessToken: "old", status: "authenticated" });
  });

  it("an anonymous 401 does not try to refresh", async () => {
    const calls = fakeBackend({ "/ping": () => [401, {}], "/auth/refresh": () => [200, { accessToken: "x" }] });
    const { store, testApi } = await setupApp();
    await store.dispatch(testApi.endpoints.ping.initiate(1));
    expect(calls.some((c) => c.path === "/auth/refresh")).toBe(false);
  });

  it("turns a 2xx { success: false } envelope into an error", async () => {
    fakeBackend({ "/ping": () => [200, { success: false, message: "Nope" }] });
    const { store, testApi } = await setupApp();
    const result = await store.dispatch(testApi.endpoints.ping.initiate(1));
    expect(result.error).toMatchObject({ status: "CUSTOM_ERROR", error: "Nope" });
  });
});

describe("auth endpoints (cookie mode)", () => {
  it("login normalizes an envelope, starts the session, keeps tokens out of the cache", async () => {
    const calls = fakeBackend({
      "/auth/login": () => [200, { success: true, data: { accessToken: "a1", user: { id: 1, email: "u@x.io" } } }],
    });
    const { store, authApi } = await setupApp();

    const result = await store.dispatch(authApi.endpoints.login.initiate({ email: "u@x.io", password: "secret123" }));

    expect(result.data).toEqual({ user: { id: 1, email: "u@x.io" } });
    expect(store.getState().auth).toMatchObject({ accessToken: "a1", status: "authenticated" });
    expect(JSON.stringify(store.getState().api)).not.toContain("a1");
    expect(calls[0].credentials).toBe("include");
  });

  it("login 401 is returned as an error and never triggers a refresh", async () => {
    const calls = fakeBackend({ "/auth/login": () => [401, { message: "Invalid credentials" }] });
    const { store, authApi } = await setupApp();
    const result = await store.dispatch(authApi.endpoints.login.initiate({ email: "u@x.io", password: "wrongpass" }));
    expect(result.error).toMatchObject({ status: 401, data: { message: "Invalid credentials" } });
    expect(calls.some((c) => c.path === "/auth/refresh")).toBe(false);
  });

  it("login without an access token in the response is an error", async () => {
    fakeBackend({ "/auth/login": () => [200, { user: { id: 1 } }] });
    const { store, authApi } = await setupApp();
    const result = await store.dispatch(authApi.endpoints.login.initiate({ email: "u@x.io", password: "secret123" }));
    expect(result.error.status).toBe("CUSTOM_ERROR");
    expect(store.getState().auth.status).toBe("unknown");
  });

  it("explicit refresh shares the single-flight path with automatic refresh", async () => {
    const calls = fakeBackend({
      "/ping": pingRoute(() => "new"),
      "/auth/refresh": () => [200, { accessToken: "new", user: { id: 7 } }, 30],
    });
    const { store, authApi, testApi, sessionStarted } = await setupApp();
    store.dispatch(sessionStarted({ accessToken: "old" }));

    await Promise.all([
      store.dispatch(authApi.endpoints.refresh.initiate()),
      store.dispatch(testApi.endpoints.ping.initiate(1)),
    ]);

    expect(calls.filter((c) => c.path === "/auth/refresh")).toHaveLength(1);
    expect(store.getState().auth.user).toEqual({ id: 7 });
  });

  it("logout ends the session and clears the cache even if the server fails", async () => {
    fakeBackend({ "/ping": () => [200, { ok: true }], "/auth/logout": () => [500, {}] });
    const { store, authApi, testApi, sessionStarted } = await setupApp();
    store.dispatch(sessionStarted({ accessToken: "a1", user: { id: 1 } }));
    const sub = store.dispatch(testApi.endpoints.ping.initiate(1));
    await sub;
    expect(Object.keys(store.getState().api.queries)).toHaveLength(1);

    const result = await store.dispatch(authApi.endpoints.logout.initiate());

    expect(result.error.status).toBe(500);
    expect(store.getState().auth).toMatchObject({ accessToken: null, user: null, status: "unauthenticated" });
    expect(Object.keys(store.getState().api.queries)).toHaveLength(0);
    sub.unsubscribe();
  });

  it("a successful logout reports success (ending the session must not abort the mutation)", async () => {
    fakeBackend({ "/auth/logout": () => [200, { success: true }] });
    const { store, authApi, sessionStarted } = await setupApp();
    store.dispatch(sessionStarted({ accessToken: "a1" }));
    const result = await store.dispatch(authApi.endpoints.logout.initiate());
    expect(result.error).toBeUndefined();
    expect(store.getState().auth.status).toBe("unauthenticated");
  });

  it("getMe normalizes the user and stores it", async () => {
    fakeBackend({ "/auth/me": () => [200, { data: { user: { id: 3, name: "Asha" } } }] });
    const { store, authApi, sessionStarted } = await setupApp();
    store.dispatch(sessionStarted({ accessToken: "a1" }));
    const result = await store.dispatch(authApi.endpoints.getMe.initiate());
    expect(result.data).toEqual({ id: 3, name: "Asha" });
    expect(store.getState().auth.user).toEqual({ id: 3, name: "Asha" });
  });
});

describe("auth endpoints (body mode)", () => {
  it("stores the refresh token outside Redux, sends it on refresh, and rotates it", async () => {
    vi.stubGlobal("window", { localStorage: memoryStorage(), sessionStorage: memoryStorage() });
    let valid = "a1";
    const calls = fakeBackend({
      "/auth/login": () => [200, { accessToken: "a1", refreshToken: "r1" }],
      "/ping": pingRoute(() => valid),
      "/auth/refresh": (call) =>
        call.body?.refreshToken === "r1" ? [200, { accessToken: "a2", refreshToken: "r2" }] : [401, {}],
    });
    const { store, authApi, testApi, refreshTokenStore } = await setupApp({ mode: "body" });

    await store.dispatch(authApi.endpoints.login.initiate({ email: "u@x.io", password: "secret123" }));
    expect(refreshTokenStore.get()).toBe("r1");
    expect(JSON.stringify(store.getState())).not.toContain("r1");

    valid = "a2"; // access token expires
    const result = await store.dispatch(testApi.endpoints.ping.initiate(1));

    expect(result.data).toEqual({ ok: true });
    expect(calls.find((c) => c.path === "/auth/refresh").body).toEqual({ refreshToken: "r1" });
    expect(refreshTokenStore.get()).toBe("r2");
    expect(calls[0].credentials).toBe("same-origin");
  });

  it("with no stored refresh token, refresh fails locally without a network call", async () => {
    vi.stubGlobal("window", { localStorage: memoryStorage(), sessionStorage: memoryStorage() });
    const calls = fakeBackend({});
    const { store, authApi } = await setupApp({ mode: "body" });
    const result = await store.dispatch(authApi.endpoints.refresh.initiate());
    expect(result.error.status).toBe("CUSTOM_ERROR");
    expect(calls).toHaveLength(0);
    expect(store.getState().auth.status).toBe("unauthenticated");
  });
});
```

### `src/utils/__tests__/utils.test.js`
```js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "@/test/fakeBackend";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("getSafeRedirect", () => {
  beforeEach(() => vi.stubGlobal("window", { location: { origin: "https://app.test" } }));

  it("allows same-origin paths and rejects everything else", async () => {
    const { getSafeRedirect } = await import("@/utils/getSafeRedirect");
    expect(getSafeRedirect("/posts?page=2#top")).toBe("/posts?page=2#top");
    for (const bad of ["//evil.com", "/\\evil.com", "/\t/evil.com", "https://evil.com", "javascript:alert(1)", "", null, undefined]) {
      expect(getSafeRedirect(bad, "/home")).toBe("/home");
    }
    expect(getSafeRedirect("/login", "/", ["/login"])).toBe("/");
  });
});

describe("loadWithRetry / reloadOnceForChunkError", () => {
  const chunkError = () => new TypeError("Failed to fetch dynamically imported module: /assets/Page.js");
  let reload;

  async function load(sessionStorage = memoryStorage()) {
    reload = vi.fn();
    vi.stubGlobal("window", { location: { reload }, sessionStorage });
    vi.resetModules();
    return import("@/utils/lazyWithRetry");
  }

  it("retries chunk errors and resolves when a retry succeeds", async () => {
    const { loadWithRetry } = await load();
    const factory = vi.fn().mockRejectedValueOnce(chunkError()).mockResolvedValueOnce({ default: "Page" });
    await expect(loadWithRetry(factory, { delayMs: 1 })).resolves.toEqual({ default: "Page" });
    expect(factory).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not retry or reload non-chunk errors", async () => {
    const { loadWithRetry } = await load();
    const factory = vi.fn().mockRejectedValue(new ReferenceError("x is not defined"));
    await expect(loadWithRetry(factory, { delayMs: 1 })).rejects.toThrow("x is not defined");
    expect(factory).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once, then throws on the next failure within the cooldown", async () => {
    const storage = memoryStorage();
    const { reloadOnceForChunkError } = await load(storage);
    expect(reloadOnceForChunkError()).toBe(true);
    expect(reloadOnceForChunkError()).toBe(false); // same "page load" again, within the cooldown
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("allows another reload after the cooldown", async () => {
    vi.useFakeTimers();
    const { reloadOnceForChunkError } = await load();
    expect(reloadOnceForChunkError()).toBe(true);
    vi.setSystemTime(Date.now() + 61_000);
    expect(reloadOnceForChunkError()).toBe(true);
  });

  it("never auto-reloads when sessionStorage is unavailable (no loop possible)", async () => {
    const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() {} };
    const { loadWithRetry } = await load(throwing);
    await expect(loadWithRetry(() => Promise.reject(chunkError()), { retries: 1, delayMs: 1 })).rejects.toThrow(/dynamically imported/);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("getApiErrorMessage", () => {
  it("maps common error shapes", async () => {
    const { getApiErrorMessage } = await import("@/utils/getApiErrorMessage");
    expect(getApiErrorMessage({ status: "FETCH_ERROR" })).toMatch(/Network error/);
    expect(getApiErrorMessage({ status: 400, data: { message: "Bad email" } })).toBe("Bad email");
    expect(getApiErrorMessage({ status: 422, data: { errors: [{ message: "Too short" }] } })).toBe("Too short");
    expect(getApiErrorMessage({ status: "CUSTOM_ERROR", error: "No token" })).toBe("No token");
    expect(getApiErrorMessage({ status: 500, data: "<html>".padEnd(500, "x") })).toBe("Request failed (HTTP 500).");
  });
});
```

### `src/features/auth/__tests__/loginSchema.test.js`
```js
import { describe, expect, it } from "vitest";
import { createLoginSchema } from "@/features/auth/schemas/loginSchema";

const t = (key) => key; // echo i18n keys

describe("loginSchema", () => {
  const schema = createLoginSchema(t);

  it("reports field-level errors", () => {
    const result = schema.safeParse({ email: "", password: "123" });
    expect(result.success).toBe(false);
    // First issue per field, which is what the form resolver displays.
    const byField = {};
    for (const issue of result.error.issues) byField[issue.path[0]] ??= issue.message;
    expect(byField).toEqual({ email: "auth:validation.emailRequired", password: "auth:validation.passwordMin" });
  });

  it("rejects an invalid email and accepts valid input (trimmed)", () => {
    expect(schema.safeParse({ email: "nope", password: "12345678" }).error.issues[0].message).toBe("auth:validation.emailInvalid");
    expect(schema.parse({ email: "  a@b.io ", password: "12345678" }).email).toBe("a@b.io");
  });
});
```

### `src/i18n.test.js`
```js
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "@/test/fakeBackend";

afterEach(() => vi.unstubAllGlobals());

describe("i18n", () => {
  it("is ready synchronously with bundled resources and falls back to en", async () => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
    vi.stubGlobal("document", { documentElement: {} });
    const { default: i18n } = await import("@/i18n");
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.t("auth:login.title")).toBe("Sign in");
    await i18n.changeLanguage("hi");
    expect(i18n.t("auth:login.title")).toBe("साइन इन करें");
    expect(document.documentElement.lang).toBe("hi");
  });
});
```

### `src/features/auth/__tests__/AuthGate.test.jsx`
```jsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBackend } from "@/test/fakeBackend";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const NodeAbortController = globalThis.AbortController;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderGate() {
  vi.resetModules();
  // Node's Request rejects jsdom's AbortSignal; give fetchBaseQuery Node's AbortController.
  vi.stubGlobal("AbortController", NodeAbortController);
  await import("@/i18n");
  const { store } = await import("@/app/store");
  const { default: AuthGate } = await import("@/features/auth/components/AuthGate");
  root = createRoot(container);
  await act(async () => {
    root.render(
      <Provider store={store}>
        <AuthGate>
          <p>app-ready</p>
        </AuthGate>
      </Provider>,
    );
  });
  return store;
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

describe("AuthGate session restore (cookie mode)", () => {
  it("restores a session from the refresh cookie before rendering routes", async () => {
    const calls = fakeBackend({ "/auth/refresh": () => [200, { accessToken: "a1", user: { id: 1 } }] });
    const store = await renderGate();
    await settle();
    expect(container.textContent).toContain("app-ready");
    expect(store.getState().auth.status).toBe("authenticated");
    expect(calls.filter((c) => c.path === "/auth/refresh")).toHaveLength(1);
  });

  it("falls through as logged out when there is no valid refresh cookie", async () => {
    fakeBackend({ "/auth/refresh": () => [401, {}] });
    const store = await renderGate();
    await settle();
    expect(container.textContent).toContain("app-ready");
    expect(store.getState().auth.status).toBe("unauthenticated");
  });

  it("shows a retry screen on a transient failure, and retry recovers", async () => {
    let up = false;
    fakeBackend({ "/auth/refresh": () => (up ? [200, { accessToken: "a1" }] : [503, {}]) });
    const store = await renderGate();
    await settle();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain("app-ready");

    up = true;
    await act(async () => container.querySelector("button").click());
    await settle();
    expect(store.getState().auth.status).toBe("authenticated");
    expect(container.textContent).toContain("app-ready");
  });
});
```

If the project enables the opt-in redux-persist variant (`auth-and-security.md` §5), add `beforeEach(() => localStorage.clear())` to the jsdom `AuthGate` test. Otherwise a token persisted by one test is rehydrated by the next, and the "logged out" cases see an authenticated session. That's correct persistence behavior, but it leaks state between tests.

## What these tests do NOT cover

Verify these manually, or with Playwright or Cypress if the project has it:
- Real backend contract: paths, shapes, cookie attributes, and CORS.
- Real browser chunk failures. Simulate one by deploying a new build while a tab is open, or by blocking a chunk in DevTools.
- Router redirects end-to-end: `/private` → `/login?redirect=...` → back after login.
- Visual and theme behavior, and screen-reader output.
