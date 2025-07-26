import {
  App,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
  ItemView,
  debounce,
} from "obsidian";

// 接口定义
interface ReviewNote {
  file: TFile;
  reviewDate: Date;
  repHistory: Date[];
  priority: 'high' | 'medium' | 'low' | null;
}

interface ReviewSchedulerSettings {
  multiplier: number;
  randomness: number;
  priorityMultipliers: {
    high: number;
    medium: number;
    low: number;
  };
  enableShuffle: boolean;
  enablePriorityPromotion: boolean;
  promotionChance: number;
  jumpAfterReview: 'off' | 'top' | 'next'; // 修改：布尔值改为字符串选项
  hotkeys: {
    startReview: string;
    deleteNote: string;
    setPriorityHigh: string;
    setPriorityMedium: string;
    setPriorityLow: string;
  };
}

// 默认设置
const DEFAULT_SETTINGS: ReviewSchedulerSettings = {
  multiplier: 1.5,
  randomness: 0.1,
  priorityMultipliers: {
    high: 0.8,
    medium: 1.0,
    low: 1.2,
  },
  enableShuffle: true,
  enablePriorityPromotion: true,
  promotionChance: 0.05,
  jumpAfterReview: 'top', // 修改：默认跳转到队列顶端
  hotkeys: {
    startReview: "ctrl+shift+r",
    deleteNote: "ctrl+shift+d",
    setPriorityHigh: "ctrl+shift+1",
    setPriorityMedium: "ctrl+shift+2",
    setPriorityLow: "ctrl+shift+3",
  },
};

export default class ReviewSchedulerPlugin extends Plugin {
  settings: ReviewSchedulerSettings;
  reviewQueue: ReviewNote[] = [];

