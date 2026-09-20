require("dotenv").config({ path: "d:/truckmodel/web_dashboard/backend/.env" });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const BUCKET = "truck-images";

async function debug() {
  console.log("URL:", process.env.SUPABASE_URL);
  console.log("KEY:", process.env.SUPABASE_ANON_KEY?.slice(0, 20) + "...");
  console.log("BUCKET:", BUCKET);
  console.log("\n--- Listing with created_at sort ---");
  const r1 = await supabase.storage
    .from(BUCKET)
    .list("", { limit: 10, sortBy: { column: "created_at", order: "desc" } });
  console.log("data:", JSON.stringify(r1.data, null, 2));
  console.log("error:", r1.error);

  console.log("\n--- Listing with NO sort options ---");
  const r2 = await supabase.storage.from(BUCKET).list("", { limit: 10 });
  console.log("data:", JSON.stringify(r2.data, null, 2));
  console.log("error:", r2.error);

  console.log("\n--- Listing with name sort ---");
  const r3 = await supabase.storage
    .from(BUCKET)
    .list("", { limit: 10, sortBy: { column: "name", order: "asc" } });
  console.log("data:", JSON.stringify(r3.data, null, 2));
  console.log("error:", r3.error);
}

debug().catch(console.error);
