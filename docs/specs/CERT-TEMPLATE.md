# CERT-NNN — Certification Record (template)

Copy to `CERT-NNN-{slug}.v1.md`. Do not leave `NNN` / placeholders in a filed record.

| Field | Value |
|-------|-------|
| **ID** | CERT-NNN |
| **Version** | v1 |
| **Status** | `draft` \| `final` |
| **Date** | YYYY-MM-DD |
| **Certifier** | Technical lead |
| **Builder** | (name / agent / PR) |
| **Spec under test** | `{ID} v{N}` → exact filename |
| **Git ref** | commit SHA or PR URL (when available) |

---

## 1. Verdict

| Verdict | Meaning |
|---------|---------|
| **pass** | All non-deferred requirement IDs `met` |
| **pass-with-waivers** | All High/critical IDs `met`; listed waivers only on lower IDs |
| **fail** | One or more non-waived required IDs `missing` or `partial` |

**Final verdict:** _pending_

---

## 2. Requirement matrix

Copy IDs from the locked spec. One row per ID.

| ID | Result | Evidence (file/test/manual note) | Notes |
|----|--------|----------------------------------|-------|
| T1 | met / partial / missing / waived | | |
| … | | | |

---

## 3. Verification checklist

Reproduce the locked spec’s manual checklist; mark each item.

- [ ] …

---

## 4. Waivers

| ID | Reason | Expiry / follow-up spec |
|----|--------|-------------------------|
| | | |

---

## 5. Regressions / ARCH compliance

| Check | Result |
|-------|--------|
| ARCH-001 A4 (no shell spawn) | |
| ARCH-001 A6 (no new runtime deps) | |
| ARCH-001 A2 (store-based trap) | |

---

## 6. Certifier notes

(Free-form, short. Gaps that need `vN+1` go here as recommended amendments — not silent scope creep.)
