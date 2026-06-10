// v4-receipt-email
const https = require("https");

const PRICE_IDS = {
  "Family Experience": "price_1TfPf8LggV3pEL1x6n6jBrDI",
  "Dining Experience": "price_1TfQAdQ2TPcI4MhQON2OPS6o",
  "VIP Experience":    "price_1TfQAdQ2TPcI4MhQ0i1GxJpA",
};

const ALLOWED_ORIGINS = [
  "https://emirates-our-home.webflow.io",
  "https://www.emiratesourhome.ae",
];

function stripePost(path, postData, secretKey) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(postData).toString();
    const options = {
      hostname: "api.stripe.com",
      port: 443,
      path,
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("Invalid JSON: " + data)); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || "";
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const corsHeaders = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  const p = event.queryStringParameters || {};
  const pkg   = p.pkg;
  const qty   = p.qty;
  const email = p.email;
  const ref   = p.ref || "";
  const date  = p.date || "";
  const slot  = p.slot || "";

  if (!pkg || !qty || !email) {
    return { statusCode: 400, headers: corsHeaders, body: "Missing: pkg, qty, email" };
  }

  const priceId = PRICE_IDS[pkg];
  if (!priceId) {
    return { statusCode: 400, headers: corsHeaders, body: "Unknown package: " + pkg };
  }

  const quantity = parseInt(qty, 10);
  if (isNaN(quantity) || quantity < 1 || quantity > 99) {
    return { statusCode: 400, headers: corsHeaders, body: "qty must be 1-99" };
  }

  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;

    // Create Stripe Customer
    const customer = await stripePost("/v1/customers", {
      "email": email,
      "metadata[package]": pkg,
      "metadata[date]": date,
      "metadata[slot]": slot,
    }, secretKey);

    if (customer.error) {
      return { statusCode: 500, headers: corsHeaders, body: "Customer error: " + customer.error.message };
    }

    // Create checkout session with receipt_email explicitly set
    // and payment_intent_data so Stripe sends a receipt automatically
    const sessionData = {
      "mode": "payment",
      "customer": customer.id,

      // This is the key: receipt_email on payment_intent_data
      // tells Stripe to send a payment receipt email directly
      "payment_intent_data[receipt_email]": email,
      "payment_intent_data[description]": `${pkg} — ${date} at ${slot} (${quantity} ticket${quantity > 1 ? "s" : ""})`,
      "payment_intent_data[metadata][package]": pkg,
      "payment_intent_data[metadata][event_date]": date,
      "payment_intent_data[metadata][time_slot]": slot,
      "payment_intent_data[metadata][qty]": String(quantity),

      "line_items[0][price]": priceId,
      "line_items[0][quantity]": String(quantity),

      "custom_text[submit][message]": `Booking ${quantity} ticket${quantity > 1 ? "s" : ""} for ${pkg} on ${date} at ${slot}. A receipt will be emailed to ${email}.`,

      "metadata[package]": pkg,
      "metadata[date]": date,
      "metadata[slot]": slot,
      "metadata[qty]": String(quantity),

      "success_url": "https://www.emiratesourhome.ae/tickets?success=1",
      "cancel_url":  "https://www.emiratesourhome.ae/tickets?cancelled=1",
    };

    if (ref) sessionData["client_reference_id"] = ref;

    const session = await stripePost("/v1/checkout/sessions", sessionData, secretKey);

    if (session.error) {
      return { statusCode: 500, headers: corsHeaders, body: "Stripe error: " + session.error.message };
    }

    return {
      statusCode: 302,
      headers: { ...corsHeaders, Location: session.url },
      body: "",
    };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: "Error: " + err.message };
  }
};
