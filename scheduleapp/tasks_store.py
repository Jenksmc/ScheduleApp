"""
Simple JSON file-based task store.
Keeps tasks.json on disk so all devices share the same data.
"""
import json, os, threading, time

STORE_PATH = os.path.join(os.path.dirname(__file__), 'tasks_data.json')
BACKUP_DIR = os.path.join(os.path.dirname(__file__), 'backups')
BACKUP_MIN_INTERVAL = 3600   # at most one snapshot per hour
BACKUP_KEEP = 72             # keep the newest 72 snapshots
_lock = threading.Lock()
_last_backup = [0]

def _snapshot_before_write():
    """Copy the current data file into backups/ before it gets overwritten.
    Rate-limited and rotated, so no client (buggy, stale, or otherwise) can
    permanently destroy data — there is always recent history to restore."""
    try:
        if not os.path.exists(STORE_PATH):
            return
        now = time.time()
        if now - _last_backup[0] < BACKUP_MIN_INTERVAL:
            return
        os.makedirs(BACKUP_DIR, exist_ok=True)
        stamp = time.strftime('%Y%m%d-%H%M%S') + f'-{int((now % 1) * 1000):03d}'
        dest = os.path.join(BACKUP_DIR, f'tasks_data-{stamp}.json')
        with open(STORE_PATH, 'rb') as s, open(dest, 'wb') as d:
            d.write(s.read())
        _last_backup[0] = now
        # rotate: newest BACKUP_KEEP survive
        snaps = sorted(f for f in os.listdir(BACKUP_DIR) if f.startswith('tasks_data-'))
        for old_snap in snaps[:-BACKUP_KEEP]:
            os.remove(os.path.join(BACKUP_DIR, old_snap))
    except Exception as e:
        print(f"[backup] snapshot failed (continuing with save): {e}")

DEFAULT_DATA = {
    "tasks": [],
    "shoppingList": [],
    "shoppingLists": [],
    "shopListNid": 1,
    "customHolidays": [],
    "workSchedules": {},
    "members": None,
    "budgetData": None,
    "budgetNid": 1,
    "nid": 100,
    "shopNid": 1,
    "wsNid": 1,
    "updated": 0
}

def _read():
    if not os.path.exists(STORE_PATH):
        return dict(DEFAULT_DATA)
    with open(STORE_PATH, 'r') as f:
        try:
            return json.load(f)
        except Exception:
            return dict(DEFAULT_DATA)

def _write(data):
    data["updated"] = int(time.time() * 1000)
    with open(STORE_PATH, 'w') as f:
        json.dump(data, f)

def get_all():
    with _lock:
        return _read()

def save_all(data):
    with _lock:
        _snapshot_before_write()
        _write(data)
        return data["updated"]

def get_updated():
    with _lock:
        d = _read()
        return d.get("updated", 0)