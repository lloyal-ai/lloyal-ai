import type {
  Decision,
  DecisionBoundary,
  Mode,
  Plan,
} from "../../../src/domain/work.js";

export const corpusVersion = 1;
export interface Expectation {
  actions: Decision["action"][];
  topologies?: Plan["topology"][];
  presentation?: Decision["presentation"];
  review?: boolean;
  tasks?: [number, number];
  minEdges?: number;
  minRoots?: number;
  allowedAbilities?: string[];
  retainAttachment?: boolean;
}
export interface DecisionCase {
  id: string;
  category: string;
  question: string;
  mode: Mode;
  abilities: string[];
  boundary?: DecisionBoundary;
  evidence?: {
    answer: string;
    completed: string[];
    missing: string[];
    stage: number;
  };
  history?: [string, string][];
  attachment?: "inspection.pdf";
  expect: Expectation;
  review: string;
}
const supplied =
  "Use only these supplied facts: A costs 120 plus 20 delivery; B costs 135 including delivery. Compare totals and say which is cheaper and by how much.";
export const cases: DecisionCase[] = [
  {
    id: "ordinary-explanation",
    category: "unnecessary work",
    mode: "Auto",
    abilities: ["web", "wikipedia"],
    question: "Explain why rainbows form in three sentences.",
    expect: { actions: ["answer"], presentation: "prose" },
    review:
      "Tools and multiple agents should not be required for this ordinary explanation.",
  },
  {
    id: "writing",
    category: "unnecessary work",
    mode: "Auto",
    abilities: ["web", "wikipedia"],
    question:
      "Rewrite this as one friendly sentence: The meeting is moved to Tuesday at 10. Please bring the draft.",
    expect: { actions: ["answer"], presentation: "prose" },
    review: "No invented facts, unnecessary clarification, or research plan.",
  },
  {
    id: "supplied-facts",
    category: "source restrictions",
    mode: "Auto",
    abilities: ["web", "wikipedia"],
    question: supplied,
    expect: { actions: ["answer"], allowedAbilities: [] },
    review:
      "Use the supplied premises; no external fact verification is necessary.",
  },
  {
    id: "manual-plan",
    category: "manual constraints",
    mode: "Plan",
    abilities: ["web", "wikipedia"],
    question:
      "Make an editable plan to compare bike and bus commuting using my supplied assumptions: bike 25 minutes and $0; bus 35 minutes and $4 each way. Wait for my approval.",
    expect: {
      actions: ["compose"],
      review: true,
      tasks: [1, 4],
      allowedAbilities: [],
    },
    review:
      "Small useful plan, using supplied facts; no research or final-synthesis-only task.",
  },
  {
    id: "manual-parallel",
    category: "manual constraints",
    mode: "Parallel",
    abilities: [],
    question:
      "Independently check A's total (120 plus 20 delivery) and B's total (135 including delivery), then compare them. Use only those facts.",
    expect: { actions: ["compose"], topologies: ["parallel"], tasks: [2, 3] },
    review:
      "Two independent checks; final combination is already owned by the harness.",
  },
  {
    id: "manual-chain",
    category: "manual constraints",
    mode: "Chain",
    abilities: [],
    question:
      "First derive a two-day schedule from these requirements: research before drafting, drafting before editing. Then audit the proposed schedule for dependencies. Then revise it using the audit. Use only these requirements.",
    expect: { actions: ["compose"], topologies: ["chain"], tasks: [3, 3] },
    review:
      "Audit needs the schedule; revision needs the audit. No duplicate synthesis step.",
  },
  {
    id: "manual-graph",
    category: "dependencies",
    mode: "Graph",
    abilities: [],
    question:
      "Plan independent checks of budget and staffing, then a feasibility check that needs both findings. Budget is 100 units; staffing is 2 people for 3 days; the project needs 90 units and 5 person-days. Use only these facts and let me edit the approach.",
    expect: {
      actions: ["compose"],
      topologies: ["graph"],
      review: true,
      tasks: [3, 3],
      minRoots: 2,
      minEdges: 2,
    },
    review:
      "The feasibility check consumes both prerequisite findings; it is more than a summary.",
  },
  {
    id: "auto-dependent",
    category: "necessary work",
    mode: "Auto",
    abilities: [],
    question:
      "I want three separate work steps: draft a migration checklist for a small static website, audit that draft for broken-link and rollback risks, then revise it based on the audit. Use general knowledge only.",
    expect: {
      actions: ["compose"],
      topologies: ["chain", "graph"],
      tasks: [3, 3],
      allowedAbilities: [],
    },
    review:
      "Honor explicitly requested dependent work without forcing a particular equivalent topology.",
  },
  {
    id: "landscape-fanout",
    category: "necessary work",
    mode: "Auto",
    abilities: ["web", "wikipedia"],
    question:
      "First survey the main approaches to storing solar energy at home. From that landscape, have separate workers investigate two promising approaches for cost and maintenance. Then give me the comparison. Use web sources.",
    expect: {
      actions: ["compose"],
      topologies: ["fanout", "graph"],
      tasks: [3, 4],
      minEdges: 2,
    },
    review:
      "The follow-up investigations need the landscape; check that their scope can actually be determined before that survey runs.",
  },
  {
    id: "missing-documents",
    category: "missing inputs",
    mode: "Auto",
    abilities: ["web", "wikipedia"],
    question:
      "Compare the exact liability clauses in the two contracts I attached. I need a clause-by-clause table.",
    expect: { actions: ["clarify"] },
    review:
      "No documents were admitted. Ask for the contracts; do not invent their clauses.",
  },
  {
    id: "missing-web",
    category: "missing capabilities",
    mode: "Auto",
    abilities: [],
    question:
      "Verify today's Sydney weather against a live online source. Do not answer from memory or estimates.",
    expect: { actions: ["clarify"] },
    review:
      "No online ability is available. Do not claim to have checked current conditions.",
  },
  {
    id: "focused-pdf",
    category: "attachment routing",
    mode: "Auto",
    abilities: ["documents"],
    attachment: "inspection.pdf",
    question: "What is the combined delivery total in the attached study?",
    expect: { actions: ["answer"] },
    review:
      "One document lookup should not force a multi-agent research workflow.",
  },
  {
    id: "document-only",
    category: "source restrictions",
    mode: "Auto",
    abilities: ["documents", "web", "wikipedia"],
    attachment: "inspection.pdf",
    question:
      "Using only this attached PDF, compare Cedar and Willow's deliveries in a small table. Do not use the web or general-knowledge sources.",
    expect: {
      actions: ["answer", "compose"],
      presentation: "table",
      allowedAbilities: ["documents"],
      retainAttachment: true,
    },
    review:
      "Preserve the real document reference and restrict source access; a useful composition is acceptable.",
  },
  {
    id: "conversation-recall",
    category: "inherited context",
    mode: "Auto",
    abilities: [],
    history: [
      [
        "Remember my two options: A totals 140 units and B totals 135 units.",
        "A totals 140; B totals 135, which is 5 units cheaper.",
      ],
    ],
    question: "Which of my earlier options was cheaper?",
    expect: { actions: ["answer"] },
    review:
      "Resolve the follow-up using the actual inherited trunk, without asking the person to repeat it.",
  },
  ...(["Plan", "Parallel", "Chain", "Graph"] as const).map(
    (mode): DecisionCase => ({
      id: `complete-revisit-${mode.toLowerCase()}`,
      category: "sufficient revisit",
      mode,
      abilities: [],
      question: supplied,
      boundary: "revisit",
      evidence: {
        answer:
          "A totals 140 units. B totals 135 units. B is cheaper by 5 units. Both totals and the difference have been independently checked. Nothing is missing.",
        completed: ["a", "b"],
        missing: [],
        stage: 1,
      },
      expect: { actions: ["answer"] },
      review:
        "Completed work can finish in every manual mode; do not loop or clarify unnecessarily.",
    }),
  ),
  {
    id: "incomplete-revisit",
    category: "necessary revisit",
    mode: "Parallel",
    abilities: [],
    question:
      "Independently check A, B and C then compare their totals. A is 120 plus 20; B is 135 including delivery; C is 110 plus 18. Use only these facts.",
    boundary: "revisit",
    evidence: {
      answer:
        "A totals 140. B totals 135. C has not been checked; no three-way comparison is available.",
      completed: ["a", "b"],
      missing: ["c"],
      stage: 1,
    },
    expect: { actions: ["compose"], topologies: ["parallel"], tasks: [1, 1] },
    review:
      "Check only C. Do not repeat A and B, and do not claim that all requested checks finished.",
  },
];
