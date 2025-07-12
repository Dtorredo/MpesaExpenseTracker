from flask import Flask, request, render_template, jsonify, g
import pandas as pd
import sqlite3
import os

app = Flask(__name__)
DATABASE = 'expensetracker.db'
ALLOWED_EXTENSIONS = {'xlsx', 'xls', 'csv'}

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        cursor = db.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                completion_time TEXT NOT NULL,
                details TEXT,
                paid_in REAL,
                withdrawn REAL,
                transaction_type TEXT
            )
        """)
        db.commit()

@app.route('/')
def index():
    return render_template('dashboard.html')

@app.route('/api/data')
def get_data():
    db = get_db()
    cursor = db.execute('SELECT completion_time, paid_in, withdrawn, details, transaction_type FROM transactions ORDER BY completion_time')
    rows = cursor.fetchall()
    
    data = {
        "dates": [row['completion_time'] for row in rows],
        "income": [row['paid_in'] for row in rows],
        "expenses": [row['withdrawn'] for row in rows],
        "details": [row['details'] for row in rows],
        "types": [row['transaction_type'] for row in rows]
    }
    return jsonify(data)

@app.route('/upload', methods=['GET', 'POST'])
def upload():
    if request.method == 'POST':
        file = request.files.get('file')
        if not file or not allowed_file(file.filename):
            return jsonify({"error": "Invalid file type"}), 400

        try:
            if file.filename.endswith('.csv'):
                df = pd.read_csv(file)
            else:
                df = pd.read_excel(file)

            df = df.dropna(subset=["Completion Time"])
            df["Completion Time"] = pd.to_datetime(df["Completion Time"])

            df["Paid In"] = pd.to_numeric(df["Paid In"], errors="coerce").fillna(0)
            df["Withdrawn"] = pd.to_numeric(df["Withdrawn"], errors="coerce").fillna(0).abs()
            df["Details"] = df["Details"].fillna("")

            def classify_type(detail):
                d = detail.lower()
                if "funds received from" in d: return "P2P"
                if "deposit of funds at agent till" in d: return "Deposit"
                if "merchant customer payment from" in d: return "Pay In"
                if "airtime purchase" in d: return "Airtime"
                if "customer transfer to" in d: return "Send Money"
                if "merchant payment to" in d: return "PayBill"
                if "m-shwari deposit" in d: return "M-Shwari Deposit"
                if "customer transfer of funds charge" in d: return "Charges"
                return "Other"

            df['transaction_type'] = df["Details"].apply(classify_type)
            
            # Rename columns to match the database
            df.rename(columns={
                "Completion Time": "completion_time",
                "Details": "details",
                "Paid In": "paid_in",
                "Withdrawn": "withdrawn"
            }, inplace=True)

            # Save to database
            db = get_db()
            df[['completion_time', 'details', 'paid_in', 'withdrawn', 'transaction_type']].to_sql(
                'transactions', 
                db, 
                if_exists='append', 
                index=False
            )
            db.commit()

            return jsonify({"success": f"{len(df)} transactions uploaded successfully."})

        except Exception as e:
            return jsonify({"error": str(e)}), 500

    return render_template('upload.html')

if __name__ == "__main__":
    if not os.path.exists(DATABASE):
        init_db()
    app.run(debug=True)
