# Architecture Reference

## Contents
0. Mandatory vs recommended
1. Full folder structure
2. What each folder is for
3. "Where does this file go?" decision order
4. Import-direction rules
5. Naming conventions
6. Worked example: adding a `posts` feature

---

## 0. Mandatory vs recommended

**Mandatory.** These are the architecture itself. Deviations need the user's explicit approval:
- Feature folders: business code in `features/<name>/`, shared domain code in `shared/`, generic code in `components/`/`hooks/`/`utils/`/`lib/`.
- The import-direction rules (§4) and the `@/` alias.
- One RTK Query `createApi` in `api/baseApi`. Features use `injectEndpoints`. Server state is RTK Query only.
- Backend response shapes are known only to `api/responseAdapter`.
- `import.meta.env` is read only in `config/env`.
- Every route page is lazy-loaded through `lazyWithRetry`, behind `LazyErrorBoundary` + `Suspense`.
- Auth goes through `baseQueryWithReauth` + single-flight refresh, and redirects through the route guards + `getSafeRedirect`.
- No duplicate files and no second pattern for the same job.

**Recommended defaults.** Use them unless the project already has an equivalent, or the user decides otherwise:
- Tailwind v4 + shadcn/ui, react-hook-form + zod, sonner, i18next with `en`/`hi`, the theme provider, the exact layout components, the memory-only access token, and Vitest.
- If the project already uses a different equivalent (another UI kit, another i18n setup, a data router, an existing theme provider), **keep it**, and adapt the templates to it.

## 1. Full folder structure

Paths are relative to the app root. TS projects use `.ts`/`.tsx` and `tsconfig*.json` instead of `jsconfig.json` (see `typescript.md`).

```
.env.example                 # committed; .env is gitignored
jsconfig.json                # @/* alias (needed by the shadcn CLI). TS: tsconfig.json + tsconfig.app.json
vite.config.js               # react() + tailwindcss() plugins, @ alias
components.json              # written by `shadcn init`, never by hand
CLAUDE.md
src/
├── main.jsx                 # Providers: Redux, ThemeProvider, BrowserRouter, AppToaster; imports i18n + css
├── App.jsx                  # <AuthGate><AppRoutes /></AuthGate>
├── index.css                # written by shadcn init (@import "tailwindcss" + theme variables)
├── i18n.js                  # i18next init (bundled resources, synchronous)
│
├── app/
│   └── store.js             # configureStore, baseApi reducer + middleware, session listener, feature slices
│
├── api/                     # Base API layer ONLY (exactly these three files)
│   ├── responseAdapter.js   # the ONLY file that knows backend response shapes
│   ├── tokenRefresh.js      # auth events, refresh-token store, single-flight refresh
│   └── baseApi.js           # fetchBaseQuery, baseQueryWithReauth, createApi (endpoints: () => ({}))
│
├── config/
│   └── env.js               # the ONLY reader of import.meta.env
│
├── constants/
│   ├── api.js               # API_PATHS, REQUEST_TIMEOUT_MS
│   ├── auth.js              # REFRESH_TOKEN_TRANSPORT, BODY_REFRESH_TOKEN_STORAGE
│   ├── routes.js            # ROUTES
│   └── storage.js           # STORAGE_KEYS
│
├── routes/
│   ├── AppRoutes.jsx        # all routes, pages lazy-loaded
│   ├── PrivateRoute.jsx     # auth required → else /login?redirect=<path>
│   └── PublicRoute.jsx      # logged-out only → else the safe redirect or home
│
├── layout/                  # Layout, Header, Sidebar, MobileFooter, NotFound, AppToaster
├── context/                 # UI-only contexts: theme-context.js (context + hook), ThemeProvider.jsx
│
├── features/
│   ├── auth/
│   │   ├── authApi.js
│   │   ├── components/AuthGate.jsx
│   │   ├── pages/LoginPage.jsx
│   │   ├── schemas/loginSchema.js
│   │   └── store/authSlice.js
│   └── home/
│       └── pages/HomePage.jsx
│
├── components/
│   ├── ui/                  # shadcn CLI output, don't hand-edit
│   ├── loaders/             # PageLoader.jsx, SectionLoader.jsx, skeletons
│   └── icons/               # only when there are custom icons
│
├── shared/
│   ├── components/  hooks/  constants/  utils/   # created only when a 2nd feature needs something
│   └── config/routes.config.js                   # PRIVATE_NAV (used by Sidebar + MobileFooter)
│
├── hooks/                   # generic hooks (use-debounce.js, ...), only when needed
├── lib/
│   └── utils.js             # cn(), written by shadcn init
├── utils/
│   ├── storage.js           # safe localStorage/sessionStorage + isAvailable()
│   ├── chunkErrors.js       # isChunkLoadError()
│   ├── lazyWithRetry.js     # loadWithRetry, lazyWithRetry, reloadOnceForChunkError
│   ├── LazyErrorBoundary.jsx
│   ├── getSafeRedirect.js
│   └── getApiErrorMessage.js
├── locales/
│   ├── en/  common.json  auth.json
│   └── hi/  common.json  auth.json
└── assets/
```

