# Permission matching helpers (reference implementations).
# RFC-0019:
# tool helper function. " + raise exception"

from __future__ import annotations

import fnmatch
import re
import shlex
from typing import TYPE_CHECKING
from urllib.parse import urlparse

import pathspec

from .types import AskPermission, PermissionDenied

if TYPE_CHECKING:
    from nexau.archs.main_sub.framework_context import FrameworkContext

# RFC-0019: "**"
_WILDCARD = "**"

# CC: Bash read-only
# CC: ls, cat, head, tail, grep, find, wc, diff, stat, du, cd
# /,, read-only.
# : sed, awk -i /, CC read-only, .
_READONLY_COMMANDS: frozenset[str] = frozenset(
    {
        # CC: read-only
        "ls",
        "cat",
        "head",
        "tail",
        "grep",
        "find",
        "wc",
        "diff",
        "stat",
        "du",
        "cd",
        "file",
        "which",
        "whereis",
        "whoami",
        "pwd",
        "echo",
        "printf",
        "env",
        "printenv",
        "date",
        "uname",
        "hostname",
        "id",
        "uptime",
        "basename",
        "dirname",
        "realpath",
        "readlink",
        "md5sum",
        "sha256sum",
        # : stdout ( sed/awk)
        "sort",
        "uniq",
        "tr",
        "cut",
        "tac",
        "rev",
        "nl",
        "fmt",
        "fold",
        "paste",
        "join",
        "comm",
        "column",
        "seq",
        "strings",
        "xxd",
        "egrep",
        "fgrep",
        "rg",
        "ag",
        "less",
        "more",
        "tree",
        # : /type
        "type",
        "man",
        "help",
        # : shell
        "test",
        "true",
        "false",
        "[",
    }
)

# CC: git read-only
_READONLY_GIT_SUBCOMMANDS: frozenset[str] = frozenset(
    {
        "log",
        "status",
        "diff",
        "show",
        "branch",
        "tag",
        "remote",
        "config",
        "describe",
        "rev-parse",
        "rev-list",
        "shortlog",
        "blame",
        "ls-files",
        "ls-tree",
        "ls-remote",
        "cat-file",
        "name-rev",
        "reflog",
        "grep",
        "cherry",
        "merge-base",
        "count-objects",
        "verify-commit",
        "verify-tag",
        "whatchanged",
    }
)

# CC: package -
# : timeout 30 git push → "git push"
_PROCESS_WRAPPERS: frozenset[str] = frozenset(
    {
        "timeout",
        "time",
        "nice",
        "nohup",
        "stdbuf",
    }
)

# CC: - allow ask
# : " ask" RFC-0019 " permissions =
# (`"**"` ) " -- permissions tool
# check_path_permission, `"**"`, ask.
# strategy ( tool opt-in, workspace root )
# setbackward compatibility.
# _PROTECTED_DIRS = {".git", ".vscode", ".idea", ".husky", ".claude"}
# _PROTECTED_FILES = {
# ".gitconfig", ".gitmodules"
# ".bashrc", ".bash_profile", ".zshrc", ".zprofile", ".profile"
# ".ripgreprc", ".mcp.json", ".claude.json"
_PROTECTED_DIRS: frozenset[str] = frozenset()
_PROTECTED_FILES: frozenset[str] = frozenset()


def check_permission(
    ctx: FrameworkContext,
    permission_key: str,
    prompt: str,
) -> None:
    """ () . 

    RFC-0019:  tool  helper

     permission_key  allow/deny rules: 
     allow →,  deny → raise PermissionDenied,  → raise AskPermission. 
    """
    # 1. "**" =
    if _WILDCARD in ctx.allow_rules:
        return

    # 2. deny
    if permission_key in ctx.deny_rules:
        raise PermissionDenied(
            reason=f"{permission_key} ",
            permission_key=permission_key,
        )

    # 3. allow
    if permission_key in ctx.allow_rules:
        return

    # 4. → ask
    raise AskPermission(prompt=prompt, permission_key=permission_key)


