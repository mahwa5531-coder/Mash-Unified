# RFC-0002: AgentTeam —  Agent 

- ****: implemented
- ****: P0
- ****: `architecture`, `agent`, `collaboration`
- ****: `nexau/archs/main_sub/`, `nexau/archs/session/`, `nexau/archs/transports/http/`, `nexau/archs/tool/`
- ****: 2026-02-17
- ****: 2026-02-25

## 

 NexAU  AgentTeam ： leader agent  teammate agents， + 。 `(user_id, session_id)`  AgentTeam， agent  session 。

## 

 NexAU  Agent  agent  parent→sub-agent 。Sub-agent "--"，：

1. ****： agent ，
2. ****：leader 、 teammate，teammate 
3. ****：agent ， parent 
4. ****： SSE  agent ，

AgentTeam ， leader-teammate ，、、。

## 

### 

```
┌─────────────────────────────────────────────────────────────────────┐
│                     AgentTeam (session scope)                       │
│                                                                     │
│  ┌───────────────┐         ┌──────────────────────────────────┐    │
│  │  Leader Agent  │────────▶│       Shared Task Board          │    │
│  │  (coordinator) │         │  ┌──────┐ ┌──────┐ ┌──────┐    │    │
│  └───────┬───────┘         │  │ T-001│ │ T-002│ │ T-003│    │    │
│          │                  │  │pend. │ │in_pr.│ │comp. │    │    │
│          │ spawn/message    │  └──────┘ └──────┘ └──────┘    │    │
│          │                  └──────────────────────────────────┘    │
│  ┌───────▼───────────────────────────────────┐                     │
│  │            Teammate Agents                 │                     │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐│                     │
│  │  │ coder-1  │  │ coder-2  │  │reviewer-1││                     │
│  │  │ (role:   │  │ (role:   │  │ (role:   ││                     │
│  │  │  coder)  │  │  coder)  │  │ reviewer)││                     │
│  │  └──────────┘  └──────────┘  └──────────┘│                     │
│  └───────────────────────────────────────────┘                     │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │  Team Message Bus (DB-backed, per-agent inbox)           │      │
│  └──────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼ SSE (TeamStreamEnvelope)
┌─────────────────────┐
│  Client / Frontend   │
│  multi-agent stream  │
└─────────────────────┘
```

：

- **AgentTeam**：Team ， leader + teammates 
- **TaskBoard**：，DB-backed， claim/release
- **TeamMessageBus**：，DB-backed， history
- **Team Tools**： leader  teammates 
- **TeamSSEMultiplexer**： agent ， `TeamStreamEnvelope`

### 

#### 1. 

##### 1.1 TeamModel（ SQLModel）

```python
class TeamModel(SQLModel, table=True):
    """Team metadata — one team per (user_id, session_id)."""

    __tablename__ = "teams"

    user_id: str = Field(primary_key=True)
    session_id: str = Field(primary_key=True)
    team_id: str = Field(primary_key=True)

    # Leader
    leader_agent_id: str

    #  (role_name -> agent_config_ref)
    #  candidates  team member
    candidates: dict[str, str] = Field(
        default_factory=dict,
        sa_column=Column(JSON),
    )

    max_teammates: int = Field(default=10)

    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)


class TeamMemberModel(SQLModel, table=True):
    """Teammate instance record."""

    __tablename__ = "team_members"

    user_id: str = Field(primary_key=True)
    session_id: str = Field(primary_key=True)
    team_id: str = Field(primary_key=True)
    agent_id: str = Field(primary_key=True)  # e.g. "coder-1"

    role_name: str

    # Agent  session_id（ history/state  team ）
    member_session_id: str = Field(default="")

    # : idle | running | stopped
    status: str = Field(default="idle")

    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
```

##### 1.2 TeamTaskModel（ SQLModel）

```python
class TeamTaskModel(SQLModel, table=True):
    """Shared task board for AgentTeam collaboration."""

    __tablename__ = "team_tasks"

    user_id: str = Field(primary_key=True)
    session_id: str = Field(primary_key=True)
    team_id: str = Field(primary_key=True)
    task_id: str = Field(primary_key=True)  # : "T-001"

    title: str
    description: str = ""
    priority: int = Field(default=0)  # 0=normal, 1=high, 2=critical

    # : pending -> in_progress -> completed
    status: str = Field(default="pending")  # pending | in_progress | completed

    # :  completed  blocked
    dependencies: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON),
    )  # list of task_id

    assignee_agent_id: str | None = Field(default=None)

    result_summary: str | None = Field(default=None)
    deliverable_path: str | None = Field(default=None)  # : .nexau/tasks/{task_id}-{slug}.md
    created_by: str = ""  # agent_id of creator
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
```

##### 1.3 TeamTaskLockModel（ SQLModel）

```python
class TeamTaskLockModel(SQLModel, table=True):
    """Short-lived lock for task claim/update critical sections."""

    __tablename__ = "team_task_locks"

    #  —  task 
    user_id: str = Field(primary_key=True)
    session_id: str = Field(primary_key=True)
    team_id: str = Field(primary_key=True)
    task_id: str = Field(primary_key=True)

    holder_id: str  # : "{pid}:{uuid}"， AgentLockService 

    # TTL（ TaskLockService ，）
    acquired_at_ns: int
    expires_at_ns: int
```

> ： `claim_task` / `release_task` / `update_task_status` （ 3–10s），""。

##### 1.4 TeamMessageModel（ SQLModel）

