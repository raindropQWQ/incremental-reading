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
  priorityMultipliers: {
    high: 0.8,
    medium: 1,
    low: 1.2
  },
  randomFactor: 0.2,
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
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof import_obsidian.TFile && file.extension === "md") {
        this.scanNotesForReview();
      }
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof import_obsidian.TFile && file.extension === "md") {
        this.scanNotesForReview();
      }
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof import_obsidian.TFile && file.extension === "md") {
        this.scanNotesForReview();
      }
    }));
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (file instanceof import_obsidian.TFile && file.extension === "md") {
        this.scanNotesForReview();
      }
    }));
    this.registerView("review-scheduler-view", (leaf) => new ReviewSchedulerView(leaf, this));
    this.addCommand({
      id: "open-review-scheduler",
      name: "\u6253\u5F00\u590D\u4E60\u6392\u7A0B\u5668",
      callback: () => this.activateView()
    });
    this.addCommand({
      id: "review-next",
      name: "\u590D\u4E60\uFF1A\u4E0B\u4E00\u6B65",
      callback: async () => {
        var _a;
        const view = (_a = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]) == null ? void 0 : _a.view;
        if (view == null ? void 0 : view.currentNote) {
          const currentNote = view.currentNote;
          await this.handleNext(currentNote);
          view.render();
        }
      }
    });
    this.addCommand({
      id: "review-set-aside",
      name: "\u590D\u4E60\uFF1A\u6401\u7F6E",
      callback: async () => {
        var _a;
        const view = (_a = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]) == null ? void 0 : _a.view;
        if (view == null ? void 0 : view.currentNote) {
          const currentNote = view.currentNote;
          await this.handleSetAside(currentNote);
          view.render();
        }
      }
    });
    this.addCommand({
      id: "review-start",
      name: "\u590D\u4E60\uFF1A\u5F00\u59CB\u590D\u4E60",
      callback: async () => {
        var _a;
        const view = (_a = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]) == null ? void 0 : _a.view;
        if (view == null ? void 0 : view.currentNote) {
          this.app.workspace.getLeaf(true).openFile(view.currentNote.file);
        }
      }
    });
    this.addCommand({
      id: "review-delete",
      name: "\u590D\u4E60\uFF1A\u5220\u9664\u5F53\u524D\u7B14\u8BB0",
      callback: async () => {
        var _a, _b;
        const view = (_a = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]) == null ? void 0 : _a.view;
        if (view == null ? void 0 : view.currentNote) {
          const currentNote = view.currentNote;
          const confirmDelete = await new Promise((resolve) => {
            const modal = new import_obsidian.Modal(this.app);
            modal.contentEl.createEl("h2", { text: "\u786E\u8BA4\u5220\u9664" });
            modal.contentEl.createEl("p", {
              text: `\u786E\u5B9A\u8981\u5220\u9664\u7B14\u8BB0 "${currentNote.file.basename}" \u5417\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002`
            });
            const buttonContainer = modal.contentEl.createDiv({ cls: "modal-button-container" });
            const confirmButton = buttonContainer.createEl("button", {
              text: "\u5220\u9664",
              cls: "mod-warning"
            });
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
            if (leaf.view instanceof import_obsidian.MarkdownView && ((_b = leaf.view.file) == null ? void 0 : _b.path) === currentNote.file.path) {
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
          view.render();
          new import_obsidian.Notice(`\u7B14\u8BB0 "${currentNote.file.basename}" \u5DF2\u6C38\u4E45\u5220\u9664`);
        }
      }
    });
    this.addCommand({
      id: "review-set-priority-high",
      name: "\u590D\u4E60\uFF1A\u8BBE\u7F6E\u4E3A\u9AD8\u4F18\u5148\u7EA7",
      callback: async () => {
        var _a;
        const view = (_a = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]) == null ? void 0 : _a.view;
        if (view == null ? void 0 : view.currentNote) {
          await this.setNotePriority(view.currentNote, "high");
          view.render();
        }
      }
    });
    this.addCommand({
      id: "review-set-priority-medium",
      name: "\u590D\u4E60\uFF1A\u8BBE\u7F6E\u4E3A\u4E2D\u4F18\u5148\u7EA7",
      callback: async () => {
        var _a;
        const view = (_a = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]) == null ? void 0 : _a.view;
        if (view == null ? void 0 : view.currentNote) {
          await this.setNotePriority(view.currentNote, "medium");
          view.render();
        }
      }
    });
    this.addCommand({
      id: "review-set-priority-low",
      name: "\u590D\u4E60\uFF1A\u8BBE\u7F6E\u4E3A\u4F4E\u4F18\u5148\u7EA7",
      callback: async () => {
        var _a;
        const view = (_a = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]) == null ? void 0 : _a.view;
        if (view == null ? void 0 : view.currentNote) {
          await this.setNotePriority(view.currentNote, "low");
          view.render();
        }
      }
    });
    this.addCommand({
      id: "review-set-custom-date",
      name: "\u590D\u4E60\uFF1A\u8BBE\u7F6E\u81EA\u5B9A\u4E49\u590D\u4E60\u65E5\u671F",
      callback: async () => {
        var _a;
        const view = (_a = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]) == null ? void 0 : _a.view;
        if (view == null ? void 0 : view.currentNote) {
          const modal = new SetReviewDateModal(this.app, view.currentNote, this);
          modal.open();
        }
      }
    });
    this.addSettingTab(new ReviewSchedulerSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => this.scanNotesForReview());
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
      await leaf.setViewState({
        type: "review-scheduler-view",
        active: true
      });
      workspace.revealLeaf(leaf);
    }
  }
  async scanNotesForReview() {
    var _a, _b, _c, _d, _e;
    console.log("\u5F00\u59CB\u626B\u63CF\u7B14\u8BB0...");
    this.reviewQueue = [];
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const metadata = this.app.metadataCache.getFileCache(file);
      let hasReviewTag = false;
      let priority = null;
      if ((_a = metadata == null ? void 0 : metadata.frontmatter) == null ? void 0 : _a.tags) {
        let tags = [];
        if (Array.isArray(metadata.frontmatter.tags)) {
          tags = metadata.frontmatter.tags;
          console.log(`\u6587\u4EF6 ${file.basename} \u4F7F\u7528\u6570\u7EC4\u683C\u5F0F\u7684\u6807\u7B7E:`, tags);
        } else if (typeof metadata.frontmatter.tags === "string") {
          tags = metadata.frontmatter.tags.split(/\s+/);
          console.log(`\u6587\u4EF6 ${file.basename} \u4F7F\u7528\u7A7A\u683C\u5206\u9694\u7684\u6807\u7B7E\u5B57\u7B26\u4E32:`, metadata.frontmatter.tags, "\u5206\u5272\u540E:", tags);
        } else {
          tags = [metadata.frontmatter.tags];
          console.log(`\u6587\u4EF6 ${file.basename} \u4F7F\u7528\u5176\u4ED6\u683C\u5F0F\u7684\u6807\u7B7E:`, metadata.frontmatter.tags);
        }
        hasReviewTag = tags.some((tag) => typeof tag === "string" && tag.toLowerCase().startsWith("review"));
        if (tags.includes("priority-high"))
          priority = "high";
        else if (tags.includes("priority-medium"))
          priority = "medium";
        else if (tags.includes("priority-low"))
          priority = "low";
      }
      if (!hasReviewTag && (metadata == null ? void 0 : metadata.tags)) {
        hasReviewTag = metadata.tags.some((tag) => tag.tag.toLowerCase().startsWith("#review"));
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
      try {
        console.log(`\u5904\u7406\u7B14\u8BB0 ${file.basename} \u7684\u590D\u4E60\u65E5\u671F:`, (_d = metadata == null ? void 0 : metadata.frontmatter) == null ? void 0 : _d.reviewDate);
        console.log(`\u8F6C\u6362\u540E\u7684\u65E5\u671F\u5BF9\u8C61:`, reviewDate);
        console.log(`\u590D\u4E60\u5386\u53F2:`, repHistory);
      } catch (error) {
        console.error(`\u7B14\u8BB0 ${file.basename} \u7684\u65E5\u671F\u683C\u5F0F\u9519\u8BEF:`, (_e = metadata == null ? void 0 : metadata.frontmatter) == null ? void 0 : _e.reviewDate);
        console.error("\u9519\u8BEF\u8BE6\u60C5:", error);
      }
      this.reviewQueue.push({
        file,
        reviewDate,
        repHistory,
        priority
      });
    }
    this.reviewQueue.sort((a, b) => {
      const dateCompare = a.reviewDate.getTime() - b.reviewDate.getTime();
      if (dateCompare !== 0)
        return dateCompare;
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const aPriority = a.priority ? priorityOrder[a.priority] : 3;
      const bPriority = b.priority ? priorityOrder[b.priority] : 3;
      return aPriority - bPriority;
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayNotes = this.reviewQueue.filter((note) => {
      const noteDate = new Date(note.reviewDate);
      noteDate.setHours(0, 0, 0, 0);
      return noteDate.getTime() <= today.getTime() && note.priority === "low";
    });
    if (todayNotes.length > 0) {
      for (let i = todayNotes.length - 1; i > 0; i--) {
        if (Math.random() < this.settings.randomFactor) {
          const randomIndex = Math.floor(Math.random() * (i + 1));
          const temp = todayNotes[i];
          todayNotes[i] = todayNotes[randomIndex];
          todayNotes[randomIndex] = temp;
        }
      }
    }
    console.log(`\u626B\u63CF\u5B8C\u6210\uFF0C\u627E\u5230 ${this.reviewQueue.length} \u4E2A\u5F85\u590D\u4E60\u7B14\u8BB0`);
  }
  calculateNextReviewDate(repHistory, priority = null) {
    const today = new Date();
    const interval = Math.ceil(this.settings.multiplier ** Math.max(repHistory.length, 1));
    const priorityMultiplier = priority ? this.settings.priorityMultipliers[priority] : 1;
    const adjustedInterval = Math.ceil(interval * priorityMultiplier);
    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + adjustedInterval);
    return nextDate;
  }
  async handleNext(note) {
    var _a;
    const today = new Date();
    note.repHistory.push(today);
    note.reviewDate = this.calculateNextReviewDate(note.repHistory, note.priority);
    await this.updateNoteMetadata(note.file, note.reviewDate, note.repHistory);
    this.reviewQueue = this.reviewQueue.filter((n) => n.file.path !== note.file.path);
    new import_obsidian.Notice(`\u7B14\u8BB0 "${note.file.basename}" \u5DF2\u6392\u7A0B\u5230 ${note.reviewDate.toLocaleDateString()}`);
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (leaf.view instanceof import_obsidian.MarkdownView && ((_a = leaf.view.file) == null ? void 0 : _a.path) === note.file.path) {
        leaf.detach();
        break;
      }
    }
    if (this.reviewQueue.length > 0) {
      const nextNote = this.reviewQueue[0];
      if (nextNote) {
        this.app.workspace.getLeaf(true).openFile(nextNote.file);
      }
    }
  }
  async handleSetAside(note) {
    var _a;
    await this.removeNoteReviewMetadata(note.file);
    this.reviewQueue = this.reviewQueue.filter((n) => n.file.path !== note.file.path);
    new import_obsidian.Notice(`\u7B14\u8BB0 "${note.file.basename}" \u5DF2\u4ECE\u590D\u4E60\u961F\u5217\u4E2D\u79FB\u9664`);
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (leaf.view instanceof import_obsidian.MarkdownView && ((_a = leaf.view.file) == null ? void 0 : _a.path) === note.file.path) {
        leaf.detach();
        break;
      }
    }
    if (this.reviewQueue.length > 0) {
      const nextNote = this.reviewQueue[0];
      if (nextNote) {
        this.app.workspace.getLeaf(true).openFile(nextNote.file);
      }
    }
  }
  async updateNoteMetadata(file, reviewDate, repHistory) {
    var _a;
    const content = await this.app.vault.read(file);
    const frontmatter = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
    try {
      console.log(`\u66F4\u65B0\u7B14\u8BB0 ${file.basename} \u7684\u5143\u6570\u636E:`);
      console.log("\u590D\u4E60\u65E5\u671F:", reviewDate);
      console.log("\u590D\u4E60\u65E5\u671FISO\u683C\u5F0F:", reviewDate.toISOString());
      console.log("\u590D\u4E60\u5386\u53F2:", repHistory);
    } catch (error) {
      console.error(`\u7B14\u8BB0 ${file.basename} \u7684\u65E5\u671F\u683C\u5F0F\u9519\u8BEF:`, reviewDate);
      console.error("\u9519\u8BEF\u8BE6\u60C5:", error);
    }
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
    const content = await this.app.vault.read(file);
    let newContent = content;
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);
    if (match) {
      let frontmatterContent = match[1];
      frontmatterContent = frontmatterContent.replace(/reviewDate:.*\n?/, "").replace(/repHistory:.*\n?/, "").replace(/sr-due:.*\n?/, "").replace(/sr-interval:.*\n?/, "").replace(/sr-ease:.*\n?/, "");
      if (frontmatterContent.includes("tags:")) {
        frontmatterContent = frontmatterContent.replace(/tags:\s*\n\s*-\s*review\s*\n?/, "tags:\n");
        frontmatterContent = frontmatterContent.replace(/tags:\s*review\s*\n/, "");
        frontmatterContent = frontmatterContent.replace(/tags:\s*\[(.*?)\]/, (match2, tags) => {
          const tagList = tags.split(",").map((tag) => tag.trim());
          const filteredTags = tagList.filter((tag) => !tag.toLowerCase().startsWith("review"));
          return filteredTags.length > 0 ? `tags: [${filteredTags.join(", ")}]` : "tags: []";
        });
      }
      frontmatterContent = frontmatterContent.replace(/\n\s*\n/g, "\n").trim();
      newContent = frontmatterContent ? content.replace(frontmatterRegex, `---
${frontmatterContent}
---`) : content.replace(frontmatterRegex, "").trim();
    }
    const inlineTagRegex = /#review\b/g;
    newContent = newContent.replace(inlineTagRegex, "");
    await this.app.vault.modify(file, newContent);
    console.log(`\u5DF2\u4ECE\u7B14\u8BB0 ${file.basename} \u4E2D\u79FB\u9664\u590D\u4E60\u5143\u6570\u636E\u548C\u6807\u7B7E`);
  }
  async setNotePriority(note, priority) {
    const content = await this.app.vault.read(note.file);
    let newContent = content;
    let hasFrontmatter = false;
    let frontmatterContent = "";
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);
    if (match) {
      hasFrontmatter = true;
      frontmatterContent = match[1];
      frontmatterContent = frontmatterContent.replace(/priority-high/g, "").replace(/priority-medium/g, "").replace(/priority-low/g, "");
      if (frontmatterContent.includes("tags:")) {
        frontmatterContent = frontmatterContent.replace(/tags:\s*\n\s*-\s*\n/g, "tags:\n");
        const yamlArrayTagsRegex = /tags:\s*\n(\s*-\s*.*\n)*/;
        const yamlArrayMatch = frontmatterContent.match(yamlArrayTagsRegex);
        if (yamlArrayMatch) {
          frontmatterContent = frontmatterContent.replace(yamlArrayTagsRegex, (match2) => match2 + `  - priority-${priority}
`);
        } else {
          const inlineArrayRegex = /tags:\s*\[(.*?)\]/;
          const inlineMatch = frontmatterContent.match(inlineArrayRegex);
          if (inlineMatch) {
            let tags = inlineMatch[1].split(",").map((t) => t.trim());
            tags = tags.filter((t) => t && !t.startsWith("priority-"));
            tags.push(`priority-${priority}`);
            frontmatterContent = frontmatterContent.replace(inlineArrayRegex, `tags: [${tags.join(", ")}]`);
          } else {
            frontmatterContent = frontmatterContent.replace(/tags:\s*(.*?)(\n|$)/, (match2, tag) => {
              if (!tag || tag.trim() === "") {
                return `tags: priority-${priority}
`;
              } else {
                if (tag.includes(" ")) {
                  const tagList = tag.split(/\s+/).filter((t) => t && !t.startsWith("priority-"));
                  tagList.push(`priority-${priority}`);
                  return `tags: ${tagList.join(" ")}
`;
                } else {
                  return `tags: [${tag.trim()}, priority-${priority}]
`;
                }
              }
            });
          }
        }
      } else {
        frontmatterContent += `
tags:
  - review
  - priority-${priority}`;
      }
      newContent = content.replace(frontmatterRegex, `---
${frontmatterContent}
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
    this.currentNote = null;
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
    this.render();
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof import_obsidian.TFile && file.extension === "md") {
        this.plugin.scanNotesForReview().then(() => this.render());
      }
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof import_obsidian.TFile && file.extension === "md") {
        this.plugin.scanNotesForReview().then(() => this.render());
      }
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof import_obsidian.TFile && file.extension === "md") {
        this.plugin.scanNotesForReview().then(() => this.render());
      }
    }));
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (file instanceof import_obsidian.TFile && file.extension === "md") {
        this.plugin.scanNotesForReview().then(() => this.render());
      }
    }));
  }
  truncateTitle(title, maxLength = 40) {
    if (title.length <= maxLength)
      return title;
    return title.substring(0, maxLength) + "...";
  }
  render() {
    console.log("\u5F00\u59CB\u6E32\u67D3\u89C6\u56FE...");
    const contentEl = this.containerEl;
    contentEl.empty();
    const mainContainer = contentEl.createDiv({
      cls: "review-scheduler-container"
    });
    const headerEl = mainContainer.createDiv({
      cls: "review-scheduler-header"
    });
    headerEl.createEl("h1", { text: "\u590D\u4E60\u6392\u7A0B\u5668" });
    const contentContainer = mainContainer.createDiv({
      cls: "review-scheduler-content"
    });
    console.log(`\u961F\u5217\u957F\u5EA6: ${this.plugin.reviewQueue.length}`);
    if (this.plugin.reviewQueue.length === 0) {
      contentContainer.createEl("p", { text: "\u5F53\u524D\u6CA1\u6709\u9700\u8981\u590D\u4E60\u7684\u7B14\u8BB0\u3002" });
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    console.log(`\u4ECA\u5929\u65E5\u671F: ${today.toISOString()}`);
    const dueTodayNotes = this.plugin.reviewQueue.filter((note) => {
      const noteDate = new Date(note.reviewDate);
      noteDate.setHours(0, 0, 0, 0);
      try {
        console.log(`\u7B14\u8BB0 ${note.file.basename} \u7684\u590D\u4E60\u65E5\u671F:`, note.reviewDate);
        console.log(`\u7B14\u8BB0 ${note.file.basename} \u7684\u590D\u4E60\u65E5\u671FISO\u683C\u5F0F:`, note.reviewDate.toISOString());
      } catch (error) {
        console.error(`\u7B14\u8BB0 ${note.file.basename} \u7684\u590D\u4E60\u65E5\u671F\u683C\u5F0F\u9519\u8BEF:`, note.reviewDate);
        console.error("\u9519\u8BEF\u8BE6\u60C5:", error);
      }
      return noteDate.getTime() <= today.getTime();
    });
    console.log(`\u4ECA\u5929\u9700\u8981\u590D\u4E60\u7684\u7B14\u8BB0\u6570\u91CF: ${dueTodayNotes.length}`);
    const todaySection = contentContainer.createDiv({
      cls: "review-section"
    });
    todaySection.createEl("h2", { text: "\u4ECA\u5929\u9700\u8981\u590D\u4E60" });
    if (dueTodayNotes.length > 0) {
      this.currentNote = dueTodayNotes[0];
      const todayList = todaySection.createEl("ul");
      for (const note of dueTodayNotes) {
        const item = todayList.createEl("li");
        const isCurrentNote = note === this.currentNote;
        if (isCurrentNote) {
          item.addClass("current-review-note");
        }
        const noteInfo = item.createDiv({
          cls: "review-note-info"
        });
        noteInfo.createEl("span", {
          text: this.truncateTitle(note.file.basename),
          cls: "review-note-title"
        });
        noteInfo.createEl("span", {
          text: new Date(note.reviewDate).toLocaleDateString(),
          cls: "review-note-date"
        });
        item.addEventListener("click", () => {
          this.currentNote = note;
          this.app.workspace.getLeaf(true).openFile(note.file);
          this.render();
        });
      }
      const buttonContainer = todaySection.createDiv({
        cls: "review-buttons-container"
      });
      const reviewNowButton = buttonContainer.createEl("button", {
        text: "\u5F00\u59CB\u590D\u4E60",
        cls: "review-now-button"
      });
      reviewNowButton.addEventListener("click", () => {
        if (this.currentNote) {
          this.app.workspace.getLeaf(true).openFile(this.currentNote.file);
        }
      });
      const refreshButton = buttonContainer.createEl("button", {
        text: "\u5237\u65B0",
        cls: "refresh-button"
      });
      refreshButton.addEventListener("click", () => {
        this.plugin.scanNotesForReview().then(() => {
          this.render();
          new import_obsidian.Notice("\u961F\u5217\u5DF2\u5237\u65B0");
        });
      });
    } else {
      todaySection.createEl("p", { text: "\u4ECA\u5929\u6CA1\u6709\u9700\u8981\u590D\u4E60\u7684\u7B14\u8BB0\u3002" });
      const refreshButton = todaySection.createEl("button", {
        text: "\u5237\u65B0",
        cls: "refresh-button"
      });
      refreshButton.addEventListener("click", () => {
        this.plugin.scanNotesForReview().then(() => {
          this.render();
          new import_obsidian.Notice("\u961F\u5217\u5DF2\u5237\u65B0");
        });
      });
    }
    const upcomingSection = contentContainer.createDiv({
      cls: "review-section"
    });
    upcomingSection.createEl("h2", { text: "\u5373\u5C06\u5230\u6765\u7684\u590D\u4E60" });
    const upcomingNotes = this.plugin.reviewQueue.filter((note) => {
      const noteDate = new Date(note.reviewDate);
      noteDate.setHours(0, 0, 0, 0);
      return noteDate.getTime() > today.getTime();
    }).slice(0, 5);
    if (upcomingNotes.length > 0) {
      const upcomingList = upcomingSection.createEl("ul");
      for (const note of upcomingNotes) {
        const item = upcomingList.createEl("li");
        const noteInfo = item.createDiv({
          cls: "review-note-info"
        });
        noteInfo.createEl("span", {
          text: this.truncateTitle(note.file.basename),
          cls: "review-note-title"
        });
        noteInfo.createEl("span", {
          text: new Date(note.reviewDate).toLocaleDateString(),
          cls: "review-note-date"
        });
        item.addEventListener("click", () => {
          this.currentNote = note;
          this.app.workspace.getLeaf(true).openFile(note.file);
          this.render();
        });
      }
    } else {
      upcomingSection.createEl("p", { text: "\u6CA1\u6709\u5373\u5C06\u5230\u6765\u7684\u590D\u4E60\u3002" });
    }
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
    containerEl.createEl("h3", { text: "\u4F18\u5148\u7EA7\u8BBE\u7F6E" });
    new import_obsidian.Setting(containerEl).setName("\u9AD8\u4F18\u5148\u7EA7\u4E58\u6570").setDesc("\u9AD8\u4F18\u5148\u7EA7\u5185\u5BB9\u7684\u590D\u4E60\u95F4\u9694\u4E58\u6570\uFF0C\u9ED8\u8BA4\u4E3A0.8\uFF08\u51CF\u5C1120%\u5EF6\u8FDF\uFF09").addText((text) => text.setValue(this.plugin.settings.priorityMultipliers.high.toString()).onChange(async (value) => {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue > 0) {
        this.plugin.settings.priorityMultipliers.high = numValue;
        await this.plugin.saveSettings();
      }
    }));
    new import_obsidian.Setting(containerEl).setName("\u4E2D\u4F18\u5148\u7EA7\u4E58\u6570").setDesc("\u4E2D\u4F18\u5148\u7EA7\u5185\u5BB9\u7684\u590D\u4E60\u95F4\u9694\u4E58\u6570\uFF0C\u9ED8\u8BA4\u4E3A1.0\uFF08\u4FDD\u6301\u539F\u6709\u5EF6\u8FDF\uFF09").addText((text) => text.setValue(this.plugin.settings.priorityMultipliers.medium.toString()).onChange(async (value) => {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue > 0) {
        this.plugin.settings.priorityMultipliers.medium = numValue;
        await this.plugin.saveSettings();
      }
    }));
    new import_obsidian.Setting(containerEl).setName("\u4F4E\u4F18\u5148\u7EA7\u4E58\u6570").setDesc("\u4F4E\u4F18\u5148\u7EA7\u5185\u5BB9\u7684\u590D\u4E60\u95F4\u9694\u4E58\u6570\uFF0C\u9ED8\u8BA4\u4E3A1.2\uFF08\u589E\u52A020%\u5EF6\u8FDF\uFF09").addText((text) => text.setValue(this.plugin.settings.priorityMultipliers.low.toString()).onChange(async (value) => {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue > 0) {
        this.plugin.settings.priorityMultipliers.low = numValue;
        await this.plugin.saveSettings();
      }
    }));
    new import_obsidian.Setting(containerEl).setName("\u968F\u673A\u56E0\u5B50").setDesc("\u4F4E\u4F18\u5148\u7EA7\u5185\u5BB9\u63D0\u524D\u590D\u4E60\u7684\u6982\u7387\uFF0C\u9ED8\u8BA4\u4E3A0.2\uFF0820%\u6982\u7387\uFF09").addText((text) => text.setValue(this.plugin.settings.randomFactor.toString()).onChange(async (value) => {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue >= 0 && numValue <= 1) {
        this.plugin.settings.randomFactor = numValue;
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
      var _a;
      const newDate = new Date(dateInput.value);
      newDate.setHours(0, 0, 0, 0);
      this.note.reviewDate = newDate;
      await this.plugin.updateNoteMetadata(this.note.file, newDate, this.note.repHistory);
      const view = (_a = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]) == null ? void 0 : _a.view;
      if (view) {
        view.render();
      }
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
