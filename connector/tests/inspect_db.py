import sqlite3
import pathlib

p = pathlib.Path.home() / ".nexau" / "nexau.db"
conn = sqlite3.connect(p)
tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print("Tables in nexau.db:", tables)
for t in tables:
    count = conn.execute(f"SELECT COUNT(*) FROM [{t}]").fetchone()[0]
    print(f"  - {t}: {count} rows")
conn.close()