```python
class TeamMessageModel(SQLModel, table=True):
    """Persistent intra-team messages."""

    __tablename__ = "team_messages"

    user_id: str = Field(primary_key=True)
    session_id: str = Field(primary_key=True)
    team_id: str = Field(primary_key=True)
    message_id: str = Field(primary_key=True)  # UUID

    from_agent_id: str
    to_agent_id: str | None = Field(default=None)  # None = broadcast

    content: str
    message_type: str = Field(default="text")  # text | idle_notification

    delivered: bool = Field(default=False)
    delivered_at: datetime | None = Field(default=None)

    created_at: datetime = Field(default_factory=datetime.now)
```

#### 2. ：DB-backed TTL Lock

 `AgentLockService` ， `TaskLockService`：

```
acquire(task_id)
  │
  ├─  TeamTaskLockModel(task_id)
  │   ├─  expires_at_ns > now →  (LockConflictError)
  │   └─  /  → 
  │
  ├─  (claim / update_status / release)
  │
  └─ 
```

：

- **TTL **： 5s， heartbeat（ DB ）
- ****：acquire ，
- ****：`InMemoryDatabaseEngine` / `SQLDatabaseEngine` / `RemoteDatabaseEngine` 
- ****：`claim_task`、`release_task`、`update_task_status` 

```python
class TaskLockService:
    """Short-lived DB-backed TTL lock for task operations."""

    def __init__(self, *, engine: DatabaseEngine, lock_ttl: float = 5.0) -> None:
        self._engine = engine
        self._lock_ttl = lock_ttl

    @asynccontextmanager
    async def acquire(
        self,
        *,
        user_id: str,
        session_id: str,
        team_id: str,
        task_id: str,
    ) -> AsyncGenerator[None, None]:
        # 1. 
        existing = await self._find_valid_lock(user_id, session_id, team_id, task_id)
        if existing is not None:
            raise LockConflictError(f"Task {task_id} is locked by {existing.holder_id}")

        # 2. 
        holder_id = f"{os.getpid()}:{uuid4()}"
        now_ns = time.time_ns()
        lock = TeamTaskLockModel(
            user_id=user_id,
            session_id=session_id,
            team_id=team_id,
            task_id=task_id,
            holder_id=holder_id,
            acquired_at_ns=now_ns,
            expires_at_ns=now_ns + int(self._lock_ttl * 1_000_000_000),
        )
        await self._engine.create(lock)

        try:
            yield
        finally:
            # 3. （，）
            await self._engine.delete_where(
                TeamTaskLockModel,
                user_id=user_id,
                session_id=session_id,
                team_id=team_id,
                task_id=task_id,
                holder_id=holder_id,  # 
            )
```

#### 3. AgentTeam 

```
POST /team/stream (or /team/query)
  │
  ▼
AgentTeam.initialize()
  ├─  TeamModel / TeamMemberModel  /  team 
  ├─  DatabaseEngine models (TeamModel, TeamMemberModel, TeamTaskModel, TeamTaskLockModel, TeamMessageModel)
  ├─  teammate （ session ）
  └─  Leader Agent （ Team Tools， spawn_teammate）

AgentTeam.run(message)
  ├─  (self._loop = asyncio.get_running_loop())
  ├─ Leader Agent  team_mode （forever-run ）
  │   ├─ Leader ， spawn_teammate(role_name)  teammates
  │   │   （spawn_teammate  run_coroutine_threadsafe  teammate）
  │   ├─ Leader  create_task() 
  │   ├─ Leader  claim_task(task_id, assignee_agent_id)  spawn  teammate
  │   │   （claim_task  message  teammate）
  │   ├─ Leader/Teammate  message() / broadcast() 
  │   │   （ enqueue_message  agent）
  │   └─ Leader  finish_team(summary) 
  │       （finish_team  stop tool， leader executor ）
  │
  ├─ Teammate Agent （asyncio.run_coroutine_threadsafe）
  │   ├─ spawn_teammate  forever-run 
  │   ├─  teammate  Agent  +  executor
  │   ├─  _message_available.wait() 
  │   └─ ，drain queued_messages， LLM 
  │
  ├─ Leader ，force_stop  teammate
  └─  team  TeamModel / TeamMemberModel
```

##### 3.1 Teammate 

```python
class AgentTeam:
    """Team lifecycle manager."""

    def __init__(
        self,
        *,
        leader_config: AgentConfig,
        candidates: dict[str, AgentConfig],  # role_name -> config
        engine: DatabaseEngine,
        session_manager: SessionManager,
        user_id: str,
        session_id: str,
        max_teammates: int = 10,  # teammate 
    ) -> None: ...

    async def spawn_teammate(self, role_name: str) -> str:
        """Spawn a new teammate instance from candidates[role_name].

        Returns agent_id (e.g. "coder-1", "coder-2").
        Raises MaxTeammatesError if current active count >= max_teammates.
        """
        ...

    async def remove_teammate(self, agent_id: str) -> None:
        """Remove a teammate instance (marks idle, removes from active list)."""
        ...

    async def run(
        self,
        message: str,
        *,
        on_event: Callable[[TeamStreamEnvelope], None] | None = None,
    ) -> str:
        """Run the team: start leader, manage teammate lifecycle."""
        ...
```

- `candidates`  `dict[role_name, AgentConfig]`，，
- Leader  `spawn_teammate` tool  teammate（ 2  coder + 1  reviewer）
-  role ， `agent_id` （ `coder-1`, `coder-2`）
- ， spawn  teammate  `TeamMemberModel` 

##### 3.1.1 Session 

 agent（leader + teammates） session， GlobalStorage  session context。
Agent  MessageBus 。

```
team_session_id  →   session_id， team （TeamModel, TaskBoard, MessageBus）
                     Agent

leader session   →  f"{team_session_id}:leader"
teammate session →  f"{team_session_id}:{agent_id}"   e.g. "sess-abc:code_agent-1"
```

：

