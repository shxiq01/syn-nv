# Novel Sync Helper 安装配置指南

## 快速开始

### 1. 准备工作

确保你具备以下条件：
- 拥有 foxaholic.com 后台管理权限
- 拥有 NovelUpdates.com 账户并可以发布章节
- 现代浏览器（Chrome、Firefox、Edge 等）

### 2. 安装 Tampermonkey

#### Chrome 用户
1. 访问 [Chrome 网上应用店](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
2. 点击「添加至 Chrome」
3. 在弹出对话框中点击「添加扩展程序」

#### Firefox 用户
1. 访问 [Firefox 附加组件商店](https://addons.mozilla.org/firefox/addon/tampermonkey/)
2. 点击「添加到 Firefox」
3. 在弹出对话框中点击「添加」

#### Edge 用户
1. 访问 [Edge 外接程序商店](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
2. 点击「获取」
3. 确认安装

### 3. 安装脚本

#### 方法一：直接安装（推荐）
1. 点击浏览器工具栏的 Tampermonkey 图标
2. 选择「管理面板」
3. 点击「添加新脚本」标签页
4. 删除默认内容，复制粘贴完整脚本代码
5. 按 Ctrl+S（Mac: Cmd+S）保存

#### 方法二：从文件安装
1. 下载 `novel-sync.user.js` 文件到本地
2. 打开 Tampermonkey 管理面板
3. 点击「工具」标签页
4. 点击「导入」，选择下载的文件

### 4. 验证安装

1. 访问 `https://18.foxaholic.com/wp-admin/`
2. 登录你的管理员账户
3. 如果在页面右上角看到「Novel Sync Helper」面板，说明安装成功

## 详细配置

### 小说配置设置

1. **访问小说列表页面**
   ```
   https://18.foxaholic.com/wp-admin/edit.php?post_type=wp-manga
   ```

2. **点击任意小说进入编辑页面**

3. **打开配置对话框**
   - 点击脚本面板中的「配置同步」按钮

4. **填写配置信息**

   #### NovelUpdates 小说页面URL
   ```
   格式: https://www.novelupdates.com/series/小说名称/
   示例: https://www.novelupdates.com/series/reincarnated-as-a-sword/
   ```
   
   **如何获取：**
   - 在 NovelUpdates 搜索你的小说
   - 进入小说详情页面
   - 复制地址栏中的完整URL

   #### 系列标题
   ```
   填写小说的英文标题，用于发布表单的自动补全功能
   示例: Reincarnated as a Sword
   ```

   #### 翻译组
   ```
   填写你的翻译组名称
   示例: YourTranslationGroup
   ```

   **如何确认翻译组名称：**
   - 访问 NovelUpdates 发布页面
   - 查看「Group」下拉菜单中的选项
   - 使用与下拉菜单完全一致的名称

### 高级设置

#### 自动同步
- 启用后脚本会定期检查新章节
- 默认检查间隔：30秒
- 建议在稳定的网络环境下启用

#### 章节匹配规则
脚本支持多种章节号格式：
- 英文格式：`Chapter 1`, `Chapter 1.5`
- 中文格式：`第1章`, `第1.5章`  
- 数字格式：`1`, `1.5`, `001`

## 使用流程

### 日常同步操作

1. **检查章节状态**
   ```
   foxaholic 后台 → 小说编辑页面 → 点击「分析章节」
   ```
   
2. **执行同步检查**
   ```
   点击「同步到NovelUpdates」→ 等待分析完成
   ```

3. **批量发布章节**
   ```
   如有待发布章节 → 点击「发布章节」→ 逐一确认发布
   ```

### 发布确认流程

脚本会为每个待发布章节：
1. 打开新的 NovelUpdates 发布页面
2. 自动填充表单字段
3. 等待你手动检查和提交

**重要：** 脚本不会自动提交表单，你需要：
- 检查填充的信息是否正确
- 手动点击「Submit」按钮提交

## 故障排除

### 权限问题

**症状：** 脚本无法读取页面内容
**解决：** 
1. 确认已登录 foxaholic 管理员账户
2. 检查账户是否有小说管理权限
3. 尝试刷新页面

### 网络连接问题

**症状：** 无法获取 NovelUpdates 数据
**解决：**
1. 检查网络连接
2. 确认 NovelUpdates 网站可正常访问
3. 检查浏览器是否阻止跨域请求

### 表单填充问题

**症状：** NovelUpdates 发布表单未正确填充
**可能原因：**
- 浏览器阻止了弹窗
- 网站结构发生变化
- 配置信息不正确

**解决步骤：**
1. 允许浏览器弹窗
2. 检查配置信息格式
3. 手动验证 NovelUpdates 发布页面结构

### 章节匹配问题

**症状：** 无法正确识别章节号
**解决：**
1. 检查章节标题格式是否符合支持的规则
2. 确认章节号为连续数字
3. 查看控制台输出的调试信息

### 调试方法

1. **打开开发者工具**
   - 按 F12 或右键选择「检查」

2. **查看控制台输出**
   ```javascript
   // 脚本会输出详细的运行信息
   Novel Sync Helper - 模块初始化完成
   检测到小说列表页面
   发现 X 部小说
   ```

3. **检查存储数据**
   ```javascript
   // 在控制台执行以下命令查看配置
   console.log(window.NovelSyncConfig.getAllNovels());
   ```

## 最佳实践

### 使用建议

1. **首次使用**
   - 先用一部小说测试完整流程
   - 确认所有功能正常后再批量配置

2. **章节发布**
   - 建议在网络稳定的环境下操作
   - 一次不要发布过多章节（建议≤5章）
   - 每次发布间隔2-3秒避免频繁请求

3. **数据备份**
   - 定期导出 Tampermonkey 脚本数据
   - 记录重要的配置信息

### 注意事项

⚠️ **重要提醒**
- 脚本仅作为辅助工具，不保证100%准确
- 发布前请务必手动检查章节信息
- 遵守 NovelUpdates 的使用条款和发布规则
- 不要过于频繁地请求，避免被网站限制

## 更新和维护

### 检查更新
1. 定期查看项目页面获取最新版本
2. 关注功能更新和问题修复
3. 及时更新脚本以兼容网站变化

### 反馈问题
如果遇到问题，请提供：
- 详细的错误描述
- 浏览器控制台的错误信息
- 操作步骤复现
- 脚本版本和浏览器信息