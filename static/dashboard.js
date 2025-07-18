let rawData = null;
let lineChart, barChart, pieChart, polarAreaChart, comparisonChart, typeBreakdownChart;

// Initialize flatpickr
flatpickr("#daterange", {
    mode: "range",
    dateFormat: "Y-m-d"
});

function showChart(type, isCompare) {
    document.querySelectorAll('.chart-container').forEach(div => div.classList.remove('active'));
    if (isCompare) {
        document.getElementById("comparisonChartContainer").classList.add('active');
    } else {
        document.getElementById(`${type}ChartContainer`).classList.add('active');
    }
}

function cumulativeSum(arr) {
    const result = [];
    let accumulator = 0;
    for (let i = 0; i < arr.length; i++) {
        accumulator += arr[i];
        result.push(accumulator);
    }
    return result;
}

function groupData(data, mode) {
    const grouped = {};
    for (let i = 0; i < data.dates.length; i++) {
        const date = new Date(data.dates[i]);
        let key = data.dates[i].split(' ')[0]; // Use date part only
        
        if (mode === "weekly") {
            const firstDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
            key = firstDay.toISOString().split('T')[0];
        } else if (mode === "monthly") {
            key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        }
        
        if (!grouped[key]) {
            grouped[key] = { income: 0, expenses: 0 };
        }
        grouped[key].income += data.income[i] || 0;
        grouped[key].expenses += data.expenses[i] || 0;
    }
    
    const labels = Object.keys(grouped).sort();
    const income = labels.map(label => grouped[label].income);
    const expenses = labels.map(label => grouped[label].expenses);
    return { labels, income, expenses };
}

function filterDataByType(data, selectedTypes) {
    if (!selectedTypes || selectedTypes.length === 0) {
        return { dates: [], income: [], expenses: [], types: [] };
    }

    const filtered = { dates: [], income: [], expenses: [], types: [] };
    
    for (let i = 0; i < data.dates.length; i++) {
        const type = data.types?.[i] || "Other";
        
        if (selectedTypes.includes(type)) {
            filtered.dates.push(data.dates[i]);
            filtered.income.push(data.income[i] || 0);
            filtered.expenses.push(data.expenses[i] || 0);
            filtered.types.push(type);
        }
    }
    
    return filtered;
}

function filterDataByDateRange(data, startDate, endDate) {
    const filtered = { dates: [], income: [], expenses: [], types: [] };
    
    for (let i = 0; i < data.dates.length; i++) {
        const date = data.dates[i].split(' ')[0];
        const inDateRange = !startDate || (date >= startDate && date <= endDate);
        
        if (inDateRange) {
            filtered.dates.push(data.dates[i]);
            filtered.income.push(data.income[i] || 0);
            filtered.expenses.push(data.expenses[i] || 0);
            filtered.types.push(data.types?.[i] || "Other");
        }
    }
    
    return filtered;
}

function destroyCharts() {
    if (lineChart) { lineChart.destroy(); lineChart = null; }
    if (barChart) { barChart.destroy(); barChart = null; }
    if (pieChart) { pieChart.destroy(); pieChart = null; }
    if (polarAreaChart) { polarAreaChart.destroy(); polarAreaChart = null; }
    if (comparisonChart) { comparisonChart.destroy(); comparisonChart = null; }
    if (typeBreakdownChart) { typeBreakdownChart.destroy(); typeBreakdownChart = null; }
}

// Add resize handling
function handleResize() {
    const charts = [lineChart, barChart, pieChart, polarAreaChart, comparisonChart, typeBreakdownChart];
    charts.forEach(chart => {
        if (chart) {
            chart.resize();
        }
    });
}

// Debounced resize handler
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(handleResize, 100);
});