- `AgentTeam._team_session_id`  team  scope（TaskBoard、MessageBus、TeamModel ）
-  Agent  `session_id`， SessionModel（history、GlobalStorage、context）
- `TeamMemberModel.member_session_id`  agent  session_id， team 
-  `global_storage=` ， Agent  GlobalStorage
-  teammate ： agent ， MessageBus 

##### 3.2 Teammate  — Forever-Run 

 teammate  "forever run" ：agent  executor  team_mode ，
， `enqueue_message` 。Agent  `force_stop()` 。

###### 3.2.1 Executor team_mode 

`Executor` ：

- `team_mode: bool = False` — 
- `_message_available = threading.Event()` — 
- `enqueue_message()`  `_message_available.set()` 
- `force_stop()` —  `stop_signal`  `_message_available`

```
Executor loop (team_mode):
  while iteration < max_iterations:
    1. Check stop_signal → break
    2. Drain queued_messages → append to history
    3. LLM call → parse → execute tools
    4. If should_stop (no tool calls) and no stop_tool_result:
       → while not stop_signal and no queued_messages:
           _message_available.clear()
           _message_available.wait(timeout=30)
       → continue (re-enter loop to drain messages and call LLM)
    5. If stop_tool_result → break (finish_team triggered)
```

：team_mode  stop_tool  `should_stop` ，
 while  `stop_signal`。
 while ， assistant  LLM（LLM ）。

###### 3.2.2  asyncio 

`spawn_teammate`  tool executor 。Tool  async 
`asyncio.run()` （ `Tool.execute()` line 296）。
** `asyncio.create_task()`** —  task ，teammate 。

：`AgentTeam.run()` ，`spawn_teammate` 
`asyncio.run_coroutine_threadsafe()` ：

```python
# AgentTeam.run() 
self._loop = asyncio.get_running_loop()

# spawn_teammate 
teammate_future = asyncio.run_coroutine_threadsafe(
    self._run_teammate_forever(agent_id),
    self._loop,
)
self._teammate_futures[agent_id] = teammate_future  # concurrent.futures.Future
```

 `concurrent.futures.Future`（ `asyncio.Task`） teammate 。
`remove_teammate`  `_stop_all_teammates`  `future.cancel()` + `future.result(timeout=...)` 。

###### 3.2.3 Teammate 

```python
async def _run_teammate_forever(self, agent_id: str) -> None:
    """Run teammate in forever-run mode. Exits only on force_stop."""
    agent = self._teammate_agents[agent_id]
    await self._update_member_status(agent_id, "running")
    self._watchdog.register(agent_id)
    try:
        await agent.run_async(
            message="You have been activated. Wait for task assignments and messages from the leader."
        )
    except Exception as e:
        logger.error(f"Teammate {agent_id} exited with error: {e}")
    finally:
        await self._update_member_status(agent_id, "idle")
        self._watchdog.unregister(agent_id)
```

##### 3.3 

```
Agent A  message(to_agent_id="B", content="...")
  │
  ▼
TeamMessageBus.send(from="A", to="B", content="...")
  ├─  TeamMessageModel ()
  │
  ▼
AgentTeam.message(to="B", content, from="A")
  ├─  system message: "[Team Message from A]: ..."
  ├─  agent.enqueue_message(msg)
  │   ├─  executor.queued_messages
  │   └─ executor._message_available.set()  ←  forever-run 
  │
  ▼
Agent B  executor 
  ├─  _message_available.wait()
  ├─  drain queued_messages →  history
  └─  LLM（history ）
```

：

- ****： `_message_available.set()`  agent，
- ****： `TeamMessageModel`，
- ****： `executor.enqueue_message()` ， middleware drain 

```python
def message(
    self,
    to_agent_id: str,
    content: str,
    from_agent_id: str,
) -> None:
    """Enqueue a message to a teammate or leader agent.

    RFC-0002:  teammate  leader 

     executor.enqueue_message ，
    executor  _message_available 。
    """
    enqueue_text = f"[Team Message from {from_agent_id}]: {content}"
    msg = {"role": "system", "content": enqueue_text}

    if to_agent_id == self._leader_agent_id:
        if self._leader_agent is not None:
            self._leader_agent.enqueue_message(msg)
    else:
        agent = self._teammate_agents.get(to_agent_id)
        if agent is not None:
            agent.enqueue_message(msg)
```

##### 3.4 

Teammate  idle 。 teammate  idle ，watchdog  leader：

```
 teammate  idle 
  │
  ▼
TeammateWatchdog._check_all_idle() → True
  │
  ▼
TeammateWatchdog._notify_leader(
    "[All Idle] All agents are idle. Review task board status and decide next steps — assign new tasks, check results.",
    "watchdog"
)
  │
  ▼
Leader ，（ /  /  finish_team）
```

##### 3.5 Teammate Watchdog

`AgentTeam`  watchdog ，（ agent 、）：

