document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileInput');
    const uploadStatus = document.getElementById('uploadStatus');
    const processButton = document.getElementById('processAndGoHome');

    // Event listener for file selection
    fileInput.addEventListener('change', handleFile);

    // Event listener for the "View Dashboard" button
    processButton.addEventListener('click', () => {
        window.location.href = 'index.html'; // Redirect to the dashboard page
    });

    function handleFile(event) {
        const file = event.target.files[0];
        if (!file) {
            uploadStatus.textContent = 'No file selected.';
            processButton.style.display = 'none';
            return;
        }

        const fileName = file.name;
        const fileExtension = fileName.split('.').pop().toLowerCase();

        // Check for supported file types
        if (fileExtension === 'xlsx' || fileExtension === 'xls' || fileExtension === 'csv') {
            uploadStatus.textContent = `Processing "${fileName}"...`;
            uploadStatus.style.color = '#333';
            const reader = new FileReader();

            reader.onload = function(e) {
                const data = new Uint8Array(e.target.result);
                let workbook;
                try {
                    if (fileExtension === 'csv') {
                        // For CSV, decode as string and parse
                        const csvText = new TextDecoder('utf-8').decode(data);
                        workbook = XLSX.read(csvText, { type: 'string', raw: true });
                    } else {
                        // For Excel, read as array buffer
                        workbook = XLSX.read(data, { type: 'array', raw: true });
                    }
                } catch (error) {
                    uploadStatus.textContent = 'Error parsing file. Make sure it\'s a valid Excel or CSV.';
                    uploadStatus.style.color = '#d9534f'; // Red color for error
                    console.error('File parsing error:', error);
                    processButton.style.display = 'none';
                    return;
                }

                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                // Convert sheet to array of arrays. header: 1 means first row is not treated as header, just data.
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                // --- CORE LOGIC: Mpesa Statement Parsing and Aggregation ---
                const processedChartData = processMpesaStatement(jsonData);

                if (processedChartData) {
                    // Store the processed data in localStorage
                    localStorage.setItem('mpesaChartData', JSON.stringify(processedChartData));
                    uploadStatus.textContent = `Successfully processed "${fileName}"! Data ready for dashboard.`;
                    uploadStatus.style.color = '#5cb85c'; // Green color for success
                    processButton.style.display = 'block'; // Show button to go to dashboard
                } else {
                    uploadStatus.textContent = `Could not extract data from "${fileName}". Please check the statement format.`;
                    uploadStatus.style.color = '#d9534f';
                    processButton.style.display = 'none';
                }
            };

            reader.onerror = function(error) {
                uploadStatus.textContent = 'Error reading file.';
                uploadStatus.style.color = '#d9534f';
                console.error('FileReader error:', error);
                processButton.style.display = 'none';
            };

            reader.readAsArrayBuffer(file);
        } else {
            uploadStatus.textContent = 'Unsupported file type. Please upload an Excel (.xlsx, .xls) or CSV file.';
            uploadStatus.style.color = '#f0ad4e'; // Yellow/orange for warning
            processButton.style.display = 'none';
        }
    }

    /**
     * This function parses the Mpesa statement data (array of arrays)
     * and aggregates it for your charts.
     * YOU WILL NEED TO CUSTOMIZE THIS FUNCTION HEAVILY based on your statement's exact format.
     *
     * @param {Array<Array<any>>} data - The raw data from the Excel/CSV sheet.
     * @returns {Object|null} - An object with chart-ready data, or null if parsing fails.
     */
    function processMpesaStatement(data) {
        if (!data || data.length < 2) {
            console.warn("No data or headers found in the statement.");
            return null; // Return null if there's not enough data
        }

        // Assume the first row contains headers. Trim whitespace and normalize case.
        const headers = data[0].map(h => String(h || '').trim().toLowerCase());
        const rows = data.slice(1); // All subsequent rows are data

        // --- Step 1: Identify Column Indices ---
        // You MUST verify these column names against your actual Mpesa statement.
        // Common column names:
        const dateColIdx = headers.findIndex(h => h.includes('date') && !h.includes('time')); // "Completion Date" or "Date"
        const timeColIdx = headers.findIndex(h => h.includes('time'));
        const transactionTypeColIdx = headers.findIndex(h => h.includes('transaction type') || h.includes('type'));
        const detailsColIdx = headers.findIndex(h => h.includes('details') || h.includes('description') || h.includes('transaction details')); // "Details" or "Description"
        const amountColIdx = headers.findIndex(h => h.includes('amount') && !h.includes('balance')); // "Amount"
        const balanceColIdx = headers.findIndex(h => h.includes('balance'));
        const withdrawnColIdx = headers.findIndex(h => h.includes('withdrawn') || h.includes('debit')); // If separate debit/credit columns exist
        const depositedColIdx = headers.findIndex(h => h.includes('deposited') || h.includes('credit')); // If separate debit/credit columns exist


        if (dateColIdx === -1 || detailsColIdx === -1 || (amountColIdx === -1 && (withdrawnColIdx === -1 || depositedColIdx === -1))) {
            console.error("Missing critical columns (Date, Details, and either Amount or (Withdrawn/Deposited)).");
            console.error("Headers found:", headers);
            uploadStatus.textContent = "Error: Missing required columns in statement (e.g., 'Date', 'Details', 'Amount').";
            uploadStatus.style.color = '#d9534f';
            return null; // Indicate failure
        }

        // Initialize aggregation objects
        let moneyInAggregated = { Deposit: 0, Individual: 0, Business: 0, Mshwari: 0, Other_In: 0 };
        let moneyOutAggregated = { Sent: 0, Buy_goods: 0, Paybill: 0, Pochi: 0, Fuliza: 0, Withdrawal: 0, Other_Out: 0 };
        let monthlySpending = {}; // Key: 'Jan', 'Feb', etc., Value: total spent
        let dailyTrend = {};      // Key: 'Mon', 'Tue', etc., Value: total spent
        let topSpendingCategories = {}; // For the Pie chart (e.g., Food, Transport, Bills)

        rows.forEach(row => {
            const dateStr = String(row[dateColIdx] || '').trim();
            const details = String(row[detailsColIdx] || '').trim().toLowerCase();
            const transactionType = String(row[transactionTypeColIdx] || '').trim().toLowerCase();

            let amount = 0;
            let flowDirection = ''; // 'in' or 'out'

            // --- Step 2: Extract Amount and Determine Flow Direction ---
            // Prioritize separate "Withdrawn" / "Deposited" columns if available
            if (withdrawnColIdx !== -1 && depositedColIdx !== -1) {
                const depositedAmount = parseFloat(String(row[depositedColIdx]).replace(/,/g, '')) || 0;
                const withdrawnAmount = parseFloat(String(row[withdrawnColIdx]).replace(/,/g, '')) || 0;

                if (depositedAmount > 0) {
                    amount = depositedAmount;
                    flowDirection = 'in';
                } else if (withdrawnAmount > 0) {
                    amount = withdrawnAmount;
                    flowDirection = 'out';
                }
            } else if (amountColIdx !== -1) {
                // If only one 'Amount' column, use keywords or context
                amount = parseFloat(String(row[amountColIdx]).replace(/,/g, '')) || 0;

                // Heuristic based on keywords (less reliable than dedicated columns)
                if (details.includes('received from') || details.includes('deposit') || transactionType.includes('deposit') || transactionType.includes('received') || details.includes('to m-pesa')) {
                    flowDirection = 'in';
                } else if (details.includes('sent to') || details.includes('payment to') || details.includes('withdrawal') || details.includes('pay bill') || details.includes('buy goods') || transactionType.includes('withdrawal') || transactionType.includes('sent')) {
                    flowDirection = 'out';
                }
                // Important: Some statements have negative amounts for withdrawals. Check if amount is negative.
                if (amount < 0 && flowDirection === '') { // If not determined yet and amount is negative
                    amount = Math.abs(amount); // Use absolute value
                    flowDirection = 'out';
                }
            }

            if (isNaN(amount) || amount <= 0 || flowDirection === '') return; // Skip invalid or unidentifiable transactions


            // --- Step 3: Categorize and Aggregate ---

            // Money In Categories
            if (flowDirection === 'in') {
                if (details.includes('deposit') || details.includes('from agent')) moneyInAggregated.Deposit += amount;
                else if (details.includes('received from') || details.includes('m-pesa to m-pesa')) moneyInAggregated.Individual += amount;
                else if (details.includes('business')) moneyInAggregated.Business += amount; // e.g., 'Lipa na M-Pesa Buy Goods Received'
                else if (details.includes('mshwari')) moneyInAggregated.Mshwari += amount;
                else moneyInAggregated.Other_In += amount; // Catch anything not explicitly categorized
            }
            // Money Out Categories
            else if (flowDirection === 'out') {
                if (details.includes('sent to') || details.includes('m-pesa to m-pesa')) moneyOutAggregated.Sent += amount;
                else if (details.includes('buy goods')) moneyOutAggregated.Buy_goods += amount;
                else if (details.includes('pay bill')) moneyOutAggregated.Paybill += amount;
                else if (details.includes('pochi')) moneyOutAggregated.Pochi += amount;
                else if (details.includes('fuliza')) moneyOutAggregated.Fuliza += amount;
                else if (details.includes('withdrawal')) moneyOutAggregated.Withdrawal += amount;
                else moneyOutAggregated.Other_Out += amount; // Catch anything not explicitly categorized

                // Also aggregate for Monthly Spending and Daily Trend (these usually focus on money out/expenses)
                const transactionDate = new Date(dateStr); // Try parsing date
                if (!isNaN(transactionDate.getTime())) { // Check if date is valid
                    // Monthly Spending
                    const month = transactionDate.toLocaleString('en-US', { month: 'short', year: 'numeric' }); // Include year for uniqueness
                    monthlySpending[month] = (monthlySpending[month] || 0) + amount;

                    // Daily Trend (Day of Week)
                    const day = transactionDate.toLocaleString('en-US', { weekday: 'short' });
                    dailyTrend[day] = (dailyTrend[day] || 0) + amount;

                    // Example for Top Categories (Pie Chart) - this is highly subjective based on what you consider a 'category'
                    // You might need more sophisticated keyword matching for categories like 'Food', 'Transport', etc.
                    if (details.includes('supermarket')) topSpendingCategories.Food = (topSpendingCategories.Food || 0) + amount;
                    else if (details.includes('fare') || details.includes('bus') || details.includes('uber')) topSpendingCategories.Transport = (topSpendingCategories.Transport || 0) + amount;
                    else if (details.includes('kplc') || details.includes('internet') || details.includes('rent')) topSpendingCategories.Bills = (topSpendingCategories.Bills || 0) + amount;
                    else if (details.includes('shop') || details.includes('online')) topSpendingCategories.Shopping = (topSpendingCategories.Shopping || 0) + amount;
                    else if (details.includes('hospital') || details.includes('pharmacy')) topSpendingCategories.Health = (topSpendingCategories.Health || 0) + amount;
                    // Add more category rules as needed
                }
            }
        });

        // --- Step 4: Format Data for Charts ---

        // Prepare labels and data ensuring all original categories are present (even if 0)
        const moneyInLabels = ['Deposit', 'Individual', 'Business', 'Mshwari', 'Other In'];
        const moneyInData = moneyInLabels.map(label => moneyInAggregated[label.replace(' ', '_')] || 0); // Replace spaces for object keys

        const moneyOutLabels = ['Sent', 'Buy goods', 'Paybill', 'Pochi', 'Fuliza', 'Withdrawal', 'Other Out'];
        const moneyOutData = moneyOutLabels.map(label => moneyOutAggregated[label.replace(' ', '_')] || 0);

        // Sort monthly spending by date
        const sortedMonthlyLabels = Object.keys(monthlySpending).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        const sortedMonthlyData = sortedMonthlyLabels.map(month => monthlySpending[month]);

        // Ensure daily trend always shows all days of the week in order
        const orderedDailyLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const orderedDailyData = orderedDailyLabels.map(day => dailyTrend[day] || 0);

        // For top categories, filter out 0 values if desired, or keep them.
        const topCategoryLabels = Object.keys(topSpendingCategories);
        const topCategoryData = Object.values(topSpendingCategories);

        // If no data was extracted, return null to signal failure
        if (moneyInData.every(val => val === 0) && moneyOutData.every(val => val === 0)) {
             console.warn("No valid transactions found after parsing. Returning null.");
             return null;
        }

        return {
            moneyIn: { labels: moneyInLabels, data: moneyInData },
            moneyOut: { labels: moneyOutLabels, data: moneyOutData },
            monthlySpending: { labels: sortedMonthlyLabels, data: sortedMonthlyData },
            dailyTrend: { labels: orderedDailyLabels, data: orderedDailyData },
            category: { labels: topCategoryLabels.length > 0 ? topCategoryLabels : ['No Data'], data: topCategoryLabels.length > 0 ? topCategoryData : [1] } // Provide dummy data if no categories found for pie
        };
    }

    // You can keep a fallback sample data function for development if needed.
    // function getSampleChartData() { /* ... your sample data ... */ }
});