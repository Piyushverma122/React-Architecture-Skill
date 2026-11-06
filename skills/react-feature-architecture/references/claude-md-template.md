# CLAUDE.md Template

Write this to the project root as `CLAUDE.md`. Replace every `<...>` placeholder with real values from the project: the language, package manager, scripts, transport, tag types, features, and any deviations the user approved. Delete lines that don't apply. If a `CLAUDE.md` already exists, **merge** into it, keep the user's content, and tell them.

---

````markdown
# Project Guide for Claude

React (Vite, **<JavaScript | TypeScript>**) frontend using a **Feature-Based (Hybrid) architecture**.
These rules are mandatory. Every new feature follows them. **No duplicate files and no alternative
patterns** (second API layer, axios, Context for server data, another state library, a second router setup)
without explicit approval.

## Stack
Vite · React <v> · Tailwind CSS v4 (`@tailwindcss/vite`; no tailwind.config / postcss config) ·
shadcn/ui (<style from components.json>, lucide) · Redux Toolkit + RTK Query · react-router-dom <v> ·
react-hook-form + zod · sonner · i18next (en, hi) · date-fns

## Commands (<npm|pnpm|yarn|bun>)
- `<pm> run dev`: dev server
- `<pm> run build`: production build (must pass before any task is done)
- `<pm> run lint`: <eslint|oxlint|biome>
- `<pm> run test`: <vitest | n/a>
- Type check: <`tsc -b` | n/a>

## Folder structure
```
src/
  main.<jsx|tsx>  App  index.css  i18n
  app/store                 # store wiring; registers slices + baseApi; resets API cache on sessionEnded
  api/                      # responseAdapter + tokenRefresh + baseApi ONLY
  config/env                # ONLY reader of import.meta.env
  constants/                # api, auth, routes, storage
  routes/                   # AppRoutes, PrivateRoute, PublicRoute
  layout/                   # Layout, Header, Sidebar, MobileFooter, NotFound, AppToaster
  context/                  # UI-only contexts (theme)
  features/<name>/          # <name>Api, pages/, components/, hooks/, store/, schemas/, utils/
  components/ui/            # shadcn CLI output, don't hand-edit
  components/loaders/       # PageLoader, SectionLoader, skeletons
  shared/                   # domain-aware code used by 2+ features; shared/config/routes.config
  hooks/  lib/utils  utils/ # generic hooks · cn() · lazyWithRetry, LazyErrorBoundary, storage, getSafeRedirect, getApiErrorMessage
  locales/en, locales/hi
```
Existing features: <auth, home, ...>

## Placement rules (stop at first yes)
1. shadcn CLI output → `components/ui/`
2. Base API / backend response shapes / tokens / store → `api/` or `app/`
3. Route definition or guard → `routes/`
4. App shell → `layout/`
5. Used by ONE feature → `features/<that-feature>/`
6. Domain-aware, used by 2+ features → `shared/`
7. Generic, no business knowledge → `components/` · `hooks/` · `utils/` · `lib/`

Unsure → keep it in the feature and ask before creating a new top-level folder.

## Import rules
- Always use the `@/` alias. No `../../` across folders.
- `components/`, `hooks/`, `utils/`, `lib/`, `api/` never import `features/` or `shared/`. `shared/` never imports `features/`.
- Features never import another feature's internals. The only exceptions are hooks exported from `<x>Api` and slice selectors.
- `app/store` is the only file that imports every feature's slice.

## Naming
Folders `kebab-case` · components `PascalCase.<jsx|tsx>` · hooks `use-<name>` · slices `<name>Slice` ·
APIs `<name>Api` · schemas `<name>Schema` · tests `__tests__/<name>.test` · shadcn files stay as generated.

