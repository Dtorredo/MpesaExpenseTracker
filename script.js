
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
    uploadBox.appendChild(loadingMessage);