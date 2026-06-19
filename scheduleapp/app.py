from flask import Flask, send_file, request, jsonify
from flask_cors import CORS
import tasks_store, os, time

app = Flask(__name__)
CORS(app)

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