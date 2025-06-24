// Optional: Show selected file name or confirmation
document.getElementById('fileInput').addEventListener('change', function () {
  const fileName = this.files[0]?.name;
  if (fileName) {
    alert(`Selected file: ${fileName}`);
  }
});