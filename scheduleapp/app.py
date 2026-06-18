from flask import Flask, send_file, request, jsonify
from flask_cors import CORS
import tasks_store, os

app = Flask(__name__)
CORS(app)  # allow cross-origin so dev tools work

# ── Main dashboard (iPad wall display) ──────────────────────
@app.route('/')
def index():
    return send_file('dashboard.html')

# ── Mobile views ─────────────────────────────────────────────
@app.route('/britt')
def mobile_britt():
    return send_file('mobile.html')

@app.route('/christian')
def mobile_christian():
    return send_file('mobile.html')

@app.route('/mobile')
def mobile_home():
    return send_file('mobile.html')

# ── Data API ─────────────────────────────────────────────────
@app.route('/api/data', methods=['GET'])
def get_data():
    return jsonify(tasks_store.get_all())

@app.route('/api/data', methods=['POST'])
def save_data():
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "no data"}), 400
    tasks_store.save_all(data)
    return jsonify({"ok": True, "updated": data.get("updated", 0)})

@app.route('/api/updated', methods=['GET'])
def get_updated():
    """Lightweight poll endpoint — just returns the last-updated timestamp."""
    return jsonify({"updated": tasks_store.get_updated()})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)