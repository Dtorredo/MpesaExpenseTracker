document.addEventListener('DOMContentLoaded', function () {
    const fileInput = document.getElementById('fileInput');
    const uploadStatus = document.getElementById('uploadStatus');
    const processAndGoHomeBtn = document.getElementById('processAndGoHome');
    const uploadBox = document.querySelector('.upload-box');

    function handleFile(file) {
        if (!file) {
            uploadStatus.textContent = 'No file selected.';
            return;
        }

        uploadStatus.textContent = 'Processing...';
        const formData = new FormData();
        formData.append('file', file);

        fetch('/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                uploadStatus.textContent = `Error: ${data.error}`;
            } else {
                sessionStorage.setItem('mpesaData', JSON.stringify(data));
                uploadStatus.textContent = '✅ Success! Data loaded.';
                processAndGoHomeBtn.classList.remove('d-none');
            }
        })
        .catch(error => {
            console.error('Upload error:', error);
            uploadStatus.textContent = 'An error occurred during upload.';
        });
    }

    fileInput.addEventListener('change', () => {
        handleFile(fileInput.files[0]);
    });

    uploadBox.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadBox.classList.add('border-success');
    });

    uploadBox.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadBox.classList.remove('border-success');
    });

    uploadBox.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadBox.classList.remove('border-success');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            fileInput.files = files;
            handleFile(files[0]);
        }
    });

    processAndGoHomeBtn.addEventListener('click', () => {
        window.location.href = '/';
    });
});