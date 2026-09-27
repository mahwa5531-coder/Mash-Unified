"""Filter DSL 

 PostgREST  Filter,  JSON, 
SQLAlchemy, Python  HTTP string. 
"""

from collections.abc import Sequence
from enum import Enum
from typing import Literal

from pydantic import BaseModel


class FilterOperator(str, Enum):
    """PostgREST """

    EQ = "eq"  # 
    NEQ = "neq"  # 
    GT = "gt"  # 
    GTE = "gte"  # 
    LT = "lt"  # 
    LTE = "lte"  # 
    LIKE = "like"  # 
    ILIKE = "ilike"  # 
    IN = "in"  # packagelist
    IS = "is"  # IS NULL / IS NOT NULL


class LogicalOperator(str, Enum):
    """"""

    AND = "and"
    OR = "or"
    NOT = "not"


class FilterBase(BaseModel):
    """Filter DSL class"""

    pass


class ComparisonFilter(FilterBase):
    """"""

    type: Literal["comparison"] = "comparison"
    field: str
    op: FilterOperator
    value: str | int | float | bool | None | list[str | int | float]

    @classmethod
    def eq(cls, field: str, value: str | int | float | bool | None) -> "ComparisonFilter":
        """method"""
        return cls(field=field, op=FilterOperator.EQ, value=value)

    @classmethod
    def neq(cls, field: str, value: str | int | float | bool | None) -> "ComparisonFilter":
        """method"""
        return cls(field=field, op=FilterOperator.NEQ, value=value)

    @classmethod
    def gt(cls, field: str, value: str | int | float) -> "ComparisonFilter":
        """method"""
        return cls(field=field, op=FilterOperator.GT, value=value)

    @classmethod
    def gte(cls, field: str, value: str | int | float) -> "ComparisonFilter":
        """method"""
        return cls(field=field, op=FilterOperator.GTE, value=value)

    @classmethod
    def lt(cls, field: str, value: str | int | float) -> "ComparisonFilter":
        """method"""
        return cls(field=field, op=FilterOperator.LT, value=value)

    @classmethod
    def lte(cls, field: str, value: str | int | float) -> "ComparisonFilter":
        """method"""
        return cls(field=field, op=FilterOperator.LTE, value=value)

    @classmethod
    def like(cls, field: str, value: str) -> "ComparisonFilter":
        """method（）"""
        return cls(field=field, op=FilterOperator.LIKE, value=value)

    @classmethod
    def ilike(cls, field: str, value: str) -> "ComparisonFilter":
        """method（）"""
        return cls(field=field, op=FilterOperator.ILIKE, value=value)

    @classmethod
    def in_(cls, field: str, value: list[str | int | float]) -> "ComparisonFilter":
        """packagelistmethod"""
        return cls(field=field, op=FilterOperator.IN, value=value)

    @classmethod
    def is_null(cls, field: str) -> "ComparisonFilter":
        """ IS NULL method"""
        return cls(field=field, op=FilterOperator.IS, value=None)


class AndFilter(FilterBase):
    """AND """

    type: Literal["and"] = "and"
    filters: Sequence["ComparisonFilter | AndFilter | OrFilter | NotFilter"]


class OrFilter(FilterBase):
    """OR """

    type: Literal["or"] = "or"
    filters: Sequence["ComparisonFilter | AndFilter | OrFilter | NotFilter"]


class NotFilter(FilterBase):
    """NOT """

    type: Literal["not"] = "not"
    filter: "ComparisonFilter | AndFilter | OrFilter | NotFilter"


# Filter type
Filter = ComparisonFilter | AndFilter | OrFilter | NotFilter

# , Pydantic Filter type
# (discriminated union)
AndFilter.model_rebuild()
OrFilter.model_rebuild()
NotFilter.model_rebuild()