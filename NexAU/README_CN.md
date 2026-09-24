<p align="left">
    &nbsp ｜ &nbsp  <a href="README_CN.md">English</a>
</p>


# NexAU 

 Agent ， Agent 。

、 Agent ，LLM。

**➡️  [`docs/`](./docs/index.md) 。**

**Windows ：** NexAU  Windows 10  Windows 11， PowerShell
backend。Git Bash  backend， bash-compatible  bash-only
。 [Windows ](./docs/windows.md)。

---

## 

###  GitHub Release （）

** pip：**
```bash
# （SSH，nexau）
pip install git+ssh://git@github.com/nex-agi/NexAU.git@v0.4.1

#  https://github.com/nex-agi/NexAU/releases/  whl ，
pip install nexau-0.4.1-py3-none-any.whl
```

** uv：**
```bash
# （SSH）
uv pip install git+ssh://git@github.com/nex-agi/NexAU.git@v0.4.1

#  https://github.com/nex-agi/NexAU/releases/  whl ，
uv pip install nexau-0.4.1-py3-none-any.whl
```

###  Main 

** pip：**
```bash
pip install git+ssh://git@github.com/nex-agi/NexAU.git
```

** uv：**
```bash
uv pip install git+ssh://git@github.com/nex-agi/NexAU.git
```

### 

```bash
git clone git@github.com:nex-agi/NexAU.git
cd NexAU

#  uv 
pip install uv
uv sync
```

## 

1.  ****， `.env` ：
    ```.env
    LLM_MODEL="-llm-"
    LLM_BASE_URL="-llm-apiurl"
    LLM_API_KEY="-llm-api"
    SERPER_API_KEY="serper.devapi"（）

    LANGFUSE_SECRET_KEY=sk-lf-xxx
    LANGFUSE_PUBLIC_KEY=pk-lf-xxx
    LANGFUSE_HOST="https://us.cloud.langfuse.com"
    ```
    ：NexAU  Langfuse ， Langfuse 。

2.  **：**
    ```bash
    #  python-dotenv (`uv pip install python-dotenv`)
    dotenv run uv run examples/code_agent/start.py

    ：
    ```

3.  ** Python  YAML？**  `examples/code_agent/code_agent.yaml`  Agent ，code_agent.py：
    ```python
    import logging
    import os
    from pathlib import Path

    from nexau import Agent, AgentConfig, LLMConfig, Skill, Tool
    from nexau.archs.main_sub.execution.hooks import LoggingMiddleware

    from nexau.archs.tool.builtin import (
        google_web_search,
        list_directory,
        read_file,
        read_many_files,
        replace,
        run_shell_command,
        search_file_content,
        web_fetch,
        write_file,
        write_todos,
    )

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

    base_dir = Path("examples/code_agent")

    # NexAU decouples the definition and implementation (binding) of tools
    tools = [
        Tool.from_yaml(base_dir / "tools/WebSearch.tool.yaml", binding=google_web_search),
        Tool.from_yaml(base_dir / "tools/WebFetch.tool.yaml", binding=web_fetch),
        Tool.from_yaml(base_dir / "tools/write_todos.tool.yaml", binding=write_todos),
        Tool.from_yaml(base_dir / "tools/search_file_content.tool.yaml", binding=search_file_content),
        Tool.from_yaml(base_dir / "tools/read_file.tool.yaml", binding=read_file),
        Tool.from_yaml(base_dir / "tools/write_file.tool.yaml", binding=write_file),
        Tool.from_yaml(base_dir / "tools/replace.tool.yaml", binding=replace),
        Tool.from_yaml(base_dir / "tools/run_shell_command.tool.yaml", binding=run_shell_command),
        Tool.from_yaml(base_dir / "tools/list_directory.tool.yaml", binding=list_directory),
        Tool.from_yaml(base_dir / "tools/read_many_files.tool.yaml", binding=read_many_files),
    ]

    # NexAU supports Skills (compatible with Claude Skills)
    skills = [
        Skill.from_folder(base_dir / "skills/skill-creator"),
        Skill.from_folder(base_dir / "skills/template-skill"),
    ]

    # Tracer allows you to forward execution data for observability.
    tracer = LangfuseTracer(
        public_key=os.getenv("LANGFUSE_PUBLIC_KEY"),
        secret_key=os.getenv("LANGFUSE_SECRET_KEY"),
        host=os.getenv("LANGFUSE_HOST"),
    )

    agent_config = AgentConfig(
        name="nexau_code_agent",
        max_context_tokens=100000,
        system_prompt=str(base_dir / "systemprompt.md"),
        system_prompt_type="jinja",
        tool_call_mode="structured", # xml  structured
        llm_config=LLMConfig(
            temperature=0.7,
            max_tokens=4096,
            model=os.getenv("LLM_MODEL"),
            base_url=os.getenv("LLM_BASE_URL"),
            api_key=os.getenv("LLM_API_KEY"),
            api_type="openai_chat_completion",
        ),
        tools=tools,
        skills=skills,
        middlewares=[
            LoggingMiddleware(
                model_logger="nexau_code_agent",
                tool_logger="nexau_code_agent",
                log_model_calls=True,
            ),
        ],
        tracers=[tracer]
    )

    agent = Agent(config = agent_config)

    print(agent.run("", context={"working_directory": os.getcwd()}))

    ```
     `dotenv run uv run code_agent.py`  Agent

4. ** NexAU CLI **

    ** run-agent （）**
    ```bash
    #  NexAU Agent  yaml 
    ./run-agent examples/code_agent/code_agent.yaml
    ```
     Windows ， wrapper：
    ```powershell
    .\run-agent.cmd examples/code_agent/code_agent.yaml
    ```
    NexAU CLI 、Sub-agent， NexAU  Agent。
    ![NexAU CLI](assets/nexau_cli.jpeg)

## 

### 

 `Makefile`  CI 。 `uv`， `install`  pre-commit ：

```bash
pip install uv        # 
make install          #  `uv sync` + `uv run pre-commit install`
```

### 

 GitHub Actions  lint/type/test ， CI ：

```bash
make lint            #  ruff lint 
make format          #  ruff 
make format-check    #  formatter（CI ）
make typecheck       #  mypy  pyright
make mypy-coverage   #  mypy_reports/  Cobertura + HTML 
make test            #  pytest， coverage.xml  htmlcov/
make ci              #  lint、format-check、typecheck、test
```

、CI  Codecov ：

- `mypy_reports/type_cobertura/cobertura.xml`  `mypy_reports/type_html/index.html`（）。
- `coverage.xml`  `htmlcov/index.html`（）。