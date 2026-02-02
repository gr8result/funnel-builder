import { useState } from "react";

export default function ConditionNodeDrawer({ node, onSave, onClose }) {
  const initial = node?.data?.condition || {};

  const [label, setLabel] = useState(node?.data?.label || "Condition");

  const [type, setType] = useState(initial.type || "");
  const [tag, setTag] = useState(initial.tag || "");
  const [field, setField] = useState(initial.field || "");
  const [value, setValue] = useState(initial.value || "");
  const [eventName, setEventName] = useState(initial.eventName || "");
  const [productName, setProductName] = useState(initial.productName || "");
  const [url, setUrl] = useState(initial.url || "");
  const [cartTimeout, setCartTimeout] = useState(initial.cartTimeout || 30);
  const [waitDays, setWaitDays] = useState(initial.waitDays !== undefined ? initial.waitDays : 3);

  const stats = node?.data?.stats || {};
  const incomingStats = node?.data?.incomingEmailStats || null;
  const incomingLabel = node?.data?.incomingEmailLabel || "Previous Email";

  const saveAndClose = () => {
    const newData = {
      ...node.data,
      label,
      condition: {
        type,
        tag,
        field,
        value,
        eventName,
        productName,
        url,
        cartTimeout,
        waitDays,
      },
    };

    onSave(newData);
  };

  return (
    <div style={s.overlay}>
      <div style={s.drawer}>
        <div style={s.header}>
          <h2>Edit Condition</h2>
          <button onClick={onClose} style={s.close}>×</button>
        </div>

        <div style={s.body}>

          <div style={s.statsBox}>
            <div style={s.statsTitle}>Node Statistics</div>
            <div style={s.statsRow}><span>Waiting</span><span>{Number(node?.data?.activeMembers || 0)}</span></div>
            <div style={s.statsRow}><span>Processed</span><span>{Number(stats.processed || 0)}</span></div>
            <div style={s.statsRow}><span>Delivered</span><span>{Number(stats.delivered || 0)}</span></div>
            <div style={s.statsRow}><span>Opened</span><span>{Number(stats.opened || 0)}</span></div>
            <div style={s.statsRow}><span>Clicked</span><span>{Number(stats.clicked || 0)}</span></div>

            {incomingStats && (
              <>
                <div style={s.statsDivider} />
                <div style={s.statsSubtitle}>{incomingLabel} (incoming email)</div>
                <div style={s.statsRow}><span>Processed</span><span>{Number(incomingStats.processed || 0)}</span></div>
                <div style={s.statsRow}><span>Delivered</span><span>{Number(incomingStats.delivered || 0)}</span></div>
                <div style={s.statsRow}><span>Opened</span><span>{Number(incomingStats.opened || 0)}</span></div>
                <div style={s.statsRow}><span>Clicked</span><span>{Number(incomingStats.clicked || 0)}</span></div>
              </>
            )}
          </div>

          {/* LABEL */}
          <label style={s.label}>Condition Label</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={s.input}
            placeholder="e.g. Has Tag, Field Match, Abandoned Cart"
          />

          {/* TYPE */}
          <label style={s.label}>Condition Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            style={s.input}
          >
            <option value="">-- Select Condition Type --</option>
            <option value="tag_exists">Tag Exists</option>
            <option value="tag_not_exists">Tag Does Not Exist</option>
            <option value="field_equals">Field Equals</option>
            <option value="field_contains">Field Contains</option>
            <option value="field_starts_with">Field Starts With</option>
            <option value="field_ends_with">Field Ends With</option>
            <option value="email_opened">Email Opened</option>
            <option value="email_not_opened">Email Not Opened (after delay)</option>
            <option value="link_clicked">Link Clicked</option>
            <option value="product_purchased">Product Purchased</option>
            <option value="event">Custom Event</option>
            <option value="abandoned_cart">Abandoned Cart</option>
          </select>

          {/* CONDITIONAL UI */}

          {/* TAG CONDITIONS */}
          {(type === "tag_exists" || type === "tag_not_exists") && (
            <>
              <label style={s.label}>Tag Name</label>
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                style={s.input}
                placeholder="e.g. VIP, Purchased"
              />
            </>
          )}

          {/* FIELD CONDITIONS */}
          {type.startsWith("field_") && (
            <>
              <label style={s.label}>Field Name</label>
              <input
                value={field}
                onChange={(e) => setField(e.target.value)}
                style={s.input}
                placeholder="e.g. first_name, city"
              />

              <label style={s.label}>Value</label>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                style={s.input}
                placeholder="e.g. John, Brisbane"
              />
            </>
          )}

          {/* EMAIL OPENED */}
          {type === "email_opened" && (
            <>
              <label style={s.label}>Wait (days)</label>
              <input
                type="number"
                min={1}
                value={waitDays}
                onChange={(e) => setWaitDays(Number(e.target.value))}
                style={s.input}
                placeholder="e.g. 3"
              />
              <p style={{ opacity: 0.7, marginTop: -6 }}>
                Wait this long for an open before routing to the "No" path. (2 = 48 hours)
              </p>
            </>
          )}

          {/* EMAIL NOT OPENED */}
          {type === "email_not_opened" && (
            <>
              <label style={s.label}>Wait (days)</label>
              <input
                type="number"
                min={1}
                value={waitDays}
                onChange={(e) => setWaitDays(Number(e.target.value))}
                style={s.input}
                placeholder="e.g. 3"
              />
              <p style={{ opacity: 0.7, marginTop: -6 }}>
                If not opened within this time, route to the "No" path.
              </p>
            </>
          )}

          {/* LINK CLICKED */}
          {type === "link_clicked" && (
            <>
              <label style={s.label}>URL to Check</label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                style={s.input}
                placeholder="https://example.com"
              />
            </>
          )}

          {/* PRODUCT PURCHASED */}
          {type === "product_purchased" && (
            <>
              <label style={s.label}>Product Name</label>
              <input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                style={s.input}
                placeholder="e.g. Whey Protein"
              />
            </>
          )}

          {/* CUSTOM EVENT */}
          {type === "event" && (
            <>
              <label style={s.label}>Event Name</label>
              <input
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                style={s.input}
                placeholder="e.g. webinar_registered"
              />
            </>
          )}

          {/* ABANDONED CART */}
          {type === "abandoned_cart" && (
            <>
              <label style={s.label}>Cart Timeout (minutes)</label>
              <input
                type="number"
                min={1}
                value={cartTimeout}
                onChange={(e) => setCartTimeout(Number(e.target.value))}
                style={s.input}
                placeholder="e.g. 30"
              />
              <p style={{ opacity: 0.7, marginTop: -6 }}>
                User is considered abandoned after this many minutes of no activity.
              </p>
            </>
          )}

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
  statsBox: {
    border: "1px solid #1e293b",
    background: "#0b1220",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  statsTitle: {
    fontWeight: 800,
    marginBottom: 8,
  },
  statsSubtitle: {
    fontWeight: 700,
    fontSize: 12,
    opacity: 0.85,
    marginBottom: 6,
  },
  statsRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 13,
    opacity: 0.9,
    marginBottom: 4,
  },
  statsDivider: {
    height: 1,
    background: "#1e293b",
    margin: "8px 0",
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
