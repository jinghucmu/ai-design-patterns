// Filter buttons for the pattern list and the product table. The page works without this script.
(function () {
  var bars = document.querySelectorAll("[data-filter]");
  if (!bars.length) return;
  var target = document.querySelector("[data-filter-target]");
  if (!target) return;
  var state = {};
  var empty = document.querySelector(".filter-empty");

  function apply() {
    var items = target.querySelectorAll("[data-question], [data-group]");
    var shown = 0;
    items.forEach(function (item) {
      var ok = Object.keys(state).every(function (key) {
        if (!state[key]) return true;
        return (item.getAttribute("data-" + key) || "").split(" ").indexOf(state[key]) !== -1;
      });
      item.hidden = !ok;
      if (ok) shown++;
    });
    if (empty) empty.hidden = shown !== 0;
  }

  bars.forEach(function (bar) {
    var key = bar.getAttribute("data-filter");
    bar.addEventListener("click", function (event) {
      var button = event.target.closest("button");
      if (!button) return;
      state[key] = button.getAttribute("data-value");
      bar.querySelectorAll("button").forEach(function (b) {
        b.setAttribute("aria-pressed", b === button ? "true" : "false");
      });
      apply();
    });
  });
})();
