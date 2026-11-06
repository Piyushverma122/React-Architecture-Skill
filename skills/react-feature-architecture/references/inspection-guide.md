# Project Inspection and Mode Detection

The goal is to know exactly what exists **before** proposing anything. Never pick a mode from one or two files. Build the full component inventory below, then classify the project.

## 1. Locate the app

- Find the app root: the folder with `package.json` plus `vite.config.*` and `index.html`. In monorepos it's often `apps/web/` or `packages/client/`. If there are several candidates, ask which one.
- Find the source root. It's usually `src/`, but it could be `app/src/` or `client/src/`. Use whatever directory the entry file (`main.jsx`/`main.tsx`/`index.jsx`) lives in. All paths in the templates are relative to that root.
- **Unsupported or different stacks.** Stop and ask before continuing if you see any of these:
  - **Next.js** (`next` dependency): it has its own router, so this SPA architecture doesn't apply as-is.
  - **Remix / React Router framework mode** (`@react-router/dev`, `react-router.config.*`): routing is file- or config-based, so routes/guards need a different design.
  - **CRA or webpack** (`react-scripts`, `webpack.config.*`): env vars are `process.env.REACT_APP_*`, so `config/env.js` must read those instead, and Tailwind v4 uses `@tailwindcss/postcss` instead of the Vite plugin. Propose that, or a migration to Vite, but don't do either silently.

## 2. Collect facts (read, don't guess)

| Fact | How to detect |
|---|---|
| Package manager | lockfile: `package-lock.json` → npm, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lock`/`bun.lockb` → bun. Use that manager for every install. |
| Node version | `node -v`; also `.nvmrc`, `engines` in `package.json` |
| Language | `tsconfig*.json` or any `.ts/.tsx` in the source root → TS. Both present → **mixed**: report it and ask. |
| Installed versions | `package.json`, plus `npm ls <pkg> --depth=0` (or the pnpm/yarn equivalent) for react, react-router(-dom), @reduxjs/toolkit, tailwindcss, zod, @hookform/resolvers, i18next, typescript |
| Scripts | `package.json` `scripts`: build, lint, typecheck, test. The lint tool varies: ESLint (`eslint.config.*`), oxlint (`.oxlintrc.json`), Biome (`biome.json`). |
| Tailwind | v4: `@import "tailwindcss"` in CSS, plus `@tailwindcss/vite` or `@tailwindcss/postcss`. v3: `tailwind.config.*`, `@tailwind base;`. |
| shadcn | `components.json`. Read `style`, `tsx`, `iconLibrary`, and `aliases`, and list `components/ui/*`. |
| Router | `react-router-dom` or `react-router` import style; `<BrowserRouter>` vs `createBrowserRouter` (data router). Keep whichever the project uses. |
| State/API | `configureStore`, `createApi`, axios instances, react-query (`@tanstack/react-query`), Zustand, SWR, Context holding fetched data |
| Auth | existing login, token storage (grep `localStorage`, `accessToken`, `Authorization`), interceptors, guards |
| Theme | `next-themes` `ThemeProvider` mounted? A custom theme context? A `dark` class strategy? |
| i18n | `i18next`/`react-i18next` init file and locale folder layout |
| Env | `.env*` files and every `import.meta.env` / `process.env` usage (grep) |
| Tests | vitest/jest config, existing test files |

Use Grep/Glob. Don't read `node_modules` or build output (`dist/`, `build/`).

## 3. Architecture component inventory

Mark each item as **present** (matches the template's role), **present-different** (exists but with another pattern or location), or **missing**:

1. Path alias `@/*` in the bundler **and** in jsconfig/tsconfig
2. Tailwind v4 setup
3. shadcn initialized (`components.json`, `lib/utils`)
4. `config/env.js` as the only env reader
5. `api/baseApi` with one `createApi` + `injectEndpoints`
6. A reauth base query with single-flight refresh
7. A response adapter (one place for backend shapes)
8. `app/store` with the baseApi reducer + middleware + `setupListeners`
9. An auth slice with session status
10. Session restore at startup (an `AuthGate` equivalent)
11. `PrivateRoute` / `PublicRoute` with safe redirects
12. Lazy routes with retry + an error boundary + loaders
13. `features/<name>/` folders
14. A layout shell
15. Theme provider
16. i18n init + locales
17. `CLAUDE.md` describing this architecture

## 4. Classify

| State | Signal | Mode |
|---|---|---|
| **Empty** | no `package.json` | **Setup (scaffold)** |
| **Unstructured** | a React app exists, items 5–13 missing | **Setup (adopt)**: add the architecture around the existing code; migrating existing code is a separate, approved step |
| **Partial** | some of items 1–17 present, some missing or different | **Setup (complete)**: add only the missing pieces; reconcile the "present-different" ones with the user |
| **Complete** | items 1–16 present and matching (17 optional) | **Extend**: follow the project's `CLAUDE.md` and the "Adding a feature" flow |
| **Ambiguous** | e.g. two API layers, mixed JS/TS, two stores, conflicting folder conventions | **Ask** before choosing |

A missing `CLAUDE.md` alone doesn't make a complete project "Setup". Offer to write it, and continue in Extend mode.

## 5. Conflict handling

For each "present-different" item, propose exactly one of these:
- **Keep**: the existing pattern stays, and the skill adapts to it (e.g. keep a data router, keep an existing theme provider).
- **Wrap or adapt**: e.g. the existing axios auth stays and the new code calls through it. This violates "one API layer", so it needs explicit approval.
- **Migrate**: replace it with the template pattern. List every file affected, the risk, and how to roll back.
- **Remove**: only with explicit approval, after confirming nothing imports it (grep).

Never delete, rename, or overwrite an existing file without approval. When you modify one, prefer a targeted edit over a rewrite, and preserve user customizations (especially in `components/ui/*`, `index.css`, and configs).

## 6. Proposal format (send this, then wait)

```
Detected: <app root>, <source root>, <JS|TS>, <npm|pnpm|yarn|bun>, Node <v>, React <v>, Router <v> (<BrowserRouter|data router>)
Mode: <Setup (scaffold|adopt|complete) | Extend> — because <inventory summary>

Reuse:   <existing pieces kept as they are>
Add:     <new files/folders>
Modify:  <file → what changes and why>
Install: <packages, with the project's package manager> (skip anything already installed)
Breaking/risky: <behavior changes, e.g. "existing localStorage token is no longer read">
Conflicts: <item → keep | adapt | migrate | remove (proposed)>
Questions: <only decisions the project can't answer; see SKILL.md Phase 3>
```
