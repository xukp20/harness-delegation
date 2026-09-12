---
name: pi-agent-delegation
description: Compatibility Skill for existing Pi delegation users. Use Harness Delegation for new Pi/Grok integration.
---

# Pi compatibility entry

Follow [Harness Delegation](../harness-delegation/SKILL.md), selecting `pi` explicitly. Keep this Skill inside the complete checkout. The old `scripts/pi-agent.mjs` command remains a raw-JSON compatibility facade over the new core.

Read [migration](../../docs/migration.md) before continuing an old active job. Old terminal receipts can be read; old supervisors cannot be migrated online. New workers require explicit write scope. `--allow-env` moved to local configuration. Do not silently broaden tools or switch providers to bypass an error.
