# Wire the pre-commit hook

From a terminal in the project:

```bash
node scripts/ai/setup-hooks.mjs
```

Add to `package.json` so every clone is wired:

```json
"prepare": "node scripts/ai/setup-hooks.mjs"
```

Git then uses `.githooks/pre-commit`, which runs the same docs/index/pins checks as CI. Husky and pre-commit.com are supported if you already use them.
