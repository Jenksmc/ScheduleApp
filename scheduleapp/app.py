from flask import Flask, send_file, request, jsonify
from flask_cors import CORS
import tasks_store, os, time

app = Flask(__name__)
CORS(app)

# ── PERMANENT SAFETY NET ──────────────────────────────────────
# These titles belonged to old hardcoded demo/seed data that a
# buggy version of the dashboard used to regenerate on every load.
# Even though that bug is fixed, old browser tabs/devices that
# never refreshed can still be running the old code in memory and
# will keep pushing this junk forever until they're closed.
# This filter makes it structurally impossible for that junk to
# ever land in the saved data again, regardless of what any client
# (old or new, ipad/phone/laptop) tries to push.
BLOCKED_DEMO_TITLES = {
    # Empty — real data is now on the Pi, no demo junk to block
}

def strip_demo_junk(data):
    if not data or "tasks" not in data:
        return data
    before = len(data["tasks"])
    data["tasks"] = [
        t for t in data["tasks"]
        if t.get("title") not in BLOCKED_DEMO_TITLES
    ]
    after = len(data["tasks"])
    if before != after:
        print(f"[safety net] Blocked {before - after} demo junk task(s) from being saved")
    return data

@app.route('/')
def index():
    return send_file('dashboard.html')

@app.route('/britt')
def mobile_britt():
    return send_file('mobile.html')

@app.route('/christian')
def mobile_christian():
    return send_file('mobile.html')

@app.route('/mobile')
def mobile_home():
    return send_file('mobile.html')

@app.route('/api/data', methods=['GET'])
def get_data():
    return jsonify(tasks_store.get_all())

@app.route('/api/data', methods=['POST'])
def save_data():
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "no data"}), 400

    # ── STALE-SNAPSHOT GUARD (compare-and-swap) ──────────────
    # Every client must include baseUpdated: the server "updated"
    # stamp of the snapshot it last pulled. If the file on disk is
    # newer, this client is holding stale data (classic case: an
    # iPad tab frozen for days) and letting it write would wipe
    # everything saved since. Reject; the client refetches instead.
    # Old clients that send no baseUpdated are the dangerous ones —
    # they get rejected too (until their tab is refreshed).
    current = tasks_store.get_updated()
    base = data.pop("baseUpdated", None)
    if current > 0 and (base is None or int(base) < int(current)):
        print(f"[stale guard] Rejected write: client base={base} < server={current}")
        return jsonify({"error": "stale", "server_updated": current}), 409

    data = strip_demo_junk(data)

    # ── MERGE, NEVER REPLACE ──────────────────────────────────
    # The old behavior replaced the entire file with the posted
    # payload. Any client that didn't include a key (e.g. a locked
    # budget tab that doesn't know budgetData_britt exists) silently
    # DELETED that key from disk. Now we merge posted keys into the
    # existing file: keys a client doesn't send are always preserved.
    current_data = tasks_store.get_all()

    # ── BUDGET FRESHNESS GUARD ────────────────────────────────
    # budgetData* objects carry a _ts stamp (set client-side on every
    # save). If a client pushes a budget copy OLDER than what's on
    # disk (stale tab, device that pulled before someone else saved),
    # keep the newer disk copy instead of letting old data win.
    for key in list(data.keys()):
        if key.startswith("budgetData") and isinstance(data[key], dict):
            existing = current_data.get(key)
            if isinstance(existing, dict):
                if data[key].get("_ts", 0) < existing.get("_ts", 0):
                    print(f"[budget guard] Kept newer server copy of {key} "
                          f"(client _ts={data[key].get('_ts', 0)} < server _ts={existing.get('_ts', 0)})")
                    del data[key]

    current_data.update(data)
    new_stamp = tasks_store.save_all(current_data)
    return jsonify({"ok": True, "updated": new_stamp})

@app.route('/api/updated', methods=['GET'])
def get_updated():
    """Returns last data update + dashboard file modification time."""
    dashboard_path = os.path.join(os.path.dirname(__file__), 'dashboard.html')
    file_updated = int(os.path.getmtime(dashboard_path)) if os.path.exists(dashboard_path) else 0
    return jsonify({
        "updated": tasks_store.get_updated(),
        "file_updated": file_updated
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)