## 2. What each folder is for

**`app/`: app wiring.** `store.js` (configureStore, reducers, baseApi middleware, the listener that resets the API cache on `sessionEnded`). TS adds `hooks.ts` (`useAppDispatch`/`useAppSelector`). Never components or business logic. Slices live in their feature and are only *registered* here.

**`api/`: base API layer only.** These are exactly three files: `responseAdapter`, `tokenRefresh`, and `baseApi`. Never feature endpoints like `getPosts` or `login`; those go in `features/<x>/<x>Api.js`. `api/` must not import from `features/` or `shared/`. That's why the auth events (`sessionStarted`, `sessionEnded`) are defined in `tokenRefresh.js` and *handled* by the auth slice. The response adapter lives here (and not in `features/auth/`) because the automatic refresh in `baseApi` needs it too, and `api/` can't import features.

**`config/`: environment.** `env.js` reads `import.meta.env` once and exports named values (`API_BASE_URL`, `APP_ENV`, `IS_DEV`).

**`constants/`: app-wide technical constants.** Storage keys, route paths, API paths, auth transport. Never feature-specific constants (those stay in the feature) or domain lists shared by a few features (those go in `shared/constants/`).

**`routes/`: routing.** `AppRoutes.jsx` (every page through `lazyWithRetry`), `PrivateRoute.jsx`, `PublicRoute.jsx`. Never page components. If the project uses a data router (`createBrowserRouter`), keep it, and express the same guards as layout routes.

**`layout/`: app shell.** `Layout` (renders `<Outlet />` inside an error boundary + Suspense), `Header`, `Sidebar`, `MobileFooter`, `NotFound`, `AppToaster`. Never feature UI. A notification bell lives in `features/notifications/components/`, and the header imports it.

**`context/`: global UI-only contexts.** Theme, sidebar open/close. Put the context + hook in a `.js` file and the provider component in a `.jsx` file (Fast Refresh needs files that export only components). Never server data (RTK Query) or auth state (the auth slice).

**`features/`: business features.** One folder per domain (`auth`, `posts`, `chat`, `notifications`, `user-profile`), each self-contained:
```
features/posts/
├── postsApi.js          # baseApi.injectEndpoints: getPosts, createPost, ...
├── pages/               # PostsPage.jsx, PostDetailPage.jsx
├── components/          # PostCard.jsx, PostComposer.jsx (this feature only)
├── hooks/               # use-post-actions.js (API hooks + UI logic)
├── store/postsSlice.js  # ONLY client state (filters, drafts). Never cache server data.
├── schemas/             # createPostSchema.js
├── utils/               # formatPostDate.js
└── constants.js         # optional
```
Create only the subfolders a feature actually needs.

**`components/`: generic, domain-agnostic UI.** `ui/` is shadcn CLI output only; `loaders/` holds PageLoader, SectionLoader, and skeletons; `icons/` holds custom SVG icons. Test: if a component knows what a "user", "post", or "order" is, it doesn't belong here.

**`shared/`: domain-aware code used by 2+ features (or by the layout and features).** For example `shared/components/UserAvatar.jsx`, `shared/hooks/use-current-user.js`, and `shared/config/routes.config.js`. Code starts inside a feature and moves here only when a **second** consumer needs it.

**`hooks/`: generic hooks.** `use-debounce.js`, `use-media-query.js`. Test: it could be copied into any other project unchanged.

**`lib/`: third-party setup and wrappers.** `utils.js` (`cn()`, written by shadcn init; current CLI versions re-export it from the `cn` package), analytics, date-fns locale setup.

**`utils/`: generic app infrastructure.** Lazy loading, the error boundary, storage, safe redirects, error messages. Never business helpers.

**`locales/`:** `en/*.json` + `hi/*.json`, one namespace per feature where useful.

**`assets/`:** static files imported by code. Fixed-URL files (favicon, robots.txt) go in `/public`.

## 3. "Where does this file go?" decision order

