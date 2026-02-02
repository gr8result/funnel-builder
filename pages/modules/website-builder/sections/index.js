export default function WebsiteBuilderSections() {
  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 20, fontWeight: 800 }}>Website Builder Sections</h1>
      <p style={{ marginTop: 10 }}>
        This route exists only because Next.js treats everything under <code>/pages</code> as a page.
      </p>
      <p style={{ marginTop: 10, opacity: 0.75 }}>
        The real builder section files should live under <code>/components/website-builder/sections</code>.
      </p>
    </div>
  );
}

