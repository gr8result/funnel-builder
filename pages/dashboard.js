// /pages/dashboard.js
// Dashboard with green banner + full colour hover effect + fixed width 1320px

import Link from "next/link";
import ICONS from "../components/iconMap";

// Simple network / circle style icon for Communities
const CommunitiesIcon = ({ size = 48, color = "#fff" }) => (
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

const CORE = [
  {
    title: "Priority To-Do List",
    desc: "Your important tasks for today, orders, revenue and cart activity today.",
    href: "/store/dashboard",
    icon: ICONS.dashboard,
    color: "#22c55e",
  },
  {
    title: "Affiliate Marketplace",
    desc: "Browse offers, manage products, track sales & payouts.",
    href: "/modules/affiliates/affiliate-marketplace",
    icon: ICONS.affiliates,
    color: "#06b6d4",
  },
  {
    title: "Assets",
    desc: "Manage your upload files, import images and documents.",
    href: "/assets",
    icon: ICONS.assets,
    color: "#6366f1",
  },
  {
    title: "Leads",
    desc: "Track and manage your leads.",
    href: "/leads",
    icon: ICONS.leads,
    color: "#f43f5e",
  },
  {
    title: "Account",
    desc: "View and update your account settings.",
    href: "/account",
    icon: ICONS.account,
    color: "#8b5cf6",
  },
  {
    title: "Billing & Modules",
    desc: "Manage billing, subscriptions and modules.",
    href: "/billing",
    icon: ICONS.billing,
    color: "#f59e0b",
  },
  {
    title: "Communities",
    desc: "Build communities.",
    href: "/modules/communities",
    icon: CommunitiesIcon,
    color: "#14b8a6",
  },
  {
    title: "Accounting",
    desc: "Manage your accounts and finances.",
    href: "/modules/accounting",
    icon: ICONS.billing,
    color: "#0ea5e9",
  },
];

const MODULES = [
  {
    title: "Email marketing",
    desc: "Broadcasts, autoresponders, lists.",
    href: "/modules/email",
    icon: ICONS.email,
    color: "#facc15",
  },
  {
    title: "CRM",
    desc: "Leads, tasks, pipelines & notes.",
    href: "/modules/email/crm",
    icon: ICONS.leads,
    color: "#38bdf8",
  },
  {
    title: "Website builder",
    desc: "Drag and Drop Website/Landing Page Builder.",
    href: "/modules/website-builder",
    icon: ICONS.websiteBuilder,
    color: "#3b82f6",
  },
  {
    title: "Funnels",
    desc: "Build and manage funnels.",
    href: "/funnels",
    icon: ICONS.funnels,
    color: "#d946ef",
  },
  {
    title: "Business automation",
    desc: "Automate workflows.",
    href: "/modules/business-automation",
    icon: ICONS.automation,
    color: "#fb923c",
  },
  {
    title: "Online courses",
    desc: "Host and sell courses.",
    href: "/modules/courses",
    icon: ICONS.courses,
    color: "#ec4899",
  },
  {
    title: "Physical products",
    desc: "Manage store products.",
    href: "/modules/physical-products",
    icon: ICONS.products,
    color: "#0ea5e9",
  },
  {
    title: "Webinars",
    desc: "Host and manage webinars.",
    href: "/modules/webinars",
    icon: ICONS.webinars,
    color: "#ef4444",
  },
  {
    title: "Calendar",
    desc: "Booking and scheduling.",
    href: "/modules/booking-calendar",
    icon: ICONS.calendar,
    color: "#84cc16",
  },
  {
    title: "Subscription pipeline",
    desc: "Track subscriptions.",
    href: "/modules/pipelines",
    icon: ICONS.subscription,
    color: "#7c3aed",
  },
  {
    title: "Social Media",
    desc: "Social media manager.",
    href: "/modules/social-media",
    icon: ICONS.social,
    color: "#06b6d4",
  },
  {
    title: "Subaccounts",
    desc: "Manage client subaccounts.",
    href: "/modules/subaccounts",
    icon: ICONS.subaccounts,
    color: "#10b981",
  },
  {
    title: "Digital products",
    desc: "Sell digital downloads.",
    href: "/modules/digital-products",
    icon: ICONS.digitalProducts,
    color: "#475569",
  },
];

export default function Dashboard() {
  return (
    <div className="wrap">
      <div className="banner">
        <span className="banner-icon">{ICONS.dashboard({ size: 48 })}</span>
        <div className="banner-text">
          <h1 className="banner-title">Dashboard</h1>
          <p className="banner-desc">Quick access to all modules and tools.</p>
        </div>
      </div>

      <h2>Core</h2>
      <div className="grid">
        {CORE.map((item, idx) => (
          <Link key={idx} href={item.href}>
            <div
              className="card"
              style={{
                borderColor: item.color,
                "--hover-color": item.color,
              }}
            >
              <span className="icon">{item.icon({ size: 48 })}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <h2>Modules</h2>
      <div className="grid">
        {MODULES.map((item, idx) => (
          <Link key={idx} href={item.href}>
            <div
              className="card"
              style={{
                borderColor: item.color,
                "--hover-color": item.color,
              }}
            >
              <span className="icon">{item.icon({ size: 48 })}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <style jsx>{`
        .wrap {
          min-height: 100vh;
          background: #0c121a;
          color: #fff;
          padding: 28px 22px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .banner {
          display: flex;
          align-items: center;
          gap: 14px;
          background: #22c55e;
          padding: 18px 22px;
          border-radius: 12px;
          margin-bottom: 26px;
          width: 100%;
          max-width: 1320px;
        }

        .banner-icon {
          background: rgba(255, 255, 255, 0.15);
          border-radius: 50%;
          padding: 8px;
        }

        .banner-title {
          font-size: 48px;
          font-weight: 700;
          line-height: 1.1;
          margin: 0;
        }

        .banner-desc {
          font-size: 16px;
          font-weight: 500;
          margin: 4px 0 0;
          opacity: 0.9;
        }

        h2 {
          width: 100%;
          max-width: 1320px;
          font-size: 24px;
          margin: 22px 0 12px;
          font-weight: 600;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 18px;
          width: 100%;
          max-width: 1320px;
        }

        .card {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 16px;
          border: 2px solid;
          border-radius: 12px;
          background: #0c121a;
          transition: all 0.25s ease;
        }

        .card:hover {
          background: var(--hover-color);
          color: #000;
        }
      `}</style>
    </div>
  );
}
