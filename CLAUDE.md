# Claude & Cursor AI Assistant Directives for Mash

Mash is a **native local desktop developer agent** running directly on the user's personal workstation. It is **NOT a cloud web SaaS**.

Before making any modifications, diagnosing bugs, or analyzing issues, read the canonical architecture reference:
👉 **[ARCHITECTURE.md](ARCHITECTURE.md)**

### Critical Invariants to Remember:
1. **Desktop Read Model**: Any local file the host operating system user can read is viewable. Do not add SaaS chroot sandboxing or restrict reads to the project root.
2. **Missing Files**: Return `404 Not Found`, never `403 Forbidden`.
3. **Security Boundary**: Security lives in **Human-in-the-Loop Mutation & Shell Approvals**, not in hiding the local filesystem.
4. **Context Compaction**: Evaluated strictly over shrinkable message history, not fixed system prompts (prevents infinite compaction loops).
5. **DOM Virtualization**: Frontend uses React Virtuoso maintaining ~20 mounted DOM elements and paginating turns in 40-item chunks.
6. **Persistence**: SQLite WAL database at `~/.mash/database/mash.db` using event-sourced actions in `agent_run_actions` (`APPEND`, `UNDO`, `REPLACE`).
