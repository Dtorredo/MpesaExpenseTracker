from flask import Flask, request, jsonify, send_from_directory
import pandas as pd
import re
import os
import json # For saving and loading JSON data

app = Flask(__name__)
UPLOAD_FOLDER = 'uploads'
PROCESSED_DATA_FOLDER = 'processed_chart_data' # New folder for chart-specific processed data
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)
if not os.path.exists(PROCESSED_DATA_FOLDER):
    os.makedirs(PROCESSED_DATA_FOLDER)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['PROCESSED_DATA_FOLDER'] = PROCESSED_DATA_FOLDER

# --- Helper function for M-Pesa data processing and chart data generation ---
def process_mpesa_dataframe_and_generate_charts(df):
    """
    Cleans, normalizes, categorizes M-Pesa transaction data,
    and then generates chart-ready summary data.
    """
    # --- Step 1: Data Cleaning and Standardization (similar to previous) ---
    df.columns = df.columns.str.strip().str.lower().str.replace('[^a-z0-9]', '', regex=True)
    
    # You MUST adjust these mappings based on your actual Excel/CSV headers!
    column_mapping = {
        'transactioncode': 'Transaction_ID',
        'completiontime': 'Completion_Time',
        'details': 'Details',
        'transactiontype': 'Transaction_Type',
        'amount': 'Amount', 
        'balance': 'Balance',
        'date': 'Date', 
        'time': 'Time',
        # Add other potential column names from your files here
        # e.g., 'cr': 'Deposited', 'dr': 'Withdrawn'
    }
    df = df.rename(columns=column_mapping)

    if 'Date' in df.columns and 'Time' in df.columns and 'Completion_Time' not in df.columns:
        df['Completion_Time'] = pd.to_datetime(df['Date'] + ' ' + df['Time'], errors='coerce')
    elif 'Completion_Time' in df.columns:
        df['Completion_Time'] = pd.to_datetime(df['Completion_Time'], errors='coerce')

    numeric_cols = ['Amount', 'Balance'] # Focus on final 'Amount' and 'Balance' after merge
    for col in numeric_cols:
        if col in df.columns:
            df[col] = df[col].astype(str).str.replace(r'[^\d.-]', '', regex=True)
            df[col] = pd.to_numeric(df[col], errors='coerce')

    # If 'Amount' is not directly present, try to derive it.
    # This part is highly dependent on your CSV/Excel structure.
    # Example: If you have separate 'Debit' and 'Credit' columns
    if 'debit' in df.columns and 'credit' in df.columns and 'Amount' not in df.columns:
        df['debit'] = pd.to_numeric(df['debit'].astype(str).str.replace(r'[^\d.]', '', regex=True), errors='coerce').fillna(0)
        df['credit'] = pd.to_numeric(df['credit'].astype(str).str.replace(r'[^\d.]', '', regex=True), errors='coerce').fillna(0)
        df['Amount'] = df['credit'] - df['debit']
    elif 'Amount' not in df.columns and 'withdrawn' in df.columns and 'deposited' in df.columns:
         df['Amount'] = df['deposited'].fillna(0) - df['withdrawn'].fillna(0)
    elif 'Amount' not in df.columns and 'withdrawal' in df.columns and 'deposit' in df.columns:
         df['Amount'] = df['deposit'].fillna(0) - df['withdrawal'].fillna(0)


    # Ensure 'Amount' is numeric after all attempts
    df['Amount'] = pd.to_numeric(df['Amount'], errors='coerce')

    # Categorize transactions (CRITICAL: Customize these rules for M-Pesa!)
    def categorize_transaction(row):
        details = str(row.get('Details', '')).lower()
        trans_type = str(row.get('Transaction_Type', '')).lower()
        amount = row.get('Amount', 0)

        # Money In categories
        if amount > 0:
            if 'received from' in details or 'received on' in trans_type or 'transfer from' in details:
                return 'Money In (Individual)'
            elif 'till' in details or 'pay bill' in details and 'received' in trans_type: # Assuming businesses might pay to your till/paybill
                return 'Money In (Business)'
            elif 'deposit' in trans_type or 'cash deposit' in details:
                return 'Cash Deposit'
            elif 'mshwari' in details or 'kcb m-pesa' in details or 'loan' in details or 'mshwari' in trans_type:
                return 'Loan/Savings (Credit)'
            else:
                return 'Other Income'
        # Money Out categories
        elif amount < 0:
            if 'airtime' in details or 'airtime purchase' in trans_type:
                return 'Airtime'
            elif 'pay bill' in trans_type or 'paid to' in details:
                return 'Bill Payment'
            elif 'buy goods' in trans_type or 'buy goods' in details:
                return 'Buy Goods'
            elif 'send money' in trans_type or 'sent to' in details:
                return 'Money Transfer (Outgoing)'
            elif 'withdraw' in trans_type or 'withdrawal' in details:
                return 'Cash Withdrawal'
            elif 'fuliza' in details:
                return 'Fuliza'
            elif 'pochi la biashara' in details or 'pochi' in trans_type:
                return 'Pochi La Biashara'
            else:
                return 'Other Expense'
        return 'Unknown'


    df['Category'] = df.apply(categorize_transaction, axis=1)

    # Filter out invalid or incomplete rows (basic validation)
    df = df.dropna(subset=['Completion_Time', 'Amount'])
    if 'Transaction_ID' in df.columns:
        df = df[df['Transaction_ID'].astype(str).str.match(r'^[A-Z0-9]{10,}$', na=False)]
    
    # Ensure all required columns for charts are present, even if empty
    required_cols = ['Completion_Time', 'Amount', 'Category']
    for col in required_cols:
        if col not in df.columns:
            df[col] = pd.NA # Add column if missing

    # --- Step 2: Generate Chart-Ready Data ---
    chart_data = {
        "monthlySpending": {"labels": [], "data": []},
        "category": {"labels": [], "data": []},
        "dailyTrend": {"labels": [], "data": []},
        "moneyIn": {"labels": [], "data": []},
        "moneyOut": {"labels": [], "data": []}
    }

    if not df.empty:
        # Monthly Spending (Expenses only)
        expenses_df = df[df['Amount'] < 0].copy()
        expenses_df['Month'] = expenses_df['Completion_Time'].dt.to_period('M')
        monthly_spending = expenses_df.groupby('Month')['Amount'].sum().abs()
        chart_data['monthlySpending']['labels'] = monthly_spending.index.strftime('%b %Y').tolist()
        chart_data['monthlySpending']['data'] = monthly_spending.tolist()

        # Top Categories (Overall spending/income, or just expenses)
        # For 'categoryChart', let's use the distribution of ALL transactions by count for now,
        # or you can make it expenses by amount if you prefer.
        # Let's make it total amount spent per category
        category_spending = expenses_df.groupby('Category')['Amount'].sum().abs().nlargest(10) # Top 10 expenses
        chart_data['category']['labels'] = category_spending.index.tolist()
        chart_data['category']['data'] = category_spending.tolist()

        # Daily Trend (Last 7 days of data, or general day of week average)
        # Let's do average spending per day of the week
        expenses_df['DayOfWeek'] = expenses_df['Completion_Time'].dt.day_name()
        daily_trend = expenses_df.groupby('DayOfWeek')['Amount'].mean().abs()
        # Order days correctly
        day_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
        daily_trend = daily_trend.reindex(day_order, fill_value=0) # Fill missing days with 0
        chart_data['dailyTrend']['labels'] = [d[:3] for d in daily_trend.index.tolist()] # Mon, Tue etc.
        chart_data['dailyTrend']['data'] = daily_trend.tolist()

        # Money In Categories (Amounts)
        money_in_df = df[df['Amount'] > 0].copy()
        money_in_categories = money_in_df.groupby('Category')['Amount'].sum()
        # Map to chart.js labels: 'Deposit', 'Individual', 'Business', 'Mshwari', 'Other Income'
        money_in_labels = ['Cash Deposit', 'Money In (Individual)', 'Money In (Business)', 'Loan/Savings (Credit)', 'Other Income']
        money_in_data = [
            money_in_categories.get('Cash Deposit', 0),
            money_in_categories.get('Money In (Individual)', 0),
            money_in_categories.get('Money In (Business)', 0),
            money_in_categories.get('Loan/Savings (Credit)', 0),
            money_in_categories.get('Other Income', 0) # Catch-all for others
        ]
        chart_data['moneyIn']['labels'] = money_in_labels
        chart_data['moneyIn']['data'] = money_in_data


        # Money Out Categories (Amounts - as absolute values)
        money_out_df = df[df['Amount'] < 0].copy()
        money_out_categories = money_out_df.groupby('Category')['Amount'].sum().abs()
        # Map to chart.js labels: 'Sent', 'Buy goods', 'Paybill', 'Pochi', 'Fuliza', 'Withdrawal', 'Airtime', 'Other Expense'
        money_out_labels = ['Money Transfer (Outgoing)', 'Buy Goods', 'Bill Payment', 'Pochi La Biashara', 'Fuliza', 'Cash Withdrawal', 'Airtime', 'Other Expense']
        money_out_data = [
            money_out_categories.get('Money Transfer (Outgoing)', 0),
            money_out_categories.get('Buy Goods', 0),
            money_out_categories.get('Bill Payment', 0),
            money_out_categories.get('Pochi La Biashara', 0),
            money_out_categories.get('Fuliza', 0),
            money_out_categories.get('Cash Withdrawal', 0),
            money_out_categories.get('Airtime', 0),
            money_out_categories.get('Other Expense', 0) # Catch-all for others
        ]
        chart_data['moneyOut']['labels'] = money_out_labels
        chart_data['moneyOut']['data'] = money_out_data


    return chart_data, None

