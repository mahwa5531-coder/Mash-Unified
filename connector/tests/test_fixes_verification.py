import os
import re
import json

def test_single_env_and_no_max_iterations_option():
    # 1. Verify connector/.env exists and is the only .env in Mash
    env_path = r'c:\Users\rama\Downloads\Mash\connector\.env'
    assert os.path.exists(env_path), "connector/.env must exist"
    assert not os.path.exists(r'c:\Users\rama\Downloads\Mash\NexAU\.env'), "NexAU/.env must NOT exist (only 1 single .env in codebase)"
    assert not os.path.exists(r'c:\Users\rama\Downloads\Mash\connector\.env.backup'), "connector/.env.backup must NOT exist"
    
    with open(env_path, 'r', encoding='utf-8') as f:
        content = f.read()
    # 2. Verify AGENT_MAX_ITERATIONS option is completely removed from .env
    assert 'AGENT_MAX_ITERATIONS' not in content, "AGENT_MAX_ITERATIONS must be removed from .env so execution is inherently dynamic/infinite"
    print("PASS: test_single_env_and_no_max_iterations_option (Only 1 single .env, no limiter option)")

def test_universal_scrollbar_removal():
    css_path = r'c:\Users\rama\Downloads\Mash\frontend\src\app\globals.css'
    with open(css_path, 'r', encoding='utf-8') as f:
        css = f.read()
    # Check that universal scrollbar suppression is present
    assert 'scrollbar-width: none !important;' in css, "globals.css must universally suppress scrollbar-width"
    assert 'display: none !important;' in css, "globals.css must hide ::-webkit-scrollbar"
    assert 'width: 8px;' not in css, "globals.css must NOT define 8px scrollbars anywhere"
    print("PASS: test_universal_scrollbar_removal (All visible scrollbars completely eliminated globally)")

def test_process_compat_taskkill_first():
    p_path = r'c:\Users\rama\Downloads\Mash\NexAU\nexau\archs\platform\process_compat.py'
    with open(p_path, 'r', encoding='utf-8') as f:
        content = f.read()
    # Check that taskkill is called before process.terminate in WindowsProcessCompat
    wp_idx = content.find('class WindowsProcessCompat')
    assert wp_idx != -1, "WindowsProcessCompat must exist"
    wp_code = content[wp_idx:wp_idx+1500]
    taskkill_pos = wp_code.find('taskkill')
    terminate_pos = wp_code.find('process.terminate()')
    assert taskkill_pos != -1, "taskkill must be in WindowsProcessCompat"
    assert terminate_pos != -1, "process.terminate must be in WindowsProcessCompat"
    assert taskkill_pos < terminate_pos, "taskkill must be invoked BEFORE process.terminate to kill process tree"
    print("PASS: test_process_compat_taskkill_first")

def test_tasks_router_kill_fallback():
    t_path = r'c:\Users\rama\Downloads\Mash\connector\app\routers\tasks.py'
    with open(t_path, 'r', encoding='utf-8') as f:
        content = f.read()
    kill_fn = content[content.find('async def kill_task'):content.find('async def kill_task')+1000]
    assert 'taskkill' in kill_fn, "tasks.py kill_task must have direct OS fallback"
    print("PASS: test_tasks_router_kill_fallback")

def test_turns_sanitization_and_stable_ids():
    turns_path = r'c:\Users\rama\Downloads\Mash\frontend\src\lib\turns.ts'
    with open(turns_path, 'r', encoding='utf-8') as f:
        content = f.read()
    assert 'Date.now()' not in content, "turns.ts should NOT use Date.now() for step IDs to prevent accordion reset"
    assert 'VERIFIED' in content, "turns.ts must sanitize VERIFIED"
    assert 'last.type === \'thinking\' && rStep.type === \'thinking\'' in content, "turns.ts must merge consecutive thinking steps"
    print("PASS: test_turns_sanitization_and_stable_ids")

def test_accordion_sanitization():
    acc_path = r'c:\Users\rama\Downloads\Mash\frontend\src\components\chat\TaskWorkLogAccordion.tsx'
    with open(acc_path, 'r', encoding='utf-8') as f:
        content = f.read()
    assert 'VERIFIED' in content, "TaskWorkLogAccordion must sanitize VERIFIED"
    assert 'Thought for' in content, "TaskWorkLogAccordion must support Thought for label"
    print("PASS: test_accordion_sanitization")

if __name__ == '__main__':
    test_single_env_and_no_max_iterations_option()
    test_universal_scrollbar_removal()
    test_process_compat_taskkill_first()
    test_tasks_router_kill_fallback()
    test_turns_sanitization_and_stable_ids()
    test_accordion_sanitization()
    print("\nALL 6 VERIFICATION CHECKS PASSED.")
