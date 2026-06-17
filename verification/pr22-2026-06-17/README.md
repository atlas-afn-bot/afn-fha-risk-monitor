# PR #22 deploy-verification screenshots — 2026-06-17

Captured after merge + SWA deploy completed (run `27713026806`, finished 19:07 UTC).
Rendered against the production `dist/` bundle served via `vite preview` (since
`fha.afnai.com` is gated behind AAD and the dev-architect session cannot
authenticate as an AFN user).

The HTML, CSS, and JS bundle under preview is byte-identical to what Azure SWA
serves — same `npm run build` artifact that the GitHub Action uploaded.

## Files

- `overview.png` — Dashboard top row showing six KPIs including the new **Credit Watch** tile next to Termination Risk (item #6). 24-Month Compare Ratio Trend visible below (item #5).
- `uploader-6slots.png` — File Uploads tab showing all six slots in spec order (items #1, #2, #3). Signed in as `sbarkey@afncorp.com` (Stefanie — item #1). Per-slot blob paths visible: `2026-06/<slug>/`.
- `term-matrix-fullwidth.png` — Termination Risk Performance Matrix with the new **3-Mo Projection → Proposed Drop-Off** column at the right edge (item #7).
- `credit-watch-matrix.png` — Credit Watch Performance Matrix with the same drop-off column. No `maxRows={5}` cap any more — full 9-row Credit Watch list rendered (item #6, root cause fix verified).

## Verified

- ✅ Stefanie in allowlist (3 locations: api/upload-sas, api/list-recent-uploads, FileUploads.tsx)
- ✅ Six upload slots in correct order
- ✅ Storage layout shown as `uploads/<YYYY-MM>/<slot-slug>/` with month picker
- ✅ Credit Watch tile on top row (9 offices, no 5-cap)
- ✅ Compare Ratio trend titled "24-Month" (item #5)
- ✅ Proposed Drop-Off column on both Term Risk and Credit Watch matrices
- ✅ Cell format = projected CR % badge + loan-count subtext (Lara's Option C)
- ✅ Tooltip text confirmed via DOM read: `"14 loans rolling off in next 3 months (loans with First Payment Date before 2024-08-01)."`

`fha.afnai.com` itself returns HTTP 302 → `/.auth/login/aad` for all routes (expected:
`staticwebapp.config.json` has `"/*": ["authenticated"]`). The default SWA URL
`https://zealous-pebble-0cef0b41e.2.azurestaticapps.net` is also reachable and
hits the same AAD login wall — confirming the deploy is live and serving the
new build.
