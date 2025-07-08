document.getElementById("fileInput").addEventListener("change", function () {
  const file = this.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);

  const status = document.getElementById("uploadStatus");
  const goBtn = document.getElementById("processAndGoHome");

  status.textContent = "Uploading...";

  fetch("/upload", {
    method: "POST",
    body: formData
  })
  .then(res => res.json())
  .then(data => {
    if (data.error) {
      status.textContent = "❌ " + data.error;
    } else {
      sessionStorage.setItem("mpesaData", JSON.stringify(data));
      status.textContent = "✅ Upload successful!";
      goBtn.style.display = "block";
    }
  })
  .catch(err => {
    console.error(err);
    status.textContent = "❌ Upload failed.";
  });
});

document.getElementById("processAndGoHome").addEventListener("click", function () {
  window.location.href = "/"; // redirect using Flask route, NOT index.html
});