def _path_to_dir_glob(path: str) -> str:
    """ glob . 

    CC: allow, . 
     /Users/pcj/project/foo.py → /Users/pcj/project/**
    """
    from pathlib import PurePosixPath

    parent = str(PurePosixPath(path).parent)
    if parent == "/" or parent == ".":
        return "/**"
    return parent + "/**"


def _is_protected_path(path: str) -> bool:
    """ CC . 

    CC:  allow  ask. 
    """
    from pathlib import PurePosixPath

    parts = PurePosixPath(path).parts
    filename = PurePosixPath(path).name

    for part in parts:
        if part in _PROTECTED_DIRS:
            return True

    if filename in _PROTECTED_FILES:
        return True

    return False


def check_path_permission(ctx: FrameworkContext, path: str) -> None:
    """. 

    RFC-0019:  filesystem helper

     pathspec  (gitignore ) . 
    CC: permission_key  glob, allow . 
    CC:  (.git, .bashrc )  allow  ask. 
     write_file / replace / apply_patch / multiedit_tool . 
    """
    # 1. "**" = ( ask)
    if _WILDCARD in ctx.allow_rules and not _is_protected_path(path):
        return

    # 2. deny (gitignore )
    if ctx.deny_rules:
        deny_spec = pathspec.PathSpec.from_lines("gitwildmatch", ctx.deny_rules)
        if deny_spec.match_file(path):
            raise PermissionDenied(
                reason=f" {path} ",
                permission_key=path,
            )

    # 3. allow (gitignore )
    if ctx.allow_rules:
        allow_spec = pathspec.PathSpec.from_lines("gitwildmatch", ctx.allow_rules)
        if allow_spec.match_file(path):
            # CC: allow ask
            if _is_protected_path(path):
                raise AskPermission(
                    prompt=f" {path} ?",
                    permission_key=path,
                )
            return

    # 4. → ask (CC: permission_key glob)
    dir_glob = _path_to_dir_glob(path)
    raise AskPermission(
        prompt=f" {path} ?",
        permission_key=dir_glob,
    )


def _split_shell_commands(command: str) -> list[str]:
    """/, . 

    CC:  ``|``, ``&&``, ``||``, ``;`` . 
    """
    parts: list[str] = []
    current: list[str] = []
    in_single = False
    in_double = False
    i = 0

    while i < len(command):
        c = command[i]

        if c == "\\" and not in_single and i + 1 < len(command):
            current.append(c)
            current.append(command[i + 1])
            i += 2
            continue

        if c == "'" and not in_double:
            in_single = not in_single
        elif c == '"' and not in_single:
            in_double = not in_double
        elif not in_single and not in_double:
            if i + 1 < len(command) and command[i : i + 2] in ("||", "&&"):
                part = "".join(current).strip()
                if part:
                    parts.append(part)
                current = []
                i += 2
                continue
            elif c in ("|", ";"):
                part = "".join(current).strip()
                if part:
                    parts.append(part)
                current = []
                i += 1
                continue

        current.append(c)
        i += 1

    part = "".join(current).strip()
    if part:
        parts.append(part)

    return parts


# CC: - read-only
_OUTPUT_REDIRECT_RE = re.compile(r"^[0-9]*>{1,2}")

# CC: shell - shell -c
_SHELL_INTERPRETERS: frozenset[str] = frozenset(
    {
        "sh",
        "bash",
        "zsh",
        "dash",
        "ksh",
        "fish",
    }
)


def _is_numeric_arg(s: str) -> bool:
    """（ timeout ）。"""
    try:
        float(s)
        return True
    except ValueError:
        return False