function updateSummaryCards(filteredData) {
    const totalIncome = filteredData.income.reduce((a, b) => a + b, 0);
    const totalExpenses = filteredData.expenses.reduce((a, b) => a + b, 0);
    const netBalance = totalIncome - totalExpenses;

    document.getElementById('totalIncome').textContent = `Ksh ${totalIncome.toFixed(2)}`;
    document.getElementById('totalExpenses').textContent = `Ksh ${totalExpenses.toFixed(2)}`;
    document.getElementById('netBalance').textContent = `Ksh ${netBalance.toFixed(2)}`;
}

function populateTransactionsTable(filteredData) {
    const tableBody = document.getElementById('transactionsTableBody');
    tableBody.innerHTML = ''; // Clear existing data

    // Get last 10 transactions, or fewer if less than 10
    const startIndex = Math.max(0, filteredData.dates.length - 10);
    for (let i = filteredData.dates.length - 1; i >= startIndex; i--) {
        const row = `
            <tr>
                <td>${filteredData.dates[i]}</td>
                <td>${filteredData.types[i]}</td>
                <td>Ksh ${filteredData.income[i].toFixed(2)}</td>
                <td>Ksh ${filteredData.expenses[i].toFixed(2)}</td>
            </tr>
        `;
        tableBody.innerHTML += row;
    }
}

