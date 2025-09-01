// 同步引擎核心逻辑
class NovelSyncEngine {
    constructor() {
        this.isRunning = false;
        this.syncQueue = [];
        this.config = window.NovelSyncConfig;
    }

    // 启动同步检查
    async startSync(novelId) {
        if (this.isRunning) {
            throw new Error('同步已在进行中');
        }

        this.isRunning = true;
        
        try {
            const result = await this.performSync(novelId);
            return result;
        } finally {
            this.isRunning = false;
        }
    }

    // 执行同步
    async performSync(novelId) {
        const config = this.config.getNovelConfig(novelId);
        
        if (!config.novelUpdatesUrl) {
            throw new Error('未配置NovelUpdates URL');
        }

        // 步骤1：获取foxaholic章节数据
        const foxaholicChapters = DataExtractor.extractChapterList();
        if (foxaholicChapters.length === 0) {
            throw new Error('未找到章节数据');
        }

        // 步骤2：获取NovelUpdates已发布章节
        const publishedChapters = await DataExtractor.extractPublishedChapters(config.novelUpdatesUrl);

        // 步骤3：计算需要发布的章节
        const unpublishedChapters = this.calculateUnpublishedChapters(
            foxaholicChapters, 
            publishedChapters
        );

        // 步骤4：生成同步报告
        const syncReport = {
            timestamp: new Date(),
            novelId: novelId,
            totalChapters: foxaholicChapters.length,
            publishedCount: publishedChapters.length,
            unlockedCount: foxaholicChapters.filter(c => !c.isLocked).length,
            pendingSync: unpublishedChapters.length,
            chapters: unpublishedChapters.map(c => ({
                number: c.number,
                title: c.title,
                releaseDate: c.releaseDate,
                url: c.url
            }))
        };

        // 步骤5：更新配置
        this.config.setNovelConfig(novelId, {
            ...config,
            lastSync: new Date().toISOString(),
            lastKnownChapter: Math.max(
                ...foxaholicChapters.filter(c => !c.isLocked).map(c => parseFloat(c.number))
            ).toString()
        });

        return syncReport;
    }

    // 计算未发布章节
    calculateUnpublishedChapters(foxaholicChapters, publishedChapters) {
        // 过滤出已解锁且未发布的章节
        return foxaholicChapters.filter(foxChapter => {
            // 检查是否已解锁
            if (foxChapter.isLocked) {
                return false;
            }

            // 检查是否已在NovelUpdates发布
            const isPublished = publishedChapters.some(pubChapter => {
                // 比较章节号（考虑小数点章节如1.5）
                return parseFloat(pubChapter.chapter) === parseFloat(foxChapter.number);
            });

            return !isPublished;
        });
    }

    // 批量同步多个小说
    async batchSync(novelIds) {
        const results = [];
        
        for (const novelId of novelIds) {
            try {
                const result = await this.performSync(novelId);
                results.push({
                    novelId,
                    success: true,
                    data: result
                });
            } catch (error) {
                results.push({
                    novelId,
                    success: false,
                    error: error.message
                });
            }
            
            // 添加延迟避免频繁请求
            await Utils.delay(2000);
        }
        
        return results;
    }

    // 自动发布章节到NovelUpdates
    async autoPublishChapters(syncReport) {
        if (syncReport.pendingSync === 0) {
            return { message: '没有需要发布的章节', published: [] };
        }

        const publishResults = [];
        const config = this.config.getNovelConfig(syncReport.novelId);

        for (const chapter of syncReport.chapters) {
            try {
                // 打开新标签页到发布页面
                const publishWindow = window.open(
                    'https://www.novelupdates.com/beta-release-submit/',
                    '_blank'
                );

                if (!publishWindow) {
                    throw new Error('无法打开发布页面，请检查浏览器弹窗设置');
                }

                // 等待页面加载
                await this.waitForPageLoad(publishWindow);

                // 填充发布表单
                await this.fillPublishForm(publishWindow, chapter, config);

                publishResults.push({
                    chapter: chapter.number,
                    success: true,
                    window: publishWindow
                });

                // 延迟避免频繁操作
                await Utils.delay(3000);

            } catch (error) {
                publishResults.push({
                    chapter: chapter.number,
                    success: false,
                    error: error.message
                });
            }
        }

        return {
            message: `处理了 ${publishResults.length} 个章节`,
            published: publishResults
        };
    }

