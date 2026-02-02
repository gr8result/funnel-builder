// /pages/modules/email/automation/index.js
// FULL REPLACEMENT — Automation Builder + WORKING Members Modal (lists + import + members)
// ✅ Uses existing endpoint: /api/automation/members/add-list (NOT import-list)
// ✅ Shows REAL server error + debug if import fails
// ✅ Lists load correctly (uses list.id as value)
// ✅ Members load + click opens lead modal callback
// ✅ Keeps your banner/layout (only Members modal internals touched)
// ✅ NEW: If import returns 0, shows server message + debug so we can see EXACTLY why
// ✅ NEW: DELETE member button per row (calls /api/automation/members/remove-person)

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Head from "next/head";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

import {
  ReactFlow,
  Controls,
  Background,
  addEdge,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
} from "reactflow";
import "reactflow/dist/style.css";

import TriggerNode from "../../../../components/nodes/TriggerNode";
import EmailNode from "../../../../components/nodes/EmailNode";
import DelayNode from "../../../../components/nodes/DelayNode";
import ConditionNode from "../../../../components/nodes/ConditionNode";

import TriggerNodeDrawer from "../../../../components/nodes/TriggerNodeDrawer";
import EmailNodeDrawer from "../../../../components/nodes/EmailNodeDrawer";
import DelayNodeDrawer from "../../../../components/nodes/DelayNodeDrawer";
import ConditionNodeDrawer from "../../../../components/nodes/ConditionNodeDrawer";

import NodeColorModal from "../../../../components/automation/NodeColorModal";
import LeadDetailsModal from "../../../../components/crm/LeadDetailsModal";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const nodeTypes = {
  trigger: TriggerNode,
  email: EmailNode,
  delay: DelayNode,
  condition: ConditionNode,
};

export default function AutomationPage() {
  return (
    <ReactFlowProvider>
      <AutomationBuilder />
    </ReactFlowProvider>
  );
}

