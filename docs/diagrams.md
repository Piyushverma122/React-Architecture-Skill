# Diagrams

Editable Mermaid sources, rendered by GitHub. The architecture overview and installation workflow are SVGs in [`assets/`](assets/).

- [Setup vs Extend workflow](#setup-vs-extend-workflow)
- [Authentication flow](#authentication-flow)
- [Architecture overview (SVG)](assets/architecture-overview.svg)
- [Installation workflow (SVG)](assets/installation-workflow.svg)

## Setup vs Extend workflow

Both modes share the same gate: **nothing is changed before you approve the proposal**.

```mermaid
flowchart TD
    A([You ask for React architecture work]) --> B[Phase 1: Inspect, read-only<br/>package manager, JS/TS, scripts,<br/>router, store, auth, theme, i18n, tests]
    B --> C{Classify the project}
    C -->|empty, existing app, or partial architecture| S[Setup mode<br/>scaffold / adopt / complete]
    C -->|already follows the architecture| E[Extend mode<br/>add a feature]
    C -->|unclear| Q[Ask which mode applies]
    Q --> S
    Q --> E
    S --> P[Phase 2: Propose<br/>detected, reuse / add / modify,<br/>installs, risks, conflicts]
    P --> W{{STOP: wait for your approval}}
    W -->|approved| D[Phase 3: Ask only what the<br/>project can't answer<br/>refresh-token transport, persistence ...]
    D --> I[Phase 4: Implement approved changes only]
    E --> F[Follow the project's CLAUDE.md:<br/>feature folder, injectEndpoints API,<br/>pages, schemas, lazy route, locales]
    F --> V
    I --> V[Phase 5: Verify with real commands<br/>install, build, lint, typecheck, tests]
    V --> R([Final report: files, deps, decisions,<br/>real verification results, limitations,<br/>remaining backend settings])
```

## Authentication flow

Summarized from [auth-and-security.md §2](../skills/react-feature-architecture/references/auth-and-security.md).

```mermaid
flowchart TD
    subgraph start [App start]
        S0[AuthGate: status unknown] --> S1{access token in state?}
        S1 -->|yes, opt-in persistence| OK1[sessionStarted]
        S1 -->|no| S2{body mode and no stored<br/>refresh token?}
        S2 -->|yes| OUT1[sessionEnded: unauthenticated]
        S2 -->|no| S3[POST refresh, single-flight]
        S3 -->|2xx + token| OK1
        S3 -->|400 / 401 / 403 / no token| OUT1
        S3 -->|network error or 5xx| RETRY[Retry screen, status stays unknown]
    end
    subgraph req [Any API request]
        R0[baseQueryWithReauth] --> R1[Wait for in-flight refresh,<br/>send with Bearer token]
        R1 --> R2{401, path not login / refresh / logout,<br/>and a token was sent?}
        R2 -->|no| DONE[Return response]
        R2 -->|yes| R3[refreshSession, single-flight,<br/>shared by all callers]
        R3 -->|success| R4[Retry original request ONCE]
        R3 -->|auth failure| OUT2[endSession: sessionEnded,<br/>API cache reset, guards redirect to login]
        R3 -->|transient failure| R5[Return original 401, keep session]
    end
```

Redirects have one source of truth: the route guards react to `auth.status`, and every redirect goes through `getSafeRedirect`. No component calls `navigate()` after login or logout.
