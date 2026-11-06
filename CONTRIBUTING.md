# Contributing

Thanks for helping improve React-Architecture-Skill. This repository is a Claude Code plugin and marketplace whose content is Markdown: a skill (`SKILL.md`) and reference files with code templates.

## Ways to contribute

- **Bug reports from real use.** A template that fails to build, a wrong instruction, or a skill run that did something you didn't approve. Include versions (Node, package manager, React, Claude Code) and the exact output.
- **Template fixes.** Library versions drift. If a template breaks on a newer release, send the fix along with how you verified it.
- **Documentation.** Clearer wording, missing troubleshooting entries, corrections.
- **New reference material.** Open an issue first so we can agree on scope.

## Ground rules

1. **No unverified claims.** Don't write "tested" or "verified" unless you ran the check. State what you ran and the versions.
2. **Keep the non-negotiables** in [SKILL.md](skills/react-feature-architecture/SKILL.md) intact unless the change is the point of the PR, and explain why.
3. **Don't rename the skill or its directory** (`react-feature-architecture`). Installed copies and slash commands depend on it.
4. **Keep reference file paths stable.** `SKILL.md` links to every file in `references/`.
5. **No secrets, tokens, or personal data** in examples or fixtures. Use obvious dummy values.

## Development workflow

```bash
git clone https://github.com/Piyushverma122/React-Architecture-Skill
cd React-Architecture-Skill

# Repository checks (no dependencies, needs Node 18+)
node scripts/validate-repo.mjs

# Plugin validation (needs the Claude Code CLI)
claude plugin validate . --strict
```

To try your changes locally, install from your working copy:

```bash
claude plugin marketplace add ./path/to/React-Architecture-Skill
claude plugin install react-architecture@piyushverma122-plugins
```

If you changed template code, extract it into a fresh Vite app and run the build, lint, and the Vitest suite from `references/testing.md`. Say in the PR what you ran.

## Pull requests

- Keep each PR focused on one change.
- Fill in the PR template, including how you verified the change.
- If you change behavior users will notice, say whether it needs a version bump. Maintainers bump `version` in `.claude-plugin/plugin.json`.

By contributing you agree your work is released under the [MIT License](LICENSE).

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).
