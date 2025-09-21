const express = require("express");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

const app = express();                 // ✅ لازم
const PORT = process.env.PORT || 3000; // ✅ مهم لـ Render

// ✅ صفحة فحص
app.get("/status", (req, res) => {
  res.send("✅ texmex-relay is running");
});

// --- Firebase + OneSignal ---
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} catch (error) {
  console.error("❌ خطأ فادح في تهيئة Firebase. تأكد من صحة متغير البيئة FIREBASE_SERVICE_ACCOUNT_JSON", error);
  process.exit(1);
}


if (!process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_KEY) {
  console.error("❌ لازم تعرّف متغيرات البيئة: ONESIGNAL_APP_ID و ONESIGNAL_REST_KEY");
  process.exit(1);
}

const db = admin.firestore();
const ONE_SIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONE_SIGNAL_REST_KEY = process.env.ONESIGNAL_REST_KEY;

// ✨ التحسين الأساسي: استخدام onSnapshot للاستماع للطلبات الجديدة
function listenForNewOrders() {
  console.log("👂 الاستماع للطلبات الجديدة...");

  // نبدأ بالاستماع للطلبات التي أُنشئت بعد الوقت الحالي لتجنب إرسال إشعارات قديمة عند إعادة تشغيل السيرفر
  const query = db.collection("orders")
                  .where("createdAt", ">", new admin.firestore.Timestamp.now());

  query.onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      // نهتم فقط بالطلبات التي تمت إضافتها حديثاً
      if (change.type === "added") {
        const doc = change.doc;
        const data = doc.data();
        console.log(`✅ تم اكتشاف طلب جديد: ${doc.id}`);

        sendOneSignalNotification({
          title: "طلبية جديدة 🛎️",
          message: `من ${data.customerName || "عميل"} - ${(data.totalPrice || 0)} د.ج`,
          data: { orderId: doc.id }
        }).then(() => {
          console.log(`👍 تم إرسال إشعار للطلب: ${doc.id}`);
        }).catch(err => {
          console.error(`👎 فشل إرسال إشعار للطلب ${doc.id}:`, err);
        });
      }
    });
  }, err => {
    console.error("❌ خطأ في onSnapshot:", err);
  });
}

//  الإصدار الصحيح والموحد من الدالة
async function sendOneSignalNotification({ title, message, data }) {
  const body = {
    app_id: ONE_SIGNAL_APP_ID,
    headings: { en: title, ar: title },
    contents: { en: message, ar: message },
    included_segments: ["All"],
    android_channel_id: "order_channel", // مهم لتمييز صوت الإشعار في أندرويد
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

  if (!res.ok) {
    const result = await res.json();
    console.error("❌ خطأ من OneSignal:", result);
    throw new Error("OneSignal API Error");
  }

  return res.json();
}

// ✅ شغّل السيرفر
app.listen(PORT, () => {
  console.log(`🌍 Listening on port ${PORT}`);
  // ابدأ بالاستماع للطلبات الجديدة بعد تشغيل السيرفر مباشرة
  listenForNewOrders();
});