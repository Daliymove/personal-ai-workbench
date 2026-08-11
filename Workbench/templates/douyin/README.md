# Douyin data contract

Workbench reads `30_self_media/douyin/current.json` from the selected Vault.

The file must satisfy these minimum gates:

- `schemaVersion` is `1`
- `dataQuality.status` is not `failed`
- `douyin.available` is `true`
- `douyin.works` is an array

`current.template.json` lists the complete public fields without real account data. It includes representative shapes for:

- account 30-day content and follower series
- account summary, home snapshot, and content overview
- current work totals, content lines, formats, roles, and monthly groups
- collection analytics
- per-work cumulative snapshots and hourly lifecycle series
- retention, bounce, progress, and follower-growth series
- traffic sources, search terms, chapters, geography, interests, and comment keywords
- coverage assets, source paths, quality issues, and explicit missing fields

Use `null` for unavailable scalar fields and empty arrays for unavailable series; do not replace unknown values with `0`.

For a public demo, set both top-level and `douyin.demoMode` to `true`. A real local store should omit the flag or set it to `false`.

The checked-in synthetic dataset is generated deterministically:

```bash
npm run demo:generate
```

This command rewrites only the public demo `current.json` and the field-only template. It never reads an external Vault or account export.
