# Deploy NextHRM บน Railway

Branch: **host/railway** — Bun/Hono API และ React/Tailwind frontend อยู่ใน service เดียวกัน ใช้ SQLite และ protected attachments บน persistent volume

## สร้าง service จาก GitHub

1. ใน Railway สร้าง service จาก repo `codercamera/nexthrm1` แล้วเลือก branch `host/railway`
2. ใช้ root directory ของ repository (`/`) ระบบ build จาก `Dockerfile` ซึ่ง pin Bun 1.4.3, ติดตั้งด้วย `bun.lock`, build frontend และติดตั้ง runtime dependencies แยก stage
3. Attach volume กับ service นี้ที่ **`/data`** ก่อน deploy ครั้งแรก
4. สร้าง public domain ใน service; ตั้ง variables ตามตารางด้านล่าง
5. ใน Deploy settings ตั้ง healthcheck path **`/api/health`**, timeout **120 seconds**, restart policy **ON_FAILURE**, max retries **5**, replicas **1** และไม่เปิด sleeping สำหรับ service ที่ต้องทำ scheduled announcements/accrual ต่อเนื่อง
6. Start command ใช้ Docker CMD หรือ **`bun src/server/index.ts`** ไม่ใช้ `vite`, frontend preview server หรือ `start:seed`
7. Deploy แล้วตรวจ log: `HRM running ...`, `SQLite database: /data/hrm.sqlite`; healthcheck ต้องผ่านก่อนเปิดเว็บ

SQLite migrations รันระหว่าง start หลัง mount volume แล้ว ไม่ตั้ง migration เป็น pre-deploy/build command เพราะ Railway ไม่ mount volume ในขั้นตอนนั้น

## Variables

| Variable | ค่า / ความหมาย |
|---|---|
| `NODE_ENV` | `production` (Dockerfile ตั้งไว้แล้ว) |
| `ENCRYPTION_KEY` | ค่าสุ่ม 64 hex characters จาก `openssl rand -hex 32`; เก็บเป็น secret และสำรองแยก ห้ามเปลี่ยนเมื่อมีข้อมูลเดิม |
| `APP_ORIGIN` | `https://<public-domain>` ไม่มี path; ถ้าไม่ตั้ง ใช้ `https://${RAILWAY_PUBLIC_DOMAIN}` อัตโนมัติ ใช้ APP_ORIGIN สำหรับ custom domain |
| `PORT` | Railway จัดให้; server อ่านค่านี้ ไม่ต้อง hard-code port ใน service settings |
| `HOST` | `0.0.0.0` (default) |
| `DB_PATH` | ไม่ต้องตั้ง หรือ `/data/hrm.sqlite` |
| `FILE_STORAGE_PATH` | ไม่ต้องตั้ง หรือ `/data/files` |
| `BACKUP_DIR` | ไม่ต้องตั้ง หรือ `/data/backups` |
| `INITIAL_SETUP` | `true` เฉพาะตั้ง admin ครั้งแรก |
| `SETUP_EMAIL` | อีเมล admin ของคุณ สำหรับ first-run setup |
| `SETUP_PASSWORD` | รหัส admin ที่กำหนดเอง อย่างน้อย 12 ตัวอักษร ใช้ secret variable |
| `SETUP_WORKSPACE` | ชื่อ workspace ขององค์กร |
| `SETUP_COMPANY` | ชื่อบริษัทแรก |

Railway กำหนด `RAILWAY_VOLUME_MOUNT_PATH` ให้อัตโนมัติ Server จะเลือก database/files/backups ภายใน mount นั้น แม้ใช้ mount path อื่น ถ้าตั้ง path เองต้องอยู่ภายใน volume เดียวกัน และไม่ควร mount volume ทับ `/app` ซึ่งมี source/build output

ระบบ production บน Railway จะปฏิเสธ startup เมื่อไม่มี volume หรือ path ของข้อมูลอยู่นอก volume เพื่อไม่ให้ข้อมูลสูญหายตอน redeploy ไฟล์ `.env` และฐานข้อมูลจากเครื่องพัฒนาไม่ถูก copy เข้า image

## Login ครั้งแรก

เมื่อฐานข้อมูลว่างและ `INITIAL_SETUP=true` ระบบสร้าง workspace/admin ครั้งเดียว และ log รหัส workspace เช่น `Initial workspace ready: code=xxxxxxxx, admin=...`