def _strip_process_wrappers(tokens: list[str]) -> list[str]:
    """package,  tokens. 

    CC: ``timeout 30 git push`` →  ``git push`` . 
: timeout, time, nice, nohup, stdbuf,  xargs. 
    """
    i = 0
    while i < len(tokens):
        if tokens[i] in _PROCESS_WRAPPERS:
            i += 1
            while i < len(tokens) and (tokens[i].startswith("-") or _is_numeric_arg(tokens[i])):
                i += 1
        elif tokens[i] == "env":
            # CC: env VAR=val command → env value
            j = i + 1
            while j < len(tokens) and tokens[j].startswith("-"):
                j += 1
            while j < len(tokens) and "=" in tokens[j] and not tokens[j].startswith("-"):
                j += 1
            if j < len(tokens):
                i = j
            else:
                break  # standalone env → (read-only)
        elif tokens[i] == "xargs" and i + 1 < len(tokens) and not tokens[i + 1].startswith("-"):
            i += 1
        else:
            break
    return tokens[i:] if i < len(tokens) else tokens


# CC: set
# permission_key "command subcommand" ( "npm install")
# key ( "python") .
_COMMANDS_WITH_SUBCOMMANDS: frozenset[str] = frozenset(
    {
        # VCS
        "git",
        "svn",
        "hg",
        # JS/TS
        "npm",
        "npx",
        "yarn",
        "pnpm",
        "bun",
        "deno",
        # Python
        "pip",
        "pip3",
        "uv",
        "poetry",
        "pdm",
        "rye",
        "conda",
        # Rust / Go / Java
        "cargo",
        "go",
        "mvn",
        "gradle",
        # Container / K8s
        "docker",
        "docker-compose",
        "podman",
        "kubectl",
        "helm",
        # System package managers
        "brew",
        "apt",
        "apt-get",
        "yum",
        "dnf",
        "pacman",
        "apk",
        # System services
        "systemctl",
        "journalctl",
        "launchctl",
        "service",
        # Build
        "make",
        "cmake",
        "ninja",
    }
)


def _command_permission_key(tokens: list[str]) -> str:
    """ permission_key. 

    CC:  "command subcommand"  ( "npm install"), 
     ( "python") . 
    """
    head = tokens[0]
    if head in _COMMANDS_WITH_SUBCOMMANDS and len(tokens) > 1 and not tokens[1].startswith("-"):
        return f"{head} {tokens[1]}"
    return head


def _has_output_redirect(tokens: list[str]) -> bool:
    """ tokens package. 

    CC: read-only,,  ask. 
: ``>``, ``>>``, ``2>``, ``&>``, ``>&`` . 
    """
    for token in tokens[1:]:
        if token == "&>" or token.startswith(">&"):
            return True
        if _OUTPUT_REDIRECT_RE.match(token):
            return True
    return False


def _check_shell_c_inner(
    ctx: FrameworkContext,
    inner_cmd: str,
) -> tuple[str | None, str]:
    """ shell -c . 

    CC: ``bash -c "git push"`` →  ``git push`` . 
    """
    sub_commands = _split_shell_commands(inner_cmd)
    first_ask_key = ""

    for sub in sub_commands:
        sub = sub.strip()
        if not sub:
            continue
        try:
            inner_tokens = shlex.split(sub)
        except ValueError:
            inner_tokens = sub.split()
        if not inner_tokens:
            continue
        result, perm_key = _check_single_command(ctx, inner_tokens)
        if result == "ask" and not first_ask_key:
            first_ask_key = perm_key

    if first_ask_key:
        return "ask", first_ask_key
    return None, ""


