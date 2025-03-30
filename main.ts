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

    // 添加文件变更监听
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.scanNotesForReview();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.scanNotesForReview();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.scanNotesForReview();
        }
      })
    );

    // 添加元数据缓存变更监听
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.scanNotesForReview();
        }
      })
    );

    // 添加视图
    this.registerView(
      "review-scheduler-view",
      (leaf) => new ReviewSchedulerView(leaf, this)
    );

    // 添加命令
    this.addCommand({
      id: "open-review-scheduler",
      name: "打开复习排程器",
      callback: () => this.activateView(),
    });

    // 添加复习相关命令
    this.addCommand({
      id: "review-next",
      name: "复习：下一步",
      callback: async () => {
        const view = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]?.view as ReviewSchedulerView;
        if (view?.currentNote) {
          const currentNote = view.currentNote;
          await this.handleNext(currentNote);
          view.render();
        }
      },
    });

    this.addCommand({
      id: "review-set-aside",
      name: "复习：搁置",
      callback: async () => {
        const view = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]?.view as ReviewSchedulerView;
        if (view?.currentNote) {
          const currentNote = view.currentNote;
          await this.handleSetAside(currentNote);
          view.render();
        }
      },
    });

    // 添加新的命令
    this.addCommand({
      id: "review-start",
      name: "复习：开始复习",
      callback: async () => {
        const view = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]?.view as ReviewSchedulerView;
        if (view?.currentNote) {
          this.app.workspace.getLeaf(true).openFile(view.currentNote.file);
        }
      },
    });

    this.addCommand({
      id: "review-delete",
      name: "复习：删除当前笔记",
      callback: async () => {
        const view = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]?.view as ReviewSchedulerView;
        if (view?.currentNote) {
          const currentNote = view.currentNote;
          
          // 创建确认对话框
          const confirmDelete = await new Promise<boolean>((resolve) => {
            const modal = new Modal(this.app);
            modal.contentEl.createEl("h2", { text: "确认删除" });
            modal.contentEl.createEl("p", { 
              text: `确定要删除笔记 "${currentNote.file.basename}" 吗？此操作不可撤销。`
            });
            
            const buttonContainer = modal.contentEl.createDiv({ cls: "modal-button-container" });
            
            const confirmButton = buttonContainer.createEl("button", { 
              text: "删除",
              cls: "mod-warning"
            });
            confirmButton.addEventListener("click", () => {
              resolve(true);
              modal.close();
            });
            
            const cancelButton = buttonContainer.createEl("button", { text: "取消" });
            cancelButton.addEventListener("click", () => {
              resolve(false);
              modal.close();
            });
            
            modal.open();
          });
          
          if (!confirmDelete) return;
          
          // 关闭当前笔记
          const leaves = this.app.workspace.getLeavesOfType("markdown");
          for (const leaf of leaves) {
            if (leaf.view instanceof MarkdownView && leaf.view.file?.path === currentNote.file.path) {
              leaf.detach();
              break;
            }
          }
          
          // 从队列中移除笔记
          this.reviewQueue = this.reviewQueue.filter(
            (n) => n.file.path !== currentNote.file.path
          );
          
          // 真正删除笔记文件
          await this.app.vault.delete(currentNote.file);
          
          // 打开下一篇笔记
          if (this.reviewQueue.length > 0) {
            const nextNote = this.reviewQueue[0];
            if (nextNote) {
              this.app.workspace.getLeaf(true).openFile(nextNote.file);
            }
          }
          
          view.render();
          new Notice(`笔记 "${currentNote.file.basename}" 已永久删除`);
        }
      },
    });

    this.addCommand({
      id: "review-set-priority-high",
      name: "复习：设置为高优先级",
      callback: async () => {
        const view = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]?.view as ReviewSchedulerView;
        if (view?.currentNote) {
          await this.setNotePriority(view.currentNote, 'high');
          view.render();
        }
      },
    });

    this.addCommand({
      id: "review-set-priority-medium",
      name: "复习：设置为中优先级",
      callback: async () => {
        const view = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]?.view as ReviewSchedulerView;
        if (view?.currentNote) {
          await this.setNotePriority(view.currentNote, 'medium');
          view.render();
        }
      },
    });

    this.addCommand({
      id: "review-set-priority-low",
      name: "复习：设置为低优先级",
      callback: async () => {
        const view = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]?.view as ReviewSchedulerView;
        if (view?.currentNote) {
          await this.setNotePriority(view.currentNote, 'low');
          view.render();
        }
      },
    });

    this.addCommand({
      id: "review-set-custom-date",
      name: "复习：设置自定义复习日期",
      callback: async () => {
        const view = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]?.view as ReviewSchedulerView;
        if (view?.currentNote) {
          const modal = new SetReviewDateModal(this.app, view.currentNote, this);
          modal.open();
        }
      },
    });

    // 添加设置选项卡
    this.addSettingTab(new ReviewSchedulerSettingTab(this.app, this));

    // 在加载时扫描所有带review标签的笔记
    this.app.workspace.onLayoutReady(() => this.scanNotesForReview());
  }

  onunload() {
    // 清理操作
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // 激活视图
  async activateView() {
    const { workspace } = this.app;

    // 如果视图已经打开，则获取焦点
    const leaves = workspace.getLeavesOfType("review-scheduler-view");
    if (leaves.length > 0) {
      workspace.revealLeaf(leaves[0]);
      return;
    }

    // 否则新建一个视图
    const leaf = workspace.getLeftLeaf(false);
    if (leaf) {
      await leaf.setViewState({
        type: "review-scheduler-view",
        active: true,
      });
      workspace.revealLeaf(leaf);
    }
  }

  // 扫描所有带review标签的笔记
  async scanNotesForReview() {
    console.log('开始扫描笔记...');
    this.reviewQueue = [];
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const metadata = this.app.metadataCache.getFileCache(file);
      
      // 检查所有可能的标签位置
      let hasReviewTag = false;
      let priority: 'high' | 'medium' | 'low' | null = null;
      
      // 检查 frontmatter 中的标签
      if (metadata?.frontmatter?.tags) {
        let tags: string[] = [];
        
        if (Array.isArray(metadata.frontmatter.tags)) {
          tags = metadata.frontmatter.tags;
          console.log(`文件 ${file.basename} 使用数组格式的标签:`, tags);
        } else if (typeof metadata.frontmatter.tags === 'string') {
          // 处理空格分隔的标签字符串，例如 "review priority-medium"
          tags = metadata.frontmatter.tags.split(/\s+/);
          console.log(`文件 ${file.basename} 使用空格分隔的标签字符串:`, metadata.frontmatter.tags, "分割后:", tags);
        } else {
          tags = [metadata.frontmatter.tags];
          console.log(`文件 ${file.basename} 使用其他格式的标签:`, metadata.frontmatter.tags);
        }
        
        hasReviewTag = tags.some(tag => 
          typeof tag === 'string' && tag.toLowerCase().startsWith('review'));
        
        if (tags.includes('priority-high')) priority = 'high';
        else if (tags.includes('priority-medium')) priority = 'medium';
        else if (tags.includes('priority-low')) priority = 'low';
      }
      
      // 检查文件中的内联标签
      if (!hasReviewTag && metadata?.tags) {
        hasReviewTag = metadata.tags.some(tag => 
          tag.tag.toLowerCase().startsWith('#review'));
        
        if (!priority) {
          if (metadata.tags.some(tag => tag.tag === '#priority-high')) priority = 'high';
          else if (metadata.tags.some(tag => tag.tag === '#priority-medium')) priority = 'medium';
          else if (metadata.tags.some(tag => tag.tag === '#priority-low')) priority = 'low';
        }
      }

      if (!hasReviewTag) continue;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const reviewDate = metadata?.frontmatter?.reviewDate
        ? new Date(metadata.frontmatter.reviewDate)
        : today;
      const repHistory = metadata?.frontmatter?.repHistory || [];

      try {
        console.log(`处理笔记 ${file.basename} 的复习日期:`, metadata?.frontmatter?.reviewDate);
        console.log(`转换后的日期对象:`, reviewDate);
        console.log(`复习历史:`, repHistory);
      } catch (error) {
        console.error(`笔记 ${file.basename} 的日期格式错误:`, metadata?.frontmatter?.reviewDate);
        console.error('错误详情:', error);
      }

      this.reviewQueue.push({
        file,
        reviewDate,
        repHistory,
        priority,
      });
    }

    // 按复习日期和优先级排序
    this.reviewQueue.sort((a, b) => {
      const dateCompare = a.reviewDate.getTime() - b.reviewDate.getTime();
      if (dateCompare !== 0) return dateCompare;

      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const aPriority = a.priority ? priorityOrder[a.priority] : 3;
      const bPriority = b.priority ? priorityOrder[b.priority] : 3;
      return aPriority - bPriority;
    });

    // 应用随机因子，让低优先级内容有机会提前复习
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayNotes = this.reviewQueue.filter(note => {
      const noteDate = new Date(note.reviewDate);
      noteDate.setHours(0, 0, 0, 0);
      return noteDate.getTime() <= today.getTime() && note.priority === 'low';
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

    console.log(`扫描完成，找到 ${this.reviewQueue.length} 个待复习笔记`);
  }

  // 计算下一次复习日期
  calculateNextReviewDate(repHistory: Date[], priority: 'high' | 'medium' | 'low' | null = null): Date {
    const today = new Date();
    const interval = Math.ceil(
      this.settings.multiplier ** Math.max(repHistory.length, 1)
    );

    // 根据优先级调整间隔
    const priorityMultiplier = priority ? this.settings.priorityMultipliers[priority] : 1.0;
    const adjustedInterval = Math.ceil(interval * priorityMultiplier);

    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + adjustedInterval);

    return nextDate;
  }

  // 处理"下一步"操作
  async handleNext(note: ReviewNote) {
    // 更新复习历史
    const today = new Date();
    note.repHistory.push(today);

    // 计算下一次复习日期，考虑优先级
    note.reviewDate = this.calculateNextReviewDate(note.repHistory, note.priority);

    // 更新笔记的元数据
    await this.updateNoteMetadata(note.file, note.reviewDate, note.repHistory);

    // 从队列中移除当前笔记
    this.reviewQueue = this.reviewQueue.filter(
      (n) => n.file.path !== note.file.path
    );

    // 添加通知
    new Notice(
      `笔记 "${
        note.file.basename
      }" 已排程到 ${note.reviewDate.toLocaleDateString()}`
    );

    // 关闭当前笔记
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (leaf.view instanceof MarkdownView && leaf.view.file?.path === note.file.path) {
        leaf.detach();
        break;
      }
    }

    // 打开下一篇笔记
    if (this.reviewQueue.length > 0) {
      const nextNote = this.reviewQueue[0];
      if (nextNote) {
        this.app.workspace.getLeaf(true).openFile(nextNote.file);
      }
    }
  }

  // 处理"搁置"操作
  async handleSetAside(note: ReviewNote) {
    // 先移除笔记的复习元数据和标签
    await this.removeNoteReviewMetadata(note.file);
    
    // 从队列中移除笔记
    this.reviewQueue = this.reviewQueue.filter(
      (n) => n.file.path !== note.file.path
    );

    // 添加通知
    new Notice(`笔记 "${note.file.basename}" 已从复习队列中移除`);

    // 关闭当前笔记
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (leaf.view instanceof MarkdownView && leaf.view.file?.path === note.file.path) {
        leaf.detach();
        break;
      }
    }

    // 打开下一篇笔记
    if (this.reviewQueue.length > 0) {
      const nextNote = this.reviewQueue[0];
      if (nextNote) {
        this.app.workspace.getLeaf(true).openFile(nextNote.file);
      }
    }
  }

  // 更新笔记元数据
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

  // 移除笔记的复习元数据
  async removeNoteReviewMetadata(file: TFile) {
    // 读取文件内容
    const content = await this.app.vault.read(file);
    let newContent = content;
    
    // 1. 处理 frontmatter
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);

    if (match) {
      let frontmatterContent = match[1];

      // 移除所有复习相关的元数据
      frontmatterContent = frontmatterContent
        .replace(/reviewDate:.*\n?/, "")
        .replace(/repHistory:.*\n?/, "")
        .replace(/sr-due:.*\n?/, "")
        .replace(/sr-interval:.*\n?/, "")
        .replace(/sr-ease:.*\n?/, "");

      // 移除 frontmatter 中的 review 标签
      if (frontmatterContent.includes("tags:")) {
        // 处理 YAML 数组格式的标签
        frontmatterContent = frontmatterContent.replace(
          /tags:\s*\n\s*-\s*review\s*\n?/,
          "tags:\n"
        );
        
        // 处理单行格式的标签
        frontmatterContent = frontmatterContent.replace(
          /tags:\s*review\s*\n/,
          ""
        );
        
        // 处理数组格式的标签
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

      // 清理多余空行
      frontmatterContent = frontmatterContent.replace(/\n\s*\n/g, "\n").trim();

      // 更新 frontmatter
      newContent = frontmatterContent
        ? content.replace(frontmatterRegex, `---\n${frontmatterContent}\n---`)
        : content.replace(frontmatterRegex, "").trim();
    }
    
    // 2. 处理内联标签 (例如：#review)
    const inlineTagRegex = /#review\b/g;
    newContent = newContent.replace(inlineTagRegex, "");
    
    // 保存修改
    await this.app.vault.modify(file, newContent);
    
    console.log(`已从笔记 ${file.basename} 中移除复习元数据和标签`);
  }

  async setNotePriority(note: ReviewNote, priority: 'high' | 'medium' | 'low') {
    // 读取文件内容
    const content = await this.app.vault.read(note.file);
    
    // 移除旧的优先级标签
    let newContent = content;
    let hasFrontmatter = false;
    let frontmatterContent = "";
    
    // 处理 frontmatter
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);

    if (match) {
      hasFrontmatter = true;
      frontmatterContent = match[1];

      // 移除所有优先级标签
      frontmatterContent = frontmatterContent
        .replace(/priority-high/g, "")
        .replace(/priority-medium/g, "")
        .replace(/priority-low/g, "");

      // 处理 YAML 数组格式的标签
      if (frontmatterContent.includes("tags:")) {
        // 删除空行
        frontmatterContent = frontmatterContent.replace(/tags:\s*\n\s*-\s*\n/g, "tags:\n");
        
        // 检查是否有 tags 数组格式
        const yamlArrayTagsRegex = /tags:\s*\n(\s*-\s*.*\n)*/;
        const yamlArrayMatch = frontmatterContent.match(yamlArrayTagsRegex);
        
        if (yamlArrayMatch) {
          // 添加新的优先级标签
          frontmatterContent = frontmatterContent.replace(
            yamlArrayTagsRegex,
            (match) => match + `  - priority-${priority}\n`
          );
        } else {
          // 处理行内数组格式 [tag1, tag2]
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
            // 单个标签的情况
            frontmatterContent = frontmatterContent.replace(
              /tags:\s*(.*?)(\n|$)/,
              (match, tag) => {
                if (!tag || tag.trim() === "") {
                  return `tags: priority-${priority}\n`;
                } else {
                  // 处理空格分隔的标签
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
        // 没有 tags 字段，添加一个
        frontmatterContent += `\ntags:\n  - review\n  - priority-${priority}`;
      }

      // 更新 frontmatter
      newContent = content.replace(frontmatterRegex, `---\n${frontmatterContent}\n---`);
    } else {
      // 没有 frontmatter，添加一个
      newContent = `---\ntags:\n  - review\n  - priority-${priority}\n---\n\n${content}`;
    }
    
    // 保存修改
    await this.app.vault.modify(note.file, newContent);
    
    // 更新优先级
    note.priority = priority;
    
    // 添加通知
    new Notice(`笔记 "${note.file.basename}" 已设置为${priority === 'high' ? '高' : priority === 'medium' ? '中' : '低'}优先级`);
  }
}

// 视图类
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
    // 重新扫描笔记
    await this.plugin.scanNotesForReview();
    this.render();

    // 添加文件变更监听
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.plugin.scanNotesForReview().then(() => this.render());
        }
      })
    );
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.plugin.scanNotesForReview().then(() => this.render());
        }
      })
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.plugin.scanNotesForReview().then(() => this.render());
        }
      })
    );
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.plugin.scanNotesForReview().then(() => this.render());
        }
      })
    );
  }

  // 截断过长的标题
  truncateTitle(title: string, maxLength: number = 40): string {
    if (title.length <= maxLength) return title;
    return title.substring(0, maxLength) + "...";
  }

  render() {
    console.log('开始渲染视图...');
    
    // 获取内容容器
    const contentEl = this.containerEl;
    contentEl.empty();

    // 创建主容器
    const mainContainer = contentEl.createDiv({
      cls: "review-scheduler-container",
    });

    // 添加标题
    const headerEl = mainContainer.createDiv({
      cls: "review-scheduler-header",
    });
    headerEl.createEl("h1", { text: "复习排程器" });

    // 创建内容区域
    const contentContainer = mainContainer.createDiv({
      cls: "review-scheduler-content",
    });

    console.log(`队列长度: ${this.plugin.reviewQueue.length}`);
    if (this.plugin.reviewQueue.length === 0) {
      contentContainer.createEl("p", { text: "当前没有需要复习的笔记。" });
      return;
    }

    // 显示今天需要复习的笔记
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    console.log(`今天日期: ${today.toISOString()}`);

    const dueTodayNotes = this.plugin.reviewQueue.filter((note) => {
      const noteDate = new Date(note.reviewDate);
      noteDate.setHours(0, 0, 0, 0);
      try {
        console.log(`笔记 ${note.file.basename} 的复习日期:`, note.reviewDate);
        console.log(`笔记 ${note.file.basename} 的复习日期ISO格式:`, note.reviewDate.toISOString());
      } catch (error) {
        console.error(`笔记 ${note.file.basename} 的复习日期格式错误:`, note.reviewDate);
        console.error('错误详情:', error);
      }
      return noteDate.getTime() <= today.getTime();
    });

    console.log(`今天需要复习的笔记数量: ${dueTodayNotes.length}`);

    // 当天的复习笔记
    const todaySection = contentContainer.createDiv({
      cls: "review-section",
    });
    todaySection.createEl("h2", { text: "今天需要复习" });
    
    if (dueTodayNotes.length > 0) {
      this.currentNote = dueTodayNotes[0]; // 设置当前笔记
      
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

        // 添加点击事件，使点击笔记直接打开
        item.addEventListener("click", () => {
          this.currentNote = note;
          this.app.workspace.getLeaf(true).openFile(note.file);
          this.render(); // 刷新视图以更新当前笔记高亮
        });
      }

      // 添加按钮容器
      const buttonContainer = todaySection.createDiv({
        cls: "review-buttons-container"
      });

      // 添加复习按钮
      const reviewNowButton = buttonContainer.createEl("button", {
        text: "开始复习",
        cls: "review-now-button"
      });
      reviewNowButton.addEventListener("click", () => {
        if (this.currentNote) {
          this.app.workspace.getLeaf(true).openFile(this.currentNote.file);
        }
      });

      // 添加刷新按钮
      const refreshButton = buttonContainer.createEl("button", {
        text: "刷新",
        cls: "refresh-button"
      });
      refreshButton.addEventListener("click", () => {
        this.plugin.scanNotesForReview().then(() => {
          this.render();
          new Notice("队列已刷新");
        });
      });
    } else {
      todaySection.createEl("p", { text: "今天没有需要复习的笔记。" });
      
      // 添加刷新按钮
      const refreshButton = todaySection.createEl("button", {
        text: "刷新",
        cls: "refresh-button"
      });
      refreshButton.addEventListener("click", () => {
        this.plugin.scanNotesForReview().then(() => {
          this.render();
          new Notice("队列已刷新");
        });
      });
    }

    // 显示即将到来的复习
    const upcomingSection = contentContainer.createDiv({
      cls: "review-section",
    });
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

        // 添加点击事件，使点击笔记直接打开
        item.addEventListener("click", () => {
          this.currentNote = note;
          this.app.workspace.getLeaf(true).openFile(note.file);
          this.render(); // 刷新视图以更新当前笔记高亮
        });
      }
    } else {
      upcomingSection.createEl("p", { text: "没有即将到来的复习。" });
    }
  }
}

