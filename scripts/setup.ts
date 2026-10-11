import { bootstrap, openDb } from "../src/server/db";
const email = process.env.SETUP_EMAIL,
  password = process.env.SETUP_PASSWORD;
if (!email || !password)
  throw new Error("SETUP_EMAIL and SETUP_PASSWORD are required");
const db = openDb();
console.log(
  await bootstrap(
    db,
    email,
    password,
    process.env.SETUP_WORKSPACE,
    process.env.SETUP_COMPANY,
  ),
);
db.close();
