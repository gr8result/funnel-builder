// /pages/modules/courses/[courseId]/checkout-success.js
// FULL REPLACEMENT
//
// ✅ Stripe return page (success_url lands here)
// ✅ Verifies Stripe session server-side and grants entitlements
// ✅ Redirects back to /modules/courses/:courseId/learn?success=1

import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../../../utils/supabase-client";
import styles from "../../../../styles/email-crm.module.css";

export default function CheckoutSuccess() {
  const router = useRouter();
  const { courseId } = router.query;

  const [msg, setMsg] = useState("Finalising your access…");

  useEffect(() => {
    if (!router.isReady) return;

    const session_id = router.query?.session_id;
    if (!courseId || !session_id) {
      setMsg("Missing session info. Returning to course…");
      router.replace(`/modules/courses/${courseId}/learn`);
      return;
    }

    (async () => {
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session?.session?.access_token;
        if (!token) {
          setMsg("Please log in again to complete your unlock.");
          router.replace(`/modules/courses/${courseId}/learn`);
          return;
        }

        const res = await fetch("/api/courses/finalise-checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ courseId, session_id }),
        });

        const json = await res.json();
        if (!res.ok) {
          console.error(json);
          setMsg(json?.error || "Could not finalise purchase. Returning…");
          router.replace(`/modules/courses/${courseId}/learn`);
          return;
        }

        setMsg("✅ Unlocked! Sending you to the course…");
        router.replace(`/modules/courses/${courseId}/learn?success=1`);
      } catch (e) {
        console.error(e);
        setMsg("Something went wrong. Returning…");
        router.replace(`/modules/courses/${courseId}/learn`);
      }
    })();
  }, [router.isReady, router.query, courseId]);

  return (
    <div className={styles.pageWrap} style={{ fontSize: 16 }}>
      <div style={{ width: 900, maxWidth: "100%", margin: "40px auto", color: "#fff" }}>
        <div style={{ fontSize: 28, fontWeight: 700 }}>{msg}</div>
        <div style={{ marginTop: 10, opacity: 0.9 }}>
          If you are not redirected automatically, go back and refresh the course page.
        </div>
      </div>
    </div>
  );
}
