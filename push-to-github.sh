#!/bin/bash

# ============================================
# GitHub 推送脚本
# ============================================

set -e

echo "🚀 OpenClaw K8s 运维 Agent - GitHub 推送脚本"
echo ""

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 步骤 1: 配置 Git 用户信息
echo -e "${YELLOW}步骤 1: 配置 Git 用户信息${NC}"
echo ""

# 检查是否已配置
GIT_NAME=$(git config user.name 2>/dev/null || echo "")
GIT_EMAIL=$(git config user.email 2>/dev/null || echo "")

if [ -z "$GIT_NAME" ] || [ -z "$GIT_EMAIL" ]; then
    echo "请输入您的 Git 信息："
    read -p "姓名 (例如: Zhang San): " INPUT_NAME
    read -p "邮箱 (例如: zhangsan@example.com): " INPUT_EMAIL

    git config user.name "$INPUT_NAME"
    git config user.email "$INPUT_EMAIL"

    echo -e "${GREEN}✓ Git 用户信息已配置${NC}"
else
    echo -e "${GREEN}✓ Git 用户已配置: $GIT_NAME <$GIT_EMAIL>${NC}"
fi

echo ""

# 步骤 2: 创建初始提交
echo -e "${YELLOW}步骤 2: 创建 Git 提交${NC}"

# 检查是否已有提交
if ! git rev-parse HEAD >/dev/null 2>&1; then
    git add -A
    git commit -m "Initial commit: K8s 运维 Agent 完整实现

- 4 个 Skills: pod, deploy, node, svc (27 个操作)
- 完整文档: 10+ markdown 文件
- 测试应用和指南
- Cron 自动化配置
- 飞书集成文档

第一周学习成果 ✅"

    echo -e "${GREEN}✓ 初始提交已创建${NC}"
else
    echo -e "${GREEN}✓ 仓库已有提交历史${NC}"
fi

echo ""

# 步骤 3: 创建 GitHub 仓库
echo -e "${YELLOW}步骤 3: 创建 GitHub 仓库${NC}"
echo ""
echo "请在 GitHub 上创建一个新仓库："
echo "  1. 访问: https://github.com/new"
echo "  2. 仓库名称: k8s-ops-agent (或其他名称)"
echo "  3. 描述: OpenClaw K8s 运维自动化系统"
echo "  4. 选择 Public 或 Private"
echo "  5. 不要选择 'Initialize with README' (我们已经有了)"
echo "  6. 点击 'Create repository'"
echo ""

read -p "创建完成后，输入仓库 URL (例如: https://github.com/yourusername/k8s-ops-agent.git): " REPO_URL

if [ -z "$REPO_URL" ]; then
    echo -e "${RED}✗ 未输入仓库 URL，退出${NC}"
    exit 1
fi

# 步骤 4: 添加远程仓库
echo ""
echo -e "${YELLOW}步骤 4: 添加远程仓库${NC}"

# 检查是否已有 origin
if git remote get-url origin >/dev/null 2>&1; then
    echo "远程仓库 'origin' 已存在，是否更新？(y/n)"
    read -p "> " UPDATE_REMOTE
    if [ "$UPDATE_REMOTE" = "y" ]; then
        git remote set-url origin "$REPO_URL"
        echo -e "${GREEN}✓ 远程仓库已更新${NC}"
    fi
else
    git remote add origin "$REPO_URL"
    echo -e "${GREEN}✓ 远程仓库已添加${NC}"
fi

echo ""

# 步骤 5: 推送到 GitHub
echo -e "${YELLOW}步骤 5: 推送到 GitHub${NC}"
echo ""

# 检查当前分支
CURRENT_BRANCH=$(git branch --show-current)
if [ -z "$CURRENT_BRANCH" ]; then
    CURRENT_BRANCH="main"
    git branch -M main
fi

echo "准备推送分支: $CURRENT_BRANCH"
echo ""

# 推送
echo "开始推送..."
if git push -u origin "$CURRENT_BRANCH"; then
    echo ""
    echo -e "${GREEN}✓ 推送成功！${NC}"
    echo ""
    echo "访问您的仓库: ${REPO_URL%.git}"
else
    echo ""
    echo -e "${RED}✗ 推送失败${NC}"
    echo ""
    echo "可能的原因："
    echo "  1. 需要配置 SSH 密钥或 Personal Access Token"
    echo "  2. 仓库 URL 错误"
    echo "  3. 没有推送权限"
    echo ""
    echo "解决方案："
    echo "  - 使用 SSH: git remote set-url origin git@github.com:yourusername/k8s-ops-agent.git"
    echo "  - 使用 Token: 在推送时输入 GitHub 用户名和 Personal Access Token"
    echo ""
    exit 1
fi

# 步骤 6: 重命名 README
echo ""
echo -e "${YELLOW}步骤 6: 更新 README${NC}"

if [ -f "README-GITHUB.md" ]; then
    mv README-GITHUB.md README.md
    git add README.md
    git commit -m "docs: 更新 README 为 GitHub 版本"
    git push
    echo -e "${GREEN}✓ README 已更新${NC}"
fi

echo ""
echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}🎉 全部完成！${NC}"
echo -e "${GREEN}=====================================${NC}"
echo ""
echo "您的项目已推送到 GitHub！"
echo ""
echo "📂 仓库地址: ${REPO_URL%.git}"
echo ""
echo "下次更新时，只需执行："
echo "  git add -A"
echo "  git commit -m \"更新说明\""
echo "  git push"
echo ""
