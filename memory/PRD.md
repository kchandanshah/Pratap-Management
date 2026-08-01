# PRATAP ENTERPRISE LEDGER WORKS — PRD

## Original Problem Statement
Build a responsive Business Expense, Staff Salary Advance, and GST/ITR Tax Management app.
- Daily expense logger with dynamic categories (defaults + custom)
- Staff advance & salary ledger with month-end net-payable calc
- Tax Compliance Register (GST + ITR) with challan numbers
- Dashboard: Total Spend, Petrol, Staff Advances, Cash vs UPI, Category Breakdown chart

## User Choices
- Auth: Emergent-managed Google Login (first user = owner, rest = accountant)
- Currency: INR (₹)
- Roles: Owner + Accountant
- Data Export: CSV enabled (expenses + tax register)
- Design: Swiss / High-Contrast finance archetype (Cabinet Grotesk + IBM Plex Mono)

## Architecture
- Backend: FastAPI + Motor (Mongo), /api prefix, session-cookie auth
- Frontend: React 19 + Shadcn UI + Recharts + Sonner
- MongoDB collections: users, user_sessions, categories, employees, expenses, tax_entries

## Data Models
- User: user_id, email, name, picture, role (owner/accountant)
- Category: category_id, name, color, is_default
- Employee: employee_id, name, base_salary, role_title, active
- Expense: expense_id, date, vendor, category, amount, payment_mode (Cash/UPI-Bank), notes, employee_id (for advances)
- TaxEntry: tax_id, date, tax_type (GST/ITR Advance Tax), period, challan_number, amount, payment_mode, notes

## Implemented (2026-02)
- Google OAuth flow via Emergent Auth (session cookie + Bearer fallback)
- CRUD: categories, employees, expenses, tax entries
- Salary Ledger aggregation per month (advances → net_payable)
- Dashboard aggregation with cash/upi split and category breakdown including custom categories
- CSV exports for expenses and tax entries
- Role-based gating: owner can delete + add employees; accountant can create expenses/tax entries
- Frontend pages: Login, Dashboard, Expenses (with + Add Custom Category dialog), Staff Ledger, Tax Register
- Design: Swiss dense grid, 1px borders instead of shadows, mono numerals

## Backlog (P1/P2)
- P1: Employee edit dialog, mark employee as "paid" for the month
- P1: Date range filter on Expenses + search by vendor
- P1: Owner "User Management" page (upgrade accountant to owner)
- P2: PDF-style monthly salary payslip
- P2: Recurring expenses & advance repayment tracking
- P2: WhatsApp share for challan receipts

## Iteration 2 (2026-02) — Feature additions
- Expenses: Date-range filter with presets (Today, This week, This month, Last month, This quarter, This FY, All time) + custom From/To.
- Staff Ledger: Expandable rows showing each Salary Advance. Mark Repaid / Undo action; ledger + dashboard auto-adjust net-payable and total outstanding advances.
- Team page: Owner-only. Promote / Demote / Remove teammates with server-side "at least one owner" guard and self-remove block.
