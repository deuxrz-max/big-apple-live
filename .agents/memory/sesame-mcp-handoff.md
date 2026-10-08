---
name: Sesame MCP handoff
description: Relay ideas to Replit Agent without publishing Streamtalk.
---

Prefer Replit's official MCP server for Sesame-to-Agent recommendations rather
than building an app-hosted MCP server. Do not publish Streamtalk to enable this
handoff.

**Why:** The user wants Sesame AI to send their ideas for Agent review and said,
"I dont want it published." They confirmed Sesame shows a custom-app remote MCP
URL field.

**How to apply:** Consult current Replit MCP documentation before giving connection
instructions. Use its non-mutating Agent-question capability for recommendations,
not update/create/publish operations without explicit approval. The official
server also exposes mutating tools: a recommendations-only prompt is not a
permission boundary. Do not claim Sesame compatibility or delivery into this
exact chat thread has been tested.
