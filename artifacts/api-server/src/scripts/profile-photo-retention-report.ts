import { pool } from "@workspace/db";
import { reportPhotoRetention } from "../lib/profile-photo-retention";

try {
  console.info(JSON.stringify(await reportPhotoRetention(), null, 2));
} finally {
  await pool.end();
}
