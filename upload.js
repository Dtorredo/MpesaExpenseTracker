// upload.js
document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileInput');
    const uploadBox = document.querySelector('.upload-box');
    const uploadStatus = document.getElementById('uploadStatus');
    const processAndGoHomeButton = document.getElementById('processAndGoHome');
    const loadingMessage = document.createElement('p'); // Create on the fly if not in HTML
    loadingMessage.id = 'loadingMessage';
    loadingMessage.style.display = 'none';
    loadingMessage.style.color = '#007bff';
    loadingMessage.style.fontStyle = 'italic';
    loadingMessage.style.marginTop = '10px';
    loadingMessage.textContent = 'Processing...';
    uploadBox.appendChild(loadingMessage); // Append to upload-box or other suitable parent

    const errorMessage = document.createElement('p'); // Create on the fly if not in HTML
    errorMessage.id = 'errorMessage';
    errorMessage.style.color = 'red';
    errorMessage.style.marginTop = '10px';
    uploadBox.appendChild(errorMessage); // Append to upload-box or other suitable parent

    // Handle drag and drop functionality
    uploadBox.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadBox.classList.add('drag-over');
    });

    uploadBox.addEventListener('dragleave', () => {
        uploadBox.classList.remove('drag-over');
    });

    uploadBox.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadBox.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            fileInput.files = files; // Assign dropped files to the file input
            handleFileSelection(files[0]);
        }
    });

    // Handle file input change directly
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelection(e.target.files[0]);
        }
    });

    async function handleFileSelection(file) {
        uploadStatus.textContent = `Selected file: ${file.name}`;
        uploadStatus.style.color = '#333';
        processAndGoHomeButton.style.display = 'none'; // Hide button until processing is done
        errorMessage.textContent = ''; // Clear previous errors
        loadingMessage.style.display = 'block';

        const allowedExtensions = ['.csv', '.xls', '.xlsx'];
        const fileExtension = '.' + file.name.split('.').pop().toLowerCase();

        if (!allowedExtensions.includes(fileExtension)) {
            uploadStatus.textContent = 'Error: Unsupported file type. Please upload Excel (.xlsx, .xls) or CSV (.csv) files.';
            uploadStatus.style.color = 'red';
            loadingMessage.style.display = 'none';
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            // Step 1: Upload file and get processed_chart_data_id
            const uploadResponse = await fetch('/upload-mpesa-data', {
                method: 'POST',
                body: formData
            });

            const uploadData = await uploadResponse.json();

            if (uploadData.success) {
                // Step 2: Use the ID to fetch the actual chart data JSON
                const chartDataResponse = await fetch(`/get-chart-data/${uploadData.processed_chart_data_id}`);
                const chartData = await chartDataResponse.json();

                if (chartDataResponse.ok) {
                    // Step 3: Store chart data in localStorage
                    localStorage.setItem('mpesaChartData', JSON.stringify(chartData));
                    uploadStatus.textContent = 'File processed successfully and dashboard data prepared!';
                    uploadStatus.style.color = 'green';
                    processAndGoHomeButton.style.display = 'block'; // Show button
                } else {
                    errorMessage.textContent = `Error fetching chart data: ${chartData.error || 'Unknown error'}`;
                    uploadStatus.style.color = 'red';
                }
            } else {
                errorMessage.textContent = `Processing failed: ${uploadData.error}`;
                uploadStatus.style.color = 'red';
            }
        } catch (error) {
            console.error('Upload error:', error);
            errorMessage.textContent = `An error occurred during upload: ${error.message}`;
            uploadStatus.style.color = 'red';
        } finally {
            loadingMessage.style.display = 'none';
        }
    }

    // Event listener for the "View Dashboard" button
    processAndGoHomeButton.addEventListener('click', () => {
        window.location.href = 'index.html'; // Redirect to your dashboard page
    });
});