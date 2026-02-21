#!/bin/bash

# ============================================
# GitHub 同步脚本（日常更新用）
# ============================================

set -e

echo "🔄 同步学习记录到 GitHub..."
echo ""

# 检查是否有修改
if [ -z "$(git status --porcelain)" ]; then
    echo "✓ 没有新的修改"
    exit 0
fi

# 显示修改的文件
echo "📝 修改的文件:"
git status --short
echo ""

# 询问提交信息
read -p "输入提交信息 (直接回车使用默认): " COMMIT_MSG

if [ -z "$COMMIT_MSG" ]; then
    COMMIT_MSG="docs: 更新学习记录 - $(date '+%Y-%m-%d')"
fi

# 添加所有修改
git add -A

# 提交
git commit -m "$COMMIT_MSG"

# 推送
echo ""
echo "推送到 GitHub..."
git push

echo ""
echo "✅ 同步完成！"
echo ""
echo "查看仓库: $(git remote get-url origin | sed 's/\.git$//')"
echo ""
