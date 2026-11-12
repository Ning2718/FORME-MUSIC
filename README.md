# FORME MUSIC — iPhone 本地优先百度网盘音乐播放器

这是 **可部署的第一版项目**，不是已经部署的网站，也没有在用户百度网盘账户上完成联调。

## 已实现
- 百度网盘 OAuth 授权（授权码 + state 校验），Cloudflare Worker 服务端持有应用密钥，授权令牌 AES-GCM 加密后写入 HttpOnly Cookie。
- 递归扫描网盘音乐文件，并分批导入曲库索引（MP3、M4A、AAC、WAV、FLAC、OGG；iPhone 实际能否解码取决于浏览器）。
- 下载与播放时 **本地优先**：MP3 完整文件存储于设备 Safari/主屏幕 Web App 的 IndexedDB；优先读取本地 Blob。可逐首或批量缓存。
- 本机文件批量导入、搜索、收藏、随机与单曲循环。
- iOS Media Session 系统元数据：默认封面、播放暂停、上一首、下一首和进度（显示与具体操作受 iOS 版本和浏览器限制）。
- PWA 主屏幕安装、离线打开网页外壳。

## 重要限制（必须阅读）
1. iOS **不允许网页主动占用灵动岛**，也无法保证动态岛显示图片。系统是否展示音乐封面/控制按钮由 iOS 自行决定。此项目使用 `navigator.mediaSession` 尽力提供媒体信息。
2. 网页无权限把音乐播放设置成系统最高优先级，不能防止系统电话、Siri、其他 App、内存管理等中断。后台切歌在某些 iOS Safari/PWA 版本不稳定。
3. IndexedDB 不是 iOS「文件」App 的永久本地目录。系统可能清理站点数据；不要把它当作唯一备份。iOS 浏览器离线缓存和后台下载能力都可能受限。大批量缓存需保持页面在前台。
4. 百度网盘正式 API 下载可能受到会员、限速、配额、文件权限、网盘开放平台审批、User-Agent、Cloudflare 代理或流量政策等限制。这份代码尚未用真实应用密钥验证下载接口。不要认为使用此项目能绕开官方限制。
5. 默认播放为了确保音频可离线，未缓存的歌曲会先**完整下载**然后播放（对大文件首次播放会较慢）。已缓存歌曲启动较快。
6. 本项目面向私人自用。不要将它变成未经授权的音频分享或 CDN 服务。

## 部署（推荐电脑终端；仅 iPhone 也可借助 GitHub 网页编辑 + Cloudflare 控制台）
1. 在 https://pan.baidu.com/union/ 创建百度网盘开放平台应用，取得 **App Key / Client ID** 与 **Secret Key / Client Secret**，并申请所需网盘权限。
2. 下载安装 Node.js 和 Wrangler，解压项目后运行 `npm install`、`npx wrangler login`。
3. 运行：
   - `npx wrangler secret put BAIDU_CLIENT_ID`
   - `npx wrangler secret put BAIDU_CLIENT_SECRET`
   - `npx wrangler secret put COOKIE_KEY`（输入你随机生成的一串至少 32 位字符）
   - `npm run deploy`
4. 部署得到例如 `https://forme-music.<your-subdomain>.workers.dev` 的域名。在百度网盘开放平台登记准确的授权回调地址：`https://forme-music.<your-subdomain>.workers.dev/auth/callback`。域名必须替换成你真实部署结果。
5. 用 iPhone Safari 打开网站 →「连接百度网盘」→ 百度官方授权 → 返回网站 →「扫描并导入音乐」。
6. 可以在 Safari 共享菜单中选择「添加到主屏幕」。建议先用 Safari 测试播放/后台/控制中心，再测试主屏幕模式。

## 安全
- 不要把 Client Secret 写入 HTML、GitHub 仓库或分享给别人；仅使用 Cloudflare Worker Secret。
- `COOKIE_KEY` 更换后，当前登录授权会失效。
- App 在服务端转发音乐内容供本人播放，有可能产生较多的 Cloudflare 出站流量和调用次数。
- Worker 在生产场景需要进一步限流、监控下载错误、检查百度实际返回的下载域名，以及验证服务条款后再开放长期使用。

## 下一步优化
建议先实际验证百度 API 的登录、列表与音频下载。如果网盘接口限制导致 Cloudflare Worker 无法代理文件，可以切换到符合网盘规则的后端下载架构；若核心诉求是**真正稳定的灵动岛、后台播放和离线长期保存**，优先将 UI 与曲库迁移到 iOS 原生容器（AVAudioSession + Now Playing），而不是继续堆叠网页补丁。
