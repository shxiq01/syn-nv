// ==UserScript==
// @name         Novel Sync Helper - Foxaholic to NovelUpdates
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  自动同步foxaholic小说章节到NovelUpdates
// @author       您的名字
// @match        https://18.foxaholic.com/wp-admin/*
// @match        https://www.novelupdates.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      18.foxaholic.com
// @connect      novelupdates.com
// @connect      www.novelupdates.com
// ==/UserScript==

(function() {
    'use strict';

    // 配置常量
    const CONFIG = {
        FOXAHOLIC_BASE: 'https://18.foxaholic.com',
        NOVELUPDATES_BASE: 'https://www.novelupdates.com',
        STORAGE_PREFIX: 'novel_sync_',
        AUTO_SYNC_INTERVAL: 30000 // 30秒检查间隔
    };

    // 工具函数
    const Utils = {
        // 存储管理
        setStorage: (key, value) => GM_setValue(CONFIG.STORAGE_PREFIX + key, JSON.stringify(value)),
        getStorage: (key, defaultValue = null) => {
            const stored = GM_getValue(CONFIG.STORAGE_PREFIX + key);
            return stored ? JSON.parse(stored) : defaultValue;
        },
        deleteStorage: (key) => GM_deleteValue(CONFIG.STORAGE_PREFIX + key),

        // DOM操作辅助
        waitForElement: (selector, timeout = 5000) => {
            return new Promise((resolve, reject) => {
                const element = document.querySelector(selector);
                if (element) return resolve(element);

                const observer = new MutationObserver((mutations, obs) => {
                    const element = document.querySelector(selector);
                    if (element) {
                        obs.disconnect();
                        resolve(element);
                    }
                });

                observer.observe(document.body, {
                    childList: true,
                    subtree: true
                });

                setTimeout(() => {
                    observer.disconnect();
                    reject(new Error(`Element ${selector} not found within ${timeout}ms`));
                }, timeout);
            });
        },

        // 延迟函数
        delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

        // 日期格式化
        formatDate: (date) => {
            return date.toISOString().split('T')[0];
        },

        // 通知
        notify: (message, type = 'info') => {
            GM_notification({
                text: message,
                title: 'Novel Sync Helper',
                timeout: 3000
            });
        },

        // UTF-8 安全的Base64编码
        encodeBase64: (str) => {
            try {
                // 先将字符串转为UTF-8字节，再进行base64编码
                return btoa(unescape(encodeURIComponent(str)));
            } catch (e) {
                console.error('Base64编码失败:', e);
                return null;
            }
        },

        // UTF-8 安全的Base64解码
        decodeBase64: (str) => {
            try {
                // base64解码后，再从UTF-8字节转为字符串
                return decodeURIComponent(escape(atob(str)));
            } catch (e) {
                console.error('Base64解码失败:', e);
                return null;
            }
        }
    };

    // 数据提取模块
    const DataExtractor = {
        // 从foxaholic提取小说列表
        extractNovelList: () => {
            console.log('开始扫描小说列表...');
            console.log('当前页面URL:', window.location.href);
            
            if (!window.location.href.includes('wp-admin/edit.php?post_type=wp-manga')) {
                console.log('不在小说列表页面');
                return [];
            }

            const novels = [];
            
            // 根据实际HTML结构，直接使用正确的选择器
            let rows = document.querySelectorAll('tbody#the-list tr[id^="post-"]');
            console.log('找到的小说行数:', rows.length);
            
            if (rows.length === 0) {
                // 打印页面结构调试信息
                console.log('页面中的表格元素:');
                document.querySelectorAll('table').forEach((table, index) => {
                    console.log(`表格 ${index}:`, table.className, table.id);
                });
                
                console.log('页面中的tbody元素:');
                document.querySelectorAll('tbody').forEach((tbody, index) => {
                    console.log(`tbody ${index}:`, tbody.className, tbody.id);
                });
            }
            
            rows.forEach((row, index) => {
                // 根据实际HTML结构提取数据
                const titleLink = row.querySelector('td.title .row-title');
                const statusText = row.querySelector('td.taxonomy-wp-manga-release a')?.textContent.trim() || 'published';
                
                if (titleLink) {
                    const novel = {
                        id: row.id.replace('post-', ''),
                        title: titleLink.textContent.trim(),
                        editUrl: titleLink.href,
                        status: statusText,
                        lastModified: new Date()
                    };
                    
                    novels.push(novel);
                    console.log(`[${index + 1}] 添加小说: ${novel.title} (状态: ${novel.status})`);
                }
            });

            console.log('总共扫描到小说数量:', novels.length);
            return novels;
        },

        // 从小说编辑页面提取章节信息
        extractChapterList: () => {
            console.log('开始提取章节信息...');
            const chapters = [];
            
            // 根据实际HTML结构，查找章节列表项
            const chapterItems = document.querySelectorAll('#volumes-list li li');
            console.log('找到章节项数量:', chapterItems.length);
            
            chapterItems.forEach((item, index) => {
                const chapterLink = item.querySelector('.wp-manga-edit-chapter');
                const unlockSpan = item.querySelector('.unlock_free');
                
                if (chapterLink) {
                    const fullText = chapterLink.textContent.trim();
                    console.log(`处理章节 ${index + 1}:`, fullText);
                    
                    // 提取章节号 - 匹配 [ID] Chapter X 格式
                    const chapterMatch = fullText.match(/\[\d+\]\s*Chapter\s*(\d+(?:\.\d+)?)/i);
                    const chapterNumber = chapterMatch ? chapterMatch[1] : (index + 1).toString();
                    
                    // 提取章节标题（去掉ID和锁定图标）
                    let chapterTitle = fullText.replace(/\[\d+\]\s*/, '').replace(/\s*<i[^>]*><\/i>/, '');
                    
                    // 检查是否锁定
                    const hasLockIcon = chapterLink.querySelector('i.fa-lock') !== null;
                    let isLocked = hasLockIcon;
                    let unlockDate = new Date();
                    
                    if (unlockSpan && hasLockIcon) {
                        // 解析解锁时间
                        const unlockText = unlockSpan.textContent.trim();
                        const dateMatch = unlockText.match(/Unlock on (.+)/);
                        if (dateMatch) {
                            unlockDate = new Date(dateMatch[1]);
                            // 如果解锁时间在未来，则仍然锁定
                            isLocked = unlockDate > new Date();
                        }
                    } else if (!hasLockIcon) {
                        // 没有锁定图标，说明已解锁
                        isLocked = false;
                    }
                    
                    // 生成前端章节访问URL
                    // 从页面的permalink样本获取小说基础URL
                    let novelBaseUrl = '';
                    const permalinkElement = document.querySelector('#sample-permalink a');
                    
                    if (permalinkElement) {
                        novelBaseUrl = permalinkElement.href;
                        console.log('从permalink获取小说基础URL:', novelBaseUrl);
                    } else {
                        // 备用方案：从editable-post-name获取slug
                        const slugElement = document.querySelector('#editable-post-name');
                        if (slugElement) {
                            const novelSlug = slugElement.textContent.trim();
                            novelBaseUrl = `https://18.foxaholic.com/novel/${novelSlug}/`;
                            console.log('从slug生成小说基础URL:', novelBaseUrl);
                        } else {
                            // 最后备用方案：使用默认格式
                            console.warn('无法获取小说URL，使用默认格式');
                            novelBaseUrl = `https://18.foxaholic.com/novel/unknown/`;
                        }
                    }
                    
                    // 生成完整的章节URL
                    // 确保novelBaseUrl以斜杠结尾
                    if (novelBaseUrl && !novelBaseUrl.endsWith('/')) {
                        novelBaseUrl += '/';
                    }
                    
                    const chapterUrl = `${novelBaseUrl}chapter-${chapterNumber}/`;
                    console.log(`生成章节URL: ${chapterUrl}`);

                    const chapterData = {
                        number: chapterNumber,
                        title: chapterTitle,
                        url: chapterUrl,
                        unlockDate: unlockDate,
                        isLocked: isLocked,
                        status: isLocked ? 'locked' : 'unlocked',
                        element: item,
                        chapterId: chapterLink.dataset.chapter
                    };
                    
                    chapters.push(chapterData);
                    console.log(`章节 ${chapterNumber}: ${chapterTitle} (${isLocked ? '锁定' : '解锁'})`);
                }
            });
            
            // 按章节号排序
            chapters.sort((a, b) => parseFloat(a.number) - parseFloat(b.number));
            
            console.log('章节提取完成，总计:', chapters.length);
            console.log('解锁章节数:', chapters.filter(c => !c.isLocked).length);
            console.log('锁定章节数:', chapters.filter(c => c.isLocked).length);
            
            return chapters;
        },

        // 从NovelUpdates提取已发布章节
        extractPublishedChapters: async (seriesUrl) => {
            console.log('开始获取NovelUpdates已发布章节:', seriesUrl);
            
            try {
                // 由于需要执行JavaScript来触发弹窗，我们需要在实际页面中操作
                // 先尝试直接解析静态HTML，如果找不到完整列表，再通过页面操作获取
                return new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: seriesUrl,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (compatible; Novel Sync Helper)',
                        },
                        onload: function(response) {
                            try {
                                const parser = new DOMParser();
                                const doc = parser.parseFromString(response.responseText, 'text/html');
                                
                                const published = [];
                                
                                // 检查是否有触发弹窗的按钮
                                const popupButton = doc.querySelector('.my_popupreading_open[onclick*="list_allchpstwo"]');
                                if (popupButton) {
                                    console.log('发现弹窗触发按钮，需要通过页面操作获取完整章节列表');
                                    // 返回一个特殊标记，告知调用者需要通过页面操作获取
                                    resolve({ needPageOperation: true, seriesUrl: seriesUrl });
                                    return;
                                }
                                
                                // 查找并尝试多种获取完整章节列表的方式
                                
                                // 首先尝试查找"显示全部"类型的按钮或链接
                                const showAllButtons = [
                                    'a[onclick*="showall"]',
                                    'button[onclick*="showall"]', 
                                    'a[href*="showall"]',
                                    'a[onclick*="show_all"]',
                                    '.show-all-releases',
                                    '#show_all_releases',
                                    'a:contains("Show All")',
                                    'a:contains("View All")',
                                    'a:contains("More")'
                                ];
                                
                                let foundShowAllButton = false;
                                for (const selector of showAllButtons) {
                                    const button = doc.querySelector(selector);
                                    if (button) {
                                        console.log(`找到"显示全部"按钮: ${selector}`);
                                        foundShowAllButton = true;
                                        break;
                                    }
                                }
                                
                                // 方法1：查找已存在的完整章节列表弹出窗口
                                let chapterPopup = doc.querySelector('#my_popupreading ol.sp_chp');
                                
                                // 方法2：查找隐藏的完整章节列表容器
                                if (!chapterPopup) {
                                    chapterPopup = doc.querySelector('ol.sp_chp');
                                }
                                
                                // 方法3：查找章节列表容器的其他可能位置
                                if (!chapterPopup) {
                                    const possibleContainers = [
                                        '.sp_chp',
                                        '.chapter_list_show', 
                                        '#chapter_list_show',
                                        '.releases_list',
                                        '#releases_list',
                                        '.all-chapters'
                                    ];
                                    
                                    for (const selector of possibleContainers) {
                                        const container = doc.querySelector(selector);
                                        if (container && container.children.length > 15) { // 如果有超过15个子元素，可能是完整列表
                                            chapterPopup = container;
                                            console.log(`在 ${selector} 中找到可能的完整章节列表`);
                                            break;
                                        }
                                    }
                                }
                                
                                if (chapterPopup) {
                                    console.log('找到完整章节列表，提取所有章节');
                                    
                                    // 查找章节项的多种选择器
                                    let chapterItems = chapterPopup.querySelectorAll('li.sp_li_chp');
                                    if (chapterItems.length === 0) {
                                        chapterItems = chapterPopup.querySelectorAll('li');
                                    }
                                    if (chapterItems.length === 0) {
                                        chapterItems = chapterPopup.querySelectorAll('.chapter-item');
                                    }
                                    if (chapterItems.length === 0) {
                                        chapterItems = chapterPopup.querySelectorAll('a');
                                    }
                                    
                                    console.log(`完整列表中找到 ${chapterItems.length} 个章节`);
                                    
                                    chapterItems.forEach((item, index) => {
                                        let chapterText = '';
                                        let chapterUrl = '';
                                        
                                        // 查找章节span：<span title="c18">c18</span>
                                        const chapterSpan = item.querySelector('span[title]');
                                        if (chapterSpan) {
                                            chapterText = chapterSpan.textContent.trim();
                                            const chapterLink = item.querySelector('a[href*="extnu"]');
                                            chapterUrl = chapterLink ? chapterLink.href : '';
                                        } else if (item.tagName === 'A' && item.textContent.trim()) {
                                            // 如果直接是链接元素
                                            chapterText = item.textContent.trim();
                                            chapterUrl = item.href || '';
                                        }
                                        
                                        if (chapterText) {
                                            console.log(`处理完整列表章节 ${index + 1}: "${chapterText}"`);
                                            
                                            // 提取章节号
                                            const chapterMatch = chapterText.match(/c(\d+(?:\.\d+)?)/i);
                                            if (chapterMatch) {
                                                const chapterNumber = chapterMatch[1];
                                                
                                                published.push({
                                                    chapter: chapterNumber,
                                                    title: chapterText,
                                                    url: chapterUrl,
                                                    date: new Date(),
                                                    element: item
                                                });
                                                
                                                console.log(`✓ 发现已发布章节 ${chapterNumber}: ${chapterText}`);
                                            } else {
                                                console.log(`✗ 无法从 "${chapterText}" 中提取章节号`);
                                            }
                                        }
                                    });
                                } else {
                                    console.log('未找到完整章节列表，调试页面结构');
                                    
                                    // 调试：输出页面中可能包含章节信息的元素
                                    const allContainers = doc.querySelectorAll('ol, ul, .sp_chp, [class*="chapter"], [class*="release"], [id*="chapter"], [id*="release"]');
                                    console.log('页面中找到的可能容器:', allContainers.length);
                                    allContainers.forEach((container, i) => {
                                        if (i < 10) { // 只显示前10个
                                            console.log(`容器 ${i + 1}: ${container.tagName}.${container.className}#${container.id} (子元素数: ${container.children.length})`);
                                        }
                                    });
                                    
                                    console.log('使用分页表格数据');
                                    
                                    // 备用方案：查找发布章节列表 - 基于NovelUpdates常见结构的选择器
                                    const possibleSelectors = [
                                        '.chp-release',                    // 标准章节发布元素
                                        '.release-item',                   // 发布项目
                                        'table.tablesorter tbody tr',     // 表格中的章节行
                                        '.chapter-list .chapter-item',    // 章节列表项  
                                        '[id*="myTable"] tbody tr',       // 带ID的表格行
                                        '.wpb_wrapper tbody tr',          // WordPress表格行
                                        'tr',                             // 通用表格行（最后备用）
                                    ];
                                    
                                    let releaseElements = [];
                                    for (const selector of possibleSelectors) {
                                        releaseElements = doc.querySelectorAll(selector);
                                        if (releaseElements.length > 0) {
                                            console.log(`使用选择器 ${selector} 找到 ${releaseElements.length} 个发布记录`);
                                            break;
                                        }
                                    }
                                
                                    releaseElements.forEach((element, index) => {
                                    let linkText = '';
                                    let linkHref = '';
                                    
                                    // 根据选择器类型处理不同的元素结构
                                    if (element.classList && element.classList.contains('chp-release')) {
                                        // 直接是.chp-release链接
                                        linkText = element.textContent.trim();
                                        linkHref = element.href || '';
                                        console.log(`检查NovelUpdates发布记录(直接链接): "${linkText}"`);
                                    } else {
                                        // 表格行，查找其中的链接
                                        // 跳过表头行
                                        if (element.querySelector('th')) {
                                            return;
                                        }
                                        
                                        // 寻找章节链接 - 多种可能的位置
                                        const possibleLinks = [
                                            element.querySelector('.chp-release'),        // NovelUpdates标准章节链接
                                            element.querySelector('td:last-child a'),     // 最后一列的链接
                                            element.querySelector('td a'),                // 任意列中的链接
                                            element.querySelector('[href*="chapter"]'),   // 包含chapter的链接
                                            element.querySelector('a'),                   // 任何链接
                                        ].filter(Boolean);
                                        
                                        const link = possibleLinks[0];
                                        if (!link || !link.textContent.trim()) return;
                                        
                                        linkText = link.textContent.trim();
                                        linkHref = link.href || '';
                                        console.log(`检查NovelUpdates发布记录(表格行): "${linkText}"`);
                                    }
                                    
                                    if (!linkText) return;
                                    
                                    // 更精确的章节号匹配模式
                                    const chapterPatterns = [
                                        /\bc(\d+(?:\.\d+)?)\b/i,                    // c1, c1.5 (单词边界)
                                        /\bchapter\s*(\d+(?:\.\d+)?)\b/i,           // Chapter 1
                                        /\bch\s*(\d+(?:\.\d+)?)\b/i,               // Ch 1  
                                        /\bv\d+c(\d+(?:\.\d+)?)\b/i,               // v1c1 (卷章格式)
                                        /第(\d+(?:\.\d+)?)章/i,                      // 第1章
                                        /^(\d+(?:\.\d+)?)\s*[-:]?\s*/,             // 以数字开头
                                    ];
                                    
                                    let chapterNumber = null;
                                    for (const pattern of chapterPatterns) {
                                        const match = linkText.match(pattern);
                                        if (match) {
                                            chapterNumber = match[1];
                                            console.log(`匹配到章节号: ${chapterNumber} (使用模式: ${pattern})`);
                                            break;
                                        }
                                    }
                                    
                                    if (chapterNumber) {
                                        // 查找发布日期 - 通常在表格的第一列
                                        let publishDate = new Date();
                                        
                                        // 如果是表格行，查找日期列
                                        if (!element.classList || !element.classList.contains('chp-release')) {
                                            const dateElement = element.querySelector('td:first-child');
                                            if (dateElement) {
                                                const dateText = dateElement.textContent.trim();
                                                const parsedDate = new Date(dateText);
                                                if (!isNaN(parsedDate.getTime())) {
                                                    publishDate = parsedDate;
                                                }
                                            }
                                        }
                                        
                                        published.push({
                                            chapter: chapterNumber,
                                            title: linkText,
                                            url: linkHref,
                                            date: publishDate,
                                            element: element
                                        });
                                        
                                        console.log(`✓ 发现已发布章节 ${chapterNumber}: ${linkText}`);
                                        } else {
                                            console.log(`✗ 无法从 "${linkText}" 中提取章节号`);
                                        }
                                    });
                                }
                                
                                console.log(`NovelUpdates已发布章节总数: ${published.length}`);
                                resolve(published);
                                
                            } catch (parseError) {
                                console.error('解析NovelUpdates页面失败:', parseError);
                                resolve([]); // 返回空数组，避免阻塞流程
                            }
                        },
                        onerror: function(error) {
                            console.error('获取NovelUpdates页面失败:', error);
                            resolve([]); // 返回空数组，避免阻塞流程
                        },
                        ontimeout: function() {
                            console.error('获取NovelUpdates页面超时');
                            resolve([]); // 返回空数组，避免阻塞流程
                        },
                        timeout: 10000 // 10秒超时
                    });
                });
                
            } catch (error) {
                console.error('提取NovelUpdates章节失败:', error);
                return [];
            }
        }
    };

    // 状态管理模块
    const StateManager = {
        // 获取小说配置
        getNovelConfig: (novelId) => {
            return Utils.getStorage(`novel_${novelId}`, {
                novelUpdatesUrl: '',
                seriesId: '',
                translationGroup: '',
                autoSync: false,
                lastSync: null
            });
        },

        // 保存小说配置
        saveNovelConfig: (novelId, config) => {
            Utils.setStorage(`novel_${novelId}`, config);
        },

        // 计算需要发布的章节
        getUnpublishedChapters: (foxaholicChapters, publishedChapters) => {
            return foxaholicChapters.filter(chapter => {
                const isUnlocked = !chapter.isLocked;
                const notPublished = !publishedChapters.some(pub => 
                    pub.chapter === chapter.number
                );
                return isUnlocked && notPublished;
            });
        },

        // 检查同步状态
        checkSyncStatus: async (novelId) => {
            const config = StateManager.getNovelConfig(novelId);
            if (!config.novelUpdatesUrl) return null;

            try {
                const publishedChapters = await DataExtractor.extractPublishedChapters(config.novelUpdatesUrl);
                return {
                    lastChecked: new Date(),
                    publishedCount: publishedChapters.length,
                    lastChapter: publishedChapters[0]?.chapter || '0'
                };
            } catch (error) {
                console.error('检查同步状态失败:', error);
                return null;
            }
        }
    };

    // 自动发布模块
    const AutoPublisher = {
        // 填充NovelUpdates发布表单
        fillReleaseForm: async (chapterData, config) => {
            try {
                // 等待表单加载
                await Utils.waitForElement('#series_id');
                
                // 填充系列信息
                const seriesInput = document.getElementById('series_id');
                if (seriesInput) {
                    seriesInput.value = config.seriesTitle || '';
                    seriesInput.dispatchEvent(new Event('input', { bubbles: true }));
                }

                // 等待自动补全并选择
                await Utils.delay(1000);
                const suggestion = document.querySelector('.autocomplete-suggestion');
                if (suggestion) {
                    suggestion.click();
                    await Utils.delay(500);
                }

                // 填充章节信息
                const fields = {
                    'chapter': chapterData.number,
                    'title': chapterData.title.replace(/^Chapter\s*\d+\s*:?\s*/i, ''),
                    'date': Utils.formatDate(chapterData.releaseDate),
                    'link': chapterData.url
                };

                Object.entries(fields).forEach(([id, value]) => {
                    const element = document.getElementById(id);
                    if (element && value) {
                        element.value = value;
                        element.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });

                // 选择翻译组
                const groupSelect = document.getElementById('mygroup');
                if (groupSelect && config.translationGroup) {
                    groupSelect.value = config.translationGroup;
                }

                return true;
            } catch (error) {
                console.error('填充表单失败:', error);
                return false;
            }
        },

        // 提交发布
        submitRelease: async () => {
            try {
                const submitButton = document.querySelector('input[type="submit"], button[type="submit"]');
                if (submitButton) {
                    submitButton.click();
                    return true;
                }
                return false;
            } catch (error) {
                console.error('提交发布失败:', error);
                return false;
            }
        },

        // 批量发布章节
        batchPublish: async (chapters, config) => {
            const results = [];
            
            for (const chapter of chapters) {
                try {
                    // 导航到发布页面
                    window.open('https://www.novelupdates.com/beta-release-submit/', '_blank');
                    
                    // 等待页面加载并填充表单
                    await Utils.delay(2000);
                    
                    const success = await AutoPublisher.fillReleaseForm(chapter, config);
                    results.push({
                        chapter: chapter.number,
                        success: success,
                        error: success ? null : '填充表单失败'
                    });
                    
                    if (success) {
                        Utils.notify(`章节 ${chapter.number} 准备发布`);
                    }
                    
                    // 添加延迟避免频繁请求
                    await Utils.delay(3000);
                } catch (error) {
                    results.push({
                        chapter: chapter.number,
                        success: false,
                        error: error.message
                    });
                }
            }
            
            return results;
        }
    };

    // 用户界面模块
    const UIManager = {
        // 创建控制面板
        createControlPanel: () => {
            const panel = document.createElement('div');
            panel.id = 'novel-sync-panel';
            panel.innerHTML = `
                <div style="
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    width: 300px;
                    background: white;
                    border: 2px solid #0073aa;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    z-index: 9999;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                ">
                    <div style="
                        background: #0073aa;
                        color: white;
                        padding: 12px 16px;
                        border-radius: 6px 6px 0 0;
                        font-weight: 600;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    ">
                        <span>Novel Sync Helper</span>
                        <button id="sync-panel-close" style="
                            background: none;
                            border: none;
                            color: white;
                            font-size: 18px;
                            cursor: pointer;
                            padding: 0;
                            width: 24px;
                            height: 24px;
                        ">×</button>
                    </div>
                    <div id="sync-panel-content" style="padding: 16px;">
                        <div id="sync-status" style="margin-bottom: 12px; font-size: 14px;"></div>
                        <div id="sync-actions" style="display: flex; flex-direction: column; gap: 8px;"></div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(panel);
            
            // 绑定关闭事件
            document.getElementById('sync-panel-close').addEventListener('click', () => {
                panel.remove();
            });
            
            return panel;
        },

        // 更新状态显示
        updateStatus: (message, type = 'info') => {
            const statusElement = document.getElementById('sync-status');
            if (statusElement) {
                const colors = {
                    info: '#0073aa',
                    success: '#46b450',
                    error: '#dc3232',
                    warning: '#ffb900'
                };
                
                statusElement.innerHTML = `
                    <div style="
                        padding: 8px 12px;
                        background: ${colors[type]}15;
                        border-left: 3px solid ${colors[type]};
                        border-radius: 3px;
                        font-size: 13px;
                    ">${message}</div>
                `;
            }
        },

        // 添加动作按钮
        addActionButton: (text, onclick, type = 'primary') => {
            const actionsContainer = document.getElementById('sync-actions');
            if (actionsContainer) {
                const button = document.createElement('button');
                button.textContent = text;
                button.onclick = onclick;
                
                const styles = {
                    primary: 'background: #0073aa; color: white;',
                    secondary: 'background: #f3f5f6; color: #50575e; border: 1px solid #c3c4c7;'
                };
                
                button.style.cssText = `
                    ${styles[type]}
                    padding: 8px 12px;
                    border: none;
                    border-radius: 3px;
                    cursor: pointer;
                    font-size: 13px;
                    transition: opacity 0.2s;
                `;
                
                button.addEventListener('mouseover', () => button.style.opacity = '0.8');
                button.addEventListener('mouseout', () => button.style.opacity = '1');
                
                actionsContainer.appendChild(button);
            }
        }
    };

    // 主应用逻辑
    const NovelSyncApp = {
        init: () => {
            console.log('Novel Sync Helper 已启动');
            
            // 根据当前页面初始化相应功能
            if (window.location.hostname === '18.foxaholic.com') {
                NovelSyncApp.initFoxaholicFeatures();
            } else if (window.location.hostname === 'www.novelupdates.com') {
                NovelSyncApp.initNovelUpdatesFeatures();
            }
        },

        // 初始化foxaholic功能
        initFoxaholicFeatures: () => {
            if (window.location.href.includes('wp-admin/edit.php?post_type=wp-manga')) {
                // 小说列表页面
                setTimeout(() => {
                    UIManager.createControlPanel();
                    UIManager.updateStatus('检测到小说列表页面');
                    
                    UIManager.addActionButton('扫描小说', async () => {
                        const novels = DataExtractor.extractNovelList();
                        UIManager.updateStatus(`发现 ${novels.length} 部小说`, 'success');
                        Utils.setStorage('foxaholic_novels', novels);
                    });
                    
                    UIManager.addActionButton('批量同步所有小说', async () => {
                        NovelSyncApp.startBatchSync();
                    });
                    
                    UIManager.addActionButton('配置同步', () => {
                        NovelSyncApp.showConfigDialog();
                    }, 'secondary');
                }, 1000);
                
            } else if (window.location.href.includes('wp-admin/post.php')) {
                // 小说编辑页面
                setTimeout(() => {
                    UIManager.createControlPanel();
                    UIManager.updateStatus('检测到小说编辑页面');
                    
                    UIManager.addActionButton('分析章节', async () => {
                        const chapters = DataExtractor.extractChapterList();
                        UIManager.updateStatus(`发现 ${chapters.length} 个章节`, 'success');
                        
                        const unlockedCount = chapters.filter(c => !c.isLocked).length;
                        UIManager.updateStatus(`${unlockedCount} 个章节已解锁，${chapters.length - unlockedCount} 个章节锁定`, 'info');
                    });
                    
                    UIManager.addActionButton('同步到NovelUpdates', () => {
                        NovelSyncApp.startSync();
                    });
                }, 1000);
            }
        },

        // 初始化NovelUpdates功能
        initNovelUpdatesFeatures: () => {
            // 检查URL参数
            const urlParams = new URLSearchParams(window.location.search);
            const syncTrigger = urlParams.get('sync_trigger');
            const queueKey = urlParams.get('queue_key');
            
            if (syncTrigger) {
                console.log('检测到章节提取触发参数:', syncTrigger);
                NovelSyncApp.handleChapterExtractionTrigger(syncTrigger);
                return;
            }
            
            if (queueKey) {
                console.log('检测到发布队列参数:', queueKey);
                NovelSyncApp.handlePublishQueue(queueKey);
                return;
            }
            
            if (window.location.href.includes('add-release')) {
                // 普通发布页面
                UIManager.createControlPanel();
                UIManager.updateStatus('检测到发布页面');
                
                UIManager.addActionButton('自动填充表单', async () => {
                    await NovelSyncApp.autoFillForm();
                }, 'secondary');
            }
        },

        // 显示配置对话框
        showConfigDialog: () => {
            // 在小说列表页面，显示所有小说的配置选择
            if (window.location.href.includes('edit.php?post_type=wp-manga')) {
                NovelSyncApp.showNovelSelectionModal();
                return;
            }
            
            // 在小说编辑页面，直接配置当前小说
            const novelId = NovelSyncApp.getCurrentNovelId();
            if (!novelId) {
                Utils.notify('无法获取小说ID', 'error');
                return;
            }

            NovelSyncApp.createConfigModal(novelId);
        },

        // 开始同步
        startSync: async () => {
            const novelId = NovelSyncApp.getCurrentNovelId();
            if (!novelId) {
                Utils.notify('无法获取小说ID', 'error');
                return;
            }

            // 检查是否已配置NovelUpdates URL
            const config = window.NovelSyncConfig.getNovelConfig(novelId);
            if (!config.novelUpdatesUrl) {
                Utils.notify('请先配置NovelUpdates URL', 'warning');
                NovelSyncApp.showConfigDialog();
                return;
            }

            try {
                UIManager.updateStatus('正在同步中...', 'info');
                console.log('使用配置:', config);
                const syncEngine = window.NovelSyncEngine;
                const result = await syncEngine.startSync(novelId);
                
                UIManager.updateStatus(
                    `同步完成：发现 ${result.pendingSync} 个待发布章节`, 
                    result.pendingSync > 0 ? 'warning' : 'success'
                );

                if (result.pendingSync > 0) {
                    // 清除之前的发布按钮，避免重复
                    const existingButton = document.querySelector('#publish-chapters-btn');
                    if (existingButton) {
                        existingButton.remove();
                    }
                    
                    const publishButton = document.createElement('button');
                    publishButton.id = 'publish-chapters-btn';
                    publishButton.textContent = `发布 ${result.pendingSync} 个章节`;
                    publishButton.onclick = () => NovelSyncApp.publishChapters(result);
                    publishButton.style.cssText = `
                        background: #0073aa;
                        color: white;
                        padding: 8px 12px;
                        border: none;
                        border-radius: 3px;
                        cursor: pointer;
                        font-size: 13px;
                        transition: opacity 0.2s;
                        margin-top: 8px;
                    `;
                    
                    const actionsContainer = document.getElementById('sync-actions');
                    if (actionsContainer) {
                        actionsContainer.appendChild(publishButton);
                    }
                }
            } catch (error) {
                UIManager.updateStatus(`同步失败: ${error.message}`, 'error');
            }
        },

        // 自动填充表单
        autoFillForm: async () => {
            if (!window.location.href.includes('add-release')) {
                Utils.notify('当前页面不是发布页面', 'error');
                return;
            }

            // 从URL参数获取数据
            let pendingData = null;
            try {
                const urlParams = new URLSearchParams(window.location.search);
                const syncData = urlParams.get('sync_data');
                
                if (syncData) {
                    // 从URL参数解码数据
                    const decodedData = Utils.decodeBase64(decodeURIComponent(syncData));
                    if (decodedData) {
                        pendingData = JSON.parse(decodedData);
                        console.log('从URL参数获取数据:', pendingData);
                    } else {
                        console.error('URL数据解码失败');
                    }
                } else {
                    // 回退到存储数据（向后兼容）
                    pendingData = Utils.getStorage('pending_publish');
                    console.log('从存储获取数据:', pendingData);
                }
            } catch (e) {
                console.error('解析发布数据失败:', e);
            }

            if (!pendingData) {
                Utils.notify('没有找到待填充的数据，请确保从同步页面打开', 'warning');
                return;
            }

            console.log('开始填充NovelUpdates表单:', pendingData);

            try {
                console.log('开始智能填充NovelUpdates发布表单...');
                
                // 创建辅助函数：模拟用户输入并触发自动补全
                const fillAutocompleteField = async (inputId, value, description) => {
                    const input = document.getElementById(inputId);
                    if (!input || !value) return false;
                    
                    console.log(`正在填充${description}: ${value}`);
                    
                    // 清空并聚焦输入框
                    input.value = '';
                    input.focus();
                    
                    // 分段输入，减少请求次数
                    const segments = Math.min(5, value.length); // 最多5段
                    const segmentLength = Math.ceil(value.length / segments);
                    
                    for (let i = 0; i < segments; i++) {
                        const endIndex = Math.min((i + 1) * segmentLength, value.length);
                        input.value = value.substring(0, endIndex);
                        
                        // 触发输入事件
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('keyup', { bubbles: true }));
                        
                        // 适当延迟，避免服务器限流
                        if (i < segments - 1) {
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                    }
                    
                    // 等待自动补全下拉菜单出现
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // 查找并点击匹配的自动补全选项
                    const autocompleteSelectors = [
                        '.ui-autocomplete .ui-menu-item',  // jQuery UI 自动补全
                        '.autocomplete-suggestion',        // 简单自动补全
                        '.suggestion',                     // 通用建议项
                        '[data-value]',                    // 带数据值的项
                        '.dropdown-item',                  // Bootstrap 下拉项
                        'li[role="option"]',              // ARIA 选项
                        '.select2-results__option'        // Select2 选项
                    ];
                    
                    let suggestionFound = false;
                    for (const selector of autocompleteSelectors) {
                        const suggestions = document.querySelectorAll(selector);
                        console.log(`查找自动补全选项 (${selector}): 找到 ${suggestions.length} 个`);
                        
                        for (const suggestion of suggestions) {
                            const suggestionText = suggestion.textContent.trim();
                            // 查找完全匹配或包含目标值的选项
                            if (suggestionText === value || 
                                suggestionText.toLowerCase().includes(value.toLowerCase()) ||
                                value.toLowerCase().includes(suggestionText.toLowerCase())) {
                                
                                console.log(`✅ 找到匹配项并点击: "${suggestionText}"`);
                                suggestion.click();
                                suggestionFound = true;
                                break;
                            }
                        }
                        if (suggestionFound) break;
                    }
                    
                    if (!suggestionFound) {
                        console.log(`⚠️ 未找到"${value}"的自动补全选项，值已填充但可能需要手动选择`);
                    }
                    
                    return true;
                };

                // 智能选择填充函数
                const smartFillSelectField = async (inputId, value, description) => {
                    const input = document.getElementById(inputId);
                    if (!input || !value) return false;
                    
                    console.log(`🔍 智能填充${description}: "${value}"`);
                    
                    try {
                        // 步骤1: 清空输入框并聚焦
                        input.value = '';
                        input.focus();
                        
                        // 步骤2: 输入搜索文本，但要缓慢避免429
                        input.value = value;
                        
                        // 步骤3: 触发搜索事件
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('keyup', { bubbles: true }));
                        
                        console.log(`⏳ 等待${description}搜索结果...`);
                        await new Promise(resolve => setTimeout(resolve, 2000)); // 等待搜索结果
                        
                        // 步骤4: 查找匹配的选项
                        const possibleSelectors = [
                            '.ui-autocomplete .ui-menu-item',
                            '.autocomplete-suggestion', 
                            '.ui-menu-item',
                            '[role="option"]',
                            '.suggestion',
                            'li:contains("' + value + '")',
                            'div:contains("' + value + '")'
                        ];
                        
                        let optionFound = false;
                        
                        for (const selector of possibleSelectors) {
                            try {
                                let options;
                                if (selector.includes(':contains')) {
                                    // 使用文本匹配查找
                                    options = Array.from(document.querySelectorAll(selector.split(':contains')[0]))
                                        .filter(el => el.textContent.trim().toLowerCase().includes(value.toLowerCase()));
                                } else {
                                    options = document.querySelectorAll(selector);
                                }
                                
                                console.log(`📋 使用选择器 "${selector}" 找到 ${options.length} 个选项`);
                                
                                for (const option of options) {
                                    const optionText = option.textContent.trim();
                                    console.log(`🔎 检查选项: "${optionText}"`);
                                    
                                    // 精确匹配或包含匹配
                                    if (optionText === value || 
                                        optionText.toLowerCase() === value.toLowerCase() ||
                                        optionText.toLowerCase().includes(value.toLowerCase()) ||
                                        value.toLowerCase().includes(optionText.toLowerCase())) {
                                        
                                        console.log(`✅ 找到匹配项: "${optionText}" - 正在点击`);
                                        
                                        // 点击选项
                                        option.click();
                                        optionFound = true;
                                        
                                        // 验证是否选择成功
                                        await new Promise(resolve => setTimeout(resolve, 500));
                                        if (input.value && input.value.toLowerCase().includes(value.toLowerCase())) {
                                            console.log(`🎯 ${description}选择成功: "${input.value}"`);
                                            return true;
                                        }
                                        break;
                                    }
                                }
                                
                                if (optionFound) break;
                                
                            } catch (selectorError) {
                                console.log(`选择器 "${selector}" 执行失败:`, selectorError.message);
                            }
                        }
                        
                        if (!optionFound) {
                            console.log(`⚠️ 未找到"${value}"的匹配选项，请手动选择${description}`);
                            
                            // 显示可用选项供用户参考
                            const allOptions = document.querySelectorAll('.ui-autocomplete .ui-menu-item, .autocomplete-suggestion, [role="option"]');
                            if (allOptions.length > 0) {
                                console.log(`💡 可用的${description}选项:`);
                                Array.from(allOptions).slice(0, 10).forEach((opt, i) => {
                                    console.log(`  ${i + 1}. "${opt.textContent.trim()}"`);
                                });
                            }
                        }
                        
                        return optionFound;
                        
                    } catch (error) {
                        console.error(`填充${description}时出错:`, error);
                        return false;
                    }
                };

                // 1. 智能填充系列标题
                const seriesSuccess = await smartFillSelectField('title_change_100', pendingData.seriesTitle, '系列标题');

                // 2. 填充章节号（普通字段）
                const releaseInput = document.getElementById('arrelease');
                if (releaseInput && pendingData.chapterNumber) {
                    releaseInput.value = `c${pendingData.chapterNumber}`;
                    releaseInput.dispatchEvent(new Event('change', { bubbles: true }));
                    console.log('✅ 填充章节号:', `c${pendingData.chapterNumber}`);
                }

                // 3. 填充章节链接（普通字段）
                const linkInput = document.getElementById('arlink');
                if (linkInput && pendingData.chapterUrl) {
                    linkInput.value = pendingData.chapterUrl;
                    linkInput.dispatchEvent(new Event('change', { bubbles: true }));
                    console.log('✅ 填充章节链接:', pendingData.chapterUrl);
                }

                // 4. 智能填充翻译组
                const groupSuccess = await smartFillSelectField('group_change_100', pendingData.translationGroup, '翻译组');

                // 5. 填充发布日期
                if (pendingData.releaseDate) {
                    const releaseDate = new Date(pendingData.releaseDate);
                    const today = new Date();
                    if (releaseDate.toDateString() !== today.toDateString()) {
                        const dateInput = document.getElementById('ardate');
                        if (dateInput) {
                            dateInput.value = releaseDate.toISOString().split('T')[0];
                            dateInput.dispatchEvent(new Event('change', { bubbles: true }));
                            console.log('✅ 填充发布日期:', dateInput.value);
                        }
                    }
                }

                // 6. 最终状态检查和提醒
                const seriesValue = document.getElementById('title_change_100')?.value || '';
                const groupValue = document.getElementById('group_change_100')?.value || '';
                
                console.log('\n📋 表单填充完成状态:');
                console.log(`  🎯 系列: "${seriesValue}" (${seriesSuccess ? '自动选择成功' : '需要手动选择'})`);
                console.log(`  🎯 翻译组: "${groupValue}" (${groupSuccess ? '自动选择成功' : '需要手动选择'})`);
                console.log(`  ✓ 章节: "${document.getElementById('arrelease')?.value || ''}"`);
                console.log(`  ✓ 链接: "${document.getElementById('arlink')?.value || ''}"`);
                
                let message = '表单填充完成！\n\n';
                if (!seriesSuccess) {
                    message += '⚠️ 请手动选择Series字段\n';
                }
                if (!groupSuccess) {
                    message += '⚠️ 请手动选择Group字段\n';
                }
                message += '\n✅ 检查无误后即可提交';
                
                Utils.notify(message, seriesSuccess && groupSuccess ? 'success' : 'warning');

                // 添加调试帮助按钮
                if (!seriesSuccess || !groupSuccess) {
                    setTimeout(() => {
                        const debugBtn = document.createElement('button');
                        debugBtn.textContent = '🔍 显示可用选项';
                        debugBtn.style.cssText = `
                            position: fixed;
                            top: 100px;
                            right: 20px;
                            z-index: 10000;
                            padding: 8px 12px;
                            background: #ff9800;
                            color: white;
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 13px;
                        `;
                        
                        debugBtn.onclick = () => {
                            NovelSyncApp.showAvailableOptions();
                            debugBtn.remove();
                        };
                        
                        document.body.appendChild(debugBtn);
                        
                        // 5秒后自动移除
                        setTimeout(() => {
                            if (debugBtn.parentNode) debugBtn.remove();
                        }, 5000);
                    }, 1000);
                }

            } catch (error) {
                console.error('智能填充表单时出错:', error);
                Utils.notify(`智能填充失败: ${error.message}`, 'error');
            }
        },

        // 获取当前小说ID
        getCurrentNovelId: () => {
            const urlParams = new URLSearchParams(window.location.search);
            return urlParams.get('post') || null;
        },

        // 创建配置模态框
        createConfigModal: (novelId, novelTitle = '') => {
            const config = window.NovelSyncConfig.getNovelConfig(novelId);
            
            const modal = document.createElement('div');
            modal.innerHTML = `
                <div style="
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0,0,0,0.5);
                    z-index: 10000;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                ">
                    <div style="
                        background: white;
                        padding: 24px;
                        border-radius: 8px;
                        width: 500px;
                        max-height: 80vh;
                        overflow-y: auto;
                    ">
                        <h3 style="margin: 0 0 20px 0; color: #0073aa;">小说同步配置${novelTitle ? ` - ${novelTitle}` : ''}</h3>
                        
                        <div style="margin-bottom: 16px;">
                            <label style="display: block; margin-bottom: 4px; font-weight: 500;">
                                NovelUpdates 小说页面URL:
                            </label>
                            <input id="nu-url" type="url" value="${config.novelUpdatesUrl}" style="
                                width: 100%;
                                padding: 8px;
                                border: 1px solid #ddd;
                                border-radius: 4px;
                            " placeholder="https://www.novelupdates.com/series/novel-name/">
                        </div>
                        
                        <div style="margin-bottom: 16px;">
                            <label style="display: block; margin-bottom: 4px; font-weight: 500;">
                                系列标题:
                            </label>
                            <input id="series-title" type="text" value="${config.seriesTitle}" style="
                                width: 100%;
                                padding: 8px;
                                border: 1px solid #ddd;
                                border-radius: 4px;
                            " placeholder="小说英文标题">
                        </div>
                        
                        <div style="margin-bottom: 16px;">
                            <label style="display: block; margin-bottom: 4px; font-weight: 500;">
                                翻译组:
                            </label>
                            <input id="trans-group" type="text" value="${config.translationGroup}" style="
                                width: 100%;
                                padding: 8px;
                                border: 1px solid #ddd;
                                border-radius: 4px;
                            " placeholder="翻译组名称">
                        </div>
                        
                        <div style="margin-bottom: 20px;">
                            <label style="display: flex; align-items: center; gap: 8px;">
                                <input id="auto-sync" type="checkbox" ${config.autoSync ? 'checked' : ''}>
                                <span>启用自动同步</span>
                            </label>
                        </div>
                        
                        <div style="display: flex; gap: 12px; justify-content: flex-end;">
                            <button id="config-cancel" style="
                                padding: 8px 16px;
                                background: #f3f5f6;
                                border: 1px solid #c3c4c7;
                                border-radius: 4px;
                                cursor: pointer;
                            ">取消</button>
                            <button id="config-save" style="
                                padding: 8px 16px;
                                background: #0073aa;
                                color: white;
                                border: none;
                                border-radius: 4px;
                                cursor: pointer;
                            ">保存</button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // 绑定事件
            modal.querySelector('#config-cancel').onclick = () => modal.remove();
            modal.querySelector('#config-save').onclick = () => {
                const newConfig = {
                    novelUpdatesUrl: modal.querySelector('#nu-url').value,
                    seriesTitle: modal.querySelector('#series-title').value,
                    translationGroup: modal.querySelector('#trans-group').value,
                    autoSync: modal.querySelector('#auto-sync').checked
                };
                
                console.log('保存配置:', newConfig);
                const savedConfig = window.NovelSyncConfig.setNovelConfig(novelId, newConfig);
                console.log('已保存的配置:', savedConfig);
                Utils.notify('配置已保存', 'success');
                modal.remove();
            };
        },

        // 显示小说选择模态框
        showNovelSelectionModal: () => {
            const novels = Utils.getStorage('foxaholic_novels', []);
            
            if (novels.length === 0) {
                Utils.notify('请先扫描小说列表', 'warning');
                return;
            }

            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `
                <div style="
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0,0,0,0.5);
                    z-index: 10000;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                ">
                    <div style="
                        background: white;
                        padding: 24px;
                        border-radius: 8px;
                        width: 600px;
                        max-height: 80vh;
                        overflow-y: auto;
                    ">
                        <h3 style="margin: 0 0 20px 0; color: #0073aa;">选择要配置的小说</h3>
                        <div id="novel-list" style="max-height: 400px; overflow-y: auto;">
                            <!-- 小说列表将通过JavaScript动态添加 -->
                        </div>
                        <div style="text-align: right; margin-top: 20px;">
                            <button id="close-modal-btn" style="
                                padding: 8px 16px;
                                background: #f3f5f6;
                                border: 1px solid #c3c4c7;
                                border-radius: 4px;
                                cursor: pointer;
                            ">关闭</button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // 动态添加小说列表并绑定事件
            const novelList = modal.querySelector('#novel-list');
            novels.forEach(novel => {
                const novelDiv = document.createElement('div');
                novelDiv.style.cssText = `
                    border: 1px solid #ddd;
                    margin-bottom: 8px;
                    padding: 12px;
                    border-radius: 4px;
                    cursor: pointer;
                    transition: background-color 0.2s;
                `;
                
                novelDiv.innerHTML = `
                    <strong>${novel.title}</strong>
                    <br>
                    <small style="color: #666;">状态: ${novel.status} | ID: ${novel.id}</small>
                `;
                
                // 鼠标悬停效果
                novelDiv.addEventListener('mouseover', () => {
                    novelDiv.style.backgroundColor = '#f0f0f0';
                });
                novelDiv.addEventListener('mouseout', () => {
                    novelDiv.style.backgroundColor = 'white';
                });
                
                // 点击事件
                novelDiv.addEventListener('click', () => {
                    NovelSyncApp.openConfigForNovel(novel.id, novel.title);
                });
                
                novelList.appendChild(novelDiv);
            });
            
            // 关闭按钮事件
            modal.querySelector('#close-modal-btn').addEventListener('click', () => {
                modal.remove();
            });
        },

        // 打开指定小说的配置
        openConfigForNovel: (novelId, novelTitle) => {
            // 关闭选择模态框
            document.querySelector('.modal')?.remove();
            
            // 显示该小说的配置模态框
            NovelSyncApp.createConfigModal(novelId, novelTitle);
        },

        // 发布章节
        publishChapters: async (syncReport) => {
            try {
                UIManager.updateStatus('正在准备发布...', 'info');
                const engine = window.NovelSyncEngine;
                const result = await engine.autoPublishChapters(syncReport);
                
                UIManager.updateStatus(result.message, 'success');
            } catch (error) {
                UIManager.updateStatus(`发布失败: ${error.message}`, 'error');
            }
        },

        // 处理章节提取触发
        handleChapterExtractionTrigger: (triggerKey) => {
            console.log('开始处理章节提取任务...');
            
            // 获取触发信息
            const triggerInfo = Utils.getStorage(triggerKey);
            if (!triggerInfo) {
                console.error('未找到触发信息');
                return;
            }
            
            console.log('触发信息:', triggerInfo);
            
            // 显示提示面板
            UIManager.createControlPanel();
            UIManager.updateStatus('正在提取完整章节列表...', 'info');
            
            // 等待页面完全加载
            setTimeout(async () => {
                try {
                    console.log('开始自动提取章节...');
                    
                    // 查找并点击弹窗按钮
                    const popupButton = document.querySelector('.my_popupreading_open[onclick*="list_allchpstwo"]');
                    if (popupButton) {
                        console.log('找到弹窗按钮，触发显示所有章节...');
                        popupButton.click();
                        
                        // 等待弹窗加载
                        setTimeout(() => {
                            try {
                                const chapterPopup = document.querySelector('#my_popupreading ol.sp_chp');
                                if (chapterPopup) {
                                    console.log('成功加载弹窗，开始提取章节...');
                                    
                                    const published = [];
                                    const chapterItems = chapterPopup.querySelectorAll('li.sp_li_chp');
                                    console.log(`找到 ${chapterItems.length} 个章节`);
                                    
                                    chapterItems.forEach((item) => {
                                        const chapterSpan = item.querySelector('span[title]');
                                        if (chapterSpan) {
                                            const chapterText = chapterSpan.textContent.trim();
                                            const chapterMatch = chapterText.match(/c(\d+(?:\.\d+)?)/i);
                                            
                                            if (chapterMatch) {
                                                const chapterNumber = chapterMatch[1];
                                                const chapterLink = item.querySelector('a[href*="extnu"]');
                                                const chapterUrl = chapterLink ? chapterLink.href : '';
                                                
                                                published.push({
                                                    chapter: chapterNumber,
                                                    title: chapterText,
                                                    url: chapterUrl,
                                                    date: new Date(),
                                                    element: null
                                                });
                                                
                                                console.log(`✓ 提取章节 ${chapterNumber}: ${chapterText}`);
                                            }
                                        }
                                    });
                                    
                                    // 保存提取的章节数据
                                    Utils.setStorage(triggerInfo.dataKey, published);
                                    console.log(`章节提取完成，共 ${published.length} 个章节已保存`);
                                    
                                    UIManager.updateStatus(`✅ 成功提取 ${published.length} 个章节，可以关闭此页面了`, 'success');
                                    
                                    // 3秒后自动关闭窗口
                                    setTimeout(() => {
                                        window.close();
                                    }, 3000);
                                    
                                } else {
                                    console.error('弹窗未正确加载');
                                    UIManager.updateStatus('❌ 弹窗加载失败，请手动关闭此页面', 'error');
                                    Utils.setStorage(triggerInfo.dataKey, []);
                                }
                            } catch (error) {
                                console.error('提取章节时出错:', error);
                                UIManager.updateStatus('❌ 提取章节失败，请手动关闭此页面', 'error');
                                Utils.setStorage(triggerInfo.dataKey, []);
                            }
                        }, 2000); // 等待2秒让弹窗加载
                        
                    } else {
                        console.error('未找到弹窗按钮');
                        UIManager.updateStatus('❌ 未找到弹窗按钮，请手动关闭此页面', 'error');
                        Utils.setStorage(triggerInfo.dataKey, []);
                    }
                    
                } catch (error) {
                    console.error('处理章节提取时出错:', error);
                    UIManager.updateStatus('❌ 处理失败，请手动关闭此页面', 'error');
                    Utils.setStorage(triggerInfo.dataKey, []);
                }
            }, 1000); // 等待1秒让页面稳定
        },

        // 批量同步所有小说
        startBatchSync: async () => {
            try {
                UIManager.updateStatus('开始批量同步...', 'info');
                
                // 1. 获取所有小说
                const novels = Utils.getStorage('foxaholic_novels', []);
                if (novels.length === 0) {
                    UIManager.updateStatus('请先扫描小说列表', 'warning');
                    return;
                }

                // 2. 过滤出已配置的小说
                const configuredNovels = novels.filter(novel => {
                    const config = window.NovelSyncConfig.getNovelConfig(novel.id);
                    return config.novelUpdatesUrl && config.novelUpdatesUrl.trim() !== '';
                });

                if (configuredNovels.length === 0) {
                    UIManager.updateStatus('没有找到已配置的小说，请先配置同步设置', 'warning');
                    return;
                }

                UIManager.updateStatus(`开始批量同步 ${configuredNovels.length} 部小说，将逐一获取准确数据`, 'info');
                
                // 3. 询问用户是否继续（因为会打开多个窗口）
                const confirmed = confirm(`批量同步将为每部小说打开NovelUpdates页面获取准确数据。\n\n这可能会打开${configuredNovels.length}个新窗口，确认继续吗？\n\n小说列表：\n${configuredNovels.map(n => `• ${n.title}`).join('\n')}`);
                
                if (!confirmed) {
                    UIManager.updateStatus('用户取消了批量同步', 'info');
                    return;
                }
                
                // 4. 顺序执行同步检查
                const syncResults = [];
                let totalPendingChapters = 0;
                let processedCount = 0;

                for (let i = 0; i < configuredNovels.length; i++) {
                    const novel = configuredNovels[i];
                    
                    try {
                        UIManager.updateStatus(
                            `正在同步 "${novel.title}" (${i + 1}/${configuredNovels.length})...`, 
                            'info'
                        );
                        
                        const syncResult = await NovelSyncApp.performNovelSyncCheck(novel);
                        processedCount++;
                        
                        if (syncResult && syncResult.pendingSync > 0) {
                            syncResults.push({
                                novel: novel,
                                result: syncResult
                            });
                            totalPendingChapters += syncResult.pendingSync;
                            
                            UIManager.updateStatus(
                                `"${novel.title}" 完成 - 发现${syncResult.pendingSync}个待发布章节 (${processedCount}/${configuredNovels.length})`, 
                                'success'
                            );
                        } else {
                            UIManager.updateStatus(
                                `"${novel.title}" 完成 - 暂无待发布章节 (${processedCount}/${configuredNovels.length})`, 
                                'info'
                            );
                        }
                        
                        // 添加延迟，确保窗口操作完成
                        await Utils.delay(2000);
                        
                    } catch (error) {
                        console.error(`同步小说 ${novel.title} 失败:`, error);
                        processedCount++;
                        UIManager.updateStatus(
                            `"${novel.title}" 同步失败 (${processedCount}/${configuredNovels.length})`, 
                            'error'
                        );
                    }
                }

                // 4. 显示批量同步结果
                if (syncResults.length > 0) {
                    UIManager.updateStatus(`✅ 批量同步完成！发现 ${totalPendingChapters} 个章节待发布（来自 ${syncResults.length} 部小说）`, 'success');
                    
                    // 清除之前的发布按钮
                    const existingQueueButton = document.querySelector('[id^="queue-btn-"]');
                    if (existingQueueButton) {
                        existingQueueButton.remove();
                    }
                    
                    // 添加打开发布队列的按钮
                    const queueButton = document.createElement('button');
                    queueButton.id = `queue-btn-${Date.now()}`;
                    queueButton.textContent = `🚀 打开发布队列 (${totalPendingChapters}章)`;
                    queueButton.onclick = () => NovelSyncApp.openPublishQueue(syncResults);
                    queueButton.style.cssText = `
                        background: #0073aa;
                        color: white;
                        padding: 10px 16px;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 14px;
                        font-weight: 600;
                        margin-top: 10px;
                        width: 100%;
                        transition: background-color 0.2s;
                    `;
                    
                    queueButton.addEventListener('mouseover', () => queueButton.style.backgroundColor = '#005a87');
                    queueButton.addEventListener('mouseout', () => queueButton.style.backgroundColor = '#0073aa');
                    
                    const actionsContainer = document.getElementById('sync-actions');
                    if (actionsContainer) {
                        actionsContainer.appendChild(queueButton);
                    }
                    
                } else {
                    UIManager.updateStatus('✅ 批量同步完成！所有小说都已同步，暂无待发布章节', 'info');
                }
                
                // 添加调试按钮（开发测试用）
                if (window.location.search.includes('debug=1')) {
                    UIManager.addActionButton('🔧 调试信息', () => {
                        console.log('同步结果详情:', syncResults);
                        console.log('所有配置的小说:', configuredNovels);
                        alert(`调试信息已输出到控制台\n处理的小说数: ${configuredNovels.length}\n有待发布章节的小说: ${syncResults.length}\n总待发布章节: ${totalPendingChapters}`);
                    }, 'secondary');
                }

            } catch (error) {
                console.error('批量同步失败:', error);
                UIManager.updateStatus(`批量同步失败: ${error.message}`, 'error');
            }
        },

        // 执行单个小说的同步检查（通过iframe方式）
        performNovelSyncCheck: async (novel) => {
            console.log('执行小说同步检查:', novel.title);
            
            try {
                // 获取小说配置
                const config = window.NovelSyncConfig.getNovelConfig(novel.id);
                if (!config.novelUpdatesUrl) {
                    console.log(`小说 ${novel.title} 未配置NovelUpdates URL，跳过`);
                    return null;
                }
                
                // 通过iframe获取小说编辑页面的章节数据
                const chaptersData = await NovelSyncApp.getChapterDataByIframe(novel.editUrl);
                if (!chaptersData || chaptersData.length === 0) {
                    console.log(`小说 ${novel.title} 未找到章节数据`);
                    return null;
                }
                
                // 获取NovelUpdates已发布章节
                const publishedResult = await DataExtractor.extractPublishedChapters(config.novelUpdatesUrl);
                let publishedChapters = [];
                
                if (publishedResult && publishedResult.needPageOperation) {
                    console.log(`小说 ${novel.title} 需要页面操作获取NovelUpdates数据，使用真实数据获取`);
                    
                    // 使用同步引擎的实际获取方法
                    try {
                        console.log(`开始为 "${novel.title}" 获取NovelUpdates真实数据...`);
                        publishedChapters = await window.NovelSyncEngine.extractChaptersFromPage(config.novelUpdatesUrl);
                        console.log(`✅ "${novel.title}" 通过页面操作获取到 ${publishedChapters.length} 个已发布章节`);
                        
                        // 验证数据有效性
                        if (!Array.isArray(publishedChapters)) {
                            throw new Error('返回的章节数据格式不正确');
                        }
                        
                    } catch (error) {
                        console.error(`❌ 获取 "${novel.title}" 的NovelUpdates数据失败:`, error);
                        console.log(`由于无法确认已发布状态，"${novel.title}" 将跳过此次批量同步`);
                        
                        // 提示用户可以单独处理这部小说
                        Utils.notify(`"${novel.title}" 数据获取失败，建议单独同步`, 'warning');
                        return null;
                    }
                } else {
                    publishedChapters = publishedResult || [];
                }
                
                // 计算未发布章节
                console.log(`\n=== 开始分析 "${novel.title}" 的章节发布状态 ===`);
                console.log(`foxaholic总章节数: ${chaptersData.length}`);
                console.log(`已解锁章节数: ${chaptersData.filter(c => !c.isLocked).length}`);
                console.log(`NovelUpdates已发布: ${publishedChapters.length}`);
                
                const unpublishedChapters = chaptersData.filter(foxChapter => {
                    if (foxChapter.isLocked) {
                        console.log(`  📍 章节${foxChapter.number}: 锁定状态，跳过`);
                        return false;
                    }
                    
                    const isPublished = publishedChapters.some(pubChapter => {
                        const foxNum = parseFloat(foxChapter.number);
                        const pubNum = parseFloat(pubChapter.chapter);
                        const match = foxNum === pubNum;
                        
                        if (match) {
                            console.log(`  ✓ 章节${foxChapter.number}: 已发布 (NovelUpdates: c${pubChapter.chapter})`);
                        }
                        return match;
                    });
                    
                    if (!isPublished) {
                        console.log(`  🔥 章节${foxChapter.number}: 需要发布 - "${foxChapter.title}"`);
                    }
                    
                    return !isPublished;
                });
                
                console.log(`\n=== "${novel.title}" 分析完成 ===`);
                console.log(`需要发布的章节: ${unpublishedChapters.length}`);
                console.log(`章节号列表: [${unpublishedChapters.map(c => c.number).join(', ')}]`);
                
                if (unpublishedChapters.length > 0) {
                    return {
                        timestamp: new Date(),
                        novelId: novel.id,
                        totalChapters: chaptersData.length,
                        publishedCount: publishedChapters.length,
                        unlockedCount: chaptersData.filter(c => !c.isLocked).length,
                        pendingSync: unpublishedChapters.length,
                        chapters: unpublishedChapters.map(c => ({
                            number: c.number,
                            title: c.title,
                            url: c.url,
                            releaseDate: c.releaseDate
                        }))
                    };
                }
                
                return null;
                
            } catch (error) {
                console.error(`小说 ${novel.title} 同步检查失败:`, error);
                return null;
            }
        },

        // 通过iframe获取小说页面的章节数据
        getChapterDataByIframe: (editUrl) => {
            return new Promise((resolve) => { // 移除reject参数，避免未使用警告
                console.log('通过iframe获取章节数据:', editUrl);
                
                let iframe = null;
                let timeout = null;
                
                const cleanup = () => {
                    try {
                        if (timeout) {
                            clearTimeout(timeout);
                            timeout = null;
                        }
                        if (iframe && iframe.parentNode) {
                            document.body.removeChild(iframe);
                        }
                    } catch (e) {
                        console.warn('清理iframe时出错:', e);
                    }
                };
                
                try {
                    // 创建隐藏的iframe
                    iframe = document.createElement('iframe');
                    iframe.style.display = 'none';
                    iframe.style.visibility = 'hidden';
                    iframe.style.position = 'absolute';
                    iframe.style.left = '-9999px';
                    iframe.src = editUrl;
                    document.body.appendChild(iframe);
                    
                    timeout = setTimeout(() => {
                        console.log('获取章节数据超时');
                        cleanup();
                        resolve([]);
                    }, 15000); // 增加到15秒超时
                    
                    iframe.onload = () => {
                        try {
                            // 等待一小段时间让页面稳定
                            setTimeout(() => {
                                try {
                                    // 防御性检查iframe是否仍然存在
                                    if (!iframe || !iframe.parentNode) {
                                        console.warn('iframe已被移除，停止处理');
                                        resolve([]);
                                        return;
                                    }
                                    
                                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                                    
                                    if (!iframeDoc) {
                                        console.warn('无法访问iframe文档');
                                        cleanup();
                                        resolve([]);
                                        return;
                                    }
                                    
                                    // 提取章节数据
                                    const chapters = [];
                                    const chapterItems = iframeDoc.querySelectorAll('#volumes-list li li');
                                    
                                    chapterItems.forEach((item) => {
                                        const chapterLink = item.querySelector('.wp-manga-edit-chapter');
                                        if (chapterLink) {
                                            const fullText = chapterLink.textContent.trim();
                                            
                                            // 提取章节号
                                            const chapterMatch = fullText.match(/\[\d+\]\s*Chapter\s*(\d+(?:\.\d+)?)/i);
                                            const chapterNumber = chapterMatch ? chapterMatch[1] : null;
                                            
                                            if (chapterNumber) {
                                                // 提取章节标题
                                                let chapterTitle = fullText.replace(/\[\d+\]\s*/, '').replace(/\s*<i[^>]*><\/i>/, '');
                                                
                                                // 检查是否锁定
                                                const hasLockIcon = chapterLink.querySelector('i.fa-lock') !== null;
                                                let isLocked = hasLockIcon;
                                                let unlockDate = new Date();
                                                
                                                const unlockSpan = item.querySelector('.unlock_free');
                                                if (unlockSpan && hasLockIcon) {
                                                    const unlockText = unlockSpan.textContent.trim();
                                                    const dateMatch = unlockText.match(/Unlock on (.+)/);
                                                    if (dateMatch) {
                                                        unlockDate = new Date(dateMatch[1]);
                                                        isLocked = unlockDate > new Date();
                                                    }
                                                } else if (!hasLockIcon) {
                                                    isLocked = false;
                                                }
                                                
                                                // 生成章节URL
                                                let chapterUrl = '';
                                                
                                                // 尝试从页面的permalink样本获取小说基础URL
                                                const permalinkElement = iframeDoc.querySelector('#sample-permalink a');
                                                if (permalinkElement) {
                                                    let novelBaseUrl = permalinkElement.href;
                                                    if (!novelBaseUrl.endsWith('/')) {
                                                        novelBaseUrl += '/';
                                                    }
                                                    chapterUrl = `${novelBaseUrl}chapter-${chapterNumber}/`;
                                                } else {
                                                    // 备用方案：从editable-post-name获取slug
                                                    const slugElement = iframeDoc.querySelector('#editable-post-name');
                                                    if (slugElement) {
                                                        const novelSlug = slugElement.textContent.trim();
                                                        chapterUrl = `https://18.foxaholic.com/novel/${novelSlug}/chapter-${chapterNumber}/`;
                                                    } else {
                                                        // 最后备用方案：从editUrl推断
                                                        const novelId = editUrl.match(/post=(\d+)/)?.[1] || 'unknown';
                                                        chapterUrl = `https://18.foxaholic.com/novel/novel-${novelId}/chapter-${chapterNumber}/`;
                                                    }
                                                }
                                                
                                                chapters.push({
                                                    number: chapterNumber,
                                                    title: chapterTitle,
                                                    url: chapterUrl,
                                                    unlockDate: unlockDate,
                                                    isLocked: isLocked,
                                                    releaseDate: unlockDate.toISOString()
                                                });
                                            }
                                        }
                                    });
                                    
                                    console.log(`通过iframe提取到 ${chapters.length} 个章节`);
                                    cleanup();
                                    resolve(chapters);
                                    
                                } catch (error) {
                                    console.error('提取章节数据时出错:', error);
                                    cleanup();
                                    resolve([]);
                                }
                            }, 1000); // 等待1秒让页面稳定
                            
                        } catch (error) {
                            console.error('访问iframe内容失败:', error);
                            cleanup();
                            resolve([]);
                        }
                    };
                    
                    iframe.onerror = (error) => {
                        console.error('iframe加载失败:', error);
                        cleanup();
                        resolve([]);
                    };
                    
                } catch (error) {
                    console.error('创建iframe失败:', error);
                    cleanup();
                    resolve([]);
                }
            });
        },

        // 打开发布队列管理页面
        openPublishQueue: (syncResults) => {
            try {
                // 创建发布队列数据
                const publishQueue = [];
                
                syncResults.forEach(({ novel, result }) => {
                    const config = window.NovelSyncConfig.getNovelConfig(novel.id);
                    
                    result.chapters.forEach((chapter, index) => {
                        publishQueue.push({
                            novelId: novel.id,
                            novelTitle: novel.title,
                            chapterNumber: chapter.number,
                            chapterTitle: chapter.title,
                            chapterUrl: chapter.url,
                            seriesTitle: config.seriesTitle || '',
                            translationGroup: config.translationGroup || '',
                            releaseDate: chapter.releaseDate || new Date().toISOString()
                        });
                    });
                });

                // 保存发布队列到存储
                const queueKey = `publish_queue_${Date.now()}`;
                Utils.setStorage(queueKey, {
                    queue: publishQueue,
                    currentIndex: 0,
                    totalChapters: publishQueue.length,
                    createdAt: new Date().toISOString()
                });

                console.log(`创建发布队列，共 ${publishQueue.length} 个章节`);

                // 打开发布队列管理页面
                const publishUrl = `https://www.novelupdates.com/add-release/?queue_key=${queueKey}`;
                const publishWindow = window.open(publishUrl, 'novel_sync_publisher');
                
                if (!publishWindow) {
                    Utils.deleteStorage(queueKey);
                    Utils.notify('无法打开发布页面，请检查浏览器弹窗设置', 'error');
                    return;
                }

                UIManager.updateStatus(`已打开发布队列管理页面`, 'success');
                
            } catch (error) {
                console.error('打开发布队列失败:', error);
                UIManager.updateStatus(`打开发布队列失败: ${error.message}`, 'error');
            }
        },

        // 处理发布队列
        handlePublishQueue: (queueKey) => {
            console.log('开始处理发布队列...');
            
            // 获取队列数据
            const queueData = Utils.getStorage(queueKey);
            if (!queueData) {
                console.error('未找到队列数据');
                return;
            }
            
            console.log('队列数据:', queueData);
            
            // 创建发布队列管理界面
            NovelSyncApp.createPublishQueueUI(queueKey, queueData);
            
            // 自动填充第一个章节的表单
            if (queueData.queue.length > 0 && queueData.currentIndex < queueData.queue.length) {
                setTimeout(async () => {
                    await NovelSyncApp.fillCurrentChapterForm(queueData);
                }, 1000);
            }
        },

        // 创建发布队列管理界面
        createPublishQueueUI: (queueKey, queueData) => {
            // 创建队列管理面板
            const panel = document.createElement('div');
            panel.id = 'publish-queue-panel';
            panel.innerHTML = `
                <div style="
                    position: fixed;
                    top: 20px;
                    left: 20px;
                    width: 400px;
                    background: white;
                    border: 2px solid #0073aa;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    z-index: 9999;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                ">
                    <div style="
                        background: #0073aa;
                        color: white;
                        padding: 12px 16px;
                        border-radius: 6px 6px 0 0;
                        font-weight: 600;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    ">
                        <span>发布队列管理</span>
                        <span id="queue-progress">${queueData.currentIndex}/${queueData.totalChapters}</span>
                    </div>
                    <div style="padding: 16px;">
                        <div id="current-chapter-info" style="
                            background: #f0f8ff;
                            padding: 12px;
                            border-radius: 4px;
                            margin-bottom: 12px;
                            font-size: 14px;
                        "></div>
                        <div style="display: flex; gap: 8px;">
                            <button id="submit-and-next" style="
                                flex: 1;
                                background: #46b450;
                                color: white;
                                padding: 8px 12px;
                                border: none;
                                border-radius: 3px;
                                cursor: pointer;
                                font-size: 13px;
                            ">提交并下一章</button>
                            <button id="skip-chapter" style="
                                background: #ffb900;
                                color: white;
                                padding: 8px 12px;
                                border: none;
                                border-radius: 3px;
                                cursor: pointer;
                                font-size: 13px;
                            ">跳过</button>
                            <button id="finish-queue" style="
                                background: #dc3232;
                                color: white;
                                padding: 8px 12px;
                                border: none;
                                border-radius: 3px;
                                cursor: pointer;
                                font-size: 13px;
                            ">结束</button>
                        </div>
                        <div id="queue-chapters" style="
                            max-height: 200px;
                            overflow-y: auto;
                            margin-top: 12px;
                            border: 1px solid #ddd;
                            border-radius: 4px;
                            padding: 8px;
                        "></div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(panel);
            
            // 更新章节列表显示
            NovelSyncApp.updateQueueChaptersList(queueData);
            
            // 绑定事件
            document.getElementById('submit-and-next').onclick = () => {
                NovelSyncApp.submitAndNext(queueKey);
            };
            
            document.getElementById('skip-chapter').onclick = () => {
                NovelSyncApp.skipAndNext(queueKey);
            };
            
            document.getElementById('finish-queue').onclick = () => {
                NovelSyncApp.finishQueue(queueKey);
            };
        },

        // 更新队列章节列表显示
        updateQueueChaptersList: (queueData) => {
            const container = document.getElementById('queue-chapters');
            if (!container) return;
            
            let html = '';
            queueData.queue.forEach((chapter, index) => {
                const isActive = index === queueData.currentIndex;
                const isCompleted = index < queueData.currentIndex;
                
                html += `
                    <div style="
                        padding: 6px 8px;
                        margin-bottom: 4px;
                        border-radius: 3px;
                        font-size: 12px;
                        ${isActive ? 'background: #0073aa; color: white;' : ''}
                        ${isCompleted ? 'background: #46b450; color: white;' : ''}
                        ${!isActive && !isCompleted ? 'background: #f5f5f5;' : ''}
                    ">
                        <strong>${chapter.novelTitle}</strong> - 第${chapter.chapterNumber}章
                        <br><span style="opacity: 0.8;">${chapter.chapterTitle}</span>
                    </div>
                `;
            });
            
            container.innerHTML = html;
        },

        // 填充当前章节表单
        fillCurrentChapterForm: async (queueData) => {
            if (queueData.currentIndex >= queueData.queue.length) {
                console.log('队列已完成');
                return;
            }
            
            const currentChapter = queueData.queue[queueData.currentIndex];
            console.log('📋 填充队列章节表单:');
            console.log(`   📖 小说: ${currentChapter.novelTitle}`);
            console.log(`   📄 章节: ${currentChapter.chapterNumber} - ${currentChapter.chapterTitle}`);
            console.log(`   🎯 系列标题: "${currentChapter.seriesTitle}"`);
            console.log(`   👥 翻译组: "${currentChapter.translationGroup}"`);
            console.log(`   🔗 章节链接: ${currentChapter.chapterUrl}`);
            
            // 更新当前章节信息显示
            const infoElement = document.getElementById('current-chapter-info');
            if (infoElement) {
                infoElement.innerHTML = `
                    <strong>当前章节：</strong>${currentChapter.novelTitle} - 第${currentChapter.chapterNumber}章<br>
                    <strong>章节标题：</strong>${currentChapter.chapterTitle}
                `;
            }
            
            // 使用智能表单填充逻辑
            try {
                // 创建简化的填充函数（避免触发429错误）
                const fillFieldSafely = (inputId, value, description) => {
                    const input = document.getElementById(inputId);
                    if (!input || !value) return false;
                    
                    console.log(`安全填充${description}: ${value}`);
                    
                    // 直接设置值，不触发自动补全
                    input.value = value;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    
                    return true;
                };

                // 基于API的正确自动选择实现
                const autoSelectField = async (inputId, value, description) => {
                    const input = document.getElementById(inputId);
                    if (!input || !value) return false;
                    
                    console.log(`🔍 API搜索并选择${description}: "${value}"`);
                    
                    try {
                        // 步骤1: 检查是否已经有值
                        const hiddenFieldId = inputId.replace('_change_100', '100');
                        const hiddenField = document.getElementById(hiddenFieldId);
                        
                        if (hiddenField && hiddenField.value) {
                            console.log(`✅ ${description}已有选择，隐藏值: "${hiddenField.value}"`);
                            return true;
                        }
                        
                        // 步骤2: 通过AJAX API搜索
                        const searchType = inputId.includes('title') ? 'series' : 'group';
                        const searchParams = new URLSearchParams({
                            action: 'nd_ajaxsearch',
                            str: value,
                            strID: '100',
                            strType: searchType
                        });
                        
                        console.log(`📡 发送搜索请求: ${searchType} = "${value}"`);
                        
                        const response = await fetch('https://www.novelupdates.com/wp-admin/admin-ajax.php', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                                'X-Requested-With': 'XMLHttpRequest'
                            },
                            body: searchParams,
                            credentials: 'include'
                        });
                        
                        if (!response.ok) {
                            throw new Error(`搜索请求失败: ${response.status}`);
                        }
                        
                        const responseText = await response.text();
                        // 移除最后的 '0' 字符 (根据showResult函数: e = e.slice(0, -1))
                        const cleanedResponse = responseText.slice(0, -1);
                        
                        console.log(`📦 搜索结果长度: ${cleanedResponse.length} 字符`);
                        console.log(`📦 搜索结果内容预览: ${cleanedResponse.substring(0, 200)}...`);
                        
                        // 步骤3: 直接解析HTML响应内容
                        if (cleanedResponse && cleanedResponse.trim()) {
                            console.log(`🔍 开始解析HTML搜索结果...`);
                            
                            // 创建临时DOM来解析响应内容
                            const tempDiv = document.createElement('div');
                            tempDiv.innerHTML = cleanedResponse;
                            
                            // 查找所有的选择项
                            const changeItems = tempDiv.querySelectorAll('.change_list');
                            console.log(`🔎 解析到 ${changeItems.length} 个搜索结果选项`);
                            
                            if (changeItems.length === 0) {
                                console.log(`❌ 未找到 .change_list 元素，尝试解析其他结构`);
                                // 打印HTML结构供调试
                                console.log(`🔧 HTML结构: ${cleanedResponse}`);
                                return false;
                            }
                            
                            // 先尝试精确匹配
                            for (const item of changeItems) {
                                const itemText = item.textContent.trim();
                                console.log(`📋 检查精确匹配: "${itemText}"`);
                                
                                if (itemText.toLowerCase() === value.toLowerCase()) {
                                    console.log(`🎯 找到精确匹配: "${itemText}"`);
                                    return await executeSelectionByOnclick(item, hiddenField, input, description);
                                }
                            }
                            
                            // 然后尝试包含匹配
                            for (const item of changeItems) {
                                const itemText = item.textContent.trim();
                                
                                if (itemText.toLowerCase().includes(value.toLowerCase()) ||
                                    value.toLowerCase().includes(itemText.toLowerCase())) {
                                    console.log(`🎯 找到包含匹配: "${itemText}"`);
                                    return await executeSelectionByOnclick(item, hiddenField, input, description);
                                }
                            }
                        }
                        
                        console.log(`❌ ${description}搜索结果中未找到匹配项`);
                        return false;
                        
                    } catch (error) {
                        console.error(`${description}搜索选择出错:`, error);
                        return false;
                    }
                };

                // 执行选择操作的辅助函数
                const executeSelection = async function(item, hiddenField, input, description) {
                    try {
                        // 方法1: 直接点击元素
                        item.click();
                        await new Promise(resolve => setTimeout(resolve, 300));
                        
                        if (hiddenField && hiddenField.value) {
                            console.log(`✅ ${description}点击选择成功！`);
                            console.log(`   显示值: "${input.value}"`);
                            console.log(`   隐藏值: "${hiddenField.value}"`);
                            return true;
                        }
                        
                        // 方法2: 解析并调用changeitem函数
                        const onclick = item.getAttribute('onclick');
                        if (onclick) {
                            const match = onclick.match(/changeitem\('([^']+)','([^']+)','([^']+)',this\)/);
                            if (match) {
                                const [, param1, param2, param3] = match;
                                console.log(`🔧 直接调用changeitem('${param1}','${param2}','${param3}')`);
                                
                                if (typeof window.changeitem === 'function') {
                                    window.changeitem(param1, param2, param3, item);
                                    await new Promise(resolve => setTimeout(resolve, 300));
                                    
                                    if (hiddenField && hiddenField.value) {
                                        console.log(`✅ ${description}函数调用成功: "${item.textContent.trim()}"`);
                                        return true;
                                    }
                                }
                            }
                        }
                        
                        return false;
                        
                    } catch (error) {
                        console.error(`执行${description}选择时出错:`, error);
                        return false;
                    }
                };

                // 等待changeitem函数并执行选择
                const waitAndExecuteChangeitem = async function(param1, param2, param3, itemText, hiddenField, input, description) {
                    // 等待函数加载的最大时间（毫秒）
                    const maxWaitTime = 5000;
                    const checkInterval = 100;
                    let waitedTime = 0;
                    
                    console.log(`⏳ 等待changeitem函数加载...`);
                    
                    // 等待changeitem函数和jQuery加载
                    while (waitedTime < maxWaitTime) {
                        if (typeof window.changeitem === 'function' && typeof window.$ !== 'undefined') {
                            console.log(`✅ changeitem函数和jQuery已加载，开始执行选择`);
                            
                            try {
                                // 创建临时元素模拟点击源
                                const tempElement = document.createElement('span');
                                tempElement.textContent = itemText;
                                
                                // 调用changeitem函数
                                window.changeitem(param1, param2, param3, tempElement);
                                
                                // 等待DOM更新
                                await new Promise(resolve => setTimeout(resolve, 300));
                                
                                // 检查结果
                                if (hiddenField && hiddenField.value === param2) {
                                    console.log(`✅ ${description}选择成功: "${itemText}"`);
                                    console.log(`   隐藏字段值: "${hiddenField.value}"`);
                                    console.log(`   显示字段值: "${input.value}"`);
                                    return true;
                                } else {
                                    console.log(`⚠️ changeitem执行后字段未更新，尝试手动设置`);
                                }
                            } catch (error) {
                                console.error(`changeitem调用失败:`, error);
                            }
                            
                            break;
                        }
                        
                        await new Promise(resolve => setTimeout(resolve, checkInterval));
                        waitedTime += checkInterval;
                    }
                    
                    if (waitedTime >= maxWaitTime) {
                        console.log(`⏰ 等待changeitem函数超时，使用手动设置方案`);
                    }
                    
                    // 备用方案：直接设置字段值
                    console.log(`🛠️ 执行手动字段设置...`);
                    
                    if (hiddenField && input) {
                        // 设置隐藏字段的值（系列ID或翻译组ID）
                        hiddenField.value = param2;
                        
                        // 设置显示字段的值（显示名称）
                        input.value = itemText;
                        
                        // 触发change事件通知页面字段已更新
                        const changeEvent = new Event('change', { bubbles: true });
                        const inputEvent = new Event('input', { bubbles: true });
                        
                        hiddenField.dispatchEvent(changeEvent);
                        hiddenField.dispatchEvent(inputEvent);
                        input.dispatchEvent(changeEvent);
                        input.dispatchEvent(inputEvent);
                        
                        // 隐藏搜索结果（模拟changeitem函数的行为）
                        const searchContainers = document.querySelectorAll('.livesearch, .livesearchgroup');
                        searchContainers.forEach(container => {
                            container.style.display = 'none';
                        });
                        
                        console.log(`🔧 手动设置完成:`);
                        console.log(`   ${description} ID: ${param2}`);
                        console.log(`   ${description}名称: ${itemText}`);
                        console.log(`   隐藏字段 (${hiddenField.id}): "${hiddenField.value}"`);
                        console.log(`   显示字段 (${input.id}): "${input.value}"`);
                        
                        return true;
                    }
                    
                    console.log(`❌ ${description}设置失败：字段未找到`);
                    return false;
                };

                // 通过解析onclick属性执行选择
                const executeSelectionByOnclick = async function(item, hiddenField, input, description) {
                    try {
                        const onclick = item.getAttribute('onclick');
                        const itemText = item.textContent.trim();
                        
                        console.log(`🔧 解析onclick: ${onclick}`);
                        
                        if (onclick) {
                            const match = onclick.match(/changeitem\('([^']+)','([^']+)','([^']+)',this\)/);
                            if (match) {
                                const [, param1, param2, param3] = match;
                                console.log(`📞 调用changeitem('${param1}','${param2}','${param3}') for "${itemText}"`);
                                
                                // 等待changeitem函数加载并执行选择
                                const success = await waitAndExecuteChangeitem(param1, param2, param3, itemText, hiddenField, input, description);
                                if (success) {
                                    return true;
                                }
                            } else {
                                console.log(`❌ 无法解析onclick属性: ${onclick}`);
                            }
                        } else {
                            console.log(`❌ 未找到onclick属性`);
                        }
                        
                        return false;
                        
                    } catch (error) {
                        console.error(`通过onclick执行${description}选择时出错:`, error);
                        return false;
                    }
                };

                console.log(`\n🚀 开始填充第${queueData.currentIndex + 1}/${queueData.totalChapters}个章节的表单:`);
                console.log(`📊 章节详情: ${currentChapter.novelTitle} - 第${currentChapter.chapterNumber}章`);
                
                // 1. 全自动智能填充系列标题
                console.log(`\n1️⃣ 填充系列标题: "${currentChapter.seriesTitle}"`);
                const seriesOk = await autoSelectField('title_change_100', currentChapter.seriesTitle, '系列');

                // 2. 填充章节号
                console.log(`\n2️⃣ 填充章节号: c${currentChapter.chapterNumber}`);
                fillFieldSafely('arrelease', `c${currentChapter.chapterNumber}`, '章节号');

                // 3. 填充章节链接
                console.log(`\n3️⃣ 填充章节链接`);
                fillFieldSafely('arlink', currentChapter.chapterUrl, '章节链接');

                // 4. 全自动智能填充翻译组
                console.log(`\n4️⃣ 填充翻译组: "${currentChapter.translationGroup}"`);
                const groupOk = await autoSelectField('group_change_100', currentChapter.translationGroup, '翻译组');
                
                // 全自动化状态报告
                if (seriesOk && groupOk) {
                    console.log('🤖✅ 队列章节表单全自动填充完成！所有字段已自动选择');
                } else {
                    console.log(`🤖⚠️ 队列填充完成，但以下字段可能需要手动确认: ${!seriesOk ? 'Series ' : ''}${!groupOk ? 'Group' : ''}`);
                    console.log('💡 建议检查字段内容是否正确，必要时手动调整');
                }

                console.log('✅ 队列章节表单全自动智能填充完成');
                
            } catch (error) {
                console.error('智能填充队列表单失败:', error);
            }
        },

        // 提交并下一章
        submitAndNext: (queueKey) => {
            console.log('用户点击提交并下一章');
            
            // 停止自动化操作，让用户手动处理
            const confirmed = confirm(`📋 表单已填充完成！\n\n请手动执行以下步骤：\n1. 检查表单信息是否正确\n2. 手动点击页面的Submit按钮\n3. 等待提交成功\n4. 再次点击此按钮继续下一章\n\n点击确定继续下一章，点击取消停留在当前章节`);
            
            if (confirmed) {
                console.log('用户确认提交完成，继续下一章');
                NovelSyncApp.proceedToNext(queueKey);
            } else {
                console.log('用户选择停留在当前章节');
                // 不执行任何操作，让用户继续处理当前章节
            }
        },

        // 跳过并下一章
        skipAndNext: (queueKey) => {
            console.log('跳过当前章节');
            NovelSyncApp.proceedToNext(queueKey);
        },

        // 处理下一章节
        proceedToNext: (queueKey) => {
            const queueData = Utils.getStorage(queueKey);
            if (!queueData) return;
            
            queueData.currentIndex++;
            
            if (queueData.currentIndex >= queueData.totalChapters) {
                // 队列完成
                NovelSyncApp.finishQueue(queueKey);
                return;
            }
            
            // 保存更新的队列数据
            Utils.setStorage(queueKey, queueData);
            
            // 更新进度显示
            const progressElement = document.getElementById('queue-progress');
            if (progressElement) {
                progressElement.textContent = `${queueData.currentIndex}/${queueData.totalChapters}`;
            }
            
            // 清空表单
            NovelSyncApp.clearReleaseForm();
            
            // 更新章节列表显示
            NovelSyncApp.updateQueueChaptersList(queueData);
            
            // 填充下一章节表单
            setTimeout(async () => {
                await NovelSyncApp.fillCurrentChapterForm(queueData);
            }, 500);
        },

        // 清空发布表单
        clearReleaseForm: () => {
            console.log('🧹 清空发布表单...');
            
            // 清空显示字段
            const displayFields = [
                'title_change_100',   // 系列标题显示字段
                'arrelease',          // 章节号
                'arlink',             // 章节链接
                'group_change_100',   // 翻译组显示字段
                'ardate'              // 发布日期
            ];
            
            // 清空隐藏字段（重要！）
            const hiddenFields = [
                'title100',           // 系列ID隐藏字段
                'group100'            // 翻译组ID隐藏字段
            ];
            
            [...displayFields, ...hiddenFields].forEach(id => {
                const element = document.getElementById(id);
                if (element) {
                    console.log(`清空字段 ${id}: "${element.value}" → ""`);
                    element.value = '';
                    
                    // 触发change事件通知页面字段已清空
                    element.dispatchEvent(new Event('change', { bubbles: true }));
                    element.dispatchEvent(new Event('input', { bubbles: true }));
                }
            });
            
            // 隐藏任何可能显示的搜索结果
            const searchContainers = document.querySelectorAll('.livesearch, .livesearchgroup');
            searchContainers.forEach(container => {
                container.style.display = 'none';
            });
            
            console.log('✅ 发布表单清空完成');
        },

        // 完成队列
        finishQueue: (queueKey) => {
            const queueData = Utils.getStorage(queueKey);
            Utils.deleteStorage(queueKey);
            
            alert(`发布队列已完成！\n共处理了 ${queueData ? queueData.totalChapters : 0} 个章节。`);
            
            const panel = document.getElementById('publish-queue-panel');
            if (panel) {
                panel.remove();
            }
            
            // 可以选择关闭窗口或跳转到其他页面
            // window.close();
        },

        // 显示可用的Series和Group选项
        showAvailableOptions: () => {
            console.log('\n🔍 开始检测可用的Series和Group选项...');
            
            // 触发Series搜索
            const seriesInput = document.getElementById('title_change_100');
            const groupInput = document.getElementById('group_change_100');
            
            const detectOptions = (input, fieldName) => {
                if (!input) return [];
                
                console.log(`\n📋 检测${fieldName}选项...`);
                
                // 触发搜索
                input.focus();
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('keyup', { bubbles: true }));
                
                setTimeout(() => {
                    // 查找所有可能的选项元素
                    const selectors = [
                        '.ui-autocomplete .ui-menu-item',
                        '.autocomplete-suggestion',
                        '.ui-menu-item',
                        '[role="option"]',
                        '.suggestion'
                    ];
                    
                    let allOptions = [];
                    
                    for (const selector of selectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            console.log(`  使用 "${selector}" 找到 ${elements.length} 个${fieldName}选项:`);
                            
                            Array.from(elements).forEach((el, i) => {
                                const text = el.textContent.trim();
                                if (text) {
                                    console.log(`    ${i + 1}. "${text}"`);
                                    allOptions.push(text);
                                }
                            });
                            break; // 找到选项后停止
                        }
                    }
                    
                    if (allOptions.length === 0) {
                        console.log(`  ❌ 未找到${fieldName}选项`);
                    }
                    
                    return allOptions;
                }, 1000);
            };
            
            // 检测Series选项
            detectOptions(seriesInput, 'Series');
            
            // 1.5秒后检测Group选项
            setTimeout(() => {
                detectOptions(groupInput, 'Group');
            }, 1500);
            
            // 提示用户
            Utils.notify('🔍 正在检测可用选项...\n请查看控制台输出', 'info');
        }
    };

    // 内联配置管理器和同步引擎
    const initializeModules = () => {
        // 配置管理器
        class NovelSyncConfig {
            constructor() {
                this.novels = new Map();
                this.loadConfig();
            }

            loadConfig() {
                const stored = GM_getValue('novel_sync_novels_config') || '{}';
                console.log('从存储加载配置:', stored);
                const parsedConfig = JSON.parse(stored);
                console.log('解析后的配置:', parsedConfig);
                Object.entries(parsedConfig).forEach(([novelId, config]) => {
                    this.novels.set(novelId, config);
                });
                console.log('加载完成，配置映射大小:', this.novels.size);
            }

            saveConfig() {
                const configObj = {};
                this.novels.forEach((config, novelId) => {
                    configObj[novelId] = config;
                });
                GM_setValue('novel_sync_novels_config', JSON.stringify(configObj));
            }

            setNovelConfig(novelId, config) {
                const existingConfig = this.novels.get(novelId) || {};
                const newConfig = {
                    ...existingConfig,
                    ...config,
                    lastUpdated: new Date().toISOString()
                };
                
                this.novels.set(novelId, newConfig);
                this.saveConfig();
                return newConfig;
            }

            getNovelConfig(novelId) {
                const config = this.novels.get(novelId) || {
                    novelUpdatesUrl: '',
                    seriesTitle: '',
                    translationGroup: '',
                    autoSync: false,
                    syncInterval: 30000,
                    lastSync: null,
                    lastKnownChapter: '0'
                };
                console.log(`获取小说 ${novelId} 配置:`, config);
                return config;
            }

            deleteNovelConfig(novelId) {
                this.novels.delete(novelId);
                this.saveConfig();
            }

            getAllNovels() {
                return Array.from(this.novels.entries()).map(([id, config]) => ({
                    id,
                    ...config
                }));
            }
        }

        // 同步引擎
        class NovelSyncEngine {
            constructor() {
                this.isRunning = false;
                this.syncQueue = [];
                this.config = window.NovelSyncConfig;
            }

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

            async performSync(novelId) {
                const config = this.config.getNovelConfig(novelId);
                console.log('同步配置:', config);
                
                if (!config.novelUpdatesUrl) {
                    throw new Error('未配置NovelUpdates URL');
                }

                console.log('开始提取foxaholic章节...');
                const foxaholicChapters = DataExtractor.extractChapterList();
                if (foxaholicChapters.length === 0) {
                    throw new Error('未找到章节数据');
                }
                console.log(`foxaholic章节数: ${foxaholicChapters.length}`);

                console.log('开始提取NovelUpdates已发布章节:', config.novelUpdatesUrl);
                const publishedResult = await DataExtractor.extractPublishedChapters(config.novelUpdatesUrl);
                
                let publishedChapters = [];
                
                // 检查是否需要通过页面操作获取完整章节列表
                if (publishedResult && publishedResult.needPageOperation) {
                    console.log('需要通过页面操作获取完整章节列表');
                    publishedChapters = await this.extractChaptersFromPage(publishedResult.seriesUrl);
                } else {
                    publishedChapters = publishedResult || [];
                }
                
                console.log(`NovelUpdates已发布章节数: ${publishedChapters.length}`);
                const unpublishedChapters = this.calculateUnpublishedChapters(foxaholicChapters, publishedChapters);

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

                this.config.setNovelConfig(novelId, {
                    ...config,
                    lastSync: new Date().toISOString(),
                    lastKnownChapter: Math.max(
                        ...foxaholicChapters.filter(c => !c.isLocked).map(c => parseFloat(c.number))
                    ).toString()
                });

                return syncReport;
            }

            // 通过打开页面并执行JavaScript获取完整章节列表
            async extractChaptersFromPage(seriesUrl) {
                console.log('正在打开NovelUpdates页面获取完整章节列表...');
                
                // 生成唯一的存储键，用于在不同页面间传递数据
                const timestamp = Date.now();
                const dataKey = `chapters_${timestamp}`;
                const triggerKey = `trigger_${timestamp}`;
                
                // 保存触发信息
                Utils.setStorage(triggerKey, {
                    action: 'extract_chapters',
                    seriesUrl: seriesUrl,
                    dataKey: dataKey,
                    timestamp: timestamp
                });
                
                // 打开NovelUpdates页面
                const newWindow = window.open(seriesUrl + `?sync_trigger=${triggerKey}`, `nu_extract_${timestamp}`);
                
                if (!newWindow) {
                    Utils.deleteStorage(triggerKey);
                    throw new Error('无法打开新窗口，请检查浏览器弹窗设置');
                }
                
                // 等待数据返回
                return new Promise((resolve, reject) => {
                    let attempts = 0;
                    const maxAttempts = 120; // 增加到2分钟超时，给用户操作时间
                    
                    const checkData = () => {
                        attempts++;
                        const chaptersData = Utils.getStorage(dataKey);
                        
                        if (chaptersData !== null) {
                            console.log(`✅ 成功获取章节数据: ${chaptersData.length} 个章节`);
                            // 清理存储
                            Utils.deleteStorage(dataKey);
                            Utils.deleteStorage(triggerKey);
                            resolve(chaptersData);
                        } else if (attempts >= maxAttempts) {
                            console.log('⏰ 等待章节数据超时');
                            // 清理存储
                            Utils.deleteStorage(triggerKey);
                            reject(new Error('获取NovelUpdates章节数据超时'));
                        } else {
                            setTimeout(checkData, 1000); // 每秒检查一次
                        }
                    };
                    
                    // 开始检查
                    setTimeout(checkData, 3000); // 等待3秒后开始检查，给页面更多加载时间
                });
            }

            calculateUnpublishedChapters(foxaholicChapters, publishedChapters) {
                return foxaholicChapters.filter(foxChapter => {
                    if (foxChapter.isLocked) return false;
                    const isPublished = publishedChapters.some(pubChapter => {
                        return parseFloat(pubChapter.chapter) === parseFloat(foxChapter.number);
                    });
                    return !isPublished;
                });
            }

            async autoPublishChapters(syncReport) {
                if (syncReport.pendingSync === 0) {
                    return { message: '没有需要发布的章节', published: [] };
                }

                const config = this.config.getNovelConfig(syncReport.novelId);
                const publishResults = [];

                for (let i = 0; i < syncReport.chapters.length; i++) {
                    const chapter = syncReport.chapters[i];
                    
                    try {
                        // 为每个章节准备发布数据
                        const publishData = {
                            seriesTitle: config.seriesTitle || '',
                            chapterNumber: chapter.number,
                            chapterTitle: chapter.title,
                            chapterUrl: chapter.url,
                            translationGroup: config.translationGroup || '',
                            releaseDate: chapter.releaseDate ? new Date(chapter.releaseDate).toISOString() : new Date().toISOString()
                        };

                        // 将数据编码到URL参数中，避免多个标签页共享存储
                        const publishParams = Utils.encodeBase64(JSON.stringify(publishData));
                        if (!publishParams) {
                            throw new Error('数据编码失败');
                        }
                        const publishUrl = `https://www.novelupdates.com/add-release/?sync_data=${encodeURIComponent(publishParams)}`;
                        
                        console.log(`打开章节 ${chapter.number} 的发布页面:`, publishData);

                        // 打开发布页面并传递数据
                        const publishWindow = window.open(publishUrl, `publish_chapter_${chapter.number}_${Date.now()}`);
                        
                        if (!publishWindow) {
                            throw new Error('无法打开发布页面，请检查浏览器弹窗设置');
                        }

                        publishResults.push({
                            chapter: chapter.number,
                            success: true,
                            window: publishWindow,
                            data: publishData
                        });

                        // 添加延迟，避免一次性打开太多窗口
                        await Utils.delay(1500);
                        
                    } catch (error) {
                        console.error(`章节 ${chapter.number} 发布失败:`, error);
                        publishResults.push({
                            chapter: chapter.number,
                            success: false,
                            error: error.message
                        });
                    }
                }

                return {
                    message: `已为 ${publishResults.filter(r => r.success).length} 个章节打开发布页面`,
                    published: publishResults
                };
            }
        }

        // 创建全局实例
        window.NovelSyncConfig = new NovelSyncConfig();
        window.NovelSyncEngine = new NovelSyncEngine();
        
        console.log('Novel Sync Helper - 模块初始化完成');
    };

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initializeModules();
            NovelSyncApp.init();
        });
    } else {
        initializeModules();
        NovelSyncApp.init();
    }

})();