async function loadChart() {
    const response = await fetch('/api/data');
    rawData = await response.json();

    if (!rawData || rawData.dates.length === 0) {
        document.getElementById("noDataNotice").classList.remove("d-none");
        document.getElementById("filterSection").classList.add("d-none");
        document.getElementById("actionButtons").classList.add("d-none");
        return;
    }
    
    document.getElementById("noDataNotice").classList.add("d-none");
    document.getElementById("filterSection").classList.remove("d-none");
    document.getElementById("actionButtons").classList.remove("d-none");

    // Populate checkboxes if not already populated
    const uniqueTypes = [...new Set(rawData.types)].filter(t => t);
    const checkboxesContainer = document.getElementById('categoryCheckboxes');
    if (checkboxesContainer.childElementCount === 0) {
        uniqueTypes.forEach(type => {
            const checkboxWrapper = document.createElement('div');
            checkboxWrapper.classList.add('form-check', 'form-check-inline');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.classList.add('form-check-input');
            checkbox.id = `check-${type.replace(/\s+/g, '-')}`;
            checkbox.value = type;
            checkbox.checked = true;
            const label = document.createElement('label');
            label.classList.add('form-check-label');
            label.htmlFor = checkbox.id;
            label.textContent = type;
            checkboxWrapper.appendChild(checkbox);
            checkboxWrapper.appendChild(label);
            checkboxesContainer.appendChild(checkboxWrapper);
        });

        document.getElementById('btnSelectTypes').addEventListener('click', function() {
        document.getElementById('categoryCheckboxes').classList.toggle('d-none');
        this.classList.toggle('active');
        document.getElementById('btnAllTypes').classList.remove('active');
    });

    document.getElementById('btnAllTypes').addEventListener('click', function() {
        document.getElementById('categoryCheckboxes').classList.add('d-none');
        this.classList.add('active');
        document.getElementById('btnSelectTypes').classList.remove('active');
        document.querySelectorAll('#categoryCheckboxes input[type="checkbox"]').forEach(cb => {
            cb.checked = true;
        });
    });
    }

    const dateRangeValue = document.getElementById("daterange").value;
    const [startDate, endDate] = dateRangeValue.includes(" to ") ? dateRangeValue.split(" to ") : [null, null];
    const aggregation = document.getElementById("aggregation").value;
    const chartType = document.getElementById("chartType").value;
    const isCompare = document.getElementById('btnSelectTypes').classList.contains('active');

    const selectedTxnTypes = [];
    if (document.getElementById('btnAllTypes').classList.contains('active')) {
        const uniqueTypes = [...new Set(rawData.types)].filter(t => t);
        selectedTxnTypes.push(...uniqueTypes);
    } else {
        document.querySelectorAll('#categoryCheckboxes input[type="checkbox"]:checked').forEach(cb => {
            selectedTxnTypes.push(cb.value);
        });
    }

    // Filter data by date range first
    let filteredData = filterDataByDateRange(rawData, startDate, endDate);
    
    // Then filter by transaction type
    filteredData = filterDataByType(filteredData, selectedTxnTypes);

    if (filteredData.dates.length === 0) {
        alert("No data found for the selected filters.");
        destroyCharts();
        updateSummaryCards({ income: [], expenses: [] });
        populateTransactionsTable({ dates: [], types: [], income: [], expenses: [] });
        return;
    }

    updateSummaryCards(filteredData);
    populateTransactionsTable(filteredData);

    const grouped = groupData(filteredData, aggregation);
    const balance = cumulativeSum(grouped.income.map((v, i) => v - grouped.expenses[i]));

    showChart(chartType, isCompare);
    destroyCharts();

    if (isCompare) {
        const datasets = [];
        const comparisonColors = [
            '#e6194B', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990', '#dcbeff', '#9A6324', '#fffac8', '#800000', '#aaffc3', '#808000', '#ffd8b1', '#000075', '#a9a9a9'
        ];
        selectedTxnTypes.forEach((type, index) => {
            const typeData = filterDataByType(filteredData, [type]);
            const groupedTypeData = groupData(typeData, aggregation);
            datasets.push({
                label: `${type} Income`,
                data: groupedTypeData.income,
                backgroundColor: comparisonColors[index % comparisonColors.length],
                borderColor: comparisonColors[index % comparisonColors.length],
                fill: false
            });
        });

        comparisonChart = new Chart(document.getElementById("comparisonChart"), {
            type: (chartType === "pie" || chartType === "polarArea") ? "bar" : chartType,
            data: {
                labels: grouped.labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { 
                    tooltip: { enabled: true }, 
                    legend: { labels: { color: "black" } } 
                },
                scales: { 
                    x: { ticks: { color: 'black' } }, 
                    y: { ticks: { color: 'black' } } 
                }
            }
        });
        return;
    }

    if (chartType === "line") {
        lineChart = new Chart(document.getElementById("lineChart"), {
            type: 'line',
            data: {
                labels: grouped.labels,
                datasets: [
                    { 
                        label: "Income", 
                        data: grouped.income, 
                        borderColor: "#198754", 
                        backgroundColor: "rgba(25, 135, 84, 0.1)", 
                        tension: 0.3 
                    },
                    { 
                        label: "Expenses", 
                        data: grouped.expenses, 
                        borderColor: "#dc3545", 
                        backgroundColor: "rgba(220, 53, 69, 0.1)", 
                        tension: 0.3 
                    },
                    { 
                        label: "Running Balance", 
                        data: balance, 
                        borderColor: "#0d6efd", 
                        backgroundColor: "rgba(13, 110, 253, 0.1)", 
                        tension: 0.3 
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { 
                    tooltip: { enabled: true }, 
                    legend: { labels: { color: "black" } } 
                },
                scales: { 
                    x: { ticks: { color: 'black' } }, 
                    y: { ticks: { color: 'black' } } 
                }
            }
        });
    }

    if (chartType === "bar") {
        barChart = new Chart(document.getElementById("barChart"), {
            type: 'bar',
            data: {
                labels: grouped.labels,
                datasets: [
                    { label: "Income", data: grouped.income, backgroundColor: "#198754" },
                    { label: "Expenses", data: grouped.expenses, backgroundColor: "#dc3545" },
                    { label: "Running Balance", data: balance, backgroundColor: "#0d6efd" }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { 
                    tooltip: { enabled: true }, 
                    legend: { labels: { color: "black" } } 
                },
                scales: { 
                    x: { ticks: { color: 'black' } }, 
                    y: { ticks: { color: 'black' } } 
                }
            }
        });
    }

    if (chartType === "pie") {
        const totalIncome = grouped.income.reduce((a, b) => a + b, 0);
        const totalExpenses = grouped.expenses.reduce((a, b) => a + b, 0);
        const finalBalance = balance[balance.length - 1] || 0;
        
        pieChart = new Chart(document.getElementById("pieChart"), {
            type: 'pie',
            data: {
                labels: ["Income", "Expenses", "Net Balance"],
                datasets: [{
                    data: [totalIncome, totalExpenses, Math.abs(finalBalance)],
                    backgroundColor: ["#198754", "#dc3545", "#0d6efd"]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { 
                    tooltip: { enabled: true }, 
                    legend: { labels: { color: "black" } } 
                }
            }
        });
    }

    if (chartType === "polarArea") {
        const totalIncome = grouped.income.reduce((a, b) => a + b, 0);
        const totalExpenses = grouped.expenses.reduce((a, b) => a + b, 0);
        const finalBalance = balance[balance.length - 1] || 0;
        
        polarAreaChart = new Chart(document.getElementById("polarAreaChart"), {
            type: 'polarArea',
            data: {
                labels: ["Income", "Expenses", "Net Balance"],
                datasets: [{
                    data: [totalIncome, totalExpenses, Math.abs(finalBalance)],
                    backgroundColor: [
                        "rgba(25, 135, 84, 0.7)",
                        "rgba(220, 53, 69, 0.7)",
                        "rgba(13, 110, 253, 0.7)"
                    ],
                    borderColor: ["#198754", "#dc3545", "#0d6efd"],
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { 
                    tooltip: { enabled: true }, 
                    legend: { labels: { color: "black" } } 
                },
                scales: {
                    r: {
                        ticks: { color: 'black' },
                        grid: { color: 'rgba(0, 0, 0, 0.1)' }
                    }
                }
            }
        });
    }
}

function showTypeBreakdown() {
    if (!rawData) return;
    
    const dateRangeValue = document.getElementById("daterange").value;
    const [startDate, endDate] = dateRangeValue.includes(" to ") ? dateRangeValue.split(" to ") : [null, null];

    const typeCounts = {};
    const colorMap = {
        "P2P": "#e6194B",
        "Deposit": "#3cb44b",
        "Pay In": "#ffe119",
        "Airtime": "#4363d8",
        "Send Money": "#f58231",
        "PayBill": "#911eb4",
        "M-Shwari Deposit": "#42d4f4",
        "Charges": "#f032e6",
        "Other": "#bfef45",
        "Withdrawal": "#fabed4",
        "M-Shwari Loan": "#469990",
        "Interest": "#dcbeff",
        "Reversal": "#9A6324",
        "M-Shwari Withdraw": "#fffac8",
        "Auto-Credit": "#800000",
        "Auto-Debit": "#aaffc3",
        "Salary": "#808000",
        "Dividends": "#ffd8b1",
        "Transfer": "#000075",
        "Payment": "#a9a9a9",
        "Business Payment": "#ff7f0e",
        "M-Shwari Lock": "#1f77b4",
        "Data Bundles": "#2ca02c"
    };

    for (let i = 0; i < rawData.dates.length; i++) {
        const date = rawData.dates[i].split(' ')[0];
        const type = rawData.types?.[i] || "Other";
        const inDateRange = !startDate || (date >= startDate && date <= endDate);
        
        if (inDateRange) {
            typeCounts[type] = (typeCounts[type] || 0) + 1;
        }
    }

    const labels = Object.keys(typeCounts);
    const values = labels.map(label => typeCounts[label]);
    const bgColors = labels.map(label => colorMap[label] || "#adb5bd");

    destroyCharts();
    
    document.querySelectorAll('.chart-container').forEach(div => div.classList.remove('active'));
    document.getElementById("typeBreakdownContainer").classList.add("active");

    typeBreakdownChart = new Chart(document.getElementById("typeBreakdownChart"), {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: bgColors
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: { enabled: true },
                legend: { labels: { color: "black" } }
            }
        }
    });
}

// Initialize the dashboard
document.addEventListener('DOMContentLoaded', loadChart);