# ขอบเขตการพัฒนาและข้อจำกัด

เทียบข้อกำหนดหลักและ Version 3 ที่แนบใน repository รุ่นนี้เป็น implementation ที่ใช้งานและทดสอบได้ ไม่ใช่การรับรองว่ารายละเอียดทุกข้อใน spec เสร็จครบหรือพร้อมจ่ายเงินเดือนจริงโดยไม่ตรวจรับ

| โมดูล | สิ่งที่ทำแล้ว |
|---|---|
| Workspace / บริษัท | tenant isolation, สลับบริษัทตามสิทธิ์, บริษัท/สาขา/แผนก/ตำแหน่ง/ระดับ, ความสัมพันธ์บริษัทและป้องกันวงจร, สรุปหลายบริษัทตามสิทธิ์ |
| Users / Permissions | workspace login, invitations หลายบริษัท, scoped roles/custom roles, employee/manager self/team scope, reset/revoke session, suspension/unlock, last-admin guard |
| บุคลากร | people แยก employment, รหัสพนักงาน, draft/active/status, personal/contact/address/bank/emergency data, encryption/masking, ประวัติการจ้างและค่าตอบแทนมี effective date/reason, soft delete, ประสบการณ์ส่งแล้วแก้/ลบไม่ได้ |
| Employee self-service | โปรไฟล์/คำขอแก้ไขโดย HR อนุมัติอิสระ, ไฟล์แนบ, ดูสลิปตัวเอง, รายงานข้อมูลพนักงานพิมพ์เป็น PDF ผ่าน browser |
| Time / OT | schedule days/assignments ไม่ทับช่วง, holidays, clock in/out, manual corrections มี audit, overtime request/review ไม่ทับช่วง |
| Leave | policy eligibility/service, working days/holidays, full/half/hour minute windows, pending overlap/reservation, approval manager + HR, staffing rules, cancel reversal, privacy calendar, annual/monthly/daily accrual/carry/expiry และ ledger ป้องกัน job ซ้ำ |
| Payroll | cycle dates/frequency, version snapshots, effective compensation/proration, daily/hourly attendance, allowances/OT/unpaid leave/adjustments, statutory settings validation, separate prepare/review/approve, return/review history, locked approved cycles, payslips, paid/closed/revoked |
| Announcements | draft/schedule/publish/expire, company targets, group ALL audiences, revision/audience snapshots, per-company readership, opens/acknowledgement, no creator notification, deduplicated delivery, WebSocket scope/reconnect/session revocation |
| Reports / operations | employee/attendance/audit CSV, formula-injection escaping, scoped export jobs/reason/expiry, audit append-only, SQL migrations, backup/restore integrity checks |
| UI | responsive desktop/table/mobile cards, bottom navigation, Thai fonts bundled, TH/EN navigation, dark mode, keyboard modal, delete confirmation, repeatable earnings rows, loading/error/empty states |

## รายการที่ยังต้องต่อยอด/ตรวจรับ

- ภาษีแบบ progressive ยังไม่คำนวณประมาณการภาษีไทยทั้งปี/แบบยื่นภาษีอัตโนมัติ ต้องใช้ยอดหักของงวดที่ฝ่ายเงินเดือนตรวจแล้วใน tax profile; fixed/exempt รองรับ ไม่ hard-code อัตรากฎหมายไว้ ต้องกำหนดอัตรา/cap/effective/source ที่ตรวจรับก่อนใช้จริง
- อุปกรณ์สแกนเวลา/นำเข้า CSV attendance, offline clock, กะข้ามเที่ยงคืน, GPS และชีวมิติยังไม่มี integration
- หน้าปฏิทินลาเป็นรายการช่วงวันที่/เดือน ยังไม่มี weekly/hourly drag-grid; workflow อนุมัติใช้ manager + HR ยังไม่มีเครื่องมือออกแบบหลายขั้นแบบ arbitrary routing
- การเปลี่ยน employment/compensation ผ่านฟอร์มรองรับ effective date ถึงวันนี้ การตั้งเวลาปรับตำแหน่ง/เงินเดือนในอนาคตยังไม่มี worker สำหรับ activate
- การจัดการตารางทำงานแบบแก้ไขรายวันทั้งหมด/คืนสถานะ master data และบาง advanced policy ต้องใช้ API; UI สำหรับ policy บางส่วนยังเป็นแบบพื้นฐาน
- การเชิญ/reset แสดงลิงก์ให้ admin ไม่มีบริการส่งอีเมล/SMS หรือ SSO/MFA
- Group announcements รองรับ ALL recipients ของบริษัทที่เลือก; target แบบ department/role/user ใช้ระดับบริษัท
- Export job บันทึก scope/filter แต่สร้าง CSV จากข้อมูลปัจจุบันตอนดาวน์โหลด ยังไม่ freeze payload ณ เวลาขอ; consolidated report เป็น JSON/UI ยังไม่มี consolidated CSV/Excel/PDF
- Reports ยังไม่ครอบคลุม template เอกสาร/ใบจ่ายธนาคาร/SSO/tax form ทั้งหมดของ spec; employee PDF คือ print layout ของข้อมูลหลัก ไม่ใช่ complete document pack ทุกไฟล์แนบ
- Idempotency เก็บผลสำเร็จหลัง operation เสร็จ ป้องกัน HTTP retry ทั่วไป แต่ยังไม่รับรอง exactly-once เมื่อ process crash ในช่องว่างก่อนบันทึกผล; ต้องออกแบบ transaction/outbox เพิ่มก่อนใช้งาน distributed
- ใช้ SQLite single instance และ local protected file storage ไม่มี object-storage adapter, distributed workers, malware scanning, key rotation หรือ automatic retention/deletion pipeline
- ระบบหลายภาษาครอบคลุม navigation และส่วน UI หลัก ข้อความ validation/domain บางส่วนยังเป็นอังกฤษ/ไทยตามข้อความ API
- การทดสอบ browser ครอบคลุม Chromium + desktop/mobile viewport ไม่ครอบคลุม Safari/Firefox หรือ screen reader; ยังไม่ทำ load/penetration/UAT/production deployment

ก่อนนำข้อมูลจริงเข้า ควรทดสอบ workflow ของแต่ละบริษัท การคำนวณเงินเดือนเทียบงวดจริง สิทธิ์ผู้ใช้งาน การสำรองไฟล์พร้อมฐานข้อมูล และกฎด้านกฎหมาย/บัญชีกับผู้รับผิดชอบขององค์กร
