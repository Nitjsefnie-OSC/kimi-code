---
"@moonshot-ai/kimi-code": minor
---

Add a `-q`/`--quiet` flag for prompt mode: `kimi -p --quiet "..."` prints only the final assistant message to stdout instead of the full streamed transcript. Thinking and progress still go to stderr, so stdout stays clean for scripting.
