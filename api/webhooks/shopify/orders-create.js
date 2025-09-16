import getRawBody from "raw-body";
import crypto from "crypto";
import axios from "axios";

const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;
const WAREHOUSE_TOKEN = process.env.WAREHOUSE_TOKEN; // CDClick bearer token
const WAREHOUSE_BASE_URL = "https://wall.cdclick-europe.com/api";

// optional: set IDLE=true in Vercel to queue orders instead of producing immediately
const IDLE = /^true$/i.test(process.env.IDLE || "");

function verifyHmac(raw, hmac) {
  if (!SHOPIFY_WEBHOOK_SECRET || !hmac) return false;
  const digest = crypto.createHmac("sha256", SHOPIFY_WEBHOOK_SECRET)
    .update(raw, "utf8").digest("base64");
  try { return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac)); }
  catch { return false; }
}

const street = a => [a?.address1, a?.address2].filter(Boolean).join(", ");
const two = s => (s || "").toString().trim().slice(0,2).toUpperCase();

function toCDClick(order) {
  // prefer shipping, fall back to billing (some stores)
  const a = order.shipping_address || order.billing_address || {};

  const cart = (order.line_items || []).map(li => {
    const sku = li.sku || li.variant_sku || "";
    if (!sku || isNaN(Number(sku))) {
      throw new Error(`Invalid numeric SKU: "${sku}" (line item id ${li.id})`);
    }
    return { item_id: Number(sku), quantity: li.quantity };
  });

  // use order.name without the leading "#", else fallback to id
  const customId = (order.name || String(order.id)).replace(/^#/, "");

  return {
    custom_id: customId,
    check_multiple_custom_id: true,
    idle: IDLE, // flip with env
    shipping: {
      first_name: a.first_name || order.customer?.first_name || "",
      last_name:  a.last_name  || order.customer?.last_name  || "",
      company_name: a.company || "",
      address_street: street(a),
      zip_code: a.zip || "",
      city: a.city || "",
      state_province_code: two(a.province_code || a.province),
      country_code: two(a.country_code || a.country),
      phone_number: a.phone || order.phone || "",
      email: order.email || order.contact_email || order.customer?.email || ""
    },
    cart
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  let raw;
  try {
    raw = await getRawBody(req);
  } catch {
    return res.status(400).send("no body");
  }

  if (!verifyHmac(raw, req.headers["x-shopify-hmac-sha256"])) {
    return res.status(401).send("bad hmac");
  }

  let order;
  try {
    order = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).send("invalid json");
  }

  // quick guard: need at least one line item
  if (!order.line_items || order.line_items.length === 0) {
    return res.status(200).send("no line items");
  }

  let payload;
  try {
    payload = toCDClick(order);
  } catch (e) {
    console.error("mapping error:", e.message);
    // 200 so Shopify doesn't retry endlessly on permanent mapping issues
    return res.status(200).send("mapping error");
  }

  try {
    const r = await axios.post(`${WAREHOUSE_BASE_URL}/orders`, payload, {
      headers: {
        "Content-Type":"application/json",
        "Authorization": `Bearer ${WAREHOUSE_TOKEN}`
      },
      timeout: 20000,
      validateStatus: () => true
    });

    if (r.status === 201 && r.data?.success) {
      return res.status(200).send("ok");
    }

    // Distinguish permanent vs transient
    const status = r.status || 0;
    console.error("CDClick error", status, r.data);

    if (status >= 500 || status === 0) {
      // transient → let Shopify retry
      return res.status(500).send("warehouse error");
    } else {
      // 4xx or validation → don't retry
      return res.status(200).send("received");
    }
  } catch (e) {
    console.error("network error posting to CDClick:", e.message);
    // network/transient → let Shopify retry
    return res.status(500).send("warehouse network error");
  }
}

export const config = { api: { bodyParser: false } };
