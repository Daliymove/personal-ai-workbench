# Personal AI Workbench public repository rules

This repository is the public, privacy-safe edition of Personal AI Workbench.

## Public data boundary

- Never copy a real user's Vault, account export, comments, messages, browsing history, credentials, local paths, screenshots, or generated reports into this repository.
- Runtime examples live only under `个人知识库/` and must be synthetic, clearly labelled demo data.
- `wiki/` demo content is limited to generic `concepts` and `frameworks` pages. Do not add personal cases, diagnoses, analyses, source archives, or reading notes.
- Douyin examples must use the documented schema with invented titles, ids, dates, and metrics. Never derive examples by lightly editing a real export.
- Local overrides belong in ignored files such as `Workbench/.env` and `Workbench/config/attention.local.json`.

## Public feature boundary

- The public navigation does not expose Brainstorm, run archives, or WeChat Official Account modules.
- The default Vault is the repository-level `个人知识库/` sibling of `Workbench/`. A user may point the app at another Vault through `PERSONAL_DASHBOARD_VAULT_ROOT`.
- Missing data remains missing. Demo values must always be labelled as synthetic in both files and UI.
- Keep the application loopback-only by default. Do not expose local mutation APIs to a LAN-facing host.

## Release gate

Before publishing, run:

```bash
cd Workbench
npm test
npm run build
npm run privacy:scan
```

The privacy scan must reject personal usernames, home-directory paths, private Vault names, common credential assignments, and known private product identifiers.
