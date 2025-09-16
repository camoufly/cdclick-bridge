// api/cdclick/webhook.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const got = req.headers["apikey"];
  if (got !== process.env.WAREHOUSE_TOKEN) {
    console.warn("CDClick webhook: bad apikey", got);
    return res.status(401).send("unauthorized");
  }

  console.log("CDClick webhook payload:", req.body);
  return res.status(200).send("ok");
}
