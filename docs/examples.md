# Usage examples

These examples show what to ask and what the skill's own instructions say it will do. They are **not recorded transcripts**: no screenshots are included, and the exact wording of the skill's replies will differ. The behavior described comes from [SKILL.md](../skills/react-feature-architecture/SKILL.md) and the reference files, and the template code itself was verified as described in the [README](../README.md#what-has-been-verified).

Every example follows the same rule: **the skill inspects and proposes first, and changes nothing until you approve.**

- [1. New project (Setup mode, JavaScript)](#1-new-project-setup-mode-javascript)
- [2. Extend an existing React project](#2-extend-an-existing-react-project)
- [3. Add a feature](#3-add-a-feature)
- [4. Add authentication](#4-add-authentication)
- [5. Add RTK Query APIs](#5-add-rtk-query-apis)
- [6. TypeScript](#6-typescript)

## 1. New project (Setup mode, JavaScript)

**Prompt**

> Set up a new React project in `./shop-web` with feature-based architecture, in JavaScript.

**Expected workflow**
1. Inspect: the folder is empty, so the mode is Setup (scaffold).
2. Propose: the stack, the folders to create, the dependencies to install, and that it will scaffold with `npm create vite@latest ... --template react`.
3. Wait for approval.
4. Ask only open questions: refresh-token transport (cookie or body), whether to persist the access token (default: memory only), and the backend contract if you know it.
5. Implement in order: Tailwind v4, `@/` alias, `shadcn init`, infrastructure files, auth pages, `CLAUDE.md`, `.env.example`.
6. Verify: clean install, build, lint, tests if approved, and the quality checklist.

**Expected architecture output:** the tree in [architecture.md §1](../skills/react-feature-architecture/references/architecture.md): `app/`, `api/` (three files), `config/`, `constants/`, `routes/`, `layout/`, `features/auth` and `features/home`, `components/ui`, `utils/`, `locales/en` and `hi`.

**Decisions to watch:** it never hand-writes `components.json` (it runs `shadcn init`), and it will not scaffold on top of existing files.

## 2. Extend an existing React project

**Prompt**

> This is an existing Vite + React app. Adopt this architecture without breaking what I already have.

**Expected workflow**
1. Inspect: build the 17-item inventory, marking each item present, present-different, or missing. Detect the router, store, auth, theme, i18n, and tests.
2. Classify: a partial architecture is "Setup (complete)", which adds only what's missing.
3. Propose: what gets reused, added, and modified, plus each conflict with a proposed resolution (keep, adapt, migrate, or remove).
4. Wait for approval. Existing infrastructure is never overwritten without it.

**Decisions to watch:** an existing theme provider, i18n setup, or data router is kept and the templates are adapted to it. For Next.js, Remix, or CRA/webpack projects the skill stops and asks, because the architecture doesn't apply as-is.

## 3. Add a feature

**Prompt** (in a project that already follows the architecture)

> Add a posts feature: a list page and a create form, behind login.

**Expected workflow:** it reads the project's `CLAUDE.md` first, then follows [Extend mode](../skills/react-feature-architecture/SKILL.md): `features/posts/` with only the subfolders it needs, `postsApi` via `baseApi.injectEndpoints` with tags, pages with loading/error/empty states, a zod schema factory taking `t`, a lazy route wrapped in `PrivateRoute`, and `en` + `hi` locale namespaces.

**Expected output**

```
src/features/posts/
├── postsApi.js
├── pages/PostsPage.jsx
├── pages/CreatePostPage.jsx   (optional, illustrative: for the create form in this prompt;
│                               not part of the skill's documented `posts` example)
├── schemas/postsSchema.js
└── components/        (only if feature-specific components are needed)
```

plus edits to `routes/AppRoutes`, `constants/routes`, `i18n`, and `api/baseApi` (new tag type). Then build, lint, typecheck, and tests are run and reported.

**Decisions to watch:** if a second feature later needs something from `posts`, it moves to `shared/` and both imports are updated, so features never import each other.

## 4. Add authentication

**Prompt**

> Set up login with access and refresh tokens. My backend returns the refresh token in an httpOnly cookie.

**Expected workflow:** the skill asks anyway if you haven't stated the transport. It always asks and never assumes. It then wires `authApi`, `AuthGate`, `PrivateRoute` / `PublicRoute`, and the single-flight refresh in `api/tokenRefresh.js`. The final report lists the backend settings you still need: `VITE_API_BASE_URL`, endpoint paths, response shapes in the adapter, 401 semantics, and CORS/cookie settings for cookie mode.

**Decisions to watch:**
- If the backend has no refresh endpoint, the skill stops and discusses a reduced design instead of improvising.
- Auth must be real: no mocked success and no hard-coded users.
- See the flow in [diagrams.md](diagrams.md#authentication-flow).

## 5. Add RTK Query APIs

**Prompt**

> Add API endpoints for `orders` (list, get by id, create) using RTK Query.

**Expected workflow:** endpoints go in `features/orders/ordersApi.js` through `baseApi.injectEndpoints`, with `providesTags` / `invalidatesTags`, and new tag types are added to `baseApi.tagTypes`. If the backend wraps responses, it uses `transformResponse: unwrapData`.

**Decisions to watch:** server data stays in RTK Query. Slices hold client or session state only, and backend response shapes are known only to `api/responseAdapter`.

## 6. TypeScript

**Prompt**

> Add the architecture to this TypeScript project.

**Expected workflow:** same as Setup mode, but the skill uses [typescript.md](../skills/react-feature-architecture/references/typescript.md): `.ts` / `.tsx` infrastructure files, `tsconfig.json` + `tsconfig.app.json` alias settings, and typed `useAppDispatch` / `useAppSelector` hooks in `app/hooks.ts`. Verification adds `tsc -b` or `tsc --noEmit`.

**Decisions to watch:** a TS project never gets JS templates. If the project mixes both languages, the skill asks which to use.

## JavaScript vs TypeScript at a glance

| | JavaScript | TypeScript |
|---|---|---|
| Templates | `code-templates.md` | `typescript.md` |
| Alias config | `jsconfig.json` | `tsconfig.json` + `tsconfig.app.json` |
| Extra files | none | `app/hooks.ts` |
| Extra verify step | none | `tsc -b` / `tsc --noEmit` |