## State management
- **Server state = RTK Query only.** Never copy API data into slices, Context, or local caches.
- **Client state = feature slices**, only when needed, registered in `app/store`.
- `auth` slice = session only: `status` ("unknown" | "authenticated" | "unauthenticated"), `accessToken` (memory<, persisted: yes/no>), `user`.
- Context = UI-only global state (theme).

## RTK Query pattern
- One `createApi` in `api/baseApi` (`baseQuery: baseQueryWithReauth`, `endpoints: () => ({})`).
- Each feature calls `baseApi.injectEndpoints(...)` in `features/<x>/<x>Api` and exports the hooks.
- Backend envelopes/shapes are handled ONLY in `api/responseAdapter` (`unwrapData` for feature endpoints).
- Cache: queries `providesTags`, mutations `invalidatesTags`. Add new tag types to `baseApi.tagTypes`. No manual refetch.
- Current tag types: <Me, ...>

## Routing
- All routes live in `routes/AppRoutes`. **Every page uses `lazyWithRetry(() => import("@/features/<x>/pages/<Page>"))`.**
- Login-required pages go inside `<PrivateRoute>` + `<Layout>`; logged-out-only pages go inside `<PublicRoute>`.
- Redirects are state-driven: guards react to `auth.status`. Never call `navigate()` after login or logout.
- Post-login redirect = `?redirect=`, validated by `getSafeRedirect` (same origin only).

## Auth architecture
- Refresh token transport: **<cookie: httpOnly, credentials "include", never touched by JS | body: sent in refresh/logout body, kept in refreshTokenStore (<localStorage|memory>), never in Redux>**.
- Startup: `AuthGate` restores the session via the refresh endpoint before routes render.
- `baseQueryWithReauth`: 401 → single-flight `refreshSession` → retry once. Login, refresh, and logout never trigger a refresh. Auth failure → `endSession` (tokens cleared, `sessionEnded`, API cache reset). Network/5xx failure keeps the session.
- Login and logout go through `authApi` only. Tokens never enter the RTK Query cache.
- Never log tokens, passwords, or auth responses. No fake auth: show real errors (`getApiErrorMessage` + sonner).
- Backend contract: base URL `VITE_API_BASE_URL`; paths in `constants/api`; shapes in `api/responseAdapter`. <list confirmed/unconfirmed items>

## Forms
react-hook-form + `zodResolver` + shadcn `Form`. Schemas live in `features/<x>/schemas/<name>Schema` as factories taking `t`.
Show field errors with `<FormMessage />`, disable the submit button and show a spinner while loading, and send server errors to `toast.error`.

## Loading, errors, empty states
- Page level: `Suspense` + `PageLoader` (routes) / `SectionLoader` (layout outlet), behind `LazyErrorBoundary`.
- `lazyWithRetry` retries chunk errors, then reloads at most once per minute (never when sessionStorage is unavailable).
- Every data view handles loading, error (with retry), and empty states.

## i18n
Every user-facing string uses `t()`, with keys in both `locales/en` and `locales/hi`. New namespaces get registered in `i18n` (`resources` + `ns`).

## Env
Only `config/env` reads `import.meta.env`. `.env.example` is committed and `.env` is gitignored. Vars: `VITE_API_BASE_URL`.

## Adding a feature (checklist)
1. `src/features/<name>/` with only the needed subfolders.
2. `<name>Api` via `injectEndpoints` + tags (add the tag types to baseApi), with `transformResponse: unwrapData` if the backend wraps responses.
3. Pages, components, schemas, and locales inside the feature/namespace.
4. Lazy route + `ROUTES` constant (+ `PRIVATE_NAV` if it's in navigation). `PrivateRoute` if it needs auth.
5. A slice only for client state, registered in the store.
6. Build, lint, <typecheck>, and tests pass.

## shadcn/ui
Add components only via `npx shadcn@latest add <name>`. Don't edit `components/ui/*`; wrap them in `shared/components/` instead.
<Approved deviations, e.g. "ui/sonner.jsx edited: ...">
````
