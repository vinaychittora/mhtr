(() => {
  const $ = (id) => document.getElementById(id);

  const searchEl = $("bioSearch");
  const domainEl = $("bioDomain");
  const groupEl = $("bioGroup");
  const table = $("bioTable");
  const countEl = $("bioCount");

  if (!searchEl || !domainEl || !groupEl || !table || !countEl) return;

  const rows = Array.from(table.querySelectorAll("tbody tr"));

  const norm = (s) => (s || "").toLowerCase().trim();

  function applyFilters() {
    const q = norm(searchEl.value);
    const domain = norm(domainEl.value);
    const group = norm(groupEl.value);

    let visible = 0;

    for (const tr of rows) {
      const tds = tr.querySelectorAll("td");
      if (tds.length < 2) continue;

      const rowDomain = norm(tds[0].textContent);
      const rowGroup = norm(tds[1].textContent);
      const hay = norm(tr.textContent);

      const okDomain = !domain || rowDomain === domain;
      const okGroup = !group || rowGroup === group;
      const okQuery = !q || hay.includes(q);

      const show = okDomain && okGroup && okQuery;
      tr.hidden = !show;
      if (show) visible++;
    }

    countEl.textContent = `${visible} / ${rows.length} shown`;
  }

  ["input", "change"].forEach((evt) => {
    searchEl.addEventListener(evt, applyFilters);
    domainEl.addEventListener(evt, applyFilters);
    groupEl.addEventListener(evt, applyFilters);
  });

  applyFilters();

  
})();
