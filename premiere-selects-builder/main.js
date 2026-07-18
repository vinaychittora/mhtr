(function () {
  "use strict";

  const fs = require("fs");
  const path = require("path");
  const status = document.getElementById("status");

  const categories = {
    arjuna: {
      folder: "Arjuna Sap",
      sequence: "01 - Arjuna Sap - Selects"
    },
    birds: {
      folder: "general birds",
      sequence: "03 - General Birds - Selects"
    },
    animals: {
      folder: "Lizards and other animals",
      sequence: "04 - Lizards & Other Animals - Selects"
    },
    nestings: {
      folder: "Nestings",
      sequence: "05 - Nestings - Selects"
    },
    sarus: {
      folder: "Sarus and other wadders",
      sequence: "06 - Sarus & Other Waders - Selects"
    }
  };

  function evalScript(script) {
    return new Promise(function (resolve) {
      window.__adobe_cep__.evalScript(script, resolve);
    });
  }

  function walk(folder) {
    let files = [];
    fs.readdirSync(folder, { withFileTypes: true }).forEach(function (entry) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(walk(full));
      } else if (/\.(mov|mp4|mxf)$/i.test(entry.name)) {
        const stat = fs.statSync(full);
        files.push({ path: full, time: stat.mtimeMs });
      }
    });
    return files;
  }

  function escapeJs(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/\"/g, "\\\"");
  }

  async function build(key, button) {
    const cfg = categories[key];
    const root = "F:\\Mandirgarh\\shots\\" + cfg.folder;
    button.disabled = true;
    try {
      status.textContent = "Scanning " + cfg.folder + "…";
      const files = walk(root).sort(function (a, b) {
        return a.time - b.time || a.path.localeCompare(b.path);
      }).map(function (item) { return item.path; });

      status.textContent = "Found " + files.length + " clips. Importing and building sequence…";
      const payload = encodeURIComponent(JSON.stringify(files));
      const result = await evalScript(
        '$._selects.buildSequence("' + escapeJs(cfg.folder) + '","' +
        escapeJs(cfg.sequence) + '","' + payload + '")'
      );
      status.textContent = result;
    } catch (error) {
      status.textContent = "ERROR: " + error.message;
    } finally {
      button.disabled = false;
    }
  }

  document.querySelectorAll("button[data-key]").forEach(function (button) {
    button.addEventListener("click", function () {
      build(button.getAttribute("data-key"), button);
    });
  });

  document.getElementById("rename-broll").addEventListener("click", async function () {
    status.textContent = await evalScript(
      '$._selects.renameSequence("DSCF8256","02 - B-Rolls & Habitat - Selects")'
    );
  });
})();
