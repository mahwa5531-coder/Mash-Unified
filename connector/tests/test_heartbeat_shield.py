import asyncio


def test_heartbeat_shield_does_not_cancel_underlying_task():
    """Verify that asyncio.shield prevents timeout cancellation of the underlying async generator."""

    async def _run():
        async def slow_generator():
            await asyncio.sleep(0.15)
            yield "event_1"
            await asyncio.sleep(0.15)
            yield "event_2"

        gen = slow_generator()
        anext_task = asyncio.ensure_future(gen.__anext__())
        yielded = []

        try:
            while True:
                try:
                    # 50ms timeout — slow generator takes 150ms, so it will hit TimeoutError twice before event_1
                    item = await asyncio.wait_for(asyncio.shield(anext_task), timeout=0.05)
                    yielded.append(item)
                    anext_task = asyncio.ensure_future(gen.__anext__())
                except TimeoutError:
                    yielded.append(": heartbeat")
                except StopAsyncIteration:
                    break
        finally:
            if not anext_task.done():
                anext_task.cancel()

        assert ": heartbeat" in yielded
        assert "event_1" in yielded
        assert "event_2" in yielded
        assert yielded.count("event_1") == 1
        assert yielded.count("event_2") == 1

    asyncio.run(_run())
