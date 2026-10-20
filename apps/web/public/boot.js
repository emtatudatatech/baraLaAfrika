/*
 * Starts the app on a prerendered page (see apps/web/build/prerender.ts) once that page has
 * painted, so its styles and fonts get the connection first; the app then hydrates the markup.
 * Pages without prerendered markup load the app's module directly.
 */
/* global document, PerformanceObserver, setTimeout */
(function () {
  var script = document.currentScript;
  var entry = script && script.getAttribute('data-entry');
  if (!entry) return;
  var started = false;
  function start() {
    if (started) return;
    started = true;
    import(entry);
  }
  try {
    new PerformanceObserver(function (list, observer) {
      var painted = list.getEntries().some(function (entry) {
        return entry.name === 'first-contentful-paint';
      });
      if (!painted) return;
      observer.disconnect();
      setTimeout(start, 0);
    }).observe({ type: 'paint', buffered: true });
  } catch {
    // No paint timing in this browser: start straight away.
    start();
  }
  // Never wait long: a page that paints nothing contentful still starts.
  setTimeout(start, 3000);
})();