    // 等待页面加载完成
    async waitForPageLoad(targetWindow) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('页面加载超时'));
            }, 10000);

            const checkLoad = () => {
                try {
                    if (targetWindow.document && targetWindow.document.readyState === 'complete') {
                        clearTimeout(timeout);
                        resolve();
                    } else {
                        setTimeout(checkLoad, 500);
                    }
                } catch (e) {
                    // 跨域访问限制，假设已加载
                    clearTimeout(timeout);
                    resolve();
                }
            };

            checkLoad();
        });
    }

    // 填充发布表单
    async fillPublishForm(targetWindow, chapter, config) {
        return new Promise((resolve, reject) => {
            // 由于跨域限制，我们通过消息传递来填充表单
            const fillScript = `
                (function() {
                    try {
                        // 等待表单元素加载
                        const waitForElement = (selector, timeout = 5000) => {
                            return new Promise((resolve, reject) => {
                                const element = document.querySelector(selector);
                                if (element) return resolve(element);
                                
                                const observer = new MutationObserver(() => {
                                    const element = document.querySelector(selector);
                                    if (element) {
                                        observer.disconnect();
                                        resolve(element);
                                    }
                                });
                                
                                observer.observe(document.body, {
                                    childList: true,
                                    subtree: true
                                });
                                
                                setTimeout(() => {
                                    observer.disconnect();
                                    reject(new Error('Element not found'));
                                }, timeout);
                            });
                        };

                        // 填充表单字段
                        const fillForm = async () => {
                            // 系列标题
                            const seriesInput = await waitForElement('#series_id');
                            seriesInput.value = '${config.seriesTitle || ''}';
                            seriesInput.dispatchEvent(new Event('input', { bubbles: true }));
                            
                            // 等待自动补全
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            const suggestion = document.querySelector('.autocomplete-suggestion');
                            if (suggestion) suggestion.click();
                            
                            // 章节信息
                            const chapterField = document.getElementById('chapter');
                            if (chapterField) {
                                chapterField.value = '${chapter.number}';
                                chapterField.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                            
                            const titleField = document.getElementById('title');
                            if (titleField) {
                                const cleanTitle = '${chapter.title}'.replace(/^Chapter\\s*\\d+\\s*:?\\s*/i, '');
                                titleField.value = cleanTitle;
                                titleField.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                            
                            const dateField = document.getElementById('date');
                            if (dateField) {
                                const releaseDate = new Date('${chapter.releaseDate}');
                                dateField.value = releaseDate.toISOString().split('T')[0];
                                dateField.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                            
                            const linkField = document.getElementById('link');
                            if (linkField) {
                                linkField.value = '${chapter.url}';
                                linkField.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                            
                            // 翻译组选择
                            const groupSelect = document.getElementById('mygroup');
                            if (groupSelect && '${config.translationGroup}') {
                                groupSelect.value = '${config.translationGroup}';
                                groupSelect.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                            
                            return true;
                        };
                        
                        fillForm().then(() => {
                            window.postMessage({ type: 'FORM_FILLED', success: true }, '*');
                        }).catch(error => {
                            window.postMessage({ type: 'FORM_FILLED', success: false, error: error.message }, '*');
                        });
                        
                    } catch (error) {
                        window.postMessage({ type: 'FORM_FILLED', success: false, error: error.message }, '*');
                    }
                })();
            `;

            // 监听填充结果
            const messageHandler = (event) => {
                if (event.data.type === 'FORM_FILLED') {
                    window.removeEventListener('message', messageHandler);
                    if (event.data.success) {
                        resolve();
                    } else {
                        reject(new Error(event.data.error));
                    }
                }
            };

            window.addEventListener('message', messageHandler);

            // 执行填充脚本
            try {
                targetWindow.eval(fillScript);
            } catch (e) {
                // 如果不能直接执行，尝试通过控制台
                setTimeout(() => {
                    reject(new Error('无法填充表单，请手动操作'));
                }, 5000);
            }
        });
    }
}

// 全局同步引擎实例
window.NovelSyncEngine = new NovelSyncEngine();