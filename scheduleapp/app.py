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
    "Clean litter boxes", "Vacuum", "Take out trash", "Dishes",
    "Dentist appt", "Cat food", "Study BGP flashcards",
    "Oil change", "Mop floors", "Wipe counters",
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
    data = strip_demo_junk(data)
    tasks_store.save_all(data)
    return jsonify({"ok": True, "updated": data.get("updated", 0)})

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