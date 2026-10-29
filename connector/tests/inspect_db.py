import pathlib
import sqlite3

p = pathlib.Path.home() / ".mash" / "database" / "mash.db"
if not p.exists():
    legacy = pathlib.Path.home() / ".nexau" / "database" / "nexau.db"
    if legacy.exists():
        p = legacy
    elif (pathlib.Path.home() / ".nexau" / "nexau.db").exists():
        p = pathlib.Path.home() / ".nexau" / "nexau.db"
conn = sqlite3.connect(p)
tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print(f"Tables in {p.name} ({p}):", tables)
for t in tables:
    count = conn.execute(f"SELECT COUNT(*) FROM [{t}]").fetchone()[0]
    print(f"  - {t}: {count} rows")
conn.close()
