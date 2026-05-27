(() => {
  const hiddenClass = "is-resource-hidden";

  function normalize(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function setVisible(element, visible) {
    if (!element) return;
    element.hidden = !visible;
    element.classList.toggle(hiddenClass, !visible);
    element.setAttribute("aria-hidden", String(!visible));
  }

  function setupResourceBrowser(root) {
    if (!root || root.dataset.resourceReady === "true") return;
    root.dataset.resourceReady = "true";

    const searchInput = root.querySelector("[data-resource-search]");
    const filterButtons = Array.from(root.querySelectorAll("[data-resource-filter]"));
    const items = Array.from(root.querySelectorAll("[data-resource-item]"));
    const sections = Array.from(root.querySelectorAll("[data-resource-section]"));
    const resultCount = root.querySelector("[data-resource-count]");
    const emptyState = root.querySelector("[data-resource-empty]");
    let activeFilter = "all";

    function applyResourceFilters() {
      const query = normalize(searchInput?.value);
      let visibleCount = 0;

      for (const item of items) {
        const category = item.getAttribute("data-resource-category") || "";
        const matchesCategory = activeFilter === "all" || category === activeFilter;
        const matchesQuery = !query || normalize(item.textContent).includes(query);
        const visible = matchesCategory && matchesQuery;

        setVisible(item, visible);
        if (visible) visibleCount += 1;
      }

      for (const section of sections) {
        const hasVisibleItems = Array.from(section.querySelectorAll("[data-resource-item]")).some((item) => !item.hidden);
        setVisible(section, hasVisibleItems);
      }

      setVisible(emptyState, visibleCount === 0);

      if (resultCount) {
        const total = items.length;
        resultCount.textContent = visibleCount === total
          ? `Showing all ${total} resources.`
          : `Showing ${visibleCount} of ${total} resources.`;
      }
    }

    for (const button of filterButtons) {
      button.addEventListener("click", () => {
        activeFilter = button.getAttribute("data-resource-filter") || "all";

        for (const otherButton of filterButtons) {
          const isActive = otherButton === button;
          otherButton.classList.toggle("is-active", isActive);
          otherButton.setAttribute("aria-pressed", String(isActive));
        }

        applyResourceFilters();
      });
    }

    searchInput?.addEventListener("input", applyResourceFilters);
    applyResourceFilters();
  }

  function initResourceBrowsers() {
    for (const root of document.querySelectorAll("[data-resource-browser]")) {
      setupResourceBrowser(root);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initResourceBrowsers, { once: true });
  } else {
    initResourceBrowsers();
  }

  window.addEventListener("pageshow", initResourceBrowsers);
})();
