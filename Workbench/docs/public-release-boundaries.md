# Public release boundaries

## What is reusable

The reusable product is the application shell, local indexer, Markdown reader, graph, data contracts, and configuration mechanism.

## What is not transferable

- Personal Markdown, notes, cases, judgments, account exports, comments, messages, and analytics history
- Cookies, tokens, session parameters, browser profiles, local app state, or absolute home-directory paths
- Private Skill prompts and machine-specific executable paths
- Internal content strategies, client names, product plans, unpublished work, and operational archives
- Screenshots or test fixtures captured from a real Vault

## Demo-data rule

Demo records are authored from scratch. They use clearly fictional names, ids, dates, URLs, and metrics. Do not anonymize a real row by changing only its title or id; aggregation patterns and time series can still identify a source account.

## Public feature decisions

| Module | Public status | Reason |
|---|---|---|
| Raw / reader / books | Included | Generic local-first capability |
| Wiki concepts and frameworks | Included with synthetic examples | Demonstrates graph and knowledge views without personal judgment |
| Daily Hot | Included with editable neutral defaults | Uses an anonymous public source |
| Social insights | Read-only | Reports remain local and user-owned |
| Topics and content | Included with synthetic examples | Demonstrates the content pipeline |
| Douyin analytics | Included with schema and synthetic demo | Users must supply their own authorized export |
| Brainstorm | Hidden | Depends on a private runtime Skill and writeback policy |
| Run archive | Hidden | Commonly contains internal strategy and audit history |
| WeChat Official Account | Hidden | Depends on account-specific data and operating boundaries |

Hidden here means more than removing navigation. The public indexer skips
`Brainstorm/`, `90_runs/`, and `30_self_media/public-account/`; the related
Brainstorm and public-account Dashboard API routes return
`FEATURE_NOT_INCLUDED`.

## Release checklist

- [ ] Owner selects and approves a software license.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] `npm run privacy:scan` passes.
- [ ] A fresh clone keeps synthetic knowledge content only in the repository-level `个人知识库/` folder.
- [ ] A second, unrelated Vault can be selected with `PERSONAL_DASHBOARD_VAULT_ROOT`.
- [ ] No screenshot, fixture, source map, build output, or Git history contains personal data.
- [ ] All demo analytics surfaces visibly say they are synthetic.
