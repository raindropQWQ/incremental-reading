var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __markAsModule = (target) => __defProp(target, "__esModule", { value: true });
var __export = (target, all) => {
  __markAsModule(target);
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __reExport = (target, module2, desc) => {
  if (module2 && typeof module2 === "object" || typeof module2 === "function") {
    for (let key of __getOwnPropNames(module2))
      if (!__hasOwnProp.call(target, key) && key !== "default")
        __defProp(target, key, { get: () => module2[key], enumerable: !(desc = __getOwnPropDesc(module2, key)) || desc.enumerable });
  }
  return target;
};
var __toModule = (module2) => {
  return __reExport(__markAsModule(__defProp(module2 != null ? __create(__getProtoOf(module2)) : {}, "default", module2 && module2.__esModule && "default" in module2 ? { get: () => module2.default, enumerable: true } : { value: module2, enumerable: true })), module2);
};

// main.ts
__export(exports, {
  default: () => ReviewSchedulerPlugin
});
var import_obsidian = __toModule(require("obsidian"));
var DEFAULT_SETTINGS = {
  multiplier: 1.5,
  randomness: 0.1,
  priorityMultipliers: {
    high: 0.8,
    medium: 1,
    low: 1.2
  },
  enableShuffle: true,
  enablePriorityPromotion: true,
  promotionChance: 0.05,
  jumpAfterReview: "top",
  hotkeys: {
    startReview: "ctrl+shift+r",
    deleteNote: "ctrl+shift+d",
    setPriorityHigh: "ctrl+shift+1",
    setPriorityMedium: "ctrl+shift+2",
    setPriorityLow: "ctrl+shift+3"
  }
};
var ReviewSchedulerPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.reviewQueue = [];
  }
  async onload() {
    await this.loadSettings();
    const debouncedScan = (0, import_obsidian.debounce)(() => this.scanNotesForReview(), 500, true);
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof import_obsidian.TFile && file.extension === "md")
        debouncedScan();
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof import_obsidian.TFile && file.extension === "md")
        debouncedScan();
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof import_obsidian.TFile && file.extension === "md")
        debouncedScan();
    }));
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (file instanceof import_obsidian.TFile && file.extension === "md")
        debouncedScan();
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      var _a;
      (_a = this.getView()) == null ? void 0 : _a.updateHighlights();
    }));
    this.registerView("review-scheduler-view", (leaf) => new ReviewSchedulerView(leaf, this));
    this.addCommand({ id: "open-review-scheduler", name: "\u6253\u5F00\u590D\u4E60\u6392\u7A0B\u5668", callback: () => this.activateView() });
    this.addCommand({ id: "review-next", name: "\u590D\u4E60\uFF1A\u4E0B\u4E00\u6B65", checkCallback: (checking) => {
      const note = this.getNoteForAction();
      if (note) {
        if (!checking) {
          this.handleNext(note);
        }
        return true;
      }
      return false;
    } });
    this.addCommand({ id: "review-set-aside", name: "\u590D\u4E60\uFF1A\u6401\u7F6E", checkCallback: (checking) => {
      const note = this.getNoteForAction();
      if (note) {
        if (!checking) {
          this.handleSetAside(note);
        }
        return true;
      }
      return false;
    } });
    this.addCommand({ id: "review-start", name: "\u590D\u4E60\uFF1A\u5F00\u59CB\u590D\u4E60", checkCallback: (checking) => {
      const note = this.getNoteForAction();
      if (note) {
        if (!checking) {
          this.app.workspace.getLeaf(true).openFile(note.file);
        }
        return true;
      }
      return false;
    } });
    this.addCommand({ id: "review-delete", name: "\u590D\u4E60\uFF1A\u5220\u9664\u5F53\u524D\u7B14\u8BB0", checkCallback: (checking) => {
      const note = this.getNoteForAction();
      if (note) {
        if (!checking) {
          this.handleDelete(note);
        }
        return true;
      }
      return false;
    } });
    this.addCommand({ id: "review-set-priority-high", name: "\u590D\u4E60\uFF1A\u8BBE\u7F6E\u4E3A\u9AD8\u4F18\u5148\u7EA7", checkCallback: (checking) => {
      const note = this.getNoteForAction();
      if (note) {
        if (!checking) {
          this.setNotePriority(note, "high").then(() => this.scanNotesForReview());
        }
        return true;
      }
      return false;
    } });
    this.addCommand({ id: "review-set-priority-medium", name: "\u590D\u4E60\uFF1A\u8BBE\u7F6E\u4E3A\u4E2D\u4F18\u5148\u7EA7", checkCallback: (checking) => {
      const note = this.getNoteForAction();
      if (note) {
        if (!checking) {
          this.setNotePriority(note, "medium").then(() => this.scanNotesForReview());
        }
        return true;
      }
      return false;
    } });
    this.addCommand({ id: "review-set-priority-low", name: "\u590D\u4E60\uFF1A\u8BBE\u7F6E\u4E3A\u4F4E\u4F18\u5148\u7EA7", checkCallback: (checking) => {
      const note = this.getNoteForAction();
      if (note) {
        if (!checking) {
          this.setNotePriority(note, "low").then(() => this.scanNotesForReview());
        }
        return true;
      }
      return false;
    } });
    this.addCommand({ id: "review-set-custom-date", name: "\u590D\u4E60\uFF1A\u8BBE\u7F6E\u81EA\u5B9A\u4E49\u590D\u4E60\u65E5\u671F", checkCallback: (checking) => {
      const note = this.getNoteForAction();
      if (note) {
        if (!checking) {
          new SetReviewDateModal(this.app, note, this).open();
        }
        return true;
      }
      return false;
    } });
    this.addSettingTab(new ReviewSchedulerSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => this.scanNotesForReview());
  }
  getView() {
    const leaf = this.app.workspace.getLeavesOfType("review-scheduler-view")[0];
    return leaf ? leaf.view : null;
  }
  getNoteForAction() {
    const activeView = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
    if (activeView) {
      const activeFile = activeView.file;
      if (activeFile) {
        const noteInQueue = this.reviewQueue.find((n) => n.file.path === activeFile.path);
        if (noteInQueue)
          return noteInQueue;
      }
    }
    const dueNotes = this.reviewQueue.filter((n) => new Date(n.reviewDate).setHours(0, 0, 0, 0) <= new Date().setHours(0, 0, 0, 0));
    return dueNotes.length > 0 ? dueNotes[0] : null;
  }
  refreshView() {
    var _a;
    (_a = this.getView()) == null ? void 0 : _a.render();
  }
  async scanNotesForReview(newNotePath) {
    var _a, _b, _c;
    this.reviewQueue = [];
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const metadata = this.app.metadataCache.getFileCache(file);
      let hasReviewTag = false;
      let priority = null;
      if ((_a = metadata == null ? void 0 : metadata.frontmatter) == null ? void 0 : _a.tags) {
        const tags = Array.isArray(metadata.frontmatter.tags) ? metadata.frontmatter.tags : String(metadata.frontmatter.tags).split(/\s+/);
        hasReviewTag = tags.some((tag) => String(tag).toLowerCase().includes("review"));
        if (tags.includes("priority-high"))
          priority = "high";
        else if (tags.includes("priority-medium"))
          priority = "medium";
        else if (tags.includes("priority-low"))
          priority = "low";
      }
      if (!hasReviewTag && (metadata == null ? void 0 : metadata.tags)) {
        hasReviewTag = metadata.tags.some((tag) => tag.tag.toLowerCase().includes("#review"));
        if (!priority) {
          if (metadata.tags.some((tag) => tag.tag === "#priority-high"))
            priority = "high";
          else if (metadata.tags.some((tag) => tag.tag === "#priority-medium"))
            priority = "medium";
          else if (metadata.tags.some((tag) => tag.tag === "#priority-low"))
            priority = "low";
        }
      }
      if (!hasReviewTag)
        continue;
      const today2 = new Date();
      today2.setHours(0, 0, 0, 0);
      const reviewDate = ((_b = metadata == null ? void 0 : metadata.frontmatter) == null ? void 0 : _b.reviewDate) ? new Date(metadata.frontmatter.reviewDate) : today2;
      const repHistory = ((_c = metadata == null ? void 0 : metadata.frontmatter) == null ? void 0 : _c.repHistory) || [];
      this.reviewQueue.push({ file, reviewDate, repHistory, priority });
    }
    this.reviewQueue.sort((a, b) => {
      const dateCompare = a.reviewDate.getTime() - b.reviewDate.getTime();
      if (dateCompare !== 0)
        return dateCompare;
      return a.file.stat.ctime - b.file.stat.ctime;
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueNotes = this.reviewQueue.filter((note) => new Date(note.reviewDate).setHours(0, 0, 0, 0) <= today.getTime());
    const upcomingNotes = this.reviewQueue.filter((note) => new Date(note.reviewDate).setHours(0, 0, 0, 0) > today.getTime());
    let priorityGroups = {
      high: dueNotes.filter((n) => n.priority === "high"),
      medium: dueNotes.filter((n) => n.priority === "medium"),
      low: dueNotes.filter((n) => n.priority === "low"),
      none: dueNotes.filter((n) => n.priority === null)
    };
    if (this.settings.enablePriorityPromotion) {
      const promotedFromLow = [];
      priorityGroups.low.forEach((note) => {
        if (Math.random() < this.settings.promotionChance) {
          promotedFromLow.push(note);
        }
      });
      priorityGroups.medium.push(...promotedFromLow);
      priorityGroups.low = priorityGroups.low.filter((note) => !promotedFromLow.includes(note));
      const promotedFromMedium = [];
      priorityGroups.medium.forEach((note) => {
        if (Math.random() < this.settings.promotionChance) {
          promotedFromMedium.push(note);
        }
      });
      priorityGroups.high.push(...promotedFromMedium);
      priorityGroups.medium = priorityGroups.medium.filter((note) => !promotedFromMedium.includes(note));
    }
    if (this.settings.enableShuffle) {
      const shuffle = (array) => {
        for (let i = array.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
      };
      priorityGroups.high = shuffle(priorityGroups.high);
      priorityGroups.medium = shuffle(priorityGroups.medium);
      priorityGroups.low = shuffle(priorityGroups.low);
      priorityGroups.none = shuffle(priorityGroups.none);
    }
    this.reviewQueue = [...priorityGroups.high, ...priorityGroups.medium, ...priorityGroups.low, ...priorityGroups.none, ...upcomingNotes];
    if (newNotePath) {
      const newNoteIndex = this.reviewQueue.findIndex((n) => n.file.path === newNotePath);
      if (newNoteIndex > -1) {
        const [newNote] = this.reviewQueue.splice(newNoteIndex, 1);
        const currentNote = this.getNoteForAction();
        const currentIndex = currentNote ? this.reviewQueue.findIndex((n) => n.file.path === currentNote.file.path) : -1;
        this.reviewQueue.splice(currentIndex + 1, 0, newNote);
      }
    }
    this.refreshView();
  }
  calculateNextReviewDate(repHistory, priority = null) {
    const today = new Date();
    const interval = Math.ceil(this.settings.multiplier ** Math.max(repHistory.length, 1));
    const priorityMultiplier = priority ? this.settings.priorityMultipliers[priority] : 1;
    const adjustedInterval = Math.ceil(interval * priorityMultiplier);
    const randomFuzz = (Math.random() - 0.5) * 2 * this.settings.randomness;
    const finalInterval = Math.max(1, Math.round(adjustedInterval * (1 + randomFuzz)));
    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + finalInterval);
    return nextDate;
  }
  async handleAction(note, isNext) {
    var _a;
    const originalPath = note.file.path;
    const dueNotesBeforeAction = this.reviewQueue.filter((n) => new Date(n.reviewDate).setHours(0, 0, 0, 0) <= new Date().setHours(0, 0, 0, 0));
    const originalIndex = dueNotesBeforeAction.findIndex((n) => n.file.path === originalPath);
    const nextNoteInList = originalIndex > -1 && originalIndex < dueNotesBeforeAction.length - 1 ? dueNotesBeforeAction[originalIndex + 1] : null;
    if (isNext) {
      note.repHistory.push(new Date());
      note.reviewDate = this.calculateNextReviewDate(note.repHistory, note.priority);
      await this.updateNoteMetadata(note.file, note.reviewDate, note.repHistory);
      new import_obsidian.Notice(`\u7B14\u8BB0 "${note.file.basename}" \u5DF2\u6392\u7A0B\u5230 ${note.reviewDate.toLocaleDateString()}`);
    } else {
      await this.removeNoteReviewMetadata(note.file);
      new import_obsidian.Notice(`\u7B14\u8BB0 "${note.file.basename}" \u5DF2\u4ECE\u590D\u4E60\u961F\u5217\u4E2D\u79FB\u9664`);
    }
    await this.scanNotesForReview();
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (leaf.view instanceof import_obsidian.MarkdownView && ((_a = leaf.view.file) == null ? void 0 : _a.path) === originalPath) {
        leaf.detach();
        break;
      }
    }
    if (this.settings.jumpAfterReview !== "off") {
      const dueNotesAfterAction = this.reviewQueue.filter((n) => new Date(n.reviewDate).setHours(0, 0, 0, 0) <= new Date().setHours(0, 0, 0, 0));
      if (dueNotesAfterAction.length > 0) {
        let noteToOpen = null;
        if (this.settings.jumpAfterReview === "next" && nextNoteInList) {
          const nextNoteStillExists = dueNotesAfterAction.find((n) => n.file.path === nextNoteInList.file.path);
          if (nextNoteStillExists) {
            noteToOpen = nextNoteStillExists.file;
          }
        }
        if (!noteToOpen) {
          noteToOpen = dueNotesAfterAction[0].file;
        }
        this.app.workspace.getLeaf(true).openFile(noteToOpen);
      }
    }
  }
  async handleNext(note) {
    await this.handleAction(note, true);
  }
  async handleSetAside(note) {
    await this.handleAction(note, false);
  }
  async handleDelete(currentNote) {
    var _a;
    const confirmDelete = await new Promise((resolve) => {
      const modal = new import_obsidian.Modal(this.app);
      modal.contentEl.createEl("h2", { text: "\u786E\u8BA4\u5220\u9664" });
      modal.contentEl.createEl("p", { text: `\u786E\u5B9A\u8981\u5220\u9664\u7B14\u8BB0 "${currentNote.file.basename}" \u5417\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002` });
      const buttonContainer = modal.contentEl.createDiv({ cls: "modal-button-container" });
      const confirmButton = buttonContainer.createEl("button", { text: "\u5220\u9664", cls: "mod-warning" });
      confirmButton.addEventListener("click", () => {
        resolve(true);
        modal.close();
      });
      const cancelButton = buttonContainer.createEl("button", { text: "\u53D6\u6D88" });
      cancelButton.addEventListener("click", () => {
        resolve(false);
        modal.close();
      });
      modal.open();
    });
    if (!confirmDelete)
      return;
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (leaf.view instanceof import_obsidian.MarkdownView && ((_a = leaf.view.file) == null ? void 0 : _a.path) === currentNote.file.path) {
        leaf.detach();
        break;
      }
    }
    this.reviewQueue = this.reviewQueue.filter((n) => n.file.path !== currentNote.file.path);
    await this.app.vault.delete(currentNote.file);
    if (this.reviewQueue.length > 0) {
      const nextNote = this.reviewQueue[0];
      if (nextNote) {
        this.app.workspace.getLeaf(true).openFile(nextNote.file);
      }
    }
    this.refreshView();
    new import_obsidian.Notice(`\u7B14\u8BB0 "${currentNote.file.basename}" \u5DF2\u6C38\u4E45\u5220\u9664`);
  }
  onunload() {
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async activateView() {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType("review-scheduler-view");
    if (leaves.length > 0) {
      workspace.revealLeaf(leaves[0]);
      return;
    }
    const leaf = workspace.getLeftLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: "review-scheduler-view", active: true });
      workspace.revealLeaf(leaf);
    }
  }
  async updateNoteMetadata(file, reviewDate, repHistory) {
    var _a;
    const content = await this.app.vault.read(file);
    const frontmatter = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
    if (!frontmatter) {
      const newContent = `---
reviewDate: ${reviewDate.toISOString()}
repHistory: ${JSON.stringify(repHistory)}
tags: [review]
---

${content}`;
      await this.app.vault.modify(file, newContent);
    } else {
      let newContent = content;
      const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
      const match = content.match(frontmatterRegex);
      if (match) {
        let frontmatterContent = match[1];
        if (frontmatterContent.includes("reviewDate:")) {
          frontmatterContent = frontmatterContent.replace(/reviewDate:.*/, `reviewDate: ${reviewDate.toISOString()}`);
        } else {
          frontmatterContent += `
reviewDate: ${reviewDate.toISOString()}`;
        }
        if (frontmatterContent.includes("repHistory:")) {
          frontmatterContent = frontmatterContent.replace(/repHistory:.*/, `repHistory: ${JSON.stringify(repHistory)}`);
        } else {
          frontmatterContent += `
repHistory: ${JSON.stringify(repHistory)}`;
        }
        newContent = content.replace(frontmatterRegex, `---
${frontmatterContent}
---`);
        await this.app.vault.modify(file, newContent);
      }
    }
  }
  async removeNoteReviewMetadata(file) {
    let content = await this.app.vault.read(file);
    let newContent = content;
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);
    if (match) {
      let frontmatterContent = match[1];
      frontmatterContent = frontmatterContent.replace(/reviewDate:.*\n?/, "").replace(/repHistory:.*\n?/, "").replace(/sr-due:.*\n?/, "").replace(/sr-interval:.*\n?/, "").replace(/sr-ease:.*\n?/, "");
      if (frontmatterContent.includes("tags:")) {
        frontmatterContent = frontmatterContent.replace(/tags:\s*\[(.*?)\]/, (match2, tags) => {
          const tagList = tags.split(",").map((tag) => tag.trim());
          const filteredTags = tagList.filter((tag) => !tag.toLowerCase().includes("review") && !tag.toLowerCase().includes("priority-"));
          return filteredTags.length > 0 ? `tags: [${filteredTags.join(", ")}]` : "";
        });
        frontmatterContent = frontmatterContent.replace(/tags:\s*\n(\s*-\s*(review|priority-high|priority-medium|priority-low)\s*\n?)+/, "");
      }
      frontmatterContent = frontmatterContent.replace(/\n\s*\n/g, "\n").trim();
      newContent = frontmatterContent ? content.replace(frontmatterRegex, `---
${frontmatterContent}
---`) : content.replace(frontmatterRegex, "").trim();
    }
    const inlineTagRegex = /#review\b|#priority-high\b|#priority-medium\b|#priority-low\b/g;
    newContent = newContent.replace(inlineTagRegex, "");
    await this.app.vault.modify(file, newContent);
  }
  async setNotePriority(note, priority) {
    let content = await this.app.vault.read(note.file);
    let newContent = content;
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);
    if (match) {
      let frontmatterContent = match[1];
      frontmatterContent = frontmatterContent.replace(/priority-high/g, "").replace(/priority-medium/g, "").replace(/priority-low/g, "");
      if (frontmatterContent.includes("tags:")) {
        const yamlArrayTagsRegex = /tags:\s*\n(\s*-\s*.*\n)*/;
        const yamlArrayMatch = frontmatterContent.match(yamlArrayTagsRegex);
        if (yamlArrayMatch) {
          frontmatterContent = frontmatterContent.replace(yamlArrayTagsRegex, (match2) => match2.replace(/(\s*-\s*priority-.*\n?)/g, "") + `  - priority-${priority}
`);
        } else {
          const inlineArrayRegex = /tags:\s*\[(.*?)\]/;
          const inlineMatch = frontmatterContent.match(inlineArrayRegex);
          if (inlineMatch) {
            let tags = inlineMatch[1].split(",").map((t) => t.trim());
            tags = tags.filter((t) => t && !t.startsWith("priority-"));
            tags.push(`priority-${priority}`);
            frontmatterContent = frontmatterContent.replace(inlineArrayRegex, `tags: [${tags.join(", ")}]`);
          }
        }
      } else {
        frontmatterContent += `
tags:
  - priority-${priority}`;
      }
      newContent = content.replace(frontmatterRegex, `---
${frontmatterContent.replace(/\n\s*\n/g, "\n").trim()}
---`);
    } else {
      newContent = `---
tags:
  - review
  - priority-${priority}
---

${content}`;
    }
    await this.app.vault.modify(note.file, newContent);
    note.priority = priority;
    new import_obsidian.Notice(`\u7B14\u8BB0 "${note.file.basename}" \u5DF2\u8BBE\u7F6E\u4E3A${priority === "high" ? "\u9AD8" : priority === "medium" ? "\u4E2D" : "\u4F4E"}\u4F18\u5148\u7EA7`);
  }
};
var ReviewSchedulerView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return "review-scheduler-view";
  }
  getDisplayText() {
    return "\u590D\u4E60\u6392\u7A0B\u5668";
  }
  getIcon() {
    return "calendar-clock";
  }
  async onOpen() {
    await this.plugin.scanNotesForReview();
  }
  truncateTitle(title, maxLength = 40) {
    if (title.length <= maxLength)
      return title;
    return title.substring(0, maxLength) + "...";
  }
  updateHighlights() {
    var _a, _b;
    const activeFile = (_a = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView)) == null ? void 0 : _a.file;
    const listItems = (_b = this.scrollContainer) == null ? void 0 : _b.querySelectorAll("li");
    if (!listItems)
      return;
    listItems.forEach((item) => {
      if (item.dataset.path === (activeFile == null ? void 0 : activeFile.path)) {
        item.addClass("current-review-note");
      } else {
        item.removeClass("current-review-note");
      }
    });
  }
  render() {
    var _a;
    const savedScroll = ((_a = this.scrollContainer) == null ? void 0 : _a.scrollTop) || 0;
    const contentEl = this.containerEl;
    contentEl.empty();
    const mainContainer = contentEl.createDiv({ cls: "review-scheduler-container" });
    const headerEl = mainContainer.createDiv({ cls: "review-scheduler-header" });
    headerEl.createEl("h1", { text: "\u590D\u4E60\u6392\u7A0B\u5668" });
    this.scrollContainer = mainContainer.createDiv({ cls: "review-scheduler-content" });
    if (this.plugin.reviewQueue.length === 0) {
      this.scrollContainer.createEl("p", { text: "\u5F53\u524D\u6CA1\u6709\u9700\u8981\u590D\u4E60\u7684\u7B14\u8BB0\u3002" });
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueTodayNotes = this.plugin.reviewQueue.filter((note) => new Date(note.reviewDate).setHours(0, 0, 0, 0) <= today.getTime());
    const upcomingNotes = this.plugin.reviewQueue.filter((note) => new Date(note.reviewDate).setHours(0, 0, 0, 0) > today.getTime()).slice(0, 10);
    const createSection = (title, notes) => {
      const section = this.scrollContainer.createDiv({ cls: "review-section" });
      section.createEl("h2", { text: `${title} (${notes.length})` });
      if (notes.length > 0) {
        const list = section.createEl("ul");
        for (const note of notes) {
          const item = list.createEl("li");
          item.dataset.path = note.file.path;
          const noteInfo = item.createDiv({ cls: "review-note-info" });
          noteInfo.createEl("span", { text: this.truncateTitle(note.file.basename), cls: "review-note-title" });
          noteInfo.createEl("span", { text: new Date(note.reviewDate).toLocaleDateString(), cls: "review-note-date" });
          item.addEventListener("click", () => {
            this.app.workspace.getLeaf(true).openFile(note.file);
          });
        }
      } else {
        section.createEl("p", { text: `\u6CA1\u6709${title}\u7684\u7B14\u8BB0\u3002` });
      }
    };
    createSection("\u4ECA\u5929\u9700\u8981\u590D\u4E60", dueTodayNotes);
    createSection("\u5373\u5C06\u5230\u6765\u7684\u590D\u4E60", upcomingNotes);
    this.updateHighlights();
    this.scrollContainer.scrollTop = savedScroll;
  }
};
var ReviewSchedulerSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "\u590D\u4E60\u6392\u7A0B\u5668\u8BBE\u7F6E" });
    new import_obsidian.Setting(containerEl).setName("\u95F4\u9694\u4E58\u6570").setDesc("\u7528\u4E8E\u8BA1\u7B97\u590D\u4E60\u95F4\u9694\u7684\u4E58\u6570\uFF0C\u9ED8\u8BA4\u4E3A1.5").addText((text) => text.setValue(this.plugin.settings.multiplier.toString()).onChange(async (value) => {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue > 0) {
        this.plugin.settings.multiplier = numValue;
        await this.plugin.saveSettings();
      }
    }));
    new import_obsidian.Setting(containerEl).setName("\u6392\u7A0B\u968F\u673A\u5EA6").setDesc("\u4E3A\u590D\u4E60\u95F4\u9694\u589E\u52A0\u968F\u673A\u6027\uFF0C\u907F\u514D\u7B14\u8BB0\u624E\u5806\u3002\u4F8B\u59820.1\u4EE3\u8868+/-10%\u7684\u968F\u673A\u5EF6\u8FDF\u3002").addText((text) => text.setValue(this.plugin.settings.randomness.toString()).onChange(async (value) => {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue >= 0 && numValue <= 1) {
        this.plugin.settings.randomness = numValue;
        await this.plugin.saveSettings();
      }
    }));
    containerEl.createEl("h3", { text: "\u961F\u5217\u884C\u4E3A\u8BBE\u7F6E" });
    new import_obsidian.Setting(containerEl).setName("\u5F00\u542F\u7EC4\u5185\u4E71\u5E8F").setDesc("\u5F00\u542F\u540E\uFF0C\u540C\u4E00\u4F18\u5148\u7EA7\u7684\u5F85\u590D\u4E60\u7B14\u8BB0\u4F1A\u968F\u673A\u6392\u5E8F\u3002\u5173\u95ED\u5219\u6309\u7B14\u8BB0\u521B\u5EFA\u65F6\u95F4\u6392\u5E8F\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.enableShuffle).onChange(async (value) => {
      this.plugin.settings.enableShuffle = value;
      await this.plugin.saveSettings();
      this.plugin.scanNotesForReview();
    }));
    new import_obsidian.Setting(containerEl).setName("\u5F00\u542F\u4F18\u5148\u7EA7\u968F\u673A\u63D0\u5347").setDesc("\u5F00\u542F\u540E\uFF0C\u4F4E\u4F18\u5148\u7EA7\u7684\u7B14\u8BB0\u6709\u4E00\u5B9A\u51E0\u7387\u88AB\u4E34\u65F6\u63D0\u5347\u5230\u66F4\u9AD8\u4F18\u5148\u7EA7\u961F\u5217\u4E2D\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.enablePriorityPromotion).onChange(async (value) => {
      this.plugin.settings.enablePriorityPromotion = value;
      await this.plugin.saveSettings();
      this.plugin.scanNotesForReview();
    }));
    new import_obsidian.Setting(containerEl).setName("\u4F18\u5148\u7EA7\u63D0\u5347\u6982\u7387").setDesc("\u6BCF\u4E2A\u7B14\u8BB0\u6709\u591A\u5927\u51E0\u7387\u88AB\u63D0\u5347\u4E00\u7EA7\u3002\u9ED8\u8BA4\u4E3A 0.05 (5%)\u3002").addText((text) => text.setValue(this.plugin.settings.promotionChance.toString()).onChange(async (value) => {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue >= 0 && numValue <= 1) {
        this.plugin.settings.promotionChance = numValue;
        await this.plugin.saveSettings();
      }
    }));
    new import_obsidian.Setting(containerEl).setName("\u5B8C\u6210\u540E\u81EA\u52A8\u8DF3\u8F6C").setDesc("\u5904\u7406\u5B8C\u4E00\u7BC7\u7B14\u8BB0\u540E\uFF0C\u81EA\u52A8\u6253\u5F00\u4E0B\u4E00\u7BC7\u7B14\u8BB0\u7684\u884C\u4E3A\u3002").addDropdown((dropdown) => dropdown.addOption("off", "\u4E0D\u8DF3\u8F6C").addOption("top", "\u8DF3\u8F6C\u5230\u961F\u5217\u9876\u7AEF").addOption("next", "\u8DF3\u8F6C\u5230\u5217\u8868\u4E0B\u4E00\u7BC7").setValue(this.plugin.settings.jumpAfterReview).onChange(async (value) => {
      this.plugin.settings.jumpAfterReview = value;
      await this.plugin.saveSettings();
    }));
    containerEl.createEl("h3", { text: "\u4F18\u5148\u7EA7\u4E58\u6570\u8BBE\u7F6E" });
    new import_obsidian.Setting(containerEl).setName("\u9AD8\u4F18\u5148\u7EA7\u4E58\u6570").setDesc("\u9ED8\u8BA4\u4E3A0.8\uFF08\u51CF\u5C1120%\u5EF6\u8FDF\uFF09").addText((text) => text.setValue(this.plugin.settings.priorityMultipliers.high.toString()).onChange(async (value) => {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue > 0) {
        this.plugin.settings.priorityMultipliers.high = numValue;
        await this.plugin.saveSettings();
      }
    }));
    new import_obsidian.Setting(containerEl).setName("\u4E2D\u4F18\u5148\u7EA7\u4E58\u6570").setDesc("\u9ED8\u8BA4\u4E3A1.0\uFF08\u4FDD\u6301\u539F\u6709\u5EF6\u8FDF\uFF09").addText((text) => text.setValue(this.plugin.settings.priorityMultipliers.medium.toString()).onChange(async (value) => {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue > 0) {
        this.plugin.settings.priorityMultipliers.medium = numValue;
        await this.plugin.saveSettings();
      }
    }));
    new import_obsidian.Setting(containerEl).setName("\u4F4E\u4F18\u5148\u7EA7\u4E58\u6570").setDesc("\u9ED8\u8BA4\u4E3A1.2\uFF08\u589E\u52A020%\u5EF6\u8FDF\uFF09").addText((text) => text.setValue(this.plugin.settings.priorityMultipliers.low.toString()).onChange(async (value) => {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue > 0) {
        this.plugin.settings.priorityMultipliers.low = numValue;
        await this.plugin.saveSettings();
      }
    }));
    containerEl.createEl("h3", { text: "\u5FEB\u6377\u952E\u8BBE\u7F6E" });
    new import_obsidian.Setting(containerEl).setName("\u5F00\u59CB\u590D\u4E60").setDesc("\u6253\u5F00\u5F53\u524D\u9700\u8981\u590D\u4E60\u7684\u7B14\u8BB0").addText((text) => text.setValue(this.plugin.settings.hotkeys.startReview).onChange(async (value) => {
      this.plugin.settings.hotkeys.startReview = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u5220\u9664\u7B14\u8BB0").setDesc("\u4ECE\u590D\u4E60\u961F\u5217\u4E2D\u5220\u9664\u5F53\u524D\u7B14\u8BB0").addText((text) => text.setValue(this.plugin.settings.hotkeys.deleteNote).onChange(async (value) => {
      this.plugin.settings.hotkeys.deleteNote = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u8BBE\u7F6E\u9AD8\u4F18\u5148\u7EA7").setDesc("\u5C06\u5F53\u524D\u7B14\u8BB0\u8BBE\u7F6E\u4E3A\u9AD8\u4F18\u5148\u7EA7").addText((text) => text.setValue(this.plugin.settings.hotkeys.setPriorityHigh).onChange(async (value) => {
      this.plugin.settings.hotkeys.setPriorityHigh = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u8BBE\u7F6E\u4E2D\u4F18\u5148\u7EA7").setDesc("\u5C06\u5F53\u524D\u7B14\u8BB0\u8BBE\u7F6E\u4E3A\u4E2D\u4F18\u5148\u7EA7").addText((text) => text.setValue(this.plugin.settings.hotkeys.setPriorityMedium).onChange(async (value) => {
      this.plugin.settings.hotkeys.setPriorityMedium = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u8BBE\u7F6E\u4F4E\u4F18\u5148\u7EA7").setDesc("\u5C06\u5F53\u524D\u7B14\u8BB0\u8BBE\u7F6E\u4E3A\u4F4E\u4F18\u5148\u7EA7").addText((text) => text.setValue(this.plugin.settings.hotkeys.setPriorityLow).onChange(async (value) => {
      this.plugin.settings.hotkeys.setPriorityLow = value;
      await this.plugin.saveSettings();
    }));
  }
};
var SetReviewDateModal = class extends import_obsidian.Modal {
  constructor(app, note, plugin) {
    super(app);
    this.note = note;
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "\u8BBE\u7F6E\u590D\u4E60\u65E5\u671F" });
    const dateInput = contentEl.createEl("input", { type: "date" });
    dateInput.value = this.note.reviewDate.toISOString().split("T")[0];
    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
    const saveButton = buttonContainer.createEl("button", { text: "\u4FDD\u5B58" });
    saveButton.addEventListener("click", async () => {
      const newDate = new Date(dateInput.value);
      newDate.setHours(0, 0, 0, 0);
      this.note.reviewDate = newDate;
      await this.plugin.updateNoteMetadata(this.note.file, newDate, this.note.repHistory);
      this.plugin.scanNotesForReview();
      this.close();
      new import_obsidian.Notice(`\u7B14\u8BB0 "${this.note.file.basename}" \u7684\u590D\u4E60\u65E5\u671F\u5DF2\u66F4\u65B0\u4E3A ${newDate.toLocaleDateString()}`);
    });
    const cancelButton = buttonContainer.createEl("button", { text: "\u53D6\u6D88" });
    cancelButton.addEventListener("click", () => {
      this.close();
    });
  }
  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
};
