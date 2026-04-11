(() => {
  const $ = (id) => document.getElementById(id);

  const searchEl = $("bioSearch");
  const domainEl = $("bioDomain");
  const groupEl = $("bioGroup");
  const table = $("bioTable");
  const countEl = $("bioCount");
  const cardsEl = $("bioCards");

  if (!searchEl || !domainEl || !groupEl || !table || !countEl || !cardsEl) return;

  const rows = Array.from(table.querySelectorAll("tbody tr"));

  const norm = (s) => (s || "").toLowerCase().trim();

  const species = rows.map((tr) => {
    const tds = tr.querySelectorAll("td");
    return {
      domain: (tds[0]?.textContent || "").trim(),
      group: (tds[1]?.textContent || "").trim(),
      common: (tds[2]?.textContent || "").trim() || "Unnamed species",
      scientific: (tds[3]?.textContent || "").trim(),
      family: (tds[4]?.textContent || "").trim(),
      status: (tds[5]?.textContent || "").trim(),
      notes: (tds[6]?.textContent || "").trim(),
      hay: norm(tr.textContent),
    };
  });

  function renderCards(items) {
    cardsEl.innerHTML = "";

    if (!items.length) {
      cardsEl.innerHTML = '<p class="muted">No species match your current search or filters.</p>';
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const item of items) {
      const article = document.createElement("article");
      article.className = "bio-card";
      article.innerHTML = `
        <h3>${item.common}</h3>
        <p class="bio-card-scientific"><em>${item.scientific || "Scientific name unavailable"}</em></p>
        <p class="bio-card-meta"><strong>Category:</strong> ${item.group}${item.domain ? ` · <span>${item.domain}</span>` : ""}</p>
        ${item.status ? `<p class="bio-card-meta"><strong>Status:</strong> ${item.status}</p>` : ""}
        ${item.family ? `<p class="bio-card-meta"><strong>Family:</strong> ${item.family}</p>` : ""}
        ${item.notes ? `<p class="bio-card-notes">${item.notes}</p>` : ""}
      `;
      fragment.appendChild(article);
    }

    cardsEl.appendChild(fragment);
  }

  function applyFilters() {
    const q = norm(searchEl.value);
    const domain = norm(domainEl.value);
    const group = norm(groupEl.value);

    const visible = species.filter((item) => {
      const okDomain = !domain || norm(item.domain) === domain;
      const okGroup = !group || norm(item.group) === group;
      const okQuery = !q || item.hay.includes(q);
      return okDomain && okGroup && okQuery;
    });

    countEl.textContent = `Showing ${visible.length} species`;
    renderCards(visible);
  }

  ["input", "change"].forEach((evt) => {
    searchEl.addEventListener(evt, applyFilters);
    domainEl.addEventListener(evt, applyFilters);
    groupEl.addEventListener(evt, applyFilters);
  });

  applyFilters();
})();
