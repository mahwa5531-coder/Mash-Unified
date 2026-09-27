# Copyright (c) Nex-AGI. All rights reserved.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
# http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Tool implementation plus neutral structured-tool helpers.

RFC-0006:  Structured Tool Definitions

 structured tool calling, Tool/SubAgent 
structured definition,  adapter  OpenAI / Anthropic /
Gemini  provider schema. 
"""

from __future__ import annotations

import asyncio
import dataclasses
import inspect
import logging
import traceback
from collections.abc import Callable, Mapping
from copy import deepcopy
from pathlib import Path
from types import UnionType
from typing import TYPE_CHECKING, Annotated, Any, Literal, TypedDict, Union, cast, get_args, get_origin, get_type_hints

import jsonschema
import yaml
from jsonschema.validators import validator_for
from pydantic import BaseModel, ConfigDict, Field

from nexau.archs.permissions.types import AskPermission, PermissionDenied

from .formatters import ToolFormatter, ToolFormatterContext, resolve_tool_formatter

if TYPE_CHECKING:
    from anthropic.types import ToolParam
    from openai.types.chat.chat_completion_tool_param import ChatCompletionToolParam

logger = logging.getLogger(__name__)
_UNRESOLVED_ANNOTATION = object()
_INJECTED_PARAM_KEYS = frozenset({"agent_state", "global_storage", "sandbox", "ctx"})


StructuredToolKind = Literal["tool", "sub_agent"]


class StructuredToolDefinition(TypedDict):
    """Vendor-neutral structured tool definition used by the runtime."""

    name: str
    description: str
    input_schema: dict[str, Any]
    kind: StructuredToolKind


StructuredToolDefinitionLike = StructuredToolDefinition | Mapping[str, object]


def normalize_input_schema(input_schema: Mapping[str, object] | None) -> dict[str, Any]:
    """Normalize a tool schema to an object-shaped JSON Schema."""

    params: dict[str, Any] = deepcopy(dict(input_schema or {}))
    if not params:
        return {"type": "object", "properties": {}}
    if "type" not in params:
        return {"type": "object", "properties": params.get("properties", {})}
    return params


def build_structured_tool_definition(
    *,
    name: str,
    description: str | None,
    input_schema: Mapping[str, object] | None,
    kind: StructuredToolKind = "tool",
) -> StructuredToolDefinition:
    """Build a vendor-neutral structured tool definition.

    RFC-0006:  Structured Tool Definitions

     Tool  SubAgent  structured,  Agent /
    Executor  vendor-specific schema. 
    """

    return {
        "name": name,
        "description": description or "",
        "input_schema": normalize_input_schema(input_schema),
        "kind": kind,
    }


def normalize_structured_tool_definition(
    tool_definition: StructuredToolDefinitionLike,
) -> StructuredToolDefinition:
    """Normalize a neutral or provider-specific tool definition.

    RFC-0006:  Structured Tool Definitions

     definition,  OpenAI / Anthropic, 
    runtime  neutral structured definition. 
    """

    if tool_definition.get("type") == "function":
        function_raw = tool_definition.get("function", {})
        function_block: Mapping[str, object] = cast(Mapping[str, object], function_raw) if isinstance(function_raw, Mapping) else {}
        name = function_block.get("name")
        if not isinstance(name, str) or not name:
            raise ValueError("OpenAI tool definition missing function.name")
        description = function_block.get("description")
        parameters = function_block.get("parameters")
        parameters_mapping: Mapping[str, object] | None = (
            cast(Mapping[str, object], parameters) if isinstance(parameters, Mapping) else None
        )
        kind_raw = tool_definition.get("kind", "tool")
        openai_compatible_kind: StructuredToolKind = "sub_agent" if kind_raw == "sub_agent" else "tool"
        return build_structured_tool_definition(
            name=name,
            description=str(description) if description is not None else "",
            input_schema=parameters_mapping,
            kind=openai_compatible_kind,
        )

    if "name" in tool_definition and "input_schema" in tool_definition:
        name = tool_definition.get("name")
        if not isinstance(name, str) or not name:
            raise ValueError("Structured tool definition missing name")
        description = tool_definition.get("description")
        input_schema = tool_definition.get("input_schema")
        input_schema_mapping: Mapping[str, object] | None = (
            cast(Mapping[str, object], input_schema) if isinstance(input_schema, Mapping) else None
        )
        kind_raw = tool_definition.get("kind", "tool")
        neutral_kind: StructuredToolKind = "sub_agent" if kind_raw == "sub_agent" else "tool"
        return build_structured_tool_definition(
            name=name,
            description=str(description) if description is not None else "",
            input_schema=input_schema_mapping,
            kind=neutral_kind,
        )

    raise ValueError(f"Unsupported structured tool definition: {tool_definition}")


def normalize_schema_for_strict(schema: Mapping[str, Any]) -> dict[str, Any]:
    """Normalize a JSON schema to comply with OpenAI Structured Outputs (strict: true).

    ponytail: ensures additionalProperties: false, all properties in required, and optional fields nullable.
    """
    res = dict(schema)
    schema_type = res.get("type")

    if schema_type == "object" or "properties" in res:
        res["type"] = "object"
        res["additionalProperties"] = False
        props = res.get("properties")
        if isinstance(props, Mapping):
            old_req = set(res.get("required") or [])
            new_props: dict[str, Any] = {}
            for prop_name, prop_val in props.items():
                if isinstance(prop_val, Mapping):
                    sub_schema = normalize_schema_for_strict(prop_val)
                    if prop_name not in old_req:
                        if "type" in sub_schema:
                            t = sub_schema["type"]
                            if isinstance(t, str) and t != "null":
                                sub_schema["type"] = [t, "null"]
                            elif isinstance(t, list) and "null" not in t:
                                sub_schema["type"] = list(t) + ["null"]
                        elif "anyOf" in sub_schema:
                            if not any(item.get("type") == "null" for item in sub_schema["anyOf"] if isinstance(item, dict)):
                                sub_schema["anyOf"] = list(sub_schema["anyOf"]) + [{"type": "null"}]
                    new_props[prop_name] = sub_schema
                else:
                    new_props[prop_name] = prop_val
            res["properties"] = new_props
            res["required"] = list(props.keys())
    elif schema_type == "array" and "items" in res and isinstance(res["items"], Mapping):
        res["items"] = normalize_schema_for_strict(res["items"])

    return res


def structured_tool_definition_to_openai(
    tool_definition: StructuredToolDefinitionLike,
    *,
    strict: bool = False,
) -> ChatCompletionToolParam:
    """Convert a neutral or compatible tool definition into OpenAI schema."""

    normalized = normalize_structured_tool_definition(tool_definition)
    params = normalize_input_schema(normalized["input_schema"])
    func_def: dict[str, Any] = {
        "name": normalized["name"],
        "description": normalized["description"],
    }
    if strict:
        func_def["strict"] = True
        func_def["parameters"] = normalize_schema_for_strict(params)
    else:
        func_def["parameters"] = params

    return {
        "type": "function",
        "function": func_def,
    }


def structured_tool_definition_to_anthropic(
    tool_definition: StructuredToolDefinitionLike,
    *,
    tool_streaming: bool = True,
) -> ToolParam:
    """Convert a neutral or compatible tool definition into Anthropic schema.

    RFC-0006: Provider 

    Anthropic tool schema  provider,  Agent / Executor 
     neutral structured definition . 

    Parameters
    ----------
    tool_definition:
        The neutral structured tool definition to convert.
    tool_streaming:
        When *True* (default), include ``eager_input_streaming: True`` to
        enable fine-grained tool streaming and reduce first-token latency for
        large arguments.  Set to *False* to omit the field entirely - some
        non-Anthropic providers that share the schema shape reject unknown
        fields.
    """

    normalized = normalize_structured_tool_definition(tool_definition)
    result: ToolParam = {
        "name": normalized["name"],
        "description": normalized["description"],
        "input_schema": normalize_input_schema(normalized["input_schema"]),
    }
    if tool_streaming:
        # fine-grained tool streaming, token
        # SSE timeout.
        result["eager_input_streaming"] = True
    return result


class ToolYamlSchema(BaseModel):
    """Schema describing a tool YAML definition."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["tool"] | None = Field(default=None)
    name: str
    description: str
    input_schema: dict[str, Any] = Field(default_factory=dict)
    skill_description: str | None = None
    disable_parallel: bool = False
    lazy: bool = False
    defer_loading: bool = False
    search_hint: str | None = None
    template_override: str | None = None
    builtin: str | None = None
    binding: str | None = None
    formatter: str | None = None


