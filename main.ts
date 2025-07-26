import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  Workspace,
  WorkspaceLeaf,
  MarkdownRenderer,
  ItemView,
} from "obsidian";

interface ReviewNote {
  file: TFile;
  reviewDate: Date;
  repHistory: Date[];
  priority: 'high' | 'medium' | 'low' | null;
}

interface ReviewSchedulerSettings {
  multiplier: number;
  priorityMultipliers: {
    high: number;
    medium: number;
    low: number;
  };
  randomFactor: number; // 0-1 之间的随机因子，用于低优先级提前复习的概率
  randomness: number; // 新增：用于间隔计算的随机性
  hotkeys: {
    startReview: string;
    deleteNote: string;
    setPriorityHigh: string;
    setPriorityMedium: string;
    setPriorityLow: string;
  };
}

const DEFAULT_SETTINGS: ReviewSchedulerSettings = {
  multiplier: 1.5,
  priorityMultipliers: {
    high: 0.8,    // 高优先级减少 20% 的延迟
    medium: 1.0,  // 中优先级保持原有延迟
    low: 1.2,     // 低优先级增加 20% 的延迟
  },
  randomFactor: 0.2, // 20% 的概率让低优先级提前复习
  randomness: 0.1, // 新增：为复习间隔增加 +/-10% 的随机性
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

    // 事件监听保持不变...
    this.registerEvent(this.app.vault.on('modify', (file) => { if (file instanceof TFile && file.extension === 'md') this.scanNotesForReview(); }));
    this.registerEvent(this.app.vault.on('create', (file) => { if (file instanceof TFile && file.extension === 'md') this.scanNotesForReview(); }));
    this.registerEvent(this.app.vault.on('delete', (file) => { if (file instanceof TFile && file.extension === 'md') this.scanNotesForReview(); }));
    this.registerEvent(this.app.metadataCache.on('changed', (file) => { if (file instanceof TFile && file.extension === 'md') this.scanNotesForReview(); }));

    this.registerView("review-scheduler-view", (leaf) => new ReviewSchedulerView(leaf, this));

    this.addCommand({
      id: "open-review-scheduler",
      name: "打开复习排程器",
      callback: () => this.activateView(),
    });

    // 使用 checkCallback 重构所有命令，使其具有上下文感知能力
    this.addCommand({
      id: "review-next",
      name: "复习：下一步",
      checkCallback: (checking: boolean) => {
        const note = this.getNoteForAction();
        if (note) {
          if (!checking) {
            this.handleNext(note).then(() => this.refreshView());
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "review-set-aside",
      name: "复习：搁置",
      checkCallback: (checking: boolean) => {
        const note = this.getNoteForAction();
        if (note) {
          if (!checking) {
            this.handleSetAside(note).then(() => this.refreshView());
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "review-start",
      name: "复习：开始复习",
      checkCallback: (checking: boolean) => {
        const note = this.getNoteForAction();
        if (note) {
          if (!checking) {
            this.app.workspace.getLeaf(true).openFile(note.file);
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "review-delete",
      name: "复习：删除当前笔记",
      checkCallback: (checking: boolean) => {
        const note = this.getNoteForAction();
        if (note) {
          if (!checking) {
            this.handleDelete(note); // 封装删除逻辑
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "review-set-priority-high",
      name: "复习：设置为高优先级",
      checkCallback: (checking: boolean) => {
        const note = this.getNoteForAction();
        if (note) {
          if (!checking) {
            this.setNotePriority(note, 'high').then(() => this.refreshView());
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "review-set-priority-medium",
      name: "复习：设置为中优先级",
      checkCallback: (checking: boolean) => {
        const note = this.getNoteForAction();
        if (note) {
          if (!checking) {
            this.setNotePriority(note, 'medium').then(() => this.refreshView());
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "review-set-priority-low",
      name: "复习：设置为低优先级",
      checkCallback: (checking: boolean) => {
        const note = this.getNoteForAction();
        if (note) {
          if (!checking) {
            this.setNotePriority(note, 'low').then(() => this.refreshView());
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "review-set-custom-date",
      name: "复习：设置自定义复习日期",
      checkCallback: (checking: boolean) => {
        const note = this.getNoteForAction();
        if (note) {
          if (!checking) {
            new SetReviewDateModal(this.app, note, this).open();
          }
          return true;
        }
        return false;
      },
    });

    this.addSettingTab(new ReviewSchedulerSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => this.scanNotesForReview());
  }

  // 新增：辅助函数，获取当前应操作的笔记
  private getNoteForAction(): ReviewNote | null {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    // 优先：当前打开的笔记
    if (activeView?.file) {
      const noteInQueue = this.reviewQueue.find(n => n.file.path === activeView.file.path);
      if (noteInQueue) {
        return noteInQueue;
      }
    }
    // 备选：侧边栏视图中的第一个到期笔记
    const sidebarView = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]?.view as ReviewSchedulerView;
    if (sidebarView?.currentNote) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const noteDate = new Date(sidebarView.currentNote.reviewDate);
      noteDate.setHours(0, 0, 0, 0);
      if (noteDate.getTime() <= today.getTime()) {
        return sidebarView.currentNote;
      }
    }
    return null;
  }
  
  // 新增：辅助函数，刷新侧边栏视图
  private refreshView() {
    const view = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]?.view as ReviewSchedulerView;
    if (view) {
      view.render();
    }
  }

  // 新增：封装删除逻辑
  async handleDelete(currentNote: ReviewNote) {
    const confirmDelete = await new Promise<boolean>((resolve) => {
      const modal = new Modal(this.app);
      modal.contentEl.createEl("h2", { text: "确认删除" });
      modal.contentEl.createEl("p", { text: `确定要删除笔记 "${currentNote.file.basename}" 吗？此操作不可撤销。` });
      const buttonContainer = modal.contentEl.createDiv({ cls: "modal-button-container" });
      const confirmButton = buttonContainer.createEl("button", { text: "删除", cls: "mod-warning" });
      confirmButton.addEventListener("click", () => { resolve(true); modal.close(); });
      const cancelButton = buttonContainer.createEl("button", { text: "取消" });
      cancelButton.addEventListener("click", () => { resolve(false); modal.close(); });
      modal.open();
    });

    if (!confirmDelete) return;

    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (leaf.view instanceof MarkdownView && leaf.view.file?.path === currentNote.file.path) {
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
    new Notice(`笔记 "${currentNote.file.basename}" 已永久删除`);
  }

  onunload() {}

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

  // 重构：扫描和排序逻辑
  async scanNotesForReview() {
    console.log('开始扫描笔记...');
    this.reviewQueue = [];
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const metadata = this.app.metadataCache.getFileCache(file);
      let hasReviewTag = false;
      let priority: 'high' | 'medium' | 'low' | null = null;

      if (metadata?.frontmatter?.tags) {
        const tags = Array.isArray(metadata.frontmatter.tags) ? metadata.frontmatter.tags : String(metadata.frontmatter.tags).split(/\s+/);
        hasReviewTag = tags.some(tag => String(tag).toLowerCase().startsWith('review'));
        if (tags.includes('priority-high')) priority = 'high';
        else if (tags.includes('priority-medium')) priority = 'medium';
        else if (tags.includes('priority-low')) priority = 'low';
      }

      if (!hasReviewTag && metadata?.tags) {
        hasReviewTag = metadata.tags.some(tag => tag.tag.toLowerCase().startsWith('#review'));
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

    // 解决问题1：增加按创建时间排序，确保稳定性
    this.reviewQueue.sort((a, b) => {
      const dateCompare = a.reviewDate.getTime() - b.reviewDate.getTime();
      if (dateCompare !== 0) return dateCompare;
      return a.file.stat.ctime - b.file.stat.ctime;
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dueNotes = this.reviewQueue.filter(note => {
      const noteDate = new Date(note.reviewDate);
      noteDate.setHours(0, 0, 0, 0);
      return noteDate.getTime() <= today.getTime();
    });

    const upcomingNotes = this.reviewQueue.filter(note => {
      const noteDate = new Date(note.reviewDate);
      noteDate.setHours(0, 0, 0, 0);
      return noteDate.getTime() > today.getTime();
    });

    // 解决问题4：按优先级分组
    const priorityGroups = {
      high: dueNotes.filter(n => n.priority === 'high'),
      medium: dueNotes.filter(n => n.priority === 'medium'),
      low: dueNotes.filter(n => n.priority === 'low'),
      none: dueNotes.filter(n => n.priority === null),
    };

    // 解决问题2：组内乱序
    const shuffle = (array: ReviewNote[]) => {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    };

    // 重建队列：高 -> 中 -> 低 -> 无优先级 -> 即将到来
    this.reviewQueue = [
      ...shuffle(priorityGroups.high),
      ...shuffle(priorityGroups.medium),
      ...shuffle(priorityGroups.low),
      ...shuffle(priorityGroups.none),
      ...upcomingNotes
    ];

    console.log(`扫描完成，找到 ${this.reviewQueue.length} 个待复习笔记`);
    this.refreshView();
  }

  // 重构：计算下次复习日期，增加随机性
  calculateNextReviewDate(repHistory: Date[], priority: 'high' | 'medium' | 'low' | null = null): Date {
    const today = new Date();
    const interval = Math.ceil(this.settings.multiplier ** Math.max(repHistory.length, 1));
    const priorityMultiplier = priority ? this.settings.priorityMultipliers[priority] : 1.0;
    const adjustedInterval = Math.ceil(interval * priorityMultiplier);

    // 解决问题2：增加随机因子
    const randomFuzz = (Math.random() - 0.5) * 2 * this.settings.randomness;
    const finalInterval = Math.max(1, Math.round(adjustedInterval * (1 + randomFuzz)));

    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + finalInterval);
    return nextDate;
  }

  async handleNext(note: ReviewNote) {
    const today = new Date();
    note.repHistory.push(today);
    note.reviewDate = this.calculateNextReviewDate(note.repHistory, note.priority);
    await this.updateNoteMetadata(note.file, note.reviewDate, note.repHistory);
    
    // 从队列中移除并重新排序
    this.reviewQueue = this.reviewQueue.filter((n) => n.file.path !== note.file.path);
    this.reviewQueue.push(note);
    this.reviewQueue.sort((a, b) => a.reviewDate.getTime() - b.reviewDate.getTime());

    new Notice(`笔记 "${note.file.basename}" 已排程到 ${note.reviewDate.toLocaleDateString()}`);
    
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (leaf.view instanceof MarkdownView && leaf.view.file?.path === note.file.path) {
        leaf.detach();
        break;
      }
    }

    if (this.reviewQueue.length > 0) {
      const nextNote = this.reviewQueue[0];
      const nextNoteDate = new Date(nextNote.reviewDate);
      nextNoteDate.setHours(0,0,0,0);
      const todayDate = new Date();
      todayDate.setHours(0,0,0,0);

      if (nextNote && nextNoteDate.getTime() <= todayDate.getTime()) {
        this.app.workspace.getLeaf(true).openFile(nextNote.file);
      }
    }
  }

  async handleSetAside(note: ReviewNote) {
    await this.removeNoteReviewMetadata(note.file);
    this.reviewQueue = this.reviewQueue.filter((n) => n.file.path !== note.file.path);
    new Notice(`笔记 "${note.file.basename}" 已从复习队列中移除`);

    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (leaf.view instanceof MarkdownView && leaf.view.file?.path === note.file.path) {
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

  // updateNoteMetadata, removeNoteReviewMetadata, setNotePriority 保持不变...
  async updateNoteMetadata(file: TFile, reviewDate: Date, repHistory: Date[]) {
    const content = await this.app.vault.read(file);
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;

    try {
      console.log(`更新笔记 ${file.basename} 的元数据:`);
      console.log('复习日期:', reviewDate);
      console.log('复习日期ISO格式:', reviewDate.toISOString());
      console.log('复习历史:', repHistory);
    } catch (error) {
      console.error(`笔记 ${file.basename} 的日期格式错误:`, reviewDate);
      console.error('错误详情:', error);
    }

    if (!frontmatter) {
      // 如果没有frontmatter，则添加一个
      const newContent = `---\nreviewDate: ${reviewDate.toISOString()}\nrepHistory: ${JSON.stringify(
        repHistory
      )}\ntags: [review]\n---\n\n${content}`;
      await this.app.vault.modify(file, newContent);
    } else {
      // 更新现有的frontmatter
      let newContent = content;
      const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
      const match = content.match(frontmatterRegex);

      if (match) {
        let frontmatterContent = match[1];

        // 更新reviewDate
        if (frontmatterContent.includes("reviewDate:")) {
          frontmatterContent = frontmatterContent.replace(
            /reviewDate:.*/,
            `reviewDate: ${reviewDate.toISOString()}`
          );
        } else {
          frontmatterContent += `\nreviewDate: ${reviewDate.toISOString()}`;
        }

        // 更新repHistory
        if (frontmatterContent.includes("repHistory:")) {
          frontmatterContent = frontmatterContent.replace(
            /repHistory:.*/,
            `repHistory: ${JSON.stringify(repHistory)}`
          );
        } else {
          frontmatterContent += `\nrepHistory: ${JSON.stringify(repHistory)}`;
        }

        newContent = content.replace(
          frontmatterRegex,
          `---\n${frontmatterContent}\n---`
        );
        await this.app.vault.modify(file, newContent);
      }
    }
  }

  async removeNoteReviewMetadata(file: TFile) {
    const content = await this.app.vault.read(file);
    let newContent = content;
    
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);

    if (match) {
      let frontmatterContent = match[1];

      frontmatterContent = frontmatterContent
        .replace(/reviewDate:.*\n?/, "")
        .replace(/repHistory:.*\n?/, "")
        .replace(/sr-due:.*\n?/, "")
        .replace(/sr-interval:.*\n?/, "")
        .replace(/sr-ease:.*\n?/, "");

      if (frontmatterContent.includes("tags:")) {
        frontmatterContent = frontmatterContent.replace(
          /tags:\s*\n\s*-\s*review\s*\n?/,
          "tags:\n"
        );
        
        frontmatterContent = frontmatterContent.replace(
          /tags:\s*review\s*\n/,
          ""
        );
        
        frontmatterContent = frontmatterContent.replace(
          /tags:\s*\[(.*?)\]/,
          (match, tags) => {
            const tagList = tags.split(",").map((tag: string) => tag.trim());
            const filteredTags = tagList.filter(
              (tag: string) => !tag.toLowerCase().startsWith('review')
            );
            return filteredTags.length > 0
              ? `tags: [${filteredTags.join(", ")}]`
              : "tags: []";
          }
        );
      }

      frontmatterContent = frontmatterContent.replace(/\n\s*\n/g, "\n").trim();

      newContent = frontmatterContent
        ? content.replace(frontmatterRegex, `---\n${frontmatterContent}\n---`)
        : content.replace(frontmatterRegex, "").trim();
    }
    
    const inlineTagRegex = /#review\b/g;
    newContent = newContent.replace(inlineTagRegex, "");
    
    await this.app.vault.modify(file, newContent);
    
    console.log(`已从笔记 ${file.basename} 中移除复习元数据和标签`);
  }

  async setNotePriority(note: ReviewNote, priority: 'high' | 'medium' | 'low') {
    const content = await this.app.vault.read(note.file);
    
    let newContent = content;
    let hasFrontmatter = false;
    let frontmatterContent = "";
    
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);

    if (match) {
      hasFrontmatter = true;
      frontmatterContent = match[1];

      frontmatterContent = frontmatterContent
        .replace(/priority-high/g, "")
        .replace(/priority-medium/g, "")
        .replace(/priority-low/g, "");

      if (frontmatterContent.includes("tags:")) {
        frontmatterContent = frontmatterContent.replace(/tags:\s*\n\s*-\s*\n/g, "tags:\n");
        
        const yamlArrayTagsRegex = /tags:\s*\n(\s*-\s*.*\n)*/;
        const yamlArrayMatch = frontmatterContent.match(yamlArrayTagsRegex);
        
        if (yamlArrayMatch) {
          frontmatterContent = frontmatterContent.replace(
            yamlArrayTagsRegex,
            (match) => match + `  - priority-${priority}\n`
          );
        } else {
          const inlineArrayRegex = /tags:\s*\[(.*?)\]/;
          const inlineMatch = frontmatterContent.match(inlineArrayRegex);
          
          if (inlineMatch) {
            let tags = inlineMatch[1].split(",").map(t => t.trim());
            tags = tags.filter(t => t && !t.startsWith("priority-"));
            tags.push(`priority-${priority}`);
            
            frontmatterContent = frontmatterContent.replace(
              inlineArrayRegex,
              `tags: [${tags.join(", ")}]`
            );
          } else {
            frontmatterContent = frontmatterContent.replace(
              /tags:\s*(.*?)(\n|$)/,
              (match, tag) => {
                if (!tag || tag.trim() === "") {
                  return `tags: priority-${priority}\n`;
                } else {
                  if (tag.includes(" ")) {
                    const tagList = tag.split(/\s+/).filter((t: string) => t && !t.startsWith("priority-"));
                    tagList.push(`priority-${priority}`);
                    return `tags: ${tagList.join(" ")}\n`;
                  } else {
                    return `tags: [${tag.trim()}, priority-${priority}]\n`;
                  }
                }
              }
            );
          }
        }
      } else {
        frontmatterContent += `\ntags:\n  - review\n  - priority-${priority}`;
      }

      newContent = content.replace(frontmatterRegex, `---\n${frontmatterContent}\n---`);
    } else {
      newContent = `---\ntags:\n  - review\n  - priority-${priority}\n---\n\n${content}`;
    }
    
    await this.app.vault.modify(note.file, newContent);
    
    note.priority = priority;
    
    new Notice(`笔记 "${note.file.basename}" 已设置为${priority === 'high' ? '高' : priority === 'medium' ? '中' : '低'}优先级`);
  }
}

// ReviewSchedulerView 保持不变...
class ReviewSchedulerView extends ItemView {
  plugin: ReviewSchedulerPlugin;
  currentNote: ReviewNote | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ReviewSchedulerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return "review-scheduler-view";
  }

  getDisplayText(): string {
    return "复习排程器";
  }

  getIcon(): string {
    return "calendar-clock";
  }

  async onOpen() {
    await this.plugin.scanNotesForReview();
    this.render();

    this.registerEvent(this.app.vault.on('modify', (file) => { if (file instanceof TFile && file.extension === 'md') this.plugin.scanNotesForReview().then(() => this.render()); }));
    this.registerEvent(this.app.vault.on('create', (file) => { if (file instanceof TFile && file.extension === 'md') this.plugin.scanNotesForReview().then(() => this.render()); }));
    this.registerEvent(this.app.vault.on('delete', (file) => { if (file instanceof TFile && file.extension === 'md') this.plugin.scanNotesForReview().then(() => this.render()); }));
    this.registerEvent(this.app.metadataCache.on('changed', (file) => { if (file instanceof TFile && file.extension === 'md') this.plugin.scanNotesForReview().then(() => this.render()); }));
  }

  truncateTitle(title: string, maxLength: number = 40): string {
    if (title.length <= maxLength) return title;
    return title.substring(0, maxLength) + "...";
  }

  render() {
    console.log('开始渲染视图...');
    
    const contentEl = this.containerEl;
    contentEl.empty();

    const mainContainer = contentEl.createDiv({ cls: "review-scheduler-container" });
    const headerEl = mainContainer.createDiv({ cls: "review-scheduler-header" });
    headerEl.createEl("h1", { text: "复习排程器" });
    const contentContainer = mainContainer.createDiv({ cls: "review-scheduler-content" });

    if (this.plugin.reviewQueue.length === 0) {
      contentContainer.createEl("p", { text: "当前没有需要复习的笔记。" });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dueTodayNotes = this.plugin.reviewQueue.filter((note) => {
      const noteDate = new Date(note.reviewDate);
      noteDate.setHours(0, 0, 0, 0);
      return noteDate.getTime() <= today.getTime();
    });

    const todaySection = contentContainer.createDiv({ cls: "review-section" });
    todaySection.createEl("h2", { text: "今天需要复习" });
    
    if (dueTodayNotes.length > 0) {
      this.currentNote = dueTodayNotes[0];
      
      const todayList = todaySection.createEl("ul");
      
      for (const note of dueTodayNotes) {
        const item = todayList.createEl("li");
        if (note === this.currentNote) {
          item.addClass("current-review-note");
        }
        
        const noteInfo = item.createDiv({ cls: "review-note-info" });
        noteInfo.createEl("span", { text: this.truncateTitle(note.file.basename), cls: "review-note-title" });
        noteInfo.createEl("span", { text: new Date(note.reviewDate).toLocaleDateString(), cls: "review-note-date" });

        item.addEventListener("click", () => {
          this.currentNote = note;
          this.app.workspace.getLeaf(true).openFile(note.file);
          this.render();
        });
      }

      const buttonContainer = todaySection.createDiv({ cls: "review-buttons-container" });
      const reviewNowButton = buttonContainer.createEl("button", { text: "开始复习", cls: "review-now-button" });
      reviewNowButton.addEventListener("click", () => {
        if (this.currentNote) {
          this.app.workspace.getLeaf(true).openFile(this.currentNote.file);
        }
      });

      const refreshButton = buttonContainer.createEl("button", { text: "刷新", cls: "refresh-button" });
      refreshButton.addEventListener("click", () => {
        this.plugin.scanNotesForReview().then(() => {
          this.render();
          new Notice("队列已刷新");
        });
      });
    } else {
      todaySection.createEl("p", { text: "今天没有需要复习的笔记。" });
      const refreshButton = todaySection.createEl("button", { text: "刷新", cls: "refresh-button" });
      refreshButton.addEventListener("click", () => {
        this.plugin.scanNotesForReview().then(() => {
          this.render();
          new Notice("队列已刷新");
        });
      });
    }

    const upcomingSection = contentContainer.createDiv({ cls: "review-section" });
    upcomingSection.createEl("h2", { text: "即将到来的复习" });

    const upcomingNotes = this.plugin.reviewQueue
      .filter((note) => {
        const noteDate = new Date(note.reviewDate);
        noteDate.setHours(0, 0, 0, 0);
        return noteDate.getTime() > today.getTime();
      })
      .slice(0, 5);

    if (upcomingNotes.length > 0) {
      const upcomingList = upcomingSection.createEl("ul");
      for (const note of upcomingNotes) {
        const item = upcomingList.createEl("li");
        const noteInfo = item.createDiv({ cls: "review-note-info" });
        noteInfo.createEl("span", { text: this.truncateTitle(note.file.basename), cls: "review-note-title" });
        noteInfo.createEl("span", { text: new Date(note.reviewDate).toLocaleDateString(), cls: "review-note-date" });
        item.addEventListener("click", () => {
          this.currentNote = note;
          this.app.workspace.getLeaf(true).openFile(note.file);
          this.render();
        });
      }
    } else {
      upcomingSection.createEl("p", { text: "没有即将到来的复习。" });
    }
  }
}

// 更新设置选项卡
class ReviewSchedulerSettingTab extends PluginSettingTab {
  plugin: ReviewSchedulerPlugin;

  constructor(app: App, plugin: ReviewSchedulerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "复习排程器设置" });

    new Setting(containerEl)
      .setName("间隔乘数")
      .setDesc("用于计算复习间隔的乘数，默认为1.5")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.multiplier.toString())
          .onChange(async (value) => {
            const numValue = parseFloat(value);
            if (!isNaN(numValue) && numValue > 0) {
              this.plugin.settings.multiplier = numValue;
              await this.plugin.saveSettings();
            }
          })
      );

    // 新增：排程随机度设置
    new Setting(containerEl)
      .setName("排程随机度")
      .setDesc("为复习间隔增加随机性，避免笔记总在同一时间扎堆。例如0.1代表+/-10%的随机延迟。")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.randomness.toString())
          .onChange(async (value) => {
            const numValue = parseFloat(value);
            if (!isNaN(numValue) && numValue >= 0 && numValue <= 1) {
              this.plugin.settings.randomness = numValue;
              await this.plugin.saveSettings();
            }
          })
      );

    containerEl.createEl("h3", { text: "优先级设置" });

    new Setting(containerEl)
      .setName("高优先级乘数")
      .setDesc("高优先级内容的复习间隔乘数，默认为0.8（减少20%延迟）")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.priorityMultipliers.high.toString())
          .onChange(async (value) => {
            const numValue = parseFloat(value);
            if (!isNaN(numValue) && numValue > 0) {
              this.plugin.settings.priorityMultipliers.high = numValue;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("中优先级乘数")
      .setDesc("中优先级内容的复习间隔乘数，默认为1.0（保持原有延迟）")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.priorityMultipliers.medium.toString())
          .onChange(async (value) => {
            const numValue = parseFloat(value);
            if (!isNaN(numValue) && numValue > 0) {
              this.plugin.settings.priorityMultipliers.medium = numValue;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("低优先级乘数")
      .setDesc("低优先级内容的复习间隔乘数，默认为1.2（增加20%延迟）")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.priorityMultipliers.low.toString())
          .onChange(async (value) => {
            const numValue = parseFloat(value);
            if (!isNaN(numValue) && numValue > 0) {
              this.plugin.settings.priorityMultipliers.low = numValue;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("随机因子 (旧)")
      .setDesc("此设置已弃用，其功能已被新的排序和乱序逻辑取代。")
      .addText((text) => {
        text.setValue(this.plugin.settings.randomFactor.toString()).setDisabled(true);
      });

    // 快捷键设置保持不变...
    containerEl.createEl("h3", { text: "快捷键设置" });
    new Setting(containerEl).setName("开始复习").setDesc("打开当前需要复习的笔记").addText((text) => text.setValue(this.plugin.settings.hotkeys.startReview).onChange(async (value) => { this.plugin.settings.hotkeys.startReview = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("删除笔记").setDesc("从复习队列中删除当前笔记").addText((text) => text.setValue(this.plugin.settings.hotkeys.deleteNote).onChange(async (value) => { this.plugin.settings.hotkeys.deleteNote = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("设置高优先级").setDesc("将当前笔记设置为高优先级").addText((text) => text.setValue(this.plugin.settings.hotkeys.setPriorityHigh).onChange(async (value) => { this.plugin.settings.hotkeys.setPriorityHigh = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("设置中优先级").setDesc("将当前笔记设置为中优先级").addText((text) => text.setValue(this.plugin.settings.hotkeys.setPriorityMedium).onChange(async (value) => { this.plugin.settings.hotkeys.setPriorityMedium = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("设置低优先级").setDesc("将当前笔记设置为低优先级").addText((text) => text.setValue(this.plugin.settings.hotkeys.setPriorityLow).onChange(async (value) => { this.plugin.settings.hotkeys.setPriorityLow = value; await this.plugin.saveSettings(); }));
  }
}

// SetReviewDateModal 保持不变...
class SetReviewDateModal extends Modal {
  note: ReviewNote;
  plugin: ReviewSchedulerPlugin;

  constructor(app: App, note: ReviewNote, plugin: ReviewSchedulerPlugin) {
    super(app);
    this.note = note;
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "设置复习日期" });

    const dateInput = contentEl.createEl("input", { type: "date" });
    dateInput.value = this.note.reviewDate.toISOString().split('T')[0];

    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
    
    const saveButton = buttonContainer.createEl("button", { text: "保存" });
    saveButton.addEventListener("click", async () => {
      const newDate = new Date(dateInput.value);
      newDate.setHours(0, 0, 0, 0);
      
      this.note.reviewDate = newDate;
      await this.plugin.updateNoteMetadata(this.note.file, newDate, this.note.repHistory);
      
      const view = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]?.view as ReviewSchedulerView;
      if (view) {
        view.plugin.scanNotesForReview(); // 重新扫描并排序
      }
      
      this.close();
      new Notice(`笔记 "${this.note.file.basename}" 的复习日期已更新为 ${newDate.toLocaleDateString()}`);
    });

    const cancelButton = buttonContainer.createEl("button", { text: "取消" });
    cancelButton.addEventListener("click", () => {
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
