# React-Architecture-Skill

This Claude Code plugin helps you build, scaffold, and extend scalable React applications in JavaScript or TypeScript. It covers feature-based architecture, authentication, API integration, security, reusable templates, and automated verification workflows.

The plugin ships one skill, `react-feature-architecture`, which Claude uses when you ask it to:
- scaffold a new Vite + React app
- adopt or complete this architecture in an existing React project
- add a feature to a project that already follows it
- set up login with access and refresh tokens
- generate the project's `CLAUDE.md`

Before changing anything, the skill inspects your project and proposes a plan, then waits for your approval. After making changes, it verifies them with your project's own build, lint, type check, and tests.

**Stack:** Vite · React · Tailwind CSS v4 · shadcn/ui · Redux Toolkit + RTK Query · react-router · react-hook-form + zod · sonner · i18next.

## Install

Requires Claude Code with plugin support.

Inside Claude Code:

```
/plugin marketplace add Piyushverma122/React-Architecture-Skill
/plugin install react-architecture@piyushverma122-plugins
```

On Claude Code 2.1.275 or later, one command adds the marketplace and installs the plugin:

```
/plugin install react-architecture --marketplace Piyushverma122/React-Architecture-Skill
```

From a terminal:

```bash
claude plugin marketplace add Piyushverma122/React-Architecture-Skill
claude plugin install react-architecture@piyushverma122-plugins
```

The default scope is `user`. To share the plugin with a team through the repo's `.claude/settings.json`, add `--scope project` to both commands.

Restart Claude Code (or run `/reload-plugins`), then check that it loaded with `/plugin list`.

## Use

The skill triggers automatically from requests like:
- "Set up a new React project with feature-based architecture"
- "Add a posts feature to this app"
- "Set up login with refresh tokens"

You can also invoke it directly:

```
/react-architecture:react-feature-architecture
```

The skill always asks how your backend sends the refresh token (httpOnly cookie or response body) instead of assuming. The final report lists which backend settings you still need to configure.

## Update

```bash
claude plugin marketplace update piyushverma122-plugins
claude plugin update react-architecture@piyushverma122-plugins
```

Inside Claude Code, use `/plugin marketplace update piyushverma122-plugins` instead. Restart Claude Code after updating.

## Uninstall

```bash
claude plugin uninstall react-architecture@piyushverma122-plugins
claude plugin marketplace remove piyushverma122-plugins
```

## Repository layout

```
.claude-plugin/
  marketplace.json      # marketplace "piyushverma122-plugins" (plugin source: "./")
  plugin.json           # plugin "react-architecture" (version, author, license)
skills/
  react-feature-architecture/
    SKILL.md            # the skill: workflow, phases, non-negotiables
    references/         # architecture, templates (JS/TS), auth & security, testing, checklist
```

The repository root is both the marketplace and the plugin.

## Releasing a new version (maintainer)

1. Make your changes under `skills/`.
2. Bump `version` in `.claude-plugin/plugin.json`. The marketplace entry deliberately has no `version`, so `plugin.json` is the single source of truth.
3. Validate: `claude plugin validate . --strict`.
4. Commit and push, then optionally tag the release: `claude plugin tag . --push`.

Users pick up the release with the update commands above.

To test locally without GitHub:

```bash
claude plugin marketplace add ./path/to/React-Architecture-Skill
claude plugin install react-architecture@piyushverma122-plugins
```

## License

[MIT](LICENSE)
