# AGENTS.md

## Purpose

This file defines the rules AI coding agents must follow when working on this project.

Read this file before making changes.

Also read:

- PROJECT.md
- ARCHITECTURE.md
- SECURITY.md
- WORKFLOW.md
- TODO.md

when relevant to the task.

---

## Core Principles

1. Understand before modifying.
2. Prefer the smallest change that solves the problem.
3. Do not introduce unnecessary dependencies or architectural changes.
4. Do not assume missing requirements.
5. Clearly distinguish facts from assumptions.
6. Preserve existing behavior unless the requested task requires changing it.
7. Do not silently change unrelated code.

---

## Before Making Changes

Before editing code:

1. Inspect the relevant files.
2. Understand the existing implementation.
3. Check PROJECT.md and ARCHITECTURE.md.
4. Check TODO.md for current project state.
5. Check SECURITY.md if the task involves:
   - authentication
   - authorization
   - payments
   - secrets
   - databases
   - external APIs
   - user data
6. Identify the minimum files that need modification.

For significant changes, briefly state the intended approach before implementation.

---

## Implementation Rules

Prefer:

- existing project conventions
- existing dependencies
- simple implementations
- type-safe code
- reusable existing utilities
- minimal diffs

Avoid:

- unnecessary rewrites
- speculative abstractions
- unrelated refactoring
- duplicate utilities
- adding dependencies without a clear reason
- changing architecture without justification

---

## Validation

After making changes, run the relevant available checks.

Examples:

- tests
- type checking
- lint
- build
- formatting
- relevant application-specific checks

Do not claim a check passed unless it was actually executed successfully.

If a check cannot be run, explicitly state why.

---

## Git Rules

Before completing significant work:

1. Review the diff.
2. Check for accidental changes.
3. Check for secrets.
4. Confirm only relevant files changed.

Never perform the following without explicit permission:

- force push
- history rewriting
- destructive reset
- branch deletion
- tag deletion
- destructive cleanup of untracked files

Do not commit secrets.

---

## Documentation

Update documentation when implementation changes make existing documentation inaccurate.

Update:

- ARCHITECTURE.md for architectural changes
- TODO.md when task status changes
- docs/DECISIONS.md for important technical decisions
- docs/HANDOFF.md when handing work to another agent/session

Do not update documentation merely to create noise.

---

## User Authority

The project owner has final authority.

Explicit user instructions override project defaults unless they would cause an unsafe or clearly destructive action.

When requirements conflict, identify the conflict instead of silently choosing one.

---

## Project-Specific Rules

- 日本語で結論から簡潔に報告する。
- 実装状況はTODO.md、判断はdocs/DECISIONS.md、再開情報はdocs/HANDOFF.mdへ記録する。
- REVIEW.mdは監査時点の記録として保持する。
- React + Vite + Three.js。Next.jsへ移行しない。
- 進行データを扱う処理は破損・拒否・旧版・数量保存を検証する。
- 公開・購入・外部送信・ユーザーデータ削除を無断で行わない。