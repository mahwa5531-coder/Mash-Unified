"""Filter Converter 

 Filter DSL  SQLAlchemy ColumnElement, Python  HTTP string. 
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any
from urllib.parse import quote, unquote

from pydantic import BaseModel
from sqlalchemy import ColumnElement, and_, not_, or_
from sqlmodel import SQLModel

from .dsl import (
    AndFilter,
    ComparisonFilter,
    Filter,
    FilterOperator,
    NotFilter,
    OrFilter,
)

if TYPE_CHECKING:
    pass


def to_sqlalchemy(
    filter_: Filter,
    model_class: type[SQLModel],
) -> ColumnElement[bool]:
    """ Filter DSL  SQLAlchemy ColumnElement.

    Args:
        filter_: Filter DSL 
        model_class: SQLModel class, 

    Returns:
        SQLAlchemy ColumnElement[bool] 

    Raises:
        ValueError:  model_class 

    Examples:
        >>> from sqlmodel import SQLModel, Field
        >>> class User(SQLModel, table=True):
        ...     id: int = Field(primary_key=True)
        ...     name: str
        ...     age: int
        >>> filter_ = ComparisonFilter.eq("name", "alice")
        >>> expr = to_sqlalchemy(filter_, User)
        >>> # expr is equivalent to User.name == "alice"
    """
    if isinstance(filter_, ComparisonFilter):
        return _convert_comparison_filter(filter_, model_class)
    if isinstance(filter_, AndFilter):
        return _convert_and_filter(filter_, model_class)
    if isinstance(filter_, OrFilter):
        return _convert_or_filter(filter_, model_class)
    # At this point, filter_ must be NotFilter based on the Filter union type
    return _convert_not_filter(filter_, model_class)


def _get_column(
    model_class: type[SQLModel],
    field_name: str,
) -> ColumnElement[object]:
    """ model_class object.

    Args:
        model_class: SQLModel class
        field_name: 

    Returns:
        SQLAlchemy Column object

    Raises:
        ValueError:  model_class 
    """
    if not hasattr(model_class, field_name):
        raise ValueError(f"Field '{field_name}' not found in model {model_class.__name__}")

    column: ColumnElement[object] = getattr(model_class, field_name)
    return column


def _convert_comparison_filter(
    filter_: ComparisonFilter,
    model_class: type[SQLModel],
) -> ColumnElement[bool]:
    """ ComparisonFilter  SQLAlchemy .

    Args:
        filter_: ComparisonFilter 
        model_class: SQLModel class

    Returns:
        SQLAlchemy ColumnElement[bool] 
    """
    column = _get_column(model_class, filter_.field)
    op = filter_.op
    value = filter_.value

    if op == FilterOperator.EQ:
        return column == value
    elif op == FilterOperator.NEQ:
        return column != value
    elif op == FilterOperator.GT:
        return column > value
    elif op == FilterOperator.GTE:
        return column >= value
    elif op == FilterOperator.LT:
        return column < value
    elif op == FilterOperator.LTE:
        return column <= value
    elif op == FilterOperator.LIKE:
        return column.like(value)
    elif op == FilterOperator.ILIKE:
        return column.ilike(value)
    elif op == FilterOperator.IN:
        if not isinstance(value, list):
            raise ValueError(f"Invalid value type for operator {op}: expected list, got {type(value).__name__}")
        return column.in_(value)
    elif op == FilterOperator.IS:
        # IS operator is used for NULL checks
        # value should be None for IS NULL
        return column.is_(value)
    else:
        raise ValueError(f"Unsupported operator: {op}")


def _convert_and_filter(
    filter_: AndFilter,
    model_class: type[SQLModel],
) -> ColumnElement[bool]:
    """ AndFilter  SQLAlchemy AND .

    Args:
        filter_: AndFilter 
        model_class: SQLModel class

    Returns:
        SQLAlchemy ColumnElement[bool] 
    """
    if not filter_.filters:
        # Empty AND filter should return True (identity element for AND)
        # Using SQLAlchemy's literal_column for a true expression
        from sqlalchemy import literal

        return literal(True)

    sub_expressions = [to_sqlalchemy(sub_filter, model_class) for sub_filter in filter_.filters]
    return and_(*sub_expressions)


def _convert_or_filter(
    filter_: OrFilter,
    model_class: type[SQLModel],
) -> ColumnElement[bool]:
    """ OrFilter  SQLAlchemy OR .

    Args:
        filter_: OrFilter 
        model_class: SQLModel class

    Returns:
        SQLAlchemy ColumnElement[bool] 
    """
    if not filter_.filters:
        # Empty OR filter should return False (identity element for OR)
        from sqlalchemy import literal

        return literal(False)

    sub_expressions = [to_sqlalchemy(sub_filter, model_class) for sub_filter in filter_.filters]
    return or_(*sub_expressions)


def _convert_not_filter(
    filter_: NotFilter,
    model_class: type[SQLModel],
) -> ColumnElement[bool]:
    """ NotFilter  SQLAlchemy NOT .

    Args:
        filter_: NotFilter 
        model_class: SQLModel class

    Returns:
        SQLAlchemy ColumnElement[bool] 
    """
    sub_expression = to_sqlalchemy(filter_.filter, model_class)
    return not_(sub_expression)


# ============================================================================
# Python (Requirement 3.x)
# ============================================================================


def evaluate(
    filter_: Filter,
    record: Mapping[str, Any] | BaseModel,
) -> bool:
    """ Python  Filter DSL.

    Args:
        filter_: Filter DSL 
        record: dictionary Pydantic/SQLModel 

    Returns:
        value, 

    Examples:
        >>> filter_ = ComparisonFilter.eq("name", "alice")
        >>> evaluate(filter_, {"name": "alice", "age": 25})
        True
        >>> evaluate(filter_, {"name": "bob", "age": 30})
        False

        >>> #  Pydantic model
        >>> class User(BaseModel):
        ...     name: str
        ...     age: int
        >>> evaluate(filter_, User(name="alice", age=25))
        True
    """
    # Pydantic model, dictionary
    record_dict: Mapping[str, Any]
    if isinstance(record, BaseModel):
        record_dict = record.model_dump()
    else:
        record_dict = record

    if isinstance(filter_, ComparisonFilter):
        return _evaluate_comparison_filter(filter_, record_dict)
    if isinstance(filter_, AndFilter):
        return _evaluate_and_filter(filter_, record_dict)
    if isinstance(filter_, OrFilter):
        return _evaluate_or_filter(filter_, record_dict)
    # At this point, filter_ must be NotFilter based on the Filter union type
    return _evaluate_not_filter(filter_, record_dict)


def _get_field_value(
    record: Mapping[str, Any],
    field_name: str,
) -> Any:
    """value.

