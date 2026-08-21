---
name: GitHub branch sync
description: Safely synchronizing the repository when the workspace's direct Git credential is unavailable.
---

When the configured HTTPS Git remote rejects authentication, do not request or handle a token in chat. Use the attached GitHub connection and its authenticated Git-data API to update the intended branch.

**Why:** Workspace remotes can retain an expired password-style credential even when the project has an authorized GitHub connection. The connector keeps OAuth credentials server-side.

**How to apply:** Before writing, fetch and compare the expected remote tip. Build the updated tree from only the known local delta, update the ref without force, then fetch again and verify that the remote and local trees match. Preserve the local commit history unless the user explicitly asks to rewrite it.