Stop at the first "yes":
1. Generated by the shadcn CLI? → `components/ui/`
2. Base API, backend response shapes, tokens, or store setup? → `api/` or `app/`
3. Route definition or guard? → `routes/`
4. App shell (header, sidebar, footer, toaster mount)? → `layout/`
5. Used by **one** feature only? → `features/<that-feature>/...`
6. Domain-aware and used by **2+ features**? → `shared/...`
7. Generic with zero business knowledge? → `components/` (UI), `hooks/` (hook), `utils/` (helper), `lib/` (library wrapper)

Still unsure? Put it in the feature, and ask the user before creating a new top-level folder.

## 4. Import-direction rules

```
main / App  →  routes / layout  →  features  →  shared  →  components / hooks / utils / lib / context
                                                    ↘        api / app (store) / constants / config
```

- Arrows show the **allowed** direction. Lower layers never import higher ones.
- `components/`, `hooks/`, `utils/`, `lib/`, and `api/` never import from `features/` or `shared/`.
- `shared/` never imports from `features/`.
- A feature never imports another feature's internals.
  - Allowed exception: another feature's **public hooks from its `<x>Api.js`** and its **slice selectors** (e.g. `useGetMeQuery` from `@/features/auth/authApi`, `selectCurrentUser` from `@/features/auth/store/authSlice`).
  - Anything else that needs sharing moves to `shared/`.
- `app/store.js` is the only file allowed to import every feature's slice (for registration).
- `App.jsx` may import `features/auth/components/AuthGate` (app-level wiring).
- `layout/` may import shell-facing feature exports (e.g. a `NotificationBell`, `useLogoutMutation`, auth selectors) and `context/`.

Self-check: the import-direction greps in `quality-checklist.md` must return nothing.

## 5. Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Folders | kebab-case | `user-profile/` |
| Components | PascalCase `.jsx`/`.tsx` | `PostCard.jsx` |
| shadcn files | as generated | `button.jsx` |
| Hooks | `use-<name>.js`, exporting `useName` | `use-debounce.js` → `useDebounce` |
| Context (non-component) files | kebab-case `.js` | `theme-context.js` |
| Slices | `<name>Slice.js` | `authSlice.js` |
| APIs | `<name>Api.js` | `postsApi.js` |
| Schemas | `<name>Schema.js` | `loginSchema.js` |
| Locale files | `<namespace>.json` | `auth.json` |
| Tests | `__tests__/<name>.test.js` next to the code | `api/__tests__/authFlow.test.js` |

Always import through `@/` (e.g. `@/features/auth/authApi`). Relative imports are fine only for siblings inside the same folder.

## 6. Worked example: adding `posts`

1. Create `features/posts/postsApi.js`:
   ```js
   import { baseApi } from "@/api/baseApi";
   import { unwrapData } from "@/api/responseAdapter";

   export const postsApi = baseApi.injectEndpoints({
     endpoints: (build) => ({
       getPosts: build.query({
         query: (params) => ({ url: "/posts", params }),
         transformResponse: unwrapData, // backend envelope handled in one place
         providesTags: (result) =>
           Array.isArray(result)
             ? [...result.map(({ id }) => ({ type: "Post", id })), { type: "Post", id: "LIST" }]
             : [{ type: "Post", id: "LIST" }],
       }),
       createPost: build.mutation({
         query: (body) => ({ url: "/posts", method: "POST", body }),
         invalidatesTags: [{ type: "Post", id: "LIST" }],
       }),
     }),
   });

   export const { useGetPostsQuery, useCreatePostMutation } = postsApi;
   ```
   Then add `"Post"` to `tagTypes` in `api/baseApi.js`.
2. Create `features/posts/pages/PostsPage.jsx` with loading, error (with retry), and empty states, plus `components/PostCard.jsx`.
3. Add `ROUTES.POSTS = "/posts"` to `constants/routes.js`. If it appears in navigation, add it to `PRIVATE_NAV` in `shared/config/routes.config.js`.
4. Register it in `routes/AppRoutes.jsx` with `const PostsPage = lazyWithRetry(() => import("@/features/posts/pages/PostsPage"));`, inside the `PrivateRoute` + `Layout` group.
5. Add `store/postsSlice.js` and register it in `store.js` only if there's client-only state (filters, drafts).
6. Create `locales/en/posts.json` + `locales/hi/posts.json`, and register the namespace in `i18n.js` (`resources` + `ns`).
7. If `user-profile` later needs `PostCard`, move it to `shared/components/PostCard.jsx` and update both imports.
