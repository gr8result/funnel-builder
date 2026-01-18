// /components/nodes/EmailNodeDrawer.js
// FULL REPLACEMENT — stores HTML path + preview + bucket so engine can send the right email
// ✅ Saves: emailId, emailName, emailPreviewUrl, htmlPath, bucket
// ✅ htmlPath is always: `${userId}/finished-emails/${emailId}.html`
// ✅ Preview is still PNG/JPG/WEBP public URL guess

import { useEffect, useState } from "react";
import { supabase } from "../../utils/supabase-client";
import { useRouter } from "next/router";

export default function EmailNodeDrawer({ node, onSave, onClose, userId }) {
  const router = useRouter();

  const [label, setLabel] = useState(node?.data?.label || "Email Step");

  const [emailId, setEmailId] = useState(node?.data?.emailId || "");
  const [emailName, setEmailName] = useState(node?.data?.emailName || "");
  const [emailPreviewUrl, setEmailPreviewUrl] = useState(node?.data?.emailPreviewUrl || "");

  // ✅ NEW: this is what the engine needs
  const [bucket, setBucket] = useState(node?.data?.bucket || "email-user-assets");
  const [htmlPath, setHtmlPath] = useState(node?.data?.htmlPath || "");

  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    loadEmails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function loadEmails() {
    setLoading(true);

    const folder = `${userId}/finished-emails/`;

    const { data, error } = await supabase.storage
      .from("email-user-assets")
      .list(folder);

    if (!error && data) {
      const emailList = data
        .filter((f) => f.name.toLowerCase().endsWith(".html"))
        .map((f) => {
          const id = f.name.replace(/\.html$/i, "");
          const name = id;

          const pngPath = `${folder}${id}.png`;
          const jpgPath = `${folder}${id}.jpg`;
          const webpPath = `${folder}${id}.webp`;

          const { data: pngUrlData } = supabase.storage.from("email-user-assets").getPublicUrl(pngPath);
          const { data: jpgUrlData } = supabase.storage.from("email-user-assets").getPublicUrl(jpgPath);
          const { data: webpUrlData } = supabase.storage.from("email-user-assets").getPublicUrl(webpPath);

          const previewUrl =
            pngUrlData?.publicUrl ||
            jpgUrlData?.publicUrl ||
            webpUrlData?.publicUrl ||
            "";

          return { id, name, previewUrl };
        });

      setEmails(emailList);

      // hydrate existing selection
      if (emailId) {
        const existing = emailList.find((e) => e.id === emailId);
        if (existing?.previewUrl && !emailPreviewUrl) setEmailPreviewUrl(existing.previewUrl);

        // ✅ ensure htmlPath is correct if missing
        const hp = `${userId}/finished-emails/${emailId}.html`;
        if (!htmlPath) setHtmlPath(hp);
      }
    }

    setLoading(false);
  }

  const saveAndClose = () => {
    onSave({
      ...node.data,
      label,
      emailId,
      emailName,
      emailPreviewUrl,

      // ✅ CRITICAL FOR ENGINE
      bucket: bucket || "email-user-assets",
      htmlPath,
      storagePath: htmlPath, // (extra compatibility, engine checks storagePath too)
    });
  };

  const createNewEmail = () => {
    router.push("/modules/email/templates/select?fromNode=1");
  };

  return (
    <div style={s.overlay}>
      <div style={s.drawer}>
        <div style={s.header}>
          <h2>Edit Email Node</h2>
          <button onClick={onClose} style={s.close}>×</button>
        </div>

        <div style={s.body}>
          <label style={s.label}>Node Label</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={s.input}
            placeholder="e.g. Send Welcome Email"
          />

          <label style={s.label}>Select Email</label>
          {loading ? (
            <div style={{ opacity: 0.7 }}>Loading emails…</div>
          ) : (
            <select
              value={emailId}
              onChange={(e) => {
                const id = e.target.value;
                setEmailId(id);

                const chosen = emails.find((em) => em.id === id);

                setEmailName(chosen?.name || id || "");
                setEmailPreviewUrl(chosen?.previewUrl || "");

                // ✅ CRITICAL: store html path for engine
                const hp = id ? `${userId}/finished-emails/${id}.html` : "";
                setHtmlPath(hp);

                // keep bucket stable
                setBucket("email-user-assets");
              }}
              style={s.input}
            >
              <option value="">-- Select a Saved Email --</option>
              {emails.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          )}

          <button style={s.createBtn} onClick={createNewEmail}>
            ➕ Create New Email
          </button>

          {/* Tiny debug line (optional but helpful) */}
          <div style={{ marginTop: 12, fontSize: 12, opacity: 0.8 }}>
            <div><b>Bucket:</b> {bucket}</div>
            <div style={{ wordBreak: "break-all" }}><b>HTML:</b> {htmlPath || "-"}</div>
          </div>
        </div>

        <div style={s.footer}>
          <button onClick={saveAndClose} style={s.saveBtn}>💾 Save</button>
          <button onClick={onClose} style={s.cancelBtn}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const s = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.75)",
    zIndex: 4000,
    display: "flex",
    justifyContent: "flex-end",
  },
  drawer: {
    width: "420px",
    height: "100%",
    background: "#0f172a",
    borderLeft: "1px solid #1e293b",
    padding: "24px",
    color: "#fff",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  close: {
    fontSize: 28,
    background: "transparent",
    border: "none",
    color: "#fff",
    cursor: "pointer",
  },
  body: {
    flex: 1,
    overflowY: "auto",
  },
  label: {
    marginTop: 10,
    marginBottom: 4,
    fontWeight: 600,
  },
  input: {
    width: "100%",
    padding: "10px",
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 8,
    color: "#fff",
    marginBottom: 14,
  },
  createBtn: {
    width: "100%",
    padding: "10px",
    background: "#3b82f6",
    color: "#fff",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    marginTop: 4,
    fontWeight: 600,
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    paddingTop: 12,
    borderTop: "1px solid #1e293b",
  },
  saveBtn: {
    background: "#22c55e",
    padding: "10px 14px",
    borderRadius: 8,
    border: "none",
    fontWeight: 700,
    cursor: "pointer",
  },
  cancelBtn: {
    background: "#ef4444",
    padding: "10px 14px",
    borderRadius: 8,
    border: "none",
    fontWeight: 700,
    cursor: "pointer",
  },
};
