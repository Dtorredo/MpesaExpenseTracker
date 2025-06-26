document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileInput');
    const uploadStatus = document.getElementById('uploadStatus');
    const processButton = document.getElementById('processAndGoHome');

    fileInput.addEventListener('change', handleFile);
    processButton.addEventListener('click', () => {
        window.location.href = 'index.html';
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

        if (fileExtension === 'xlsx' || fileExtension === 'xls' || fileExtension === 'csv') {
            uploadStatus.textContent = `Processing "${fileName}"...`;
            uploadStatus.style.color = '#333';
            const reader = new FileReader();

            reader.onload = function(e) {
                const data = new Uint8Array(e.target.result);
                let workbook;
                try {
                    if (fileExtension === 'csv') {
                        const csvText = new TextDecoder('utf-8').decode(data);
                        workbook = XLSX.read(csvText, { type: 'string', raw: true });
                    } else {
                        workbook = XLSX.read(data, { type: 'array', raw: true });
                    }
                } catch (error) {
                    uploadStatus.textContent = 'Error parsing file. Make sure it\'s a valid Excel or CSV.';
                    uploadStatus.style.color = '#d9534f';
                    console.error('File parsing error:', error);
                    processButton.style.display = 'none';
                    return;
                }

                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                // --- ADD THESE DEBUGGING LINES ---
                console.log("--- DEBUGGING MPESA STATEMENT PARSING ---");
                console.log("Raw jsonData from Excel (first few rows):", jsonData.slice(0, 5)); // Log first 5 rows
                console.log("Expected headers from jsonData[0]:", jsonData[0]);
                // --- END DEBUGGING LINES ---

                const processedChartData = processMpesaStatement(jsonData);

                if (processedChartData) {
                    localStorage.setItem('mpesaChartData', JSON.stringify(processedChartData));
                    uploadStatus.textContent = `Successfully processed "${fileName}"! Data ready for dashboard.`;
                    uploadStatus.style.color = '#5cb85c';
                    processButton.style.display = 'block';
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
            uploadStatus.style.color = '#f0ad4e';
            processButton.style.display = 'none';
        }
    }

    function processMpesaStatement(data) {
        if (!data || data.length < 2) {
            console.warn("No data or headers found in the statement.");
            return null;
        }

        let actualHeaderRowIndex = -1;
        for (let i = 0; i < data.length; i++) {
            if (data[i] && data[i].some(cell =>
                String(cell || '').trim().toLowerCase().includes('details') ||
                String(cell || '').trim().toLowerCase().includes('description') ||
                String(cell || '').trim().toLowerCase().includes('date')
            )) {
                actualHeaderRowIndex = i;
                break;
            }
        }

        if (actualHeaderRowIndex === -1) {
            console.error("Could not find a probable header row. Check if 'Details', 'Description', or 'Date' are present in any of the first few rows.");
            return null; // Fail if headers aren't found
        }

        const headers = data[actualHeaderRowIndex].map(h => String(h || '').trim().toLowerCase());
        const rows = data.slice(actualHeaderRowIndex + 1); // Get rows after the header

        console.log("Detected Headers for processing:", headers); // Log the headers being used


        // Find column indices (YOU WILL LIKELY NEED TO ADJUST THESE!)
        // Match these to your exact Mpesa statement headers
        const dateColIdx = headers.findIndex(h => h.includes('date') && !h.includes('time') && !h.includes('transaction id'));
        const timeColIdx = headers.findIndex(h => h.includes('time'));
        const transactionTypeColIdx = headers.findIndex(h => h.includes('transaction type') || h.includes('type') && !h.includes('customer type'));
        const detailsColIdx = headers.findIndex(h => h.includes('details') || h.includes('description') || h.includes('transaction details'));
        const amountColIdx = headers.findIndex(h => (h.includes('amount') && !h.includes('balance') && !h.includes('commission')) || h === 'value'); // 'Value' is sometimes used
        const withdrawnColIdx = headers.findIndex(h => h.includes('withdrawn') || h.includes('debit') || h.includes('out'));
        const depositedColIdx = headers.findIndex(h => h.includes('deposited') || h.includes('credit') || h.includes('in'));
        const balanceColIdx = headers.findIndex(h => h.includes('balance'));


        // Log the indices found (or -1 if not found)
        console.log("Column Indices Found:");
        console.log("  dateColIdx:", dateColIdx);
        console.log("  detailsColIdx:", detailsColIdx);
        console.log("  amountColIdx:", amountColIdx);
        console.log("  withdrawnColIdx:", withdrawnColIdx);
        console.log("  depositedColIdx:", depositedColIdx);


        if (dateColIdx === -1 || detailsColIdx === -1 || (amountColIdx === -1 && withdrawnColIdx === -1 && depositedColIdx === -1)) {
            console.error("Critical columns (Date, Details, and one of Amount/Withdrawn/Deposited) were not found using the configured patterns.");
            // Do NOT return null here yet, let's provide a fallback to the console
            uploadStatus.textContent = "Error: Crucial columns not found. Check Console for details.";
            uploadStatus.style.color = '#d9534f';
            return null; // Return null to indicate processing failure
        }

        let moneyInAggregated = { Deposit: 0, Individual: 0, Business: 0, Mshwari: 0, Other_In: 0 };
        let moneyOutAggregated = { Sent: 0, Buy_goods: 0, Paybill: 0, Pochi: 0, Fuliza: 0, Withdrawal: 0, Other_Out: 0 };
        let monthlySpending = {};
        let dailyTrend = {};
        let topSpendingCategories = {};

        rows.forEach((row, rowIndex) => {
            // Skip empty rows
            if (!row || row.length === 0 || row.every(cell => !cell)) {
                return;
            }

            const dateStr = String(row[dateColIdx] || '').trim();
            const details = String(row[detailsColIdx] || '').trim().toLowerCase();
            const transactionType = String(row[transactionTypeColIdx] || '').trim().toLowerCase(); // May be undefined

            let amount = 0;
            let flowDirection = '';

            // Prioritize separate "Withdrawn" / "Deposited" columns if available
            if (withdrawnColIdx !== -1 && depositedColIdx !== -1) {
                const depositedAmount = parseFloat(String(row[depositedColIdx] || '0').replace(/,/g, '')) || 0;
                const withdrawnAmount = parseFloat(String(row[withdrawnColIdx] || '0').replace(/,/g, '')) || 0;

                if (depositedAmount > 0) {
                    amount = depositedAmount;
                    flowDirection = 'in';
                } else if (withdrawnAmount > 0) {
                    amount = withdrawnAmount;
                    flowDirection = 'out';
                }
            } else if (amountColIdx !== -1) {
                // If only one 'Amount' column, parse and determine flow based on value/keywords
                amount = parseFloat(String(row[amountColIdx] || '0').replace(/,/g, '')) || 0;

                if (amount < 0) { // Negative amount typically means money out
                    amount = Math.abs(amount);
                    flowDirection = 'out';
                } else if (amount > 0) {
                    // Try to infer from details/transaction type for positive amounts
                    if (details.includes('received from') || details.includes('deposit') || transactionType.includes('deposit') || transactionType.includes('received') || details.includes('to m-pesa')) {
                        flowDirection = 'in';
                    } else if (details.includes('sent to') || details.includes('payment to') || details.includes('withdrawal') || details.includes('pay bill') || details.includes('buy goods') || transactionType.includes('withdrawal') || transactionType.includes('sent') || details.includes('till')) {
                        flowDirection = 'out';
                    } else {
                        
                    }
                }
            }


            if (isNaN(amount) || amount <= 0 || flowDirection === '') {
                return; // Skip invalid or unidentifiable transactions
            }

      

            // Money In Categories
            if (flowDirection === 'in') {
                if (details.includes('deposit') || details.includes('from agent')) moneyInAggregated.Deposit += amount;
                else if (details.includes('received from') || details.includes('m-pesa to m-pesa')) moneyInAggregated.Individual += amount;
                else if (details.includes('business') || details.includes('buy goods received') || details.includes('till')) moneyInAggregated.Business += amount; // e.g., 'Lipa na M-Pesa Buy Goods Received'
                else if (details.includes('mshwari')) moneyInAggregated.Mshwari += amount;
                else moneyInAggregated.Other_In += amount;
            }
            // Money Out Categories
            else if (flowDirection === 'out') {
                if (details.includes('sent to') || details.includes('m-pesa to m-pesa')) moneyOutAggregated.Sent += amount;
                else if (details.includes('buy goods') || details.includes('payment to') && (details.includes('till') || details.includes('merchant'))) moneyOutAggregated.Buy_goods += amount;
                else if (details.includes('pay bill')) moneyOutAggregated.Paybill += amount;
                else if (details.includes('pochi')) moneyOutAggregated.Pochi += amount;
                else if (details.includes('fuliza')) moneyOutAggregated.Fuliza += amount;
                else if (details.includes('withdrawal') || details.includes('from agent')) moneyOutAggregated.Withdrawal += amount;
                else moneyOutAggregated.Other_Out += amount;

                // For Monthly Spending and Daily Trend (typically focus on money out/expenses)
                const transactionDate = new Date(dateStr);
                if (!isNaN(transactionDate.getTime())) {
                    const month = transactionDate.toLocaleString('en-US', { month: 'short', year: 'numeric' });
                    monthlySpending[month] = (monthlySpending[month] || 0) + amount;

                    const day = transactionDate.toLocaleString('en-US', { weekday: 'short' });
                    dailyTrend[day] = (dailyTrend[day] || 0) + amount;

                    // Example for Top Categories (Pie Chart) - CUSTOMIZE THESE RULES
                    if (details.includes('food') || details.includes('restaurant') || details.includes('supermarket') || details.includes('grocery')) topSpendingCategories.Food = (topSpendingCategories.Food || 0) + amount;
                    else if (details.includes('fare') || details.includes('bus') || details.includes('matatu') || details.includes('uber') || details.includes('bolt')) topSpendingCategories.Transport = (topSpendingCategories.Transport || 0) + amount;
                    else if (details.includes('kplc') || details.includes('internet') || details.includes('rent') || details.includes('water')) topSpendingCategories.Bills = (topSpendingCategories.Bills || 0) + amount;
                    else if (details.includes('shop') || details.includes('online store') || details.includes('mall')) topSpendingCategories.Shopping = (topSpendingCategories.Shopping || 0) + amount;
                    else if (details.includes('hospital') || details.includes('pharmacy') || details.includes('clinic')) topSpendingCategories.Health = (topSpendingCategories.Health || 0) + amount;
                    else if (details.includes('education') || details.includes('school fees') || details.includes('tuition')) topSpendingCategories.Education = (topSpendingCategories.Education || 0) + amount;
                    else if (details.includes('airtime') || details.includes('data bundle')) topSpendingCategories.AirtimeData = (topSpendingCategories.AirtimeData || 0) + amount;
                    else if (details.includes('entertainment') || details.includes('cinema') || details.includes('sports')) topSpendingCategories.Entertainment = (topSpendingCategories.Entertainment || 0) + amount;
                    else topSpendingCategories.Other = (topSpendingCategories.Other || 0) + amount; // Catch-all for uncategorized spending
                }
            }
        });

        const moneyInLabels = ['Deposit', 'Individual', 'Business', 'Mshwari', 'Other In'];
        const moneyInData = moneyInLabels.map(label => moneyInAggregated[label.replace(/ /g, '_')] || 0);

        const moneyOutLabels = ['Sent', 'Buy goods', 'Paybill', 'Pochi', 'Fuliza', 'Withdrawal', 'Other Out'];
        const moneyOutData = moneyOutLabels.map(label => moneyOutAggregated[label.replace(/ /g, '_')] || 0);

        const sortedMonthlyLabels = Object.keys(monthlySpending).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        const sortedMonthlyData = sortedMonthlyLabels.map(month => monthlySpending[month]);

        const orderedDailyLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const orderedDailyData = orderedDailyLabels.map(day => dailyTrend[day] || 0);

        const totalSpendingCategories = Object.values(topSpendingCategories).reduce((sum, val) => sum + val, 0);
        const categoryLabels = Object.keys(topSpendingCategories);
        const categoryData = Object.values(topSpendingCategories);

        if (moneyInData.every(val => val === 0) && moneyOutData.every(val => val === 0) && sortedMonthlyData.every(val => val === 0)) {
             console.warn("No valid transactions found after parsing. Returning null.");
             uploadStatus.textContent = "No valid transactions extracted. Check file content and parsing logic.";
             uploadStatus.style.color = '#d9534f';
             return null;
        }

        return {
            moneyIn: { labels: moneyInLabels, data: moneyInData },
            moneyOut: { labels: moneyOutLabels, data: moneyOutData },
            monthlySpending: { labels: sortedMonthlyLabels, data: sortedMonthlyData },
            dailyTrend: { labels: orderedDailyLabels, data: orderedDailyData },
            // Ensure category chart handles empty data gracefully
            category: { labels: categoryLabels.length > 0 ? categoryLabels : ['No Data'], data: categoryLabels.length > 0 ? categoryData : [1] }
        };
    }
});