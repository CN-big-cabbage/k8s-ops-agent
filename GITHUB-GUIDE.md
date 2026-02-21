# GitHub 上传和同步指南

将您的 K8s 学习记录上传到 GitHub，随时随地查看。

---

## 🚀 首次上传到 GitHub

### 方法 1: 使用自动化脚本（推荐）

```bash
cd /Users/a123/.openclaw/extensions/k8s

# 执行推送脚本
./push-to-github.sh
```

脚本会引导您完成：
1. ✅ 配置 Git 用户信息
2. ✅ 创建初始提交
3. ✅ 在 GitHub 创建仓库
4. ✅ 推送代码

### 方法 2: 手动操作

#### 步骤 1: 配置 Git

```bash
cd /Users/a123/.openclaw/extensions/k8s

# 配置用户信息（首次使用）
git config user.name "您的姓名"
git config user.email "您的邮箱"
```

#### 步骤 2: 创建提交

```bash
# 查看状态
git status

# 添加所有文件
git add -A

# 创建提交
git commit -m "Initial commit: K8s 运维 Agent 学习项目"
```

#### 步骤 3: 在 GitHub 创建仓库

1. 访问 https://github.com/new
2. 仓库名称: `k8s-ops-agent`
3. 描述: `OpenClaw K8s 运维自动化学习项目`
4. 选择 **Public** 或 **Private**
5. **不要**勾选 "Add a README file"
6. 点击 "Create repository"

#### 步骤 4: 推送到 GitHub

复制 GitHub 给出的命令，或执行：

```bash
# 添加远程仓库（替换为您的仓库 URL）
git remote add origin https://github.com/您的用户名/k8s-ops-agent.git

# 推送
git branch -M main
git push -u origin main
```

---

## 🔄 日常同步更新

### 方法 1: 使用快捷脚本

```bash
cd /Users/a123/.openclaw/extensions/k8s

# 一键同步
./sync-to-github.sh
```

### 方法 2: Git 命令

```bash
# 查看修改
git status

# 添加修改
git add -A

# 提交
git commit -m "更新: 完成第二周学习"

# 推送
git push
```

---

## 📱 在其他设备查看

### 在手机/平板查看

1. **直接访问 GitHub**
   ```
   https://github.com/您的用户名/k8s-ops-agent
   ```

2. **推荐文档阅读顺序**
   - WEEK1-PRACTICE.md - 第一周实践
   - SCENARIOS.md - 实战场景
   - REAL-WORLD-OPS.md - 运维指南

### 在其他电脑克隆

```bash
# 克隆仓库
git clone https://github.com/您的用户名/k8s-ops-agent.git

# 进入目录
cd k8s-ops-agent

# 查看所有文档
ls -la
```

---

## 🌐 使用网盘同步（备选方案）

如果您也想使用网盘，可以同步到：

### 方案 1: iCloud（Mac 用户）

```bash
# 创建软链接到 iCloud
ln -s /Users/a123/.openclaw/extensions/k8s ~/Library/Mobile\ Documents/com~apple~CloudDocs/k8s-learning

# 文件会自动同步到 iCloud
```

### 方案 2: 坚果云/百度网盘

```bash
# 将项目复制到网盘同步文件夹
cp -r /Users/a123/.openclaw/extensions/k8s ~/坚果云/k8s-learning

# 或创建同步脚本
cat > sync-to-nutstore.sh << 'EOF'
#!/bin/bash
rsync -av --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  /Users/a123/.openclaw/extensions/k8s/ \
  ~/坚果云/k8s-learning/
EOF

chmod +x sync-to-nutstore.sh
```

---

## 📚 GitHub 仓库美化

### 添加 Topics

在 GitHub 仓库页面，点击 "Add topics"，添加：
- `kubernetes`
- `k8s`
- `devops`
- `automation`
- `learning`
- `openclaw`

### 添加 License

创建 `LICENSE` 文件：

```bash
cat > LICENSE << 'EOF'
MIT License

Copyright (c) 2026 [您的姓名]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction...
EOF

git add LICENSE
git commit -m "docs: 添加 MIT License"
git push
```

### 创建 GitHub Pages（可选）

如果想让文档更漂亮：

1. 进入仓库 Settings → Pages
2. Source 选择 `main` 分支
3. 保存

文档会发布到：
```
https://您的用户名.github.io/k8s-ops-agent/
```

---

## 🔧 常见问题

### 问题 1: 推送时要求密码

**GitHub 已不支持密码验证**，需要使用：

**方案 A: Personal Access Token**

1. GitHub 头像 → Settings → Developer settings
2. Personal access tokens → Tokens (classic)
3. Generate new token
4. 权限勾选: `repo`
5. 复制 token

推送时：
- Username: 您的 GitHub 用户名
- Password: 粘贴刚才的 token

**方案 B: SSH 密钥（推荐）**

```bash
# 生成 SSH 密钥
ssh-keygen -t ed25519 -C "您的邮箱"

# 查看公钥
cat ~/.ssh/id_ed25519.pub

# 复制公钥内容
```

在 GitHub:
1. Settings → SSH and GPG keys
2. New SSH key
3. 粘贴公钥

修改远程 URL:
```bash
git remote set-url origin git@github.com:您的用户名/k8s-ops-agent.git
```

---

### 问题 2: 推送失败 - Permission denied

确保：
1. SSH 密钥已添加到 GitHub
2. 或使用 Personal Access Token
3. 仓库 URL 正确

---

### 问题 3: 如何排除敏感信息？

已在 `.gitignore` 中排除：
- `node_modules/`
- `*.log`
- 个人配置文件

如需额外排除：
```bash
echo "my-secret-file.txt" >> .gitignore
git add .gitignore
git commit -m "chore: 更新 .gitignore"
```

---

## 📊 同步频率建议

### 推荐同步时机

- ✅ 完成每周学习任务后
- ✅ 添加新的运维文档
- ✅ 解决重要问题并记录
- ✅ 每天练习结束时

### 提交信息规范（可选）

```bash
# 功能类
git commit -m "feat: 添加 k8s-xxx skill"

# 文档类
git commit -m "docs: 完成第二周学习记录"

# 修复类
git commit -m "fix: 修正配置文件错误"

# 配置类
git commit -m "chore: 更新依赖"
```

---

## 🎯 自动化同步（高级）

### 使用 cron 自动提交

```bash
# 编辑 crontab
crontab -e

# 添加（每天 22:00 自动同步）
0 22 * * * cd /Users/a123/.openclaw/extensions/k8s && ./sync-to-github.sh >> ~/k8s-sync.log 2>&1
```

---

## 🌟 分享您的学习

### 如果仓库是 Public

可以分享链接给朋友：
```
https://github.com/您的用户名/k8s-ops-agent
```

### 添加徽章（可选）

在 README.md 添加：

```markdown
![GitHub stars](https://img.shields.io/github/stars/您的用户名/k8s-ops-agent)
![GitHub forks](https://img.shields.io/github/forks/您的用户名/k8s-ops-agent)
![License](https://img.shields.io/github/license/您的用户名/k8s-ops-agent)
```

---

## 📞 需要帮助？

遇到问题随时问我：

- "GitHub 推送失败了"
- "怎么配置 SSH 密钥？"
- "如何回退到之前的版本？"

---

**开始您的 GitHub 之旅！** 🚀
