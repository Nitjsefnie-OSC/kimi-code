---
"@moonshot-ai/kimi-code": minor
---

Add `agent_id` and `transcript_path` to every hook payload, so a hook script can read the firing agent's wire transcript directly instead of globbing the session directory to find it. A sub-agent's hooks report that sub-agent's own transcript. Both fields are omitted when the CLI cannot determine them — including on `SubagentStart` and `SubagentStop`, where the agent is not identifiable — so scripts must handle their absence.
