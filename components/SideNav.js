// /components/SideNav.js 
import Link from "next/link";
import { useRouter } from "next/router";
import { useState, useEffect } from "react";
import ICONS from "./iconMap";

// Same network / circle style icon for Communities (Option 3)
const CommunitiesIcon = ({ size = 18, color = "#fff" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="7" cy="7" r="3.2" />
    <circle cx="17" cy="7" r="3.2" />
    <circle cx="12" cy="17" r="3.2" />
    <line x1="9" y1="8.6" x2="10.6" y2="14.4" />
    <line x1="15" y1="8.6" x2="13.4" y2="14.4" />
  </svg>
);

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: ICONS.dashboard, color: "u01" },

  // ⭐ Priority To-Do List (same as dashboard card 1)
  {
    href: "/store/dashboard",
    label: "Priority To-Do List",
    icon: ICONS.dashboard,
    color: "u01", // same green as dashboard
  },

  {
    href: "/modules/affiliates/affiliate-marketplace",
    label: "Affiliate Marketplace",
    icon: ICONS.affiliates,
    color: "u02",
  },
  { href: "/assets", label: "Assets", icon: ICONS.assets, color: "u03" },
  { href: "/leads", label: "Leads", icon: ICONS.leads, color: "u04" },
  { href: "/account", label: "Account", icon: ICONS.account, color: "u05" },
  { href: "/billing", label: "Billing & Modules", icon: ICONS.billing, color: "u06" }, // orange
  {
    href: "/modules/communities",
    label: "Communities",
    icon: CommunitiesIcon,
    color: "u17", // teal now
  },
  {
    href: "/modules/accounting",
    label: "Accounting",
    icon: ICONS.billing, // you can replace with a dedicated accounting icon later
    color: "u21", // blue, matches dashboard
  },
];

// ⭐ MODULE ITEMS — Email first, CRM second, then everything else
const MODULE_ITEMS = [
  {
    href: "/modules/email",
    label: "Email marketing",
    icon: ICONS.email,
    color: "u10",
  },
  {
    href: "/modules/email/crm",
    label: "CRM",
    icon: ICONS.email, // same envelope icon as Email marketing
    color: "u22", // light blue
  },
  {
    href: "/modules/website-builder",
    label: "Website builder",
    icon: ICONS.websiteBuilder,
    color: "u07",
  },
  {
    href: "/funnels",
    label: "Funnels",
    icon: ICONS.funnels,
    color: "u08",
  },
  {
    href: "/modules/business-automation",
    label: "Business automation",
    icon: ICONS.automation,
    color: "u09",
  },
  {
    href: "/modules/courses",
    label: "Online courses",
    icon: ICONS.courses,
    color: "u12",
  },
  {
    href: "/modules/physical-products",
    label: "Physical products",
    icon: ICONS.products,
    color: "u13",
  },
  {
    href: "/modules/webinars",
    label: "Webinars",
    icon: ICONS.webinars,
    color: "u14",
  },
  {
    href: "/modules/booking-calendar",
    label: "Calendar",
    icon: ICONS.calendar,
    color: "u15",
  },
  {
    href: "/modules/pipelines",
    label: "Subscription pipeline",
    icon: ICONS.subscription,
    color: "u16",
  },
  {
    href: "/modules/social-media",
    label: "Social Media",
    icon: ICONS.social,
    color: "u18",
  },
  {
    href: "/modules/subaccounts",
    label: "Subaccounts",
    icon: ICONS.subaccounts,
    color: "u19",
  },
  {
    href: "/modules/digital-products",
    label: "Digital products",
    icon: ICONS.digitalProducts,
    color: "u20",
  },
];