```python
@dataclass(frozen=True)
class WatchdogConfig:
    """Idle detection configuration."""
    idle_check_interval_seconds: float = 10.0  # 


class TeammateWatchdog:
    """Detects all-idle deadlock among teammates.

    RFC-0002: 

     asyncio.Task ， running  teammate。
     teammate  idle（）， leader 。
    Leader 、 finish_team。
    """

    def __init__(
        self,
        *,
        config: WatchdogConfig,
        check_all_idle: Callable[[], bool] | None = None,
        notify_leader: Callable[[str, str], None] | None = None,
    ) -> None:
        self._config = config
        self._start_times: dict[str, float] = {}  # agent_id -> start_timestamp
        self._stopped = False
        self._check_all_idle = check_all_idle    #  agent  idle 
        self._notify_leader = notify_leader      #  leader 

    def stop(self) -> None:
        """Signal the watchdog loop to exit."""
        self._stopped = True

    def register(self, agent_id: str) -> None:
        """Register a teammate as running (called on spawn)."""
        self._start_times[agent_id] = time.monotonic()

    def unregister(self, agent_id: str) -> None:
        """Unregister a teammate (called on idle/stop)."""
        self._start_times.pop(agent_id, None)

    async def run(self) -> None:
        """Watchdog loop — runs as background asyncio.Task."""
        while not self._stopped:
            await asyncio.sleep(self._config.idle_check_interval_seconds)
            #  —  teammate  leader
            if self._check_all_idle is not None and self._notify_leader is not None and len(self._start_times) > 0:
                if self._check_all_idle():
                    self._notify_leader(
                        "[All Idle] All agents are idle. Review task board status and decide next steps — assign new tasks, check results.",
                        "watchdog",
                    )
```

Watchdog  `AgentTeam.run()` ，team run ：

```python
# AgentTeam.run() 
watchdog_task = asyncio.create_task(self._watchdog.run())
try:
    result = await self._run_leader(message)
finally:
    watchdog_task.cancel()
```

 RFC ：

- ****： teammate （5 ）， per-agent 
- ****：（ agent ），
- ****：（leader  teammate，teammate  leader）， agent  LLM 

Leader ，：
-  `list_tasks()` ，
-  `finish_team(summary)` 
-  `message(to_agent_id, "...")`  teammate

#### 4. AgentTeamState

 `AgentState`， team ， `get_context_value`  `Any` ：

```python
class AgentTeamState(AgentState):
    """Extended AgentState with typed team collaboration context.

    RFC-0002: Team 

     Team Tools  team ，
     get_context_value 。
    """

    team: AgentTeam
    task_board: TaskBoard
    message_bus: TeamMessageBus
    is_leader: bool
```

##### 4.1 Team Tool 

 Tool  dataclass， `dict[str, str]` ：

```python
@dataclass(frozen=True)
class TeammateInfo:
    """Teammate instance info."""
    agent_id: str
    role_name: str
    status: str  # idle | running | stopped


@dataclass(frozen=True)
class TaskInfo:
    """Task board entry."""
    task_id: str
    title: str
    description: str
    status: str  # pending | in_progress | completed
    priority: int
    dependencies: list[str]
    assignee_agent_id: str | None
    result_summary: str | None
    created_by: str
    is_blocked: bool  #  completed
    deliverable_path: str | None  # 


@dataclass(frozen=True)
class SpawnResult:
    """spawn_teammate 。"""
    agent_id: str
    role_name: str


@dataclass(frozen=True)
class RemoveTeammateResult:
    """remove_teammate 。"""
    agent_id: str
    role_name: str


@dataclass(frozen=True)
class CreateTaskResult:
    """create_task 。"""
    task_id: str
    title: str
    description: str
    priority: int
    status: str
    deliverable_path: str  # 


@dataclass(frozen=True)
class ClaimTaskResult:
    """claim_task 。"""
    task_id: str
    title: str
    status: str
    assignee_agent_id: str
    deliverable_path: str | None  # （）


@dataclass(frozen=True)
class UpdateTaskStatusResult:
    """update_task_status 。"""
    task_id: str
    title: str
    status: str
    result_summary: str | None = None


@dataclass(frozen=True)
class ReleaseTaskResult:
    """release_task 。"""
    task_id: str
    title: str
    status: str


@dataclass(frozen=True)
class MessageResult:
    """message / broadcast 。"""
    message_id: str
    delivered_to: list[str]  #  agent_id 


@dataclass(frozen=True)
class FinishTeamResult:
    """finish_team 。"""
    summary: str
    completed_tasks: int
    total_tasks: int


@dataclass(frozen=True)
class ToolError:
    """Tool 。"""
    error: str
    code: str  # permission_denied | conflict | blocked | not_found | invalid_state | busy
    status: str = "error"  #  "error"， executor stop-tool 
```

 team agent  `AgentTeamState`  `AgentState`：

```python
# AgentTeam.initialize() 
team_state = AgentTeamState(
    #  AgentState 
    agent_name=agent_name,
    agent_id=agent_id,
    run_id=run_id,
    root_run_id=root_run_id,
    context=context,
    global_storage=global_storage,
    executor=executor,
    # Team 
    team=self,
    task_board=self._task_board,
    message_bus=self._message_bus,
    is_leader=(agent_id == self._leader_agent_id),
)
```

> Tool  `agent_state: AgentTeamState`，。

#### 5. Team Tools

 Team Tools  `AgentTeamState`  team 。Leader  Teammate 。

##### 5.1 

|  | Leader | Teammate |  |
|--------|--------|----------|------|
| `spawn_teammate` | ✅ | ❌ |  candidates  teammate（leader-only） |
| `remove_teammate` | ✅ | ❌ |  teammate （leader-only） |
| `message` | ✅ | ✅ |  |
| `broadcast` | ✅ | ✅ |  |
| `list_teammates` | ✅ | ✅ |  teammate  |
| `list_tasks` | ✅ | ✅ | （、、） |
| `create_task` | ✅ | ❌ | （leader-only） |
| `claim_task` | ✅ | ✅ | /（leader  assignee，teammate  self-claim）|
| `update_task_status` | ✅ | ✅ |  |
| `release_task` | ✅ | ✅ | （） |
| `finish_team` | ✅ | ❌ | （leader-only stop tool） |

##### 5.2 