function AutomationBuilder() {
  const [authUserId, setAuthUserId] = useState(null);
  const [accountId, setAccountId] = useState(null);

  const [allFlows, setAllFlows] = useState([]);
  const [flowId, setFlowId] = useState(null);
  const [flowName, setFlowName] = useState("");
  const [isTemplateFlow, setIsTemplateFlow] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const [toast, setToast] = useState("");
  const [showColorModal, setShowColorModal] = useState(false);
  const [activeNode, setActiveNode] = useState(null);

  const [membersOpen, setMembersOpen] = useState(false);

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const fileInputRef = useRef();
  const fileButtonRef = useRef();
  const fileMenuRef = useRef();

  const [saveAsOpen, setSaveAsOpen] = useState(false);

  const [triggerColor, setTriggerColor] = useState("#22c55e");
  const [emailColor, setEmailColor] = useState("#eab308");
  const [delayColor, setDelayColor] = useState("#f97316");
  const [conditionColor, setConditionColor] = useState("#a855f7");

  const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);

  const [nodeStats, setNodeStats] = useState({});
  const [triggerActive, setTriggerActive] = useState(0);

  const [queueStatus, setQueueStatus] = useState(null);
  const [flushingQueue, setFlushingQueue] = useState(false);

  const toastMsg = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  };

  const handleNodeClick = (nodeId, nodeData) => {
    // Handle node click if needed
  };

  const fetchQueueStatus = async () => {
    try {
      const res = await fetch(`/api/automation/email/queue-health`);
      const data = await res.json();
      setQueueStatus(data);
    } catch (err) {
      console.error('Failed to fetch queue status:', err);
    }
  };

  const flushQueue = async () => {
    if (!confirm('Send all pending queued emails now?')) return;
    
    setFlushingQueue(true);
    try {
      const token = await getToken();
      const res = await fetch('/api/automation/email/process-queue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ max: 100 }),
      });

      const result = await res.json();
      if (result.ok) {
        toastMsg(`✅ Sent ${result.sent || 0} emails (${result.failed || 0} failed)`);
        await fetchQueueStatus(); // Refresh status
      } else {
        alert('Flush failed: ' + (result.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Error flushing queue: ' + err.message);
    } finally {
      setFlushingQueue(false);
    }
  };

  const cleanupDuplicates = async () => {
    if (!confirm('Remove duplicate flows? (Keeps most recent version of each name)')) return;
    
    try {
      const token = await getToken();
      const res = await fetch('/api/automation/flows/cleanup-duplicates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      const result = await res.json();
      if (result.ok) {
        toastMsg(`✅ ${result.message}`);
        await fetchFlows(accountId, authUserId); // Refresh flows list
      } else {
        alert("Cleanup failed: " + (result.error || "Unknown error"));
      }
    } catch (err) {
      alert("Error cleaning up: " + err.message);
    }
  };

  const deleteFlow = async (flowIdToDelete, flowName) => {
    if (!confirm(`Delete "${flowName}"? This cannot be undone.`)) return;
    
    try {
      const token = await getToken();
      const res = await fetch(`/api/automation/flows/${flowIdToDelete}/delete`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      const result = await res.json();
      if (result.ok) {
        toastMsg(`✅ Flow deleted`);
        await fetchFlows(accountId, authUserId); // Refresh flows list
        if (flowId === flowIdToDelete) {
          setFlowId(null); // Clear current flow if it was deleted
        }
      } else {
        alert("Delete failed: " + (result.error || "Unknown error"));
      }
    } catch (err) {
      alert("Error deleting: " + err.message);
    }
  };

  const resetFlow = async () => {
    if (!flowId) {
      alert("No flow selected");
      return;
    }

    setIsResetting(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/automation/flows/${flowId}/reset`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ confirm_deletion: true }),
      });

      const result = await res.json();
      if (result.ok) {
        toastMsg("✅ Flow data cleared!");
        setResetConfirmOpen(false);
        await fetchNodeStats(); // Refresh stats
      } else {
        alert("Reset failed: " + (result.error || "Unknown error"));
      }
    } catch (err) {
      alert("Error resetting flow: " + err.message);
    } finally {
      setIsResetting(false);
    }
  };

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  }, []);

  const openLeadFromMembers = (lead) => {
    if (!lead?.id && !lead?.lead_id) return;
    setMembersOpen(false);
    setSelectedLead(lead);
    setIsLeadModalOpen(true);
  };

  const fetchFlows = async (acctId, authId) => {
    const owner = acctId || authId;
    if (!owner) return;

    const { data: flows, error } = await supabase
      .from("automation_flows")
      .select("*")
      .or(`is_standard.eq.true,user_id.eq.${owner}`)
      .order("updated_at", { ascending: false });

    if (error) {
      alert("Error loading flows: " + error.message);
      return;
    }
    setAllFlows(flows || []);
  };

  const loadColorSettings = async (uid) => {
    if (!uid) return;
    const { data, error } = await supabase
      .from("automation_color_settings")
      .select("trigger_color,email_color,delay_color,condition_color")
      .eq("user_id", uid)
      .maybeSingle();

    if (error && error.code !== "PGRST116") return;

    if (data) {
      setTriggerColor(data.trigger_color || "#22c55e");
      setEmailColor(data.email_color || "#eab308");
      setDelayColor(data.delay_color || "#f97316");
      setConditionColor(data.condition_color || "#a855f7");
    }
  };

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const session = sess?.session;
      const user = session?.user;
      if (!user) return;

      setAuthUserId(user.id);

      const { data: acct } = await supabase
        .from("accounts")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      const acctId = acct?.id || null;
      setAccountId(acctId);

      await fetchFlows(acctId, user.id);
      await loadColorSettings(user.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          color:
            n.type === "trigger"
              ? triggerColor
              : n.type === "email"
              ? emailColor
              : n.type === "delay"
              ? delayColor
              : n.type === "condition"
              ? conditionColor
              : n.data.color,
        },
      }))
    );
  }, [triggerColor, emailColor, delayColor, conditionColor, setNodes]);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges]
  );

  const handleNodeDoubleClick = (_, node) => setActiveNode(node);

  const updateNodeFromDrawer = (newData) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === activeNode.id ? { ...n, data: newData } : n))
    );
    setActiveNode(null);
  };

  useEffect(() => {
    const handleClick = (e) => {
      if (!fileMenuOpen) return;
      const menu = fileMenuRef.current;
      const btn = fileButtonRef.current;
      if (!menu || !btn) return;
      if (!menu.contains(e.target) && !btn.contains(e.target)) {
        setFileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [fileMenuOpen]);

  const loadFlow = async (id) => {
    const { data: f, error } = await supabase
      .from("automation_flows")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !f) {
      alert("Error loading flow: " + (error?.message || "Unknown error"));
      return;
    }

    setFlowId(f.id);
    setFlowName(f.name || "");
    setIsTemplateFlow(!!f.is_standard);

    const loadedNodes =
      typeof f.nodes === "string" ? JSON.parse(f.nodes) : f.nodes || [];
    const loadedEdges =
      typeof f.edges === "string" ? JSON.parse(f.edges) : f.edges || [];

    setNodes(
      loadedNodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          onNodeClick: handleNodeClick,
          type: n.type,
          color:
            n.type === "trigger"
              ? triggerColor
              : n.type === "email"
              ? emailColor
              : n.type === "delay"
              ? delayColor
              : n.type === "condition"
              ? conditionColor
              : n.data.color,
          activeCount:
            n.type === "trigger" ? triggerActive : n.data?.activeCount,
        },
      }))
    );
    setEdges(loadedEdges);
    setNodeStats({});
    toastMsg("Flow Loaded");
  };

  const saveFlow = async () => {
    try {
      const token = await getToken();
      if (!token) throw new Error("Missing session token.");

      const res = await fetch("/api/automation/flows/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          mode: "save",
          flow_id: flowId,
          is_template: !!isTemplateFlow,
          name: flowName || "Untitled Flow",
          nodes,
          edges,
        }),
      });

      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) throw new Error(j?.error || `HTTP ${res.status}`);

      if (j.flow?.id) setFlowId(j.flow.id);
      if (typeof j.flow?.is_standard === "boolean")
        setIsTemplateFlow(!!j.flow.is_standard);

      await fetchFlows(accountId, authUserId);
      toastMsg(j.action || "Saved");
    } catch (err) {
      alert("Error saving flow: " + (err?.message || String(err)));
    }
  };

  const exportFlow = () => {
    const data = { name: flowName || "Flow", nodes, edges };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${flowName || "flow"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const uploadFlowFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    let imported = null;
    try {
      imported = JSON.parse(text);
    } catch {
      alert("Invalid JSON file");
      return;
    }

    setNodes(imported.nodes || []);
    setEdges(imported.edges || []);
    setFlowName(imported.name || "Imported Flow");
    setFlowId(null);
    setIsTemplateFlow(false);
    setNodeStats({});
    toastMsg("Flow Imported");
  };

  const addNode = (type) => {
    const id = `${type}-${Date.now()}`;
    const color =
      type === "trigger"
        ? triggerColor
        : type === "email"
        ? emailColor
        : type === "delay"
        ? delayColor
        : type === "condition"
        ? conditionColor
        : "#444";

    setNodes((n) => [
      ...n,
      {
        id,
        type,
        position: { x: 250 + Math.random() * 150, y: 100 + n.length * 120 },
        data: {
          label: type.charAt(0).toUpperCase() + type.slice(1),
          color,
          ...(type === "trigger" ? { activeCount: triggerActive } : {}),
        },
      },
    ]);
  };

  const handleColorSave = async (newColors) => {
    if (!authUserId) return;

    const payload = {
      user_id: authUserId,
      trigger_color: newColors.trigger_color,
      email_color: newColors.email_color,
      delay_color: newColors.delay_color,
      condition_color: newColors.condition_color,
    };

    const { data, error } = await supabase
      .from("automation_color_settings")
      .upsert(payload, { onConflict: "user_id" })
      .select()
      .single();

    if (error) {
      alert("Error saving colours: " + error.message);
      return;
    }

    setTriggerColor(data.trigger_color);
    setEmailColor(data.email_color);
    setDelayColor(data.delay_color);
    setConditionColor(data.condition_color);

    toastMsg("Colours Updated");
    setShowColorModal(false);
  };

  const fetchNodeStats = useCallback(async () => {
    if (!flowId) return;
    try {
      const res = await fetch(
        `/api/automation/engine/node-stats?flow_id=${encodeURIComponent(flowId)}`
      );
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) return;

      setNodeStats(j.stats || {});
      setTriggerActive(Number(j.trigger_active || 0));

      setNodes((nds) =>
        nds.map((n) => {
          const countAtNode = (j.counts || {})[n.id] || 0;
          if (n.type === "trigger") {
            return {
              ...n,
              data: { ...n.data, activeCount: Number(j.trigger_active || 0) },
            };
          }
          if (n.type === "email") {
            const s = (j.stats || {})?.[n.id] || {
              processed: 0,
              delivered: 0,
              opened: 0,
              clicked: 0,
            };
            return { 
              ...n, 
              data: { 
                ...n.data, 
                stats: s, 
                count: countAtNode,
                activeMembers: countAtNode, // Show how many members are at this node
                onNodeClick: handleNodeClick, // Pass click handler to open members modal
              } 
            };
          }
          if (n.type === "condition") {
            const s = (j.stats || {})?.[n.id] || {};
            const incomingEdge = (edges || []).find(
              (e) => String(e?.target) === String(n.id)
            );
            const incomingNode = incomingEdge
              ? nds.find((x) => String(x?.id) === String(incomingEdge.source))
              : null;
            const incomingEmailStats = incomingNode?.type === "email"
              ? (j.stats || {})?.[incomingNode.id] || null
              : null;
            return { 
              ...n, 
              data: { 
                ...n.data, 
                stats: s,
                activeMembers: s.activeMembers || 0,
                hoursRemaining: s.hoursRemaining || null,
                waitHours: s.waitHours || 24,
                incomingEmailStats,
                incomingEmailLabel: incomingNode?.data?.label || "Previous Email",
              } 
            };
          }
          return { ...n, data: { ...n.data, count: countAtNode } };
        })
      );
    } catch {}
  }, [flowId, setNodes, edges]);

  useEffect(() => {
    if (!flowId) return;
    fetchNodeStats();
    const t = setInterval(fetchNodeStats, 5000);
    return () => clearInterval(t);
  }, [flowId, fetchNodeStats]);

  const systemFlows = useMemo(
    () => allFlows.filter((f) => f.is_standard),
    [allFlows]
  );
  const personalFlows = useMemo(
    () => allFlows.filter((f) => !f.is_standard && f.user_id),
    [allFlows]
  );

  return (
    <div style={{ minHeight: "100vh", background: "#020617", color: "#fff" }}>
      <Head>
        <title>Automation Builder</title>
      </Head>

      <div
        style={{
          maxWidth: 1600,
          margin: "0 auto",
          paddingTop: 12,
          display: "flex",
          alignItems: "flex-start",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 230,
            background:
              "radial-gradient(circle at top, rgba(59,130,246,0.12), rgba(2,6,23,1) 55%)",
            padding: 14,
            borderRadius: 16,
            border: "1px solid #1e293b",
            boxShadow: "0 18px 45px rgba(0,0,0,0.6)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginTop: 4,
          }}
        >
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              color: "#9ca3af",
              marginBottom: 10,
              marginTop: 120,
            }}
          >
            Blocks
          </div>

          <button
            onClick={() => setShowColorModal(true)}
            style={{
              ...btn("#3b82f6"),
              background: "#3b82f6",
              boxShadow: "0 0 14px #3b82f6aa",
              marginBottom: 20,
            }}
          >
            🎨 Node Colours
          </button>

          <button onClick={() => addNode("trigger")} style={btn(triggerColor)}>
            ⚡ Trigger
          </button>
          <button onClick={() => addNode("email")} style={btn(emailColor)}>
            ✉️ Email
          </button>
          <button onClick={() => addNode("delay")} style={btn(delayColor)}>
            ⏱ Delay
          </button>
          <button
            onClick={() => addNode("condition")}
            style={btn(conditionColor)}
          >
            🔀 Condition
          </button>
        </div>

        <div style={{ maxWidth: 1320, width: "100%", margin: "0 auto" }}>
          <div
            style={{
              background: "#f97316",
              padding: "22px 28px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderRadius: 16,
              boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
              position: "relative",
              marginBottom: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ fontSize: 48 }}>⚙️</div>

              <div>
                <div style={{ fontSize: 48, fontWeight: 700 }}>
                  Automation Builder
                </div>
                <div style={{ fontSize: 18, fontWeight: 400 }}>
                  Workflows, triggers and actions.
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button
                onClick={() => {
                  if (!flowId) return alert("Load a flow first.");
                  setMembersOpen(true);
                }}
                style={{
                  background: "#020617",
                  color: "#e5e7eb",
                  border: "1px solid rgba(15,23,42,0.7)",
                  borderRadius: 999,
                  padding: "10px 16px",
                  cursor: "pointer",
                  fontWeight: 700,
                  boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
                  fontSize: 18,
                  opacity: flowId ? 1 : 0.6,
                }}
              >
                👥 Members
              </button>

              <div style={{ position: "relative" }} ref={fileMenuRef}>
                <button
                  ref={fileButtonRef}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFileMenuOpen((s) => !s);
                  }}
                  style={{
                    background: "#020617",
                    color: "#e5e7eb",
                    border: "1px solid rgba(15,23,42,0.6)",
                    borderRadius: 999,
                    padding: "10px 20px",
                    cursor: "pointer",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
                    fontSize: 20,
                  }}
                >
                  <span>📁 File</span>
                  <span style={{ fontSize: 16 }}>▾</span>
                </button>

                {fileMenuOpen && (
                  <div
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "46px",
                      background:
                        "linear-gradient(145deg, #020617, #0b1120, #020617)",
                      border: "1px solid #1e293b",
                      borderRadius: 12,
                      minWidth: 280,
                      zIndex: 9999,
                      padding: "8px 0 10px",
                      boxShadow: "0 18px 45px rgba(0,0,0,0.7)",
                      overflow: "hidden",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div
                      style={{
                        padding: "8px 16px 6px",
                        borderBottom: "1px solid rgba(148,163,184,0.2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontSize: 16,
                        color: "#9ca3af",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>File</span>
                      <span
                        style={{
                          fontSize: 16,
                          padding: "2px 8px",
                          borderRadius: 999,
                          border: "1px solid rgba(148,163,184,0.4)",
                        }}
                      >
                        Flow: {flowName || "Untitled"}
                      </span>
                    </div>

                    <DropdownItem
                      label="💾 Save"
                      onClick={() => {
                        saveFlow();
                        setFileMenuOpen(false);
                      }}
                    />
                    <DropdownItem
                      label="📄 Save As…"
                      onClick={() => {
                        setSaveAsOpen(true);
                        setFileMenuOpen(false);
                      }}
                    />

                    <Divider />

                    <div
                      style={{
                        padding: "6px 16px 4px",
                        color: "#9ca3af",
                        fontSize: 16,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                      }}
                    >
                      My Flows
                    </div>

                    {personalFlows.map((f) => (
                      <div
                        key={f.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 16px',
                          cursor: 'pointer',
                          transition: 'background 0.2s',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#1e293b'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <span
                          onClick={() => {
                            loadFlow(f.id);
                            setFileMenuOpen(false);
                          }}
                          style={{ flex: 1 }}
                        >
                          {f.name || "My Flow"}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteFlow(f.id, f.name || "My Flow");
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            padding: '4px 8px',
                            fontSize: '16px',
                          }}
                          title="Delete flow"
                        >
                          🗑️
                        </button>
                      </div>
                    ))}

                    <Divider />

                    <div
                      style={{
                        padding: "6px 16px 4px",
                        color: "#9ca3af",
                        fontSize: 16,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                      }}
                    >
                      System Templates
                    </div>

                    {systemFlows.map((f) => (
                      <DropdownItem
                        key={f.id}
                        label={f.name || "Template"}
                        onClick={() => {
                          loadFlow(f.id);
                          setFileMenuOpen(false);
                        }}
                      />
                    ))}

                    <Divider />

                    <DropdownItem
                      label="⬆ Upload Flow (.json)"
                      onClick={() => fileInputRef.current.click()}
                    />
                    <DropdownItem
                      label="⬇ Export Flow (.json)"
                      onClick={() => {
                        exportFlow();
                        setFileMenuOpen(false);
                      }}
                    />
                    <DropdownItem
                      label="🧹 Remove Duplicates"
                      onClick={() => {
                        cleanupDuplicates();
                        setFileMenuOpen(false);
                      }}
                    />
                  </div>
                )}
              </div>

              <input
                type="file"
                ref={fileInputRef}
                accept=".json"
                style={{ display: "none" }}
                onChange={uploadFlowFile}
              />

              <Link
                href="/modules/email"
                style={{
                  background: "#020617",
                  color: "#e5e7eb",
                  border: "1px solid rgba(15,23,42,0.7)",
                  borderRadius: 999,
                  padding: "10px 20px",
                  cursor: "pointer",
                  fontWeight: 600,
                  textDecoration: "none",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
                  fontSize: 20,
                }}
              >
                ← Back
              </Link>
            </div>
          </div>

          <div
            style={{
              marginTop: -2,
              marginBottom: 12,
              padding: "10px 14px",
              borderRadius: 14,
              border: "1px solid rgba(148,163,184,0.18)",
              background:
                "linear-gradient(90deg, rgba(2,6,23,0.60), rgba(15,23,42,0.40))",
              boxShadow: "0 10px 22px rgba(0,0,0,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 16, color: "#e5e7eb" }}>
              Current Flow:{" "}
              <span style={{ color: "#93c5fd" }}>{flowName || "Untitled"} </span>
              <span style={{ color: "#22c55e", marginLeft: 10 }}>
                (Active: {triggerActive})
              </span>
              {queueStatus?.queue?.counts?.pending > 0 && (
                <span style={{ color: "#f59e0b", marginLeft: 10 }}>
                  📧 {queueStatus.queue.counts.pending} queued
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button
                onClick={() => setResetConfirmOpen(true)}
                title="Clear all runs, queued emails, and members for this flow only"
                style={{
                  background: "#7c3aed",
                  border: "none",
                  color: "#ffffff",
                  padding: "8px 14px",
                  borderRadius: 999,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: 12,
                  boxShadow: "0 0 12px rgba(124, 58, 237, 0.2)",
                }}
              >
                🔄 Reset Flow
              </button>



              <button
                onClick={saveFlow}
                style={{
                  background: "#22c55e",
                  border: "none",
                  color: "#071022",
                  padding: "8px 14px",
                  borderRadius: 999,
                  fontWeight: 900,
                  cursor: "pointer",
                  boxShadow: "0 0 18px rgba(34,197,94,0.18)",
                }}
              >
                💾 Save
              </button>
            </div>
          </div>

          <div
            style={{
              height: "calc(100vh - 90px)",
              borderRadius: 16,
              overflow: "hidden",
              border: "1px solid #020617",
              boxShadow: "0 18px 45px rgba(0,0,0,0.6)",
            }}
          >
            <div style={{ flex: 1, position: "relative", height: "100%" }}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                fitView
                nodeTypes={nodeTypes}
                onNodeDoubleClick={handleNodeDoubleClick}
                style={{
                  background: "radial-gradient(circle at top, #020617, #020617)",
                }}
              >
                <Background color="#1e293b" gap={18} />
                <Controls />
              </ReactFlow>

              {toast && <div style={toastStyle}>{toast}</div>}
            </div>
          </div>
        </div>
      </div>

      {membersOpen && (
        <FlowMembersModal
          isOpen={membersOpen}
          onClose={() => setMembersOpen(false)}
          flowId={flowId}
          flowName={flowName}
          onOpenLead={openLeadFromMembers}
          getToken={getToken}
          onMembersChanged={fetchNodeStats}
        />
      )}

      <LeadDetailsModal
        isOpen={isLeadModalOpen}
        lead={selectedLead}
        stages={[]}
        userId={authUserId}
        fontScale={1.35}
        onClose={() => {
          setIsLeadModalOpen(false);
          setSelectedLead(null);
        }}
        onNotesUpdated={() => {}}
      />

      {saveAsOpen && (
        <SaveAsModal
          isOpen={saveAsOpen}
          onClose={() => setSaveAsOpen(false)}
          existingFlows={personalFlows}
          currentName={flowName}
          onSaveAs={async (newName) => {
            try {
              const token = await getToken();
              if (!token) throw new Error("Missing session token.");

              const res = await fetch("/api/automation/flows/save", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  mode: "save_as",
                  flow_id: flowId,
                  is_template: !!isTemplateFlow,
                  name: newName,
                  nodes,
                  edges,
                }),
              });

              const j = await res.json().catch(() => null);
              if (!res.ok || !j?.ok) {
                throw new Error(j?.error || `HTTP ${res.status}`);
              }

              setFlowId(j.flow?.id || null);
              setIsTemplateFlow(false);
              setFlowName(j.flow?.name || newName);

              await fetchFlows(accountId, authUserId);
              toastMsg("Flow Saved As New");
              setSaveAsOpen(false);
            } catch (e) {
              alert("Save As failed: " + (e?.message || String(e)));
            }
          }}
        />
      )}

      {resetConfirmOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
          onClick={() => !isResetting && setResetConfirmOpen(false)}
        >
          <div
            style={{
              background: "#1a1f2e",
              border: "2px solid #ef4444",
              borderRadius: 12,
              padding: 32,
              maxWidth: 500,
              color: "#e5e7eb",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 16px 0", color: "#ef4444", fontSize: 24 }}>
              ⚠️ Reset Flow Data?
            </h2>

            <p style={{ margin: "0 0 12px 0", lineHeight: 1.6 }}>
              You are about to <strong>permanently delete</strong> all data for flow:
            </p>

            <p style={{ margin: "12px 0 24px 0", background: "#020617", padding: 12, borderRadius: 8, color: "#93c5fd", fontWeight: 600 }}>
              {flowName || "Untitled Flow"}
            </p>

            <p style={{ margin: "0 0 24px 0", lineHeight: 1.6, color: "#fca5a5" }}>
              <strong>This will delete:</strong>
              <ul style={{ margin: "8px 0 0 0", paddingLeft: 20 }}>
                <li>All automation runs ({triggerActive} active)</li>
                <li>All queued emails ({queueStatus?.queue?.counts?.pending || 0} pending)</li>
                <li>All flow members</li>
                <li>All activity logs</li>
              </ul>
            </p>

            <p style={{ margin: "0 0 24px 0", background: "#7c2d12", padding: 12, borderRadius: 8, color: "#fcd34d" }}>
              ⛔ <strong>This action CANNOT be undone.</strong> Data will be permanently lost.
            </p>

            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button
                onClick={() => setResetConfirmOpen(false)}
                disabled={isResetting}
                style={{
                  background: "#374151",
                  border: "none",
                  color: "#e5e7eb",
                  padding: "10px 20px",
                  borderRadius: 6,
                  cursor: isResetting ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  opacity: isResetting ? 0.6 : 1,
                }}
              >
                Cancel
              </button>

              <button
                onClick={resetFlow}
                disabled={isResetting}
                style={{
                  background: "#ef4444",
                  border: "none",
                  color: "#ffffff",
                  padding: "10px 20px",
                  borderRadius: 6,
                  cursor: isResetting ? "not-allowed" : "pointer",
                  fontWeight: 700,
                  boxShadow: "0 0 12px rgba(239, 68, 68, 0.3)",
                  opacity: isResetting ? 0.7 : 1,
                }}
              >
                {isResetting ? "⏳ Resetting..." : "🗑️ Delete All Data"}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeNode?.type === "trigger" && (
        <TriggerNodeDrawer
          node={activeNode}
          onSave={updateNodeFromDrawer}
          onClose={() => setActiveNode(null)}
        />
      )}

      {activeNode?.type === "email" && (
        <EmailNodeDrawer
          node={activeNode}
          onSave={updateNodeFromDrawer}
          onClose={() => setActiveNode(null)}
          userId={authUserId}
        />
      )}

      {activeNode?.type === "delay" && (
        <DelayNodeDrawer
          node={activeNode}
          onSave={updateNodeFromDrawer}
          onClose={() => setActiveNode(null)}
        />
      )}

      {activeNode?.type === "condition" && (
        <ConditionNodeDrawer
          node={activeNode}
          onSave={updateNodeFromDrawer}
          onClose={() => setActiveNode(null)}
        />
      )}



      {showColorModal && (
        <NodeColorModal
          initialColors={{
            trigger_color: triggerColor,
            email_color: emailColor,
            delay_color: delayColor,
            condition_color: conditionColor,
          }}
          onClose={() => setShowColorModal(false)}
          onSave={handleColorSave}
        />
      )}
    </div>
  );
}

/* ---------------- MEMBERS MODAL (WORKING) ---------------- */
function FlowMembersModal({
  isOpen,
  onClose,
  flowId,
  flowName,
  onOpenLead,
  getToken,
  onMembersChanged,
}) {
  const [lists, setLists] = useState([]);
  const [selectedListId, setSelectedListId] = useState("");
  const [members, setMembers] = useState([]);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const [busyDeleteId, setBusyDeleteId] = useState(null);

  const [toast, setToast] = useState("");
  const [lastDebug, setLastDebug] = useState(null);

  const toastMsg = (m) => {
    setToast(m);
    setTimeout(() => setToast(""), 3200);
  };

  const loadLists = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch("/api/automation/lists", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        const msg2 = j?.error || `HTTP ${res.status}`;
        toastMsg(`Lists failed: ${msg2}`);
        return;
      }

      const arr = j.lists || [];
      setLists(arr);

      const stillValid = arr.some(
        (x) => String(x.id) === String(selectedListId)
      );
      if ((!selectedListId || !stillValid) && arr[0]?.id) {
        setSelectedListId(arr[0].id);
      }
    } catch (e) {
      toastMsg(`Lists failed: ${e?.message || String(e)}`);
    }
  }, [getToken, selectedListId]);

  const loadMembers = useCallback(async () => {
    if (!flowId) return;
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch(
        `/api/automation/flow-members?flow_id=${encodeURIComponent(flowId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        const msg2 = j?.error || `HTTP ${res.status}`;
        toastMsg(`Members failed: ${msg2}`);
        return;
      }

      setMembers(j.members || []);
      setCount(Number(j.count || (j.members || []).length || 0));
    } catch (e) {
      toastMsg(`Members failed: ${e?.message || String(e)}`);
    }
  }, [flowId, getToken]);

  // ✨ NEW: Reload members and lists when modal opens
  useEffect(() => {
    if (isOpen) {
      loadLists();
      loadMembers();
    }
  }, [isOpen, flowId, loadLists, loadMembers]);

  const importSelectedList = useCallback(async () => {
    if (!flowId) return;
    if (!selectedListId) return toastMsg("Pick a list first.");

    setBusy(true);
    setLastDebug(null);

    try {
      const token = await getToken();
      if (!token) throw new Error("Missing session token.");

      const res = await fetch("/api/automation/members/add-list", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ flow_id: flowId, list_id: selectedListId }),
      });

      const j = await res.json().catch(() => null);

      if (!res.ok || !j?.ok) {
        setLastDebug(j?.debug || null);
        const extra = j?.debug
          ? `\n\nDEBUG:\n${JSON.stringify(j.debug, null, 2)}`
          : "";
        throw new Error((j?.error || `HTTP ${res.status}`) + extra);
      }

      setLastDebug(j?.debug || null);

      const inserted = Number(j.inserted ?? j.imported ?? j.inserted_count ?? 0);
      const existing = Number(j.existing ?? j.total_existing ?? 0);
      const reactivated = Number(j.reactivated ?? 0);
      const total = Number(j.total ?? (inserted + existing) ?? 0);

      if (inserted === 0 && existing === 0 && reactivated === 0) {
        const win = j?.debug?.memberWinning;
        const keys = j?.debug?.memberRowKeys;
        const extract = j?.debug?.extract;
        const leadCol = j?.debug?.leadsEmailCol;

        const summary = [
          `Imported: 0 • Reactivated: 0 • Total: 0`,
          j?.message ? `Message: ${j.message}` : null,
          win
            ? `Member source: ${win.table} via ${win.fk} (rows: ${win.rows})`
            : null,
          keys?.length ? `Member row keys: ${keys.join(", ")}` : null,
          extract
            ? `Extract: leadIds=${extract.directLeadIds} emails=${extract.emails}`
            : null,
          leadCol ? `Leads email column: ${leadCol}` : null,
          `↓ Open DEBUG panel below`,
        ]
          .filter(Boolean)
          .join("\n");

        toastMsg(summary);
      } else {
        toastMsg(
          `Imported: ${inserted} • Reactivated: ${reactivated} • Total: ${total}`
        );
      }

      await loadMembers();
      // Refresh stats immediately to show updated counts
      if (onMembersChanged) {
        await new Promise(r => setTimeout(r, 500));
        onMembersChanged();
      }
    } catch (e) {
      toastMsg(`Import failed: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [flowId, selectedListId, getToken, loadMembers, onMembersChanged]);

  const deleteMember = useCallback(
    async (leadId) => {
      if (!flowId || !leadId) return;

      const yes = window.confirm(
        "Remove this member from the flow?\n\nThis only removes them from this flow (it does NOT delete the lead)."
      );
      if (!yes) return;

      setBusyDeleteId(String(leadId));
      try {
        const token = await getToken();
        if (!token) throw new Error("Missing session token.");

        const res = await fetch("/api/automation/members/remove-person", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ flow_id: flowId, lead_id: String(leadId) }),
        });

        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) {
          throw new Error(j?.error || `HTTP ${res.status}`);
        }

        setMembers((prev) =>
          (prev || []).filter(
            (m) => String(m?.id || m?.lead_id) !== String(leadId)
          )
        );
        setCount((c) => Math.max(0, Number(c || 0) - 1));
        toastMsg("Member removed from flow.");
      } catch (e) {
        toastMsg(`Delete failed: ${e?.message || String(e)}`);
      } finally {
        setBusyDeleteId(null);
      }
    },
    [flowId, getToken]
  );

  useEffect(() => {
    if (!isOpen) return;
    loadLists();
    // DISABLED: Don't auto-reload members on open - causes deleted members to reappear
    // loadMembers();
  }, [isOpen, loadLists]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: "min(980px, 95vw)",
          background: "linear-gradient(180deg, #0b1224, #070b18)",
          border: "1px solid rgba(148,163,184,0.18)",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
          overflow: "hidden",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid rgba(148,163,184,0.16)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontWeight: 700 }}>👥 Flow Members</div>
            <div style={{ color: "#dfbe2dff", fontSize: 16 }}>
              {flowName || "Untitled"} • {flowId}
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid rgba(148,163,184,0.25)",
              color: "#e5e7eb",
              borderRadius: 10,
              padding: "6px 10px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 14 }}>
          <div style={{ fontSize: 16, color: "#94a3b8", fontWeight: 600 }}>
            ADD A LIST TO THIS FLOW
          </div>

          <div
            style={{
              marginTop: 8,
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <select
              value={selectedListId}
              onChange={(e) => setSelectedListId(e.target.value)}
              style={{
                minWidth: 320,
                background: "#0b1022",
                color: "#e5e7eb",
                border: "1px solid rgba(148,163,184,0.22)",
                borderRadius: 10,
                padding: "10px 12px",
                fontWeight: 600,
                outline: "none",
              }}
            >
              {(lists || []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name || "Untitled List"}
                </option>
              ))}
              {!lists?.length && <option value="">No lists found</option>}
            </select>

            <button
              onClick={importSelectedList}
              disabled={busy || !selectedListId}
              style={{
                background: "#22c55e",
                border: "none",
                color: "#071022",
                padding: "10px 14px",
                borderRadius: 999,
                fontWeight: 700,
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.65 : 1,
              }}
            >
              {busy ? "Importing…" : "Import"}
            </button>

            <div
              style={{
                marginLeft: "auto",
                padding: "10px 12px",
                borderRadius: 999,
                border: "1px solid rgba(148,163,184,0.22)",
                fontWeight: 700,
                color: "#e5e7eb",
              }}
            >
              Count: {count}
            </div>
          </div>

          <div style={{ marginTop: 12, color: "#94a3b8", fontSize: 16 }}>
            If import fails OR imports 0, the debug panel below will show why.
          </div>

          <div
            style={{
              marginTop: 12,
              border: "1px solid rgba(148,163,184,0.16)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "10px 12px",
                background: "rgba(148,163,184,0.06)",
                fontWeight: 700,
                color: "#e5e7eb",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>MEMBERS IN THIS FLOW</span>
              <span style={{ color: "#94a3b8", fontSize: 16 }}>
                Click a member to open
              </span>
            </div>

            <div style={{ maxHeight: 320, overflow: "auto" }}>
              {!members?.length ? (
                <div style={{ padding: 14, color: "#94a3b8" }}>
                  No members yet.
                </div>
              ) : (
                members.map((m) => {
                  const leadId = m?.id || m?.lead_id;
                  return (
                    <div
                      key={leadId || `${m.lead_id}-${m.created_at || ""}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        borderTop: "1px solid rgba(148,163,184,0.10)",
                        padding: "10px 12px",
                      }}
                    >
                      <button
                        onClick={() => onOpenLead && onOpenLead(m)}
                        style={{
                          flex: 1,
                          textAlign: "left",
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          color: "#e5e7eb",
                          padding: 0,
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.opacity = 0.95)
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.opacity = 1)
                        }
                      >
                        <div style={{ fontWeight: 700 }}>
                          {m.name || m.email || m.phone || m.lead_id}
                        </div>
                        <div style={{ fontSize: 16, color: "#94a3b8" }}>
                          {m.email ? `Email: ${m.email} • ` : ""}
                          {m.phone ? `Phone: ${m.phone} • ` : ""}
                          Status: {m.status || "active"}
                        </div>
                      </button>

                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteMember(leadId);
                        }}
                        disabled={!leadId || busyDeleteId === String(leadId)}
                        style={{
                          background:
                            busyDeleteId === String(leadId)
                              ? "rgba(239,68,68,0.35)"
                              : "rgba(239,68,68,0.14)",
                          border: "1px solid rgba(239,68,68,0.55)",
                          color: "#fecaca",
                          padding: "8px 12px",
                          borderRadius: 999,
                          fontWeight: 900,
                          cursor:
                            busyDeleteId === String(leadId)
                              ? "not-allowed"
                              : "pointer",
                          opacity: leadId ? 1 : 0.5,
                          minWidth: 92,
                          textAlign: "center",
                        }}
                        title="Remove member from this flow"
                      >
                        {busyDeleteId === String(leadId)
                          ? "Deleting…"
                          : "Delete"}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {toast && (
            <div
              style={{
                marginTop: 10,
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(148,163,184,0.18)",
                background: "rgba(2,6,23,0.65)",
                fontWeight: 700,
                color: "#e5e7eb",
                whiteSpace: "pre-wrap",
              }}
            >
              {toast}
            </div>
          )}

          {lastDebug && (
            <details
              style={{
                marginTop: 10,
                borderRadius: 12,
                border: "1px solid rgba(148,163,184,0.18)",
                background: "rgba(2,6,23,0.55)",
                padding: 10,
              }}
            >
              <summary
                style={{ cursor: "pointer", fontWeight: 900, color: "#93c5fd" }}
              >
                DEBUG (click to open)
              </summary>
              <pre
                style={{
                  marginTop: 10,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontSize: 13,
                  color: "#e5e7eb",
                }}
              >
                {JSON.stringify(lastDebug, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- SAVE AS MODAL ---------------- */
function SaveAsModal({ isOpen, onClose, currentName, onSaveAs }) {
  const [name, setName] = useState(currentName || "");
  useEffect(() => setName(currentName || ""), [currentName]);
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: "min(520px, 95vw)",
          background: "linear-gradient(180deg, #0b1224, #070b18)",
          border: "1px solid rgba(148,163,184,0.18)",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
          overflow: "hidden",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid rgba(148,163,184,0.16)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontWeight: 700 }}>📄 Save As…</div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid rgba(148,163,184,0.25)",
              color: "#e5e7eb",
              borderRadius: 10,
              padding: "6px 10px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 14 }}>
          <div style={{ color: "#94a3b8", fontSize: 16, fontWeight: 600 }}>
            NEW FLOW NAME
          </div>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My new flow name"
            style={{
              width: "100%",
              marginTop: 8,
              background: "#0b1022",
              color: "#e5e7eb",
              border: "1px solid rgba(148,163,184,0.22)",
              borderRadius: 10,
              padding: "10px 12px",
              fontWeight: 600,
              outline: "none",
            }}
          />

          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
            <button
              onClick={() => onSaveAs && onSaveAs(name || "Untitled Flow")}
              style={{
                background: "#22c55e",
                border: "none",
                color: "#071022",
                padding: "10px 14px",
                borderRadius: 999,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Save As
            </button>

            <button
              onClick={onClose}
              style={{
                background: "#0b1022",
                border: "1px solid rgba(148,163,184,0.22)",
                color: "#e5e7eb",
                padding: "10px 14px",
                borderRadius: 999,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// UI helpers
const btn = (c) => ({
  background: c,
  border: "none",
  color: "#0b1120",
  padding: "14px 14px",
  borderRadius: 12,
  fontWeight: 600,
  cursor: "pointer",
  boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
  fontSize: 16,
});

const toastStyle = {
  position: "absolute",
  bottom: 14,
  left: 14,
  background: "rgba(2,6,23,0.85)",
  border: "1px solid rgba(148,163,184,0.25)",
  padding: "10px 12px",
  borderRadius: 12,
  fontWeight: 600,
  color: "#e5e7eb",
};

function Divider() {
  return (
    <div
      style={{
        height: 1,
        background: "rgba(148,163,184,0.18)",
        margin: "8px 0",
      }}
    />
  );
}

function DropdownItem({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        padding: "10px 16px",
        color: "#e5e7eb",
        cursor: "pointer",
        fontSize: 16,
        fontWeight: 600,
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "rgba(148,163,184,0.08)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {label}
    </button>
  );
}
