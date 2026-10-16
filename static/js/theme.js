// Applies the saved or system colour theme before first paint (avoids a flash).
(function () {
  var theme = null;
  try { theme = localStorage.getItem("rb-theme"); } catch (e) { /* storage unavailable */ }
  if (theme !== "light" && theme !== "dark") {
    theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