```python
# --- spawn_teammate (leader-only) ---
async def spawn_teammate(
    role_name: str,
    agent_state: AgentTeamState,
) -> SpawnResult | ToolError:
    """Spawn a new teammate instance from candidates.

    RFC-0002:  candidates  teammate

    Leader ， candidates 
     teammate agent。 role  spawn
    （ coder-1, coder-2）。

    Teammate  asyncio.Task ，
     message  claim_task 。
    """
    if not agent_state.is_leader:
        return ToolError(error="Only leader can spawn teammates", code="permission_denied")

    try:
        agent_id = await agent_state.team.spawn_teammate(role_name)
    except MaxTeammatesError:
        return ToolError(
            error=f"Max teammates limit reached ({agent_state.team.max_teammates})",
            code="invalid_state",
        )
    return SpawnResult(agent_id=agent_id, role_name=role_name)


# --- remove_teammate (leader-only) ---
async def remove_teammate(
    agent_id: str,
    agent_state: AgentTeamState,
) -> RemoveTeammateResult | ToolError:
    """Remove a teammate instance.

    RFC-0002:  teammate 

     idle  teammate。 teammate
     stop 。
    """
    if not agent_state.is_leader:
        return ToolError(error="Only leader can remove teammates", code="permission_denied")

    await agent_state.team.remove_teammate(agent_id)
    return RemoveTeammateResult(agent_id=agent_id, role_name=...)


# --- message ---
async def message(
    to_agent_id: str,
    content: str,
    agent_state: AgentTeamState,
) -> MessageResult:
    """Send a message to a specific teammate.

    RFC-0002: 

     agent 。
    """
    msg = await agent_state.message_bus.send(
        from_agent_id=agent_state.agent_id,
        to_agent_id=to_agent_id,
        content=content,
    )
    return MessageResult(message_id=msg.message_id, delivered_to=[to_agent_id])


# --- broadcast ---
async def broadcast(
    content: str,
    agent_state: AgentTeamState,
) -> MessageResult:
    """Broadcast a message to all teammates.

    RFC-0002: 
    """
    msg, recipients = await agent_state.message_bus.broadcast(
        from_agent_id=agent_state.agent_id,
        content=content,
    )
    return MessageResult(message_id=msg.message_id, delivered_to=recipients)


# --- list_teammates ---
async def list_teammates(
    agent_state: AgentTeamState,
) -> list[TeammateInfo]:
    """List all teammate agents and their current status.

    RFC-0002: 
    """
    return agent_state.team.get_teammate_info()


# --- list_tasks ---
async def list_tasks(
    status: str | None = None,
    agent_state: AgentTeamState = ...,
) -> list[TaskInfo]:
    """List tasks on the shared task board.

    RFC-0002: 

    Args:
        status:  (pending / in_progress / completed)
    """
    return await agent_state.task_board.list_tasks(status=status)


# --- create_task (leader-only) ---
async def create_task(
    title: str,
    description: str = "",
    priority: int = 0,
    dependencies: list[str] | None = None,
    agent_state: AgentTeamState = ...,
) -> CreateTaskResult | ToolError:
    """Create a new task on the shared task board.

    RFC-0002: （ leader ）
    """
    if not agent_state.is_leader:
        return ToolError(error="Only leader can create tasks", code="permission_denied")

    task = await agent_state.task_board.create_task(
        title=title,
        description=description,
        priority=priority,
        dependencies=dependencies or [],
        created_by=agent_state.agent_id,
    )
    return CreateTaskResult(
        task_id=task.task_id,
        title=task.title,
        description=task.description,
        priority=task.priority,
        status=task.status,
        deliverable_path=task.deliverable_path,
    )


# --- claim_task ---
async def claim_task(
    task_id: str,
    assignee_agent_id: str | None = None,
    agent_state: AgentTeamState = ...,
) -> ClaimTaskResult | ToolError:
    """Claim a task from the shared task board.

    RFC-0002: /

    - task_id （ claim-next）
    - assignee_agent_id  self-claim（leader  teammate ）
    - assignee_agent_id  leader assignment（ caller  leader）
    - ： agent  in_progress 

    Teammate : list_tasks() →  task_id → claim_task(task_id)
     claim 。
    """
    caller_id = agent_state.agent_id
    actual_assignee = assignee_agent_id or caller_id

    # leader assignment 
    if assignee_agent_id is not None and not agent_state.is_leader:
        return ToolError(error="Only leader can assign tasks to others", code="permission_denied")

    # ： assignee  in_progress 
    active_tasks = await agent_state.task_board.list_tasks(status="in_progress")
    existing = [t for t in active_tasks if t.assignee_agent_id == actual_assignee]
    if existing:
        current = existing[0]
        return ToolError(
            error=f"{actual_assignee} already has an active task: {current.task_id} ({current.title}). Finish or release it before claiming a new one.",
            code="busy",
        )

    try:
        await agent_state.task_board.claim_task(
            task_id=task_id, assignee_agent_id=actual_assignee,
        )

        # leader assignment  enqueue_message  teammate
        if assignee_agent_id is not None:
            agent_state.team.send_message_to_agent(
                actual_assignee,
                f"Task assigned: {task_id}. Use list_tasks to see details and work on it.",
                agent_state.agent_id,
            )

        task_info = await agent_state.task_board.get_task_info(task_id)
        return ClaimTaskResult(
            task_id=task_id,
            title=task_info.title,
            status="claimed",
            assignee_agent_id=actual_assignee,
            deliverable_path=task_info.deliverable_path,
        )
    except LockConflictError:
        return ToolError(error=f"Task {task_id} claim conflict, retry with another task", code="conflict")
    except TaskBlockedError:
        return ToolError(error=f"Task {task_id} is blocked by unfinished dependencies", code="blocked")


# --- update_task_status ---
async def update_task_status(
    task_id: str,
    status: str,
    result_summary: str | None = None,
    agent_state: AgentTeamState = ...,
) -> UpdateTaskStatusResult | ToolError:
    """Update task status (pending -> in_progress -> completed).

    RFC-0002: 
    """
    task_info = await agent_state.task_board.update_status(
        task_id=task_id,
        status=status,
        result_summary=result_summary,
    )
    return UpdateTaskStatusResult(task_id=task_id, title=task_info.title, status=status, result_summary=result_summary)


# --- release_task ---
async def release_task(
    task_id: str,
    agent_state: AgentTeamState = ...,
) -> ReleaseTaskResult | ToolError:
    """Release a claimed task (unassign).

    RFC-0002: 
    """
    task_info = await agent_state.task_board.release_task(task_id=task_id)
    return ReleaseTaskResult(task_id=task_id, title=task_info.title, status="released")


# --- finish_team (leader-only stop tool) ---
async def finish_team(
    summary: str,
    agent_state: AgentTeamState = ...,
) -> FinishTeamResult | ToolError:
    """Finish the team run and return a summary.

    RFC-0002: （leader-only stop tool）

    Leader 。
     executor  stop tool， leader  forever-run 。
    Leader  AgentTeam.run()  force_stop  teammate。
    """
    if not agent_state.is_leader:
        return ToolError(error="Only the team leader can finish the team", code="permission_denied")

    all_tasks = await agent_state.task_board.list_tasks()
    completed = [t for t in all_tasks if t.status == "completed"]
    return FinishTeamResult(
        summary=summary,
        completed_tasks=len(completed),
        total_tasks=len(all_tasks),
    )
```

