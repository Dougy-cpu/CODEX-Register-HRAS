# AGENTS.md

Guidance for AI agents working on this HR Analytics Summit checkout repository.

## Project

This repository is the HR Analytics Summit registration and checkout system.

- Event: HR Analytics Summit 2026
- Date: 3 September 2026
- Venue: 155 Bishopsgate, London
- Public registration domain: https://register.hranalyticssummit.com

The app handles public checkout, attendee management, admin tools, Stripe card payments, Stripe invoice payments, email delivery, invoice PDFs and admin reporting.

HRAS is a separate event brand from SWP Summit. Do not copy SWP colours, event text, URLs, dates, venue or Stripe labels into HRAS.

## Read First

Before changing files, read:

- `README.md`
- `replit.md`
- `artifacts/checkout/src/tokens.css`
- `artifacts/checkout/src/index.css`

Confirm the current Git branch before editing. Do not edit `main` unless the user explicitly asks for work to happen on `main`.

## Brand And UI Rules

- Preserve HRAS branding and colour system.
- Do not replace HRAS colours with SWP blue.
- Use the existing HRAS design language, tokens and CSS conventions.
- Customer-facing checkout should feel premium, calm, trustworthy and conversion-focused.
- Admin screens should feel clean, structured and efficient.
- Use `rounded-md` in Tailwind projects, or `border-radius: 6px` in plain CSS.
- Avoid special arrows and multiplication symbols in customer-facing copy and emails.
- Use plain text such as "x", "quantity", "Pay invoice online", "Manage attendees" and "Add PO number or update billing".

## Copy Rules

- Use UK English.
- Do not use em dashes.
- Keep HRAS event details, URLs and contact details intact.
- Add junk/spam folder reminders where appropriate for confirmation and invoice emails.

## Engineering Guardrails

Do not change any of the following unless explicitly requested:

- Stripe logic
- Invoice creation logic
- VAT logic
- Pricing, promo, group discount, quantity, pass eligibility or booking status logic
- Database schema
- API contracts
- Secrets, `.replit` or deployment configuration

Additional rules:

- Do not edit generated files by hand.
- Do not add dependencies without approval.
- Prefer small, focused changes.
- Improve one screen or flow at a time.
- Never edit `lib/api-client-react/src/generated/` or `lib/api-zod/src/` directly. Regenerate from `lib/api-spec/openapi.yaml` instead.
- Always preserve caught errors when rethrowing: `throw new Error(message, { cause: error })`.
- Keep checkout action bars stable and responsive. Previous responsive grid layouts caused overlapping buttons, so prefer a full-width stacked layout unless deliberately retested.

## Replit Notes

This project runs in Replit and is synced to GitHub manually.

If Replit reports `pnpm: command not found`, or dependencies such as `esbuild` or `vite` are missing after a reset:

1. Reinstall the Node.js 24 module through Replit's module/package management system.
2. Run `pnpm install` from the workspace root.

Do not fix Replit environment resets by editing `package.json`, `pnpm-workspace.yaml`, Vite config or workspace package imports.

## Validation

After frontend changes, run:

```bash
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm --filter @workspace/checkout build
```

After backend, API, email or invoice changes, also run:

```bash
pnpm --filter @workspace/api-server build
```

Before pushing to GitHub, run:

```bash
pnpm run format:write
```

Then use the repository's branch and PR workflow.

## Final Response Requirements

Final summaries should include:

- Changed files
- What changed visually or behaviourally
- Checks run
- Any risks or manual QA steps
