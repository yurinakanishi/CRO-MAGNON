# Latest human policy — 2026-10-10 13:46 JST

User: 「次から claude thinking effort high 使って。」

Every subsequent local Claude start/resume uses Opus5.5 with High (`--effort high`, environment and settings high). This supersedes Extra/xhigh and MAX/max thinking specifications in old prompts, checkpoints and history. The three already-running invocations were started with Extra before this request; do not duplicate or interrupt them merely to change a setting. Any follow-up starts with High.

`run-claude-job.ps1` and `claude-subscription-settings.json` updated. The runner prepends this latest instruction even when resuming an old saved prompt. Existing first-party subscription auth, model, no API/extra usage/cloud/credits/Fast/fallback and all ownership/preservation rules remain unchanged. `subscriptionType: max` is the existing account tier, not a thinking-effort setting.