##### 5.3 

Team Tools  `AgentTeam.initialize()`  agent：

```python
# Leader: （ spawn/remove teammate + finish_team stop tool）
leader_tools = [
    spawn_teammate_tool, remove_teammate_tool,
    message_tool, broadcast_tool, list_teammates_tool,
    list_tasks_tool, create_task_tool, claim_task_tool,
    update_task_status_tool, release_task_tool,
    finish_team_tool,  # stop tool —  leader executor 
]

# Teammate: （ spawn/remove/create_task/finish_team）
teammate_tools = [
    message_tool, broadcast_tool, list_teammates_tool,
    list_tasks_tool, claim_task_tool,
    update_task_status_tool, release_task_tool,
]
```

 `AgentConfig.tools` 。 agent  `AgentTeamState`（ `AgentState`），Team Tools  `agent_state: AgentTeamState` 。

#### 5. Multi-Agent SSE

##### 5.1 TeamStreamEnvelope

Team SSE  `/stream`  Event ，：

```python
class TeamStreamEnvelope(BaseModel):
    """Envelope for multi-agent SSE events."""

    team_id: str
    agent_id: str
    role_name: str | None = None
    run_id: str | None = None
    event: Event  #  Event payload (TextMessageContentEvent, etc.)
```

SSE ：

```
data: {"team_id":"team_abc","agent_id":"leader-001","role_name":"leader","run_id":"run_x1","event":{"type":"TEXT_MESSAGE_CONTENT","delta":"Let me "}}

data: {"team_id":"team_abc","agent_id":"coder-1","role_name":"coder","run_id":"run_x2","event":{"type":"TEXT_MESSAGE_CONTENT","delta":"def hello"}}

data: {"team_id":"team_abc","agent_id":"reviewer-1","role_name":"reviewer","run_id":"run_x3","event":{"type":"TEXT_MESSAGE_CONTENT","delta":"LGTM"}}
```

UI  `agent_id`  token 。

##### 5.2 TeamSSEMultiplexer

```python
class TeamSSEMultiplexer:
    """Multiplexes events from multiple agents into a single SSE stream."""

    def __init__(self, *, team_id: str) -> None:
        self._team_id = team_id
        self._queue: asyncio.Queue[TeamStreamEnvelope | None] = asyncio.Queue()

    def create_event_handler(
        self, agent_id: str, role_name: str
    ) -> Callable[[Event], None]:
        """Create an on_event callback for a specific agent.

        Each agent gets its own handler that wraps events in TeamStreamEnvelope.
        """
        def handler(event: Event) -> None:
            envelope = TeamStreamEnvelope(
                team_id=self._team_id,
                agent_id=agent_id,
                role_name=role_name,
                run_id=getattr(event, "run_id", None),
                event=event,
            )
            self._queue.put_nowait(envelope)
        return handler

    async def stream(self) -> AsyncGenerator[TeamStreamEnvelope, None]:
        """Yield envelopes as they arrive from any agent."""
        while True:
            envelope = await self._queue.get()
            if envelope is None:  # Sentinel: team run complete
                break
            yield envelope

    def close(self) -> None:
        """Signal end of stream."""
        self._queue.put_nowait(None)
```

##### 5.3 

 `AgentEventsMiddleware`  aggregator ， agent 。：

- ** agent/run  `AgentEventsMiddleware` **
-  middleware  aggregator 
-  middleware  `TeamSSEMultiplexer` 
-  agent ， envelope  `agent_id` 

```python
#  teammate  middleware
for agent_id, role_name in teammate_instances:
    handler = multiplexer.create_event_handler(agent_id, role_name)
    middleware = AgentEventsMiddleware(
        session_id=session_id,
        on_event=handler,  #  handler →  aggregator
    )
    #  agent  config
    agent_config_with_middleware = apply_middleware(agent_config, middleware)
```

#### 6. HTTP  Endpoints

 Team endpoints  `/team` ， `/stream`、`/query` 。

##### 6.1 Endpoint 

