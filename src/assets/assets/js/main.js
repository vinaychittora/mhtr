(() => {
  const header = document.querySelector(".site-header");
  const menuButton = document.querySelector(".menu-button");
  const menu = document.getElementById("primary-menu");

  if (!header || !menuButton || !menu) return;

  function setMenu(open) {
    header.classList.toggle("is-menu-open", open);
    document.documentElement.classList.toggle("has-nav-drawer", open);
    menuButton.setAttribute("aria-expanded", String(open));
    if (!open) {
      for (const item of header.querySelectorAll(".has-dropdown")) {
        item.classList.remove("is-open");
        item.querySelector(".nav-toggle")?.setAttribute("aria-expanded", "false");
        item.querySelector(".nav-parent .nav-link")?.setAttribute("aria-expanded", "false");
        item.querySelector(".dropdown-menu")?.setAttribute("aria-hidden", "true");
      }
    }
  }

  menuButton.addEventListener("click", () => {
    setMenu(!header.classList.contains("is-menu-open"));
  });

  menu.addEventListener("click", (event) => {
    if (event.target.closest("a")) setMenu(false);
  });

  header.addEventListener("click", (event) => {
    if (event.target.closest("[data-menu-close]")) setMenu(false);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".site-header")) setMenu(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenu(false);
  });
})();

// Responsive tables: label every cell with its column header, then stack rows as cards
// on phones (every table) and on tablets (tables with five or more columns). The
// stylesheet prints td[data-label]::before and styles .is-stacked.
(() => {
  const tables = [];
  for (const table of document.querySelectorAll("table.table")) {
    const headers = Array.from(table.querySelectorAll("thead th"), (th) => th.textContent.trim());
    if (!headers.length) continue;
    for (const row of table.querySelectorAll("tbody tr")) {
      let column = 0;
      for (const cell of row.children) {
        const span = Number(cell.getAttribute("colspan")) || 1;
        if (cell.tagName === "TD" && !cell.dataset.label) {
          cell.dataset.label = span > 1 ? headers.slice(column, column + span).join(" / ") : headers[column] || "";
        }
        column += span;
      }
    }
    tables.push({ table, wrap: table.closest(".table-wrap"), wide: headers.length >= 5 });
  }
  if (!tables.length) return;

  const phone = window.matchMedia("(max-width: 620px)");
  const tablet = window.matchMedia("(max-width: 980px)");
  function apply() {
    for (const { table, wrap, wide } of tables) {
      const stacked = phone.matches || (wide && tablet.matches);
      table.classList.toggle("is-stacked", stacked);
      wrap?.classList.toggle("is-stacked", stacked);
    }
  }
  apply();
  phone.addEventListener("change", apply);
  tablet.addEventListener("change", apply);
})();

