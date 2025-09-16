export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  // Verify CDClick's apikey header
  const expected = process.env.WAREHOUSE_WEBHOOK_APIKEY;
  const got = req.headers["apikey"];

  if (!expected || got !== expected) {
    console.warn("CDClick webhook: bad apikey", got);
    return res.status(401).send("unauthorized");
  }

  // Log the incoming payload so you can inspect it in Vercel logs
  console.log("CDClick webhook payload:", req.body);

  // Always reply 200 so CDClick knows you got it
  return res.status(200).send("ok");
}
