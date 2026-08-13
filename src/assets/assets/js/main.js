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
  const dropdowns = Array.from(document.querySelectorAll(".has-dropdown"));

  if (!dropdowns.length) return;

  function setOpen(item, open) {
    item.classList.toggle("is-open", open);
    item.querySelector(".nav-toggle")?.setAttribute("aria-expanded", String(open));
    item.querySelector(".nav-parent .nav-link")?.setAttribute("aria-expanded", String(open));
    item.querySelector(".dropdown-menu")?.setAttribute("aria-hidden", String(!open));
  }

  function closeAll(except) {
    for (const item of dropdowns) {
      if (item === except) continue;
      setOpen(item, false);
    }
  }

  for (const item of dropdowns) {
    const toggle = item.querySelector(".nav-toggle");
    const trigger = item.querySelector(".nav-parent .nav-link");
    if (!toggle || !trigger) continue;

    setOpen(item, false);

    function toggleItem(event) {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = !item.classList.contains("is-open");
      closeAll(item);
      setOpen(item, isOpen);
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

  const searchEl = $("bioSearch");
  const sourceEl = $("bioSource");
  const domainEl = $("bioDomain");
  const groupEl = $("bioGroup");
  const table = $("bioTable");
  const countEl = $("bioCount");
  const cardsEl = $("bioCards");

  if (!searchEl || !sourceEl || !domainEl || !groupEl || !table || !countEl || !cardsEl) return;

  const inatApi = "https://api.inaturalist.org/v1";
  const inatProjectSlug = "biodiversity-of-mhtr";
  const inatProjectUrl = `https://www.inaturalist.org/projects/${inatProjectSlug}`;
  const inatCache = new Map();
  const snapshotUrl = cardsEl.dataset.inatSnapshotUrl || "";
  const snapshotDate = cardsEl.dataset.inatSnapshotDate || "";
  const snapshotByTaxonId = new Map();
  const snapshotByScientificName = new Map();

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
  const sourceUrl = (url) => {
    try {
      const parsed = new URL(url, window.location.origin);
      if (!/^https?:$/.test(parsed.protocol)) return "#";
      return escapeHTML(parsed.href);
    } catch {
      return "#";
    }
  };
  const speciesAliases = {
    "acacia catechu": ["Catechu tree"],
    "axis axis": ["Chital deer"],
    "boselaphus tragocamelus": ["Blue bull"],
    "butea monosperma": ["Flame of the forest", "Palash"],
    "caracal caracal": ["Caracal cat"],
    "cervus unicolor": ["Sambar", "Sambar deer"],
    "crocodylus palustris": ["Mugger", "Marsh crocodile"],
    "ficus benghalensis": ["Banyan", "Bargad", "Vad"],
    "ficus religiosa": ["Peepal", "Pipal", "Sacred fig"],
    "gavialis gangeticus": ["Gavial"],
    "gazella bennettii": ["Indian gazelle"],
    "hyaena hyaena": ["Hyena"],
    "lannea coromandelica": ["Indian ash"],
    "melursus ursinus": ["Bear", "Bhalu"],
    "naja naja": ["Indian cobra"],
    "panthera pardus": ["Indian leopard", "Leopard"],
    "panthera tigris": ["Bengal tiger", "Indian tiger", "Bagh"],
    "pavo cristatus": ["Indian peafowl", "Peacock"],
    "prosopis cineraria": ["Khejri", "Khejra"],
    "prosopis juliflora": ["Vilayati babul"],
    "python molurus": ["Indian rock python"],
    "sterculia urens": ["Ghost tree", "Gum karaya"],
  };
  const aliasesFor = (item) => {
    const existingNames = new Set(
      [item.common, item.scientific, item.notes]
        .flatMap((value) => clean(value).split(/\s*[,;/()]\s*/))
        .map(norm)
        .filter(Boolean)
    );

    return (speciesAliases[norm(item.scientific)] || []).filter((alias) => !existingNames.has(norm(alias)));
  };

  const likelyCommonNameFromNotes = (notes) => {
    const value = cleanName(notes);
    if (!value || /[.;:/]/.test(value)) return "";

    const words = value.split(/\s+/);
    if (words.length > 4) return "";
    if (/\b(air-breathing|anadromous|bottom-dwelling|critically|dwelling|endangered|estuarine|flagship|freshwater|healthy|indicator|indigenous|introduced|invasive|large|predator|riverine|small|species|systems)\b/i.test(value)) {
      return "";
    }

    return value;
  };

  const preferredGroupOrder = [
    "Trees",
    "Shrubs",
    "Herbs",
    "Climbers",
    "Grasses",
    "Epiphytes",
    "Parasites",
    "Pteridophytes",
    "Plants",
    "Mammals",
    "Birds",
    "Reptiles",
    "Amphibians",
    "Fishes",
    "Insects",
    "Arachnids",
    "Fungi",
  ];

  const sortGroups = (groups) =>
    groups.sort((a, b) => {
      const ai = preferredGroupOrder.indexOf(a);
      const bi = preferredGroupOrder.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return a.localeCompare(b);
    });

  const mergeText = (...values) => {
    const seen = new Set();
    return values
      .flatMap((value) => clean(value).split(/\s*;\s*/))
      .map(clean)
      .filter(Boolean)
      .filter((value) => {
        const key = norm(value);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .join("; ");
  };

  const preferredGroup = (a, b) => {
    if (!a) return b || "";
    if (!b) return a;
    const ai = preferredGroupOrder.indexOf(a);
    const bi = preferredGroupOrder.indexOf(b);
    const aRank = ai === -1 ? 999 : ai;
    const bRank = bi === -1 ? 999 : bi;
    return aRank <= bRank ? a : b;
  };

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

  const getNameInfo = (item) => {
    const sourceName = item.sourceTier === "reference" ? cleanName(item.common) : "";
    const communityCommonName = item.sourceTier === "community" ? cleanName(item.common) : "";
    const noteCommonName = likelyCommonNameFromNotes(item.notes);
    const scientificName = cleanName(item.scientific);
    const displayName = scientificName || sourceName || communityCommonName || noteCommonName || "Unnamed record";
    const displayIsScientific = Boolean(scientificName && norm(displayName) === norm(scientificName));
    const showScientific = Boolean(scientificName && norm(scientificName) !== norm(displayName));
    const showNoteAsCommonName = Boolean(noteCommonName && norm(noteCommonName) !== norm(displayName));
    const noteText = noteCommonName && norm(noteCommonName) === norm(cleanName(item.notes)) ? "" : cleanName(item.notes);

    return {
      communityCommonName,
      displayName,
      displayIsScientific,
      noteCommonName,
      noteText,
      scientificName,
      showNoteAsCommonName,
      showScientific,
      sourceName,
    };
  };

  const referenceRawSpecies = Array.from(table.querySelectorAll("tbody tr")).map((tr) => {
    const tds = tr.querySelectorAll("td");
    const domain = clean(tds[0]?.textContent);
    const rawGroup = clean(tds[1]?.textContent);
    const common = clean(tds[2]?.textContent);
    const scientific = clean(tds[3]?.textContent);
    const family = clean(tds[4]?.textContent);
    const group = normalizeGroup(domain, rawGroup, common, family);
    const status = clean(tds[5]?.textContent);
    const notes = clean(tds[6]?.textContent);

    return {
      sourceTier: "reference",
      evidenceLabel: "Published reference",
      domain,
      group,
      common,
      scientific,
      family,
      status,
      notes,
      hay: norm(`${tr.textContent} ${group}`),
    };
  });

  let species = [];
  let speciesById = new Map();
  let groupsByDomain = {};
  let communityLoaded = false;
  let communityLoadError = "";
  let communityLoadPromise = null;

  function rebuildSpecies(rawItems) {
    const speciesByKey = new Map();

    for (const sourceItem of rawItems) {
      const snapshotMatch = sourceItem.taxonId
        ? snapshotByTaxonId.get(Number(sourceItem.taxonId))
        : snapshotByScientificName.get(norm(sourceItem.scientific));
      const item = {
        ...sourceItem,
        taxonId: Number(sourceItem.taxonId || snapshotMatch?.taxonId) || null,
        projectObservationCount: Number(
          sourceItem.projectObservationCount ?? snapshotMatch?.researchGradeObservationCount ?? 0,
        ),
        taxonRank: sourceItem.taxonRank || snapshotMatch?.rank || "",
      };
      const identity = item.taxonId
        ? `taxon-${item.taxonId}`
        : norm(cleanName(item.scientific)) || norm([cleanName(item.common), item.family, cleanName(item.notes)].join("|"));
      const key = [item.sourceTier, norm(item.domain), identity].join("|");
      const existing = speciesByKey.get(key);

      if (!existing) {
        speciesByKey.set(key, { ...item });
        continue;
      }

      existing.group = preferredGroup(existing.group, item.group);
      existing.common = existing.common || item.common;
      existing.scientific = existing.scientific || item.scientific;
      existing.family = existing.family || item.family;
      existing.status = mergeText(existing.status, item.status);
      existing.notes = mergeText(existing.notes, item.notes);
      existing.hay = `${existing.hay} ${item.hay}`;
      existing.projectObservationCount = Math.max(existing.projectObservationCount, item.projectObservationCount);
    }

    species = Array.from(speciesByKey.values()).map((item, index) => {
      const nameInfo = getNameInfo(item);
      const aliases = aliasesFor(item);
      return {
        ...item,
        ...nameInfo,
        aliases,
        key: `species-${index}`,
        hay: norm(
          `${item.hay} ${item.evidenceLabel} ${nameInfo.displayName} ${nameInfo.sourceName} ${nameInfo.communityCommonName} ${nameInfo.noteCommonName} ${nameInfo.scientificName} ${aliases.join(" ")}`,
        ),
      };
    });
    speciesById = new Map(species.map((item) => [item.key, item]));
    groupsByDomain = species.reduce((acc, item) => {
      if (!item.domain || !item.group) return acc;
      if (!acc[item.domain]) acc[item.domain] = new Set();
      acc[item.domain].add(item.group);
      return acc;
    }, {});
  }

  function validateSnapshot(data) {
    if (
      data?.schemaVersion !== 1 ||
      data?.methodology?.qualityGrade !== "research" ||
      data?.dataset?.asOfDate !== snapshotDate ||
      !Array.isArray(data?.taxa)
    ) {
      throw new Error("The biodiversity snapshot schema or version is not valid.");
    }
    return data;
  }

  async function loadCommunitySnapshot() {
    if (communityLoaded) return;
    if (communityLoadPromise) return communityLoadPromise;

    communityLoadPromise = (async () => {
      const response = await fetch(snapshotUrl, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Community snapshot request failed (${response.status}).`);
      const data = validateSnapshot(await response.json());

      for (const taxon of data.taxa) {
        snapshotByTaxonId.set(Number(taxon.taxonId), taxon);
        snapshotByScientificName.set(norm(taxon.scientificName), taxon);
      }

      const communityRawSpecies = data.taxa.map((taxon) => ({
        sourceTier: "community",
        evidenceLabel: "Community-observed · Research Grade",
        taxonId: Number(taxon.taxonId),
        taxonRank: taxon.rank,
        domain: clean(taxon.domain),
        group: clean(taxon.group),
        common: clean(taxon.commonName),
        scientific: clean(taxon.scientificName),
        family: "",
        status: "",
        notes: "",
        projectObservationCount: Number(taxon.researchGradeObservationCount),
        hay: norm(`${taxon.domain} ${taxon.group} ${taxon.commonName} ${taxon.scientificName} Research Grade community observed`),
      }));

      rebuildSpecies([...referenceRawSpecies, ...communityRawSpecies]);
      communityLoaded = true;
      communityLoadError = "";
    })().catch((error) => {
      communityLoadError = error.message;
      throw error;
    });

    return communityLoadPromise;
  }

  rebuildSpecies(referenceRawSpecies);

  function populateGroupOptions() {
    const selectedSource = sourceEl.value;
    const selectedDomain = domainEl.value;
    const currentGroup = groupEl.value;
    const sourceRecords = selectedSource
      ? species.filter((item) => item.sourceTier === selectedSource)
      : species;
    const availableGroups = selectedDomain
      ? sortGroups(Array.from(new Set(sourceRecords.filter((item) => item.domain === selectedDomain).map((item) => item.group).filter(Boolean))))
      : sortGroups(Array.from(new Set(sourceRecords.map((item) => item.group).filter(Boolean))));

    groupEl.innerHTML = "";

    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = selectedDomain ? `All ${selectedDomain.toLowerCase()} groups` : "All groups";
    groupEl.appendChild(allOption);

    for (const group of availableGroups) {
      const option = document.createElement("option");
      option.value = group;
      option.textContent = group;
      groupEl.appendChild(option);
    }

    groupEl.value = availableGroups.includes(currentGroup) ? currentGroup : "";
  }

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
        <p class="bio-card-evidence" data-evidence="${escapeHTML(item.sourceTier)}">${escapeHTML(item.evidenceLabel)}</p>
        <div class="bio-card-head">
          <div class="bio-card-name-block">
            <h3 class="bio-card-title${item.displayIsScientific ? " is-scientific" : ""}">${escapeHTML(item.displayName)}</h3>
            ${item.showScientific ? `<p class="bio-card-scientific"><em>${escapeHTML(item.scientific)}</em></p>` : ""}
          </div>
          <button class="bio-inat-button" type="button" data-inat-key="${escapeHTML(item.key)}" ${item.scientificName ? "" : "disabled"}>iNaturalist</button>
        </div>
        ${item.communityCommonName && norm(item.communityCommonName) !== norm(item.displayName) ? `<p class="bio-card-meta"><strong>iNaturalist common name:</strong> ${escapeHTML(item.communityCommonName)}</p>` : ""}
        ${item.sourceName && item.displayIsScientific ? `<p class="bio-card-meta"><strong>Source name:</strong> ${escapeHTML(item.sourceName)}</p>` : ""}
        ${item.showNoteAsCommonName ? `<p class="bio-card-meta"><strong>Common note:</strong> ${escapeHTML(item.noteCommonName)}</p>` : ""}
        <p class="bio-card-meta"><strong>Category:</strong> ${escapeHTML(item.group)}${item.domain ? ` · <span>${escapeHTML(item.domain)}</span>` : ""}</p>
        ${item.taxonRank && item.taxonRank !== "species" ? `<p class="bio-card-meta"><strong>Taxonomic rank:</strong> ${escapeHTML(item.taxonRank)}</p>` : ""}
        ${item.sourceTier === "community" ? `<p class="bio-card-meta"><strong>Project evidence:</strong> ${formatNumber(item.projectObservationCount)} Research Grade observation${item.projectObservationCount === 1 ? "" : "s"} in the ${escapeHTML(snapshotDate)} snapshot</p>` : ""}
        ${item.status ? `<p class="bio-card-meta"><strong>Source status code:</strong> ${escapeHTML(item.status)}</p>` : ""}
        ${item.family ? `<p class="bio-card-meta"><strong>Family:</strong> ${escapeHTML(item.family)}</p>` : ""}
        ${item.aliases.length ? `<p class="bio-card-aliases"><strong>Also searched as:</strong> ${escapeHTML(item.aliases.join(", "))}</p>` : ""}
        ${item.noteText ? `<p class="bio-card-notes">${escapeHTML(item.noteText)}</p>` : ""}
      `;
      fragment.appendChild(article);
    }

    cardsEl.appendChild(fragment);
  }

  const inatModal = document.createElement("div");
  inatModal.className = "inat-modal";
  inatModal.hidden = true;
  inatModal.innerHTML = `
    <div class="inat-modal-backdrop" data-inat-close></div>
    <section class="inat-panel" role="dialog" aria-modal="true" aria-labelledby="inatModalTitle">
      <div class="inat-panel-head">
        <div>
          <p class="eyebrow">iNaturalist / MHTR Project</p>
          <h2 id="inatModalTitle">Species details</h2>
        </div>
        <button class="inat-close" type="button" data-inat-close aria-label="Close iNaturalist details">Close</button>
      </div>
      <div class="inat-modal-content"></div>
    </section>
  `;
  document.body.appendChild(inatModal);

  const inatTitle = inatModal.querySelector("#inatModalTitle");
  const inatContent = inatModal.querySelector(".inat-modal-content");
  let lastInatTrigger = null;
  let inatRequestId = 0;

  const formatNumber = (value) => Number(value || 0).toLocaleString("en-IN");
  const reusablePhotoLicenses = {
    cc0: { code: "cc0", label: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
    "cc-by": { code: "cc-by", label: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    "cc-by-sa": { code: "cc-by-sa", label: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" },
  };
  const inatObservationUrl = (taxon) =>
    taxon?.id
      ? `https://www.inaturalist.org/observations?project_id=${inatProjectSlug}&taxon_id=${taxon.id}`
      : `https://www.inaturalist.org/observations?project_id=${inatProjectSlug}`;
  const inatSearchUrl = (item) =>
    `https://www.inaturalist.org/search?q=${encodeURIComponent(item.scientificName || item.displayName)}`;

  function setInatModal(open) {
    inatModal.hidden = !open;
    document.documentElement.classList.toggle("has-modal", open);
    if (open) {
      inatModal.querySelector("[data-inat-close]")?.focus();
    } else if (lastInatTrigger) {
      lastInatTrigger.focus();
      lastInatTrigger = null;
    }
  }

  function chooseTaxon(results, item) {
    const requested = norm(item.scientificName);
    if (!results?.length) return null;
    if (!requested) return null;

    return (
      results.find((taxon) => norm(taxon.name) === requested) ||
      results.find((taxon) => norm(taxon.matched_term) === requested) ||
      null
    );
  }

  async function fetchJSON(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`iNaturalist request failed (${response.status})`);
    return response.json();
  }

  function photoAttributionName(photo) {
    const suppliedName = cleanName(photo?.attribution_name);
    if (suppliedName) return suppliedName;

    const attribution = cleanName(photo?.attribution);
    if (/^no rights reserved$/i.test(attribution) && norm(photo?.license_code) === "cc0") {
      return "Creator not supplied by iNaturalist";
    }
    if (!attribution) return "";

    return cleanName(
      attribution
        .replace(/^\s*(?:\(c\)|©)\s*/i, "")
        .replace(/,?\s*(?:some rights reserved|no rights reserved).*$/i, "")
        .replace(/,?\s*uploaded by .*$/i, ""),
    );
  }

  function normalizeReusablePhoto(photo, selection = {}) {
    const photoId = Number(photo?.id);
    const licence = reusablePhotoLicenses[norm(photo?.license_code)];
    const attributionName = photoAttributionName(photo);
    const squareUrl = cleanName(photo?.url || photo?.square_url);
    const imageUrl = cleanName(photo?.medium_url) || squareUrl.replace(/\/square(?=\.[a-z0-9]+(?:\?|$))/i, "/medium");
    const width = Number(photo?.original_dimensions?.width || 0);
    const height = Number(photo?.original_dimensions?.height || 0);
    const flags = Array.isArray(photo?.flags) ? photo.flags : [];
    const moderatorActions = Array.isArray(photo?.moderator_actions) ? photo.moderator_actions : [];

    if (
      !Number.isInteger(photoId) ||
      photoId <= 0 ||
      !licence ||
      !attributionName ||
      !/^https:\/\//i.test(imageUrl) ||
      photo?.hidden === true ||
      flags.length ||
      moderatorActions.length
    ) {
      return null;
    }

    return {
      attributionName,
      imageUrl,
      licenceCode: licence.code,
      licenceLabel: licence.label,
      licenceUrl: licence.url,
      sourceUrl: `https://www.inaturalist.org/photos/${photoId}`,
      width,
      height,
      selectionVotes: Number(selection.votes || 0),
      selectionMinDimension: width && height ? Math.min(width, height) : 0,
      selectionArea: width * height,
      selectionAspectDistance: width && height ? Math.abs(Math.log(width / height)) : Number.POSITIVE_INFINITY,
      selectionPhotoId: photoId,
    };
  }

  function renderablePhotoMetadata(photo) {
    if (!photo) return null;
    return {
      attributionName: photo.attributionName,
      imageUrl: photo.imageUrl,
      licenceCode: photo.licenceCode,
      licenceLabel: photo.licenceLabel,
      licenceUrl: photo.licenceUrl,
      sourceUrl: photo.sourceUrl,
      width: photo.width,
      height: photo.height,
    };
  }

  function chooseReusableObservationPhoto(observations, requestedTaxonId) {
    const candidates = [];

    for (const observation of observations || []) {
      if (Number(observation?.taxon?.id) !== Number(requestedTaxonId)) continue;
      const votes = Number(observation?.faves_count || observation?.cached_votes_total || 0);
      for (const photo of observation?.photos || []) {
        const candidate = normalizeReusablePhoto(photo, { votes });
        if (candidate) candidates.push(candidate);
      }
    }

    candidates.sort((a, b) =>
      b.selectionVotes - a.selectionVotes ||
      b.selectionMinDimension - a.selectionMinDimension ||
      b.selectionArea - a.selectionArea ||
      a.selectionAspectDistance - b.selectionAspectDistance ||
      a.selectionPhotoId - b.selectionPhotoId,
    );

    const selected = candidates[0];
    if (!selected) return null;

    return renderablePhotoMetadata(selected);
  }

  async function fetchReusableObservationPhoto(taxonId) {
    const params = new URLSearchParams({
      taxon_id: String(Number(taxonId)),
      quality_grade: "research",
      photos: "true",
      photo_license: "cc0,cc-by,cc-by-sa",
      per_page: "10",
      order_by: "votes",
      order: "desc",
      fields:
        "taxon.id,photos.id,photos.url,photos.license_code,photos.attribution,photos.original_dimensions.width,photos.original_dimensions.height,faves_count",
    });
    const data = await fetchJSON(`https://api.inaturalist.org/v2/observations?${params}`);
    return chooseReusableObservationPhoto(data.results, taxonId);
  }

  function normalizeTaxon(taxon) {
    if (!taxon?.id || !taxon?.name) return null;
    return {
      id: Number(taxon.id),
      name: cleanName(taxon.name),
      preferredCommonName: cleanName(taxon.preferred_common_name),
      observationsCount: Number(taxon.observations_count || 0),
    };
  }

  async function fetchInatDetails(item) {
    const cacheKey = item.taxonId ? `taxon-${item.taxonId}` : item.scientificName || item.displayName;
    if (inatCache.has(cacheKey)) return inatCache.get(cacheKey);

    let rawTaxon = null;
    if (item.taxonId) {
      const taxaData = await fetchJSON(`${inatApi}/taxa/${Number(item.taxonId)}?locale=en`);
      rawTaxon = taxaData.results?.[0] || null;
    } else {
      const query = item.scientificName || item.displayName;
      const taxaData = await fetchJSON(`${inatApi}/taxa?q=${encodeURIComponent(query)}&per_page=8&locale=en`);
      rawTaxon = chooseTaxon(taxaData.results || [], item);
    }

    const taxon = normalizeTaxon(rawTaxon);
    let photo = renderablePhotoMetadata(normalizeReusablePhoto(rawTaxon?.default_photo));
    if (!photo && taxon?.id) {
      try {
        photo = await fetchReusableObservationPhoto(taxon.id);
      } catch {
        photo = null;
      }
    }

    const snapshotTaxon = taxon?.id
      ? snapshotByTaxonId.get(taxon.id)
      : snapshotByScientificName.get(norm(item.scientificName));
    const details = {
      taxon,
      photo,
      projectObservationCount: snapshotTaxon
        ? Number(snapshotTaxon.researchGradeObservationCount)
        : communityLoaded
          ? 0
          : null,
    };
    inatCache.set(cacheKey, details);
    return details;
  }

  function renderInatLoading(item) {
    inatTitle.textContent = item.displayName;
    inatContent.innerHTML = `
      <div class="inat-loading" role="status" aria-live="polite">
        <div class="inat-loading-visual" aria-hidden="true">
          <span class="inat-spinner"></span>
          <span class="inat-skeleton-photo"></span>
        </div>
        <div class="inat-loading-copy">
          <p class="eyebrow">Fetching Live Data</p>
          <p><strong>${escapeHTML(item.scientificName || item.displayName)}</strong></p>
          <p class="muted">Checking accepted iNaturalist taxonomy and reusable reference media. Project evidence counts come from the dated local snapshot.</p>
          <div class="inat-skeleton-lines" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      </div>
    `;
  }

  function renderInatError(item, message) {
    inatTitle.textContent = item.displayName;
    inatContent.innerHTML = `
      <div class="inat-empty">
        <p>${escapeHTML(message || "No matching iNaturalist taxon was found for this record.")}</p>
        <div class="inat-actions">
          <a class="button-link" href="${sourceUrl(inatSearchUrl(item))}" target="_blank" rel="noopener">Search iNaturalist</a>
          <a class="button-link button-link-secondary" href="${sourceUrl(inatProjectUrl)}" target="_blank" rel="noopener">Open MHTR project</a>
        </div>
      </div>
    `;
  }

  function renderInatDetails(item, details) {
    const taxon = details.taxon;

    if (!taxon) {
      renderInatError(item);
      return;
    }

    const modalTitle = item.displayName;
    const preferredName = cleanName(taxon.preferredCommonName);
    const acceptedScientificName = cleanName(taxon.name);
    const imageName = preferredName || modalTitle;
    const photo = details.photo;
    const image = photo?.imageUrl || "";
    const taxonUrl = `https://www.inaturalist.org/taxa/${taxon.id}`;
    const observationUrl = inatObservationUrl(taxon);
    const projectObservationCount = details.projectObservationCount;

    // Keep the dialog's accessible name stable while live iNaturalist data loads.
    // Common-name and taxonomy updates belong in the details, not in the heading.
    inatTitle.textContent = modalTitle;
    inatContent.innerHTML = `
      <div class="inat-detail-grid${image ? "" : " inat-detail-grid--no-photo"}">
        ${image ? `
          <figure class="inat-taxon-photo">
            <img
              src="${sourceUrl(image)}"
              alt="${escapeHTML(imageName)} identification reference on iNaturalist"
              ${photo.width && photo.height ? `width="${photo.width}" height="${photo.height}"` : ""}
              loading="lazy"
              decoding="async">
            <figcaption>
              Global identification reference; not evidence of an MHTR record.<br>
              Photograph: ${escapeHTML(photo.attributionName)}<br>
              <a href="${sourceUrl(photo.licenceUrl)}" target="_blank" rel="license noopener">${escapeHTML(photo.licenceLabel)}</a>
              ·
              <a href="${sourceUrl(photo.sourceUrl)}" target="_blank" rel="noopener">Source photo on iNaturalist</a>
            </figcaption>
          </figure>
        ` : ""}
        <div class="inat-summary">
          ${preferredName && norm(preferredName) !== norm(modalTitle) ? `<p><strong>iNaturalist common name:</strong> ${escapeHTML(preferredName)}</p>` : ""}
          ${acceptedScientificName && norm(acceptedScientificName) !== norm(modalTitle) ? `<p class="bio-card-scientific"><strong>iNaturalist taxon:</strong> <em>${escapeHTML(acceptedScientificName)}</em></p>` : ""}
          ${item.sourceName && norm(item.sourceName) !== norm(modalTitle) && norm(item.sourceName) !== norm(preferredName) ? `<p><strong>Source/local name:</strong> ${escapeHTML(item.sourceName)}</p>` : ""}
          <div class="inat-stat-row">
            <span>${formatNumber(taxon.observationsCount)} global iNaturalist observations (live)</span>
            ${projectObservationCount === null ? "" : `<span>${formatNumber(projectObservationCount)} Research Grade project observation${projectObservationCount === 1 ? "" : "s"} (${escapeHTML(snapshotDate)} snapshot)</span>`}
          </div>
          <p class="muted">Project counts are records, not population or abundance estimates. The project covers its custom MHTR Kota place, including the reserve landscape and surrounding urban-rural areas.</p>
          ${image ? "" : `<p class="muted">No taxon reference image carrying a permitted CC0, CC BY or CC BY-SA licence was available through the iNaturalist API.</p>`}
          <div class="inat-actions">
            <a class="button-link" href="${sourceUrl(observationUrl)}" target="_blank" rel="noopener">View source records on iNaturalist</a>
            <a class="button-link button-link-secondary" href="${sourceUrl(taxonUrl)}" target="_blank" rel="noopener">Open taxon page</a>
            <a class="button-link button-link-secondary" href="${sourceUrl(snapshotUrl)}">Download snapshot</a>
          </div>
        </div>
      </div>
      <section class="inat-safeguards" aria-label="Evidence scope and privacy safeguards">
        <h3>Evidence scope and safeguards</h3>
        <p>
          MHTR.in publishes only the aggregate Research Grade count for this taxon. Coordinates, observation dates,
          observer names, observation identifiers and recent-record sequences are not reproduced here. Record-level
          identifications and geoprivacy remain under iNaturalist’s controls at the source.
        </p>
      </section>
    `;
  }

  async function openInatDetails(item, trigger) {
    const requestId = ++inatRequestId;
    lastInatTrigger = trigger;
    trigger?.setAttribute("aria-busy", "true");
    renderInatLoading(item);
    setInatModal(true);

    try {
      await loadCommunitySnapshot().catch(() => {});
      const details = await fetchInatDetails(item);
      if (requestId === inatRequestId && !inatModal.hidden) renderInatDetails(item, details);
    } catch (error) {
      if (requestId === inatRequestId && !inatModal.hidden) renderInatError(item, error.message);
    } finally {
      trigger?.removeAttribute("aria-busy");
    }
  }

  cardsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-inat-key]");
    if (!button) return;

    const item = speciesById.get(button.dataset.inatKey);
    if (item) openInatDetails(item, button);
  });

  inatModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-inat-close]")) setInatModal(false);
  });

  document.addEventListener("keydown", (event) => {
    if (!inatModal.hidden && event.key === "Escape") setInatModal(false);
  });

  function applyFilters() {
    const q = norm(searchEl.value);
    const source = norm(sourceEl.value);
    const domain = norm(domainEl.value);
    const group = norm(groupEl.value);

    if ((source === "community" || !source) && !communityLoaded) {
      if (communityLoadError) {
        countEl.textContent = "Community snapshot unavailable";
        cardsEl.innerHTML = `<p class="muted">${escapeHTML(communityLoadError)}</p>`;
      } else {
        countEl.textContent = "Loading the dated community snapshot…";
        cardsEl.innerHTML = '<p class="muted">Loading Research Grade taxon records from the local snapshot…</p>';
      }
      return;
    }

    const sourceRecords = species.filter((item) => !source || norm(item.sourceTier) === source);
    const visible = sourceRecords.filter((item) => {
      const okDomain = !domain || norm(item.domain) === domain;
      const okGroup = !group || norm(item.group) === group;
      const okQuery = !q || item.hay.includes(q);
      return okDomain && okGroup && okQuery;
    });

    const layerLabel = source === "reference"
      ? "published-reference records"
      : source === "community"
        ? `community taxon entries (${snapshotDate} snapshot)`
        : "records across both evidence layers";
    countEl.textContent = `Showing ${visible.length} of ${sourceRecords.length} ${layerLabel}`;
    renderCards(visible);
  }

  searchEl.addEventListener("input", applyFilters);
  groupEl.addEventListener("change", applyFilters);
  sourceEl.addEventListener("change", async () => {
    if (sourceEl.value !== "reference" && !communityLoaded) {
      applyFilters();
      await loadCommunitySnapshot().catch(() => {});
    }
    populateGroupOptions();
    applyFilters();
  });
  domainEl.addEventListener("change", () => {
    populateGroupOptions();
    applyFilters();
  });

  populateGroupOptions();
  const initialQuery = clean(new URLSearchParams(window.location.search).get("q"));
  if (initialQuery) {
    searchEl.value = initialQuery;
    sourceEl.value = "";
  }
  applyFilters();
  loadCommunitySnapshot()
    .then(() => {
      populateGroupOptions();
      applyFilters();
    })
    .catch(() => applyFilters());
})();