| Method | Path |  |  |  |
|--------|------|------|--------|------|
| `POST` | `/team/stream` |  leader + multiplex SSE | `TeamRunRequest` | SSE `TeamStreamEnvelope` |
| `POST` | `/team/query` |  leader（） | `TeamRunRequest` | `dict[str, str]` |
| `GET` | `/team/teammates` |  teammates | query: `user_id`, `session_id` | `list[dict]` |
| `GET` | `/team/tasks` |  | query: `user_id`, `session_id`, `?status=` | `list[dict]` |
| `POST` | `/team/tasks` |  | `CreateTaskRequest` | `dict` |
| `POST` | `/team/tasks/claim` |  | `ClaimTaskRequest` | `dict` |
| `PATCH` | `/team/tasks/{task_id}` |  | `UpdateTaskRequest` + query: `user_id`, `session_id` | `dict` |
| `POST` | `/team/message` |  | `SendMessageRequest` | `dict` |
| `POST` | `/team/user-message` |  agent （stream ） | `UserMessageRequest` | `dict` |
| `POST` | `/team/stop` |  Team | `StopTeamRequest` | `dict` |
| `GET` | `/team/status` |  Team  | query: `user_id`, `session_id` | `dict` |
| `GET` | `/team/subscribe` |  SSE（） | query: `user_id`, `session_id`, `after` | SSE `TeamStreamEnvelope` |

##### 6.2 /

```python
class TeamRunRequest(BaseModel):
    """Request to run the team."""
    user_id: str
    session_id: str
    message: str
    variables: ContextValue | None = None  # （、、）


class TeamStreamEnvelopeResponse(BaseModel):
    """SSE event wrapper."""
    type: str = "team_event"  # team_event | complete | error
    envelope: dict[str, object] | None = None  #  TeamStreamEnvelope
    session_id: str
    error: str | None = None  #  type="error" 


class CreateTaskRequest(BaseModel):
    user_id: str
    session_id: str
    title: str
    description: str = ""
    priority: int = 0
    dependencies: list[str] = []


class ClaimTaskRequest(BaseModel):
    user_id: str
    session_id: str
    task_id: str  # 
    assignee_agent_id: str | None = None  # None = self-claim by leader


class UpdateTaskRequest(BaseModel):
    status: str  # pending | in_progress | completed
    result_summary: str | None = None


class SendMessageRequest(BaseModel):
    user_id: str
    session_id: str
    from_agent_id: str
    to_agent_id: str | None = None  # None = broadcast
    content: str


class UserMessageRequest(BaseModel):
    """Request to enqueue a user message to an agent during streaming."""
    user_id: str
    session_id: str
    content: str
    to_agent_id: str = "leader"  #  leader


class StopTeamRequest(BaseModel):
    """Request to force-stop all agents in a team."""
    user_id: str
    session_id: str
```

##### 6.3 SSE Streaming 

```python
# POST /team/stream
@router.post("/team/stream")
async def team_stream(request: TeamRunRequest) -> StreamingResponse:
    team = registry.get_or_create(request.user_id, request.session_id)

    # （ on_complete ）
    team.set_on_complete(lambda: registry.remove(request.user_id, request.session_id))

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            async for envelope in team.run_streaming(request.message, variables=request.variables):
                response = TeamStreamEnvelopeResponse(
                    type="team_event",
                    envelope=envelope.model_dump(),
                    session_id=request.session_id,
                )
                yield f"data: {response.model_dump_json()}\n\n"
        except Exception as exc:
            error_response = TeamStreamEnvelopeResponse(
                type="error",
                session_id=request.session_id,
                error=str(exc),
            )
            yield f"data: {error_response.model_dump_json()}\n\n"
            return

        yield f"data: {TeamStreamEnvelopeResponse(type='complete', session_id=request.session_id).model_dump_json()}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )
```

### 

#### ：Leader  Teammates

```python
# 1.  team 
# POST /team/stream
# { "user_id": "u1", "session_id": "s1", "message": " TODO ",
#   "variables": {"template": {"date": "2026-03-04"}} }

# 2. Leader ， spawn teammates（ team  teammate）
spawn_teammate(role_name="coder")
# → SpawnResult(agent_id="coder-1", role_name="coder")
spawn_teammate(role_name="coder")
# → SpawnResult(agent_id="coder-2", role_name="coder")
spawn_teammate(role_name="reviewer")
# → SpawnResult(agent_id="reviewer-1", role_name="reviewer")

# 3. Leader 
create_task(title=" API", description="FastAPI CRUD endpoints", priority=1)
# → CreateTaskResult(task_id="T-001", title=" API", status="created", ...)

create_task(title="", description="React TODO list", dependencies=["T-001"])
# → CreateTaskResult(task_id="T-002", title="", status="created", ...)

# 4. Leader  spawn  teammate
claim_task(task_id="T-001", assignee_agent_id="coder-1")
# → ClaimTaskResult(task_id="T-001", title=" API", status="claimed", assignee_agent_id="coder-1", ...)

# 5. coder-1  T-001
# coder-1 :
update_task_status(task_id="T-001", status="completed", result_summary="API done")
# → UpdateTaskStatusResult(task_id="T-001", title=" API", status="completed")
# → Watchdog ， leader

# 6. T-002 ，coder-2 :
list_tasks(status="pending")
# → [TaskInfo(task_id="T-002", status="pending", is_blocked=False, ...)]
claim_task(task_id="T-002")
# → ClaimTaskResult(task_id="T-002", title="", status="claimed", assignee_agent_id="coder-2", ...)
```

#### Teammate 