@app.route('/upload-mpesa-data', methods=['POST'])
def upload_mpesa_data():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400

    file = request.files['file']

    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    filename = file.filename
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)

    df = pd.DataFrame()
    error_message = None
    chart_data = {}

    try:
        if filename.lower().endswith(('.csv')):
            df = pd.read_csv(filepath)
        elif filename.lower().endswith(('.xls', '.xlsx')):
            df = pd.read_excel(filepath)
        else:
            error_message = "Unsupported file type. Please upload an Excel (.xlsx, .xls) or CSV (.csv) file."

        if not error_message:
            # Pass the DataFrame to the new processing function
            chart_data, error_message = process_mpesa_dataframe_and_generate_charts(df)
            
            if not chart_data and not error_message: # If no error but no chart data generated
                error_message = "No valid M-Pesa transactions could be extracted or processed for charts. Check file format and content."

    except Exception as e:
        error_message = f"Error processing file: {e}. Please ensure it's a valid M-Pesa statement format."
    finally:
        if os.path.exists(filepath):
            os.remove(filepath) # Clean up the uploaded file

    if error_message:
        return jsonify({'success': False, 'error': error_message}), 400
    else:
        # Generate a unique ID for this processed chart data set
        processed_file_id = f"chart_data_{pd.Timestamp.now().strftime('%Y%m%d%H%M%S')}_{os.urandom(4).hex()}.json"
        processed_filepath = os.path.join(app.config['PROCESSED_DATA_FOLDER'], processed_file_id)
        
        # Save the generated chart data to a JSON file
        with open(processed_filepath, 'w') as f:
            json.dump(chart_data, f, indent=4)

        return jsonify({
            'success': True, 
            'message': 'File processed and chart data generated successfully!',
            'processed_chart_data_id': processed_file_id, # Send the ID back
        })
    
    return jsonify({'error': 'An unknown error occurred.'}), 500


@app.route('/get-chart-data/<string:file_id>', methods=['GET'])
def get_chart_data(file_id):
    filepath = os.path.join(app.config['PROCESSED_DATA_FOLDER'], file_id)
    if os.path.exists(filepath):
        # Directly serve the JSON file
        return send_from_directory(app.config['PROCESSED_DATA_FOLDER'], file_id, mimetype='application/json')
    else:
        return jsonify({'error': 'Processed chart data not found.'}), 404

# Route for your index.html (dashboard)
@app.route('/')
def index():
    return app.send_static_file('index.html')

# Serve static files (HTML, CSS, JS) from the current directory
@app.route('/<path:filename>')
def static_files(filename):
    # Security check: prevent directory traversal
    if '..' in filename or filename.startswith('/'):
        return "Access Denied", 403
    return send_from_directory('.', filename)

if __name__ == '__main__':
    # pip install Flask pandas openpyxl
    app.run(debug=True) # Set debug=False in production