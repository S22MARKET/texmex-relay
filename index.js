const express = require("express");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ صفحة فحص
app.get("/status", (req, res) => {
  res.send("✅ texmex-relay is running");
});

// --- Firebase + OneSignal ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");

if (!process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_KEY) {
  console.error("❌ لازم تعرّف متغيرات البيئة: ONESIGNAL_APP_ID و ONESIGNAL_REST_KEY");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const ONE_SIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONE_SIGNAL_REST_KEY = process.env.ONESIGNAL_REST_KEY;

const META_DOC = "relay_meta/lastProcessed";

async function getLastProcessed() {
  const doc = await db.doc(META_DOC).get();
  return doc.exists ? doc.data().lastTimestamp || 0 : 0;
}

async function setLastProcessed(ts) {
  await db.doc(META_DOC).set({ lastTimestamp: ts }, { merge: true });
}

async function checkNewOrders() {
  try {
    const lastTs = await getLastProcessed();

    let q = db.collection("orders").orderBy("createdAt", "asc");
    if (lastTs) q = q.startAfter(admin.firestore.Timestamp.fromMillis(lastTs));

    const snap = await q.get();
    if (snap.empty) return;

    let newestTs = lastTs;
    for (const doc of snap.docs) {
      const data = doc.data();
      const createdAt = data.createdAt ? data.createdAt.toMillis() : Date.now();
      if (createdAt > newestTs) newestTs = createdAt;

      await sendOneSignalNotification({
        title: "طلبية جديدة 🛎️",
        message: `من ${data.customerName || "عميل"} - ${(data.totalPrice || 0)} د.ج`,
        data: { orderId: doc.id }
      });

      console.log("✅ إشعار مرسل للطلب:", doc.id);
    }

    await setLastProcessed(newestTs);
  } catch (err) {
    console.error("❌ خطأ:", err);
  }
}

async function sendOneSignalNotification({ title, message, data }) {
  const body = {
    app_id: ONE_SIGNAL_APP_ID,
    headings: { en: title, ar: title },
    contents: { en: message, ar: message },
    included_segments: ["All"],
    data: data || {}
  };

  const res = await fetch("https://onesignal.com/api/v1/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${ONE_SIGNAL_REST_KEY}`
    },
    body: JSON.stringify(body)
  });

  const result = await res.json();
  if (!res.ok) console.error("❌ خطأ OneSignal:", result);
  return result;
}

// ✅ تحقق من الطلبات كل 10 ثواني
setInterval(checkNewOrders, 10 * 1000);
console.log("🚀 texmex-relay شغال...");

// ✅ شغّل السيرفر
app.listen(PORT, () => {
  console.log(`🌍 Listening on port ${PORT}`);
});
