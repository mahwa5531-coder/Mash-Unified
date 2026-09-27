#!/usr/bin/env python3
import json
import subprocess
import sys
from typing import Any

OWNER = "china-qijizhifeng"
PROJECT_NUM = "5"
PROJECT_ID = "PVT_kwDOCmnEdM4BQARn"

REPO_META = {
    "nexau": {
        "role": "NexAU ",
        "dependency": "， repo ",
    },
    "nexau-cloud-runtime": {
        "role": "Cloud ",
        "dependency": " git submodule  `nexau`",
    },
    "north-coder": {
        "role": "",
        "dependency": "backend  pip  `nexau`",
    },
}

VIEW_PURPOSE = {
    "Backlog": " issue（`status:Backlog, no:iteration`）",
    "Iteration board": "， Status × Repo ",
    "Iteration table": "，",
    "Roadmap": "",
    "My items": "",
    "PR": "PR ",
    " MAP ": "",
}

LAYOUT_NAME = {
    "TABLE_LAYOUT": "Table",
    "BOARD_LAYOUT": "Board",
    "ROADMAP_LAYOUT": "Roadmap",
}

WORKFLOW_NOTE = {
    "Auto-add nexau to project": "nexau  issue ",
    "Auto-add nexau-cloud-runtime to project": "cloud-runtime  issue ",
    "Auto-add nexau-coder to project": "north-coder  issue ",
    "Auto-add Gitagents to project": "Gitagents  issue ",
    "Auto-add sub-issues to project": " issue ",
    "Item added to project": " item  Backlog",
    "Item reopened": "reopen  In progress",
    "Pull request merged": "PR ",
    "Auto-close issue": " issue ",
    "Item closed": " repo workflow ， `not_planned/duplicate`  Done",
}

WORKFLOW_ORDER = [
    "Auto-add nexau to project",
    "Auto-add nexau-cloud-runtime to project",
    "Auto-add nexau-coder to project",
    "Auto-add Gitagents to project",
    "Auto-add sub-issues to project",
    "Item added to project",
    "Item reopened",
    "Pull request merged",
    "Auto-close issue",
    "Item closed",
]


def run(*args: str) -> str:
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"command failed: {' '.join(args)}\n{result.stderr}")
    return result.stdout


def gh_json(*args: str) -> Any:
    return json.loads(run("gh", *args))


def get_project_data() -> dict[str, Any]:
    query = f'''
    {{
      node(id: "{PROJECT_ID}") {{
        ... on ProjectV2 {{
          title
          url
          views(first: 20) {{
            nodes {{
              ... on ProjectV2View {{
                name
                number
                layout
              }}
            }}
          }}
          workflows(first: 20) {{
            nodes {{
              id
              name
              enabled
              number
            }}
          }}
          fields(first: 30) {{
            nodes {{
              ... on ProjectV2IterationField {{
                id
                name
                configuration {{
                  iterations {{ id title startDate duration }}
                  completedIterations {{ id title startDate duration }}
                }}
              }}
            }}
          }}
        }}
      }}
    }}'''
    data = gh_json("api", "graphql", "-f", f"query={query}")
    return data["data"]["node"]


def latest_tag(repo: str) -> str:
    data = gh_json("api", f"repos/{OWNER}/{repo}/tags?per_page=1")
    return data[0]["name"] if data else "-"


def normalize_sprint_title(title: str) -> str:
    if title.startswith("Sprint") and not title.startswith("Sprint "):
        return title.replace("Sprint", "Sprint ", 1)
    return title


def render() -> str:
    project = get_project_data()
    views = sorted(project["views"]["nodes"], key=lambda x: x["number"])
    workflows = {wf["name"]: wf for wf in project["workflows"]["nodes"]}

    iteration_field = None
    for field in project["fields"]["nodes"]:
        if field and field.get("name") == "Iteration":
            iteration_field = field
            break
    if not iteration_field:
        raise RuntimeError("Iteration field not found")

    current_iterations = iteration_field["configuration"]["iterations"]
    current_sprint = normalize_sprint_title(current_iterations[0]["title"]) if current_iterations else "-"
    next_sprint = normalize_sprint_title(current_iterations[1]["title"]) if len(current_iterations) > 1 else "-"

    repo_rows = []
    for repo, meta in REPO_META.items():
        repo_rows.append(f"| [{repo}](https://github.com/{OWNER}/{repo}) | {meta['role']} | `{latest_tag(repo)}` | {meta['dependency']} |")

    view_rows = []
    for view in views:
        name = view["name"]
        layout = LAYOUT_NAME.get(view["layout"], view["layout"])
        purpose = VIEW_PURPOSE.get(name, "-")
        view_rows.append(f"| {view['number']} | **{name}** | {layout} | {purpose} |")

    workflow_rows = []
    for name in WORKFLOW_ORDER:
        wf = workflows.get(name)
        if not wf:
            continue
        status = "Enabled" if wf["enabled"] else "Disabled"
        note = WORKFLOW_NOTE.get(name, "-")
        workflow_rows.append(f"| {name} | {status} | {note} |")

    return f"""# {project["title"]}

NexAU ， `nexau` / `nexau-cloud-runtime` / `north-coder`  repo  backlog、iteration、PR、roadmap 。

：<{project["url"]}>

## 

- ** Sprint**：`{current_sprint}`
- ** Sprint**：`{next_sprint}`
- ****： Sprint（** ~ **）

## 

| Repo |  |  Tag |  |
|------|------|----------|----------|
{chr(10).join(repo_rows)}

## 

| # | View | Layout |  |
|---|------|--------|------|
{chr(10).join(view_rows)}

## 

### Status

`Backlog → Todo → In progress → Done / Blocked / Paused / Cancelled`

- **Backlog**：
- **Todo**：，
- **In progress**：
- **Done**：
- **Blocked**：
- **Paused**：
- **Cancelled**： / 

### Close reason → Status 

- `completed` → **Done**
- `not_planned` → **Cancelled**
- `duplicate` → **Cancelled**
- `reopened` → **In progress**

### 

- **Iteration**： Sprint 
- **Priority**：P0 / P1 / P2 / P3
- **Module**： Roadmap 

## 

### Project  Workflows

| Workflow |  |  |
|----------|------|------|
{chr(10).join(workflow_rows)}

### Repo Actions Workflows

#### 1. Backlog / Todo / Done 
- ：`.github/workflows/project-auto-status.yml`
- ： 10 
- ：
  - issue  Iteration  Backlog →  Todo
  - Todo  Iteration  →  Backlog
  - Project Status  Done， issue  open →  `close as completed`

#### 2. Close reason 
- ：`.github/workflows/project-auto-status-on-close.yml`
- ：`issues.closed`
- ：
  - `completed` → Done
  - `not_planned` / `duplicate` → Cancelled

#### 3. Milestone 
- ：`.github/workflows/milestone-auto-manage.yml`
- ： tag
- ： /  /  Milestone， Milestone

## README 

- ** 22:00（Asia/Shanghai / UTC+8）** Project README
-  repo/tag、views、iteration 、workflow ， Project Settings  README
- README sync workflow  repo Actions 

## Secrets / 

 repo ：

| Secret |  |
|--------|------|
| `PROJECT_PAT` |  `project` read/write ， Project  README  |

「 issue 」「」，：

1. Project Settings → Workflows  **`Item closed`**  **Disabled**
2.  repo  **`PROJECT_PAT`**  / 
3.  workflow run  `Could not resolve to a node` / project permission 
"""


if __name__ == "__main__":
    sys.stdout.write(render())