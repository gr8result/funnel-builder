// components/ui/ReportBanner.js
import React from "react";

export default function ReportBanner({ icon, title, subtitle, backHref }) {
  return (
    <div style={styles.banner}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {icon && (
          <div style={styles.iconWrap}>{icon}</div>
        )}
        <div>
          <div style={styles.bannerTitle}>{title}</div>
          <div style={styles.bannerSub}>{subtitle}</div>
        </div>
      </div>
      {backHref && (
        <a href={backHref} style={styles.backBtn}>← Back</a>
      )}
    </div>
  );
}

const styles = {
  banner: {
    width: "100%",
    borderRadius: 18,
    padding: "20px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
    border: "1px solid rgba(255,255,255,0.10)",
    background: "#facc15",
    marginBottom: 18,
  },
  iconWrap: {
    width: 48,
    height: 48,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 48,
    marginRight: 8,
  },
  bannerTitle: {
    fontSize: 48,
    fontWeight: 700,
    color: "#241a00",
    lineHeight: 1.05,
  },
  bannerSub: {
    fontSize: 18,
    marginTop: 4,
    color: "rgba(36,26,0,0.80)",
    fontWeight: 400,
  },
  backBtn: {
    background: "#fffbe8",
    color: "#241a00",
    borderRadius: 999,
    padding: "12px 22px",
    fontSize: 18,
    textDecoration: "none",
    border: "1px solid #facc15",
    fontWeight: 600,
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    marginLeft: 18,
  },
};
