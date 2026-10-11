Here is the result of "fetch" for the Page with URL https://app.notion.com/p/3f2f08f523368197a053fb8f4c606a22 as of 2026-10-08T04:57:21.016Z:
<page url="https://app.notion.com/p/3f2f08f523368197a053fb8f4c606a22" icon="🧩">
<ancestor-path>
<parent-page url="https://app.notion.com/p/3f2f08f5233681c399a9e9ce593e500a" title="HRM System Design"/>
</ancestor-path>
<properties>
{"title":"HRM System Design Version 3"}
</properties>
<iconMetadata>{"type":"emoji","emoji":"🧩"}</iconMetadata>
<content>
<callout icon="🧭" color="blue_bg">
	**เอกสารสรุปการออกแบบระบบ HRM Version 3**
	สถานะ: Functional UX และ Database Architecture พร้อมใช้วางแผนพัฒนา
	ปรับปรุงล่าสุด: <mention-date start="2026-10-07"/>
	สรุปจาก <mention-page url="https://app.notion.com/p/3f2f08f5233681c399a9e9ce593e500a">HRM System Design</mention-page>
</callout>
<table_of_contents/>
# 1. บทสรุปผู้บริหาร
HRM System Version 3 เป็นระบบบริหารทรัพยากรมนุษย์แบบ Multi-company สำหรับบริษัทขนาดเล็กถึงกลางและกลุ่มบริษัท ผู้ใช้จัดการบุคลากร เวลา การลา เงินเดือน ประกาศ สิทธิ์ และ Audit Log จากระบบเดียว โดยข้อมูลแยกตาม Tenant และบริษัทอย่างชัดเจน
หลักการสำคัญ:
1. **ใช้งานง่าย** — งานประจำของ HR และพนักงานเข้าถึงได้รวดเร็ว
2. **รองรับหลายบริษัท** — Login เดียวสลับบริษัทได้โดยข้อมูลไม่ปะปน
3. **ตรวจสอบย้อนหลังได้** — ข้อมูลสำคัญมี Version, History และ Audit Log
4. **แยกหน้าที่ชัดเจน** — ผู้จัดทำ ผู้ตรวจสอบ และผู้อนุมัติมีสิทธิ์ต่างกัน
5. **ปลอดภัยโดยโครงสร้าง** — Backend ตรวจ Tenant, Company, Role และ Scope
6. **พร้อมขยาย** — รองรับ Desktop, Tablet, Mobile, ไทย/อังกฤษ และ Light/Dark mode
# 2. เป้าหมายและขอบเขต
## 2.1 เป้าหมาย
- สร้างทะเบียนพนักงานที่เชื่อถือได้และเก็บประวัติย้อนหลัง
- ลดงานเอกสารด้วย Workflow และการอนุมัติ
- เชื่อมเวลา การลา และค่าตอบแทนเข้าสู่ Payroll
- ให้พนักงานบริการตนเองโดยไม่เปิดเผยข้อมูลเกินสิทธิ์
- รองรับกลุ่มบริษัทโดยไม่ต้องสร้างบัญชีผู้ใช้ซ้ำ
- แสดงงานที่ต้องดำเนินการและรายงานรวมแก่ผู้บริหาร
- รองรับการตรวจสอบด้านความปลอดภัยและการเงิน
## 2.2 ขอบเขต Version 3
- Multi-company และ Company switcher
- Employee master, การจ้างงาน และค่าตอบแทน
- Attendance, Work schedule และ OT
- Leave policy, Balance และ Approval
- Payroll รายวัน รายสัปดาห์ รายสองสัปดาห์ และรายเดือน
- Payslip และ Employee self-service
- Announcement, Notification และ Read activity
- User, Role, Permission และ Scope
- Audit Log, Export และ Revision history
- Responsive UI, ไทย/อังกฤษ และ Light/Dark mode
## 2.3 นอกขอบเขตปัจจุบัน
Recruitment, Performance appraisal, Learning, Expense reimbursement, Accounting journal, การโอนเงินธนาคารจริง, Native mobile application และ Payroll หลายสกุลเงิน
# 3. สถาปัตยกรรม Multi-company
**Tenant / Workspace → Company → Branch → Department → Employee record**
- Tenant คือพื้นที่ข้อมูลสูงสุดของกลุ่มบริษัท
- Company คือบริษัทหรือนิติบุคคลที่มีภาษี Payroll และนโยบายของตนเอง
- People คือตัวบุคคลร่วมภายใน Tenant
- Employee record คือการจ้างงานของบุคคลในบริษัทหนึ่ง
- User คือบัญชีเข้าสู่ระบบที่เข้าถึงได้หลายบริษัท
## 3.1 Company switcher
- อยู่ด้านบน Sidebar และแสดงเฉพาะบริษัทที่มีสิทธิ์
- รองรับค้นหา ปักหมุด และบริษัทเริ่มต้น
- เมื่อเปลี่ยนบริษัทให้โหลดเมนู สิทธิ์ Dashboard และ Filter ใหม่
- เตือนเมื่อ Form ยังไม่บันทึก
- Route, API, Cache, WebSocket และ File ต้องมี Company context
- ผู้ใช้ที่มีบริษัทเดียวสามารถซ่อน Switcher
## 3.2 บุคคลเดียวทำงานหลายบริษัท
บุคคลหนึ่งมี `people` หนึ่งรายการ แต่มี `employees` หลายรายการได้ แต่ละรายการมีรหัสพนักงาน เงินเดือน แผนก ตำแหน่ง วันเริ่มงาน การลา และ Payroll แยกกัน
รองรับ Transfer, Secondment และ Dual employment โดยห้ามเปลี่ยน Company ID ของ Employee record เดิมเพื่อย้ายบริษัท ต้องสร้าง Employee record ปลายทางและรักษาประวัติเดิม
# 4. ผู้ใช้งานและสิทธิ์
<table fit-page-width="true" header-row="true">
<tr>
<td>บทบาท</td>
<td>ขอบเขต</td>
<td>ความสามารถ</td>
</tr>
<tr>
<td>Tenant Admin</td>
<td>ทุกบริษัท</td>
<td>ตั้งค่ากลุ่มบริษัท ผู้ใช้ สิทธิ์ และรายงานรวม</td>
</tr>
<tr>
<td>Group HR</td>
<td>หลายบริษัทตามที่มอบหมาย</td>
<td>บริหารพนักงานและรายงานข้ามบริษัท</td>
</tr>
<tr>
<td>Company Admin / HR</td>
<td>บริษัทที่กำหนด</td>
<td>บุคลากร เวลา การลา Payroll และประกาศ</td>
</tr>
<tr>
<td>Manager</td>
<td>ทีมและแผนก</td>
<td>ตรวจข้อมูลทีมและอนุมัติคำขอ</td>
</tr>
<tr>
<td>Employee</td>
<td>ข้อมูลตนเอง</td>
<td>Self-service เวลา การลา สลิป และประกาศ</td>
</tr>
</table>
Backend ต้องตรวจ Tenant, Company access, Role, Permission และ Scope ทุกครั้ง ห้ามใช้การซ่อนปุ่มใน Frontend เป็นการควบคุมสิทธิ์เพียงอย่างเดียว
# 5. โครงสร้างเมนู
<table fit-page-width="true" header-row="true">
<tr>
<td>เมนู</td>
<td>งานหลัก</td>
</tr>
<tr>
<td>หน้าหลัก</td>
<td>KPI, งานรออนุมัติ, สถานะทีม และกิจกรรมล่าสุด</td>
</tr>
<tr>
<td>บริษัท</td>
<td>บริษัท สาขา แผนก ตำแหน่ง ระดับงาน และความสัมพันธ์บริษัท</td>
</tr>
<tr>
<td>บุคลากร</td>
<td>เพิ่ม แก้ไข ค้นหา ประวัติ และย้ายบริษัท</td>
</tr>
<tr>
<td>เวลาทำงาน</td>
<td>เข้า–ออก กะ OT ความผิดปกติ และคำขอแก้ไข</td>
</tr>
<tr>
<td>การลา</td>
<td>ปฏิทิน ยอดคงเหลือ Policy และ Approval</td>
</tr>
<tr>
<td>ค่าตอบแทน</td>
<td>สร้างรอบ คำนวณ ตรวจสอบ อนุมัติ และสลิป</td>
</tr>
<tr>
<td>ประกาศ</td>
<td>สร้าง ตั้งเวลา กำหนดผู้รับ และติดตามการอ่าน</td>
</tr>
<tr>
<td>ผู้ใช้และสิทธิ์</td>
<td>เชิญ ระงับ Role, Permission และ Company access</td>
</tr>
<tr>
<td>Audit Log</td>
<td>ค้นหา Diff, Request ID และ Export history</td>
</tr>
</table>
Logout อยู่ลำดับสุดท้ายของ Sidebar หรือเมนูเพิ่มเติม
# 6. แนวทาง UX/UI ร่วม
- Sidebar คงตำแหน่งบน Desktop และ Bottom navigation บน Mobile
- ตารางเปลี่ยนเป็น Card list บน Mobile
- Detail drawer เปลี่ยนเป็น Full-screen sheet บน Mobile
- Form แบ่ง Section/Step และเตือนข้อมูลที่ยังไม่บันทึก
- ปุ่มหลักอยู่มุมขวาบนหรือ Sticky footer
- น้ำเงินสำหรับงานหลัก เขียวสำหรับสำเร็จ ส้มสำหรับเตือน แดงสำหรับปิดกั้น
- สีต้องมี Icon และข้อความกำกับ
- รองรับ Loading, Empty, Validation, Error, Retry, Success และ Permission denied
- รองรับภาษาไทย/อังกฤษ, Light/Dark mode และ WCAG AA
- Touch target อย่างน้อย 44 × 44 px และใช้งานด้วย Keyboard ได้
# 7. ข้อกำหนดรายโมดูล
## 7.1 Dashboard
**Preview**
![](notion-file-block://421869cc-7023-4f27-bef8-3097e004b141/59345677-5c63-4027-8626-877d7f396864?space_id=c11f08f5-2336-819d-815f-000329bbe038&name=hrm-dashboard.png)
- KPI พนักงาน สถานะวันนี้ งานรออนุมัติ และ Payroll ที่ต้องตรวจ
- ประกาศล่าสุด กิจกรรม และคำเตือน
- Filter บริษัท สาขา แผนก และวันที่
- Consolidated view เฉพาะผู้มีสิทธิ์
- Summary เชื่อมไปยังรายการต้นทางและรักษา Filter
## 7.2 Company Administration
- จัดการบริษัท สาขา แผนก ตำแหน่ง และระดับงาน
- กำหนดบริษัทแม่ บริษัทย่อย และบริษัทในเครือ
- ตั้งค่าเขตเวลา ภาษา Payroll และนโยบายรายบริษัท
- ปิดใช้งานแทนการลบบริษัทที่มีธุรกรรม
- แสดงผลกระทบก่อนปิดใช้งานและบันทึก Audit Log
## 7.3 Employee Management
### Preview — รายชื่อบุคลากร
![](notion-file-block://709b6d28-b099-494b-81a3-3a550d47d4df/3c105079-256b-4411-9373-1601902cb5d4?space_id=c11f08f5-2336-819d-815f-000329bbe038&name=hrm-employee-directory.png)
### Preview — เพิ่มพนักงาน
![](notion-file-block://2fec52bc-f10a-4ebb-8050-16a1f1fbed41/1212379a-aee2-43ab-8286-ec892c7d768e?space_id=c11f08f5-2336-819d-815f-000329bbe038&name=hrm-add-employee.png)
### Preview — เพิ่มข้อมูลการจ้างงานและค่าตอบแทน
![](notion-file-block://1ceead7d-8b00-4f3d-8fbe-aefdfdbe6c87/614073b1-c815-4823-90ac-df5ad3976564?space_id=c11f08f5-2336-819d-815f-000329bbe038&name=hrm-add-employee-employment-compensation.png)
### Preview — แก้ไขพนักงาน
![](notion-file-block://5f331bf2-2ef8-48b9-ad16-2fe163ba8a22/f6458e45-cb33-425e-b9e6-0b2b277b01b9?space_id=c11f08f5-2336-819d-815f-000329bbe038&name=hrm-edit-employee.png)
### Preview — แก้ไขการจ้างงานและค่าตอบแทน
![](notion-file-block://8ae77a8f-01f2-418c-8121-3539f6aaac61/0c0deba4-2cfd-4fa3-ad3d-bb6f34771f92?space_id=c11f08f5-2336-819d-815f-000329bbe038&name=hrm-edit-employee-employment-compensation.png)
แบบฟอร์มประกอบด้วยข้อมูลบุคคล ติดต่อ ผู้ติดต่อฉุกเฉิน การจ้าง บริษัท/หน่วยงาน ค่าตอบแทน บัญชีธนาคาร ภาษี ประกันสังคม เอกสาร และบัญชีผู้ใช้
กฎสำคัญ:
- เพิ่มพนักงานพร้อมสร้าง User ได้ใน Transaction เดียว
- Employee number ไม่ซ้ำภายในบริษัท
- เปลี่ยนแผนก ตำแหน่ง หัวหน้า สถานะ และเงินเดือนต้องเพิ่ม History
- ห้ามเขียนทับประวัติที่มีผลแล้ว
- การยุติการจ้างต้องมีวันที่และเหตุผล
- ข้อมูลอ่อนไหวแสดงแบบ Masked ตามสิทธิ์
## 7.4 Employee Self-service
### Preview — โปรไฟล์พนักงาน
![](notion-file-block://ff68c351-524a-4740-b9ae-9e3418dbb06f/88dd5185-7598-4fc2-95cc-0b1f6aeeff86?space_id=c11f08f5-2336-819d-815f-000329bbe038&name=hrm-employee-profile.png)
พนักงานเห็นข้อมูลตนเองเป็น Form ไม่ใช้หน้ารายการค้นหา ประวัติการทำงานแสดงถัดจากรายละเอียดโดยไม่ต้องเปิด Dialog
พนักงานแก้ข้อมูลทั่วไปได้ ส่วนชื่อ เลขประจำตัว บัญชีธนาคาร ภาษี และประกันสังคมต้องส่ง Change request พนักงานเพิ่มประสบการณ์ทำงานได้ แต่หลังส่งแล้วแก้ไขหรือลบไม่ได้
## 7.5 Attendance และ OT
### Preview
![](notion-file-block://1741f3e7-5481-40ea-80db-e5d7826e729c/eddacbad-1ea2-4855-aa7e-1f0aef027e05?space_id=c11f08f5-2336-819d-815f-000329bbe038&name=hrm-attendance.png)
- กะ วันทำงาน และการกำหนดกะแบบมีวันที่มีผล
- ข้อมูลจาก Device, Web, Mobile, Import และ Manual
- เวลาเข้า–ออก นาทีทำงาน มาสาย กลับก่อน และสถานะ
- คำขอแก้เวลาและ OT
- การแก้ไขต้องมีเหตุผลและ Audit Log
- รายการไม่สมบูรณ์ส่ง Warning/Blocking error ไป Payroll
- ใช้นาทีเป็นหน่วยมาตรฐาน
## 7.6 Leave Management
### Preview
![](notion-file-block://91600fac-706b-4b53-a95d-74bafd5e22aa/dcddd225-dcbf-4990-876a-d3f45ba07e67?space_id=c11f08f5-2336-819d-815f-000329bbe038&name=hrm-leave-management.png)
- ประเภทลา Policy สิทธิ์ต่อปี การสะสม และยอดยกมา
- ปฏิทินเดือน สัปดาห์ และรายการ
- เต็มวัน ครึ่งวัน และรายชั่วโมง
- ตรวจวันซ้อน วันหยุด กะ ยอดคงเหลือ และกำลังคนขั้นต่ำ
- Approval หลายขั้นและความเป็นส่วนตัว
- เชื่อม Attendance และ Payroll
- ใช้ Ledger กับทุกการเพิ่ม ใช้ คืน ปรับ และหมดอายุ
## 7.7 Payroll และ Payslip
### Preview — ภาพรวมค่าตอบแทน
![](notion-file-block://aed4c607-a8b5-4b2f-94fe-a5dcb475e710/d8d42e53-90a0-438d-b7b7-4f3343c7e021?space_id=c11f08f5-2336-819d-815f-000329bbe038&name=hrm-compensation.png)
### Preview — สร้างรอบเงินเดือน
![](notion-file-block://8208003b-c2b9-461d-a36b-ab27dc280a54/089ec8fc-6e36-41ac-a64f-73f4f7472245?space_id=c11f08f5-2336-819d-815f-000329bbe038&name=hrm-create-payroll-cycle.png)
### Preview — ตรวจสอบผลการคำนวณ
![](notion-file-block://5efc3f0c-4d5e-4886-8399-4cd122787a21/2a20bc1f-351f-4181-98c6-0575aad302f4?space_id=c11f08f5-2336-819d-815f-000329bbe038&name=hrm-payroll-calculation-review.png)
รองรับรายวัน รายสัปดาห์ รายสองสัปดาห์ และรายเดือน
สถานะ: `DRAFT → CALCULATING → REVIEW → PENDING_APPROVAL → APPROVED → PAID → CLOSED`
- รอบหนึ่งอยู่ภายใต้บริษัทเดียว
- แสดงเงินเดือน รายได้ OT หัก ภาษี ประกันสังคม สุทธิ และส่วนต่าง
- มี Blocking error, Warning, Formula, Source, Version และ Approval timeline
- คำนวณใหม่สร้าง Version ใหม่และเก็บผลเดิม
- Manual adjustment ต้องมีเหตุผล
- ผู้จัดทำ ผู้ตรวจสอบ และผู้อนุมัติแยกหน้าที่
- รอบที่ล็อก อนุมัติ จ่าย หรือปิดแล้วห้ามแก้โดยตรง
- สลิปมี YTD, View history, PDF และการเพิกถอน
- เงินเก็บเป็น INTEGER หน่วยสตางค์
## 7.8 Announcement และ Notification
### Preview
![](notion-file-block://1db9e1c3-1232-443c-a90e-12194395618c/ab3e1e53-6858-4470-9f8f-698c18e6a8da?space_id=c11f08f5-2336-819d-815f-000329bbe038&name=hrm-announcements.png)
- ฉบับร่าง เผยแพร่ทันที ตั้งเวลา และหมดอายุ
- ระดับ Tenant หรือบริษัท
- Target ทุกคน บริษัท สาขา แผนก Role หรือ User
- รูปหน้าปก ไฟล์แนบ ความสำคัญ Preview และ Acknowledgement
- เก็บ Revision หลังเผยแพร่
- ผู้สร้างไม่รับ Notification ของประกาศตนเอง
- Badge ลดเฉพาะเมื่อเปิดรายการนั้น
- Admin เห็น Unique viewer, Total view และผู้ยังไม่อ่าน
- Query Activity รวมกับประกาศ ไม่ใช้ N+1 API
- ใช้ WebSocket แทน Polling
## 7.9 User Management
- เชิญ User พร้อมหลายบริษัทและ Role
- เชื่อม User กับ Employee
- Reset password, Unlock, Suspend และ Revoke session
- Scope: Tenant, Company, Branch, Department และ Self
- แสดง Effective permissions
- ป้องกันการลบ Admin คนสุดท้าย
- ผู้ดูแลเพิ่มสิทธิ์สูงกว่าตนเองไม่ได้
- ทุกการเปลี่ยนสิทธิ์มี Audit Log
## 7.10 Audit Log และ Export
### Preview — ประวัติการเปลี่ยนแปลงพนักงาน
![](notion-file-block://c2937691-4fbc-40f4-968d-a9276882307e/dc000929-2dc3-4b05-aeb8-d3d49c2addd5?space_id=c11f08f5-2336-819d-815f-000329bbe038&name=hrm-employee-audit-history.png)
- ค้นหาตามเวลา ผู้ดำเนินการ บริษัท Module, Action, Object, Employee และ Request ID
- แสดง Before/After diff โดยปกปิดข้อมูลลับ
- Audit Log แก้ไขหรือลบผ่าน Application ไม่ได้
- Export ต้องมีเหตุผล Filter snapshot วันหมดอายุ และประวัติดาวน์โหลด
# 8. ขั้นตอนการทำงานหลัก
## 8.1 เพิ่มพนักงาน
1. เลือกบริษัท
2. ตรวจว่าบุคคลมีอยู่ใน Tenant หรือไม่
3. สร้างหรือเชื่อม People record
4. กรอกข้อมูลการจ้างและค่าตอบแทน
5. เพิ่มบัญชีธนาคาร ภาษี ประกันสังคม และเอกสาร
6. สร้าง User และ Company access เมื่อเลือก
7. สร้าง Employment และ Compensation history
8. บันทึก Audit Log
9. เปิดหน้ารายละเอียดพนักงาน
## 8.2 ขอและอนุมัติการลา
1. พนักงานเลือกการจ้างงานและประเภทลา
2. ตรวจ Policy, Balance, Schedule, Holiday และวันที่ซ้อน
3. ตรวจ Staffing rule
4. ส่งคำขอเข้าสู่ Approval
5. เมื่ออนุมัติ ให้เพิ่ม Leave ledger transaction
6. ปรับ Attendance
7. ส่งผลให้ Payroll
8. แจ้งพนักงาน
## 8.3 เตรียม Payroll
1. เลือกบริษัทและสร้างรอบ
2. ดึง Compensation ที่มีผลในงวด
3. รวม Attendance, Leave, OT, Earning และ Deduction
4. สร้าง Calculation version
5. ตรวจ Blocking error และ Warning
6. เปรียบเทียบงวดก่อน
7. ส่ง Review และ Approval
8. ล็อกรอบและบันทึก YTD snapshot
9. ออกและเผยแพร่ Payslip
10. ปิดรอบ
## 8.4 เผยแพร่ประกาศ
1. เลือกระดับ Tenant หรือบริษัท
2. สร้างเนื้อหาและกลุ่มผู้รับ
3. Preview
4. บันทึกร่าง เผยแพร่ หรือตั้งเวลา
5. Resolve ผู้รับโดยไม่ซ้ำ
6. สร้าง Notification โดยยกเว้นผู้สร้าง
7. ส่ง WebSocket/Push
8. เก็บ View และ Acknowledgement
9. แสดงรายงานรวม
## 8.5 ย้ายพนักงานข้ามบริษัท
1. เลือกบุคคล บริษัทต้นทางและปลายทาง
2. ระบุ Transfer, Secondment หรือ Dual employment
3. กำหนดวันที่มีผลและข้อมูลการจ้างปลายทาง
4. ส่งอนุมัติ
5. สร้าง Employee record ปลายทาง
6. ปิดหรือปรับสถานะการจ้างต้นทาง
7. กำหนด Company access
8. บันทึก History และ Audit ด้วย Request ID เดียวกัน
# 9. กฎธุรกิจสำคัญ
- ทุก Record ต้องอยู่ใน Tenant ที่ถูกต้อง
- ข้อมูลระดับบริษัทต้องมี Company context
- ห้ามเชื่อถือ Company ID จาก Client ก่อนตรวจสิทธิ์
- ห้าม Hard delete Payroll, Payslip และ Audit
- ช่วงวันที่ Employment, Compensation, Schedule และ Bank account ต้องไม่ซ้อน
- Manager hierarchy ต้องไม่มี Cycle
- คำขอลาต้องไม่ซ้อนกับคำขอที่รอหรืออนุมัติแล้ว
- บัญชีธนาคารหลักต้องยืนยันก่อนจ่ายจริง
- File, Export, Cache และ WebSocket ต้องแยก Tenant/Company
- การเปลี่ยนหลายตารางต้องใช้ Transaction
- งานที่ Retry ได้ต้องมี Idempotency หรือ Unique constraint
- Payroll employee ต้องอยู่บริษัทเดียวกับ Payroll cycle
- ผู้อนุมัติต้องมีสิทธิ์ในบริษัทของรายการ
# 10. ความปลอดภัย
## 10.1 การเข้าถึง
- Role-Based Access Control ร่วมกับ Scope
- Company access เป็นด่านบังคับของทุก API
- Session มีวันหมดอายุและเพิกถอนได้
- Token บันทึกเฉพาะ Hash
- เปลี่ยนรหัสผ่านสามารถเพิกถอน Session เก่า
- Export และ Payroll ใช้สิทธิ์เฉพาะ
- Backend ตรวจ Object ownership ก่อนอ่านหรือแก้ไข
## 10.2 ข้อมูลอ่อนไหว
ต้องเข้ารหัสก่อนบันทึก:
- เลขบัตรประชาชนและ Passport
- เลขบัญชีธนาคาร
- Tax ID
- Social security number
- Push token
UI แสดงค่า Masked เมื่อไม่จำเป็นต้องใช้ข้อมูลเต็ม และ Logging ห้ามบันทึกข้อมูลลับ
## 10.3 Security test บังคับ
- User บริษัท A อ่านข้อมูลบริษัท B ไม่ได้
- Manager เปิด Payroll ของผู้อื่นไม่ได้
- Employee เปิดสลิปของผู้อื่นไม่ได้
- เปลี่ยน Company ID ใน URL แล้วต้องได้ 403
- File URL ใช้ข้ามบริษัทไม่ได้
- WebSocket ไม่ส่งเหตุการณ์ข้ามบริษัท
- Export มีเฉพาะบริษัทที่ผู้ใช้มีสิทธิ์
- Tenant หนึ่งอ้าง UUID ของอีก Tenant ไม่ได้
# 11. ข้อกำหนดทางเทคนิค
- Database: SQLite หรือ Cloudflare D1 compatible
- เปิด Foreign key ทุก Connection
- ID ใช้ UUID หรือ ULID จาก Application
- Date-only ใช้ YYYY-MM-DD
- Timestamp เก็บ ISO 8601 UTC และแสดง Asia/Bangkok เป็นค่าเริ่มต้น
- เงินใช้ INTEGER หน่วยสตางค์
- Boolean ใช้ INTEGER 0/1 พร้อม CHECK
- JSON snapshot ใช้ TEXT
- Application กำหนด updated_at
- รายการจำนวนมากใช้ Pagination
- Query ประกาศโหลด Activity พร้อมประกาศ
- Background job มี Tenant, Company, Request ID และ Idempotency key
- รองรับ Backup, Restore, Migration version และ Rollback plan
# 12. แผนการพัฒนาแนะนำ
<table fit-page-width="true" header-row="true">
<tr>
<td>ระยะ</td>
<td>ขอบเขต</td>
<td>ผลลัพธ์</td>
</tr>
<tr>
<td>Phase 1</td>
<td>Tenant, Company, Auth, User, Role และ Audit</td>
<td>เข้าสู่ระบบและแยกบริษัทได้ปลอดภัย</td>
</tr>
<tr>
<td>Phase 2</td>
<td>Employee, History, Compensation และ Self-service</td>
<td>ทะเบียนพนักงานและ Workflow แก้ข้อมูล</td>
</tr>
<tr>
<td>Phase 3</td>
<td>Schedule, Attendance, OT และ Leave</td>
<td>ข้อมูลเวลาและการลาพร้อมคำนวณ</td>
</tr>
<tr>
<td>Phase 4</td>
<td>Payroll, Approval และ Payslip</td>
<td>เงินเดือนแบบ Versioned และตรวจสอบได้</td>
</tr>
<tr>
<td>Phase 5</td>
<td>Announcement, Notification, Export และ Mobile polish</td>
<td>การสื่อสาร รายงาน และ UX ครบถ้วน</td>
</tr>
</table>
# 13. Definition of Done
ข้อกำหนดด้าน Product Design:
- [x] กำหนดผู้ใช้ เป้าหมาย และสิทธิ์
- [x] กำหนด Happy path และ Error path
- [x] กำหนด Loading, Empty, Validation, Success และ Permission state
- [x] รองรับ Desktop, Tablet และ Mobile
- [x] รองรับไทย/อังกฤษและ Light/Dark mode
- [x] เชื่อมหน้าจอกับ Database และ Audit event
- [x] มี Acceptance criteria ที่ QA ตรวจได้
ข้อกำหนดก่อน Production:
- [ ] Backend ตรวจ Tenant/Company access ทุก Endpoint
- [ ] มี Automated test ป้องกัน Cross-company data leakage
- [ ] มี Migration, Backup และ Rollback test
- [ ] ผ่าน Security review
- [ ] Payroll reconciliation ตรงกับข้อมูลอ้างอิง
- [ ] ทดสอบ Permission matrix ทุก Role และ Scope
---
# ภาคผนวก A — Database Schema
รายละเอียดฐานข้อมูลถูกแยกจากข้อกำหนดผลิตภัณฑ์ เพื่อให้ส่วนหลักอ่านง่ายและทีมพัฒนายังมี Schema อ้างอิงครบถ้วน
## A.1 ไฟล์ SQLite DDL
<file src="notion-file-block://34d16b2a-ce61-4dfd-a6d0-a16186d315a9/9f392544-7f0b-4f4a-a33e-3f8adb385382?space_id=c11f08f5-2336-819d-815f-000329bbe038&name=hrm-system-design-v3-sqlite-schema.txt">SQLite Schema Version 3 — Multi-company</file>
ไฟล์ `hrm-system-design-v3-sqlite-schema.txt` เป็น Baseline สำหรับฐานข้อมูลใหม่ เปลี่ยนนามสกุลเป็น `.sql` ก่อนใช้งาน ผ่านการตรวจสอบสร้างฐานข้อมูลด้วย SQLite และเปิด Foreign key แล้ว
- Schema version: `003_multi_company_schema`
- จำนวนตาราง: **67**
- Currency: `THB`
- Primary key: `TEXT` UUID/ULID
- เงิน: `INTEGER` หน่วยสตางค์
- Timestamp: ISO 8601 UTC
## A.2 มาตรฐานข้อมูล
<table fit-page-width="true" header-row="true">
<tr>
<td>หัวข้อ</td>
<td>มาตรฐาน</td>
</tr>
<tr>
<td>Primary key</td>
<td>TEXT UUID/ULID สร้างใน Application</td>
</tr>
<tr>
<td>เงิน</td>
<td>INTEGER หน่วยสตางค์</td>
</tr>
<tr>
<td>Date</td>
<td>TEXT รูปแบบ YYYY-MM-DD</td>
</tr>
<tr>
<td>Timestamp</td>
<td>ISO 8601 UTC</td>
</tr>
<tr>
<td>Boolean</td>
<td>INTEGER 0/1 พร้อม CHECK</td>
</tr>
<tr>
<td>JSON</td>
<td>TEXT สำหรับ Snapshot และค่าตั้ง</td>
</tr>
<tr>
<td>Multi-company</td>
<td>ทุกข้อมูลมี Tenant context; ข้อมูลบริษัทมี Organization ID</td>
</tr>
<tr>
<td>ข้อมูลลับ</td>
<td>เข้ารหัสก่อนบันทึกและแสดงแบบ Masked</td>
</tr>
</table>
## A.3 กลุ่มตารางทั้งหมด
<table fit-page-width="true" header-row="true">
<tr>
<td>กลุ่ม</td>
<td>ตาราง</td>
</tr>
<tr>
<td>Migration และ Tenant</td>
<td>`schema_migrations`, `tenants`, `tenant_settings`</td>
</tr>
<tr>
<td>บริษัทและโครงสร้าง</td>
<td>`organizations`, `organization_relationships`, `organization_settings`, `branches`, `departments`, `positions`, `job_levels`</td>
</tr>
<tr>
<td>User และสิทธิ์</td>
<td>`users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `user_company_access`, `user_invitations`, `invitation_company_access`, `user_sessions`, `account_action_tokens`, `user_preferences`, `user_devices`</td>
</tr>
<tr>
<td>บุคคลและพนักงาน</td>
<td>`people`, `employees`, `employee_addresses`, `employee_emergency_contacts`, `employee_documents`, `employee_bank_accounts`, `employee_tax_profiles`, `employee_social_security_profiles`</td>
</tr>
<tr>
<td>ประวัติและ Self-service</td>
<td>`employment_history`, `compensation_history`, `employee_profile_change_requests`, `employee_profile_change_items`, `employee_work_experiences`, `intercompany_employee_transfers`</td>
</tr>
<tr>
<td>เวลาและ OT</td>
<td>`work_schedules`, `work_schedule_days`, `employee_schedule_assignments`, `attendance_records`, `overtime_requests`</td>
</tr>
<tr>
<td>การลา</td>
<td>`leave_types`, `leave_policies`, `employee_leave_balances`, `leave_balance_transactions`, `leave_requests`, `leave_request_days`, `leave_approvals`, `holidays`, `department_staffing_rules`</td>
</tr>
<tr>
<td>Payroll</td>
<td>`payroll_cycles`, `payroll_cycle_employees`, `payroll_calculation_runs`, `payroll_results`, `payroll_result_items`, `payroll_adjustments`, `payroll_approvals`, `payroll_cycle_status_history`, `payslips`</td>
</tr>
<tr>
<td>ประกาศและ Notification</td>
<td>`announcements`, `announcement_revisions`, `announcement_targets`, `announcement_user_activity`, `notifications`</td>
</tr>
<tr>
<td>ไฟล์ Audit และ Export</td>
<td>`file_attachments`, `audit_logs`, `data_exports`</td>
</tr>
</table>
## A.4 ความสัมพันธ์หลัก
- Tenant 1:N Company
- Company 1:N Branch, Department, Position, Job level และ Employee
- User N:M Company ผ่าน `user_company_access`
- People 1:N Employee records
- Employee 1:N Employment และ Compensation history
- Employee 1:N Attendance, Leave และ Payroll result
- Payroll cycle 1:N Calculation run
- Calculation run 1:N Payroll result
- Payroll result 1:N Result item และ 1:1 Payslip
- Announcement N:M User ผ่าน Target และ User activity
- ทุกโมดูลส่งเหตุการณ์สำคัญเข้าสู่ Audit Log
## A.5 Constraint ที่ Application ต้องตรวจ
- Tenant และ Company ของ Foreign object ต้องตรงกัน
- ช่วงวันที่ Employment, Compensation, Schedule และ Bank account ต้องไม่ซ้อน
- Manager hierarchy ต้องไม่มี Cycle
- Leave request ต้องไม่ซ้อนและไม่เกินยอดสิทธิ์
- Staffing rule ต้องผ่านก่อนอนุมัติ
- Employee ใน Payroll ต้องอยู่บริษัทเดียวกับ Payroll cycle
- ผู้อนุมัติต้องมี Company access
- Snapshot ที่อนุมัติแล้วห้ามแก้
- การย้ายบริษัทต้องสร้าง Employee record ใหม่
- User มีบริษัทเริ่มต้นที่ Active ได้หนึ่งบริษัท
- ข้อมูลทางการเงินและ Audit ห้าม Hard delete
## A.6 Index สำคัญ
- Tenant และ Company status
- User email ต่อ Tenant
- User company access และบริษัทเริ่มต้น
- People identity hash ต่อ Tenant
- Employee ต่อ Company, Department, Manager และ Person
- History ตาม Employee และวันที่มีผล
- Attendance ตามวันที่และสถานะ
- Leave ตามช่วงเวลาและสถานะ
- Payroll ตามงวด Version และ Review status
- Announcement activity แบบรวม
- Notification ที่ยังไม่อ่าน
- Audit ตาม Object, Actor, Employee และเวลา
ใช้ `EXPLAIN QUERY PLAN` ตรวจ Query จริงก่อนเพิ่ม Index
## A.7 Migration จาก Version 2
ไฟล์แนบเป็น Baseline สำหรับฐานข้อมูลใหม่ หากมีฐานข้อมูล Version 2:
1. สำรองฐานข้อมูลและหยุดการเขียน
2. สร้าง Tenant และ Backfill Company
3. สร้าง People และเชื่อม Employee
4. Rebuild User, Role และ User role เป็น Tenant scope
5. สร้าง Company access
6. เพิ่ม Tenant context ให้ Announcement, Notification, File, Audit และ Export
7. สร้างตาราง Multi-company
8. ตรวจ Duplicate และ Orphan
9. รัน `PRAGMA foreign_key_check`
10. ทดสอบ Permission, Reconciliation และ Rollback
11. บันทึก Migration version
SQLite อาจต้อง Rebuild ตารางเมื่อเปลี่ยน Foreign key, NOT NULL หรือ Primary key ห้ามสมมติว่า ALTER ทำงานเหมือน PostgreSQL
---
# ภาคผนวก B — สถานะสำคัญ
## B.1 Employment
`DRAFT → ACTIVE → ON_LEAVE / SUSPENDED → TERMINATED`
## B.2 Leave request
`DRAFT → PENDING → APPROVED / REJECTED / CANCELLED / WITHDRAWN`
## B.3 Payroll cycle
`DRAFT → CALCULATING → REVIEW → PENDING_APPROVAL → APPROVED → PAID → CLOSED`
## B.4 Announcement
`DRAFT → SCHEDULED → PUBLISHED → ARCHIVED`
สามารถเปลี่ยนเป็น `CANCELLED` ตามสิทธิ์และช่วงเวลา
## B.5 Profile change request
`DRAFT → PENDING → APPROVED / REJECTED / CANCELLED`
---
# ภาคผนวก C — เอกสารและภาพต้นฉบับ
เอกสารนี้เป็นฉบับสรุปและจัดโครงสร้างใหม่ ดูภาพ Mockup และรายละเอียดการตัดสินใจก่อนหน้าได้ที่ <mention-page url="https://app.notion.com/p/3f2f08f5233681c399a9e9ce593e500a">HRM System Design</mention-page>
</content>
</page>
