---
"@moonshot-ai/kimi-code": minor
---

Feed `SessionStart` hook output back into the model's context. The text a `SessionStart` hook prints (its JSON `message` field, or raw stdout) is now appended to the main agent's context as a system reminder, so a hook can seed a session with facts a static instruction file cannot carry — current branch, open tasks, deployment state. Previously the output was discarded. A hook that exits non-zero or times out still contributes nothing, and `SessionStart` remains observation-only: it cannot block or alter the session.
