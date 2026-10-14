// Onboarding questionnaire that maps answers to a risk profile.
export const QUESTIONS = [
  {
    id: "goal",
    prompt: "What are you investing for?",
    options: [
      { label: "A safety net", score: 0 },
      { label: "A big purchase in a few years", score: 1 },
      { label: "Long-term wealth", score: 2 },
    ],
  },
  {
    id: "horizon",
    prompt: "When might you need this money?",
    options: [
      { label: "Within 2 years", score: 0 },
      { label: "In 2 to 5 years", score: 1 },
      { label: "Not for 5+ years", score: 2 },
    ],
  },
  {
    id: "dip",
    prompt: "Your investments drop 20% in a month. You…",
    options: [
      { label: "Sell everything", score: 0 },
      { label: "Wait it out", score: 1 },
      { label: "Buy more", score: 2 },
    ],
  },
  {
    id: "experience",
    prompt: "How much have you invested before?",
    options: [
      { label: "Never", score: 0 },
      { label: "A little", score: 1 },
      { label: "I know my way around", score: 2 },
    ],
  },
];

export const PROFILES = {
  steady: {
    label: "Steady",
    blurb: "You value stability. We lean on index funds and bonds.",
  },
  balanced: {
    label: "Balanced",
    blurb: "A mix of broad funds and a few themes you care about.",
  },
  bold: {
    label: "Bold",
    blurb: "You can ride the ups and downs for bigger long-term growth.",
  },
};

// answers: { [questionId]: optionIndex }. Unanswered questions are unknown,
// so scoring requires every question.
export function scoreProfile(answers) {
  let total = 0;
  for (const q of QUESTIONS) {
    const index = answers[q.id];
    const option = q.options[index];
    if (option === undefined) return undefined;
    total += option.score;
  }
  const max = QUESTIONS.length * 2;
  if (total <= max / 3) return "steady";
  if (total <= (2 * max) / 3) return "balanced";
  return "bold";
}
