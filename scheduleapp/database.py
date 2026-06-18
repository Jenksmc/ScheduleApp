import sqlite3

def init_db():
    conn = sqlite3.connect('scheduleapp.db')
    cursor = conn.cursor()

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            assigned_to TEXT NOT NULL,
            category TEXT NOT NULL,
            due_date TEXT,
            recurring TEXT DEFAULT 'none',
            completed INTEGER DEFAULT 0,
            completed_by TEXT,
            completed_at TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    conn.commit()
    conn.close()
    print("Database created successfully!")

init_db()