(() => {
  const rail = document.querySelector("[data-support-rail]");
  if (!rail) return;

  const toggle = rail.querySelector("[data-support-rail-toggle]");
  const panel = rail.querySelector("#supportRailPanel");
  const closeButtons = Array.from(rail.querySelectorAll("[data-support-rail-close]"));
  const donateLink = rail.querySelector("[data-support-rail-donate]");
  let isOpen = false;

  if (!toggle || !panel) return;

  try {
    window.localStorage?.removeItem("mhtrSupportRailHiddenUntil");
  } catch (error) {
    // Storage may be blocked in some browser privacy modes.
  }

  function closePanel() {
    try {
      panel.hidden = true;
      rail.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      isOpen = false;
    } catch (error) {
      // Keep the persistent tab available even if the panel cannot be updated.
    }
  }

  function openPanel() {
    panel.hidden = false;
    rail.classList.add("is-open");
    toggle.setAttribute("aria-expanded", "true");
    isOpen = true;
  }

  function togglePanel() {
    if (isOpen) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function onKeydown(event) {
    if (event.key === "Escape" && isOpen) {
      closePanel();
      toggle.focus({ preventScroll: true });
    }
  }

  toggle.addEventListener("click", togglePanel);
  closeButtons.forEach((button) => button.addEventListener("click", closePanel));
  donateLink?.addEventListener("click", closePanel);
  document.addEventListener("keydown", onKeydown);
})();

(() => {
  const triggers = Array.from(document.querySelectorAll("[data-map-viewer], [data-image-viewer]"));
  if (!triggers.length) return;

  const modal = document.createElement("div");
  modal.className = "map-viewer-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="map-viewer-backdrop" data-map-close></div>
    <section class="map-viewer-panel" role="dialog" aria-modal="true" aria-labelledby="mapViewerTitle">
      <header class="map-viewer-header">
        <div>
          <p class="eyebrow" data-viewer-eyebrow>Zoom Viewer</p>
          <h2 id="mapViewerTitle">Map</h2>
        </div>
        <button class="map-viewer-close" type="button" data-map-close aria-label="Close map viewer">×</button>
      </header>
      <div class="map-viewer-toolbar" aria-label="Map zoom controls">
        <button type="button" data-map-zoom="out">-</button>
        <button type="button" data-map-zoom="reset">100%</button>
        <button type="button" data-map-zoom="in">+</button>
        <button type="button" data-map-fullscreen>Fullscreen</button>
      </div>
      <div class="map-viewer-stage" tabindex="0" aria-label="Scrollable map area">
        <img class="map-viewer-image" alt="">
      </div>
    </section>
  `;
  document.body.appendChild(modal);

  const title = modal.querySelector("#mapViewerTitle");
  const eyebrow = modal.querySelector("[data-viewer-eyebrow]");
  const panel = modal.querySelector(".map-viewer-panel");
  const stage = modal.querySelector(".map-viewer-stage");
  const image = modal.querySelector(".map-viewer-image");
  const closeButton = modal.querySelector(".map-viewer-close");
  const resetButton = modal.querySelector("[data-map-zoom='reset']");
  const fullscreenButton = modal.querySelector("[data-map-fullscreen]");
  let activeTrigger = null;
  let imageMode = false;
  let scale = 1;
  let dragging = false;
  let dragStart = { x: 0, y: 0, left: 0, top: 0 };

  function setScale(nextScale, anchorX, anchorY) {
    const oldScale = scale;
    scale = Math.min(4, Math.max(0.65, nextScale));

    const rect = stage.getBoundingClientRect();
    const localX = anchorX == null ? rect.width / 2 : anchorX - rect.left;
    const localY = anchorY == null ? rect.height / 2 : anchorY - rect.top;
    const ratio = scale / oldScale;
    const oldLeft = stage.scrollLeft;
    const oldTop = stage.scrollTop;

    image.style.width = `${scale * 100}%`;
    resetButton.textContent = `${Math.round(scale * 100)}%`;

    requestAnimationFrame(() => {
      stage.scrollLeft = (oldLeft + localX) * ratio - localX;
      stage.scrollTop = (oldTop + localY) * ratio - localY;
    });
  }

  function openViewer(trigger) {
    activeTrigger = trigger;
    imageMode = trigger.hasAttribute("data-image-viewer");
    const hindi = document.documentElement.lang === "hi";
    const imageTitle = hindi
      ? trigger.dataset.imageTitleHi || trigger.dataset.imageTitleEn
      : trigger.dataset.imageTitleEn || trigger.dataset.imageTitleHi;

    modal.classList.toggle("is-image-viewer", imageMode);
    title.textContent = imageMode ? imageTitle || "Image" : trigger.dataset.mapTitle || "GIS map";
    eyebrow.textContent = imageMode ? (hindi ? "तस्वीर बड़ी करके देखें" : "Image viewer") : "Zoom Viewer";
    image.src = imageMode
      ? trigger.dataset.imageSrc || trigger.querySelector("img")?.src || ""
      : trigger.dataset.mapSrc || trigger.querySelector("img")?.src || "";
    image.alt = trigger.dataset.imageAlt || trigger.dataset.mapAlt || trigger.querySelector("img")?.alt || "";
    closeButton.setAttribute("aria-label", imageMode ? (hindi ? "तस्वीर बंद करें" : "Close image viewer") : "Close map viewer");
    stage.setAttribute("aria-label", imageMode ? (hindi ? "बड़ी तस्वीर" : "Enlarged image") : "Scrollable map area");
    modal.hidden = false;
    document.documentElement.classList.add("has-modal");
    setScale(1);
    requestAnimationFrame(() => {
      stage.scrollLeft = 0;
      stage.scrollTop = 0;
      (imageMode ? closeButton : stage).focus({ preventScroll: true });
    });
  }

  function closeViewer() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    modal.hidden = true;
    document.documentElement.classList.remove("has-modal");
    scale = 1;
    imageMode = false;
    modal.classList.remove("is-image-viewer");
    image.removeAttribute("src");
    activeTrigger?.focus({ preventScroll: true });
    activeTrigger = null;
  }

  for (const trigger of triggers) {
    trigger.addEventListener("click", () => openViewer(trigger));
  }

  modal.addEventListener("click", (event) => {
    if (event.target.closest("[data-map-close]")) {
      closeViewer();
      return;
    }

    const zoomButton = event.target.closest("[data-map-zoom]");
    if (!zoomButton || imageMode) return;

    const action = zoomButton.dataset.mapZoom;
    if (action === "in") setScale(scale * 1.25);
    if (action === "out") setScale(scale / 1.25);
    if (action === "reset") setScale(1);
  });

  fullscreenButton.addEventListener("click", () => {
    if (imageMode) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      panel.requestFullscreen?.();
    }
  });

  stage.addEventListener("wheel", (event) => {
    if (imageMode) return;
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? 0.9 : 1.1;
    setScale(scale * direction, event.clientX, event.clientY);
  }, { passive: false });

  stage.addEventListener("pointerdown", (event) => {
    if (imageMode) return;
    if (event.button !== 0) return;
    dragging = true;
    stage.setPointerCapture(event.pointerId);
    dragStart = {
      x: event.clientX,
      y: event.clientY,
      left: stage.scrollLeft,
      top: stage.scrollTop,
    };
    stage.classList.add("is-dragging");
  });

  stage.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    stage.scrollLeft = dragStart.left - (event.clientX - dragStart.x);
    stage.scrollTop = dragStart.top - (event.clientY - dragStart.y);
  });

  stage.addEventListener("pointerup", () => {
    dragging = false;
    stage.classList.remove("is-dragging");
  });

  stage.addEventListener("pointercancel", () => {
    dragging = false;
    stage.classList.remove("is-dragging");
  });

  document.addEventListener("keydown", (event) => {
    if (modal.hidden) return;
    if (event.key === "Escape") {
      closeViewer();
      return;
    }

    if (event.key === "Tab") {
      const focusable = Array.from(panel.querySelectorAll("button:not([hidden]), [href], [tabindex]:not([tabindex='-1'])"))
        .filter((element) => element.getClientRects().length);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (first && last) {
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      return;
    }

    if (imageMode) return;
    if (event.key === "+" || event.key === "=") setScale(scale * 1.25);
    if (event.key === "-") setScale(scale / 1.25);
    if (event.key === "0") setScale(1);
  });
})();

(() => {
  const dropdowns = Array.from(document.querySelectorAll(".has-dropdown"), (item) => ({
    item,
    toggle: item.querySelector(".nav-toggle"),
    trigger: item.querySelector(".nav-parent .nav-link"),
    menu: item.querySelector(".dropdown-menu"),
  })).filter(({ toggle, trigger, menu }) => toggle && trigger && menu);

  if (!dropdowns.length) return;

  let openDropdown = dropdowns.find(({ item }) => item.classList.contains("is-open")) || null;

  function setOpen(dropdown, open) {
    const { item, toggle, trigger, menu } = dropdown;
    if (item.classList.contains("is-open") === open) {
      if (!open && openDropdown === dropdown) openDropdown = null;
      return;
    }

    item.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    trigger.setAttribute("aria-expanded", String(open));
    menu.setAttribute("aria-hidden", String(!open));
    openDropdown = open ? dropdown : openDropdown === dropdown ? null : openDropdown;
  }

  function closeAll(except) {
    if (openDropdown && openDropdown !== except) setOpen(openDropdown, false);
  }

  for (const dropdown of dropdowns) {
    const { item, toggle, trigger } = dropdown;
    function toggleItem(event) {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = !item.classList.contains("is-open");
      closeAll(dropdown);
      setOpen(dropdown, isOpen);
    }

    toggle.addEventListener("click", toggleItem);
    trigger.addEventListener("click", toggleItem);
  }

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".has-dropdown")) closeAll();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });
})();

(() => {
  const buttons = Array.from(document.querySelectorAll("[data-lang-target]"));
  const panels = Array.from(document.querySelectorAll("[data-lang-panel]"));

  if (!buttons.length || !panels.length) return;

  function setLanguage(lang) {
    for (const panel of panels) {
      panel.hidden = panel.dataset.langPanel !== lang;
    }

    for (const button of buttons) {
      const isActive = button.dataset.langTarget === lang;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    }
  }

  for (const button of buttons) {
    button.addEventListener("click", () => setLanguage(button.dataset.langTarget));
  }
})();

(() => {
  const popovers = Array.from(document.querySelectorAll(".bio-help-popover"));

  if (!popovers.length) return;

  function closeAll(except) {
    for (const popover of popovers) {
      if (popover === except) continue;
      popover.removeAttribute("open");
      popover.querySelector("summary")?.setAttribute("aria-expanded", "false");
    }
  }

  function isInsidePopover(event) {
    return event.target instanceof Element && Boolean(event.target.closest(".bio-help-popover"));
  }

  for (const popover of popovers) {
    const summary = popover.querySelector("summary");
    summary?.setAttribute("aria-expanded", String(popover.open));
    summary?.addEventListener("click", () => {
      window.setTimeout(() => {
        summary.setAttribute("aria-expanded", String(popover.open));
        if (popover.open) closeAll(popover);
      }, 0);
    });

    popover.addEventListener("toggle", () => {
      summary?.setAttribute("aria-expanded", String(popover.open));
      if (popover.open) closeAll(popover);
    });
  }

  document.addEventListener("pointerdown", (event) => {
    if (!isInsidePopover(event)) closeAll();
  });

  document.addEventListener("click", (event) => {
    if (!isInsidePopover(event)) closeAll();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });
})();

(() => {
  const charts = Array.from(document.querySelectorAll("[data-pie-chart]"));
  if (!charts.length) return;

  const clean = (value) => (value || "").trim();
  const escapeText = (value) => clean(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
  const splitData = (value) => clean(value).split("|").map(clean).filter(Boolean);
  const point = (angle, radius) => ({
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  });

  for (const chart of charts) {
    const labels = splitData(chart.dataset.labels);
    const colors = splitData(chart.dataset.colors);
    const values = splitData(chart.dataset.values).map(Number);
    const total = values.reduce((sum, value) => sum + value, 0);
    const title = clean(chart.dataset.chartTitle);
    const subtitle = clean(chart.dataset.chartSubtitle);

    if (!labels.length || labels.length !== values.length || !total) continue;

    let startAngle = -Math.PI / 2;
    const slices = values.map((value, index) => {
      const angle = (value / total) * Math.PI * 2;
      const endAngle = startAngle + angle;
      const midAngle = startAngle + angle / 2;
      const slice = { value, index, startAngle, endAngle, midAngle, label: labels[index], color: colors[index] || "#888" };
      startAngle = endAngle;
      return slice;
    });

    const paths = slices.map((slice) => {
      const start = point(slice.startAngle, 128);
      const end = point(slice.endAngle, 128);
      const largeArc = slice.endAngle - slice.startAngle > Math.PI ? 1 : 0;
      return `<path d="M 0 0 L ${start.x.toFixed(3)} ${start.y.toFixed(3)} A 128 128 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)} Z" fill="${escapeText(slice.color)}"></path>`;
    }).join("");

    const percentageLabels = slices.map((slice) => {
      const pos = point(slice.midAngle, 68);
      const pct = `${((slice.value / total) * 100).toFixed(1)}%`;
      return `<text x="${pos.x.toFixed(2)}" y="${pos.y.toFixed(2)}" text-anchor="middle" dominant-baseline="middle" class="chart-percent">${pct}</text>`;
    }).join("");

    const leaderLabels = slices.map((slice) => {
      const outer = point(slice.midAngle, 139);
      const label = point(slice.midAngle, 178);
      const anchor = label.x < 0 ? "end" : "start";
      const labelX = label.x + (label.x < 0 ? -8 : 8);
      return `
        <line x1="${outer.x.toFixed(2)}" y1="${outer.y.toFixed(2)}" x2="${label.x.toFixed(2)}" y2="${label.y.toFixed(2)}" class="chart-leader"></line>
        <text x="${labelX.toFixed(2)}" y="${label.y.toFixed(2)}" text-anchor="${anchor}" dominant-baseline="middle" class="chart-label">${escapeText(slice.label)}</text>
      `;
    }).join("");

    const legend = slices.map((slice) => {
      const pct = ((slice.value / total) * 100).toFixed(1);
      return `
        <li>
          <span class="chart-swatch" style="background:${escapeText(slice.color)}"></span>
          <span>${escapeText(slice.label)}</span>
          <strong>${slice.value} (${pct}%)</strong>
        </li>
      `;
    }).join("");

    chart.innerHTML = `
      <svg class="pie-chart-svg" viewBox="-305 -225 660 440" role="img" aria-label="${escapeText(title || "Pie chart")}">
        ${title ? `<text x="15" y="-197" text-anchor="middle" class="chart-title">${escapeText(title)}</text>` : ""}
        ${subtitle ? `<text x="15" y="-177" text-anchor="middle" class="chart-subtitle">${escapeText(subtitle)}</text>` : ""}
        <g transform="translate(0, 14)">
          ${paths}
          ${percentageLabels}
          ${leaderLabels}
        </g>
      </svg>
      <ul class="chart-legend">${legend}</ul>
    `;
  }
})();

(() => {
  const $ = (id) => document.getElementById(id);

  const languageButtons = Array.from(document.querySelectorAll("[data-language-button]"));
  const languagePanels = Array.from(document.querySelectorAll("[data-language-panel]"));
  const imageViewerButtons = Array.from(document.querySelectorAll("[data-image-viewer]"));
  const languageStatus = $("proposalLanguageStatus");

  if (languageButtons.length && languagePanels.length) {
    const setLanguage = (language) => {
      languagePanels.forEach((panel) => {
        panel.hidden = panel.dataset.languagePanel !== language;
      });

      languageButtons.forEach((button) => {
        const active = button.dataset.languageButton === language;
        button.setAttribute("aria-pressed", String(active));
      });

      document.documentElement.lang = language === "hi" ? "hi" : "en";
      imageViewerButtons.forEach((button) => {
        const imageTitle = language === "hi"
          ? button.dataset.imageTitleHi || button.dataset.imageTitleEn
          : button.dataset.imageTitleEn || button.dataset.imageTitleHi;
        button.setAttribute(
          "aria-label",
          language === "hi" ? `चित्र बड़ा करके देखें: ${imageTitle}` : `View ${imageTitle} image`,
        );
      });
      if (languageStatus) {
        languageStatus.textContent = language === "hi" ? "हिंदी संस्करण दिखाया गया है।" : "English version is shown.";
      }
    };

    languageButtons.forEach((button) => {
      button.addEventListener("click", () => setLanguage(button.dataset.languageButton));
    });

    setLanguage("en");
  }

  document.querySelectorAll("[data-proposal-inquiry]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const response = form.querySelector(".form-response");
      if (!response) return;
      response.textContent = form.dataset.formLanguage === "hi"
        ? "पूर्वावलोकन पूरा हुआ। यह बीटा फॉर्म है—आपकी जानकारी भेजी या संग्रहीत नहीं की गई।"
        : "Preview complete. This is a beta form—your information was not sent or stored.";
      response.focus?.();
    });
  });

  // ---------------------------------------------------------------------------
  // Biodiversity explorer: species cards built from the official-records table,
  // the dated community snapshot and the taxon reference file (Red List, photos,
  // summaries). Cards expand in place; nothing observation-level is requested.
  // ---------------------------------------------------------------------------
  const searchEl = $("bioSearch");
  const sourceEl = $("bioSource");
  const domainEl = $("bioDomain");
  const groupEl = $("bioGroup");
  const table = $("bioTable");
  const countEl = $("bioCount");
  const cardsEl = $("bioCards");
  const moreWrap = $("bioMoreWrap");
  const moreButton = $("bioMore");
  const moreNote = $("bioMoreNote");

  if (!searchEl || !sourceEl || !domainEl || !groupEl || !table || !countEl || !cardsEl || !moreWrap || !moreButton) return;

  const inatProjectSlug = "biodiversity-of-mhtr";
  const inatProjectUrl = `https://www.inaturalist.org/projects/${inatProjectSlug}`;
  const snapshotUrl = cardsEl.dataset.inatSnapshotUrl || "";
  const snapshotDate = cardsEl.dataset.inatSnapshotDate || "";
  const taxaUrl = cardsEl.dataset.taxaUrl || "";
  const taxaDate = cardsEl.dataset.taxaDate || "";
  const PAGE_SIZE = 48;

  const norm = (s) => (s || "").toLowerCase().trim();
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const escapeHTML = (s) =>
    clean(s).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[ch]);
  const missingNameValues = new Set(["", "-", "–", "—", "n/a", "na", "unknown", "not known"]);
  const cleanName = (s) => {
    const value = clean(s);
    return missingNameValues.has(norm(value)) ? "" : value;
  };
  const safeUrl = (url) => {
    try {
      const parsed = new URL(url, window.location.origin);
      if (!/^https?:$/.test(parsed.protocol)) return "#";
      return escapeHTML(parsed.href);
    } catch {
      return "#";
    }
  };
  const formatNumber = (value) => Number(value || 0).toLocaleString("en-IN");
  const plural = (count, one, many) => `${formatNumber(count)} ${count === 1 ? one : many}`;

  // Reusable photo licences: the reference file only ever contains these, and the
  // page refuses anything else (no non-commercial or all-rights-reserved photos).
  const reusablePhotoLicenses = {
    cc0: { code: "cc0", label: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
    "cc-by": { code: "cc-by", label: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    "cc-by-sa": { code: "cc-by-sa", label: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" },
  };
  const photoSize = (url, size) => clean(url).replace(/\/square(?=\.[a-z0-9]+(?:\?|$))/i, `/${size}`);
  const reusablePhoto = (photo) => {
    const licence = reusablePhotoLicenses[norm(photo?.licence)];
    const url = clean(photo?.url);
    const by = cleanName(photo?.by);
    if (!licence || !/^https:\/\//i.test(url) || !by || !Number.isInteger(Number(photo?.id))) return null;
    return {
      id: Number(photo.id),
      thumbUrl: photoSize(url, "small"),
      largeUrl: photoSize(url, "medium"),
      by,
      licenceLabel: licence.label,
      licenceUrl: licence.url,
      sourceUrl: `https://www.inaturalist.org/photos/${Number(photo.id)}`,
      width: Number(photo.width) || 0,
      height: Number(photo.height) || 0,
    };
  };

  const iucnCategories = {
    EX: "Extinct",
    EW: "Extinct in the Wild",
    CR: "Critically Endangered",
    EN: "Endangered",
    VU: "Vulnerable",
    NT: "Near Threatened",
    LC: "Least Concern",
    DD: "Data Deficient",
  };
  const iucnFromText = (text) => {
    const value = norm(text).replace(/^iucn\s+/, "");
    if (!value || /not assessed|not evaluated|^ne$/.test(value)) return null;
    const byName = Object.entries(iucnCategories).find(([code, name]) => value === norm(code) || value === norm(name));
    return byName ? { code: byName[0], name: byName[1] } : null;
  };

  // Group icons: simple line drawings in the site's own style (24 × 24 viewBox).
  const groupIcons = {
    Trees: '<circle cx="12" cy="9" r="5.5"/><path d="M12 14.5V21M9 21h6"/>',
    Shrubs: '<path d="M12 21v-5"/><path d="M7.5 16A4.5 4.5 0 0 1 5 8a4 4 0 0 1 7-3 4 4 0 0 1 7 3 4.5 4.5 0 0 1-2.5 8Z"/>',
    Herbs: '<path d="M12 21v-8"/><path d="M12 13c-4 0-7-3-7-7 4 0 7 3 7 7Z"/><path d="M12 13c4 0 7-3 7-7-4 0-7 3-7 7Z"/>',
    Climbers: '<path d="M14 21V4"/><path d="M14 17c-3 .5-5-1-5-3.5 2.5 0 4.5 1.5 5 3.5Z"/><path d="M14 11c3 .5 5-1 5-3.5-2.5 0-4.5 1.5-5 3.5Z"/><path d="M14 7C11 7 9.5 5.5 9.5 3.5 12 3.5 13.5 5 14 7Z"/>',
    Grasses: '<path d="M4 21c1-6 3-10 5-13M12 21c0-7 1-12 2-17M20 21c-1-6-3-10-5-13M8 21c1-4 3-7 5-9M16 21c-1-4-3-7-5-9"/>',
    Epiphytes: '<path d="M3 15h18"/><path d="M12 15V9"/><path d="M12 9c-3 0-5-2-5-5 3 0 5 2 5 5Z"/><path d="M12 9c3 0 5-2 5-5-3 0-5 2-5 5Z"/><path d="M8 15c0 3 1 5 4 5s4-2 4-5"/>',
    Parasites: '<path d="M4 20c4-2 6-5 8-9"/><path d="M12 11c-3-.5-5-3-5-6 3 .5 5 3 5 6Z"/><path d="M12 11c3-.5 5-3 5-6-3 .5-5 3-5 6Z"/><circle cx="7" cy="17" r="1.2"/><circle cx="17" cy="15" r="1.2"/><circle cx="14" cy="19" r="1.2"/>',
    Pteridophytes: '<path d="M12 21c0-8 1-14 6-18"/><path d="M12 17c-3 0-5-1-6-3M13 13c-3 0-5-1-5-3M14 9c-2 0-4-1-4-3M13 14c3 0 5-1 6-3M14 10c3 0 4-1 5-3"/>',
    Plants: '<path d="M20 4C11 4 5 9 5 17c0 1 .3 2 1 3 8 0 14-6 14-16Z"/><path d="M6 20c3-5 7-9 11-12"/>',
    Mammals: '<circle cx="7" cy="9" r="1.8"/><circle cx="11" cy="6" r="1.8"/><circle cx="16" cy="7" r="1.8"/><circle cx="19" cy="11" r="1.8"/><path d="M13 12c-3 0-6 3-6 6 0 2 2 2.5 3.5 1.5L13 18l2.5 1.5C17 20.5 19 20 19 18c0-3-3-6-6-6Z"/>',
    Birds: '<path d="M4 12c3 0 5-1 7-3l2-3c2-1 4-1 6 1l2 1-3 1v3c0 4-3 7-7 8l1 2H8l1-2.5C6 18 4 15 4 12Z"/><circle cx="16" cy="8" r=".8"/>',
    Reptiles: '<path d="M4 16c0 3 3 4 5 4h5c3 0 5-2 5-4s-2-4-5-4h-4c-2 0-4-1-4-3s2-3 4-3h5l3-2"/><circle cx="17" cy="5.5" r=".8"/>',
    Amphibians: '<circle cx="8.5" cy="7.5" r="2"/><circle cx="15.5" cy="7.5" r="2"/><path d="M5 12c0 4 3 7 7 7s7-3 7-7"/><path d="M3 19l4-3M21 19l-4-3"/>',
    Fishes: '<path d="M2 12c3-4 6-6 10-6s7 2 9 6c-2 4-5 6-9 6S5 16 2 12Z"/><path d="M21 12l2-4v8Z"/><circle cx="7" cy="11" r="1"/>',
    Insects: '<ellipse cx="12" cy="13" rx="5" ry="7"/><path d="M12 6v14M7 10l-3-2M7 14H3M7 17l-3 2M17 10l3-2M17 14h4M17 17l3 2M10 4l2 2 2-2"/>',
    Arachnids: '<circle cx="12" cy="13" r="3"/><circle cx="12" cy="8" r="1.5"/><path d="M9 12 4 9M9 14 3 15M10 16l-3 5M15 12l5-3M15 14l6 1M14 16l3 5"/>',
    Fungi: '<path d="M3 11c0-5 4-8 9-8s9 3 9 8H3Z"/><path d="M9 11v6c0 2 1 3 3 3s3-1 3-3v-6"/>',
  };
  const groupSingular = {
    Trees: "Tree",
    Shrubs: "Shrub",
    Herbs: "Herb",
    Climbers: "Climber",
    Grasses: "Grass",
    Epiphytes: "Epiphyte",
    Parasites: "Parasitic plant",
    Pteridophytes: "Fern",
    Plants: "Plant",
    Mammals: "Mammal",
    Birds: "Bird",
    Reptiles: "Reptile",
    Amphibians: "Amphibian",
    Fishes: "Fish",
    Insects: "Insect",
    Arachnids: "Arachnid",
    Fungi: "Fungus",
  };
  const iconFor = (item) => {
    const paths = groupIcons[item.group] || (item.domain === "Fauna" ? groupIcons.Mammals : groupIcons.Plants);
    return `<svg class="bio-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;
  };

  const preferredGroupOrder = [
    "Trees", "Shrubs", "Herbs", "Climbers", "Grasses", "Epiphytes", "Parasites", "Pteridophytes", "Plants",
    "Mammals", "Birds", "Reptiles", "Amphibians", "Fishes", "Insects", "Arachnids", "Fungi",
  ];
  const sortGroups = (groups) =>
    groups.sort((a, b) => {
      const ai = preferredGroupOrder.indexOf(a);
      const bi = preferredGroupOrder.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return a.localeCompare(b);
    });

  const normalizeGroup = (domain, group, common, family) => {
    if (norm(domain) !== "fauna") return group;
    const groupKey = norm(group);
    const commonKey = norm(common);
    const familyKey = norm(family);
    if (groupKey === "reptiles & amphibians") {
      return familyKey.includes("bufonidae") || /frog|toad/.test(commonKey) ? "Amphibians" : "Reptiles";
    }
    if (groupKey === "aquatic") {
      if (familyKey.includes("platanistidae") || familyKey.includes("mustelidae")) return "Mammals";
      if (/turtle|gharial|crocodile/.test(commonKey) || /(gavialidae|trionychidae|geoemydidae)/.test(familyKey)) return "Reptiles";
    }
    return group;
  };

  // The "Status in source" column holds one entry per source document, e.g.
  // "WII bird guide 2025: Locally common · Resident · IUCN LC · WPA Schedule II; Tiger Conservation Plan 2025–36: C (Common)".
  const tcpStatusNames = { A: "Abundant", C: "Common", L: "Less common", R: "Rare", I: "Introduced" };
  function parseStatus(statusText, sourceLinks) {
    const parts = clean(statusText).split(/;\s+(?=[A-Z][^;]*?:\s)/);
    const seen = new Set();
    const entries = [];
    for (const rawPart of parts) {
      const part = clean(rawPart);
      if (!part || seen.has(part)) continue;
      seen.add(part);
      const match = part.match(/^([^:]+?):\s+(.+)$/);
      const source = match ? match[1] : sourceLinks.length === 1 ? sourceLinks[0].label.replace(/,\s*p\.\s*\d+$/, "") : "";
      const text = match ? match[2] : part;
      const entry = { source, text, local: "", season: "", iucn: null, wpa: "", label: "" };
      const tcp = text.match(/^([ACLRI])\s*\((.+)\)$/);
      if (tcp) {
        entry.label = tcpStatusNames[tcp[1]] || clean(tcp[2]);
        entry.printed = tcp[1];
      } else if (text.includes(" · ")) {
        for (const token of text.split(" · ").map(clean)) {
          if (/^locally /i.test(token)) entry.local = token;
          else if (/^iucn /i.test(token)) entry.iucn = iucnFromText(token) || { code: "", name: token.replace(/^iucn /i, "") };
          else if (/^wpa /i.test(token)) entry.wpa = token.replace(/^wpa /i, "");
          else if (/not in wpa/i.test(token)) entry.wpa = "Not in the schedules";
          else if (token) entry.season = token === "SM" ? "Summer migrant" : token === "WM" ? "Winter migrant" : token;
        }
        entry.label = [entry.local, entry.season ? entry.season.toLowerCase() : ""].filter(Boolean).join(", ");
      } else {
        entry.label = text;
      }
      entries.push(entry);
    }
    return entries;
  }

  // Official records come from the table that is already in the page HTML.
  const referenceItems = Array.from(table.querySelectorAll("tbody tr")).map((tr, index) => {
    const tds = tr.querySelectorAll("td");
    const domain = clean(tds[0]?.textContent);
    const rawGroup = clean(tds[1]?.textContent);
    const common = cleanName(tds[2]?.textContent);
    const scientific = cleanName(tds[3]?.textContent);
    const family = cleanName(tds[4]?.textContent);
    const statusText = clean(tds[5]?.textContent);
    const iucnPrinted = clean(tds[6]?.textContent);
    const notes = clean(tds[7]?.textContent);
    const sourceLinks = Array.from(tds[8]?.querySelectorAll("a") || []).map((a) => ({
      label: clean(a.textContent),
      href: a.getAttribute("href") || "",
    }));
    const group = normalizeGroup(domain, rawGroup, common, family);
    const statuses = parseStatus(statusText, sourceLinks);
    const iucnMatch = iucnPrinted.match(/\(([A-Z]{2})\)\s*$/);
    const local = cleanName(tr.dataset.local);
    const habitat = cleanName(tr.dataset.habitat);
    const printedAs = (notes.match(/Printed as ([^;]+)/) || [])[1] || "";
    const noteText = notes
      .split(/;\s*/)
      .map(clean)
      .filter((part) => part && !/^Local name:/i.test(part) && !/^Habitat \(WII\):/i.test(part) && !/^Printed as /i.test(part))
      .join("; ");

    return {
      key: `ref-${index}`,
      tier: "reference",
      domain,
      group,
      common,
      scientific,
      family,
      statusText,
      statuses,
      iucnRow: iucnMatch && iucnCategories[iucnMatch[1]] ? { code: iucnMatch[1], name: iucnCategories[iucnMatch[1]] } : null,
      local,
      habitat,
      printedAs: clean(printedAs),
      noteText,
      sourceLinks,
      taxonId: Number(tr.dataset.taxonId) || null,
      projectCount: null,
      taxon: null,
      hay: "",
    };
  });

  const taxaByName = new Map();
  const taxaById = new Map();
  const snapshotByTaxonId = new Map();
  const snapshotByName = new Map();
  let communityItems = [];
  let communityLoaded = false;
  let communityLoadError = "";
  let taxaLoaded = false;

  function attachTaxon(item) {
    const entry = (item.taxonId && taxaById.get(item.taxonId)) || taxaByName.get(norm(item.scientific)) || null;
    if (!entry) return;
    item.taxon = entry;
    if (!item.taxonId && entry.taxonId) item.taxonId = Number(entry.taxonId);
    item.photo = reusablePhoto(entry.photo);
  }

  function attachProjectCount(item) {
    const match = (item.taxonId && snapshotByTaxonId.get(item.taxonId)) || snapshotByName.get(norm(item.scientific));
    if (!match) {
      item.projectCount = communityLoaded ? 0 : null;
      return;
    }
    if (!item.taxonId) item.taxonId = Number(match.taxonId);
    item.projectCount = Number(match.researchGradeObservationCount) || 0;
    item.communityCommonName = cleanName(match.commonName);
  }

  function iucnFor(item) {
    const fromTaxon = item.taxon?.redList;
    if (fromTaxon?.code && iucnCategories[fromTaxon.code]) {
      return { code: fromTaxon.code, name: iucnCategories[fromTaxon.code], url: fromTaxon.url || "", basis: "inat" };
    }
    if (item.iucnRow) return { ...item.iucnRow, url: "", basis: "inat" };
    const printed = item.statuses?.find((status) => status.iucn?.code)?.iucn;
    if (printed) return { ...printed, url: "", basis: "printed" };
    return null;
  }

  function displayNames(item) {
    const scientific = item.scientific;
    const inatName = cleanName(item.taxon?.commonName);
    const firstLocal = clean(item.local).split(/\s*,\s*/)[0] || "";
    const common = item.common || firstLocal || item.communityCommonName || inatName;
    const title = common || scientific || "Unnamed record";
    const titleIsScientific = !common && Boolean(scientific);
    const alsoCalled = [];
    for (const candidate of [item.local, item.communityCommonName, inatName]) {
      for (const name of clean(candidate).split(/\s*,\s*/)) {
        if (name && norm(name) !== norm(title) && !alsoCalled.some((existing) => norm(existing) === norm(name))) alsoCalled.push(name);
      }
    }
    return { title, titleIsScientific, scientific, alsoCalled };
  }

  function buildHaystack(item) {
    const names = displayNames(item);
    const iucn = iucnFor(item);
    return norm([
      item.domain, item.group, groupSingular[item.group], names.title, item.scientific, item.family, item.taxon?.family,
      item.local, item.communityCommonName, item.taxon?.commonName, item.habitat, item.noteText,
      ...(item.statuses || []).map((status) => [status.label, status.wpa ? `WPA ${status.wpa}` : "", status.iucn?.name].filter(Boolean).join(" ")),
      item.printedAs, iucn ? `${iucn.code} ${iucn.name}` : "", item.taxon?.establishment,
      item.tier === "community" ? "community observed research grade inaturalist" : "official record",
    ].filter(Boolean).join(" "));
  }

  function refreshDerived(items) {
    for (const item of items) {
      attachTaxon(item);
      attachProjectCount(item);
      item.hay = buildHaystack(item);
    }
  }

  function validateSnapshot(data) {
    if (data?.schemaVersion !== 1 || data?.methodology?.qualityGrade !== "research" || data?.dataset?.asOfDate !== snapshotDate || !Array.isArray(data?.taxa)) {
      throw new Error("The biodiversity snapshot schema or version is not valid.");
    }
    return data;
  }

  async function fetchJSON(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return response.json();
  }

  const taxaPromise = taxaUrl
    ? fetchJSON(taxaUrl)
        .then((data) => {
          for (const [name, entry] of Object.entries(data?.taxa || {})) {
            if (!entry || typeof entry !== "object") continue;
            taxaByName.set(norm(name), entry);
            if (entry.name) taxaByName.set(norm(entry.name), entry);
            if (Number(entry.taxonId)) taxaById.set(Number(entry.taxonId), entry);
          }
          taxaLoaded = true;
        })
        .catch(() => {
          taxaLoaded = false;
        })
    : Promise.resolve();

  const snapshotPromise = snapshotUrl
    ? fetchJSON(snapshotUrl)
        .then((raw) => {
          const data = validateSnapshot(raw);
          for (const taxon of data.taxa) {
            snapshotByTaxonId.set(Number(taxon.taxonId), taxon);
            snapshotByName.set(norm(taxon.scientificName), taxon);
          }
          communityItems = data.taxa.map((taxon, index) => ({
            key: `com-${index}`,
            tier: "community",
            domain: clean(taxon.domain),
            group: clean(taxon.group),
            common: cleanName(taxon.commonName),
            scientific: cleanName(taxon.scientificName),
            family: "",
            statusText: "",
            statuses: [],
            iucnRow: null,
            local: "",
            habitat: "",
            printedAs: "",
            noteText: "",
            sourceLinks: [],
            rank: clean(taxon.rank),
            taxonId: Number(taxon.taxonId) || null,
            projectCount: Number(taxon.researchGradeObservationCount) || 0,
            taxon: null,
            hay: "",
          }));
          communityLoaded = true;
          communityLoadError = "";
        })
        .catch((error) => {
          communityLoadError = error.message;
        })
    : Promise.resolve();

  // --- Rendering -------------------------------------------------------------
  let visibleItems = [];
  let renderedCount = 0;
  let openCard = null;
  const itemsByKey = new Map();

  function tagsHTML(item) {
    const tags = [];
    tags.push(`<span class="bio-tag bio-tag-group">${escapeHTML(groupSingular[item.group] || item.group)}</span>`);
    const iucn = iucnFor(item);
    if (iucn) {
      tags.push(`<span class="bio-tag bio-tag-iucn" data-iucn="${escapeHTML(iucn.code)}" title="IUCN Red List: ${escapeHTML(iucn.name)}"><b>${escapeHTML(iucn.code)}</b> ${escapeHTML(iucn.name)}</span>`);
    }
    const reserveStatus = item.statuses?.find((status) => status.printed || status.local);
    if (reserveStatus) {
      const label = reserveStatus.local ? reserveStatus.local : tcpStatusNames[reserveStatus.printed] || reserveStatus.label;
      tags.push(`<span class="bio-tag bio-tag-status">${escapeHTML(label)}</span>`);
    } else if (item.tier === "community" && item.projectCount) {
      tags.push(`<span class="bio-tag bio-tag-status">${escapeHTML(plural(item.projectCount, "record", "records"))}</span>`);
    }
    return tags.join("");
  }

  function mediaHTML(item, size) {
    const photo = item.photo;
    const names = displayNames(item);
    if (photo) {
      const url = size === "large" ? photo.largeUrl : photo.thumbUrl;
      const dims = size === "large" ? 'width="500" height="375"' : 'width="240" height="240"';
      return `<img src="${safeUrl(url)}" alt="${escapeHTML(names.title)}${names.titleIsScientific ? "" : ` (${names.scientific})`}, reference photo from iNaturalist" ${dims} loading="lazy" decoding="async">`;
    }
    return iconFor(item);
  }

  function subtitleHTML(item, names) {
    if (names.titleIsScientific) return "";
    const english = cleanName(item.taxon?.commonName);
    const showEnglish = english && norm(english) !== norm(names.title);
    return `<p class="bio-card-sci">${showEnglish ? `<span class="bio-card-english">${escapeHTML(english)}</span> · ` : ""}<em>${escapeHTML(names.scientific)}</em></p>`;
  }

  function cardHTML(item) {
    const names = displayNames(item);
    const panelId = `bio-panel-${item.key}`;
    return `
      <div class="bio-card-head">
        <span class="bio-card-media${item.photo ? " has-photo" : ""}" data-role="thumb">${mediaHTML(item, "thumb")}</span>
        <div class="bio-card-text">
          <h3 class="bio-card-title${names.titleIsScientific ? " is-scientific" : ""}">
            <button class="bio-card-toggle" type="button" aria-expanded="false" aria-controls="${panelId}">${escapeHTML(names.title)}</button>
          </h3>
          ${subtitleHTML(item, names)}
          <p class="bio-card-tags">${tagsHTML(item)}</p>
        </div>
        <span class="bio-card-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M6 9l6 6 6-6"/></svg></span>
      </div>
      <div class="bio-card-panel" id="${panelId}" hidden></div>
    `;
  }

  function sourceHTML(item) {
    if (item.tier === "community") {
      return `<p class="bio-panel-source"><strong>Source:</strong> <a href="${safeUrl(inatProjectUrl)}" target="_blank" rel="noopener">Biodiversity of MHTR</a> project on iNaturalist, Research Grade snapshot of ${escapeHTML(snapshotDate)} (<a href="${safeUrl(snapshotUrl)}" download>JSON</a>). Community record; not an official listing.</p>`;
    }
    if (!item.sourceLinks.length) return "";
    const links = item.sourceLinks.map((link) => `<a href="${safeUrl(link.href)}" target="_blank" rel="noopener">${escapeHTML(link.label)}</a>`).join("; ");
    return `<p class="bio-panel-source"><strong>Source:</strong> ${links} <span class="muted">(opens the PDF at that page)</span></p>`;
  }

  function factsHTML(item) {
    const facts = [];
    const names = displayNames(item);
    const taxon = item.taxon;

    if (item.family) facts.push(["Family", escapeHTML(item.family)]);
    else if (taxon?.family) facts.push(["Family", `${escapeHTML(taxon.family)} <span class="muted">(iNaturalist)</span>`]);

    const groupLabel = `${escapeHTML(item.group)}${item.domain ? ` · ${escapeHTML(item.domain)}` : ""}${item.rank && item.rank !== "species" ? ` · ${escapeHTML(item.rank)}` : ""}`;
    facts.push(["Group", groupLabel]);

    const bySource = new Map();
    for (const status of item.statuses || []) {
      if (!status.label) continue;
      const text = `${escapeHTML(status.label)}${status.printed ? ` <span class="muted">(printed “${escapeHTML(status.printed)}”)</span>` : ""}`;
      const list = bySource.get(status.source || "") || [];
      if (!list.includes(text)) list.push(text);
      bySource.set(status.source || "", list);
    }
    const manySources = bySource.size > 1;
    const reserve = Array.from(bySource, ([source, texts]) => `${texts.join(", ")}${manySources && source ? ` <span class="muted">· ${escapeHTML(source)}</span>` : ""}`);
    if (reserve.length) facts.push(["In the reserve", reserve.join("<br>")]);

    const iucn = iucnFor(item);
    if (iucn) {
      const basis = iucn.basis === "printed" ? "as printed in the WII guide" : taxaDate ? `global assessment, via iNaturalist ${escapeHTML(taxaDate)}` : "global assessment, via iNaturalist";
      const link = iucn.url ? ` · <a href="${safeUrl(iucn.url)}" target="_blank" rel="noopener">Red List entry</a>` : "";
      facts.push(["IUCN Red List", `<span class="bio-iucn-dot" data-iucn="${escapeHTML(iucn.code)}" aria-hidden="true"></span>${escapeHTML(iucn.name)} (${escapeHTML(iucn.code)})<br><span class="muted">${basis}${link}</span>`]);
    } else if (taxaLoaded && item.taxon) {
      facts.push(["IUCN Red List", `<span class="muted">No global assessment recorded on iNaturalist</span>`]);
    }

    const wpa = (item.statuses || []).find((status) => status.wpa);
    if (wpa) facts.push(["Wild Life (Protection) Act", `${escapeHTML(wpa.wpa)} <span class="muted">· ${escapeHTML(wpa.source || "WII guide")}</span>`]);

    for (const status of taxon?.indiaStatus || []) {
      if (status?.status && status?.authority) {
        facts.push(["Status in India", `${escapeHTML(status.status)} <span class="muted">· ${escapeHTML(status.authority)}</span>`]);
        break;
      }
    }
    if (taxon?.establishment) {
      const means = norm(taxon.establishment);
      const label = means === "native" ? "Native" : means === "introduced" ? "Introduced" : means === "endemic" ? "Endemic" : clean(taxon.establishment);
      facts.push(["In India", `${escapeHTML(label)} <span class="muted">· iNaturalist</span>`]);
    }
    if (names.alsoCalled.length) facts.push(["Also called", escapeHTML(names.alsoCalled.join(", "))]);
    if (item.printedAs) facts.push(["Printed as", `<em>${escapeHTML(item.printedAs)}</em>`]);
    if (item.habitat) facts.push(["Habitat (WII)", escapeHTML(item.habitat)]);
    if (item.tier === "reference" && item.projectCount !== null) {
      facts.push(["MHTR project", item.projectCount ? `${escapeHTML(plural(item.projectCount, "Research Grade record", "Research Grade records"))} <span class="muted">· snapshot ${escapeHTML(snapshotDate)}</span>` : `<span class="muted">No Research Grade record yet</span>`]);
    }
    if (item.tier === "community") {
      facts.push(["MHTR project", `${escapeHTML(plural(item.projectCount, "Research Grade record", "Research Grade records"))} <span class="muted">· snapshot ${escapeHTML(snapshotDate)}</span>`]);
    }
    if (Number(taxon?.observationsCount)) facts.push(["Worldwide on iNaturalist", `${escapeHTML(formatNumber(taxon.observationsCount))} observations <span class="muted">· ${escapeHTML(taxaDate)}</span>`]);

    return `<dl class="bio-facts">${facts.map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
  }

  function actionsHTML(item) {
    const names = displayNames(item);
    const query = item.scientific || names.title;
    const projectHref = item.taxonId
      ? `https://www.inaturalist.org/observations?project_id=${inatProjectSlug}&taxon_id=${Number(item.taxonId)}&quality_grade=research`
      : `https://www.inaturalist.org/observations?project_id=${inatProjectSlug}&q=${encodeURIComponent(query)}`;
    const taxonHref = item.taxonId ? `https://www.inaturalist.org/taxa/${Number(item.taxonId)}` : `https://www.inaturalist.org/search?q=${encodeURIComponent(query)}`;
    const projectLabel = item.projectCount ? `${escapeHTML(plural(item.projectCount, "record", "records"))} in the MHTR project` : "Look it up in the MHTR project";
    const taxonLabel = item.taxonId ? "Species page on iNaturalist" : "Search iNaturalist";
    return `
      <div class="bio-panel-actions">
        <a class="button-link bio-action" href="${safeUrl(projectHref)}" target="_blank" rel="noopener">
          <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>
          ${projectLabel}
        </a>
        <a class="button-link button-link-secondary bio-action" href="${safeUrl(taxonHref)}" target="_blank" rel="noopener">
          <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>
          ${taxonLabel}
        </a>
      </div>`;
  }

  function panelHTML(item) {
    const names = displayNames(item);
    const photo = item.photo;
    const taxon = item.taxon;
    const media = photo
      ? `<figure class="bio-panel-media">
          ${mediaHTML(item, "large")}
          <figcaption>Photo: ${escapeHTML(photo.by)} · <a href="${safeUrl(photo.licenceUrl)}" target="_blank" rel="license noopener">${escapeHTML(photo.licenceLabel)}</a> · <a href="${safeUrl(photo.sourceUrl)}" target="_blank" rel="noopener">on iNaturalist</a></figcaption>
        </figure>`
      : `<div class="bio-panel-media bio-panel-media--icon">${iconFor(item)}<span class="muted">${taxaLoaded ? "No freely licensed reference photo" : "Photo not available right now"}</span></div>`;
    const summary = taxon?.wikipedia?.summary && /^https:\/\//i.test(taxon.wikipedia.url || "")
      ? `<p class="bio-panel-summary">${escapeHTML(taxon.wikipedia.summary)} <a href="${safeUrl(taxon.wikipedia.url)}" target="_blank" rel="noopener">Wikipedia</a> <span class="muted">(CC BY-SA)</span></p>`
      : "";
    const inatName = cleanName(taxon?.name);
    const nameNote = inatName && norm(inatName) !== norm(item.scientific)
      ? `<p class="bio-panel-note">iNaturalist lists this under <em>${escapeHTML(inatName)}</em>.</p>`
      : "";
    const note = item.noteText ? `<p class="bio-panel-note">${escapeHTML(item.noteText)}</p>` : "";
    return `
      <div class="bio-panel-grid">
        ${media}
        <div class="bio-panel-body">
          ${summary}
          ${factsHTML(item)}
          ${nameNote}
          ${note}
          ${sourceHTML(item)}
          ${actionsHTML(item)}
        </div>
      </div>`;
  }

  function setOpen(card, open) {
    const item = itemsByKey.get(card.dataset.key);
    const toggle = card.querySelector(".bio-card-toggle");
    const panel = card.querySelector(".bio-card-panel");
    if (!item || !toggle || !panel) return;
    if (open) {
      if (openCard && openCard !== card) setOpen(openCard, false);
      panel.innerHTML = panelHTML(item);
      panel.hidden = false;
      card.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
      openCard = card;
      requestAnimationFrame(() => {
        const top = card.getBoundingClientRect().top;
        if (top < 72 || top > window.innerHeight - 160) card.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    } else {
      panel.hidden = true;
      panel.innerHTML = "";
      card.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      if (openCard === card) openCard = null;
    }
  }

  function updateMoreControls() {
    const remaining = visibleItems.length - renderedCount;
    moreWrap.hidden = remaining <= 0;
    moreButton.textContent = remaining > 0 ? `Show ${Math.min(PAGE_SIZE, remaining)} more` : "";
    if (moreNote) moreNote.textContent = remaining > 0 ? `${formatNumber(renderedCount)} of ${formatNumber(visibleItems.length)} shown` : "";
  }

  function renderMore() {
    const slice = visibleItems.slice(renderedCount, renderedCount + PAGE_SIZE);
    if (!slice.length) {
      updateMoreControls();
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const item of slice) {
      const article = document.createElement("article");
      article.className = "bio-card";
      article.dataset.key = item.key;
      article.dataset.tier = item.tier;
      article.innerHTML = cardHTML(item);
      fragment.appendChild(article);
    }
    cardsEl.appendChild(fragment);
    renderedCount += slice.length;
    updateMoreControls();
  }

  function renderCards() {
    openCard = null;
    renderedCount = 0;
    cardsEl.innerHTML = "";
    if (!visibleItems.length) {
      cardsEl.innerHTML = '<p class="muted bio-empty">No species match this search. Try a shorter word, a scientific name, or clear the filters.</p>';
      updateMoreControls();
      return;
    }
    renderMore();
  }

  // When the taxon file arrives after the first paint, swap icons for photos in place.
  function refreshRenderedMedia() {
    for (const card of cardsEl.querySelectorAll(".bio-card")) {
      const item = itemsByKey.get(card.dataset.key);
      if (!item) continue;
      const thumb = card.querySelector('[data-role="thumb"]');
      if (thumb && item.photo && !thumb.classList.contains("has-photo")) {
        thumb.classList.add("has-photo");
        thumb.innerHTML = mediaHTML(item, "thumb");
      }
      const tags = card.querySelector(".bio-card-tags");
      if (tags) tags.innerHTML = tagsHTML(item);
      const subtitle = card.querySelector(".bio-card-sci");
      const names = displayNames(item);
      if (subtitle && !names.titleIsScientific) subtitle.outerHTML = subtitleHTML(item, names);
    }
  }

  // --- Filtering ---------------------------------------------------------------
  function currentItems() {
    const source = norm(sourceEl.value);
    if (source === "reference") return referenceItems;
    if (source === "community") return communityItems;
    // Both layers: fold community taxa that are also in the official list into that card.
    const officialIds = new Set(referenceItems.map((item) => item.taxonId).filter(Boolean));
    const officialNames = new Set(referenceItems.map((item) => norm(item.scientific)).filter(Boolean));
    return [
      ...referenceItems,
      ...communityItems.filter((item) => !(item.taxonId && officialIds.has(item.taxonId)) && !officialNames.has(norm(item.scientific))),
    ];
  }

  function populateGroupOptions() {
    const selectedDomain = domainEl.value;
    const currentGroup = groupEl.value;
    const pool = currentItems().filter((item) => !selectedDomain || item.domain === selectedDomain);
    const groups = sortGroups(Array.from(new Set(pool.map((item) => item.group).filter(Boolean))));
    groupEl.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = selectedDomain ? `All ${domainEl.options[domainEl.selectedIndex].textContent.toLowerCase()}` : "All groups";
    groupEl.appendChild(allOption);
    for (const group of groups) {
      const option = document.createElement("option");
      option.value = group;
      option.textContent = group;
      groupEl.appendChild(option);
    }
    groupEl.value = groups.includes(currentGroup) ? currentGroup : "";
  }

  function applyFilters() {
    const q = norm(searchEl.value);
    const source = norm(sourceEl.value);
    const domain = norm(domainEl.value);
    const group = norm(groupEl.value);

    if (source !== "reference" && !communityLoaded) {
      countEl.textContent = communityLoadError ? "Community snapshot unavailable" : "Loading the community snapshot…";
      cardsEl.innerHTML = `<p class="muted bio-empty">${escapeHTML(communityLoadError || "Loading Research Grade taxon records from the dated snapshot…")}</p>`;
      moreWrap.hidden = true;
      return;
    }

    const pool = currentItems();
    const terms = q.split(/\s+/).filter(Boolean);
    visibleItems = pool.filter((item) => {
      if (domain && norm(item.domain) !== domain) return false;
      if (group && norm(item.group) !== group) return false;
      return terms.every((term) => item.hay.includes(term));
    });
    itemsByKey.clear();
    for (const item of pool) itemsByKey.set(item.key, item);

    const layer = source === "reference" ? "species in official records" : source === "community" ? `community taxa (snapshot ${snapshotDate})` : "species across both layers";
    countEl.textContent = visibleItems.length === pool.length
      ? `${formatNumber(pool.length)} ${layer}`
      : `${formatNumber(visibleItems.length)} of ${formatNumber(pool.length)} ${layer}`;
    renderCards();
  }

  // --- Events ------------------------------------------------------------------
  cardsEl.addEventListener("click", (event) => {
    if (event.target.closest("a")) return;
    const head = event.target.closest(".bio-card-head");
    if (!head) return;
    const card = head.closest(".bio-card");
    if (!card) return;
    event.preventDefault();
    setOpen(card, !card.classList.contains("is-open"));
  });

  cardsEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!event.target.classList?.contains("bio-card-toggle")) return;
    event.preventDefault();
    const card = event.target.closest(".bio-card");
    if (card) setOpen(card, !card.classList.contains("is-open"));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openCard) {
      const toggle = openCard.querySelector(".bio-card-toggle");
      setOpen(openCard, false);
      toggle?.focus();
    }
  });

  moreButton.addEventListener("click", renderMore);
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !moreWrap.hidden) renderMore();
    }, { rootMargin: "600px 0px" });
    observer.observe(moreWrap);
  }

  let searchTimer = 0;
  searchEl.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(applyFilters, 120);
  });
  groupEl.addEventListener("change", applyFilters);
  domainEl.addEventListener("change", () => {
    populateGroupOptions();
    applyFilters();
  });
  sourceEl.addEventListener("change", () => {
    populateGroupOptions();
    applyFilters();
  });

  // --- Start -------------------------------------------------------------------
  const initialQuery = clean(new URLSearchParams(window.location.search).get("q"));
  if (initialQuery) {
    searchEl.value = initialQuery;
    sourceEl.value = "";
  }
  refreshDerived(referenceItems);
  populateGroupOptions();
  applyFilters();

  // Give the taxon file a moment so the first paint already carries photos and Red List tags.
  Promise.race([taxaPromise, new Promise((resolve) => setTimeout(resolve, 900))]).then(() => {
    refreshDerived(referenceItems);
    refreshRenderedMedia();
  });
  taxaPromise.then(() => {
    refreshDerived(referenceItems);
    refreshDerived(communityItems);
    refreshRenderedMedia();
  });
  snapshotPromise.then(() => {
    refreshDerived(referenceItems);
    refreshDerived(communityItems);
    if (norm(sourceEl.value) === "reference") {
      refreshRenderedMedia();
    } else {
      populateGroupOptions();
      applyFilters();
    }
  });
})();