,  None ( 3.12) . 

    Args:
        record: dictionary
        field_name: 

    Returns:
        value,  None
    """
    return record.get(field_name, None)


def _safe_compare(a: object, b: object, op: str) -> bool:
    """value.

    Args:
        a: 
        b: 
        op:  ('gt', 'gte', 'lt', 'lte')

    Returns:
, type False
    """
    try:
        if op == "gt":
            return a > b  # type: ignore[operator]
        elif op == "gte":
            return a >= b  # type: ignore[operator]
        elif op == "lt":
            return a < b  # type: ignore[operator]
        elif op == "lte":
            return a <= b  # type: ignore[operator]
        return False
    except TypeError:
        return False


def _convert_like_pattern_to_regex(pattern: str) -> str:
    """ SQL LIKE .

    SQL LIKE :
    - %  (package) 
    - _ 

    Args:
        pattern: SQL LIKE string

    Returns:
        string
    """
    result = ""
    i = 0
    while i < len(pattern):
        char = pattern[i]
        if char == "%":
            result += ".*"
        elif char == "_":
            result += "."
        elif char in r"\^$.|?*+()[]{}":
            result += "\\" + char
        else:
            result += char
        i += 1

    return "^" + result + "$"


def _evaluate_comparison_filter(
    filter_: ComparisonFilter,
    record: Mapping[str, Any],
) -> bool:
    """ ComparisonFilter.

    Args:
        filter_: ComparisonFilter 
        record: dictionary

    Returns:
        value, 
    """
    field_value = _get_field_value(record, filter_.field)
    op = filter_.op
    filter_value = filter_.value

    if op == FilterOperator.EQ:
        # 3.2: eq record[field] == value
        return field_value == filter_value

    elif op == FilterOperator.NEQ:
        # 3.3: neq record[field] != value
        return field_value != filter_value

    elif op == FilterOperator.GT:
        # 3.4: gt record[field] > value
        if field_value is None or filter_value is None:
            return False
        return _safe_compare(field_value, filter_value, "gt")

    elif op == FilterOperator.GTE:
        # 3.4: gte record[field] >= value
        if field_value is None or filter_value is None:
            return False
        return _safe_compare(field_value, filter_value, "gte")

    elif op == FilterOperator.LT:
        # 3.4: lt record[field] < value
        if field_value is None or filter_value is None:
            return False
        return _safe_compare(field_value, filter_value, "lt")

    elif op == FilterOperator.LTE:
        # 3.4: lte record[field] <= value
        if field_value is None or filter_value is None:
            return False
        return _safe_compare(field_value, filter_value, "lte")

    elif op == FilterOperator.LIKE:
        # 3.5: like (% )
        if field_value is None or filter_value is None:
            return False
        if not isinstance(field_value, str) or not isinstance(filter_value, str):
            return False
        regex_pattern = _convert_like_pattern_to_regex(filter_value)
        return bool(re.match(regex_pattern, field_value))

    elif op == FilterOperator.ILIKE:
        # 3.6: ilike
        if field_value is None or filter_value is None:
            return False
        if not isinstance(field_value, str) or not isinstance(filter_value, str):
            return False
        regex_pattern = _convert_like_pattern_to_regex(filter_value)
        return bool(re.match(regex_pattern, field_value, re.IGNORECASE))

    elif op == FilterOperator.IN:
        # 3.7: in record[field] in value
        if not isinstance(filter_value, list):
            raise ValueError(f"Invalid value type for operator {op}: expected list, got {type(filter_value).__name__}")
        return field_value in filter_value

    elif op == FilterOperator.IS:
        # 3.8: is value null record[field] is None
        # IS operator is used for NULL checks
        if filter_value is None:
            return field_value is None
        else:
            # IS with non-null value (e.g., IS TRUE, IS FALSE)
            return field_value is filter_value

    else:
        raise ValueError(f"Unsupported operator: {op}")


def _evaluate_and_filter(
    filter_: AndFilter,
    record: Mapping[str, Any],
) -> bool:
    """ AndFilter.

     3.9: and . 

    Args:
        filter_: AndFilter 
        record: dictionary

    Returns:
        value, 
    """
    if not filter_.filters:
        # AND True (AND )
        return True

    return all(evaluate(sub_filter, record) for sub_filter in filter_.filters)


def _evaluate_or_filter(
    filter_: OrFilter,
    record: Mapping[str, Any],
) -> bool:
    """ OrFilter.

     3.10: or . 

    Args:
        filter_: OrFilter 
        record: dictionary

    Returns:
        value, 
    """
    if not filter_.filters:
        # OR False (OR )
        return False

    return any(evaluate(sub_filter, record) for sub_filter in filter_.filters)


def _evaluate_not_filter(
    filter_: NotFilter,
    record: Mapping[str, Any],
) -> bool:
    """ NotFilter.

     3.11: not . 

    Args:
        filter_: NotFilter 
        record: dictionary

    Returns:
        value, 
    """
    return not evaluate(filter_.filter, record)


# ============================================================================
# HTTP string (Requirement 4.x)
# ============================================================================


def _url_encode_single_value(value: str | int | float | bool | list[str | int | float] | None) -> str:
    """URL value (list) .

    Args:
        value: value

    Returns:
        URL string
    """
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        # listvalue, IN
        raise ValueError("List values should be encoded using IN operator format")
    # stringvalue URL
    return quote(str(value), safe="")


def _format_filter_for_nested(filter_: Filter) -> str:
    """ Filter  ( and/or ) .

