# 水电费分摊计算器

一个用于合租/邻里间**电费、水费分摊计算**的轻量工具，支持多住户共享数据、管理员统一管理房间、历史记录留存。部署在 Cloudflare 全家桶上（Pages + Workers + KV）。

- **前端**：纯静态 HTML + 原生 JavaScript，部署在 Cloudflare Pages
- **后端**：Cloudflare Workers（无服务器 API）
- **存储**：Cloudflare KV（键值存储）
- **无需服务器、无需备案、免费额度足够小工具使用**

---

## ✨ 功能特性

### 核心计算
- **电费分摊**：按用电量比例分摊总电费，两户金额之和恒等于总电费（余数归 B 户）
- **水费独立计算**：按每户用水量 × 自定义单价，各付各的；**允许只填一户**，另一户留空记为"未填写"
- **抄表输入**：输入上次/本次抄表数自动算出用电/用水量
- **总电费支持加减法**：可添加多个费用项（账单金额 + 附加费 − 补贴 − 预缴……），**每项可填备注**

### 数据共享
- **共享房间**：输入同一房间码的邻居看到同一份数据，5 秒自动同步
- **历史记录**：每次保存的结算记录共享给房间内所有人，支持回填/删除
- **自动填充**：进入房间时，按费用种类分别把最近一次历史的"本次抄表数"填入"上次抄表数"，把该条历史的"结束日期"填入对应周期的"开始日期"

### 管理员功能
- **管理员登录**：只有持有密码的人才能创建和管理房间；**单点登录**，新设备登录后旧设备自动失效
- **房间管理**：增、删、改、查房间，可为房间添加备注（如"3栋301"）
- **访问控制**：用户只能进入管理员创建过的房间，未开放的房间码无法进入

### 用户体验
- 住户可自定义昵称，所有标题和结果同步更新
- 电费/水费计费周期相互独立，结束日期默认今天
- 保存进度可视化："⏳ 保存中，请勿关闭页面" → "✅ 保存成功" → 自动清空输入框
- 保存失败自动缓存，下次进入房间时自动重传
- 响应式设计，手机/平板/电脑均可使用（含 iOS 微信内置浏览器）

---

## 📁 项目结构

```text
utility-calc/
├── frontend/
│   └── index.html              # 前端页面（Cloudflare Pages 部署）
├── worker/
│   ├── src/
│   │   └── index.js            # Worker 后端代码
│   ├── wrangler.toml           # Worker 配置
│   └── package.json
├── .github/
│   └── workflows/
│       └── deploy-worker.yml   # GitHub Actions 自动部署 Worker
├── .gitignore
└── README.md
```

---

## 🚀 部署指南

