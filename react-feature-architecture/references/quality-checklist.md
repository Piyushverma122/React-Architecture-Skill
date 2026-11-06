# Quality Checklist

Run through this before the final report. Mark each item **✅ verified (how)**, **⚠️ not verified (why)**, or **N/A**. Only tick items you actually checked: by a command, by a test, or by reading the specific code. Paths assume the JS templates; for TS, read `.ts`/`.tsx`.

## Architecture structure
- [ ] Every new file is in the folder `architecture.md` assigns it to; there are no empty placeholder folders.
- [ ] `src/api/` contains only `baseApi`, `tokenRefresh`, and `responseAdapter`, with no feature endpoints.
- [ ] Each feature's endpoints use `baseApi.injectEndpoints` in `features/<x>/<x>Api.*`.
- [ ] Import direction holds. Each of these greps returns nothing:
  - `grep -rE "from ['\"]@/(features|shared)/" src/components src/hooks src/utils src/lib src/api`
  - `grep -rE "from ['\"]@/features/" src/shared`
- [ ] No cross-feature internal imports. The only ones allowed are another feature's `<x>Api` hooks and slice selectors.
- [ ] Only `config/env` reads `import.meta.env` (`grep -rn "import.meta.env" src`). The tolerated exception is `import.meta.env.DEV` in `LazyErrorBoundary`.
- [ ] No duplicate files or second patterns: one `createApi`, one store, no stray axios instance, no Context holding server data.

## API configuration
- [ ] `API_BASE_URL` comes from `VITE_API_BASE_URL`. `.env.example` is committed and `.env` is gitignored.
- [ ] Endpoint paths are in `constants/api` and confirmed with the user, or listed as BACKEND CONTRACT.
- [ ] Every backend shape assumption is in `api/responseAdapter` and nowhere else.
- [ ] Tag types are declared in `baseApi.tagTypes`; queries `providesTags`, mutations `invalidatesTags`.
- [ ] There's no manual `refetch()` where tag invalidation should do the job.

## Authentication and token refresh
- [ ] The refresh transport was **asked**, not assumed, and `constants/auth` matches the answer.
- [ ] Cookie mode: `credentials: "include"`, and the refresh token is never read or stored in JS.
- [ ] Body mode: the refresh token is sent in the refresh and logout bodies, stored only in `refreshTokenStore`, and absent from Redux and the RTK Query cache.
- [ ] Parallel 401s cause exactly one refresh request (test: `authFlow` "parallel 401s").
- [ ] A failed refresh logs out once, with no retry loop (test: "a failed refresh ends the session").
- [ ] Login, refresh, and logout paths never trigger a refresh (`NO_REFRESH_PATHS`).
- [ ] A transient refresh failure (offline/5xx) doesn't log the user out.
- [ ] Reloading the page while logged in restores the session through `AuthGate` with no flash of `/login` (test: `AuthGate` "restores a session").
- [ ] Logout clears auth state, stored tokens, and the API cache, and reports server failure honestly.

## Security
- [ ] No `console.*` calls that print tokens, passwords, auth headers, or raw auth responses (`grep -rn "console\." src`).
- [ ] Post-login redirects use `getSafeRedirect` (tests: `//evil.com`, `/\t/evil.com`, `javascript:`).
- [ ] The access token isn't persisted unless the user opted in, and the trade-off was explained.
- [ ] No `dangerouslySetInnerHTML` with server data.
- [ ] Cookie mode across origins: the CORS-with-credentials and cookie attribute requirements are listed for the backend.

## Redux state
- [ ] The store registers `baseApi.reducerPath`, `baseApi.middleware`, and `setupListeners(store.dispatch)`.
- [ ] `sessionEnded` resets the API state (the listener middleware in `app/store`).
- [ ] Slices hold only client/session state; server data stays in RTK Query.
- [ ] The default serializable check passes in dev, with no warnings in the console.

## Routing
- [ ] Every page is loaded through `lazyWithRetry`; the build output shows separate page chunks.
- [ ] `PrivateRoute` sends logged-out users to `/login?redirect=<path>`; `PublicRoute` sends logged-in users to the safe redirect or home.
- [ ] Guards wait while status is `"unknown"` (no premature redirect).
- [ ] No `navigate()` after login or logout: redirects are state-driven (no race).
- [ ] The existing router style (BrowserRouter vs data router) was kept.

## Error handling and states
- [ ] `LazyErrorBoundary` wraps the routes and the layout `<Outlet />`, and tells chunk errors apart from render errors.
- [ ] Chunk reload is guarded: at most one per cooldown, and none when sessionStorage is unavailable (tests).
- [ ] Every data view has loading, error (with retry), and empty states.
- [ ] Server and network errors are shown to the user (sonner or inline), never swallowed or faked.

## Theme
- [ ] An existing theme provider was reused if there was one; otherwise `ThemeProvider` toggles the `dark` class.
- [ ] The generated `components/ui/sonner.*` was **read** before integrating, and edited only if `{...props}` doesn't come after `theme`; any edit is reported.
- [ ] Theme choice persists and respects `system`.

## i18n
- [ ] Every user-facing string in templates goes through `t()`, with keys in both `en` and `hi`.
- [ ] Each new feature namespace is registered in `i18n` resources and `ns`.
- [ ] `<html lang>` updates on language change.

## Accessibility
- [ ] Form fields have labels; errors are tied to inputs (shadcn `FormControl` sets `aria-invalid`/`aria-describedby`).
- [ ] Icon-only buttons have an `aria-label`; decorative icons have `aria-hidden`.
- [ ] Loaders use `role="status"`; error panels use `role="alert"`.
- [ ] There's a skip link to `#main-content`, and nav landmarks have `aria-label`.
- [ ] Focus is visible on interactive elements.

## Build, lint, types, tests
- [ ] The install used the project's package manager and added only the deps it needed.
- [ ] `build` passes (paste the result line).
- [ ] `lint` passes with the project's linter. Warnings in `components/ui/*` (`only-export-components`) are expected; any others are fixed or explained.
- [ ] TS projects: `tsc -b`/`tsc --noEmit` passes.
- [ ] Tests (if the project has or approved them) pass; see `testing.md`.
- [ ] Optional smoke test: `vite preview` serves `/` and `/login` with HTTP 200.

## Existing project compatibility
- [ ] No existing file was overwritten or deleted without approval; customizations were preserved.
- [ ] Existing routes, pages, and features still build and are still reachable.
- [ ] Existing dependencies weren't upgraded or downgraded unless approved.
- [ ] Every conflict from the inspection was resolved as the user decided (keep, adapt, migrate, or remove).
