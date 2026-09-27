# Copyright (c) Nex-AGI. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
"""Session mid-flight steering mailbox for live user interaction."""

from __future__ import annotations
import threading
from typing import Dict, List

_LOCK = threading.Lock()
_STEERING_MAILBOXES: Dict[str, List[str]] = {}


def queue_steering_message(session_id: str, message: str) -> None:
    """Queue a steering message for a running session."""
    with _LOCK:
        if session_id not in _STEERING_MAILBOXES:
            _STEERING_MAILBOXES[session_id] = []
        _STEERING_MAILBOXES[session_id].append(message)


def pop_steering_messages(session_id: str) -> List[str]:
    """Pop and clear all queued steering messages for a session."""
    with _LOCK:
        if session_id not in _STEERING_MAILBOXES or not _STEERING_MAILBOXES[session_id]:
            return []
        messages = list(_STEERING_MAILBOXES[session_id])
        _STEERING_MAILBOXES[session_id].clear()
        return messages


def peek_steering_messages(session_id: str) -> List[str]:
    """Peek at currently queued steering messages without removing them."""
    with _LOCK:
        return list(_STEERING_MAILBOXES.get(session_id, []))


def clear_steering_messages(session_id: str) -> None:
    """Clear steering mailbox for a session."""
    with _LOCK:
        _STEERING_MAILBOXES.pop(session_id, None)
