// 配置管理模块
class NovelSyncConfig {
    constructor() {
        this.novels = new Map();
        this.loadConfig();
    }

    // 加载配置
    loadConfig() {
        const stored = Utils.getStorage('novels_config', {});
        Object.entries(stored).forEach(([novelId, config]) => {
            this.novels.set(novelId, config);
        });
    }

    // 保存配置
    saveConfig() {
        const configObj = {};
        this.novels.forEach((config, novelId) => {
            configObj[novelId] = config;
        });
        Utils.setStorage('novels_config', configObj);
    }

    // 设置小说配置
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

    // 获取小说配置
    getNovelConfig(novelId) {
        return this.novels.get(novelId) || {
            novelUpdatesUrl: '',
            seriesTitle: '',
            translationGroup: '',
            autoSync: false,
            syncInterval: 30000,
            lastSync: null,
            lastKnownChapter: '0'
        };
    }

    // 删除小说配置
    deleteNovelConfig(novelId) {
        this.novels.delete(novelId);
        this.saveConfig();
    }

    // 获取所有配置的小说
    getAllNovels() {
        return Array.from(this.novels.entries()).map(([id, config]) => ({
            id,
            ...config
        }));
    }
}

// 全局配置实例
window.NovelSyncConfig = new NovelSyncConfig();