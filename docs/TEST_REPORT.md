# รายงานทดสอบ

วันที่ 11 ตุลาคม 2026 — ทดสอบ source ชุดเดียวกับ release commit นี้ใน environment ท้องถิ่น

| การตรวจ | ผล |
|---|---|
| TypeScript `tsc --noEmit` | ผ่าน |
| Bun API / transport / leave accrual | 47 passed, 0 failed, 173 assertions |
| Vite production build | ผ่าน; React/Tailwind build สำเร็จ |
| Chromium browser | ผ่าน; ไม่มี uncaught page errors |
| Desktop 1440×1000 | login, dashboard/data loading, employee create, delete confirmation, employee report print/PDF |
| Mobile 390×844 | cards, bottom navigation/full menu, hidden table search, ไม่มี horizontal overflow |
| UI settings | Thai font loaded, dark mode, English locale |
| Backup / restore | SQLite integrity + foreign keys ผ่านหลัง restore |

## Regression coverage

ตรวจ tenant/company boundaries แม้ทราบ object ID, self/manager scopes, payroll permission restrictions, lookup rollback เมื่ออ้างบริษัทอื่น, encrypted sensitive data/masked API, CSRF origin checks, audit UPDATE/DELETE rejection, reset/session revocation

ตรวจ schedule overlap, leave weekends/holidays/hour windows/pending overlap/balance, approval ledger + cancel reversal, monthly/daily accrual + min service + carry cap + repeated jobs, immutable experiences, profile changes independent approval

ตรวจ payroll settings prerequisites, cross-company employees, compensation calculation reconciliation, recalculation versions, preparer/reviewer/approver separation, locked cycles, self-only payslip access

ตรวจ company/group announcement isolation, creator excluded, recipient privacy, unique deliveries and repeatable scheduling, per-company opens, scoped exports, HTTP idempotency, dual employment preserved history, company relationship cycles/custom roles

ทดสอบ HTTP/WebSocket จริง: scoped notification push, suspended/revoked session closure, upload PDF magic validation และปฏิเสธดาวน์โหลดไฟล์ข้ามบริษัท

## หลักฐาน UI

![Desktop dashboard](qa/dashboard-desktop.png)

[Mobile employees screenshot](qa/employees-mobile.png)

Browser script สร้าง screenshots และ employee PDF ใน `test-results/` ซึ่งไม่เก็บข้อมูลทดสอบ/ฐานข้อมูล/secret ขึ้น Git

## ข้อจำกัดของผลทดสอบ

อัตราประกันสังคม/ภาษีใน test เป็น fixture เพื่อทดสอบสูตร ไม่ใช่อัตราทางกฎหมาย production ผล local test ไม่ใช่ผล CI บน GitHub และไม่ใช่ UAT, load test, security audit หรือการรับรอง production อ่าน [COVERAGE](COVERAGE.md) สำหรับงานขั้นสูงที่ยังไม่ครบ

## Seed regression checks

เพิ่ม `tests/seed.test.ts` 4 กรณี: ตรวจความสัมพันธ์ foreign keys/ตัวเลขเงินเดือนและสลิป, รันซ้ำไม่เพิ่มข้อมูลหรือ reset fixture, employee login/self scope/cross-company denial และ CLI ปฏิเสธไฟล์ฐานข้อมูลเดิม/production พร้อมลบ staging file เมื่อ seed ไม่สำเร็จ

## Dependency installation regression

สร้าง `package-lock.json` ใหม่ในโฟลเดอร์ว่างโดยไม่ใช้ node_modules จาก workspace อื่น และเพิ่ม `bun.lock` ที่อ้างแพ็กเกจจาก registry ทดสอบ `bun install` (migrate จาก npm lockfile) และ `bun install --frozen-lockfile` ในสองโฟลเดอร์ใหม่ผ่าน ตรวจว่าไม่มี `file:`/local path/link dependency ใน lockfiles และรันทดสอบ 47 กรณี, TypeScript และ production build ด้วย dependency ชุดใหม่ผ่าน แก้วันที่ใน attendance test ให้ใช้ UTC เพื่อไม่ขึ้นกับ timezone เครื่อง

Chromium smoke test ผ่านอีกครั้งด้วย dependency จาก clean install: login/data loading, employee create/delete, print PDF, mobile navigation/no overflow, dark mode และ English ไม่มี page runtime errors
