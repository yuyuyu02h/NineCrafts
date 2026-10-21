# SECURITY.md

## Purpose

This file defines security requirements for this project.

Security-sensitive changes require additional care and validation.

---

## Secrets

Never expose or commit:

- passwords
- API keys
- private keys
- access tokens
- refresh tokens
- session secrets
- cookies
- database credentials
- service-role credentials
- webhook signing secrets
- .env contents

Never print secrets merely for debugging.

Use environment variables or the project's approved secret-management mechanism.

---

## Environment Files

Treat files such as these as sensitive:

.env
.env.local
.env.production
.env.development

Before committing changes, verify that sensitive environment files are ignored appropriately.

Never copy production credentials into documentation.

---

## User Input

Treat all external input as untrusted.

Validate where appropriate:

- IDs
- URLs
- filenames
- form fields
- JSON
- query parameters
- headers
- uploaded files
- webhook payloads
- external API responses

Do not rely solely on client-side validation.

---

## Database

Prefer:

- parameterized queries
- least-privilege credentials
- access-control policies
- reversible migrations
- explicit validation

Avoid:

- constructing raw queries from untrusted input
- unnecessarily broad permissions
- disabling security policies globally
- destructive schema operations without approval

---

## Authentication

Do not weaken authentication controls for convenience.

Do not expose authentication tokens to unauthorized clients.

Do not implement custom cryptography when established libraries or platform functionality are appropriate.

---

## Authorization

Authentication does not imply authorization.

Verify that users are authorized to access or modify the requested resource.

Pay particular attention to:

- admin routes
- object ownership
- API endpoints
- database policies

---

## Web Security

Consider relevant risks including:

- XSS
- CSRF
- SSRF
- SQL injection
- command injection
- path traversal
- insecure direct object references
- open redirects
- unsafe file uploads

Apply mitigations according to the actual architecture rather than mechanically.

---

## External Services

Never trust external callbacks solely because they reached an endpoint.

Verify signatures or authentication when the provider supports it.

Use least-privilege credentials.

---

## Payments

If this project handles payments:

- never trust client-supplied prices
- verify payment status server-side
- verify webhook signatures
- prevent duplicate processing where applicable
- keep secret credentials server-side

---

## Destructive Operations

Require explicit user approval before:

- deleting production data
- dropping tables
- destructive migrations
- deleting infrastructure
- rotating credentials
- modifying production access controls
- force pushing
- rewriting Git history

---

## Security Findings

If a security problem is discovered:

1. Describe the issue.
2. Describe its impact.
3. Identify affected components.
4. Recommend the smallest safe fix.
5. Avoid exposing sensitive exploit details unnecessarily.
6. Record important unresolved issues in TODO.md.

---

## Project-Specific Security Requirements

- 現在は単独ブラウザ内ゲーム。サーバー認可やクラウド保存は導入していない。
- IndexedDB由来でも保存データは信頼しない。バージョン、座標、配列サイズ、アイテムIDと数量を検証する。
- 破損・非対応保存を自動で削除・上書きしない。データの外部送信はしない。
- セーブJSONやストレージ内容へ秘密情報を含めない。