def _check_single_command(
    ctx: FrameworkContext,
    tokens: list[str],
) -> tuple[str | None, str]:
    """Check one sub-command. Return (None, key)=allow, ("ask", key)=ask, raises on deny."""
    if not tokens or not tokens[0]:
        return None, ""

    # CC: package
    tokens = _strip_process_wrappers(tokens)
    if not tokens:
        return None, ""

    head = tokens[0]

    # CC: shell -c - bash -c "inner" →
    if head in _SHELL_INTERPRETERS:
        try:
            c_idx = tokens.index("-c")
            if c_idx + 1 < len(tokens):
                return _check_shell_c_inner(ctx, tokens[c_idx + 1])
        except ValueError:
            pass  # -c

    perm_key = _command_permission_key(tokens)

    # deny ( key)
    if head in ctx.deny_rules or perm_key in ctx.deny_rules:
        raise PermissionDenied(
            reason=f" {perm_key} ",
            permission_key=perm_key,
        )
    # read-only (CC: read-only)
    if head in _READONLY_COMMANDS and not _has_output_redirect(tokens):
        return None, perm_key
    if head == "git" and len(tokens) > 1 and tokens[1] in _READONLY_GIT_SUBCOMMANDS and not _has_output_redirect(tokens):
        return None, perm_key
    # allow ( key)
    if head in ctx.allow_rules or perm_key in ctx.allow_rules:
        return None, perm_key
    # → ask
    return "ask", perm_key


def check_shell_permission(ctx: FrameworkContext, command: str) -> None:
    """. 

    RFC-0019:  shell helper

    CC:  ``|``, ``&&``, ``||``, ``;``, 
     deny → read-only → allow → ask . 
    deny,  ask  ask. 
     run_shell_command . 
    """
    if _WILDCARD in ctx.allow_rules:
        return

    sub_commands = _split_shell_commands(command)

    need_ask = False
    first_ask_key = ""

    for sub in sub_commands:
        sub = sub.strip()
        if not sub:
            continue
        try:
            tokens = shlex.split(sub)
        except ValueError:
            tokens = sub.split()
        if not tokens:
            continue

        # _check_single_command raise PermissionDenied
        result, perm_key = _check_single_command(ctx, tokens)
        if result == "ask" and not need_ask:
            need_ask = True
            first_ask_key = perm_key

    if need_ask:
        raise AskPermission(
            prompt=f" {command} ?",
            permission_key=first_ask_key,
        )


def check_url_permission(ctx: FrameworkContext, url: str) -> None:
    """. 

    CC : WebFetch 

     URL  hostname,  allow/deny . 
    deny/allow  fnmatch  ( ``*.github.com``) . 
     web_fetch . 
    """
    # 1. "**" =
    if _WILDCARD in ctx.allow_rules:
        return

    # 2.
    hostname = urlparse(url).hostname or url

    # 3. deny ( *.example.com )
    for pattern in ctx.deny_rules:
        if fnmatch.fnmatch(hostname, pattern):
            raise PermissionDenied(
                reason=f" {hostname} ",
                permission_key=hostname,
            )

    # 4. allow
    for pattern in ctx.allow_rules:
        if fnmatch.fnmatch(hostname, pattern):
            return

    # 5. → ask
    raise AskPermission(
        prompt=f" {url} ?",
        permission_key=hostname,
    )


def check_mcp_permission(ctx: FrameworkContext, server_name: str, tool_name: str) -> None:
    """MCP permission check. 

    RFC-0019:  MCP helper

    CC: MCP default always-ask, key ``mcp__{server}__{tool}``. 
     server  -- allow/deny ``mcp__{server}``  server . 
     shell  head/subcommand . 
     MCPTool . 
    """
    # 1. "**" =
    if _WILDCARD in ctx.allow_rules:
        return

    server_key = f"mcp__{server_name}"
    tool_key = f"mcp__{server_name}__{tool_name}"

    # 2. deny (server + tool )
    if server_key in ctx.deny_rules or tool_key in ctx.deny_rules:
        raise PermissionDenied(
            reason=f"MCP  {tool_key} ",
            permission_key=tool_key,
        )

    # 3. allow (server + tool )
    if server_key in ctx.allow_rules or tool_key in ctx.allow_rules:
        return

    # 4. → ask
    raise AskPermission(
        prompt=f" MCP  {tool_key} ?",
        permission_key=tool_key,
    )