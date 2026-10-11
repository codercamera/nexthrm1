import { openDb } from "../src/server/db";
const db = openDb();
console.log(db.query("SELECT * FROM schema_migrations").all());
db.close();
