// Stripe webhook — fires after checkout.session.completed
// Finalizes and sends the invoice email
const https = require("https");

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
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("Invalid JSON")); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function stripeGet(path, secretKey) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.stripe.com",
      port: 443,
      path,
      method: "GET",
      headers: { "Authorization": `Bearer ${secretKey}` },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("Invalid JSON")); }
      });
    });
    req.on("error", reject);
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
    const email = session.customer_details?.email || session.customer_email;
    const meta = session.metadata || {};

    console.log(`Payment complete for session ${session.id}, invoice: ${invoiceId}, email: ${email}`);

    if (invoiceId) {
      try {
        // Finalize the invoice (moves it from draft to open)
        const finalized = await stripePost(`/v1/invoices/${invoiceId}/finalize`, {}, secretKey);
        console.log("Invoice finalized:", finalized.id, "status:", finalized.status);

        // Send the invoice email
        const sent = await stripePost(`/v1/invoices/${invoiceId}/send`, {}, secretKey);
        console.log("Invoice sent:", sent.id, "to:", email);
      } catch (err) {
        console.error("Invoice send error:", err.message);
      }
    }
  }

  return { statusCode: 200, body: "ok" };
};
