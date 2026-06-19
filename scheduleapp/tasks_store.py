"""
Simple JSON file-based task store.
Keeps tasks.json on disk so all devices share the same data.
"""
import json, os, threading, time

STORE_PATH = os.path.join(os.path.dirname(__file__), 'tasks_data.json')
_lock = threading.Lock()

DEFAULT_DATA = {
    "tasks": [],
    "shoppingList": [],
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
        _write(data)

def get_updated():
    with _lock:
        d = _read()
        return d.get("updated", 0)