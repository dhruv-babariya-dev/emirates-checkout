// v2 - finalize + send invoice after checkout
const https = require("https");

function stripeRequest(path, method, postData, secretKey) {
  return new Promise((resolve, reject) => {
    const body = method === "POST" ? new URLSearchParams(postData || {}).toString() : "";
    const options = {
      hostname: "api.stripe.com",
      port: 443,
      path,
      method,
      headers: {
        "Authorization": `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("Invalid JSON: " + data.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const invoiceId = session.invoice;
    const email = (session.customer_details && session.customer_details.email) || session.customer_email;
    const meta = session.metadata || {};

    console.log(`Session completed: ${session.id}`);
    console.log(`Invoice ID: ${invoiceId}`);
    console.log(`Customer email: ${email}`);
    console.log(`Metadata:`, JSON.stringify(meta));

    if (invoiceId) {
      // Get invoice status first
      const invoice = await stripeRequest(`/v1/invoices/${invoiceId}`, "GET", null, secretKey);
      console.log(`Invoice status: ${invoice.status}`);

      if (invoice.status === "draft") {
        // Finalize it first
        const finalized = await stripeRequest(`/v1/invoices/${invoiceId}/finalize`, "POST", {}, secretKey);
        console.log(`Finalized: ${finalized.status}`);
      }

      // Send the invoice email
      const sent = await stripeRequest(`/v1/invoices/${invoiceId}/send`, "POST", {}, secretKey);
      console.log(`Invoice sent, status: ${sent.status}`);
    } else {
      // No invoice — send a direct payment receipt via payment intent
      const paymentIntentId = session.payment_intent;
      if (paymentIntentId && email) {
        const updated = await stripeRequest(`/v1/payment_intents/${paymentIntentId}`, "POST", {
          "receipt_email": email,
        }, secretKey);
        console.log(`Receipt email set on payment intent: ${updated.id}`);
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
