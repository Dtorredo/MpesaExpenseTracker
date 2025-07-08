from flask import Flask, request, render_template, jsonify
import pandas as pd

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['GET', 'POST'])
def upload():
    if request.method == 'POST':
        file = request.files.get('file')
        if not file:
            return jsonify({"error": "No file uploaded"}), 400

        try:
            df = pd.read_excel(file)

            # Drop rows without completion time
            df = df.dropna(subset=["Completion Time"])
            df["Completion Time"] = pd.to_datetime(df["Completion Time"])

            # Clean Paid In and Withdrawn columns
            df["Paid In"] = pd.to_numeric(df["Paid In"], errors="coerce").fillna(0)
            df["Withdrawn"] = pd.to_numeric(df["Withdrawn"], errors="coerce").fillna(0).abs()

            # Fill missing details
            df["Details"] = df["Details"].fillna("")

            # 🧠 Infer transaction type from keywords
            def classify_type(detail):
                d = detail.lower()
                if "received" in d or "transfer to" in d:
                    return "P2P"
                elif "merchant" in d or "payment" in d:
                    return "PayBill"
                elif "airtime" in d:
                    return "Airtime"
                elif "charge" in d or "fee" in d:
                    return "Charges"
                else:
                    return "Other"

            types = df["Details"].apply(classify_type).tolist()

            df = df.sort_values("Completion Time")

            return jsonify({
                "dates": df["Completion Time"].dt.strftime("%Y-%m-%d").tolist(),
                "income": df["Paid In"].tolist(),
                "expenses": df["Withdrawn"].tolist(),
                "types": types
            })

        except Exception as e:
            return jsonify({"error": str(e)}), 500

    return render_template('upload.html')

if __name__ == "__main__":
    app.run(debug=True)
