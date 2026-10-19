# Travel Planning Assistant 分支操作指南

本文假设使用以下仓库和分支：

- 仓库：`https://github.com/xuezhengzhang-China/Travel-Planning-Assistant`
- 开发分支：`zhangxuezheng`
- 主分支：`main`

## 1. 首次配置 Git

检查 Git 是否已经安装：

```bash
git --version
```

首次使用时配置提交者信息：

```bash
git config --global user.name "你的 GitHub 用户名"
git config --global user.email "你的 GitHub 邮箱"
```

通过 HTTPS 推送时，需要使用浏览器授权、Git Credential Manager 或 Personal Access Token。GitHub 账户密码不能直接作为推送密码。

## 2. 克隆仓库

```bash
git clone https://github.com/xuezhengzhang-China/Travel-Planning-Assistant.git
cd Travel-Planning-Assistant
```

检查远程地址：

```bash
git remote -v
```

## 3. 切换或创建 zhangxuezheng 分支

先获取远程分支信息：

```bash
git fetch origin
```

### 远程分支已经存在

如果本地还没有该分支：

```bash
git switch --track origin/zhangxuezheng
```

如果本地已经有该分支：

```bash
git switch zhangxuezheng
git pull origin zhangxuezheng
```

### 远程分支尚不存在

基于最新 `main` 创建：

```bash
git switch main
git pull --ff-only origin main
git switch -c zhangxuezheng
git push -u origin zhangxuezheng
```

`-u` 会建立本地分支与远程分支的跟踪关系。之后可以直接执行 `git push` 和 `git pull`。

确认当前分支：

```bash
git branch --show-current
```

输出应为：

```text
zhangxuezheng
```

## 4. 向 zhangxuezheng 分支上传内容

将文件放入项目目录后查看改动：

```bash
git status
```

添加指定文件：

```bash
git add README.md
git add src/planner.py
```

或者添加当前目录下的全部改动：

```bash
git add .
```

提交改动：

```bash
git commit -m "feat: add travel planning feature"
```

推送到远程开发分支：

```bash
git push origin zhangxuezheng
```

如果已经建立跟踪关系，可以简写为：

```bash
git push
```

完整的日常提交流程如下：

```bash
cd Travel-Planning-Assistant
git switch zhangxuezheng
git pull origin zhangxuezheng
git status
git add .
git commit -m "feat: describe this change"
git push origin zhangxuezheng
```

## 5. 开发过程中同步 main

合并前应把最新的 `main` 同步到开发分支，尽早解决冲突：

```bash
git switch zhangxuezheng
git fetch origin
git merge origin/main
```

测试通过后推送：

```bash
git push origin zhangxuezheng
```

也可以先更新本地 `main`：

```bash
git switch main
git pull --ff-only origin main
git switch zhangxuezheng
git merge main
git push origin zhangxuezheng
```

## 6. 将 zhangxuezheng 合并到 main

推荐通过 GitHub Pull Request 合并。这样可以检查文件差异、运行自动测试并进行代码审查。

### 方法一：使用 Pull Request 推荐

1. 确保开发内容已经提交并推送：

   ```bash
   git switch zhangxuezheng
   git status
   git push origin zhangxuezheng
   ```

2. 打开仓库的 GitHub 页面。

3. 进入 **Pull requests**，点击 **New pull request**。

4. 设置分支方向：

   ```text
   base: main
   compare: zhangxuezheng
   ```

   这表示把 `zhangxuezheng` 的改动合并进 `main`。不要把两个分支选反。

5. 检查提交记录和文件差异，填写标题与说明。

6. 点击 **Create pull request**。

7. 等待测试和审查通过后，点击 **Merge pull request**。

8. 合并完成后更新本地 `main`：

   ```bash
   git switch main
   git pull --ff-only origin main
   ```

### 方法二：使用命令行直接合并

只有在拥有 `main` 的推送权限，并且仓库规则允许直接推送时使用：

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git merge --no-ff zhangxuezheng
git push origin main
```

`--no-ff` 会保留明确的合并提交。如果团队要求 Squash Merge、Rebase Merge 或线性历史，应遵守仓库约定。

## 7. 处理合并冲突

发生冲突时先查看冲突文件：

```bash
git status
```

冲突位置通常如下：

```text
<<<<<<< HEAD
当前分支内容
=======
待合并分支内容
>>>>>>> 分支名称
```

手动保留正确内容并删除冲突标记，然后执行：

```bash
git add 冲突文件路径
git commit
git push
```

如果决定取消尚未提交的合并：

```bash
git merge --abort
```

## 8. 合并后删除分支 可选

确认改动已经进入 `main` 后，删除本地分支：

```bash
git switch main
git branch -d zhangxuezheng
```

删除远程分支：

```bash
git push origin --delete zhangxuezheng
```

如果仍计划使用该分支继续开发，则不需要删除。

## 9. 常见问题

### 推送时提示 Permission denied

检查以下事项：

- 当前 GitHub 账户是否拥有仓库写入权限。
- HTTPS 凭据是否过期或登录了错误账户。
- 使用 SSH 时，公钥是否已经添加到 GitHub。
- `main` 是否为受保护分支，只允许通过 Pull Request 合并。

### 提交前确认当前分支

```bash
git branch --show-current
git status
```

### git push 提示没有 upstream

首次推送执行：

```bash
git push -u origin zhangxuezheng
```

### 看不到远程最新分支

```bash
git fetch origin
git branch -a
```

检查列表中是否存在 `origin/zhangxuezheng` 和 `origin/main`。

## 10. 推荐流程总结

开发并推送：

```bash
git switch zhangxuezheng
git pull origin zhangxuezheng
git add .
git commit -m "feat: describe this change"
git push origin zhangxuezheng
```

合并前同步：

```bash
git fetch origin
git merge origin/main
git push origin zhangxuezheng
```

最后在 GitHub 创建以下 Pull Request：

```text
zhangxuezheng -> main
```