  async onload() {
    await this.loadSettings();

    const debouncedScan = debounce(() => this.scanNotesForReview(), 500, true);

    this.registerEvent(this.app.vault.on('modify', (file) => { if (file instanceof TFile && file.extension === 'md') debouncedScan(); }));
    this.registerEvent(this.app.vault.on('create', (file) => { if (file instanceof TFile && file.extension === 'md') debouncedScan(); }));
    this.registerEvent(this.app.vault.on('delete', (file) => { if (file instanceof TFile && file.extension === 'md') debouncedScan(); }));
    this.registerEvent(this.app.metadataCache.on('changed', (file) => { if (file instanceof TFile && file.extension === 'md') debouncedScan(); }));
    
    // 修改：不再使用 active-leaf-change 来触发 render，避免冲突
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
        this.getView()?.updateHighlights();
    }));

    this.registerView("review-scheduler-view", (leaf) => new ReviewSchedulerView(leaf, this));

    // ... 命令部分保持不变 ...
    this.addCommand({ id: "open-review-scheduler", name: "打开复习排程器", callback: () => this.activateView(), });
    this.addCommand({ id: "review-next", name: "复习：下一步", checkCallback: (checking: boolean) => { const note = this.getNoteForAction(); if (note) { if (!checking) { this.handleNext(note); } return true; } return false; }, });
    this.addCommand({ id: "review-set-aside", name: "复习：搁置", checkCallback: (checking: boolean) => { const note = this.getNoteForAction(); if (note) { if (!checking) { this.handleSetAside(note); } return true; } return false; }, });
    this.addCommand({ id: "review-start", name: "复习：开始复习", checkCallback: (checking: boolean) => { const note = this.getNoteForAction(); if (note) { if (!checking) { this.app.workspace.getLeaf(true).openFile(note.file); } return true; } return false; }, });
    this.addCommand({ id: "review-delete", name: "复习：删除当前笔记", checkCallback: (checking: boolean) => { const note = this.getNoteForAction(); if (note) { if (!checking) { this.handleDelete(note); } return true; } return false; }, });
    this.addCommand({ id: "review-set-priority-high", name: "复习：设置为高优先级", checkCallback: (checking: boolean) => { const note = this.getNoteForAction(); if (note) { if (!checking) { this.setNotePriority(note, 'high').then(() => this.scanNotesForReview()); } return true; } return false; }, });
    this.addCommand({ id: "review-set-priority-medium", name: "复习：设置为中优先级", checkCallback: (checking: boolean) => { const note = this.getNoteForAction(); if (note) { if (!checking) { this.setNotePriority(note, 'medium').then(() => this.scanNotesForReview()); } return true; } return false; }, });
    this.addCommand({ id: "review-set-priority-low", name: "复习：设置为低优先级", checkCallback: (checking: boolean) => { const note = this.getNoteForAction(); if (note) { if (!checking) { this.setNotePriority(note, 'low').then(() => this.scanNotesForReview()); } return true; } return false; }, });
    this.addCommand({ id: "review-set-custom-date", name: "复习：设置自定义复习日期", checkCallback: (checking: boolean) => { const note = this.getNoteForAction(); if (note) { if (!checking) { new SetReviewDateModal(this.app, note, this).open(); } return true; } return false; }, });

    this.addSettingTab(new ReviewSchedulerSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => this.scanNotesForReview());
  }

  private getView(): ReviewSchedulerView | null {
    const leaf = this.app.workspace.getLeavesOfType("review-scheduler-view")[0];
    return leaf ? leaf.view as ReviewSchedulerView : null;
  }

  private getNoteForAction(): ReviewNote | null {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView) {
        const activeFile = activeView.file;
        if (activeFile) {
            const noteInQueue = this.reviewQueue.find(n => n.file.path === activeFile.path);
            if (noteInQueue) return noteInQueue;
        }
    }
    const dueNotes = this.reviewQueue.filter(n => new Date(n.reviewDate).setHours(0,0,0,0) <= new Date().setHours(0,0,0,0));
    return dueNotes.length > 0 ? dueNotes[0] : null;
  }
  
  private refreshView() {
    this.getView()?.render();
  }

  async scanNotesForReview(newNotePath?: string) {
    // ... 扫描逻辑保持不变 ...
    this.reviewQueue = [];
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const metadata = this.app.metadataCache.getFileCache(file);
      let hasReviewTag = false;
      let priority: 'high' | 'medium' | 'low' | null = null;
      if (metadata?.frontmatter?.tags) {
        const tags = Array.isArray(metadata.frontmatter.tags) ? metadata.frontmatter.tags : String(metadata.frontmatter.tags).split(/\s+/);
        hasReviewTag = tags.some(tag => String(tag).toLowerCase().includes('review'));
        if (tags.includes('priority-high')) priority = 'high';
        else if (tags.includes('priority-medium')) priority = 'medium';
        else if (tags.includes('priority-low')) priority = 'low';
      }
      if (!hasReviewTag && metadata?.tags) {
        hasReviewTag = metadata.tags.some(tag => tag.tag.toLowerCase().includes('#review'));
        if (!priority) {
          if (metadata.tags.some(tag => tag.tag === '#priority-high')) priority = 'high';
          else if (metadata.tags.some(tag => tag.tag === '#priority-medium')) priority = 'medium';
          else if (metadata.tags.some(tag => tag.tag === '#priority-low')) priority = 'low';
        }
      }
      if (!hasReviewTag) continue;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const reviewDate = metadata?.frontmatter?.reviewDate ? new Date(metadata.frontmatter.reviewDate) : today;
      const repHistory = metadata?.frontmatter?.repHistory || [];
      this.reviewQueue.push({ file, reviewDate, repHistory, priority });
    }

    this.reviewQueue.sort((a, b) => {
      const dateCompare = a.reviewDate.getTime() - b.reviewDate.getTime();
      if (dateCompare !== 0) return dateCompare;
      return a.file.stat.ctime - b.file.stat.ctime;
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueNotes = this.reviewQueue.filter(note => new Date(note.reviewDate).setHours(0, 0, 0, 0) <= today.getTime());
    const upcomingNotes = this.reviewQueue.filter(note => new Date(note.reviewDate).setHours(0, 0, 0, 0) > today.getTime());
    let priorityGroups = {
      high: dueNotes.filter(n => n.priority === 'high'),
      medium: dueNotes.filter(n => n.priority === 'medium'),
      low: dueNotes.filter(n => n.priority === 'low'),
      none: dueNotes.filter(n => n.priority === null),
    };
    if (this.settings.enablePriorityPromotion) {
        const promotedFromLow: ReviewNote[] = [];
        priorityGroups.low.forEach(note => { if (Math.random() < this.settings.promotionChance) { promotedFromLow.push(note); } });
        priorityGroups.medium.push(...promotedFromLow);
        priorityGroups.low = priorityGroups.low.filter(note => !promotedFromLow.includes(note));
        const promotedFromMedium: ReviewNote[] = [];
        priorityGroups.medium.forEach(note => { if (Math.random() < this.settings.promotionChance) { promotedFromMedium.push(note); } });
        priorityGroups.high.push(...promotedFromMedium);
        priorityGroups.medium = priorityGroups.medium.filter(note => !promotedFromMedium.includes(note));
    }
    if (this.settings.enableShuffle) {
      const shuffle = (array: ReviewNote[]) => { for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; } return array; };
      priorityGroups.high = shuffle(priorityGroups.high);
      priorityGroups.medium = shuffle(priorityGroups.medium);
      priorityGroups.low = shuffle(priorityGroups.low);
      priorityGroups.none = shuffle(priorityGroups.none);
    }
    this.reviewQueue = [ ...priorityGroups.high, ...priorityGroups.medium, ...priorityGroups.low, ...priorityGroups.none, ...upcomingNotes ];

    // 新笔记插入逻辑
    if (newNotePath) {
        const newNoteIndex = this.reviewQueue.findIndex(n => n.file.path === newNotePath);
        if (newNoteIndex > -1) {
            const [newNote] = this.reviewQueue.splice(newNoteIndex, 1);
            const currentNote = this.getNoteForAction();
            const currentIndex = currentNote ? this.reviewQueue.findIndex(n => n.file.path === currentNote.file.path) : -1;
            this.reviewQueue.splice(currentIndex + 1, 0, newNote);
        }
    }

    this.refreshView();
  }

  calculateNextReviewDate(repHistory: Date[], priority: 'high' | 'medium' | 'low' | null = null): Date {
    const today = new Date();
    const interval = Math.ceil(this.settings.multiplier ** Math.max(repHistory.length, 1));
    const priorityMultiplier = priority ? this.settings.priorityMultipliers[priority] : 1.0;
    const adjustedInterval = Math.ceil(interval * priorityMultiplier);
    const randomFuzz = (Math.random() - 0.5) * 2 * this.settings.randomness;
    const finalInterval = Math.max(1, Math.round(adjustedInterval * (1 + randomFuzz)));
    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + finalInterval);
    return nextDate;
  }

  async handleAction(note: ReviewNote, isNext: boolean) {
    const originalPath = note.file.path;
    const dueNotesBeforeAction = this.reviewQueue.filter(n => new Date(n.reviewDate).setHours(0,0,0,0) <= new Date().setHours(0,0,0,0));
    const originalIndex = dueNotesBeforeAction.findIndex(n => n.file.path === originalPath);
    const nextNoteInList = (originalIndex > -1 && originalIndex < dueNotesBeforeAction.length - 1) ? dueNotesBeforeAction[originalIndex + 1] : null;

    if (isNext) {
        note.repHistory.push(new Date());
        note.reviewDate = this.calculateNextReviewDate(note.repHistory, note.priority);
        await this.updateNoteMetadata(note.file, note.reviewDate, note.repHistory);
        new Notice(`笔记 "${note.file.basename}" 已排程到 ${note.reviewDate.toLocaleDateString()}`);
    } else {
        await this.removeNoteReviewMetadata(note.file);
        new Notice(`笔记 "${note.file.basename}" 已从复习队列中移除`);
    }

    await this.scanNotesForReview();

    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (leaf.view instanceof MarkdownView && leaf.view.file?.path === originalPath) {
        leaf.detach();
        break;
      }
    }

    if (this.settings.jumpAfterReview !== 'off') {
        const dueNotesAfterAction = this.reviewQueue.filter(n => new Date(n.reviewDate).setHours(0,0,0,0) <= new Date().setHours(0,0,0,0));
        if (dueNotesAfterAction.length > 0) {
            let noteToOpen: TFile | null = null;
            if (this.settings.jumpAfterReview === 'next' && nextNoteInList) {
                // 检查“下一篇”笔记是否仍在今日待办中
                const nextNoteStillExists = dueNotesAfterAction.find(n => n.file.path === nextNoteInList.file.path);
                if (nextNoteStillExists) {
                    noteToOpen = nextNoteStillExists.file;
                }
            }
            // 如果不跳转到“下一篇”，或“下一篇”已不存在，则跳转到队首
            if (!noteToOpen) {
                noteToOpen = dueNotesAfterAction[0].file;
            }
            this.app.workspace.getLeaf(true).openFile(noteToOpen);
        }
    }
  }

  async handleNext(note: ReviewNote) { await this.handleAction(note, true); }
  async handleSetAside(note: ReviewNote) { await this.handleAction(note, false); }
  
  // ... 其他辅助函数保持不变 ...
  async handleDelete(currentNote: ReviewNote) { const confirmDelete = await new Promise<boolean>((resolve) => { const modal = new Modal(this.app); modal.contentEl.createEl("h2", { text: "确认删除" }); modal.contentEl.createEl("p", { text: `确定要删除笔记 "${currentNote.file.basename}" 吗？此操作不可撤销。` }); const buttonContainer = modal.contentEl.createDiv({ cls: "modal-button-container" }); const confirmButton = buttonContainer.createEl("button", { text: "删除", cls: "mod-warning" }); confirmButton.addEventListener("click", () => { resolve(true); modal.close(); }); const cancelButton = buttonContainer.createEl("button", { text: "取消" }); cancelButton.addEventListener("click", () => { resolve(false); modal.close(); }); modal.open(); }); if (!confirmDelete) return; const leaves = this.app.workspace.getLeavesOfType("markdown"); for (const leaf of leaves) { if (leaf.view instanceof MarkdownView && leaf.view.file?.path === currentNote.file.path) { leaf.detach(); break; } } this.reviewQueue = this.reviewQueue.filter((n) => n.file.path !== currentNote.file.path); await this.app.vault.delete(currentNote.file); if (this.reviewQueue.length > 0) { const nextNote = this.reviewQueue[0]; if (nextNote) { this.app.workspace.getLeaf(true).openFile(nextNote.file); } } this.refreshView(); new Notice(`笔记 "${currentNote.file.basename}" 已永久删除`); }
  onunload() {}
  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }
  async activateView() { const { workspace } = this.app; const leaves = workspace.getLeavesOfType("review-scheduler-view"); if (leaves.length > 0) { workspace.revealLeaf(leaves[0]); return; } const leaf = workspace.getLeftLeaf(false); if (leaf) { await leaf.setViewState({ type: "review-scheduler-view", active: true }); workspace.revealLeaf(leaf); } }
  async updateNoteMetadata(file: TFile, reviewDate: Date, repHistory: Date[]) { const content = await this.app.vault.read(file); const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter; if (!frontmatter) { const newContent = `---\nreviewDate: ${reviewDate.toISOString()}\nrepHistory: ${JSON.stringify(repHistory)}\ntags: [review]\n---\n\n${content}`; await this.app.vault.modify(file, newContent); } else { let newContent = content; const frontmatterRegex = /^---\n([\s\S]*?)\n---/; const match = content.match(frontmatterRegex); if (match) { let frontmatterContent = match[1]; if (frontmatterContent.includes("reviewDate:")) { frontmatterContent = frontmatterContent.replace(/reviewDate:.*/, `reviewDate: ${reviewDate.toISOString()}`); } else { frontmatterContent += `\nreviewDate: ${reviewDate.toISOString()}`; } if (frontmatterContent.includes("repHistory:")) { frontmatterContent = frontmatterContent.replace(/repHistory:.*/, `repHistory: ${JSON.stringify(repHistory)}`); } else { frontmatterContent += `\nrepHistory: ${JSON.stringify(repHistory)}`; } newContent = content.replace(frontmatterRegex, `---\n${frontmatterContent}\n---`); await this.app.vault.modify(file, newContent); } } }
  async removeNoteReviewMetadata(file: TFile) { let content = await this.app.vault.read(file); let newContent = content; const frontmatterRegex = /^---\n([\s\S]*?)\n---/; const match = content.match(frontmatterRegex); if (match) { let frontmatterContent = match[1]; frontmatterContent = frontmatterContent.replace(/reviewDate:.*\n?/, "").replace(/repHistory:.*\n?/, "").replace(/sr-due:.*\n?/, "").replace(/sr-interval:.*\n?/, "").replace(/sr-ease:.*\n?/, ""); if (frontmatterContent.includes("tags:")) { frontmatterContent = frontmatterContent.replace(/tags:\s*\[(.*?)\]/, (match, tags) => { const tagList = tags.split(",").map((tag: string) => tag.trim()); const filteredTags = tagList.filter((tag: string) => !tag.toLowerCase().includes('review') && !tag.toLowerCase().includes('priority-')); return filteredTags.length > 0 ? `tags: [${filteredTags.join(", ")}]` : ""; }); frontmatterContent = frontmatterContent.replace(/tags:\s*\n(\s*-\s*(review|priority-high|priority-medium|priority-low)\s*\n?)+/, ""); } frontmatterContent = frontmatterContent.replace(/\n\s*\n/g, "\n").trim(); newContent = frontmatterContent ? content.replace(frontmatterRegex, `---\n${frontmatterContent}\n---`) : content.replace(frontmatterRegex, "").trim(); } const inlineTagRegex = /#review\b|#priority-high\b|#priority-medium\b|#priority-low\b/g; newContent = newContent.replace(inlineTagRegex, ""); await this.app.vault.modify(file, newContent); }
  async setNotePriority(note: ReviewNote, priority: 'high' | 'medium' | 'low') { let content = await this.app.vault.read(note.file); let newContent = content; const frontmatterRegex = /^---\n([\s\S]*?)\n---/; const match = content.match(frontmatterRegex); if (match) { let frontmatterContent = match[1]; frontmatterContent = frontmatterContent.replace(/priority-high/g, "").replace(/priority-medium/g, "").replace(/priority-low/g, ""); if (frontmatterContent.includes("tags:")) { const yamlArrayTagsRegex = /tags:\s*\n(\s*-\s*.*\n)*/; const yamlArrayMatch = frontmatterContent.match(yamlArrayTagsRegex); if (yamlArrayMatch) { frontmatterContent = frontmatterContent.replace(yamlArrayTagsRegex, (match) => match.replace(/(\s*-\s*priority-.*\n?)/g, '') + `  - priority-${priority}\n`); } else { const inlineArrayRegex = /tags:\s*\[(.*?)\]/; const inlineMatch = frontmatterContent.match(inlineArrayRegex); if (inlineMatch) { let tags = inlineMatch[1].split(",").map(t => t.trim()); tags = tags.filter(t => t && !t.startsWith("priority-")); tags.push(`priority-${priority}`); frontmatterContent = frontmatterContent.replace(inlineArrayRegex, `tags: [${tags.join(", ")}]`); } } } else { frontmatterContent += `\ntags:\n  - priority-${priority}`; } newContent = content.replace(frontmatterRegex, `---\n${frontmatterContent.replace(/\n\s*\n/g, '\n').trim()}\n---`); } else { newContent = `---\ntags:\n  - review\n  - priority-${priority}\n---\n\n${content}`; } await this.app.vault.modify(note.file, newContent); note.priority = priority; new Notice(`笔记 "${note.file.basename}" 已设置为${priority === 'high' ? '高' : priority === 'medium' ? '中' : '低'}优先级`); }
}

