# WORKFLOW.md

## Standard Development Workflow

Use this workflow unless the task requires something different.

---

## 1. Understand

Read the task.

Inspect:

- AGENTS.md
- PROJECT.md
- relevant source files
- relevant documentation

Do not start modifying files before understanding the existing implementation.

---

## 2. Investigate

Identify:

- affected components
- relevant dependencies
- existing implementation
- potential side effects
- security implications

For bugs, attempt to identify the root cause before changing code.

---

## 3. Plan

Determine the smallest reasonable implementation.

For significant work, define:

- files to modify
- expected behavior
- validation method

Avoid unnecessary scope expansion.

---

## 4. Implement

Follow existing conventions.

Prefer:

small change
→ test
→ next change

over:

large rewrite
→ debug everything afterward

---

## 5. Validate

Run relevant checks.

Possible checks:

- unit tests
- integration tests
- typecheck
- lint
- build
- manual verification

Record failures accurately.

---

## 6. Review

Review the final diff.

Check for:

- accidental changes
- debugging code
- commented-out code
- secrets
- unnecessary dependencies
- regressions
- security problems

---

## 7. Document

When appropriate:

- update TODO.md
- update ARCHITECTURE.md
- record important decisions in docs/DECISIONS.md
- update docs/HANDOFF.md

---

## Bug Investigation Workflow

For bugs:

Symptom
↓
Reproduce
↓
Collect evidence
↓
Form hypothesis
↓
Test hypothesis
↓
Identify root cause
↓
Implement minimal fix
↓
Verify fix
↓
Check regression risk

Do not randomly modify multiple components hoping the bug disappears.

---

## Handoff Workflow

Before handing the project to another agent/session:

Update docs/HANDOFF.md with:

- current objective
- completed work
- changed files
- validation performed
- unresolved issues
- next recommended action

## このゲームの作業単位

TODO.mdのP番号順に、仕様記録→最小実装→回帰検証→進捗更新を行う。完了／実装済み未検証／未着手を区別する。
保存などデータに関わる変更は成功だけでなく失敗時に元の進行が保たれることも確認する。

## 不具合・改善要望の受付（認識だけの依頼も含む）

1. そのターン中にTODO.mdへIDを付けて記録する。既存項目があれば追記し、重複を作らない。
2. 報告日、対象環境、報告内容、発生手順、期待する挙動、再現確認・原因調査の状況、対応状態を記載する。不明な情報は未確認と明記する。
3. ユーザー報告だけで再現済み・原因確定・修正済みとは扱わない。「今回は認識だけ」なら未修正・調査未着手として残し、再現操作やソース変更を行わない。
4. docs/HANDOFF.mdに項目への参照を残し、ユーザーには記録先へのリンクを報告する。Markdownへの記録前に「把握した」とだけ返して終わらない。
