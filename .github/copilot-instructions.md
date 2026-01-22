# AI Coding Agent Instructions for Funnel Builder

## Architecture Overview
This is a Next.js-based funnel builder application with modular components for sales funnels, CRM, email marketing, automation, and more. Key architectural elements:

- **Frontend**: Next.js with React components organized by feature (e.g., `/components/automation/`, `/components/email/`)
- **Backend**: Supabase for data storage and authentication
- **Integrations**: Stripe (payments), Twilio (telephony), SendGrid (email), OpenAI (AI features), n8n (advanced automation workflows)
- **Data Flow**: UI components → `/lib/` utility functions → Supabase API calls or external service integrations
- **Builders**: Uses ReactFlow for flow diagrams, Craft.js/GrapesJS for drag-and-drop page/website building

## Key Directories & Files
- `/components/`: Feature-organized React components (automation, crm, email, etc.)
- `/lib/`: Core utilities and service integrations (supabaseAdmin.js, sendEmail.js, etc.)
- `/data/`: Static data files (pricing.js, website-templates.js)
- `/pages/`: Next.js pages/routes
- `/n8n-automation/`: Docker setup for n8n workflow automation
- `reset-dev.ps1`: PowerShell script for full development environment reset

## Development Workflows
- **Start dev server**: `npm run dev` (runs Next.js dev server)
- **Full reset**: Run `.\reset-dev.ps1` to clean caches, reinstall deps, and restart (useful when builds break)
- **n8n automation**: `docker-compose up` in `/n8n-automation/` for workflow testing
- **Environment**: Requires `.env.local` with Supabase, SendGrid, Stripe, Twilio keys

## Coding Patterns & Conventions
- **Error Handling**: Graceful fallbacks for missing env vars (e.g., sendEmail.js skips if SENDGRID_API_KEY absent)
- **Component Structure**: Feature-based organization with shared UI in `/components/ui/`
- **Data Fetching**: Direct Supabase calls via `supabaseAdmin` client in lib functions
- **Flows**: Use ReactFlow with custom node types (trigger, email, delay, condition) in FlowCanvas component
- **Builders**: GrapesJS for email/website editing, Craft.js for page building
- **State Management**: Zustand for global state where needed

## Integration Points
- **Supabase**: Primary data store; use `supabaseAdmin` for server-side operations
- **External APIs**: Wrapped in `/lib/` with consistent error handling (ok/error response pattern)
- **n8n**: For complex automations beyond basic flows
- **File Handling**: Supabase storage via `supabaseFiles.js`

## Common Tasks
- Adding new funnel nodes: Extend node types in AutomationBuilder.js and NodeRenderer.js
- New integrations: Add to `/lib/` with graceful config checks
- UI components: Follow existing patterns in `/components/ui/` for consistency</content>
<parameter name="filePath">c:\Users\grant\dev\funnel-builder-clean\.github\copilot-instructions.md