// 设置选项卡
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
      .setName("随机因子")
      .setDesc("低优先级内容提前复习的概率，默认为0.2（20%概率）")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.randomFactor.toString())
          .onChange(async (value) => {
            const numValue = parseFloat(value);
            if (!isNaN(numValue) && numValue >= 0 && numValue <= 1) {
              this.plugin.settings.randomFactor = numValue;
              await this.plugin.saveSettings();
            }
          })
      );

    containerEl.createEl("h3", { text: "快捷键设置" });

    new Setting(containerEl)
      .setName("开始复习")
      .setDesc("打开当前需要复习的笔记")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.hotkeys.startReview)
          .onChange(async (value) => {
            this.plugin.settings.hotkeys.startReview = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("删除笔记")
      .setDesc("从复习队列中删除当前笔记")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.hotkeys.deleteNote)
          .onChange(async (value) => {
            this.plugin.settings.hotkeys.deleteNote = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("设置高优先级")
      .setDesc("将当前笔记设置为高优先级")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.hotkeys.setPriorityHigh)
          .onChange(async (value) => {
            this.plugin.settings.hotkeys.setPriorityHigh = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("设置中优先级")
      .setDesc("将当前笔记设置为中优先级")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.hotkeys.setPriorityMedium)
          .onChange(async (value) => {
            this.plugin.settings.hotkeys.setPriorityMedium = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("设置低优先级")
      .setDesc("将当前笔记设置为低优先级")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.hotkeys.setPriorityLow)
          .onChange(async (value) => {
            this.plugin.settings.hotkeys.setPriorityLow = value;
            await this.plugin.saveSettings();
          })
      );
  }
}

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
      
      // 更新笔记的复习日期
      this.note.reviewDate = newDate;
      await this.plugin.updateNoteMetadata(this.note.file, newDate, this.note.repHistory);
      
      // 刷新视图
      const view = this.app.workspace.getLeavesOfType("review-scheduler-view")[0]?.view as ReviewSchedulerView;
      if (view) {
        view.render();
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