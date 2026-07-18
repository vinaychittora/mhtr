/* global app, $, Folder, JSON, decodeURIComponent */
$._selects = {
  normalizePath: function (value) {
    return String(value || "").replace(/\\/g, "/").toLowerCase();
  },

  findBin: function (parent, name) {
    var children = parent.children;
    for (var i = 0; i < children.numItems; i++) {
      var child = children[i];
      if (child && child.name === name && child.type === ProjectItemType.BIN) {
        return child;
      }
    }
    return null;
  },

  findOrCreateBin: function (parent, name) {
    var found = this.findBin(parent, name);
    if (found) { return found; }
    parent.createBin(name);
    return this.findBin(parent, name);
  },

  collectMedia: function (parent, map) {
    var children = parent.children;
    for (var i = 0; i < children.numItems; i++) {
      var item = children[i];
      if (!item) { continue; }
      if (item.type === ProjectItemType.BIN) {
        this.collectMedia(item, map);
      } else {
        try {
          var mediaPath = item.getMediaPath();
          if (mediaPath) { map[this.normalizePath(mediaPath)] = item; }
        } catch (ignore) {}
      }
    }
  },

  findSequence: function (name) {
    var sequences = app.project.sequences;
    for (var i = 0; i < sequences.numSequences; i++) {
      if (sequences[i].name === name) { return sequences[i]; }
    }
    return null;
  },

  renameSequence: function (oldName, newName) {
    try {
      var existing = this.findSequence(newName);
      if (existing) { return "Already named: " + newName; }
      var sequence = this.findSequence(oldName);
      if (!sequence) { return "Could not find sequence: " + oldName; }
      sequence.name = newName;
      return "Renamed to: " + newName;
    } catch (error) {
      return "ERROR: " + error.toString();
    }
  },

  buildSequence: function (folderName, sequenceName, encodedPaths) {
    try {
      if (!app.project) { return "ERROR: No Premiere project is open."; }
      if (this.findSequence(sequenceName)) {
        return "Skipped: sequence already exists: " + sequenceName;
      }

      var paths = JSON.parse(decodeURIComponent(encodedPaths));
      if (!paths || !paths.length) { return "ERROR: No media files found."; }

      var root = app.project.rootItem;
      var mediaRoot = this.findOrCreateBin(root, "Selects Source Media");
      var mediaBin = this.findOrCreateBin(mediaRoot, folderName);
      var sequenceBin = this.findOrCreateBin(root, "Selects Sequences");

      var known = {};
      this.collectMedia(root, known);
      var missing = [];
      for (var i = 0; i < paths.length; i++) {
        if (!known[this.normalizePath(paths[i])]) { missing.push(paths[i]); }
      }

      if (missing.length) {
        var imported = app.project.importFiles(missing, true, mediaBin, false);
        if (!imported) { return "ERROR: Premiere could not import the media."; }
      }

      known = {};
      this.collectMedia(root, known);
      var orderedItems = [];
      var unresolved = [];
      for (var j = 0; j < paths.length; j++) {
        var item = known[this.normalizePath(paths[j])];
        if (item) { orderedItems.push(item); }
        else { unresolved.push(paths[j]); }
      }

      if (!orderedItems.length) { return "ERROR: Imported media could not be resolved."; }
      var sequence = app.project.createNewSequenceFromClips(sequenceName, orderedItems, sequenceBin);
      if (!sequence) { return "ERROR: Premiere could not create the sequence."; }

      return "Created " + sequenceName + "\n" +
        "Ordered clips: " + orderedItems.length + "\n" +
        "New imports: " + missing.length + "\n" +
        "Unresolved: " + unresolved.length;
    } catch (error) {
      return "ERROR: " + error.toString() + (error.line ? " (line " + error.line + ")" : "");
    }
  }
};