export default function SideNav() {
  const router = useRouter();
  const [activePath, setActivePath] = useState(router.pathname);

  useEffect(() => {
    if (router.isReady) setActivePath(router.pathname);
  }, [router.pathname, router.isReady]);

  const isActive = (href) => {
    if (!router.isReady) return false;
    return activePath === href || activePath.startsWith(href + "/");
  };

  return (
    <aside className="sidenav">
      <div className="branding">
        <img src="/logo.png" alt="Company Logo" className="logo" />
        <div className="brand-text">
          <div>GR8 RESULT</div>
          <div>Digital Solutions</div>
        </div>
      </div>

      <div className="sections">
        <div className="section">
          <h4>Core</h4>
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href}>
              <div
                className={`nav-item ${item.color} ${
                  isActive(item.href) ? "active" : ""
                }`}
              >
                <span className="icon">
                  {item.icon && <item.icon color="#fff" size={18} />}
                </span>
                <span className="label">{item.label}</span>
              </div>
            </Link>
          ))}
        </div>

        <div className="section">
          <h4>Modules</h4>
          {MODULE_ITEMS.map((item) => (
            <Link key={item.href} href={item.href}>
              <div
                className={`nav-item ${item.color} ${
                  isActive(item.href) ? "active" : ""
                }`}
              >
                <span className="icon">
                  {item.icon && <item.icon color="#fff" size={18} />}
                </span>
                <span className="label">{item.label}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="bottom-actions">
        <button className="funnel-btn import">Import Funnel</button>
        <button className="funnel-btn export">Export Funnel</button>
      </div>

      <style jsx>{`
        .sidenav {
          position: fixed;
          top: 0;
          left: 0;
          width: 300px;
          height: 100vh;
          background: #111827;
          color: #fff;
          display: flex;
          flex-direction: column;
          padding: 18px;
          box-sizing: border-box;
          overflow-y: auto;
          overflow-x: hidden;
          scrollbar-width: thin;
          scrollbar-color: #374151 #111827;
          z-index: 100;
        }

        .branding {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 18px;
          border-bottom: 1px solid #1f2937;
          padding-bottom: 14px;
        }

        .logo {
          width: 44px;
          height: 44px;
          object-fit: contain;
          border-radius: 0;
        }

        .brand-text {
          display: flex;
          flex-direction: column;
          font-size: 14px;
          color: #fff;
          line-height: 1.2;
        }

        .sidenav::-webkit-scrollbar {
          width: 8px;
        }
        .sidenav::-webkit-scrollbar-thumb {
          background: #374151;
          border-radius: 4px;
        }

        .sections {
          flex: 1;
        }

        .section {
          margin-bottom: 22px;
        }

        h4 {
          font-size: 14px;
          margin: 12px 0;
          color: #9ca3af;
        }

        .nav-item {
          display: flex;
          align-items: center;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          margin-bottom: 8px;
          transition: background 0.2s ease, border 0.2s ease, color 0.2s ease;
          color: #fff;
          border: 2px solid transparent;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .nav-item .icon {
          flex-shrink: 0;
          font-size: 20px;
          margin-right: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* Outline colours */
        .u01 { border-color: #22c55e; }
        .u02 { border-color: #06b6d4; }
        .u03 { border-color: #6366f1; }
        .u04 { border-color: #f43f5e; }
        .u05 { border-color: #8b5cf6; }
        .u06 { border-color: #f59e0b; } /* Billing */
        .u07 { border-color: #3b82f6; }
        .u08 { border-color: #d946ef; }
        .u09 { border-color: #fb923c; }
        .u10 { border-color: #facc15; }
        .u12 { border-color: #ec4899; }
        .u13 { border-color: #0ea5e9; }
        .u14 { border-color: #ef4444; }
        .u15 { border-color: #84cc16; }
        .u16 { border-color: #7c3aed; }
        .u17 { border-color: #14b8a6; } /* Communities teal */
        .u18 { border-color: #06b6d4; }
        .u19 { border-color: #10b981; }
        .u20 { border-color: #475569; }
        .u21 { border-color: #0ea5e9; } /* Accounting blue */
        .u22 { border-color: #38bdf8; } /* CRM light blue – matches dashboard card */

        /* Active + hover fill colours (dashboard-style full colour) */
        .nav-item.u01:hover,
        .active.u01 { background: #22c55e; border-color: #22c55e; color: #000; }
        .nav-item.u02:hover,
        .active.u02 { background: #06b6d4; border-color: #06b6d4; color: #000; }
        .nav-item.u03:hover,
        .active.u03 { background: #6366f1; border-color: #6366f1; color: #000; }
        .nav-item.u04:hover,
        .active.u04 { background: #f43f5e; border-color: #f43f5e; color: #000; }
        .nav-item.u05:hover,
        .active.u05 { background: #8b5cf6; border-color: #8b5cf6; color: #000; }
        .nav-item.u06:hover,
        .active.u06 { background: #f59e0b; border-color: #f59e0b; color: #000; }
        .nav-item.u07:hover,
        .active.u07 { background: #3b82f6; border-color: #3b82f6; color: #000; }
        .nav-item.u08:hover,
        .active.u08 { background: #d946ef; border-color: #d946ef; color: #000; }
        .nav-item.u09:hover,
        .active.u09 { background: #fb923c; border-color: #fb923c; color: #000; }
        .nav-item.u10:hover,
        .active.u10 { background: #facc15; border-color: #facc15; color: #000; }
        .nav-item.u12:hover,
        .active.u12 { background: #ec4899; border-color: #ec4899; color: #000; }
        .nav-item.u13:hover,
        .active.u13 { background: #0ea5e9; border-color: #0ea5e9; color: #000; }
        .nav-item.u14:hover,
        .active.u14 { background: #ef4444; border-color: #ef4444; color: #000; }
        .nav-item.u15:hover,
        .active.u15 { background: #84cc16; border-color: #84cc16; color: #000; }
        .nav-item.u16:hover,
        .active.u16 { background: #7c3aed; border-color: #7c3aed; color: #000; }
        .nav-item.u17:hover,
        .active.u17 { background: #14b8a6; border-color: #14b8a6; color: #000; }
        .nav-item.u18:hover,
        .active.u18 { background: #06b6d4; border-color: #06b6d4; color: #000; }
        .nav-item.u19:hover,
        .active.u19 { background: #10b981; border-color: #10b981; color: #000; }
        .nav-item.u20:hover,
        .active.u20 { background: #475569; border-color: #475569; color: #000; }
        .nav-item.u21:hover,
        .active.u21 { background: #0ea5e9; border-color: #0ea5e9; color: #000; }
        .nav-item.u22:hover,
        .active.u22 { background: #38bdf8; border-color: #38bdf8; color: #000; }

        .bottom-actions {
          margin-top: auto;
          display: flex;
          flex-direction: column;
          gap: 10px;
          border-top: 1px solid #374151;
          padding-top: 10px;
        }

        .funnel-btn {
          width: 100%;
          padding: 10px;
          border: none;
          border-radius: 6px;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.2s ease;
          text-align: center;
        }

        .funnel-btn.import {
          background: #22c55e;
          color: #fff;
        }
        .funnel-btn.import:hover { background: #16a34a; }

        .funnel-btn.export {
          background: #ef4444;
          color: #fff;
        }
        .funnel-btn.export:hover { background: #b91c1c; }
      `}</style>
    </aside>
  );
}
