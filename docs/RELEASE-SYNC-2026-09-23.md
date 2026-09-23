# 2026-09-23：P6 主线同步、Release 备份与回退

## 基线

本次操作前 `main` 与 `codex/folio-editor-p6` 均为 `0b1cfa0cfb685f8d8bbd5ee04b0042574a85a8d5`。`codex/release-1.2-rc1-p6` 为 `d7da3515e5d477122197639dc202c58584b5b21f`，只多出 `.github/workflows/release-rc1-p6.yml`。因此本次不重新实现 P6 功能，也不改变已验证程序。

操作前 GitHub Latest 是 P1，P6 是预发布。原始发布 ID、正文、状态、时间、附件名/大小/SHA-256 已记录在 [发布快照](release-snapshots/2026-09-23-p6-sync.json)。

## 独立备份

| 对象 | 备份位置 | 精确基线 |
| --- | --- | --- |
| 原 main / P6 编辑代码 | [backup/main-before-p6-sync-20260923](https://github.com/ionize1080/Folio/tree/backup/main-before-p6-sync-20260923) | `0b1cfa0cfb685f8d8bbd5ee04b0042574a85a8d5` |
| 原 P6 发布分支 | [backup/release-p6-before-sync-20260923](https://github.com/ionize1080/Folio/tree/backup/release-p6-before-sync-20260923) | `d7da3515e5d477122197639dc202c58584b5b21f` |
| 原 Latest P1 | [backup-v1.2.0-rc1-p1-20260923](https://github.com/ionize1080/Folio/releases/tag/backup-v1.2.0-rc1-p1-20260923) | `c2a425e798d72178c198c7e4b25de62ebc1b879a` |
| 更新前 P6 | [backup-v1.2.0-rc1-p6-20260923](https://github.com/ionize1080/Folio/releases/tag/backup-v1.2.0-rc1-p6-20260923) | `0b1cfa0cfb685f8d8bbd5ee04b0042574a85a8d5` |

两份备份 Release 各自复制原来的四个附件，下载后计算 SHA-256，上传后再次核对远端大小和摘要，并附原发布元数据及正文。备份标记为预发布且不作为 Latest。原分支、标签、P1 Release 和其他历史 Release 保留。

## 操作与验证顺序

1. 创建固定分支备份；从 P6 发布分支建立同步分支。
2. 更新当前文档，保留历史验证；检查合并相对程序基线只改变文档、发布脚本与工作流。
3. 同步分支 CI 运行 JS 单元、文档链接/格式和脚本语法检查，完成并核验两个独立 Release 备份。
4. 通过 PR 合入 main，保留完整开发历史；主线任务再次核验备份后才更新 P6 正文和 Latest。
5. P6 原四个附件与标签保持不变，另附本次文档 ZIP 及提交/校验 JSON；最终检查 Latest、标签和附件摘要。

具体自动化见 [同步工作流](../.github/workflows/sync-p6-main-20260923.yml) 与 [发布脚本](../scripts/sync-p6-release.py)。工作流只由本次同步工作流文件的变更触发，普通后续文档更新不会重复发布。实际任务状态见 [Actions](https://github.com/ionize1080/Folio/actions/workflows/sync-p6-main-20260923.yml)。

## 程序与文档对应

P6 的 portable、完整 source、validation 和 SHA256 仍对应已经通过 Windows 验收的程序提交 `0b1cfa0`。主线额外提交是文档与发布管理变更，不冒称重新构建后的程序。文档 ZIP 的配套 JSON 记录本次 main 提交、程序提交及文档包哈希。

GitHub 不允许预发布成为 Latest，因此 P6 取消 GitHub 的 Pre-release 标记，但版本名称仍为 **1.2.0 RC1-P6**。此处 Latest 只更新下载入口；段落拆分、空白/换行、复杂字体及平台验收边界仍按 [当前验证](VALIDATION.md) 公开。

## 需要回退时

- 代码：从对应备份分支建立恢复分支，通过普通 PR 恢复需要的文件；不要强推改写 main 历史。两个备份均保留完整提交历史。
- 下载入口：将仍然保留的 P1 Release 设为 Latest；将 P6 的正文和预发布状态按快照恢复。此步骤只在明确需要回退时执行。
- 附件：原 Release 的四份附件没有替换；如以后损坏，可从独立备份下载，按快照摘要核对后恢复。

这份文档记录本次操作的方案、基线和恢复入口；是否已执行成功以 GitHub 分支、Release 和对应 Actions 的最终状态为准。