: field.op.value () 

    Args:
        filter_: Filter DSL 

    Returns:
        string
    """
    if isinstance(filter_, ComparisonFilter):
        return _format_comparison_filter_nested(filter_)
    if isinstance(filter_, AndFilter):
        return _format_and_filter_nested(filter_)
    if isinstance(filter_, OrFilter):
        return _format_or_filter_nested(filter_)
    # At this point, filter_ must be NotFilter based on the Filter union type
    return _format_not_filter_nested(filter_)


def _format_comparison_filter_nested(filter_: ComparisonFilter) -> str:
    """ ComparisonFilter .

    : field.op.value

    Args:
        filter_: ComparisonFilter 

    Returns:
        string
    """
    field = filter_.field
    op = filter_.op.value
    value = filter_.value

    if filter_.op == FilterOperator.IN:
        # 4.3: in field.in.(v1,v2,...)
        if not isinstance(value, list):
            raise ValueError(f"Invalid value type for operator {op}: expected list, got {type(value).__name__}")
        encoded_values = [_url_encode_single_value(v) for v in value]
        return f"{field}.{op}.({','.join(encoded_values)})"
    else:
        # 4.2: field.op.value
        encoded_value = _url_encode_single_value(value)
        return f"{field}.{op}.{encoded_value}"


def _format_and_filter_nested(filter_: AndFilter) -> str:
    """ AndFilter .

    : and(f1,f2,...)

    Args:
        filter_: AndFilter 

    Returns:
        string
    """
    if not filter_.filters:
        return "and()"

    nested_filters = [_format_filter_for_nested(f) for f in filter_.filters]
    return f"and({','.join(nested_filters)})"


def _format_or_filter_nested(filter_: OrFilter) -> str:
    """ OrFilter .

    : or(f1,f2,...)

    Args:
        filter_: OrFilter 

    Returns:
        string
    """
    if not filter_.filters:
        return "or()"

    nested_filters = [_format_filter_for_nested(f) for f in filter_.filters]
    return f"or({','.join(nested_filters)})"


def _format_not_filter_nested(filter_: NotFilter) -> str:
    """ NotFilter .

     4.6: not  not.filter

    Args:
        filter_: NotFilter 

    Returns:
        string
    """
    inner = filter_.filter

    if isinstance(inner, ComparisonFilter):
        # ComparisonFilter, field.not.op.value
        field = inner.field
        op = inner.op.value
        value = inner.value

        if inner.op == FilterOperator.IN:
            if not isinstance(value, list):
                raise ValueError(f"Invalid value type for operator {op}: expected list, got {type(value).__name__}")
            encoded_values = [_url_encode_single_value(v) for v in value]
            return f"{field}.not.{op}.({','.join(encoded_values)})"
        else:
            encoded_value = _url_encode_single_value(value)
            return f"{field}.not.{op}.{encoded_value}"
    else:
        # , not.filter
        inner_str = _format_filter_for_nested(inner)
        return f"not.{inner_str}"


def to_query_string(filter_: Filter) -> str:
    """ Filter DSL  PostgREST string.

     4.1:  to_query_string(filter: Filter_DSL) -> str method

    Args:
        filter_: Filter DSL 

    Returns:
        PostgREST string

    Examples:
        >>> filter_ = ComparisonFilter.eq("name", "alice")
        >>> to_query_string(filter_)
        'name=eq.alice'

        >>> filter_ = ComparisonFilter.in_("status", ["active", "pending"])
        >>> to_query_string(filter_)
        'status=in.(active,pending)'

        >>> filter_ = AndFilter(filters=[ComparisonFilter.gte("age", 18), ComparisonFilter.eq("status", "active")])
        >>> to_query_string(filter_)
        'and=(age.gte.18,status.eq.active)'

        >>> filter_ = NotFilter(filter=ComparisonFilter.eq("status", "deleted"))
        >>> to_query_string(filter_)
        'status=not.eq.deleted'
    """
    if isinstance(filter_, ComparisonFilter):
        return _to_query_string_comparison(filter_)
    if isinstance(filter_, AndFilter):
        return _to_query_string_and(filter_)
    if isinstance(filter_, OrFilter):
        return _to_query_string_or(filter_)
    # At this point, filter_ must be NotFilter based on the Filter union type
    return _to_query_string_not(filter_)


def _to_query_string_comparison(filter_: ComparisonFilter) -> str:
    """ ComparisonFilter string.

     4.2: ComparisonFilter  "field=op.value" 
     4.3: in  "field=in.(value1,value2,...)" 

    Args:
        filter_: ComparisonFilter 

    Returns:
        string
    """
    field = filter_.field
    op = filter_.op.value
    value = filter_.value

    if filter_.op == FilterOperator.IN:
        # 4.3: in field=in.(v1,v2,...)
        if not isinstance(value, list):
            raise ValueError(f"Invalid value type for operator {op}: expected list, got {type(value).__name__}")
        encoded_values = [_url_encode_single_value(v) for v in value]
        return f"{field}={op}.({','.join(encoded_values)})"
    else:
        # 4.2: field=op.value
        encoded_value = _url_encode_single_value(value)
        return f"{field}={op}.{encoded_value}"


def _to_query_string_and(filter_: AndFilter) -> str:
    """ AndFilter string.

     4.4: AndFilter  "and=(filter1,filter2,...)" 

    Args:
        filter_: AndFilter 

    Returns:
        string
    """
    if not filter_.filters:
        return "and=()"

    nested_filters = [_format_filter_for_nested(f) for f in filter_.filters]
    return f"and=({','.join(nested_filters)})"


def _to_query_string_or(filter_: OrFilter) -> str:
    """ OrFilter string.

     4.5: OrFilter  "or=(filter1,filter2,...)" 

    Args:
        filter_: OrFilter 

    Returns:
        string
    """
    if not filter_.filters:
        return "or=()"

    nested_filters = [_format_filter_for_nested(f) for f in filter_.filters]
    return f"or=({','.join(nested_filters)})"


def _to_query_string_not(filter_: NotFilter) -> str:
    """ NotFilter string.

     4.6: NotFilter  "not.filter" 
     ComparisonFilter,  "field=not.op.value"

    Args:
        filter_: NotFilter 

    Returns:
        string
    """
    inner = filter_.filter

    if isinstance(inner, ComparisonFilter):
        # ComparisonFilter, field=not.op.value
        field = inner.field
        op = inner.op.value
        value = inner.value

        if inner.op == FilterOperator.IN:
            if not isinstance(value, list):
                raise ValueError(f"Invalid value type for operator {op}: expected list, got {type(value).__name__}")
            encoded_values = [_url_encode_single_value(v) for v in value]
            return f"{field}=not.{op}.({','.join(encoded_values)})"
        else:
            encoded_value = _url_encode_single_value(value)
            return f"{field}=not.{op}.{encoded_value}"
    else:
        # , not.filter
        inner_str = _format_filter_for_nested(inner)
        return f"not={inner_str}"


# ============================================================================
# HTTP string (Requirement 4.8)
# ============================================================================


# set
_VALID_OPERATORS = {op.value for op in FilterOperator}


def _url_decode_value(encoded: str) -> str | int | float | bool | None:
    """URL valuetype.

    Args:
        encoded: URL stringvalue

    Returns:
        typevalue
    """
    # URL
    decoded = unquote(encoded)

    # value
    if decoded == "null":
        return None
    if decoded == "true":
        return True
    if decoded == "false":
        return False

    try:
        # integer
        if "." not in decoded and "e" not in decoded.lower():
            return int(decoded)
    except ValueError:
        pass

    try:
        # float
        return float(decoded)
    except ValueError:
        pass

    # string
    return decoded


def _split_by_comma_at_depth_zero(s: str) -> list[str]:
    """ 0 string.