```
Teammate                          TaskBoard
   │                                  │
   ├─ list_tasks() ──────────────────▶│
   │◀─ [TaskInfo(T-003, pending)] ───│
   │                                  │
   ├─ claim_task("T-003") ──────────▶│
   │   ├─ acquire lock ──────────────▶│ (TTL 5s)
   │   ├─ check dependencies ────────│
   │   ├─ check not assigned ────────│
   │   ├─ set assignee ─────────────▶│
   │   └─ release lock ─────────────▶│
   │◀─ ClaimTaskResult(claimed) ────────│
   │                                  │
   │  ()                        │
   │◀─ ToolError(conflict) ──────────│
   │                                  │
   ├─ list_tasks() ──────────────────▶│  ()
   └─ claim_task("T-004") ──────────▶│
```

## 

### 

####  A： GlobalStorage 

 `SessionModel.storage`（GlobalStorage）。

****：
- GlobalStorage （last-write-wins），
- ，claim 
- 

####  B：

（flock） claim 。

****：
- 
-  `InMemoryDatabaseEngine`（） `RemoteDatabaseEngine`（）
-  `AgentLockService`  DB-backed 

####  C： `/stream` endpoint  multi-agent SSE

 SSE  `agent_id` 。

****：
- 
-  Event  team 
-  endpoint + envelope ， agent 

### 

1. ** 5  DB **：`TeamModel`、`TeamMemberModel`、`TeamTaskModel`、`TeamTaskLockModel`、`TeamMessageModel`， schema ，
2. **`concurrent.futures.Future` vs `asyncio.Task`**： `run_coroutine_threadsafe`  `Future`  `Task`，API （`future.result(timeout=...)` vs `await task`）， tool executor  `asyncio.run()` 
3. ****：asyncio ，teammate  LLM API 
4. ** agent **：Watchdog ， agent 。 teammate ，leader （ teammate ）

## 

### 

- [x] Phase 1: 
  -  `TeamModel`、`TeamMemberModel`、`TeamTaskModel`、`TeamTaskLockModel`、`TeamMessageModel`
  -  `TaskLockService`（ AgentLockService ）
  -  `TaskBoard`（CRUD + claim/release + ）
  -  `TeamMessageBus`（send/broadcast/drain）
  - 

- [x] Phase 2: AgentTeam  + Forever-Run 
  -  `AgentTeam` 
  - Executor `team_mode` （`_message_available`, `force_stop()`）
  - Agent  `team_mode=self._team_state is not None`  Executor
  - ：`asyncio.run_coroutine_threadsafe`  `asyncio.create_task`
  - ：`enqueue_message` + `message`  middleware drain
  -  Teammate （`_run_teammate_forever`）
  -  `finish_team` stop tool（leader-only）
  - 

- [x] Phase 3: Team Tools
  -  11  Team Tools（ spawn/remove teammate + finish_team）
  - Tool YAML  + binding
  - Leader/Teammate 
  - 

- [x] Phase 4: Multi-Agent SSE
  -  `TeamStreamEnvelope` 
  -  `TeamSSEMultiplexer`
  -  agent/run  aggregator 
  - SSE 

- [x] Phase 5: HTTP Endpoints
  -  `/team/*` 
  - /
  - 

### 

- `nexau/archs/session/models/` -  TeamModel, TeamMemberModel, TeamTaskModel, TeamTaskLockModel, TeamMessageModel
- `nexau/archs/session/task_lock_service.py` -  TaskLockService
- `nexau/archs/main_sub/team/` -  AgentTeam, TaskBoard, TeamMessageBus
- `nexau/archs/main_sub/team/tools/` -  Team Tools（ finish_team stop tool）
- `nexau/archs/main_sub/team/sse/` -  TeamSSEMultiplexer, TeamStreamEnvelope
- `nexau/archs/main_sub/execution/executor.py` -  team_mode, _message_available, force_stop()
- `nexau/archs/main_sub/agent.py` -  team_mode  Executor
- `nexau/archs/transports/http/team_routes.py` -  /team/* 
- `nexau/archs/transports/http/team_registry.py` -  TeamRegistry 
- `nexau/archs/transports/http/sse_server.py` -  TeamRegistry
- `examples/agent_team/start_server.py` - SSE 
- `examples/agent_team/frontend/` - React  Agent 

## 

### 

- **TaskBoard**：create / list / claim / release / update_status /  /  claim 
- **TaskLockService**：acquire / release / TTL  / 
- **TeamMessageBus**：send / broadcast / drain /  / delivered 
- **Team Tools**： + （、、blocked）

### 

- ** Team **：Leader  →  → Teammate  →  → Idle 
- ** claim**： teammate  claim  task，
- ****：， claim 
- ****：、、
- **Multi-agent SSE**： SSE  agent 

### 

1.  Team SSE ， agent 
2.  `/team/tasks` API 
3.  teammate ，
4.  claim-next （ task_id  claim ）

## 

> ，。

### 

1. **Teammate **：。`AgentTeam.__init__`  `max_teammates: int = 10`，`spawn_teammate`  `ToolError(code="invalid_state")`。
2. ****：。`priority`  agent ， claim 。
3. **Team  session **：。Team  session-scoped， session 。
4. ** TTL / **：。`TeamMessageModel`  session ，。
5. **Teammate **： agent ，。`TeammateWatchdog`  asyncio.Task ， agent  idle  leader （ §3.5）。
6. **Team **： `TeamModel` + `TeamMemberModel` ， `SessionModel.context`。Team  session-scoped，，。

### 

（）

## 

- `nexau/archs/session/agent_lock_service.py` — AgentLockService （）
- `nexau/archs/session/models/agent_lock.py` — AgentLockModel（）
- `nexau/archs/main_sub/execution/middleware/agent_events_middleware.py` — （SSE ）
- `nexau/archs/transports/http/sse_server.py` — SSE Transport（endpoint ）
- `nexau/archs/main_sub/agent.py` — Agent （）
- RFC-0001: Agent （stop/interrupt ）