class ReviewSchedulerView extends ItemView {
  plugin: ReviewSchedulerPlugin;
  private scrollContainer: HTMLDivElement;

  constructor(leaf: WorkspaceLeaf, plugin: ReviewSchedulerPlugin) { super(leaf); this.plugin = plugin; }
  getViewType(): string { return "review-scheduler-view"; }
  getDisplayText(): string { return "复习排程器"; }
  getIcon(): string { return "calendar-clock"; }
  async onOpen() { await this.plugin.scanNotesForReview(); }
  truncateTitle(title: string, maxLength: number = 40): string { if (title.length <= maxLength) return title; return title.substring(0, maxLength) + "..."; }

  // 新增：只更新高亮，不重绘
  updateHighlights() {
    const activeFile = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
    const listItems = this.scrollContainer?.querySelectorAll("li");
    if (!listItems) return;

    listItems.forEach(item => {
        if (item.dataset.path === activeFile?.path) {
            item.addClass("current-review-note");
        } else {
            item.removeClass("current-review-note");
        }
    });
  }

  render() {
    const savedScroll = this.scrollContainer?.scrollTop || 0;

    const contentEl = this.containerEl;
    contentEl.empty();
    const mainContainer = contentEl.createDiv({ cls: "review-scheduler-container" });
    const headerEl = mainContainer.createDiv({ cls: "review-scheduler-header" });
    headerEl.createEl("h1", { text: "复习排程器" });
    this.scrollContainer = mainContainer.createDiv({ cls: "review-scheduler-content" });

    if (this.plugin.reviewQueue.length === 0) {
      this.scrollContainer.createEl("p", { text: "当前没有需要复习的笔记。" });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueTodayNotes = this.plugin.reviewQueue.filter((note) => new Date(note.reviewDate).setHours(0, 0, 0, 0) <= today.getTime());
    const upcomingNotes = this.plugin.reviewQueue.filter((note) => new Date(note.reviewDate).setHours(0, 0, 0, 0) > today.getTime()).slice(0, 10);

    const createSection = (title: string, notes: ReviewNote[]) => {
        const section = this.scrollContainer.createDiv({ cls: "review-section" });
        section.createEl("h2", { text: `${title} (${notes.length})` });
        if (notes.length > 0) {
            const list = section.createEl("ul");
            for (const note of notes) {
                const item = list.createEl("li");
                item.dataset.path = note.file.path; // 存储路径用于高亮
                const noteInfo = item.createDiv({ cls: "review-note-info" });
                noteInfo.createEl("span", { text: this.truncateTitle(note.file.basename), cls: "review-note-title" });
                noteInfo.createEl("span", { text: new Date(note.reviewDate).toLocaleDateString(), cls: "review-note-date" });
                item.addEventListener("click", () => {
                    this.app.workspace.getLeaf(true).openFile(note.file);
                });
            }
        } else {
            section.createEl("p", { text: `没有${title}的笔记。` });
        }
    };

    createSection("今天需要复习", dueTodayNotes);
    createSection("即将到来的复习", upcomingNotes);

    this.updateHighlights();
    
    // 恢复滚动位置
    this.scrollContainer.scrollTop = savedScroll;
  }
}

class ReviewSchedulerSettingTab extends PluginSettingTab {
  plugin: ReviewSchedulerPlugin;
  constructor(app: App, plugin: ReviewSchedulerPlugin) { super(app, plugin); this.plugin = plugin; }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "复习排程器设置" });

    new Setting(containerEl).setName("间隔乘数").setDesc("用于计算复习间隔的乘数，默认为1.5").addText((text) => text.setValue(this.plugin.settings.multiplier.toString()).onChange(async (value) => { const numValue = parseFloat(value); if (!isNaN(numValue) && numValue > 0) { this.plugin.settings.multiplier = numValue; await this.plugin.saveSettings(); } }));
    new Setting(containerEl).setName("排程随机度").setDesc("为复习间隔增加随机性，避免笔记扎堆。例如0.1代表+/-10%的随机延迟。").addText((text) => text.setValue(this.plugin.settings.randomness.toString()).onChange(async (value) => { const numValue = parseFloat(value); if (!isNaN(numValue) && numValue >= 0 && numValue <= 1) { this.plugin.settings.randomness = numValue; await this.plugin.saveSettings(); } }));
    
    containerEl.createEl("h3", { text: "队列行为设置" });
    new Setting(containerEl).setName("开启组内乱序").setDesc("开启后，同一优先级的待复习笔记会随机排序。关闭则按笔记创建时间排序。").addToggle(toggle => toggle.setValue(this.plugin.settings.enableShuffle).onChange(async value => { this.plugin.settings.enableShuffle = value; await this.plugin.saveSettings(); this.plugin.scanNotesForReview(); }));
    new Setting(containerEl).setName("开启优先级随机提升").setDesc("开启后，低优先级的笔记有一定几率被临时提升到更高优先级队列中。").addToggle(toggle => toggle.setValue(this.plugin.settings.enablePriorityPromotion).onChange(async value => { this.plugin.settings.enablePriorityPromotion = value; await this.plugin.saveSettings(); this.plugin.scanNotesForReview(); }));
    new Setting(containerEl).setName("优先级提升概率").setDesc("每个笔记有多大几率被提升一级。默认为 0.05 (5%)。").addText((text) => text.setValue(this.plugin.settings.promotionChance.toString()).onChange(async (value) => { const numValue = parseFloat(value); if (!isNaN(numValue) && numValue >= 0 && numValue <= 1) { this.plugin.settings.promotionChance = numValue; await this.plugin.saveSettings(); } }));
    
    // 修改：使用下拉菜单
    new Setting(containerEl).setName("完成后自动跳转").setDesc("处理完一篇笔记后，自动打开下一篇笔记的行为。").addDropdown(dropdown => dropdown
        .addOption('off', '不跳转')
        .addOption('top', '跳转到队列顶端')
        .addOption('next', '跳转到列表下一篇')
        .setValue(this.plugin.settings.jumpAfterReview)
        .onChange(async (value: 'off' | 'top' | 'next') => {
            this.plugin.settings.jumpAfterReview = value;
            await this.plugin.saveSettings();
        }));

    containerEl.createEl("h3", { text: "优先级乘数设置" });
    new Setting(containerEl).setName("高优先级乘数").setDesc("默认为0.8（减少20%延迟）").addText((text) => text.setValue(this.plugin.settings.priorityMultipliers.high.toString()).onChange(async (value) => { const numValue = parseFloat(value); if (!isNaN(numValue) && numValue > 0) { this.plugin.settings.priorityMultipliers.high = numValue; await this.plugin.saveSettings(); } }));
    new Setting(containerEl).setName("中优先级乘数").setDesc("默认为1.0（保持原有延迟）").addText((text) => text.setValue(this.plugin.settings.priorityMultipliers.medium.toString()).onChange(async (value) => { const numValue = parseFloat(value); if (!isNaN(numValue) && numValue > 0) { this.plugin.settings.priorityMultipliers.medium = numValue; await this.plugin.saveSettings(); } }));
    new Setting(containerEl).setName("低优先级乘数").setDesc("默认为1.2（增加20%延迟）").addText((text) => text.setValue(this.plugin.settings.priorityMultipliers.low.toString()).onChange(async (value) => { const numValue = parseFloat(value); if (!isNaN(numValue) && numValue > 0) { this.plugin.settings.priorityMultipliers.low = numValue; await this.plugin.saveSettings(); } }));
    
    containerEl.createEl("h3", { text: "快捷键设置" });
    new Setting(containerEl).setName("开始复习").setDesc("打开当前需要复习的笔记").addText((text) => text.setValue(this.plugin.settings.hotkeys.startReview).onChange(async (value) => { this.plugin.settings.hotkeys.startReview = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("删除笔记").setDesc("从复习队列中删除当前笔记").addText((text) => text.setValue(this.plugin.settings.hotkeys.deleteNote).onChange(async (value) => { this.plugin.settings.hotkeys.deleteNote = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("设置高优先级").setDesc("将当前笔记设置为高优先级").addText((text) => text.setValue(this.plugin.settings.hotkeys.setPriorityHigh).onChange(async (value) => { this.plugin.settings.hotkeys.setPriorityHigh = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("设置中优先级").setDesc("将当前笔记设置为中优先级").addText((text) => text.setValue(this.plugin.settings.hotkeys.setPriorityMedium).onChange(async (value) => { this.plugin.settings.hotkeys.setPriorityMedium = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("设置低优先级").setDesc("将当前笔记设置为低优先级").addText((text) => text.setValue(this.plugin.settings.hotkeys.setPriorityLow).onChange(async (value) => { this.plugin.settings.hotkeys.setPriorityLow = value; await this.plugin.saveSettings(); }));
  }
}

class SetReviewDateModal extends Modal {
  note: ReviewNote;
  plugin: ReviewSchedulerPlugin;
  constructor(app: App, note: ReviewNote, plugin: ReviewSchedulerPlugin) { super(app); this.note = note; this.plugin = plugin; }
  onOpen() { const { contentEl } = this; contentEl.empty(); contentEl.createEl("h2", { text: "设置复习日期" }); const dateInput = contentEl.createEl("input", { type: "date" }); dateInput.value = this.note.reviewDate.toISOString().split('T')[0]; const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" }); const saveButton = buttonContainer.createEl("button", { text: "保存" }); saveButton.addEventListener("click", async () => { const newDate = new Date(dateInput.value); newDate.setHours(0, 0, 0, 0); this.note.reviewDate = newDate; await this.plugin.updateNoteMetadata(this.note.file, newDate, this.note.repHistory); this.plugin.scanNotesForReview(); this.close(); new Notice(`笔记 "${this.note.file.basename}" 的复习日期已更新为 ${newDate.toLocaleDateString()}`); }); const cancelButton = buttonContainer.createEl("button", { text: "取消" }); cancelButton.addEventListener("click", () => { this.close(); }); }
  onClose() { const { contentEl } = this; contentEl.empty(); }
}