### 前置准备
1. 一个 [Cloudflare](https://dash.cloudflare.com/) 账号（免费）
2. 一个 [GitHub](https://github.com/) 账号（免费）
3. 本地安装 [Git](https://git-scm.com/) 和 [Node.js](https://nodejs.org/)（用于本地测试 Worker）

### 第一步：Fork / Clone 本仓库

```bash
git clone https://github.com/你的用户名/utility-calc.git
cd utility-calc
```

### 第二步：创建 Cloudflare KV 命名空间

1. 登录 Cloudflare Dashboard
2. 左侧菜单 → **存储和数据库** → **KV**
3. 点击 **创建命名空间**，名称填 `utility-calc-rooms`
4. 创建完成后复制它的 **ID**（形如 `abc123def456...`）

### 第三步：配置 `worker/wrangler.toml`

仓库中的 `wrangler.toml` 使用 `${KV_ID}` 占位符，KV ID 不直接入库：

```toml
name = "utility-calc-api"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "ROOMS"
id = "${KV_ID}"
```

- **用 GitHub Actions 部署**：无需改动此文件，KV ID 通过 GitHub Secrets 注入（见第四步）
- **本地手动部署**：把 `${KV_ID}` 临时替换为真实 KV ID，或设置环境变量 `KV_ID` 后再执行 `wrangler deploy`

### 第四步：部署 Worker

**方式 A：使用 GitHub Actions 自动部署（推荐）**

1. 生成 Cloudflare API Token：
   - 头像 → **My Profile** → **API Tokens** → **Create Token**
   - 使用模板 **Edit Cloudflare Workers**
2. 把以下 3 个 Secrets 加到 GitHub 仓库（**缺一不可**）：
   - 仓库 → **Settings** → **Secrets and variables** → **Actions**
   - `CLOUDFLARE_API_TOKEN`：刚才生成的 Token
   - `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Dashboard 右侧栏的 Account ID
   - `KV_ID`：第二步创建的 KV 命名空间 ID
3. push 代码后，GitHub Actions 会自动注入 KV ID 并部署 Worker

**方式 B：本地手动部署**

```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy
```

部署成功后会得到形如 `https://utility-calc-api.<你的子域>.workers.dev` 的地址。

### 第五步：为 Worker 设置管理员密码

1. Cloudflare Dashboard → **Workers & Pages** → 点开 `utility-calc-api`
2. **设置** → **变量和密钥** → **添加**
3. 名称填 `ADMIN_PASSWORD`，值填你自定义的密码，类型选 **Secret**
4. 保存并重新部署

### 第六步：部署前端到 Cloudflare Pages

1. Cloudflare Dashboard → **Workers & Pages** → **创建应用程序** → **Pages** → **连接到 Git**
2. 选择本仓库
3. 构建设置：
   - **框架预设**：None
   - **构建命令**：留空
   - **构建输出目录**：`frontend`
4. 保存并部署，得到形如 `https://utility-calc.pages.dev` 的网址

### 第七步：修改前端中的 API 地址

打开 `frontend/index.html`，找到：

```javascript
const API_BASE = 'https://utility-calc-api.你的子域.workers.dev';
```

替换成第四步得到的真实 Worker 地址。改完 `git push`，Pages 会自动重新部署。

---

## 📖 使用说明

### 管理员初始化

1. 打开 Pages 网址
2. 切到 **🔧 管理** Tab
3. 输入你设置的管理员密码 → 登录
4. 在“创建房间”里填房间码（如 `WANGJI2026`）和备注（如 `3栋301`）
5. 点击 **＋ 创建房间**

### 普通用户使用

1. 打开 Pages 网址
2. 顶部 **共享房间** 卡片输入管理员给你的房间码
3. 点击 **进入**，页面显示 `✅ 已进入房间：XXXX`
4. 在 **⚙️ 基础设置** 里填写住户昵称和计费周期
5. 切到 **⚡ 电费** 或 **💧 水费** Tab 填写抄表数据
6. 点击 **计算分摊**，查看结果
7. 确认无误后，点击 **💾 保存本次记录**
   - 页面显示 `⏳ 保存中...请勿关闭页面`
   - 成功后显示 `✅ 保存成功！输入框即将清空`
   - 2 秒后输入框自动清空
8. 切到 **📋 历史** Tab 可以查看/回填/删除历史记录

### 邻居共享

把 Pages 网址 + 房间码发到群里，邻居打开同一网址、输入相同房间码即可：
- 5 秒内看到你保存的最新数据
- 历史记录一并同步
- 保存时若失败，数据会缓存到本地，下次打开自动重传

---

## 🔧 技术细节

### 数据同步机制

| 场景 | 处理方式 |
|------|---------|
| 输入变化 | 暂存本地，**不自动推送**；本地有未保存修改时，轮询不会覆盖输入框 |
| 点击“保存本次记录” | 先拉取远端合并历史，再主动 PUT 到 Worker，带重试（最多 3 次） |
| 进入房间 | GET 拉取，遇到“不存在”自动重试（应对 KV 最终一致性） |
| 同步轮询 | 加入房间后每 5 秒 GET 一次；**标签页不可见时暂停轮询**以节省 KV 配额 |
| 保存失败 | 数据进待重传队列，下次进入房间自动 flush（重传前先与远端合并） |
| 历史合并 | 按 `id` 去重，按时间倒序，最多保留 200 条 |
| 历史删除/清空 | 通过 `deletedIds` 墓碑机制同步给所有客户端，删除的记录不会被合并复活 |
| 历史本地缓存 | **按房间隔离**存储，退出/切换房间不会互相污染 |
| 电费分摊舍入 | A 户四舍五入到分，B 户 = 总额 − A，保证两户之和恒等于总电费 |

### 安全设计

- **管理员 token**：`时间戳.会话ID.签名` 格式，7 天过期，改密码即全部失效；**单点登录**（新登录使旧会话立即失效）；登录接口按 IP 限流（10 次/5 分钟）
- **房间数据写入**：Worker 对 PUT 数据做结构白名单校验 + 512KB 大小限制，防止垃圾数据注入
- **前端渲染**：所有远端数据渲染前转义 + 数字类型兜底，防止存储型 XSS 和损坏数据导致页面崩溃
- **注意事项**：房间数据读写对持有房间码的人开放（设计上房间码即准入凭证），请勿在昵称/备注中填写敏感信息

### 为什么用 Cloudflare KV 而不是数据库？

- **免费额度足够**：每天 10 万次读、1000 次写，3~5 户邻居完全够用
- **无需备案**：`workers.dev` 域名不需要 ICP 备案
- **零运维**：无需自己维护服务器
- **注意事项**：KV 是最终一致性存储，写入后可能延迟数秒才能被所有节点读到，因此代码里加了读取重试

---

## ❓ 常见问题

### Q1：访问 `workers.dev` 域名显示“无法访问此网站”
国内网络环境可能屏蔽 `workers.dev` 子域。解决方案：
- 绑定自定义域名：在 Worker 的 **设置** → **域和路由** → **添加自定义域**，填自己的域名
- 或者改用 `pages.dev` 部署后端（Pages Functions），`pages.dev` 目前国内可访问

### Q2：加入房间时显示“房间不存在或未开放”
- 检查房间码是否拼写正确（大小写无关）
- 检查管理员是否创建过该房间
- 刚创建的房间可能因 KV 延迟暂时读不到，等待 3~10 秒后重试

### Q3：保存时显示“保存中...”很久
- 网络慢或者 `workers.dev` 被屏蔽，会触发 3 次重试
- 失败后数据不会丢，会在下次进入房间时自动重传

### Q4：历史记录没有同步到邻居
- 检查是否点击了 **💾 保存本次记录**（只点“计算分摊”不会保存）
- 检查邻居是否在 5 秒后刷新（轮询间隔）

### Q5：管理员密码忘了
- 在 Cloudflare Dashboard 里重新设置 `ADMIN_PASSWORD` 环境变量
- 老的历史记录不受影响

---

## 📄 License

MIT License

---

**如果这个工具帮到了你，欢迎给个 Star ⭐**