class ConfigError(Exception):
    """Exception raised for configuration errors."""

    pass


class Tool:
    """Tool class that represents a callable function with schema validation."""

    def __init__(
        self,
        name: str,
        description: str,
        input_schema: dict[str, Any],
        implementation: Callable[..., Any] | str | None,
        skill_description: str | None = None,
        as_skill: bool = False,
        disable_parallel: bool = False,
        lazy: bool = False,
        defer_loading: bool = False,
        search_hint: str | None = None,
        template_override: str | None = None,
        formatter: str | ToolFormatter | None = None,
        extra_kwargs: dict[str, Any] | None = None,
        source_name: str | None = None,
        permissions: dict[str, list[str]] | None = None,
        source_id: str | None = None,
    ):
        """Initialize a tool with schema and implementation."""
        self.name = name
        self.source_name = source_name
        self.source_id = source_id
        self.description = description
        self.skill_description = skill_description
        self.as_skill = as_skill
        self.input_schema = input_schema
        self.lazy = lazy
        self.implementation = None
        self.implementation_import_path = None
        if isinstance(implementation, str):
            self.implementation_import_path = implementation
            if lazy:
                self.implementation = None  # lazy import and bind at runtime
            else:
                from ..main_sub.utils import import_from_string

                func = import_from_string(implementation)
                self.implementation = func
        else:
            self.implementation = implementation
        self.defer_loading = defer_loading
        self.search_hint = search_hint
        self.template_override = template_override
        self.formatter = formatter
        self._resolved_formatter: ToolFormatter | None = None
        # Auto-serialize mutating/state-modifying tools to prevent file corruption
        # while keeping read-only/search tools parallelizable
        mutating_tools = {
            "write_file",
            "write_to_file",
            "replace",
            "replace_file_content",
            "apply_patch",
            "multiedit_tool",
            "run_shell_command",
            "run_code_tool",
            "kill_background_task",
        }
        if name in mutating_tools:
            disable_parallel = True
        self.disable_parallel = disable_parallel
        reserved_keys = {"agent_state", "global_storage", "ctx"}
        extra_kwargs = extra_kwargs or {}
        conflict_keys = set(extra_kwargs) & reserved_keys
        if conflict_keys:
            raise ConfigError(
                f"Tool '{self.name}' extra_kwargs contains reserved keys that cannot be overridden: {sorted(conflict_keys)}",
            )
        self.extra_kwargs = extra_kwargs

        # RFC-0019: configuration
        self.permissions = permissions

        # class ( MCPTool) property True, execute_async
        # async, executor await
        # to_thread → sync execute → asyncio.run .
        self._has_native_async_execute: bool = False

        # Validate schema
        self._validate_schema()
        self._validate_reserved_param_annotations()

    @classmethod
    def from_yaml(
        cls,
        yaml_path: str,
        binding: Callable[..., Any] | str | None = None,
        *,
        as_skill: bool = False,
        extra_kwargs: dict[str, Any] | None = None,
        lazy: bool | None = None,
        name: str | None = None,
        description: str | None = None,
        description_suffix: str = "",
        defer_loading: bool | None = None,
        permissions: dict[str, list[str]] | None = None,
        source_id: str | None = None,
    ) -> Tool:
        """Load tool definition from YAML file and bind to implementation."""
        path = Path(yaml_path)
        if not path.exists():
            raise FileNotFoundError(f"Tool YAML file not found: {yaml_path}")

        with open(path, encoding="utf-8") as f:
            tool_def_model = ToolYamlSchema.model_validate(yaml.safe_load(f))
        tool_def = tool_def_model.model_dump()

        # Extract required fields
        source_name = tool_def["name"]
        base_description = tool_def["description"]
        skill_description = tool_def.get("skill_description", "")
        input_schema = tool_def.get("input_schema", {})
        disable_parallel = tool_def.get("disable_parallel", False)
        yaml_defer_loading = tool_def.get("defer_loading", False)
        search_hint_val = tool_def.get("search_hint")
        yaml_lazy = tool_def.get("lazy", False)
        effective_name = source_name if name is None else name
        effective_source_name = source_name if effective_name != source_name else None
        effective_description = base_description if description is None else description
        if description_suffix:
            effective_description += description_suffix
        effective_defer_loading = yaml_defer_loading if defer_loading is None else defer_loading
        effective_lazy = yaml_lazy if lazy is None else lazy

        if binding is None and "binding" in tool_def:
            binding = tool_def.get("binding")

        if "global_storage" in input_schema:
            raise ValueError(
                f"Tool definition of `{source_name}` contains 'global_storage' field in {yaml_path}, "
                "which will be injected by the framework, please remove it from the tool definition.",
            )

        if "agent_state" in input_schema:
            raise ValueError(
                f"Tool definition of `{source_name}` contains 'agent_state' field in {yaml_path}, "
                "which will be injected by the framework, please remove it from the tool definition."
            )

        if "ctx" in input_schema:
            raise ValueError(
                f"Tool definition of `{source_name}` contains 'ctx' field in {yaml_path}, "
                "which will be injected by the framework, please remove it from the tool definition.",
            )

        template_override = tool_def.get("template_override")
        formatter = tool_def.get("formatter")

        # Create tool instance
        return cls(
            name=effective_name,
            source_name=effective_source_name,
            description=effective_description,
            skill_description=skill_description,
            input_schema=input_schema,
            implementation=binding,
            as_skill=as_skill,
            disable_parallel=disable_parallel,
            lazy=effective_lazy,
            defer_loading=effective_defer_loading,
            search_hint=search_hint_val,
            template_override=template_override,
            formatter=formatter,
            extra_kwargs=extra_kwargs,
            permissions=permissions,
            source_id=source_id,
        )

    def resolve_formatter(self) -> ToolFormatter:
        """Resolve and cache the formatter configured for this tool.

        RFC-0017: formatter resolver

        configuration builtin `markdown` formatter. 
        """

        if self._resolved_formatter is None:
            self._resolved_formatter = resolve_tool_formatter(self.formatter)
        return self._resolved_formatter

    def format_output_for_llm(
        self,
        *,
        tool_input: dict[str, Any],
        tool_output: object,
        tool_call_id: str | None,
        is_error: bool,
    ) -> object:
        """Format raw tool output into the LLM-facing representation.

        RFC-0017: tool output flattening

         formatter,  after_tool middleware, 
         llm-facing output. 
        """

        formatter_context = ToolFormatterContext(
            tool_name=self.name,
            tool_input=cast(dict[str, object], dict(tool_input)),
            tool_output=tool_output,
            tool_call_id=tool_call_id,
            is_error=is_error,
        )

        formatter = self.resolve_formatter()
        try:
            return formatter(formatter_context)
        except Exception:
            logger.exception("Tool '%s' formatter failed; falling back to builtin Markdown formatter", self.name)
            fallback_formatter = resolve_tool_formatter("markdown")
            try:
                return fallback_formatter(formatter_context)
            except Exception:
                logger.exception("Tool '%s' builtin Markdown formatter failed; falling back to raw tool output", self.name)
                return tool_output

    def _validate_reserved_param_annotations(self) -> None:
        """Validate reserved framework parameter annotations for tool implementations."""
        impl = self.implementation
        if impl is None:
            return

        signature = inspect.signature(impl)
        ctx_param = signature.parameters.get("ctx")
        if ctx_param is None:
            return

        if ctx_param.annotation is inspect.Signature.empty:
            logger.warning(
                "Tool '%s' declares 'ctx' without a FrameworkContext annotation; annotate it as FrameworkContext.",
                self.name,
            )
            return

        annotation = self._resolve_reserved_param_annotation(impl, "ctx")
        if annotation is _UNRESOLVED_ANNOTATION:
            return

        if annotation is Any:
            logger.warning(
                "Tool '%s' declares 'ctx' as Any; annotate it as FrameworkContext for stricter validation.",
                self.name,
            )
            return

        if not self._is_framework_context_annotation(annotation):
            raise ConfigError(
                f"Tool '{self.name}' declares 'ctx' with incompatible type {annotation!r}; use FrameworkContext.",
            )

    def _resolve_reserved_param_annotation(self, impl: Callable[..., Any], param_name: str) -> Any:
        """Resolve a reserved parameter annotation, including forward references."""
        from nexau.archs.main_sub.framework_context import FrameworkContext

        globalns = dict(getattr(impl, "__globals__", {}))
        globalns.setdefault("FrameworkContext", FrameworkContext)
        try:
            hints = get_type_hints(impl, globalns=globalns, localns={"FrameworkContext": FrameworkContext}, include_extras=True)
        except Exception as exc:
            logger.warning(
                "Tool '%s' declares '%s' but its annotation could not be resolved (%s); skipping strict type validation.",
                self.name,
                param_name,
                exc,
            )
            return _UNRESOLVED_ANNOTATION

        return hints.get(param_name, _UNRESOLVED_ANNOTATION)

    @staticmethod
    def _is_framework_context_annotation(annotation: Any) -> bool:
        """Return whether an annotation represents FrameworkContext."""
        from nexau.archs.main_sub.framework_context import FrameworkContext

        if annotation is FrameworkContext:
            return True

        origin = get_origin(annotation)
        if origin is None:
            return False

        if origin is Annotated:
            args = get_args(annotation)
            return bool(args) and Tool._is_framework_context_annotation(args[0])

        if origin in (UnionType, Union):
            union_args = [arg for arg in get_args(annotation) if arg is not type(None)]
            return len(union_args) == 1 and Tool._is_framework_context_annotation(union_args[0])

        return False

    @property
    def has_native_async_execute(self) -> bool:
        """Whether this tool has a native async execute_async() override.

        class ( MCPTool)  execute_async()  async, 
         __init__  ``_has_native_async_execute = True``. 
        executor  await execute_async() 
        to_thread → sync execute . 
        """
        return self._has_native_async_execute

    def execute(self, **params: Any) -> dict[str, Any]:
        """Execute the tool with given parameters."""

        if self.implementation is None:
            if self.implementation_import_path:
                logger.info(f"Dynamic importing tool implementation '{self.name}': {self.implementation_import_path}")

                from ..main_sub.utils import import_from_string

                func = import_from_string(str(self.implementation_import_path))
                self.implementation = func
                self._validate_reserved_param_annotations()
            else:
                raise ValueError(f"Tool '{self.name}' has no implementation")

        # RFC-0006: - ctx, agent_state backward compatibility
        merged_params = {**self.extra_kwargs, **params}
        filtered_params = merged_params.copy()

        impl = self.implementation
        if impl is not None:
            sig = inspect.signature(impl)

            # RFC-0006: ctx (FrameworkContext)
            if "ctx" not in sig.parameters:
                filtered_params.pop("ctx", None)

            # backward compatibility: agent_state
            if "agent_state" in merged_params:
                if "agent_state" not in sig.parameters:
                    filtered_params.pop("agent_state", None)

                    # For backwards compatibility, check if function accepts global_storage
                    if "global_storage" in sig.parameters:
                        agent_state = merged_params["agent_state"]
                        filtered_params["global_storage"] = agent_state.global_storage
                if "sandbox" not in sig.parameters:
                    filtered_params.pop("sandbox", None)

        # Validate parameters (excluding framework-injected params for schema validation)
        filtered_params = self._normalize_common_aliases(filtered_params)
        validation_params = {k: v for k, v in filtered_params.items() if k not in _INJECTED_PARAM_KEYS}
        self.validate_params(validation_params)

        try:
            if impl is None:
                raise ValueError(f"Tool '{self.name}' has no implementation")

            raw_result: Any = impl(**filtered_params)

            # Support async tool implementations.
            # impl coroutine,:
            # - running loop (ThreadPoolExecutor worker / CLI / ) → asyncio.run
            # - running loop (async context execute) →, execute_async
            if inspect.iscoroutine(raw_result):
                try:
                    asyncio.get_running_loop()
                except RuntimeError:
                    # running loop - sync (ThreadPoolExecutor worker / CLI)
                    # : async tool event loop
                    # loop async ( task group, shared lock ) .
                    # loop, executor async execute_async.
                    logger.warning(
                        "Tool '%s' is async but invoked via sync execute() — running in an "
                        "isolated event loop. Use execute_async() to run on the main loop.",
                        self.name,
                    )
                    raw_result = asyncio.run(raw_result)
                else:
                    # await coroutine RuntimeWarning
                    raw_result.close()
                    raise RuntimeError(
                        f"Tool '{self.name}' returned a coroutine but execute() was called "
                        "from an async context. Use `await tool.execute_async(...)` instead."
                    )

            # Ensure result is a dictionary
            final_result: dict[str, Any]
            if isinstance(raw_result, dict):
                final_result = cast(dict[str, Any], raw_result)
            elif dataclasses.is_dataclass(raw_result) and not isinstance(raw_result, type):
                final_result = dataclasses.asdict(raw_result)
            elif isinstance(raw_result, list):
                result_list = cast(list[object], raw_result)
                final_result = {
                    "result": [
                        dataclasses.asdict(item) if (dataclasses.is_dataclass(item) and not isinstance(item, type)) else item
                        for item in result_list
                    ]
                }
            else:
                final_result = {"result": raw_result}

            return final_result

        except (AskPermission, PermissionDenied):
            # RFC-0019: exception, Executor
            raise
        except Exception as e:
            # Return error information
            return {
                "error": str(e),
                "error_type": type(e).__name__,
                "traceback": traceback.format_exc(),
                "tool_name": self.name,
            }

    async def execute_async(self, **params: Any) -> dict[str, Any]:
        """Execute the tool asynchronously.

        P1 async/sync :  asyncio.run() 

         async tool  await ( asyncio.run()  event loop), 
         sync tool  asyncio.to_thread()  ( event loop) . 
         execute() method,  sync  ( ThreadPoolExecutor workers) . 
        """
        if self.implementation is None:
            if self.implementation_import_path:
                logger.info(f"Dynamic importing tool implementation '{self.name}': {self.implementation_import_path}")

                from ..main_sub.utils import import_from_string

                func = import_from_string(str(self.implementation_import_path))
                self.implementation = func
                self._validate_reserved_param_annotations()
            else:
                raise ValueError(f"Tool '{self.name}' has no implementation")

        # RFC-0006: - ctx, agent_state backward compatibility
        merged_params = {**self.extra_kwargs, **params}
        filtered_params = merged_params.copy()

        impl = self.implementation
        if impl is not None:
            sig = inspect.signature(impl)

            # RFC-0006: ctx (FrameworkContext)
            if "ctx" not in sig.parameters:
                filtered_params.pop("ctx", None)

            # backward compatibility: agent_state
            if "agent_state" in merged_params:
                if "agent_state" not in sig.parameters:
                    filtered_params.pop("agent_state", None)

                    # For backwards compatibility, check if function accepts global_storage
                    if "global_storage" in sig.parameters:
                        agent_state = merged_params["agent_state"]
                        filtered_params["global_storage"] = agent_state.global_storage
                if "sandbox" not in sig.parameters:
                    filtered_params.pop("sandbox", None)

        # Validate parameters (excluding framework-injected params for schema validation)
        filtered_params = self._normalize_common_aliases(filtered_params)
        validation_params = {k: v for k, v in filtered_params.items() if k not in _INJECTED_PARAM_KEYS}
        self.validate_params(validation_params)

        try:
            if impl is None:
                raise ValueError(f"Tool '{self.name}' has no implementation")

            # type: async await, sync to_thread
            if inspect.iscoroutinefunction(impl):
                raw_result: Any = await impl(**filtered_params)
            else:
                # asyncio.to_thread (Python 3.12+) contextvars
                # worker, TraceContext contextvar .
                # copy_context.
                raw_result = await asyncio.to_thread(impl, **filtered_params)

            # Ensure result is a dictionary
            final_result: dict[str, Any]
            if isinstance(raw_result, dict):
                final_result = cast(dict[str, Any], raw_result)
            elif dataclasses.is_dataclass(raw_result) and not isinstance(raw_result, type):
                final_result = dataclasses.asdict(raw_result)
            elif isinstance(raw_result, list):
                result_list = cast(list[object], raw_result)
                final_result = {
                    "result": [
                        dataclasses.asdict(item) if (dataclasses.is_dataclass(item) and not isinstance(item, type)) else item
                        for item in result_list
                    ]
                }
            else:
                final_result = {"result": raw_result}

            return final_result

        except (AskPermission, PermissionDenied):
            # RFC-0019: exception, Executor
            raise
        except Exception as e:
            # Return error information
            return {
                "error": str(e),
                "error_type": type(e).__name__,
                "traceback": traceback.format_exc(),
                "tool_name": self.name,
            }

    def _normalize_common_aliases(self, params: dict[str, Any]) -> dict[str, Any]:
        """Normalize common parameter aliases so models don't fail schema validation on synonymous names."""
        props = (self.input_schema or {}).get("properties", {})

        # CommandLine / command / cmd aliases
        cmd_val = params.get("CommandLine") or params.get("command") or params.get("cmd")
        if cmd_val is not None:
            if "CommandLine" in props:
                params["CommandLine"] = cmd_val
            if "command" in props:
                params["command"] = cmd_val

        # File path aliases: AbsolutePath / file_path / TargetFile / target_file / path
        path_val = params.get("AbsolutePath") or params.get("file_path") or params.get("TargetFile") or params.get("target_file") or params.get("path")
        if path_val is not None:
            if "AbsolutePath" in props:
                params["AbsolutePath"] = path_val
            if "file_path" in props:
                params["file_path"] = path_val
            if "TargetFile" in props:
                params["TargetFile"] = path_val
            if "target_file" in props:
                params["target_file"] = path_val

        # Content / CodeContent aliases
        content_val = params.get("content") or params.get("CodeContent") or params.get("code_content")
        if content_val is not None:
            if "content" in props:
                params["content"] = content_val
            if "CodeContent" in props:
                params["CodeContent"] = content_val

        # Cwd / dir_path aliases
        cwd_val = params.get("Cwd") or params.get("dir_path") or params.get("cwd")
        if cwd_val is not None:
            if "Cwd" in props:
                params["Cwd"] = cwd_val
            if "dir_path" in props:
                params["dir_path"] = cwd_val

        # Action aliases: action / Action
        action_val = params.get("action") or params.get("Action")
        if action_val is not None:
            if "action" in props:
                params["action"] = str(action_val).lower()
            if "Action" in props:
                params["Action"] = action_val

        # pid / TaskId / task_id aliases
        pid_val = params.get("pid") if params.get("pid") is not None else (
            params.get("TaskId") or params.get("task_id")
        )
        if pid_val is not None:
            if "pid" in props:
                try:
                    params["pid"] = int(pid_val)
                except (ValueError, TypeError):
                    params["pid"] = pid_val
            if "TaskId" in props:
                params["TaskId"] = str(pid_val)
            if "task_id" in props:
                params["task_id"] = str(pid_val)

        if self.name == "run_shell_command":
            if "Cwd" not in params:
                params["Cwd"] = "."
            if "toolAction" not in params:
                params["toolAction"] = "Running shell command"
            if "toolSummary" not in params:
                params["toolSummary"] = "Execute shell command"
            if "WaitMsBeforeAsync" not in params:
                params["WaitMsBeforeAsync"] = 5000

        if self.name in ("view_file", "write_file", "replace_file_content"):
            if "toolAction" not in params and "toolAction" in props:
                params["toolAction"] = "File operation"
            if "toolSummary" not in params and "toolSummary" in props:
                params["toolSummary"] = "File operation"
            if "description" not in params and "description" in props:
                params["description"] = "File operation"
            if "Description" not in params and "Description" in props:
                params["Description"] = "File operation"

        # Strip tracking metadata if not declared in the tool's schema properties
        for meta_key in ("toolAction", "toolSummary", "description", "Description", "tool_call_id"):
            if meta_key in params and meta_key not in props:
                params.pop(meta_key, None)

        return params

    def validate_params(self, params: dict[str, Any]) -> None:
        """Validate parameters against schema.

        Raises:
            ValueError: If parameters fail schema validation, with detailed error message.
        """
        self._normalize_common_aliases(params)
        # ponytail: strip LLM-hallucinated keys not in schema so weaker models don't break tool calls
        allowed = self.input_schema.get("properties", {})
        for k in list(params):
            if k not in allowed:
                params.pop(k)
        try:
            jsonschema.validate(params, self.input_schema)
        except jsonschema.ValidationError as e:
            # ponytail: truncate huge parameter values (e.g. 25KB file code) to prevent prompt pollution
            safe_params = {
                k: (f"{str(v)[:100]}... [truncated {len(str(v))} chars]" if len(str(v)) > 200 else v)
                for k, v in params.items()
            }
            raise ValueError(
                f"Invalid parameters for tool '{self.name}': {e.message}. params={safe_params}",
            ) from e

    def _validate_schema(self):
        """Validate that the input schema is valid JSON Schema."""
        try:
            # Check if it's a valid JSON Schema
            validator_for(self.input_schema).check_schema(self.input_schema)
        except jsonschema.SchemaError as e:
            raise ValueError(
                f"Invalid JSON Schema for tool '{self.name}': {e}",
            )

    def get_schema(self) -> dict[str, Any]:
        """Get the tool's input schema."""
        return self.input_schema.copy()

    def get_info(self) -> dict[str, Any]:
        """Get tool information."""
        return {
            "name": self.name,
            "template_override": self.template_override,
            "description": self.description,
            "skill_description": self.skill_description,
            "input_schema": self.input_schema,
            "formatter": self.formatter if isinstance(self.formatter, str) else None,
        }

    def __repr__(self) -> str:
        impl = self.implementation
        impl_name = getattr(impl, "__name__", repr(impl)) if impl is not None else "None"
        formatter_name = self.formatter if isinstance(self.formatter, str) else getattr(self.formatter, "__name__", "markdown")
        return f"Tool(name='{self.name}', implementation={impl_name}, formatter={formatter_name})"

    def __str__(self) -> str:
        tool_str = f"Tool '{self.name}': {self.description[:50]}{'...' if len(self.description) > 50 else ''}"
        if self.skill_description:
            tool_str += f"\nSkill description: {self.skill_description}"
        return tool_str

    def get_structured_description(self) -> str:
        """Return the description exposed to structured tool-calling models."""

        if self.as_skill:
            if not self.skill_description:
                raise ValueError(
                    f"Tool {self.name} is marked as a skill but has no skill_description",
                )
            return self.skill_description
        return self.description or ""

    def to_structured_definition(
        self,
        *,
        description: str | None = None,
        kind: StructuredToolKind = "tool",
    ) -> StructuredToolDefinition:
        """Return the vendor-neutral structured tool definition.

        RFC-0006:  Structured Tool Definitions

        structured, Tool  neutral definition; provider-specific
        schema  LLM adapter  ``api_type`` . 
        """

        return build_structured_tool_definition(
            name=self.name,
            description=self.description if description is None else description,
            input_schema=self.get_schema(),
            kind=kind,
        )

    def to_openai(self) -> ChatCompletionToolParam:
        """Return the OpenAI-compatible function tool schema.

        RFC-0006: Provider package

        method,  neutral structured definition →
        OpenAI adapter,  OpenAI schema  runtime . 
        """

        return structured_tool_definition_to_openai(self.to_structured_definition())

    def to_anthropic(self, *, tool_streaming: bool = True) -> ToolParam:
        """Return the Anthropic-compatible tool schema.

        RFC-0006: Provider package

        method,  neutral structured definition →
        Anthropic adapter,  Tool  Anthropic . 

        Parameters
        ----------
        tool_streaming:
            Forward to :func:`structured_tool_definition_to_anthropic`.  When
            *False*, the ``eager_input_streaming`` field is omitted from the
            returned schema.
        """

        return structured_tool_definition_to_anthropic(
            self.to_structured_definition(),
            tool_streaming=tool_streaming,
        )