, . 

    Args:
        s: string

    Returns:
        stringlist
    """
    result: list[str] = []
    current: list[str] = []
    depth = 0

    for char in s:
        if char == "(":
            depth += 1
            current.append(char)
        elif char == ")":
            depth -= 1
            current.append(char)
        elif char == "," and depth == 0:
            result.append("".join(current))
            current = []
        else:
            current.append(char)

    if current:
        result.append("".join(current))

    return result


def _parse_nested_filter(nested: str) -> Filter:
    """.

    :
    - field.op.value (ComparisonFilter)
    - field.op.(v1,v2,...) (ComparisonFilter with IN)
    - field.not.op.value (NotFilter with ComparisonFilter)
    - and(f1,f2,...) (AndFilter)
    - or(f1,f2,...) (OrFilter)
    - not.filter (NotFilter)

    Args:
        nested: string

    Returns:
         Filter 

    Raises:
        ValueError: 
    """
    nested = nested.strip()

    if not nested:
        raise ValueError("Invalid query string format: empty filter")

    # and(...)
    if nested.startswith("and(") and nested.endswith(")"):
        inner = nested[4:-1]  #  "and("  ")"
        if not inner:
            return AndFilter(filters=[])
        parts = _split_by_comma_at_depth_zero(inner)
        filters = [_parse_nested_filter(p) for p in parts]
        return AndFilter(filters=filters)

    # or(...)
    if nested.startswith("or(") and nested.endswith(")"):
        inner = nested[3:-1]  #  "or("  ")"
        if not inner:
            return OrFilter(filters=[])
        parts = _split_by_comma_at_depth_zero(inner)
        filters = [_parse_nested_filter(p) for p in parts]
        return OrFilter(filters=filters)

    # not.filter ( NOT)
    if nested.startswith("not."):
        inner = nested[4:]  #  "not."
        inner_filter = _parse_nested_filter(inner)
        return NotFilter(filter=inner_filter)

    # field.not.op.value (ComparisonFilter NOT)
    # field.op.value
    return _parse_comparison_nested(nested)


def _parse_comparison_nested(nested: str) -> Filter:
    """ ComparisonFilter.

    :
    - field.op.value
    - field.op.(v1,v2,...)
    - field.not.op.value
    - field.not.op.(v1,v2,...)

    Args:
        nested: string

    Returns:
         Filter 

    Raises:
        ValueError: 
    """
    first_dot = nested.find(".")
    if first_dot == -1:
        raise ValueError(f"Invalid query string format: {nested}")

    field = nested[:first_dot]
    rest = nested[first_dot + 1 :]

    # NOT
    is_not = False
    if rest.startswith("not."):
        is_not = True
        rest = rest[4:]  #  "not."

    second_dot = rest.find(".")
    if second_dot == -1:
        raise ValueError(f"Invalid query string format: {nested}")

    op_str = rest[:second_dot]
    value_str = rest[second_dot + 1 :]

    if op_str not in _VALID_OPERATORS:
        raise ValueError(f"Unknown operator in query string: {op_str}")

    op = FilterOperator(op_str)

    # value
    if op == FilterOperator.IN:
        # IN value (v1,v2,...)
        if not value_str.startswith("(") or not value_str.endswith(")"):
            raise ValueError(f"Invalid query string format: {nested}")
        inner = value_str[1:-1]  # 
        if not inner:
            values: list[str | int | float] = []
        else:
            parts = inner.split(",")
            values = []
            for p in parts:
                decoded = _url_decode_value(p)
                # IN str, int, float type
                if decoded is None or isinstance(decoded, bool):
                    values.append(str(decoded) if decoded is not None else "null")
                else:
                    values.append(decoded)
        comparison = ComparisonFilter(field=field, op=op, value=values)
    else:
        value = _url_decode_value(value_str)
        comparison = ComparisonFilter(field=field, op=op, value=value)

    if is_not:
        return NotFilter(filter=comparison)
    return comparison


def from_query_string(query: str) -> Filter:
    """ PostgREST string Filter DSL.

     4.8:  from_query_string(query: str) -> Filter_DSL method

    :
    - field=op.value (ComparisonFilter)
    - field=in.(v1,v2,...) (ComparisonFilter with IN)
    - field=not.op.value (NotFilter with ComparisonFilter)
    - and=(f1,f2,...) (AndFilter)
    - or=(f1,f2,...) (OrFilter)
    - not=filter (NotFilter with logical filter)

    Args:
        query: PostgREST string

    Returns:
         Filter DSL 

    Raises:
        ValueError: string, 

    Examples:
        >>> from_query_string("name=eq.alice")
        ComparisonFilter(type='comparison', field='name', op=<FilterOperator.EQ: 'eq'>, value='alice')

        >>> from_query_string("status=in.(active,pending)")
        ComparisonFilter(type='comparison', field='status', op=<FilterOperator.IN: 'in'>, value=['active', 'pending'])

        >>> from_query_string("and=(age.gte.18,status.eq.active)")
        AndFilter(type='and', filters=[...])

        >>> from_query_string("status=not.eq.deleted")
        NotFilter(type='not', filter=ComparisonFilter(...))
    """
    query = query.strip()

    if not query:
        raise ValueError("Invalid query string format: empty query")

    eq_pos = query.find("=")
    if eq_pos == -1:
        raise ValueError(f"Invalid query string format: {query}")

    left = query[:eq_pos]
    right = query[eq_pos + 1 :]

    # and=(...)
    if left == "and":
        if right.startswith("("):
            if not right.endswith(")"):
                raise ValueError(f"Invalid query string format: {query}")
            inner = right[1:-1]  # 
            if not inner:
                return AndFilter(filters=[])
            parts = _split_by_comma_at_depth_zero(inner)
            filters = [_parse_nested_filter(p) for p in parts]
            return AndFilter(filters=filters)
        # right "not.", field=op.value
        if not right.startswith("not.") and not any(right.startswith(f"{op}.") for op in _VALID_OPERATORS):
            raise ValueError(f"Invalid query string format: {query}")

    # or=(...)
    if left == "or":
        if right.startswith("("):
            if not right.endswith(")"):
                raise ValueError(f"Invalid query string format: {query}")
            inner = right[1:-1]  # 
            if not inner:
                return OrFilter(filters=[])
            parts = _split_by_comma_at_depth_zero(inner)
            filters = [_parse_nested_filter(p) for p in parts]
            return OrFilter(filters=filters)
        # right "not.", field=op.value
        if not right.startswith("not.") and not any(right.startswith(f"{op}.") for op in _VALID_OPERATORS):
            raise ValueError(f"Invalid query string format: {query}")

    # not=filter ( NOT)
    if left == "not":
        try:
            inner_filter = _parse_nested_filter(right)
        except ValueError:
            inner_filter = None
        if inner_filter is not None:
            return NotFilter(filter=inner_filter)

    # field=op.value field=not.op.value
    field = left

    # NOT
    is_not = False
    if right.startswith("not."):
        is_not = True
        right = right[4:]  #  "not."

    dot_pos = right.find(".")
    if dot_pos == -1:
        raise ValueError(f"Invalid query string format: {query}")

    op_str = right[:dot_pos]
    value_str = right[dot_pos + 1 :]

    if op_str not in _VALID_OPERATORS:
        raise ValueError(f"Unknown operator in query string: {op_str}")

    op = FilterOperator(op_str)

    # value
    if op == FilterOperator.IN:
        # IN value (v1,v2,...)
        if not value_str.startswith("(") or not value_str.endswith(")"):
            raise ValueError(f"Invalid query string format: {query}")
        inner = value_str[1:-1]  # 
        if not inner:
            values_list: list[str | int | float] = []
        else:
            parts = inner.split(",")
            values_list = []
            for p in parts:
                decoded = _url_decode_value(p)
                # IN str, int, float type
                if decoded is None or isinstance(decoded, bool):
                    values_list.append(str(decoded) if decoded is not None else "null")
                else:
                    values_list.append(decoded)
        comparison = ComparisonFilter(field=field, op=op, value=values_list)
    else:
        value = _url_decode_value(value_str)
        comparison = ComparisonFilter(field=field, op=op, value=value)

    if is_not:
        return NotFilter(filter=comparison)
    return comparison