Login ด้วย **รหัส workspace จาก log**, `SETUP_EMAIL` และ `SETUP_PASSWORD` ที่ตั้งตอนแรก (ไม่ใช้รหัส workspace `seed` สำหรับ production ที่สร้างใหม่) หลังเข้าระบบได้ให้เอา `INITIAL_SETUP` และ `SETUP_PASSWORD` ออกจาก Railway variables

Redeploy จะเก็บข้อมูลและไม่ reset รหัสผ่าน แม้ค่า setup ถูกแก้ใน environment ระบบไม่มี default production account และไม่โหลด seed อัตโนมัติ

## Seed / staging

ชุด seed ใน repo เป็นข้อมูลสมมติสำหรับการทดสอบ การรัน seed/start:seed ใน `NODE_ENV=production` ถูกปฏิเสธ สำหรับข้อมูลทดสอบบน Railway ให้ใช้ environment/service แยกและ `NODE_ENV=development`, ตั้ง `SEED_PASSWORD` สำหรับชุดทดสอบและ volume path เป็น seed target (`SEED_DB_PATH=/data/seed.sqlite`) แล้วรัน `bun run db:seed` ใน running container ด้วย Railway SSH จากนั้นตั้ง `DB_PATH=/data/seed.sqlite` และใช้ start command ปกติ โดยต้องไม่เปิดให้บุคคลภายนอกเข้าถึง staging นี้ด้วยบัญชีทดสอบ

อย่ารัน seed ใน build/pre-deploy เพราะไม่เห็น volume และอย่าบันทึก secret หรือ `.sqlite` ขึ้น Git

## Backup และกู้คืน

ใน running service ผ่าน Railway SSH รัน:

```bash
bun run db:backup
bun run db:status
```

ไฟล์ backup อยู่ `/data/backups` โดยค่าเริ่มต้น ใช้ Railway volume backups หรือดาวน์โหลดสำเนาออกนอก volume เพิ่มด้วย ต้องสำรองทั้ง SQLite, `/data/files` และ encryption key การมีสำเนาอยู่ volume เดียวไม่ป้องกันการลบ volume

การ restore ต้องหยุด app ก่อน เลือก path ใหม่ และใช้ `bun run db:restore <backup>` ที่ตรวจ integrity/foreign keys แล้ว ตั้ง DB_PATH ไปยังไฟล์ใหม่และ start อีกครั้ง ไม่ copy ทับฐานข้อมูลที่กำลังเปิดอยู่

## ตรวจปัญหา

- Startup บอก missing key: ตั้ง `ENCRYPTION_KEY` เป็น hex 64 ตัว
- Missing origin: สร้าง Railway domain หรือกำหนด APP_ORIGIN เป็น HTTPS
- Missing volume / outside volume: attach volume และลบค่าจาก `.env` ของเครื่องพัฒนาที่ชี้ `data/hrm.sqlite`
- Login ไม่ได้: ตรวจ workspace code ใน log และ `bun run db:status`; เปลี่ยน SETUP_PASSWORD หลัง setup ไม่เปลี่ยนรหัสใน DB
- Build ไม่เปลี่ยน: ตรวจ source branch เป็น `host/railway` และดู deployed commit
- Migration error: ดู runtime logs; อย่าลบ volume เพื่อแก้ error เพราะจะลบข้อมูลทั้งหมด

## ผลการตรวจ

Local: Bun install frozen, TypeScript, production frontend build และ 51 automated tests ผ่าน รวม production-style startup, HTTPS origin/secure cookies, PORT, volume path guard, first-run setup, restart persistence, protected file upload/download และ CSRF

ไม่มี Docker daemon ใน workspace ที่ใช้ตรวจ จึงยังไม่ได้รัน Docker build ในเครื่องนี้ เพิ่ม Docker build ไว้ใน GitHub CI แล้ว ผล local test ไม่ใช่การรับรองว่า Railway deployment จริงสำเร็จ รุ่นนี้ยังไม่ได้ provision/deploy Railway service หรือ domain

## เอกสารทางการ

- [Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- [Volumes และเวลาที่ mount](https://docs.railway.com/volumes)
- [Healthchecks](https://docs.railway.com/deployments/healthchecks)

ตั้ง build/deploy settings ผ่าน dashboard ตามคู่มือนี้ โดยไม่เพิ่ม railway.json/railway.toml ซึ่ง Railway ระบุว่า deprecated สำหรับ service ใหม่
