import getRawBody from "raw-body";
import crypto from "crypto";
import axios from "axios";

const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;
const WAREHOUSE_TOKEN = process.env.WAREHOUSE_TOKEN; // your CDClick token
const WAREHOUSE_BASE_URL = "https://wall.cdclick-europe.com/api"; // from docs

// map Shopify SKUs -> CDClick item_id or subSKU like "2123.1.2.1"
const SKU_TO_ITEM_ID = JSON.parse(process.env.SKU_TO_ITEM_ID_JSON || "{}");

function verifyHmac(raw, hmac) {
  if (!SHOPIFY_WEBHOOK_SECRET || !hmac) return false;
  const digest = crypto.createHmac("sha256", SHOPIFY_WEBHOOK_SECRET)
    .update(raw, "utf8").digest("base64");
  try { return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac)); }
  catch { return false; }
}

const street = a => [a?.address1, a?.address2].filter(Boolean).join(", ");
const two = s => (s || "").toString().slice(0,2).toUpperCase();

function toWarehouse(order) {
  const a = order.shipping_address || {};
  const cart = (order.line_items || []).map(li => {
    const sku = li.sku || li.variant_sku || "";
    const item_id = SKU_TO_ITEM_ID[sku];
    if (!item_id) throw new Error(`No CDClick item_id for SKU "${sku}"`);
    return { item_id, quantity: li.quantity };
  });

  return {
    custom_id: order.name || String(order.id),
    check_multiple_custom_id: true,
    idle: false,
    shipping: {
      first_name: a.first_name || "",
      last_name: a.last_name || "",
      company_name: a.company || "",
      address_street: street(a),
      zip_code: a.zip || "",
      city: a.city || "",
      state_province_code: two(a.province_code || a.province),
      country_code: two(a.country_code || a.country),
      phone_number: a.phone || order.phone || "",
      email: order.email || order.contact_email || ""
    },
    cart
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end(); }

  try {
    const raw = await getRawBody(req);
    if (!verifyHmac(raw, req.headers["x-shopify-hmac-sha256"])) return res.status(401).send("bad hmac");

    const order = JSON.parse(raw.toString("utf8"));
    const payload = toWarehouse(order);

    const r = await axios.post(`${WAREHOUSE_BASE_URL}/orders`, payload, {
      headers: { "Content-Type":"application/json", "Authorization": `Bearer ${WAREHOUSE_TOKEN}` },
      validateStatus: () => true, timeout: 20000
    });

    // CDClick returns 201 + { success:true }
    if (r.status === 201 && r.data?.success) return res.status(200).send("ok");

    console.error("CDClick error", r.status, r.data);
    return res.status(200).send("received"); // keep 200 so Shopify doesn’t spam retries
  } catch (e) {
    console.error("handler error", e?.response?.status, e?.response?.data || e.message);
    return res.status(200).send("received");
  }
}
export const config = { api: { bodyParser: false } };
