// Starter agents offered in the New agent dialog. Each is set up to be light on the
// Claude limit: Haiku where the work is routine, low effort, and only the tools it needs.
import type { AgentDraft } from './types'

export interface AgentTemplate {
  id: string
  label: string
  hint: string
  draft: AgentDraft
}

const base = { shape: null, allowed_tools: [], disallowed_tools: [], mcp_servers: [], routines: [], email_triggers: [], quick_prompts: [] } satisfies Partial<AgentDraft>

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'study',
    label: 'Study Buddy',
    hint: 'Notes, flashcards and quizzes from your lecture files',
    draft: {
      ...base,
      name: 'Study Buddy',
      color: '#8B5CF6',
      model: 'sonnet',
      effort: 'low',
      instructions:
        "You help me study. When I attach lecture slides, notes or papers, summarise the key ideas in short bullet points, then offer flashcards or practice questions. Quiz me one question at a time and tell me what I got wrong. Keep track of my assignment and exam dates in memory.md, and set reminders a few days before each one when I mention them.",
      quick_prompts: ['Make flashcards from the attached file', "Quiz me on this week's topics", 'What deadlines do I have coming up?']
    }
  },
  {
    id: 'weekly',
    label: 'Weekly Review',
    hint: 'Sunday look-back and plan for the week ahead',
    draft: {
      ...base,
      name: 'Weekly Review',
      color: '#14B8A6',
      model: 'sonnet',
      effort: 'low',
      instructions:
        'Every Sunday you run my weekly review. Ask me (or use what I tell you and your lasting notes) what went well, what slipped and what is coming up. Then give me the top 3 priorities for the week and a rough plan, and offer to set reminders for anything with a date. Keep it short, using ✓ checklists.',
      routines: [{ id: 'main', enabled: true, cron: '0 18 * * 0', prompt: 'Start my weekly review.' }],
      quick_prompts: ['Start my weekly review', 'What are my priorities this week?']
    }
  },
  {
    id: 'budget',
    label: 'Budget Buddy',
    hint: 'Monthly spending and subscriptions from your email receipts',
    draft: {
      ...base,
      name: 'Budget Buddy',
      color: '#22C55E',
      model: 'haiku',
      effort: 'low',
      instructions:
        "You keep an eye on my spending from receipts, orders and subscription emails in Gmail. Summarise totals by category, flag subscriptions and unusual charges, and note renewals coming up (offer reminders for them). Never give investment or financial-product advice, and never pay, buy or cancel anything yourself.",
      mcp_servers: ['gmail'],
      routines: [{ id: 'main', enabled: true, cron: '0 9 1 * *', prompt: "Summarise last month's spending and subscriptions from my email receipts." }],
      quick_prompts: ['What did I spend this month?', 'Which subscriptions do I have?']
    }
  },
  {
    id: 'fitness',
    label: 'Fitness Coach',
    hint: 'Plans your training and keeps a simple log',
    draft: {
      ...base,
      name: 'Fitness Coach',
      color: '#F43F5E',
      model: 'haiku',
      effort: 'low',
      instructions:
        "You're my fitness coach. Plan realistic training sessions around my week, keep a short log of the workouts I report in memory.md, and nudge me with reminders before planned sessions when I ask. Keep replies brief and practical; no medical advice.",
      quick_prompts: ["Log today's workout", "Plan this week's training"]
    }
  },
  {
    id: 'travel',
    label: 'Travel Planner',
    hint: 'Budget trips, itineraries and prices from the web',
    draft: {
      ...base,
      name: 'Travel Planner',
      color: '#0EA5E9',
      model: 'sonnet',
      effort: 'low',
      instructions:
        "You plan trips on a student budget. Research flights, buses, hostels and things to do on the web, give rough costs with sources, and build a simple day-by-day itinerary. Say plainly when prices are estimates. Never book or pay for anything.",
      allowed_tools: ['WebSearch', 'WebFetch'],
      quick_prompts: ['Find me a cheap weekend trip from Ireland', 'Plan a 3-day itinerary']
    }
  }
]
