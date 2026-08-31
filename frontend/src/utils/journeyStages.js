// Financial journey stage system — real net-worth thresholds, extracted from
// ICAN_Capital_Engine.jsx (journeyStages / determineCurrentStage /
// calculateStageProgress / getNextMilestone) so other views (the dashboard
// Progress card) can compute the same real stage without duplicating the
// business logic or importing that large component.
import { Zap, Building, Crown, Rocket } from 'lucide-react';

export const journeyStages = {
  1: {
    name: "Survival Stage",
    subtitle: "Establishing Velocity",
    threshold: { min: 0, max: 20000 },
    icon: Zap,
    color: "text-red-400",
    bgColor: "bg-red-500",
    problem: "Cash flow is minute, volatile, and impossible to track reliably. No savings, only daily survival.",
    focus: "Build consistent daily income and establish basic financial tracking.",
    milestone: "Stabilize into steady income stream (UGX 20,000+)"
  },
  2: {
    name: "Structure Stage",
    subtitle: "Time as Capital",
    threshold: { min: 20000, max: 500000 },
    icon: Building,
    color: "text-yellow-400",
    bgColor: "bg-yellow-500",
    problem: "Income is stable but growth is capped because time is disorganized and low-value tasks dominate.",
    focus: "Optimize time allocation and create high-value, repeatable work blocks.",
    milestone: "Achieve organized, productive lifestyle (UGX 500,000+)"
  },
  3: {
    name: "Security Stage",
    subtitle: "Protecting the Principle",
    threshold: { min: 500000, max: 10000000 },
    icon: Crown,
    color: "text-blue-400",
    bgColor: "bg-blue-500",
    problem: "Signing contracts that could erode wealth overnight. Legal mistakes can undo months of work.",
    focus: "Protect capital with legal diligence and formal risk management.",
    milestone: "Secure foundation for major ventures (UGX 10M+ contracts)"
  },
  4: {
    name: "Readiness Stage",
    subtitle: "Tender-Ready Entity",
    threshold: { min: 10000000, max: Infinity },
    icon: Rocket,
    color: "text-green-400",
    bgColor: "bg-green-500",
    problem: "Want to bid on government tenders or secure C-suite roles but missing specific requirements.",
    focus: "Close compliance gaps and position for global-scale opportunities.",
    milestone: "Ready for premium global opportunities and major tenders"
  }
};

export function determineCurrentStage(netWorth) {
  const value = netWorth || 0;
  if (value < 20000) return 1;
  if (value < 500000) return 2;
  if (value < 10000000) return 3;
  return 4;
}

export function calculateStageProgress(netWorth, stage) {
  const { min, max } = journeyStages[stage].threshold;
  if (max === Infinity) return 100;
  const progressRange = max - min;
  const currentProgress = Math.max(0, (netWorth || 0) - min);
  return Math.min(100, (currentProgress / progressRange) * 100);
}

export function getNextMilestone(netWorth, stage) {
  const currentStage = journeyStages[stage];
  const nextStage = journeyStages[stage + 1];
  const progress = calculateStageProgress(netWorth, stage);

  if (progress < 80 || !nextStage) {
    return { description: currentStage.milestone, target: currentStage.threshold.max };
  }
  return { description: nextStage.milestone, target: nextStage.threshold.min };
}
