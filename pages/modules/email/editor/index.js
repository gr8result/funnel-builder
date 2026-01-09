// /pages/modules/email/editor/index.js
// FULL REPLACEMENT — banner only: consistent sizing + Back pill style (white bg / blue text)
// ✅ Title+icon 48px weight 700
// ✅ Subtitle 18px
// ✅ Back pill: 18px, white bg, blue text
// ✅ Removes Templates button (per your earlier instruction)
// ❌ No other behavior changes

import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "../../../../utils/supabase-client";
import EditorLayout from "../../../../components/email/editor/EditorLayout";

const LS_IMPORT_KEY = "gr8:email:editor:import:v1"; // set by /modules/email/templates/select

export default function EmailEditorPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [initialHtml, setInitialHtml] = useState(""); // template html or blank
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      try {
        setLoading(true);

        const { data } = await supabase.auth.getSession();
        const uid = data?.session?.user?.id || "";
        if (mounted) setUserId(uid);

        // 1) read import payload from templates/select
        let importPayload = null;
        try {
          const raw = window.localStorage.getItem(LS_IMPORT_KEY);
          if (raw) importPayload = JSON.parse(raw);
        } catch {}

        // allow URL param override too (?id=...)
        const urlId = String(router.query?.id || "").trim();

        const templateId = String(
          importPayload?.templateId || importPayload?.id || urlId || "blank"
        ).trim();
        const source = String(importPayload?.source || "").trim();

        // clear one-shot import (so refresh doesn't keep re-importing)
        try {
          window.localStorage.removeItem(LS_IMPORT_KEY);
        } catch {}

        // 2) load template if not blank
        if (!uid || templateId === "blank") {
          if (mounted) setInitialHtml("");
          return;
        }

        const url = `/api/email/editor-load?templateId=${encodeURIComponent(
          templateId
        )}&userId=${encodeURIComponent(uid)}&source=${encodeURIComponent(source)}`;
        const r = await fetch(url);
        const j = await r.json().catch(() => null);

        if (j?.ok && typeof j?.html === "string" && j.html.trim()) {
          if (mounted) setInitialHtml(j.html);
        } else if (j?.ok && j?.legacyHtml === true && j?.path && uid) {
          const supa = process.env.NEXT_PUBLIC_SUPABASE_URL;
          const publicUrl = supa
            ? `${supa}/storage/v1/object/public/email-user-assets/${encodeURIComponent(
                uid
              )}/${j.path.split("/").slice(1).join("/")}`
            : "";
          if (publicUrl) {
            const hr = await fetch(publicUrl);
            const ht = await hr.text();
            if (mounted) setInitialHtml(String(ht || ""));
          } else {
            if (mounted) setInitialHtml("");
          }
        } else if (j?.ok && j?.baseHtml === true && j?.path) {
          const supa = process.env.NEXT_PUBLIC_SUPABASE_URL;
          const publicUrl = supa ? `${supa}/storage/v1/object/public/email-assets/${j.path}` : "";
          if (publicUrl) {
            const hr = await fetch(publicUrl);
            const ht = await hr.text();
            if (mounted) setInitialHtml(String(ht || ""));
          } else {
            if (mounted) setInitialHtml("");
          }
        } else {
          if (mounted) setInitialHtml("");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    boot();
    return () => {
      mounted = false;
    };
  }, [router.query?.id]);

  return (
    <>
      <Head>
        <title>Email Editor | GR8</title>
      </Head>

      <div className="wrap">
        <div className="banner">
          <div className="bLeft">
            <div className="bTitleRow">
              <span className="bIcon" aria-hidden>
                ✉️
              </span>
              <div className="bTitle">Email Editor</div>
            </div>
            <div className="bSub">1320 canvas • drag & drop blocks • full text tools</div>
          </div>

          <div className="bRight">
            <Link href="/modules/email" className="btnBack">
              ← Back
            </Link>
          </div>
        </div>

        <div className="content">
          {loading ? (
            <div className="loading">Loading editor…</div>
          ) : (
            <EditorLayout userId={userId} initialHtml={initialHtml} />
          )}
        </div>
      </div>

      <style jsx>{`
        .wrap {
          padding: 14px 16px 24px;
        }

        /* keep your banner width as-is */
        .banner {
          width: 1320px;
          max-width: calc(100vw - 24px);
          margin: 0 auto 12px auto;
          background: linear-gradient(180deg, rgba(59, 130, 246, 0.95), rgba(37, 99, 235, 0.9));
          border-radius: 18px;
          padding: 14px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
        }

        .bTitleRow {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        /* REQUIRED */
        .bIcon {
          font-size: 48px;
          line-height: 1;
        }
        .bTitle {
          font-size: 48px;
          font-weight: 700;
          color: #fff;
          line-height: 1;
        }
        .bSub {
          margin-top: 6px;
          font-size: 18px;
          opacity: 0.95;
          color: rgba(255, 255, 255, 0.92);
        }

        .bRight {
          display: flex;
          gap: 10px;
          align-items: center;
        }

        /* REQUIRED: pill button 18px, white bg, blue text */
        .btnBack {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 42px;
          padding: 0 18px;
          border-radius: 999px;
          border: 2px solid rgba(255, 255, 255, 0.85);
          background: rgba(255, 255, 255, 0.95);
          color: #1d4ed8;
          text-decoration: none;
          font-weight: 800;
          font-size: 18px;
          cursor: pointer;
        }
        .btnBack:hover {
          background: #ffffff;
          border-color: #ffffff;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
        }

        /*
          IMPORTANT:
          Do NOT constrain the editor to banner width.
          Let editor be wider than banner while staying centered.
        */
        .content {
          width: calc(100vw - 24px);
          max-width: 1900px;
          margin: 0 auto;
        }

        .loading {
          padding: 18px;
          border-radius: 14px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(2, 6, 23, 0.35);
          color: #e5e7eb;
          font-weight: 800;
        }
      `}</style>
    </>
  );
}
